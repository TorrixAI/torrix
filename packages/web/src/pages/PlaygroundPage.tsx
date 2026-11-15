import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { createParser } from "eventsource-parser";
import { api, compact, fmtUsd, type RunPage } from "../api";
import { InlineSelect, PageHead } from "../components";
import {
  CONV_KEY,
  buildBody,
  chunkText,
  describeError,
  formatTools,
  geminiEndpoint,
  plainResponseText,
  readPrefs,
  readProviderId,
  resolvePrefs,
  resolveProviderId,
  streamTools,
  writePrefs,
  writeProviderId,
  type ChatTurn,
  type PlaygroundPrefs,
  type PlaygroundProvider,
  type ToolState,
} from "./playgroundUtil";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string;
  runId?: string;
  tools?: string;
  error?: boolean;
  streaming?: boolean;
}

function newSessionId(): string {
  return `pg-${crypto.randomUUID()}`;
}

export default function PlaygroundPage() {
  const torrixKey = localStorage.getItem("torrix_key") ?? "";
  const metaQuery = useQuery({ queryKey: ["playground-meta"], queryFn: () => api<{ providers: PlaygroundProvider[] }>("/api/playground/meta") });

  const [providerId, setProviderId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [stream, setStream] = useState(true);
  const [compare, setCompare] = useState(false);
  const [modelB, setModelB] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState(newSessionId);
  const [sessionNote, setSessionNote] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const trackRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<ChatTurn[]>([]);
  // Mirrors the three connection fields so an edit can be saved without waiting
  // for a render, and so a save never races the provider switch that caused it.
  const prefsRef = useRef<PlaygroundPrefs>({ baseUrl: "", apiKey: "", model: "" });

  const providers = metaQuery.data?.providers ?? [];
  const provider = useMemo(() => providers.find((item) => item.id === providerId) ?? providers[0] ?? null, [providers, providerId]);

  // Restore a saved conversation and any ?prompt seed once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CONV_KEY);
      if (raw) {
        const conv = JSON.parse(raw) as { sessionId?: string; history?: ChatTurn[] };
        if (conv?.sessionId && Array.isArray(conv.history) && conv.history.length) {
          setSessionId(conv.sessionId);
          historyRef.current = conv.history;
          setMessages(conv.history.map((turn) => ({ id: crypto.randomUUID(), role: turn.role === "user" ? "user" : "assistant", content: String(turn.content ?? "") })));
        }
      }
    } catch {
      // ignore malformed storage
    }
    const seed = new URLSearchParams(window.location.search).get("prompt");
    if (seed) setInput(seed);
    setHydrated(true);
  }, []);

  // Reopen on the provider used last time, once the catalog is available.
  useEffect(() => {
    if (!providers.length || providerId) return;
    setProviderId(resolveProviderId(providers, readProviderId()));
  }, [providers, providerId]);

  // Load the remembered connection for this provider, falling back to its
  // defaults. Keyed on the id alone: a catalog refetch must not reload (and so
  // wipe) the fields the user is editing.
  useEffect(() => {
    if (!provider) return;
    const resolved = resolvePrefs(provider, readPrefs(provider.id));
    prefsRef.current = resolved;
    setBaseUrl(resolved.baseUrl);
    setApiKey(resolved.apiKey);
    setModel(resolved.model);
    setModelB(resolved.model);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the provider id changes
  }, [provider?.id]);

  // Persist an edit immediately, so a provider switch never discards it.
  const applyPrefs = (patch: Partial<PlaygroundPrefs>) => {
    const next = { ...prefsRef.current, ...patch };
    prefsRef.current = next;
    if (patch.baseUrl !== undefined) setBaseUrl(patch.baseUrl);
    if (patch.apiKey !== undefined) setApiKey(patch.apiKey);
    if (patch.model !== undefined) setModel(patch.model);
    if (provider) writePrefs(provider.id, next);
  };

  const chooseProvider = (next: string) => {
    setProviderId(next);
    writeProviderId(next);
  };

  useEffect(() => {
    if (trackRef.current) trackRef.current.scrollTop = trackRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => { if (compare && !modelB && model) setModelB(model); }, [compare, modelB, model]);

  useEffect(() => { if (!sessionNote) setSessionNote(`session · ${sessionId.slice(0, 12)}`); }, [sessionId, sessionNote]);

  const refreshSessionStats = async (id: string) => {
    try {
      const data = await api<RunPage>(`/api/runs?session=${encodeURIComponent(id)}&limit=50`);
      let cost = 0, tokens = 0;
      for (const run of data.runs) { cost += Number(run.cost_usd || 0); tokens += (run.input_tokens ?? 0) + (run.output_tokens ?? 0); }
      setSessionNote(`session · ${id.slice(0, 12)} · ${data.runs.length} turn${data.runs.length === 1 ? "" : "s"} · ${compact(tokens)} tokens · ${fmtUsd(cost)}`);
    } catch {
      // stats are best-effort
    }
  };

  const persist = (turns: ChatTurn[], id: string) => {
    try { localStorage.setItem(CONV_KEY, JSON.stringify({ sessionId: id, history: turns })); } catch { /* quota */ }
  };

  const updateMessage = (id: string, patch: Partial<ChatMessage>) => setMessages((prev) => prev.map((message) => (message.id === id ? { ...message, ...patch } : message)));

  const runTurn = async (turnModel: string, messageId: string, turns: ChatTurn[]): Promise<string> => {
    if (!provider) return "";
    const useStream = stream;
    const endpoint = provider.format === "gemini" ? geminiEndpoint(provider.endpoint, useStream) : provider.endpoint;
    const target = `${baseUrl.trim().replace(/[/]+$/, "")}${endpoint.replace("{model}", encodeURIComponent(turnModel))}`;
    const body = buildBody(provider, turnModel, turns, temperature, systemPrompt, { stream: useStream });
    const streaming = useStream;
    const headers: Record<string, string> = {
      authorization: `Bearer ${torrixKey}`,
      "content-type": "application/json",
      "x-target-url": target,
      "x-torrix-provider": provider.id === "custom" ? "openai" : provider.id,
      "x-torrix-source": "playground",
      "x-torrix-session": sessionId,
      "x-torrix-name": `Playground · ${turnModel}`,
      "x-torrix-tags": `tool=playground,provider=${provider.id}`,
    };
    if (provider.auth === "bearer") headers["x-upstream-authorization"] = `Bearer ${apiKey.trim()}`;
    else if (provider.auth === "x-api-key") { headers["x-api-key"] = apiKey.trim(); headers["anthropic-version"] = "2023-06-01"; }
    else headers["x-goog-api-key"] = apiKey.trim();

    setStatus(`calling ${turnModel}…`);
    let response: Response;
    try {
      response = await fetch("/proxy", { method: "POST", headers, body: JSON.stringify(body) });
    } catch (error) {
      updateMessage(messageId, { content: `Request failed: ${(error as Error).message}`, error: true, streaming: false });
      setStatus("");
      return "";
    }
    const runId = response.headers.get("x-torrix-run-id") || "";
    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      let bodyJson: unknown = raw;
      try { bodyJson = JSON.parse(raw) as unknown; } catch { /* non-JSON upstream error */ }
      updateMessage(messageId, { content: describeError(bodyJson, response.status), error: true, streaming: false, runId: runId || undefined });
      setStatus(runId ? `logged · ${runId.slice(0, 12)}` : "");
      return "";
    }
    setStatus(runId ? `logged · ${runId.slice(0, 12)}` : "");

    let accumulated = "";
    const contentType = response.headers.get("content-type") ?? "";
    const isSse = Boolean(streaming && response.body && !contentType.includes("application/json"));
    if (isSse && response.body) {
      const tools: ToolState = {};
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = createParser({
        onEvent: (event) => {
          const payload = event.data?.trim();
          if (!payload || payload === "[DONE]") return;
          let chunk: Record<string, unknown>;
          try { chunk = JSON.parse(payload) as Record<string, unknown>; } catch { return; }
          const text = chunkText(chunk);
          if (text) { accumulated += text; updateMessage(messageId, { content: accumulated }); }
          if (streamTools(chunk, tools)) updateMessage(messageId, { tools: formatTools(tools) });
        },
      });
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
    } else {
      const bodyJson = await response.json().catch(() => ({}));
      accumulated = plainResponseText(provider, bodyJson);
    }
    updateMessage(messageId, { content: accumulated, streaming: false, runId: runId || undefined });
    return accumulated;
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy || !provider) return;
    const primary = model.trim() || provider.models[0] || "";
    // Remember the model that was actually used, even when the box was empty.
    const saved = { ...prefsRef.current, model: primary };
    prefsRef.current = saved;
    writePrefs(provider.id, saved);
    const baseTurns: ChatTurn[] = [...historyRef.current, { role: "user", content: text }];
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", content: text }]);
    setInput("");
    setBusy(true);
    const models = [primary];
    if (compare) {
      const second = modelB.trim();
      if (second && second !== primary) models.push(second);
    }
    let primaryReply = "";
    try {
      for (const [index, turnModel] of models.entries()) {
        const id = crypto.randomUUID();
        setMessages((prev) => [...prev, { id, role: "assistant", content: "", model: models.length > 1 ? turnModel : undefined, streaming: true }]);
        const reply = await runTurn(turnModel, id, baseTurns);
        if (index === 0) primaryReply = reply;
      }
    } finally {
      setBusy(false);
      const nextHistory = primaryReply ? [...baseTurns, { role: "assistant" as const, content: primaryReply }] : baseTurns;
      historyRef.current = nextHistory;
      persist(nextHistory, sessionId);
      void refreshSessionStats(sessionId);
    }
  };

  const newChat = () => {
    const id = newSessionId();
    historyRef.current = [];
    setMessages([]);
    setSessionId(id);
    setSessionNote(`new session · ${id.slice(0, 12)}`);
    setStatus("");
    try { localStorage.removeItem(CONV_KEY); } catch { /* quota */ }
  };

  const noKey = !torrixKey;
  const hint = noKey ? "Sign in from the login page first." : metaQuery.isError ? "Could not load providers." : "";

  return <>
    <PageHead title="Playground" sub="Chat against any provider: every turn is recorded as a run" />
    <div className="pg-layout">
      <div className="pg-rail">
        <section className="panel">
          <div className="panel-head"><div className="panel-title"><span className="sig" />Connection</div></div>
          <div className="panel-body">
            <div className="field"><label htmlFor="pg-provider">Provider</label>
              <InlineSelect id="pg-provider" value={provider?.id ?? ""} onValueChange={chooseProvider} options={providers.map((item) => ({ value: item.id, label: item.label }))} placeholder="Loading…" />
            </div>
            <div className="field"><label htmlFor="pg-base">Base URL</label>
              <Input id="pg-base" type="text" autoComplete="off" placeholder="https://api.openai.com/v1" value={baseUrl} onChange={(event) => applyPrefs({ baseUrl: event.target.value })} />
            </div>
            <div className="field"><label htmlFor="pg-key">Provider API key</label>
              <Input id="pg-key" type="password" autoComplete="off" spellCheck={false} placeholder={provider?.auth === "x-api-key" ? "x-api-key…" : provider?.auth === "x-goog-api-key" ? "x-goog-api-key…" : "sk-…"} value={apiKey} onChange={(event) => applyPrefs({ apiKey: event.target.value })} />
            </div>
            <div className="field"><label htmlFor="pg-model">Model</label>
              <Input id="pg-model" type="text" list="pg-models" autoComplete="off" placeholder="model name" value={model} onChange={(event) => applyPrefs({ model: event.target.value })} />
              <datalist id="pg-models">{(provider?.models ?? []).map((name) => <option key={name} value={name} />)}</datalist>
            </div>
            <div className="field"><label id="pg-temp-label">Temperature</label>
              <div className="temp-row"><Slider aria-labelledby="pg-temp-label" className="flex-1" min={0} max={1} step={0.05} value={[temperature]} onValueChange={([next]) => setTemperature(next ?? 0)} /><span className="temp-val">{temperature.toFixed(2)}</span></div>
            </div>
            <div className="field"><label htmlFor="pg-system">System prompt</label>
              <Textarea id="pg-system" spellCheck={false} aria-label="System prompt" placeholder="You are a helpful assistant." value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} />
            </div>
            <Button variant="outline" type="button" style={{ width: "100%" }} onClick={newChat}>New chat</Button>
          </div>
        </section>
      </div>

      <section className="panel pg-chat">
        <div className="panel-head"><div className="panel-title"><span className="sig" />Conversation</div><span className="panel-note">{sessionNote}</span></div>
        <div className="pg-track" ref={trackRef}>
          {!hydrated || messages.length === 0 ? <div className="pg-empty">Say something to start a conversation. Each turn is logged to <Link to="/ui/runs">Runs</Link> as source <b>playground</b> and tagged with its session.</div> : messages.map((message) => (
            <div key={message.id} className={`pg-msg ${message.role}${message.error ? " error" : ""}${message.streaming ? " cursor" : ""}`}>
              <div className="pg-av">{message.role === "user" ? "You" : "AI"}</div>
              <div className="pg-bubble">
                {message.model ? <span className="pg-run">{message.model}</span> : null}
                <span>{message.content}</span>
                {message.tools ? <pre className="pg-tools">{message.tools}</pre> : null}
                {message.runId ? <span className="pg-run">run {message.runId.slice(0, 8)}</span> : null}
              </div>
            </div>
          ))}
        </div>
        <div className="pg-input">
          <div className="pg-input-row">
            <Textarea id="pg-input" aria-label="Message" placeholder="Type a message… press Enter to send" disabled={noKey} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} />
            <Button type="button" disabled={busy || noKey || !provider} onClick={() => void send()}>{busy ? "Sending…" : "Send"}</Button>
          </div>
          <div className="pg-foot" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div className="flex items-center gap-2"><Checkbox id="cb-5" checked={compare} onCheckedChange={(value) => setCompare(value === true)} /><label htmlFor="cb-5" className="text-[13px] text-text-2">Compare</label></div>
            <div className="flex items-center gap-2"><Checkbox id="cb-stream" checked={stream} onCheckedChange={(value) => setStream(value === true)} /><label htmlFor="cb-stream" className="text-[13px] text-text-2">Stream</label></div>
            {compare ? <Input type="text" list="pg-models" aria-label="Comparison model" placeholder="second model" autoComplete="off" className="max-w-[190px]" value={modelB} onChange={(event) => setModelB(event.target.value)} /> : null}
            <span className="pg-status">{status}</span>
            <span className="pg-status">{hint}</span>
          </div>
        </div>
      </section>
    </div>
  </>;
}
