# .NET and Java

Small client libraries with no runtime dependencies. Both can send records to the
[Ingest API](ingest-api.md) from a background queue, and both can route HTTP calls through the
[HTTP proxy](http-proxy.md) for you.

They live in `packages/sdk-dotnet` (.NET 8) and `packages/sdk-java` (Java 11+). Each folder has a
README with build instructions and examples. They are not yet published to NuGet or Maven Central,
so build them from source for now.

## .NET

- `TorrixClient.IngestAsync(record)` sends a record.
- `TorrixProxyHandler` is an `HttpMessageHandler` you add to an `HttpClient`. It rewrites requests
  to go through the Torrix proxy and adds the right headers.

## Java

- `TorrixClient` sends records.
- `TorrixProxy` builds proxied requests for `java.net.http.HttpClient`.

Both clients accept the same grouping fields as the other integrations (trace, session, parent
run, agent), described in [How Torrix organizes your data](../concepts.md).
