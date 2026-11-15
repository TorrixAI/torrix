import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, relTime } from "../api";
import { formatCount } from "../api";
import { EmptyRow, PageHead, Panel } from "../components";
import { useToast } from "../toast";

type Shell = "posix" | "powershell";

interface IntegrationsResponse {
  base_url: string;
  plugin_marketplace: string;
  integrations: { id: string; last_at: string | null; runs_24h: number }[];
}

interface Ctx { base: string; key: string }
interface Step { text: string; code?: (ctx: Ctx) => string; shells?: (ctx: Ctx) => { posix: string; powershell: string } }
interface Card { id: string; title: string; lead: string; keyName: string; steps: Step[] }

const KEY_PLACEHOLDER = "trxk_YOUR_KEY";

function cards(): Card[] {
  return [
    {
      id: "claude-code", title: "Claude Code", keyName: "Claude Code",
      lead: "Logs every Claude Code model call with tokens, prompt cache, cost, tool calls and the subagent tree. Works with a Claude subscription or an API key, and never sits in Claude Code's request path.",
      steps: [
        { text: "Generate a key for Claude Code." },
        { text: "Make sure the claude command works in your terminal (the VS Code extension does not add it):", shells: () => ({ posix: "curl -fsSL https://claude.ai/install.sh | bash", powershell: "irm https://claude.ai/install.ps1 | iex" }) },
        { text: "Install the plugin and connect it in one command:", shells: (ctx) => ({ posix: `curl -fsSL ${ctx.base}/api/connect/claude-code.sh | TORRIX_API_KEY=${ctx.key} sh`, powershell: `$env:TORRIX_API_KEY="${ctx.key}"; irm ${ctx.base}/api/connect/claude-code.ps1 | iex` }) },
        { text: "Already installed? Re-run the same command; it updates the key and URL." },
        { text: "Start a new Claude Code session, or run /reload-plugins." },
      ],
    },
    {
      id: "opencode", title: "opencode", keyName: "opencode",
      lead: "Logs every opencode step with its agent tree, session and turn grouping. Requires opencode 2.x and works in T3 Code.",
      steps: [
        { text: "Generate a key for opencode." },
        { text: "Install the plugin and save the connection in one command:", shells: (ctx) => ({ posix: `curl -fsSL ${ctx.base}/api/connect/opencode.sh | TORRIX_API_KEY=${ctx.key} sh`, powershell: `$env:TORRIX_API_KEY="${ctx.key}"; irm ${ctx.base}/api/connect/opencode.ps1 | iex` }) },
        { text: "Restart opencode or T3 Code, then start a new session. The installer writes ~/.torrix/opencode.json, so no environment variables are needed." },
        { text: "Already installed? Re-run the same command to update the key or URL. TORRIX_URL and TORRIX_API_KEY still override the file if you prefer the environment." },
      ],
    },
    {
      id: "sdk", title: "Python and TypeScript SDKs", keyName: "SDK",
      lead: "Wrap your OpenAI or Anthropic client once; every call is recorded in the background with tokens, cost and latency.",
      steps: [
        { text: "Generate a key for your application." },
        { text: "Python: install the SDK.", code: () => "pip install torrix-sdk" },
        { text: "Then add two lines where your app starts:", code: (ctx) => `import torrix\n\ntorrix.init(api_key="${ctx.key}", base_url="${ctx.base}")\ntorrix.wrap()  # patches OpenAI and Anthropic clients` },
        { text: "TypeScript or JavaScript: install the SDK.", code: () => "npm install torrix-sdk" },
        { text: "Then wrap your client:", code: (ctx) => `import * as torrix from "torrix-sdk";\n\ntorrix.init("${ctx.key}", "${ctx.base}");\ntorrix.wrap(client);` },
      ],
    },
    {
      id: "proxy", title: "HTTP proxy", keyName: "Proxy",
      lead: "Send provider calls through Torrix with no SDK, from any tool that lets you set an OpenAI-compatible base URL and add headers. Torrix forwards them and records the full request and response.",
      steps: [
        { text: "Generate a key for the proxy." },
        { text: "Call any provider through /proxy, for example OpenAI:", shells: (ctx) => ({
          posix: [`curl ${ctx.base}/proxy/chat/completions \\`, `  -H "authorization: Bearer ${ctx.key}" \\`, `  -H "x-target-url: https://api.openai.com/v1/chat/completions" \\`, `  -H "x-upstream-authorization: Bearer $OPENAI_API_KEY" \\`, `  -H "content-type: application/json" \\`, `  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}]}'`].join("\n"),
          powershell: [`$headers = @{`, `  "authorization" = "Bearer ${ctx.key}"`, `  "x-target-url" = "https://api.openai.com/v1/chat/completions"`, `  "x-upstream-authorization" = "Bearer $env:OPENAI_API_KEY"`, "}", `$body = '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}]}'`, `Invoke-RestMethod -Method Post -Uri "${ctx.base}/proxy/chat/completions" -Headers $headers -ContentType "application/json" -Body $body`].join("\n"),
        }) },
      ],
    },
    {
      id: "otel", title: "OpenTelemetry", keyName: "OpenTelemetry",
      lead: "Point an OTLP exporter at Torrix. GenAI spans become runs with tokens, cost and parent links.",
      steps: [
        { text: "Generate a key for your exporter." },
        { text: "Configure the OTLP/HTTP JSON traces exporter:", shells: (ctx) => ({ posix: `export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=${ctx.base}/v1/traces\nexport OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/json\nexport OTEL_EXPORTER_OTLP_TRACES_HEADERS="authorization=Bearer ${ctx.key}"`, powershell: `$env:OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = "${ctx.base}/v1/traces"\n$env:OTEL_EXPORTER_OTLP_TRACES_PROTOCOL = "http/json"\n$env:OTEL_EXPORTER_OTLP_TRACES_HEADERS = "authorization=Bearer ${ctx.key}"` }) },
      ],
    },
  ];
}

