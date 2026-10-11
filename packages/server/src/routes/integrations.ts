import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ServerConfig } from "../core/config";
import type { AuthResult } from "../core/domain";
import type { ExtensionHost } from "../core/extensionHost";
import { authenticateKey, extractBearer, readAuthCookie } from "../lib/auth";
import { integrationActivity, pluginMarketplace, publicBaseUrl, type IntegrationActivity, type IntegrationId } from "../lib/integrations";
import type { Repositories } from "../repos";
import { escapeHtml, relTime, shell } from "./ui";

export interface IntegrationsDeps {
  repos: Repositories;
  config: ServerConfig;
  env: NodeJS.ProcessEnv;
  host?: ExtensionHost;
}

const KEY = "__KEY__";
const KEY_PLACEHOLDER = "trxk_YOUR_KEY";

type Shell = "posix" | "powershell";

interface Step {
  text: string;
  code?: string;
  /** Shell-specific variants; rendered behind the macOS/Linux | Windows toggle. */
  shells?: Record<Shell, string>;
}

interface Card {
  id: IntegrationId;
  title: string;
  lead: string;
  keyName: string;
  steps: Step[];
  note?: string;
}

function cards(base: string, source: string): Card[] {
  return [
    {
      id: "claude-code",
      title: "Claude Code",
      lead: "Logs every Claude Code model call with tokens, prompt cache, cost, tool calls and the subagent tree. Works with a Claude subscription or an API key, and never sits in Claude Code's request path.",
      keyName: "Claude Code",
      steps: [
        { text: "Generate a key for Claude Code." },
        {
          text: "Make sure the claude command works in your terminal. The VS Code extension does not add it, so install the Claude Code CLI if it is missing (it shares your existing login and settings):",
          shells: {
            posix: "curl -fsSL https://claude.ai/install.sh | bash",
            powershell: [
              "irm https://claude.ai/install.ps1 | iex",
              '$bin = "$HOME\\.local\\bin"; if (($env:Path -split ";") -notcontains $bin) { [Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path", "User") + ";$bin", "User"); $env:Path += ";$bin" }',
            ].join("\n"),
          },
        },
        {
          text: "Install the plugin with one command:",
          code: `claude plugin install torrix --marketplace ${source} --config api_key=${KEY} --config base_url=${base}`,
        },
        {
          text: "Already installed? Point it at this instance instead:",
          shells: {
            posix: `echo '{"api_key":"${KEY}","base_url":"${base}"}' | claude plugin configure torrix@torrix --values-stdin`,
            powershell: [
              "$utf8 = New-Object System.Text.UTF8Encoding $false; $OutputEncoding = $utf8; [Console]::InputEncoding = $utf8",
              `'{"api_key":"${KEY}","base_url":"${base}"}' | claude plugin configure torrix@torrix --values-stdin`,
            ].join("\n"),
          },
        },
        { text: "Start a new Claude Code session. Runs appear a few seconds after each turn." },
      ],
    },
    {
      id: "opencode",
      title: "opencode",
      lead: "Logs every opencode step with its agent tree, session and turn grouping. Requires opencode 2.x.",
      keyName: "opencode",
      steps: [
        { text: "Generate a key for opencode." },
        {
          text: "From the Torrix repo, copy the plugin into your opencode plugins folder:",
          shells: {
            posix: "mkdir -p ~/.config/opencode/plugins && cp .opencode/plugins/torrix.js ~/.config/opencode/plugins/",
            powershell: 'New-Item -ItemType Directory -Force "$HOME\\.config\\opencode\\plugins" | Out-Null\nCopy-Item .opencode\\plugins\\torrix.js "$HOME\\.config\\opencode\\plugins\\"',
          },
        },
        {
          text: "Save the connection settings, then start opencode from a new terminal:",
          shells: {
            posix: `echo 'export TORRIX_API_KEY=${KEY}' >> ~/.profile\necho 'export TORRIX_URL=${base}' >> ~/.profile`,
            powershell: `setx TORRIX_API_KEY "${KEY}"\nsetx TORRIX_URL "${base}"`,
          },
        },
      ],
    },
    {
      id: "sdk",
      title: "Python and TypeScript SDKs",
      lead: "Wrap your OpenAI or Anthropic client once; every call is recorded in the background with tokens, cost and latency.",
      keyName: "SDK",
      steps: [
        { text: "Generate a key for your application." },
        { text: "Python: install the SDK.", code: "pip install torrix-sdk" },
        {
          text: "Then add two lines where your app starts:",
          code: `import torrix\n\ntorrix.init(api_key="${KEY}", base_url="${base}")\ntorrix.wrap()  # patches OpenAI and Anthropic clients`,
        },
        { text: "TypeScript or JavaScript: install the SDK.", code: "npm install torrix-sdk" },
        {
          text: "Then wrap your client:",
          code: `import * as torrix from "torrix-sdk";\n\ntorrix.init("${KEY}", "${base}");\ntorrix.wrap(client);`,
        },
      ],
    },
    {
      id: "proxy",
      title: "HTTP proxy",
      lead: "Send provider calls through Torrix with no SDK. Torrix forwards them and records the full request and response.",
      keyName: "Proxy",
      steps: [
        { text: "Generate a key for the proxy." },
        {
          text: "Call any provider through /proxy, for example OpenAI:",
          shells: {
            posix: [
              `curl ${base}/proxy/chat/completions \\`,
              `  -H "authorization: Bearer ${KEY}" \\`,
              `  -H "x-target-url: https://api.openai.com/v1/chat/completions" \\`,
              `  -H "x-upstream-authorization: Bearer $OPENAI_API_KEY" \\`,
              `  -H "content-type: application/json" \\`,
              `  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}]}'`,
            ].join("\n"),
            powershell: [
              "$headers = @{",
              `  "authorization" = "Bearer ${KEY}"`,
              `  "x-target-url" = "https://api.openai.com/v1/chat/completions"`,
              `  "x-upstream-authorization" = "Bearer $env:OPENAI_API_KEY"`,
              "}",
              `$body = '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}]}'`,
              `Invoke-RestMethod -Method Post -Uri "${base}/proxy/chat/completions" -Headers $headers -ContentType "application/json" -Body $body`,
            ].join("\n"),
          },
        },
      ],
    },
    {
      id: "otel",
      title: "OpenTelemetry",
      lead: "Point an OTLP exporter at Torrix. GenAI spans become runs with tokens, cost and parent links.",
      keyName: "OpenTelemetry",
      steps: [
        { text: "Generate a key for your exporter." },
        {
          text: "Configure the OTLP/HTTP JSON traces exporter:",
          shells: {
            posix: `export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=${base}/v1/traces\nexport OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/json\nexport OTEL_EXPORTER_OTLP_TRACES_HEADERS="authorization=Bearer ${KEY}"`,
            powershell: `$env:OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = "${base}/v1/traces"\n$env:OTEL_EXPORTER_OTLP_TRACES_PROTOCOL = "http/json"\n$env:OTEL_EXPORTER_OTLP_TRACES_HEADERS = "authorization=Bearer ${KEY}"`,
          },
        },
      ],
    },
  ];
}

