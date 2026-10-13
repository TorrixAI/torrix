# FAQ

**Does my data leave my server?**
No. Prompts, responses and usage are stored in your own database. Torrix itself only makes an
anonymous daily ping and a daily download of public model prices, and you can turn both off. See
[Privacy and security](privacy-and-security.md).

**Does the proxy slow my calls down?**
Torrix forwards the request and streams the answer back as it arrives. Recording happens after the
response, so streamed tokens are not held back.

**What happens to my app if Torrix is down?**
With the proxy, calls go through Torrix, so plan for it like any other gateway: run it close to your
app, and keep a direct fallback if the calls are critical. With the SDKs and plugins, Torrix is not
in the request path, so your calls keep working. The Claude Code plugin sends what it missed on
the next turn; the SDKs and the opencode plugin skip records they cannot deliver.

**Which providers work?**
Any provider reachable over HTTP. Token counts and costs are read automatically for OpenAI,
Anthropic, Gemini and OpenAI-compatible APIs (DeepSeek, Groq, OpenRouter, Together, Ollama, vLLM and
others).

**Why does a run show $0?**
Torrix has no price for that model yet. Add one under **Cost & Alerts > Pricing**. Prices for popular
models are refreshed once a day.

**My agent's calls show up as separate one-call traces. How do I group them?**
Send a trace id per user turn: the `x-torrix-trace` header with the proxy, `run_context` or
`runContext` with the SDKs, or the `traceparent` header if you already use OpenTelemetry. See
[How Torrix organizes your data](concepts.md).

**Which platforms' agents can Torrix govern?**
Any of them. Torrix does not care where an agent was built. If the agent can call a remote MCP
server over HTTP with custom headers (Claude Code, opencode, Gemini CLI, Cursor, the OpenAI Agents
SDK, LangGraph, n8n and many more), point it at the Torrix gateway and every tool call is checked
first. If it cannot speak MCP, it can call a check endpoint before it acts. Governance is a Pro and
Enterprise feature. Seeing what any agent did works in every edition through the proxy, the SDKs or
OpenTelemetry.

**Can I use Postgres?**
Yes. Set `TORRIX_DATABASE_URL`, or switch live under **Settings > Database engine**.

**Can more than one person use the Community edition?**
Yes, up to 5 user accounts, with projects and roles. An administrator adds each account on the
**Team** page. Pro and Enterprise have no user limit.

**I am moving from Helicone. Do I have to change my headers?**
No. Torrix reads Helicone's session, request, user and property headers. Change the base URL first
and rename headers when convenient. See [HTTP proxy](integrations/http-proxy.md#coming-from-helicone).

**Is Torrix open source?**
The code is public under the Functional Source License, and every release becomes Apache 2.0 after
two years. See [Editions and licensing](editions-and-licensing.md).
