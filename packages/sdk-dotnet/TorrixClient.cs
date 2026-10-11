#nullable enable

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Torrix;

/// <summary>
/// Posts run records to a Torrix instance. Records are queued and delivered by
/// a background task so logging never blocks the request path; the queue is
/// flushed on process exit and can be flushed manually with <see cref="Flush"/>.
/// </summary>
public sealed class TorrixClient : IDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _http;
    private readonly BlockingCollection<IReadOnlyList<Dictionary<string, object?>>> _queue = new();
    private readonly Task _worker;
    private readonly TimeSpan _flushTimeout;
    private int _pending;
    private int _disposed;

    public string BaseUrl { get; }
    public bool Enabled { get; }

    public TorrixClient(
        string apiKey,
        string baseUrl = "http://localhost:8088",
        string? project = null,
        bool enabled = true,
        TimeSpan? timeout = null,
        TimeSpan? flushTimeout = null)
    {
        _http = new HttpClient
        {
            BaseAddress = new Uri((baseUrl ?? "http://localhost:8088").TrimEnd('/') + "/"),
            Timeout = timeout ?? TimeSpan.FromSeconds(10),
        };
        if (!string.IsNullOrWhiteSpace(apiKey))
        {
            _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        }
        if (!string.IsNullOrWhiteSpace(project))
        {
            _http.DefaultRequestHeaders.TryAddWithoutValidation("x-torrix-project", project);
        }
        BaseUrl = _http.BaseAddress.ToString().TrimEnd('/');
        Enabled = enabled;
        _flushTimeout = flushTimeout ?? TimeSpan.FromSeconds(5);
        _worker = Task.Run(WorkerLoop);
        AppDomain.CurrentDomain.ProcessExit += (_, _) => Flush();
    }

    public Task<List<string>> IngestAsync(Dictionary<string, object?> record, bool wait = false, CancellationToken cancellationToken = default)
        => IngestAsync(new[] { record }, wait, cancellationToken);

    public async Task<List<string>> IngestAsync(
        IEnumerable<Dictionary<string, object?>> records,
        bool wait = false,
        CancellationToken cancellationToken = default)
    {
        var items = records?.Where(record => record is not null).ToList() ?? new List<Dictionary<string, object?>>();
        if (!Enabled || items.Count == 0 || Volatile.Read(ref _disposed) == 1)
        {
            return new List<string>();
        }
        var batch = (IReadOnlyList<Dictionary<string, object?>>)items;
        if (!wait)
        {
            Interlocked.Increment(ref _pending);
            _queue.Add(batch, cancellationToken);
            return new List<string>();
        }
        return await SendAsync(batch, cancellationToken).ConfigureAwait(false);
    }

    public bool Flush(TimeSpan? timeout = null)
    {
        if (Volatile.Read(ref _disposed) == 1)
        {
            return true;
        }
        var deadline = DateTime.UtcNow + (timeout ?? _flushTimeout);
        while (Volatile.Read(ref _pending) > 0 && DateTime.UtcNow < deadline)
        {
            Thread.Sleep(10);
        }
        return Volatile.Read(ref _pending) == 0;
    }

    public async Task<bool> HealthAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            using var response = await _http.GetAsync("health", cancellationToken).ConfigureAwait(false);
            return response.IsSuccessStatusCode;
        }
        catch (Exception)
        {
            return false;
        }
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) == 1)
        {
            return;
        }
        Flush();
        _queue.CompleteAdding();
        try
        {
            _worker.Wait(TimeSpan.FromSeconds(1));
        }
        catch (AggregateException)
        {
            // worker shutdown is best-effort
        }
        _http.Dispose();
    }

    private async Task WorkerLoop()
    {
        foreach (var batch in _queue.GetConsumingEnumerable())
        {
            try
            {
                await SendAsync(batch, CancellationToken.None).ConfigureAwait(false);
            }
            catch (Exception)
            {
                // errors surface through HealthAsync / accepted ids; never throw on the worker
            }
            finally
            {
                Interlocked.Decrement(ref _pending);
            }
        }
    }

    private async Task<List<string>> SendAsync(IReadOnlyList<Dictionary<string, object?>> batch, CancellationToken cancellationToken)
    {
        var payload = JsonSerializer.Serialize(new { records = batch }, JsonOptions);
        using var content = new StringContent(payload, Encoding.UTF8, "application/json");
        using var response = await _http.PostAsync("api/ingest", content, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException($"torrix ingest rejected with HTTP {(int)response.StatusCode}: {body}");
        }
        if (string.IsNullOrWhiteSpace(body))
        {
            return new List<string>();
        }
        using var document = JsonDocument.Parse(body);
        if (!document.RootElement.TryGetProperty("ids", out var ids) || ids.ValueKind != JsonValueKind.Array)
        {
            return new List<string>();
        }
        return ids.EnumerateArray().Select(id => id.GetString() ?? string.Empty).Where(id => id.Length > 0).ToList();
    }
}

/// <summary>Process-wide convenience facade mirroring the Python SDK.</summary>
public static class Torrix
{
    private static TorrixClient? _default;

    public static TorrixClient Init(
        string apiKey,
        string baseUrl = "http://localhost:8088",
        string? project = null,
        bool enabled = true)
    {
        _default = new TorrixClient(apiKey, baseUrl, project, enabled);
        return _default;
    }

    public static TorrixClient? Current => _default;

    public static TorrixClient GetClient() => _default
        ?? throw new InvalidOperationException("torrix not initialized: call Torrix.Init() first");

    public static Task<List<string>> IngestAsync(Dictionary<string, object?> record, bool wait = false, CancellationToken cancellationToken = default)
    {
        var client = _default;
        return client is null
            ? Task.FromResult(new List<string>())
            : client.IngestAsync(record, wait, cancellationToken);
    }

    public static bool Flush(TimeSpan? timeout = null) => _default?.Flush(timeout) ?? true;

    public static bool Health() => _default?.HealthAsync().GetAwaiter().GetResult() ?? false;
}
