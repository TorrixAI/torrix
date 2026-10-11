#nullable enable

using System;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading;
using System.Threading.Tasks;

namespace Torrix;

/// <summary>Configuration for <see cref="TorrixProxyHandler"/>.</summary>
public sealed class TorrixProxyOptions
{
    /// <summary>Torrix base URL, e.g. <c>http://localhost:8088</c>.</summary>
    public string TorrixBaseUrl { get; set; } = "http://localhost:8088";

    /// <summary>Torrix API key (`trxk_...`) used as the Bearer token to Torrix.</summary>
    public string? TorrixApiKey { get; set; }

    /// <summary>Upstream provider base URL used when the request URI is relative, e.g. <c>https://api.openai.com/v1</c>.</summary>
    public string? TargetBaseUrl { get; set; }

    /// <summary>Upstream <c>Authorization</c> value, e.g. <c>Bearer sk-...</c>.</summary>
    public string? UpstreamAuthorization { get; set; }

    /// <summary>Upstream API key for providers that use <c>x-api-key</c> (Anthropic).</summary>
    public string? UpstreamApiKey { get; set; }

    public string? AgentName { get; set; }
    public string? SessionId { get; set; }
    public string? TraceId { get; set; }
    public string? RunName { get; set; }

    /// <summary>Torrix project id or name.</summary>
    public string? Project { get; set; }
}

/// <summary>
/// A <see cref="DelegatingHandler"/> that routes provider SDK traffic through
/// the Torrix <c>/proxy</c> pipeline. Use it as the transport of an
/// <see cref="HttpClient"/> whose provider calls would otherwise go straight to
/// the vendor; set <see cref="TorrixProxyOptions.TargetBaseUrl"/> for relative
/// request URIs, or let absolute request URIs pass through unchanged as the
/// target. Every call is logged, costed and policy-checked by Torrix.
/// </summary>
public sealed class TorrixProxyHandler : DelegatingHandler
{
    private readonly TorrixProxyOptions _options;

    public TorrixProxyHandler(TorrixProxyOptions options)
        : base(new HttpClientHandler())
    {
        _options = options ?? throw new ArgumentNullException(nameof(options));
    }

    public TorrixProxyHandler(TorrixProxyOptions options, HttpMessageHandler innerHandler)
        : base(innerHandler ?? throw new ArgumentNullException(nameof(innerHandler)))
    {
        _options = options ?? throw new ArgumentNullException(nameof(options));
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var originalUri = request.RequestUri ?? throw new InvalidOperationException("request URI is required");
        var path = originalUri.IsAbsoluteUri
            ? originalUri.AbsolutePath + originalUri.Query
            : "/" + originalUri.ToString().TrimStart('/');

        var torrixBase = _options.TorrixBaseUrl.TrimEnd('/');
        var torrixUri = new Uri(torrixBase + path);

        string targetUrl;
        if (originalUri.IsAbsoluteUri && !SameHost(originalUri, torrixBase))
        {
            targetUrl = originalUri.ToString();
        }
        else if (!string.IsNullOrWhiteSpace(_options.TargetBaseUrl))
        {
            targetUrl = _options.TargetBaseUrl!.TrimEnd('/') + path;
        }
        else
        {
            throw new InvalidOperationException("relative request URI requires TorrixProxyOptions.TargetBaseUrl");
        }

        using var clone = new HttpRequestMessage(request.Method, torrixUri);
        if (request.Content is not null)
        {
            var buffer = new MemoryStream();
            await request.Content.CopyToAsync(buffer, cancellationToken).ConfigureAwait(false);
            buffer.Position = 0;
            clone.Content = new StreamContent(buffer);
            foreach (var header in request.Content.Headers)
            {
                clone.Content.Headers.TryAddWithoutValidation(header.Key, header.Value);
            }
        }
        foreach (var header in request.Headers)
        {
            if (IsRestrictedHeader(header.Key))
            {
                continue;
            }
            clone.Headers.TryAddWithoutValidation(header.Key, header.Value);
        }
        foreach (var option in request.Options)
        {
            clone.Options.Set(new HttpRequestOptionsKey<object?>(option.Key), option.Value);
        }

        clone.Headers.TryAddWithoutValidation("x-target-url", targetUrl);
        if (!string.IsNullOrWhiteSpace(_options.UpstreamAuthorization))
        {
            clone.Headers.TryAddWithoutValidation("x-upstream-authorization", _options.UpstreamAuthorization);
        }
        if (!string.IsNullOrWhiteSpace(_options.UpstreamApiKey))
        {
            clone.Headers.TryAddWithoutValidation("x-upstream-api-key", _options.UpstreamApiKey);
        }
        if (!string.IsNullOrWhiteSpace(_options.TorrixApiKey))
        {
            clone.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.TorrixApiKey);
        }
        if (!string.IsNullOrWhiteSpace(_options.Project))
        {
            clone.Headers.TryAddWithoutValidation("x-torrix-project", _options.Project);
        }
        if (!string.IsNullOrWhiteSpace(_options.AgentName))
        {
            clone.Headers.TryAddWithoutValidation("x-agent-name", _options.AgentName);
        }
        if (!string.IsNullOrWhiteSpace(_options.SessionId))
        {
            clone.Headers.TryAddWithoutValidation("x-torrix-session", _options.SessionId);
        }
        if (!string.IsNullOrWhiteSpace(_options.TraceId))
        {
            clone.Headers.TryAddWithoutValidation("x-torrix-trace", _options.TraceId);
        }
        if (!string.IsNullOrWhiteSpace(_options.RunName))
        {
            clone.Headers.TryAddWithoutValidation("x-torrix-name", _options.RunName);
        }

        return await base.SendAsync(clone, cancellationToken).ConfigureAwait(false);
    }

    private static bool SameHost(Uri uri, string baseUrl)
    {
        return Uri.TryCreate(baseUrl, UriKind.Absolute, out var parsed) &&
               string.Equals(uri.Host, parsed.Host, StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsRestrictedHeader(string name)
    {
        return name.Equals("Host", StringComparison.OrdinalIgnoreCase)
            || name.Equals("Authorization", StringComparison.OrdinalIgnoreCase)
            || name.Equals("Content-Length", StringComparison.OrdinalIgnoreCase)
            || name.Equals("Content-Type", StringComparison.OrdinalIgnoreCase);
    }
}
