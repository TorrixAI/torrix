# Torrix .NET SDK

Self-hosted LLM observability for .NET: ingest run records into a Torrix
instance, or route provider SDK traffic through the Torrix proxy so every call
is logged, costed and policy-checked.

Targets `net8.0`, no external dependencies.

## Ingest

```csharp
using Torrix;

Torrix.Init("trxk_...", "http://localhost:8088", project: "production");

await Torrix.IngestAsync(new Dictionary<string, object?>
{
    ["model"] = "gpt-4o-mini",
    ["provider"] = "openai",
    ["latency_ms"] = 812,
    ["trace_id"] = "turn-42",
    ["session_id"] = "chat-7",
    ["agent_name"] = "support-bot",
    ["request"] = new Dictionary<string, object?>
    {
        ["body"] = new Dictionary<string, object?>
        {
            ["messages"] = new[] { new Dictionary<string, object?> { ["role"] = "user", ["content"] = "Hello" } },
        },
    },
    ["response"] = new Dictionary<string, object?>
    {
        ["body"] = new Dictionary<string, object?>
        {
            ["choices"] = new[] { new Dictionary<string, object?> { ["message"] = new Dictionary<string, object?> { ["content"] = "Hi there" } } },
            ["usage"] = new Dictionary<string, object?> { ["prompt_tokens"] = 12, ["completion_tokens"] = 4 },
        },
    },
});

Torrix.Flush();  // records are batched on a background task; flush on shutdown
```

`Torrix.Init` returns the `TorrixClient`, which is also usable directly when you
need more than one instance. Use `wait: true` on `IngestAsync` for synchronous
delivery when a test needs the ids immediately.

## Proxy a provider SDK

`TorrixProxyHandler` is a `DelegatingHandler`: give it the Torrix base URL, your
Torrix key and the upstream provider details, then use it as the transport of
the `HttpClient` your provider SDK builds on.

```csharp
using Torrix;

var handler = new TorrixProxyHandler(new TorrixProxyOptions
{
    TorrixBaseUrl = "http://localhost:8088",
    TorrixApiKey = "trxk_...",
    TargetBaseUrl = "https://api.openai.com/v1",
    UpstreamAuthorization = "Bearer sk-...",
    AgentName = "checkout-agent",
    SessionId = "session-123",
});
var http = new HttpClient(handler) { BaseAddress = new Uri("https://api.openai.com/v1/") };
// requests sent through `http` now carry x-target-url and land in Torrix
```

For Anthropic upstreams set `UpstreamApiKey` instead of
`UpstreamAuthorization`; Torrix forwards it as `x-api-key`.

## Build

```
dotnet build packages/sdk-dotnet/Torrix.Sdk.csproj
```

The project has no package dependencies, so it also drops into a larger
solution unchanged.
