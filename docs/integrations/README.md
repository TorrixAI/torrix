# Integrations

Every integration writes the same kind of record, so dashboards, traces, cost and search work the
same whichever you choose. Use one path per app. If you combine two for the same calls (for
example a plugin and the proxy), you may record each call twice.

The **Integrations** page in Torrix generates a key for each tool and shows the exact commands for
your setup, with live connection status.

| Integration | Code changes | Best for |
|---|---|---|
| [HTTP proxy](http-proxy.md) | change the base URL, add headers | any language or tool that makes HTTP calls |
| [Python SDK](python-sdk.md) | two lines | Python apps using OpenAI or Anthropic |
| [TypeScript SDK](typescript-sdk.md) | two lines | Node.js, Bun and Deno apps, Vercel AI SDK |
| [Claude Code](claude-code.md) | none, install a plugin | logging your Claude Code sessions |
| [opencode](opencode.md) | none, copy a plugin | logging your opencode sessions |
| [OpenTelemetry](opentelemetry.md) | set an exporter endpoint | apps already instrumented with OpenTelemetry |
| [Ingest API](ingest-api.md) | one HTTP POST per call | custom integrations and backfills |
| [MCP](mcp.md) | add a server to your MCP client | letting an assistant query your traces |
| [.NET and Java](other-sdks.md) | small client library | services on those platforms |

All examples use `http://localhost:8088`. Replace it with the address of your Torrix server, and
replace `trxk_YOUR_KEY` with a key from the Integrations or API Keys page.
