# Torrix Java SDK

Self-hosted LLM observability for Java: ingest run records into a Torrix
instance, or route provider calls through the Torrix `/proxy` pipeline so every
call is logged, costed and policy-checked.

Java 11+, no runtime dependencies (`java.net.http` and a small internal JSON
writer are the whole stack).

## Ingest

```java
import dev.torrix.Torrix;
import java.util.Map;

Torrix.init("trxk_...", "http://localhost:8088");

Torrix.ingest(Map.of(
    "model", "gpt-4o-mini",
    "provider", "openai",
    "latency_ms", 812,
    "trace_id", "turn-42",
    "session_id", "chat-7",
    "agent_name", "support-bot",
    "request", Map.of("body", Map.of(
        "messages", java.util.List.of(Map.of("role", "user", "content", "Hello")))),
    "response", Map.of("body", Map.of(
        "choices", java.util.List.of(Map.of("message", Map.of("content", "Hi there"))),
        "usage", Map.of("prompt_tokens", 12, "completion_tokens", 4)))
));

Torrix.flush();  // records are batched on a daemon thread; flush on shutdown
```

`Torrix.init` returns the `TorrixClient`; use `client.ingest(records, true)` for
synchronous delivery when a test needs the accepted ids.

## Proxy a provider

```java
import dev.torrix.TorrixProxy;
import java.net.http.*;
import java.net.URI;

TorrixProxy proxy = TorrixProxy.builder()
    .torrixBaseUrl("http://localhost:8088")
    .torrixApiKey("trxk_...")
    .targetBaseUrl("https://api.openai.com/v1")
    .upstreamAuthorization("Bearer sk-...")
    .agentName("checkout-agent")
    .sessionId("session-123")
    .build();

String path = "/v1/chat/completions";
HttpRequest.Builder request = HttpRequest.newBuilder(proxy.endpoint(path))
    .header("content-type", "application/json")
    .POST(HttpRequest.BodyPublishers.ofString(body));
proxy.apply(request, path);
HttpResponse<String> response = HttpClient.newHttpClient()
    .send(request.build(), HttpResponse.BodyHandlers.ofString());
```

For Anthropic upstreams set `upstreamApiKey(...)`; Torrix forwards it as
`x-api-key`.

## Build

```
mvn -f packages/sdk-java/pom.xml package
```