function statusLabel(activity: IntegrationActivity | undefined): { text: string; tone: string } {
  if (!activity?.lastAt) {
    return { text: "Waiting for first run", tone: "neutral" };
  }
  const today = activity.runs24h === 1 ? "1 run in 24h" : `${activity.runs24h.toLocaleString()} runs in 24h`;
  return { text: `Connected · last run ${relTime(activity.lastAt)} · ${today}`, tone: activity.runs24h > 0 ? "good" : "warn" };
}

const STYLE = `
.int-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.int-card .panel-head{gap:10px;flex-wrap:wrap}
.int-body{padding:14px 18px 18px;display:grid;gap:12px}
.int-lead{margin:0;color:var(--text-2);font-size:13px;line-height:1.6}
.int-steps{margin:0;padding-left:20px;display:grid;gap:10px;font-size:13px;color:var(--text)}
.int-steps li::marker{color:var(--text-3);font-family:var(--mono)}
.int-code{position:relative;margin-top:6px}
.int-code pre{margin:0;background:var(--bg);border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:var(--r);padding:10px 40px 10px 12px;font:12px/1.6 var(--mono);color:var(--text-2);white-space:pre-wrap;word-break:break-all}
.int-code .btn-icon{position:absolute;top:6px;right:6px}
.int-key{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:6px}
.int-keynote{font-size:12px;color:var(--text-3)}
.int-note{margin:0;font-size:12px;color:var(--text-3);line-height:1.6}
.int-shell{display:flex;align-items:center;gap:10px;margin:0 0 14px;font-size:12.5px;color:var(--text-2)}
.int-shell .filter-tabs{margin:0}
.int-shell button{font:inherit}
.int-shell-hint{font-size:12px;color:var(--text-3)}
.int-page[data-shell="posix"] [data-variant="powershell"],.int-page[data-shell="powershell"] [data-variant="posix"]{display:none}
@media(max-width:980px){.int-grid{grid-template-columns:1fr}}
`;