export default function IntegrationsPage() {
  const client = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: ["integrations"], queryFn: () => api<IntegrationsResponse>("/api/integrations") });
  const [shell, setShell] = useState<Shell>("posix");
  const [keys, setKeys] = useState<Record<string, string>>({});
  const generate = useMutation({
    mutationFn: (card: Card) => api<{ key: string }>("/api/keys", { method: "POST", body: JSON.stringify({ name: card.keyName, permission: "read_write" }) }),
    onSuccess: (data, card) => { setKeys((prev) => ({ ...prev, [card.id]: data.key })); toast.toast("Key created", { type: "success" }); void client.invalidateQueries({ queryKey: ["keys"] }); },
    onError: (error: Error) => toast.toast(error.message, { type: "error" }),
  });
  const copy = (text: string) => { void navigator.clipboard?.writeText(text); toast.toast("Copied.", { type: "success", duration: 1500 }); };

  if (query.isPending) return <div className="startup loading-page"><span>Loading integrations…</span></div>;
  const data = query.data;
  if (!data) return <div className="empty mt-6.5"><span className="empty-title">Could not load integrations</span></div>;
  const activity = new Map(data.integrations.map((row) => [row.id, row]));
  const cardList = cards();

  return <>
    <PageHead title="Integrations" sub={`Connect your tools to this instance at ${data.base_url}. Each integration gets its own API key, so you can revoke it on its own under API Keys.`} />
    <div className="int-shell">
      <span>Commands for</span>
      <ToggleGroup type="single" value={shell} onValueChange={(value) => { if (value) setShell(value as Shell); }}>
        <ToggleGroupItem value="posix">macOS / Linux</ToggleGroupItem>
        <ToggleGroupItem value="powershell">Windows (PowerShell)</ToggleGroupItem>
      </ToggleGroup>
      {shell === "powershell" ? <span className="int-shell-hint">Open Windows PowerShell, not Command Prompt.</span> : null}
    </div>
    <div className="int-grid">
      {cardList.map((card) => {
        const key = keys[card.id];
        const ctx: Ctx = { base: data.base_url, key: key ?? KEY_PLACEHOLDER };
        const row = activity.get(card.id);
        const connected = Boolean(row?.last_at);
        const runs = row?.runs_24h ?? 0;
        const tone = connected ? (runs > 0 ? "good" : "warn") : "neutral";
        const label = connected ? `Connected · last run ${relTime(row?.last_at)} · ${formatCount(runs)} ${runs === 1 ? "run" : "runs"} in 24h` : "Waiting for first run";
        const pending = generate.isPending && generate.variables?.id === card.id;
        return <Panel key={card.id} title={card.title} actions={<span className={`badge ${tone}`}><span className="dot" />{label}</span>}>
          <p className="int-lead">{card.lead}</p>
          <ol className="int-steps">
            {card.steps.map((step, index) => <li key={index}>
              {step.text}
              {index === 0 ? <div className="int-key">
                <Button variant="outline" type="button" disabled={pending || Boolean(key)} onClick={() => generate.mutate(card)}>{key ? "Key created" : "Generate key"}</Button>
                <span className="int-keynote">{key ? `Key ${key.slice(0, 10)}... created and filled in below. Copy it now: it is only shown on this page.` : `Creates a separate API key named "${card.keyName}".`}</span>
              </div> : null}
              {step.code ? <CodeBlock text={step.code(ctx)} onCopy={copy} /> : null}
              {step.shells ? <CodeBlock text={shell === "powershell" ? step.shells(ctx).powershell : step.shells(ctx).posix} onCopy={copy} /> : null}
            </li>)}
          </ol>
        </Panel>;
      })}
    </div>
    {cardList.length === 0 ? <Panel flush><div className="table-wrap"><table><tbody><EmptyRow colSpan={1}>No integrations.</EmptyRow></tbody></table></div></Panel> : null}
  </>;
}

function CodeBlock({ text, onCopy }: { text: string; onCopy: (text: string) => void }) {
  return <div className="int-code">
    <pre>{text}</pre>
    <Button variant="outline" size="icon" type="button" title="Copy" aria-label="Copy snippet" onClick={() => onCopy(text)}>Copy</Button>
  </div>;
}
