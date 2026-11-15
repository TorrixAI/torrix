import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { api, compact, fmtMs, fmtUsd, userPrompt, type CostComparisonRow, type Judgment, type MediaAsset, type RunDetail, type RunEvent } from "../api";
import { formatCount, formatDate, formatDateTime } from "../api";
import { z } from "zod";
import { EmptyRow, ErrorText, EvidenceChip, Field, Modal, Panel } from "../components";
import { FormModal, TextField, useZodForm } from "../form";
import { LockedNotice, useFeature } from "../features";
import { useToast } from "../toast";
import { downloadFile } from "../download";
import { conversationAnswer, displayText, toolStep } from "../lib/conversation";

function parseArray<T>(value: string | null | undefined): T[] {
  if (!value) return [];
  try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? (parsed as T[]) : []; } catch { return []; }
}
function flag(value: number | boolean | null | undefined): boolean { return value === true || value === 1; }
function pretty(value: string | null | undefined): string {
  if (!value) return "";
  try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
}

export default function RunDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const toast = useToast();
  const runQuery = useQuery({ queryKey: ["run", id], queryFn: () => api<RunDetail>(`/api/runs/${encodeURIComponent(id)}`) });
  const eventQuery = useQuery({ queryKey: ["run-events", id], queryFn: () => api<{ events: RunEvent[] }>(`/api/runs/${encodeURIComponent(id)}/events`) });
  const [note, setNote] = useState("");
  const [scoreNote, setScoreNote] = useState("");
  const [judgeCriteria, setJudgeCriteria] = useState("");
  const [shareInfo, setShareInfo] = useState<{ path: string; expires_at: string | null } | null>(null);
  const [showCost, setShowCost] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const run = runQuery.data;
  useEffect(() => { setNote(run?.run_note ?? ""); setScoreNote(run?.score_note ?? ""); }, [run?.run_note, run?.score_note]);
  useEffect(() => { if (run?.share_token) setShareInfo({ path: `/share/${run.share_token}`, expires_at: run.share_expires_at ?? null }); }, [run?.share_token, run?.share_expires_at]);

  const refresh = () => { void client.invalidateQueries({ queryKey: ["run", id] }); void client.invalidateQueries({ queryKey: ["run-events", id] }); };
  const patch = useMutation({ mutationFn: (body: Record<string, unknown>) => api<{ run: RunDetail }>(`/api/runs/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }), onSuccess: (data) => client.setQueryData(["run", id], data.run) });
  const replay = useMutation({
    mutationFn: () => api<{ run_id: string }>(`/api/runs/${encodeURIComponent(id)}/replay`, { method: "POST", body: "{}" }),
    onSuccess: (data) => { toast.toast("Replayed into a new run.", { type: "success", action: { label: "Open", onClick: () => navigate(`/ui/runs/${data.run_id}`) } }); },
    onError: (error: Error) => toast.toast(error.message, { type: "error" }),
  });
  const share = useMutation({ mutationFn: () => api<{ path: string; expires_at: string | null }>(`/api/runs/${encodeURIComponent(id)}/share`, { method: "POST", body: "{}" }), onSuccess: (data) => { setShareInfo(data); void refresh(); } });
  const unshare = useMutation({ mutationFn: () => api(`/api/runs/${encodeURIComponent(id)}/share`, { method: "DELETE" }), onSuccess: () => { setShareInfo(null); void refresh(); } });
  const judge = useMutation({ mutationFn: () => api<{ judgment: Judgment }>(`/api/runs/${encodeURIComponent(id)}/judge`, { method: "POST", body: JSON.stringify({ criteria: judgeCriteria || undefined, apply: false }) }), onSuccess: () => void refresh(), onError: (error: Error) => toast.toast(error.message, { type: "error" }) });
  const { allowed: judgeAllowed } = useFeature("judge");
  const { allowed: ledgerAllowed } = useFeature("agent-control");
  const ledgerQuery = useQuery({
    queryKey: ["run-ledger", id],
    queryFn: () => api<{ entries: Array<{ id: string }> }>(`/api/v1/ledger?run_id=${encodeURIComponent(id)}&limit=1`),
    enabled: ledgerAllowed && Boolean(id),
    retry: false,
  });
  const ledgerEntry = ledgerQuery.data?.entries?.[0];
  const costQuery = useQuery({ queryKey: ["cost-comparison", id], queryFn: () => api<{ current_model: string | null; current_cost_usd: number; models: CostComparisonRow[] }>(`/api/runs/${encodeURIComponent(id)}/cost-comparison`), enabled: showCost });
  const removeRun = useMutation({ mutationFn: () => api(`/api/runs/${encodeURIComponent(id)}`, { method: "DELETE" }), onSuccess: () => navigate("/ui/runs") });

  const copy = (text: string) => { void navigator.clipboard?.writeText(text); toast.toast("Copied to clipboard.", { type: "success", duration: 2000 }); };

  const events = eventQuery.data?.events ?? [];

  // Breadcrumb and the previous/next stepper inside a trace: the group payload is
  // ordered oldest first, so the position is stable across refreshes.
  const traceQuery = useQuery({
    queryKey: ["run-trace-nav", id, run?.trace_id],
    queryFn: () => api<{ runs: RunDetail[] }>(`/api/runs/group/trace/${encodeURIComponent(run?.trace_id ?? "")}?limit=200&descendants=0`),
    enabled: Boolean(run?.trace_id),
  });
  const traceRuns = [...(traceQuery.data?.runs ?? [])].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const traceIndex = traceRuns.findIndex((entry) => entry.id === id);
  const previousRun = traceIndex > 0 ? traceRuns[traceIndex - 1] : null;
  const nextRun = traceIndex >= 0 && traceIndex < traceRuns.length - 1 ? traceRuns[traceIndex + 1] : null;
  const traceRoot = traceRuns.find((entry) => !entry.parent_run_id) ?? traceRuns[0] ?? null;
  const requestText = useMemo(() => (
    userPrompt(run?.request_body)
    ?? events.find((event) => event.type === "request" || event.type === "prompt")?.message
    ?? ""
  ), [run?.request_body, events]);

  if (runQuery.isPending || eventQuery.isPending) return <div className="startup loading-page"><span>Loading run…</span></div>;
  if (runQuery.isError) return <div className="empty mt-6.5"><span className="empty-title">Run not found</span><span className="empty-sub">{runQuery.error.message}</span></div>;
  if (eventQuery.isError) return <div className="empty mt-6.5"><span className="empty-title">Could not load events</span><span className="empty-sub">{eventQuery.error.message}</span></div>;
  if (!run) return null;

  const failed = !!run.status && run.status >= 400;
  const totalTokens = (run.input_tokens ?? 0) + (run.output_tokens ?? 0);
  const inputPct = totalTokens > 0 ? ((run.input_tokens ?? 0) / totalTokens) * 100 : 50;
  const thinking = events.filter((event) => event.type === "thinking");
  const toolCalls = events.filter((event) => event.type === "tool_call");
  const timeline = events.filter((event) => event.type !== "thinking" && event.type !== "tool_call");
  const retrieval = parseArray<Record<string, unknown>>(run.retrieval_docs);
  const media = parseArray<MediaAsset>(run.media_assets);
  const children = run.children ?? [];
  const judgments = run.judgments ?? [];
  const firstEventAt = events.length ? Date.parse(events[0].created_at) : 0;
  const answer = conversationAnswer(events, run.error);
  const prompt = requestText || "No prompt captured.";

  const metadataGroups = [
    {
      name: "Identity",
      cells: [
        ["Run ID", run.id],
        ["Created", formatDateTime(run.created_at)],
        ["Agent", run.agent_name ?? ""],
        ["End user", run.end_user_id ?? ""],
        ["Trace", run.trace_id ?? ""],
        ["Session", run.session_id ?? ""],
        ["Parent run", run.parent_run_id ?? ""],
      ],
    },
    {
      name: "Tokens",
      cells: [
        ["Input tokens", formatCount(run.input_tokens ?? 0)],
        ["Output tokens", formatCount(run.output_tokens ?? 0)],
        ["Thinking tokens", formatCount(run.thinking_tokens ?? 0)],
        ["Total tokens", formatCount(totalTokens)],
      ],
    },
    {
      name: "Routing",
      cells: [
        ["Routing", run.routed_from ? `${run.routed_from} → ${run.model ?? "?"}` : ""],
        ["Fallback used", flag(run.fallback_used) ? "yes" : ""],
        ["Target", run.target_url ?? ""],
      ],
    },
    {
      name: "Context",
      cells: [
        ["Retrieval docs", retrieval.length ? String(retrieval.length) : ""],
        ["Media", run.media_count ? String(run.media_count) : ""],
        ["Anomaly", flag(run.is_anomaly) ? "yes" : ""],
      ],
    },
  ]
    .map((group) => ({ ...group, cells: group.cells.filter(([, value]) => value !== "" && value !== "-") }))
    .filter((group) => group.cells.length > 0);

  const judgeLatest = judgments[0];

  return <>
    <div className="rd-links"><Link className="back-link" to="/ui/runs">← Back to runs</Link></div>
    {run.trace_id ? <div className="rd-breadcrumb">
      <Link to={`/ui/traces/${encodeURIComponent(run.trace_id)}`} className="rd-bc-trace mono">{run.trace_id.slice(0, 12)}</Link>
      {traceRoot && traceRoot.id !== run.id ? <>
        <span className="rd-bc-sep">›</span>
        <Link to={`/ui/runs/${traceRoot.id}`} className="rd-bc-step">{traceRoot.name || traceRoot.id.slice(0, 8)}</Link>
      </> : null}
      <span className="rd-bc-sep">›</span>
      <span className="rd-bc-step current">{run.name || run.id.slice(0, 8)}</span>
      {traceIndex >= 0 ? <span className="rd-bc-note">{traceIndex + 1} of {traceRuns.length} in trace</span> : null}
      <span className="rd-bc-nav">
        {previousRun ? <Link className={buttonVariants({ variant: "ghost" })} to={`/ui/runs/${previousRun.id}`}>← Previous</Link> : null}
        {nextRun ? <Link className={buttonVariants({ variant: "ghost" })} to={`/ui/runs/${nextRun.id}`}>Next →</Link> : null}
      </span>
    </div> : null}
    <div className="run-head">
      <div>
        <h1 className="rh-title">{run.name || run.model || "Run detail"}</h1>
        <div className="rh-chips">
          <span className={`badge ${failed ? "bad" : "good"}`}><span className="dot" />{failed ? `${run.status} failed` : `${run.status || 200} succeeded`}</span>
          {run.provider ? <span className="chip">{run.provider}</span> : null}
          <span className="chip">{run.model || "unknown model"}</span>
          <span className="chip">{run.source || "direct"}</span>
          {flag(run.is_anomaly) ? <span className="badge warn"><span className="dot" />anomaly</span> : null}
          {run.score === 1 ? <span className="badge good">good</span> : run.score === 0 ? <span className="badge bad">bad</span> : null}
          {flag(run.is_golden) ? <span className="badge accent"><span className="dot" />golden</span> : null}
          {run.review_state ? <span className="chip">review: {run.review_state}</span> : null}
          {flag(run.pii_masked) ? <span className="chip">PII masked</span> : null}
          {parseArray(run.policy_flags).length ? <span className="badge warn">policy ×{parseArray(run.policy_flags).length}</span> : null}
          {run.share_token ? <span className="badge accent">shared</span> : null}
          {ledgerEntry ? <EvidenceChip id={ledgerEntry.id} href={`/api/v1/ledger/${ledgerEntry.id}/bundle`} label="evidence" /> : null}
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="outline" type="button" aria-label="Run actions">More</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => copy(run.id)}>Copy run id</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setCompareOpen(true)}>Compare with another run</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>Delete run</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <div className="detail-metrics" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 0, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", overflow: "hidden", marginBottom: 14 }}>
      <DetailMetric label="Cost" value={fmtUsd(run.cost_usd)} />
      <DetailMetric label="Latency" value={fmtMs(run.latency_ms)} />
      <DetailMetric label="Tokens" value={compact(totalTokens)} />
      <DetailMetric label="Events" value={String(events.length)} />
    </div>

    <div className="tok-split" title={`input ${run.input_tokens ?? 0} · output ${run.output_tokens ?? 0}`}><span className="in" style={{ width: `${inputPct}%` }} /><span className="out" style={{ width: `${100 - inputPct}%` }} /></div>
    <div className="tok-legend"><span>input {compact(run.input_tokens)}</span><span>output {compact(run.output_tokens)}</span></div>

    {(run.parent_run_id || run.trace_id || run.session_id) ? <div className="run-links">
      {run.parent_run_id ? <Link className="quiet-link" to={`/ui/runs/${run.parent_run_id}`}>Parent run</Link> : null}
      {run.trace_id ? <Link className="quiet-link" to={`/ui/traces/${encodeURIComponent(run.trace_id)}`}>Open trace</Link> : null}
      {run.session_id ? <Link className="quiet-link" to={`/ui/sessions/${encodeURIComponent(run.session_id)}`}>Open session</Link> : null}
    </div> : null}

    <Panel title="Conversation" note="what the user asked and what came back">
      <div className="conversation" data-test="conversation">
        <div className="conv-block"><span className="meta-label">User</span><p className="conv-text">{prompt}</p></div>
        <div className="conv-block"><span className="meta-label">Assistant</span><p className="conv-text">{answer}</p></div>
      </div>
    </Panel>

    {thinking.length ? <Panel title="Reasoning" note={`${thinking.length} segment${thinking.length === 1 ? "" : "s"} · ${compact(run.thinking_tokens)} thinking tokens`}>
      <pre className="rd-code">{displayText(thinking.map((event) => event.message).join("\n\n"))}</pre>
    </Panel> : null}

    {toolCalls.length ? <Panel title="Tool calls" note={`${toolCalls.length} call${toolCalls.length === 1 ? "" : "s"}`}>
      <div className="tool-calls">
        {toolCalls.map((event, index) => {
          const step = toolStep(event.message);
          return <div className="tool-call" key={event.id ?? index}>
            <div className="tool-call-head"><span className="chip">{step.name}</span>{step.detail ? <span className="panel-note">{step.detail}</span> : null}</div>
            <details className="tool-call-raw"><summary>Raw tool payload</summary><pre className="rd-code">{pretty(event.message)}</pre></details>
          </div>;
        })}
      </div>
    </Panel> : null}

    <details className="panel raw-panel" data-test="raw-request">
      <summary className="panel-head"><span className="panel-title">Raw request</span><span className="panel-note">stored JSON, collapsed</span></summary>
      <div className="panel-body"><pre className="rd-code">{run.request_body ? pretty(run.request_body).slice(0, 20000) : "No request body captured."}</pre></div>
    </details>
    <details className="panel raw-panel" data-test="raw-response">
      <summary className="panel-head"><span className="panel-title">Raw response</span><span className="panel-note">captured output, collapsed</span></summary>
      <div className="panel-body">{events.some((event) => event.type === "response") ? <pre className="rd-code">{events.filter((event) => event.type === "response").map((event) => event.message).join("\n\n").slice(0, 40000)}</pre> : <div className="empty-value"><p>No response recorded.</p><span className="field-hint">Capture the next call to see the answer here.</span></div>}</div>
    </details>

    <Panel title="Metadata" actions={<Button variant="outline" type="button" onClick={() => copy(run.id)}>Copy run id</Button>}>
      {metadataGroups.map((group) => <div className="meta-group" data-meta-group={group.name} key={group.name}>
        <div className="meta-label">{group.name}</div>
        <div className="metagrid mb-0">
          {group.cells.map(([label, value]) => <div className="cell" key={label}><span className="meta-label">{label}</span><div className="meta-val mono" title={value}>{value}</div></div>)}
        </div>
      </div>)}
    </Panel>

    <Panel title="Review & notes" note={run.score === 1 ? "scored good" : run.score === 0 ? "scored bad" : "unscored"}>
      <div className="action-row">
        <Button variant="outline" type="button" onClick={() => patch.mutate({ score: 1 })}>Mark good</Button>
        <Button variant="outline" type="button" onClick={() => patch.mutate({ score: 0 })}>Mark bad</Button>
        <Button variant="outline" type="button" disabled={run.score == null} onClick={() => patch.mutate({ score: null })}>Clear score</Button>
        <Button variant="outline" type="button" onClick={() => patch.mutate({ is_golden: !flag(run.is_golden) })}>{flag(run.is_golden) ? "Unmark golden" : "Mark golden"}</Button>
      </div>
      <div className="action-row mt-2">
        <Button variant="outline" type="button" disabled={replay.isPending} onClick={() => replay.mutate()}>Replay</Button>
        <Button variant="outline" type="button" onClick={() => setShowCost((value) => !value)}>Cost comparison</Button>
        <Button variant="outline" type="button" onClick={() => setCompareOpen(true)}>Compare</Button>
        <Link className={buttonVariants({ variant: "outline" })} to={`/ui/playground?prompt=${encodeURIComponent(requestText.slice(0, 500))}`}>Open in Playground</Link>
        {flag(run.is_golden) ? <Button variant="outline" type="button" onClick={() => void downloadFile("/api/runs/golden/export", "torrix-golden.jsonl")}>Export golden JSONL</Button> : null}
      </div>
      <div className="action-row mt-2">
        <Button variant="outline" type="button" disabled={share.isPending} onClick={() => share.mutate()}>{shareInfo ? "Regenerate share link" : "Create share link"}</Button>
        {shareInfo ? <Button variant="outline" type="button" disabled={unshare.isPending} onClick={() => unshare.mutate()}>Revoke share</Button> : null}
        {shareInfo ? <Button variant="outline" type="button" onClick={() => copy(`${window.location.origin}${shareInfo.path}`)}>Copy share URL</Button> : null}
      </div>
      {shareInfo ? <p className="rd-share"><code>{window.location.origin}{shareInfo.path}</code>{shareInfo.expires_at ? ` · expires ${formatDate(shareInfo.expires_at)}` : ""}</p> : null}
      <div className="rd-form">
        <label>Score note</label>
        <Input value={scoreNote} maxLength={500} placeholder="Why this score" aria-label="Score note" onChange={(event) => setScoreNote(event.target.value)} />
        <label>Run note</label>
        <Textarea value={note} rows={3} maxLength={4000} placeholder="Add context for your team…" aria-label="Run note" onChange={(event) => setNote(event.target.value)} />
      </div>
      <div className="action-row mt-2.5">
        <Button variant="outline" type="button" disabled={patch.isPending} onClick={() => patch.mutate({ run_note: note, score_note: scoreNote })}>Save notes</Button>
      </div>
      {parseArray(run.pii_findings).length ? <div className="rd-findings"><b>PII findings:</b> {parseArray<{ type?: string }>(run.pii_findings).map((finding) => finding.type).filter(Boolean).join(", ")}</div> : null}
      {parseArray(run.policy_flags).length ? <div className="rd-findings"><b>Policy flags:</b> {parseArray<{ policy?: string; action?: string }>(run.policy_flags).map((flagItem) => flagItem.policy || flagItem.action).filter(Boolean).join(", ")}</div> : null}
    </Panel>

    <Panel flush title="Subagent runs" note={`${children.length} child run${children.length === 1 ? "" : "s"}`}>
      <div className="table-wrap"><table>
        <thead><tr><th>Time</th><th>Run</th><th>Agent</th><th>Model</th><th className="num">Cost</th><th>Status</th></tr></thead>
        <tbody>
          {children.length ? children.map((child) => <tr key={child.id} className="clickable">
            <td className="tcell-muted tnum">{formatDateTime(child.created_at)}</td>
            <td><Link className="tcell-primary" to={`/ui/runs/${child.id}`}>{child.name || child.id.slice(0, 8)}</Link></td>
            <td className="tnum">{child.agent_name || "-"}</td>
            <td className="tnum">{child.model || "-"}</td>
            <td className="num">{fmtUsd(child.cost_usd)}</td>
            <td><span className={`badge ${child.status && child.status >= 400 ? "bad" : "good"}`}><span className="dot" />{child.status ?? 200}</span></td>
          </tr>) : <EmptyRow colSpan={6}>No subagent runs.</EmptyRow>}
        </tbody>
      </table></div>
    </Panel>

    {judgeAllowed ? <Panel title="Judge" note={judgeLatest ? `latest ${judgeLatest.score != null ? `score ${judgeLatest.score}` : "error"} · ${formatDateTime(judgeLatest.created_at)}` : "no judgments yet"}>
      <Field label="Criteria (optional)"><Input value={judgeCriteria} placeholder="Correctness, helpfulness, safety…" onChange={(event) => setJudgeCriteria(event.target.value)} /></Field>
      <div className="action-row mt-2"><Button type="button" disabled={judge.isPending} onClick={() => judge.mutate()}>{judge.isPending ? "Judging…" : "Run judge"}</Button></div>
      {judgeLatest ? <div style={{ marginTop: 10, fontSize: 13, color: "var(--text-2)" }}>
        <div className="panel-note">{judgeLatest.provider} · {judgeLatest.model} · {fmtUsd(judgeLatest.cost_usd)} · {compact((judgeLatest.input_tokens ?? 0) + (judgeLatest.output_tokens ?? 0))} tokens</div>
        <p className="mt-1.5">{judgeLatest.rationale || judgeLatest.error || "No rationale."}</p>
      </div> : null}
      {judgments.length > 1 ? <div className="mt-2">
        <div className="panel-note">HISTORY</div>
        {judgments.slice(1).map((item) => <div key={item.id} style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--sans)", fontSize: 11.5, padding: "4px 0", borderBottom: "1px solid var(--line)" }}>
          <span>{item.score != null ? `score ${item.score}` : "error"}</span><span className="tcell-muted">{formatDateTime(item.created_at)}</span>
        </div>)}
      </div> : null}
    </Panel> : <LockedNotice feature="judge" label="LLM judge" />}

    {showCost ? <Panel flush title="Cost comparison" note="estimated cost of this token mix across models">
      {costQuery.isPending ? <div className="panel-body">Loading…</div> : costQuery.data ? <div className="table-wrap" style={{ maxHeight: 360, overflow: "auto" }}><table>
        <thead><tr><th>Model</th><th className="num">Estimated cost</th></tr></thead>
        <tbody>{costQuery.data.models.slice(0, 20).map((row) => <tr key={row.model} style={row.model === costQuery.data?.current_model ? { background: "var(--row-hover)" } : undefined}>
          <td className="tnum">{row.model}{row.model === costQuery.data?.current_model ? " (current)" : ""}</td>
          <td className="num">{fmtUsd(row.estimatedCost)}</td>
        </tr>)}</tbody>
      </table></div> : <div className="panel-body">Could not load comparison.</div>}
    </Panel> : null}

    {retrieval.length ? <Panel title="Retrieved context" note={`${retrieval.length} chunk${retrieval.length === 1 ? "" : "s"} sent with the request`}>
      <div className="rd-docs">{retrieval.map((doc, index) => {
        const text = String(doc.text ?? doc.content ?? doc.chunk ?? doc.page_content ?? JSON.stringify(doc));
        const source = doc.source ?? doc.title ?? doc.url ?? doc.id ?? null;
        const score = doc.score ?? doc.relevance ?? doc.similarity ?? null;
        return <div className="rd-doc" key={index}>
          <div className="rd-doc-head"><span className="rd-doc-idx">#{index + 1}</span>{source != null ? <span className="chip chip-mono">{String(source).slice(0, 56)}</span> : null}{score != null ? <span className="score-badge none">{String(score)}</span> : null}</div>
          <div className="rd-doc-text">{text.slice(0, 700)}</div>
        </div>;
      })}</div>
    </Panel> : null}

    {media.length ? <Panel title="Media assets" note={`${media.length} part${media.length === 1 ? "" : "s"} · stored on this host`}>
      <div className="rd-docs">{media.map((asset, index) => {
        const href = `/ui/runs/${encodeURIComponent(run.id)}/media/${index}`;
        const stored = asset.stored_path != null;
        const preview = !stored ? null : asset.kind === "image"
          ? <div className="media-preview"><a href={href} target="_blank" rel="noopener"><img className="media-thumb" src={href} alt={asset.mime ?? "image"} loading="lazy" /></a></div>
          : asset.kind === "audio" ? <div className="media-preview"><audio className="media-audio" controls preload="none" src={href} /></div>
            : <div className="media-preview"><a className={buttonVariants({ variant: "outline" })} href={href} target="_blank" rel="noopener">Open {asset.kind}</a></div>;
        return <div className="rd-doc" key={index}>
          <div className="rd-doc-head"><span className="rd-doc-idx">#{index + 1}</span><span className="chip chip-mono">{asset.kind}</span><span className="chip chip-mono">{asset.mime ?? "unknown"}</span>{asset.bytes ? <span className="chip chip-mono">{asset.bytes} B</span> : null}{stored ? null : <span className="chip" title="Remote reference only; bytes were not downloaded">remote</span>}</div>
          {preview}
          <div className="rd-doc-text">sha256 {String(asset.sha256 ?? "").slice(0, 24)}…{stored ? `\n${asset.stored_path}` : asset.ref ? `\n${asset.ref}` : ""}</div>
        </div>;
      })}</div>
    </Panel> : null}

    <Panel title="Events timeline" note={`${timeline.length} event${timeline.length === 1 ? "" : "s"}`}>
      {timeline.length ? <div className="timeline">{timeline.map((event, index) => <div className="t-item" key={event.id ?? `${event.type}-${index}`}>
        <span className={`t-dot ${event.type}`} />
        <div className="t-head"><span className="t-type">{event.type.replaceAll("_", " ")}</span><span className="t-time">{formatDateTime(event.created_at)}{firstEventAt ? ` · +${fmtMs(Math.max(0, Date.parse(event.created_at) - firstEventAt))}` : ""}</span><Button variant="ghost" className="ev-copy" type="button" title="Copy event" onClick={() => copy(event.message)}>⧉</Button></div>
        <div className="t-msg">{event.message || "(empty)"}</div>
      </div>)}</div> : <div className="empty"><span className="empty-title">No events</span><span className="empty-sub">This run captured no request or response events.</span></div>}
    </Panel>

    {compareOpen ? <CompareModal currentId={run.id} onClose={() => setCompareOpen(false)} onCompare={(other) => navigate(`/ui/compare?ids=${encodeURIComponent(`${run.id},${other}`)}`)} /> : null}
    {confirmDelete ? <Modal title="Delete run" onClose={() => setConfirmDelete(false)}>
      <p>Delete this run and its events? This cannot be undone.</p>
      {removeRun.isError ? <ErrorText>{removeRun.error.message}</ErrorText> : null}
      <div className="modal-actions"><Button variant="outline" type="button" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="destructive" type="button" disabled={removeRun.isPending} onClick={() => removeRun.mutate()}>Delete</Button></div>
    </Modal> : null}
  </>;
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return <div className="detail-metric" style={{ padding: "14px 17px", borderRight: "1px solid var(--line)" }}><span>{label}</span><strong>{value}</strong></div>;
}

const compareSchema = z.object({ other: z.string().trim().min(1, "Enter a run id") });
type CompareValues = z.infer<typeof compareSchema>;

function CompareModal({ currentId, onClose, onCompare }: { currentId: string; onClose: () => void; onCompare: (other: string) => void }) {
  const form = useZodForm<CompareValues>(compareSchema, { other: "" });
  return <FormModal title="Compare with another run" form={form} submitLabel="Compare" onClose={onClose} onSubmit={(values) => { if (values.other !== currentId) onCompare(values.other); }}>
    <TextField form={form} name="other" label="Other run id" placeholder="paste a run id" autoFocus />
  </FormModal>;
}