function codeBlock(text: string, shell: Shell | null): string {
  const variant = shell ? ` data-variant="${shell}"` : "";
  const label = shell === "powershell" ? "Copy PowerShell snippet" : shell === "posix" ? "Copy shell snippet" : "Copy snippet";
  return `<div class="int-code"${variant}><pre data-tpl="${escapeHtml(text)}">${escapeHtml(text.split(KEY).join(KEY_PLACEHOLDER))}</pre><button class="btn btn-ghost btn-icon" type="button" data-copy title="Copy" aria-label="${label}">Copy</button></div>`;
}

function shellToggle(active: Shell): string {
  const tab = (shell: Shell, label: string) =>
    `<button type="button" class="${active === shell ? "active" : ""}" data-shell-pick="${shell}" aria-pressed="${active === shell}">${label}</button>`;
  return `<div class="int-shell"><span>Commands for</span><div class="filter-tabs" role="group" aria-label="Command shell">${tab("posix", "macOS / Linux")}${tab("powershell", "Windows (PowerShell)")}</div><span class="int-shell-hint" data-variant="powershell">Open Windows PowerShell, not Command Prompt.</span></div>`;
}

function cardHtml(card: Card, activity: IntegrationActivity | undefined): string {
  const status = statusLabel(activity);
  const steps = card.steps
    .map((step, i) => {
      const key =
        i === 0
          ? `<div class="int-key"><button class="btn btn-primary" type="button" data-genkey="${escapeHtml(card.keyName)}">Generate key</button><span class="int-keynote" data-keynote>Creates a separate API key named "${escapeHtml(card.keyName)}".</span></div>`
          : "";
      const variants: Array<[Shell | null, string]> = step.shells
        ? [
            ["posix", step.shells.posix],
            ["powershell", step.shells.powershell],
          ]
        : step.code
          ? [[null, step.code]]
          : [];
      const code = variants.map(([shell, text]) => codeBlock(text, shell)).join("");
      return `<li>${escapeHtml(step.text)}${key}${code}</li>`;
    })
    .join("");
  return `<section class="panel int-card" data-int="${card.id}">
    <div class="panel-head"><span class="panel-title"><span class="sig"></span>${escapeHtml(card.title)}</span><span class="badge ${status.tone}" data-status><span class="dot"></span>${escapeHtml(status.text)}</span></div>
    <div class="int-body">
      <p class="int-lead">${escapeHtml(card.lead)}</p>
      <ol class="int-steps">${steps}</ol>
      ${card.note ? `<p class="int-note">${escapeHtml(card.note)}</p>` : ""}
    </div>
  </section>`;
}

function script(): string {
  return `<script>(function(){
  var AUTH="Bearer "+(localStorage.getItem("torrix_key")||"");
  function toast(msg,type){if(window.showToast)window.showToast(msg,type)}
  document.querySelectorAll("[data-genkey]").forEach(function(btn){
    btn.addEventListener("click",async function(){
      var card=btn.closest("[data-int]");btn.disabled=true;
      var res=await fetch("/api/keys",{method:"POST",headers:{"content-type":"application/json",authorization:AUTH},body:JSON.stringify({name:btn.getAttribute("data-genkey"),permission:"read_write"})});
      var j={};try{j=await res.json()}catch(e){}
      if(!res.ok||!j.key){btn.disabled=false;toast("Could not create a key ("+(j.error||res.status)+")","error");return}
      card.querySelectorAll("[data-tpl]").forEach(function(pre){pre.textContent=pre.getAttribute("data-tpl").split(${JSON.stringify(KEY)}).join(j.key)});
      card.querySelector("[data-keynote]").textContent="Key "+j.key.slice(0,10)+"... created and filled in below. Copy it now: it is only shown on this page.";
      btn.textContent="Key created";
      toast("Key created","success");
    });
  });
  document.querySelectorAll("[data-copy]").forEach(function(btn){
    btn.addEventListener("click",async function(){
      var text=btn.parentElement.querySelector("pre").textContent;
      try{await navigator.clipboard.writeText(text)}catch(e){var ta=document.createElement("textarea");ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand("copy");ta.remove()}
      btn.textContent="Copied";setTimeout(function(){btn.textContent="Copy"},1400);
    });
  });
  var page=document.querySelector(".int-page");
  function pickShell(shell){
    page.setAttribute("data-shell",shell);
    document.querySelectorAll("[data-shell-pick]").forEach(function(b){var on=b.getAttribute("data-shell-pick")===shell;b.classList.toggle("active",on);b.setAttribute("aria-pressed",on?"true":"false")});
    try{localStorage.setItem("torrix_shell",shell)}catch(e){}
  }
  try{var saved=localStorage.getItem("torrix_shell");if(saved==="posix"||saved==="powershell")pickShell(saved)}catch(e){}
  document.querySelectorAll("[data-shell-pick]").forEach(function(b){b.addEventListener("click",function(){pickShell(b.getAttribute("data-shell-pick"))})});
  function ago(iso){var s=Math.max(0,(Date.now()-Date.parse(iso))/1000);if(s<60)return "just now";if(s<3600)return Math.floor(s/60)+"m ago";if(s<86400)return Math.floor(s/3600)+"h ago";return Math.floor(s/86400)+"d ago"}
  async function refresh(){
    var res=await fetch("/api/integrations",{headers:{authorization:AUTH}}).catch(function(){return null});
    if(!res||!res.ok)return;
    var j=await res.json().catch(function(){return null});if(!j)return;
    j.integrations.forEach(function(it){
      var el=document.querySelector('[data-int="'+it.id+'"] [data-status]');if(!el)return;
      var text=it.last_at?"Connected · last run "+ago(it.last_at)+" · "+it.runs_24h.toLocaleString()+(it.runs_24h===1?" run":" runs")+" in 24h":"Waiting for first run";
      el.className="badge "+(it.last_at?(it.runs_24h>0?"good":"warn"):"neutral");
      el.innerHTML='<span class="dot"></span>';el.appendChild(document.createTextNode(text));
    });
  }
  setInterval(refresh,15000);
})();</script>`;
}

export async function integrationsRoute(app: FastifyInstance, deps: IntegrationsDeps): Promise<void> {
  const { repos, config, env } = deps;
  const pages = shell(repos, config, deps.host);

  const resolveAuth = async (request: FastifyRequest): Promise<AuthResult | null> => {
    const headerKey = extractBearer(String((request.headers as Record<string, unknown>).authorization ?? ""));
    let auth = headerKey ? await authenticateKey(repos.db, headerKey) : null;
    if (!auth) {
      const cookieKey = readAuthCookie(request.headers);
      auth = cookieKey ? await authenticateKey(repos.db, cookieKey) : null;
    }
    return auth;
  };

  app.get("/api/integrations", async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await resolveAuth(request);
    if (!auth) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const activity = await integrationActivity(repos.db, auth.user.id);
    return {
      base_url: publicBaseUrl(request),
      plugin_marketplace: pluginMarketplace(env),
      integrations: activity.map((a) => ({ id: a.id, last_at: a.lastAt, runs_24h: a.runs24h })),
    };
  });

  app.get("/ui/integrations", async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await resolveAuth(request);
    if (!auth) {
      return reply.redirect("/ui/login");
    }
    const base = publicBaseUrl(request);
    const shellDefault: Shell = /windows/i.test(String(request.headers["user-agent"] ?? "")) ? "powershell" : "posix";
    const activity = new Map((await integrationActivity(repos.db, auth.user.id)).map((a) => [a.id, a]));
    const body = `<style>${STYLE}</style>
      <div class="page-head"><div><h1>Integrations</h1><p class="page-sub">Connect your tools to this instance at <span class="mono">${escapeHtml(base)}</span>. Each integration gets its own API key, so you can revoke it on its own under API Keys.</p></div></div>
      <div class="int-page" data-shell="${shellDefault}">
        ${shellToggle(shellDefault)}
        <div class="int-grid">${cards(base, pluginMarketplace(env)).map((card) => cardHtml(card, activity.get(card.id))).join("")}</div>
      </div>
      ${script()}`;
    return reply.type("text/html").send(pages.page("Integrations", body, "integrations", auth.user));
  });
}
