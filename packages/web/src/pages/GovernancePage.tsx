import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { PageError, PageLoading } from "./DashboardPage";
import {
  api,
  compact,
  fmtMs,
  fmtUsd,
  type AuditEntry,
  type ExportConfig,
  type GovernanceSettings,
  type Policy,
  type ReviewItem,
  type RoutingRule,
  type SiemDestinationView,
  relTime,
  shortStamp,
  type SlmCandidate,
} from "../api";
import { formatDateTime } from "../api";
import { EmptyRow, ErrorText, Field, Modal, Notice, PageHead, Panel, SkeletonRows, clipCell, toNullableNumber } from "../components";
import { FormModal, SelectField, TextAreaField, TextField, useZodForm } from "../form";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { LockedNotice, useFeatures } from "../features";
import { badgeClass } from "./agents/shared";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { downloadFile } from "../download";
import { SecretNotice } from "../SecretNotice";
import { z } from "zod";

const TABS = [
  { id: "policies", label: "Content rules" },
  { id: "reviews", label: "Review queue" },
  { id: "routing", label: "Routing & SLM" },
  { id: "audit", label: "Audit log" },
  { id: "exports", label: "Exports" },
  { id: "siem", label: "SIEM export" },
  { id: "settings", label: "PII settings" },
] as const;

type TabId = (typeof TABS)[number]["id"];

// Paid tabs render an upgrade card when the instance lacks the feature.
const TAB_FEATURE: Partial<Record<TabId, { id: string; label: string }>> = {
  policies: { id: "policies", label: "Content rules and review queue" },
  reviews: { id: "policies", label: "Content rules and review queue" },
  routing: { id: "routing", label: "Model routing and fallback" },
  audit: { id: "audit-export", label: "Audit log export" },
  exports: { id: "external-exports", label: "S3 and GCS run exports" },
  siem: { id: "siem-export", label: "SIEM export" },
};

export default function GovernancePage() {
  const [tab, setTab] = useState<TabId>("policies");
  const { features, ready } = useFeatures();
  const overviewQuery = useQuery({
    queryKey: ["governance-overview"],
    queryFn: () => api<{ overview: { rules: number; hits: number; reviews: number; masked: number } }>("/api/governance/overview"),
  });
  const overview = overviewQuery.data?.overview;
  // Without the policy engine the default tab is an upgrade card, which hides the
  // one panel every edition gets (PII masking). Land on that instead, once.
  const settled = useRef(false);
  useEffect(() => {
    if (!ready || settled.current) return;
    settled.current = true;
    if (tab === "policies" && !features.includes("policies")) {
      setTab("settings");
    }
  }, [ready, features, tab]);
  const locked = TAB_FEATURE[tab];
  const content = !ready
    ? <PageLoading />
    : locked && !features.includes(locked.id)
      ? <LockedNotice feature={locked.id} label={locked.label} />
      : tab === "policies" ? <PoliciesSection />
        : tab === "reviews" ? <ReviewsSection />
          : tab === "routing" ? <RoutingSection />
            : tab === "audit" ? <AuditSection />
              : tab === "exports" ? <ExportsSection />
                : tab === "siem" ? <SiemSection />
                : <SettingsSection />;
  return <>
    <SecretNotice />
    <PageHead title="Governance" sub="Content rules, human review, model routing, audit trail and external exports." />
    {overview ? <div className="stat-tiles governance-stats" aria-label="Governance overview">
      <div className="stat-tile"><span className="st-label">Content rules</span><div className="st-value">{overview.rules}</div><div className="st-sub">active rules</div></div>
      <div className="stat-tile"><span className="st-label">Hits 7d</span><div className="st-value">{overview.hits}</div><div className="st-sub">policy matches</div></div>
      <div className="stat-tile"><span className="st-label">Pending reviews</span><div className="st-value">{overview.reviews}</div><div className="st-sub">awaiting a human</div></div>
      <div className="stat-tile"><span className="st-label">PII masked 7d</span><div className="st-value">{overview.masked}</div><div className="st-sub">redacted before storage</div></div>
    </div> : null}
    <Tabs value={tab} onValueChange={(value) => setTab(value as TabId)}>
      <TabsList>
        {TABS.map((item) => <TabsTrigger key={item.id} value={item.id}>{item.label}</TabsTrigger>)}
      </TabsList>
      <TabsContent value={tab} className="mt-4">{content}</TabsContent>
    </Tabs>
  </>;
}

const MATCH_KINDS = [
  { value: "keyword", hint: "Any text the request or response contains." },
  { value: "regex", hint: "A regular expression matched against the payload." },
  { value: "pii", hint: "A PII type such as email, card or ssn." },
  { value: "model", hint: "An exact model name." },
  { value: "model_not_in_list", hint: "Comma separated allow-list of models." },
  { value: "max_tokens", hint: "A token budget; flag when exceeded." },
  { value: "cost_above", hint: "A USD amount; flag when exceeded." },
];

function PoliciesSection() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["policies"], queryFn: () => api<{ policies: Policy[] }>("/api/policies") });
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Policy | null>(null);
  const invalidate = () => client.invalidateQueries({ queryKey: ["policies"] });
  const toggle = useMutation({ mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api(`/api/policies/${id}`, { method: "PATCH", body: JSON.stringify({ enabled }) }), onSuccess: () => void invalidate() });
  const remove = useMutation({ mutationFn: (id: string) => api(`/api/policies/${id}`, { method: "DELETE" }), onSuccess: () => { setConfirmDelete(null); void invalidate(); } });
  if (query.isPending) return <PageLoading />;
  if (query.isError) return <PageError message={query.error.message} />;
  const policies = query.data.policies;
  return <>
    <Panel flush title="Policies" note={`${policies.length} rules`} actions={<Button type="button" onClick={() => setCreateOpen(true)}>New policy</Button>}>
      <div className="table-wrap"><table className="policies-table">
        <thead><tr><th>Name</th><th>Match</th><th>Action</th><th>Stage</th><th>Severity</th><th className="num">Hits</th><th /></tr></thead>
        <tbody>
          {policies.length ? policies.map((policy) => <tr key={policy.id}>
            <td className="tcell-primary">{policy.name}{policy.enabled ? null : <span className="chip ml-1.5">disabled</span>}</td>
            <td className="tnum">{policy.match_kind}{policy.match_value ? `: ${policy.match_value}` : ""}</td>
            <td><span className={`badge ${policy.action === "block" ? "bad" : "warn"}`}><span className="dot" />{policy.action}</span></td>
            <td className="tnum">{policy.stage}</td>
            <td className="tnum">{policy.severity}</td>
            <td className="num">{policy.hit_count}</td>
            <td className="text-right whitespace-nowrap">
              <Button className="mr-1.5" variant="outline" type="button" disabled={toggle.isPending} onClick={() => toggle.mutate({ id: policy.id, enabled: !policy.enabled })}>{policy.enabled ? "Disable" : "Enable"}</Button>
              <Button variant="outline" type="button" onClick={() => setConfirmDelete(policy)}>Delete</Button>
            </td>
          </tr>) : <EmptyRow colSpan={7}>No policies yet.</EmptyRow>}
        </tbody>
      </table></div>
    </Panel>
    {createOpen ? <PolicyEditor onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); void invalidate(); }} /> : null}
    {confirmDelete ? <Modal title="Delete policy" onClose={() => setConfirmDelete(null)}>
      <p>Delete <b>{confirmDelete.name}</b>?</p>
      {remove.isError ? <ErrorText>{remove.error.message}</ErrorText> : null}
      <div className="modal-actions"><Button variant="outline" type="button" onClick={() => setConfirmDelete(null)}>Cancel</Button><Button variant="destructive" type="button" disabled={remove.isPending} onClick={() => remove.mutate(confirmDelete.id)}>Delete</Button></div>
    </Modal> : null}
  </>;
}

const policySchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  matchKind: z.string().trim().min(1, "Match kind is required"),
  matchValue: z.string().trim().min(1, "Match value is required"),
  action: z.enum(["flag", "block"]),
  stage: z.enum(["request", "response"]),
  severity: z.enum(["low", "medium", "high"]),
});
type PolicyValues = z.infer<typeof policySchema>;

function PolicyEditor({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const form = useZodForm<PolicyValues>(policySchema, { name: "", matchKind: "keyword", matchValue: "", action: "flag", stage: "request", severity: "medium" });
  const matchKind = form.watch("matchKind");
  const create = useMutation({
    mutationFn: (values: PolicyValues) => api("/api/policies", { method: "POST", body: JSON.stringify({ name: values.name, match_kind: values.matchKind, match_value: values.matchValue, action: values.action, stage: values.stage, severity: values.severity }) }),
    onSuccess: onSaved,
  });
  const hint = MATCH_KINDS.find((kind) => kind.value === matchKind)?.hint ?? "";
  const matchExample: Record<string, string> = {
    keyword: "social security",
    regex: "^translate",
    pii: "email",
    model: "gpt-4o-mini",
    model_not_in_list: "gpt-4o, gpt-4o-mini",
    max_tokens: "2000",
    cost_above: "0.05",
  };
  return <FormModal title="New policy" form={form} submitLabel="Create" pending={create.isPending} error={create.isError ? create.error.message : null} onClose={onClose} onSubmit={(values) => create.mutate(values)}>
    <TextField form={form} name="name" label="Name" placeholder="Block competitor mentions" autoFocus />
    <div className="grid-2-12">
      <SelectField form={form} name="matchKind" label="Match kind" options={MATCH_KINDS.map((kind) => ({ value: kind.value, label: kind.value }))} />
      <TextField form={form} name="matchValue" label="Match value" placeholder={matchExample[matchKind] ?? ""} />
    </div>
    <Notice>{hint}</Notice>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
      <SelectField form={form} name="action" label="Action" options={[{ value: "flag", label: "flag" }, { value: "block", label: "block" }]} />
      <SelectField form={form} name="stage" label="Stage" options={[{ value: "request", label: "request" }, { value: "response", label: "response" }]} />
      <SelectField form={form} name="severity" label="Severity" options={[{ value: "low", label: "low" }, { value: "medium", label: "medium" }, { value: "high", label: "high" }]} />
    </div>
  </FormModal>;
}

function ReviewsSection() {
  const client = useQueryClient();
  const [state, setState] = useState("pending");
  const query = useQuery({ queryKey: ["reviews", state], queryFn: () => api<{ reviews: ReviewItem[] }>(`/api/reviews?state=${state}`) });
  const [decision, setDecision] = useState<{ item: ReviewItem; state: "approved" | "rejected" } | null>(null);
  const decide = useMutation({ mutationFn: ({ id, next, note }: { id: string; next: string; note: string }) => api(`/api/reviews/${id}`, { method: "POST", body: JSON.stringify({ state: next, note }) }), onSuccess: () => { setDecision(null); void client.invalidateQueries({ queryKey: ["reviews"] }); } });
  const reviews = query.data?.reviews ?? [];
  return <Panel flush title="Review queue" note={`${reviews.length} items`} actions={
    <ToggleGroup type="single" value={state} onValueChange={(value) => { if (value) setState(value); }}>{["pending", "approved", "rejected"].map((value) => <ToggleGroupItem key={value} value={value}>{value}</ToggleGroupItem>)}</ToggleGroup>
  }>
    <div className="table-wrap"><table>
      <thead><tr><th>Run</th><th>Model</th><th>Provider</th><th className="num">Cost</th><th>Created</th><th>State</th><th /></tr></thead>
      <tbody>
        {query.isPending ? <SkeletonRows columns={7} rows={4} /> : reviews.length ? reviews.map((item) => <tr key={item.id}>
          <td>{item.run ? <Link className="tcell-primary" to={`/ui/runs/${item.run.id}`}>{item.run.name || item.run_id.slice(0, 8)}</Link> : <span className="mono">{item.run_id.slice(0, 8)}</span>}</td>
          <td className="tnum">{item.run?.model || "-"}</td>
          <td className="tnum">{item.run?.provider || "-"}</td>
          <td className="num">{fmtUsd(item.run?.cost_usd)}</td>
          <td className="tcell-muted tnum">{formatDateTime(item.created_at)}</td>
          <td><span className={`badge ${item.state === "approved" ? "good" : item.state === "rejected" ? "bad" : "warn"}`}><span className="dot" />{item.state}</span></td>
          <td className="text-right whitespace-nowrap">
            {item.state === "pending" ? <><Button className="mr-1.5" variant="outline" type="button" onClick={() => setDecision({ item, state: "approved" })}>Approve</Button><Button variant="outline" type="button" onClick={() => setDecision({ item, state: "rejected" })}>Reject</Button></> : null}
          </td>
        </tr>) : <EmptyRow colSpan={7}>Nothing in this queue.</EmptyRow>}
      </tbody>
    </table></div>
    {decision ? <DecisionModal item={decision.item} state={decision.state} pending={decide.isPending} error={decide.error?.message} onClose={() => setDecision(null)} onSubmit={(note) => decide.mutate({ id: decision.item.id, next: decision.state, note })} /> : null}
  </Panel>;
}

const decisionSchema = z.object({ note: z.string() });
type DecisionValues = z.infer<typeof decisionSchema>;

function DecisionModal({ item, state, pending, error, onClose, onSubmit }: { item: ReviewItem; state: string; pending: boolean; error?: string; onClose: () => void; onSubmit: (note: string) => void }) {
  const form = useZodForm<DecisionValues>(decisionSchema, { note: "" });
  return <FormModal title={`${state === "approved" ? "Approve" : "Reject"} run`} form={form} submitLabel={state === "approved" ? "Approve" : "Reject"} pending={pending} error={error ?? null} onClose={onClose} onSubmit={(values) => onSubmit(values.note)}>
    <p>Run <b>{item.run?.name || item.run_id.slice(0, 8)}</b>. The decision is written to the audit log.</p>
    <TextAreaField form={form} name="note" label="Note (optional)" rows={3} />
  </FormModal>;
}

function RoutingSection() {
  const client = useQueryClient();
  const rulesQuery = useQuery({ queryKey: ["routing-rules"], queryFn: () => api<{ rules: RoutingRule[] }>("/api/routing/rules") });
  const signalsQuery = useQuery({ queryKey: ["routing-signals"], queryFn: () => api<{ signals: SlmCandidate[] }>("/api/routing/signals") });
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<RoutingRule | null>(null);
  const invalidate = () => client.invalidateQueries({ queryKey: ["routing-rules"] });
  const toggle = useMutation({ mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api(`/api/routing/rules/${id}`, { method: "PATCH", body: JSON.stringify({ enabled }) }), onSuccess: () => void invalidate() });
  const remove = useMutation({ mutationFn: (id: string) => api(`/api/routing/rules/${id}`, { method: "DELETE" }), onSuccess: () => { setConfirmDelete(null); void invalidate(); } });
  const rules = rulesQuery.data?.rules ?? [];
  const signals = signalsQuery.data?.signals ?? [];
  return <>
    <Panel flush title="Routing rules" note={`${rules.length} rules`} actions={<Button type="button" onClick={() => setCreateOpen(true)}>New rule</Button>}>
      <div className="table-wrap"><table>
        <thead><tr><th>Name</th><th>Match</th><th>Target</th><th>Fallback</th><th className="num">Priority</th><th /></tr></thead>
        <tbody>
          {rulesQuery.isPending ? <SkeletonRows columns={6} rows={4} /> : rules.length ? rules.map((rule) => <tr key={rule.id}>
            <td className="tcell-primary">{rule.name}{rule.enabled ? null : <span className="chip ml-1.5">disabled</span>}</td>
            <td className="tnum">{rule.match_kind}: {rule.match_model || rule.match_prompt || rule.match_prompt_regex || "-"}{rule.match_provider ? ` @${rule.match_provider}` : ""}</td>
            <td className="tnum">{rule.target_model}</td>
            <td className="tnum">{rule.fallback_model || "-"}</td>
            <td className="num">{rule.priority}</td>
            <td className="text-right whitespace-nowrap">
              <Button className="mr-1.5" variant="outline" type="button" disabled={toggle.isPending} onClick={() => toggle.mutate({ id: rule.id, enabled: !rule.enabled })}>{rule.enabled ? "Disable" : "Enable"}</Button>
              <Button variant="outline" type="button" onClick={() => setConfirmDelete(rule)}>Delete</Button>
            </td>
          </tr>) : <EmptyRow colSpan={6}>No routing rules yet.</EmptyRow>}
        </tbody>
      </table></div>
    </Panel>
    <Panel flush title="SLM opportunities" note={`${signals.length} clusters`}>
      <div className="table-wrap"><table>
        <thead><tr><th>Cluster</th><th className="num">Runs</th><th className="num">Spend</th><th className="num">Avg latency</th><th>Suggestion</th></tr></thead>
        <tbody>
          {signalsQuery.isPending ? <SkeletonRows columns={5} rows={4} /> : signals.length ? signals.map((signal, index) => <tr key={`${signal.cluster}-${index}`}>
            <td className="tnum">{signal.cluster}</td>
            <td className="num">{compact(signal.runs)}</td>
            <td className="num">{fmtUsd(signal.spendUsd)}</td>
            <td className="num">{fmtMs(signal.avgLatencyMs)}</td>
            <td style={{ color: "var(--text-3)", whiteSpace: "normal" }}>{signal.suggestion}</td>
          </tr>) : <EmptyRow colSpan={5}>No substitution clusters detected yet.</EmptyRow>}
        </tbody>
      </table></div>
    </Panel>
    {createOpen ? <RuleEditor onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); void invalidate(); }} /> : null}
    {confirmDelete ? <Modal title="Delete routing rule" onClose={() => setConfirmDelete(null)}>
      <p>Delete <b>{confirmDelete.name}</b>?</p>
      {remove.isError ? <ErrorText>{remove.error.message}</ErrorText> : null}
      <div className="modal-actions"><Button variant="outline" type="button" onClick={() => setConfirmDelete(null)}>Cancel</Button><Button variant="destructive" type="button" disabled={remove.isPending} onClick={() => remove.mutate(confirmDelete.id)}>Delete</Button></div>
    </Modal> : null}
  </>;
}

const ruleSchema = z.object({
  name: z.string(),
  targetModel: z.string().trim().min(1, "Target model is required"),
  matchKind: z.enum(["prefix", "exact", "regex"]),
  matchModel: z.string(),
  matchProvider: z.string(),
  matchPrompt: z.string(),
  matchPromptRegex: z.string(),
  targetUrl: z.string(),
  fallbackModel: z.string(),
  priority: z.string(),
  maxCost: z.string(),
}).refine((values) => values.matchModel.trim() || values.matchPrompt.trim() || values.matchPromptRegex.trim(), { message: "Provide a match model, prompt or regex", path: ["matchModel"] });
type RuleValues = z.infer<typeof ruleSchema>;

function RuleEditor({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const form = useZodForm<RuleValues>(ruleSchema, { name: "", targetModel: "", matchKind: "prefix", matchModel: "", matchProvider: "", matchPrompt: "", matchPromptRegex: "", targetUrl: "", fallbackModel: "", priority: "100", maxCost: "" });
  const create = useMutation({
    mutationFn: (values: RuleValues) => api("/api/routing/rules", {
      method: "POST",
      body: JSON.stringify({
        name: values.name || undefined, target_model: values.targetModel, match_kind: values.matchKind,
        match_model: values.matchModel || undefined, match_provider: values.matchProvider || undefined,
        match_prompt: values.matchPrompt || undefined, match_prompt_regex: values.matchPromptRegex || undefined,
        target_url: values.targetUrl || undefined, fallback_model: values.fallbackModel || undefined,
        priority: toNullableNumber(values.priority) ?? 100, max_cost_usd: toNullableNumber(values.maxCost) ?? undefined,
      }),
    }),
    onSuccess: onSaved,
  });
  return <FormModal title="New routing rule" form={form} submitLabel="Create" pending={create.isPending} error={create.isError ? create.error.message : null} onClose={onClose} onSubmit={(values) => create.mutate(values)}>
    <TextField form={form} name="name" label="Name" placeholder="defaults to match → target" autoFocus />
    <div className="grid-2-12">
      <TextField form={form} name="targetModel" label="Target model" placeholder="gpt-4o-mini" />
      <SelectField form={form} name="matchKind" label="Match kind" options={[{ value: "prefix", label: "prefix" }, { value: "exact", label: "exact" }, { value: "regex", label: "regex" }]} />
      <TextField form={form} name="matchModel" label="Match model" placeholder="gpt-4o" />
      <TextField form={form} name="matchProvider" label="Match provider" placeholder="optional" />
      <TextField form={form} name="matchPrompt" label="Match prompt (substring)" placeholder="summarize" />
      <TextField form={form} name="matchPromptRegex" label="Match prompt regex" placeholder="^translate" />
      <TextField form={form} name="fallbackModel" label="Fallback model" placeholder="optional" />
      <TextField form={form} name="targetUrl" label="SLM endpoint (optional)" placeholder="https://slm.internal/v1" />
      <TextField form={form} name="priority" label="Priority (0-1000)" inputMode="numeric" placeholder="100" />
      <TextField form={form} name="maxCost" label="Max cost per call (USD)" inputMode="decimal" placeholder="optional" />
    </div>
  </FormModal>;
}

function AuditSection() {
  const [action, setAction] = useState("");
  const [targetType, setTargetType] = useState("");
  const [page, setPage] = useState(1);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const debouncedAction = useDebouncedValue(action, 250);
  const debouncedTargetType = useDebouncedValue(targetType, 250);
  const filters = new URLSearchParams({ limit: "50", page: String(page) });
  if (debouncedAction) filters.set("action", debouncedAction);
  if (debouncedTargetType) filters.set("target_type", debouncedTargetType);
  const query = useQuery({ queryKey: ["audit", debouncedAction, debouncedTargetType, page], queryFn: () => api<{ entries: AuditEntry[]; total: number; page: number; limit: number }>(`/api/audit?${filters}`) });
  const entries = query.data?.entries ?? [];
  const pageCount = query.data ? Math.max(1, Math.ceil(query.data.total / query.data.limit)) : 1;
  const exportCsv = async () => {
    setDownloadError(null);
    const params = new URLSearchParams();
    if (action) params.set("action", action);
    if (targetType) params.set("target_type", targetType);
    try { await downloadFile(`/api/audit/export?${params}`, "torrix-audit.csv"); } catch (error) { setDownloadError((error as Error).message); }
  };
  return <Panel flush title="Audit log" note={`${query.data?.total ?? 0} entries`} actions={
    <div className="action-row">
      <Input className="w-[150px]" placeholder="action" value={action} onChange={(event) => { setAction(event.target.value); setPage(1); }} />
      <Input className="w-[150px]" placeholder="target type" value={targetType} onChange={(event) => { setTargetType(event.target.value); setPage(1); }} />
      <Button variant="outline" type="button" onClick={() => void exportCsv()}>Export CSV</Button>
    </div>
  }>
    {downloadError ? <div className="panel-body"><ErrorText>{downloadError}</ErrorText></div> : null}
    <div className="table-wrap"><table className="table-fixed w-full">
      <colgroup>
        <col style={{ width: "14%" }} />
        <col style={{ width: "16%" }} />
        <col style={{ width: "17%" }} />
        <col style={{ width: "17%" }} />
        <col style={{ width: "24%" }} />
        <col style={{ width: "12%" }} />
      </colgroup>
      <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Detail</th><th>IP</th></tr></thead>
      <tbody>
        {query.isPending ? <EmptyRow colSpan={6}>Loading…</EmptyRow> : entries.length ? entries.map((entry) => <tr key={entry.id}>
          <td className="tcell-muted whitespace-nowrap tnum" title={formatDateTime(entry.created_at)}>{shortStamp(entry.created_at)}</td>
          <td className="tnum"><span title={entry.actor} style={clipCell}>{entry.actor}</span></td>
          <td className="tnum"><span title={entry.action} style={clipCell}>{entry.action}</span></td>
          <td className="mono"><span title={`${entry.target_type}${entry.target_id ? `:${entry.target_id}` : ""}`} style={clipCell}>{entry.target_type}{entry.target_id ? `:${entry.target_id.slice(0, 8)}` : ""}</span></td>
          <td><span title={entry.detail ?? undefined} style={{ ...clipCell, color: "var(--text-3)" }}>{entry.detail || "-"}</span></td>
          <td className="tcell-muted tnum"><span title={entry.ip ?? undefined} style={clipCell}>{entry.ip || "-"}</span></td>
        </tr>) : <EmptyRow colSpan={6}>No audit events.</EmptyRow>}
      </tbody>
    </table></div>
    <div className="pager">
      <span>Page <b>{page}</b> of <b>{pageCount}</b></span>
      <div className="pager-links">
        {page > 1 ? <Button variant="ghost" type="button" onClick={() => setPage(page - 1)}>Previous</Button> : <span>Previous</span>}
        {page < pageCount ? <Button variant="ghost" type="button" onClick={() => setPage(page + 1)}>Next</Button> : <span>Next</span>}
      </div>
    </div>
  </Panel>;
}

function ExportsSection() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["exports"], queryFn: () => api<{ exports: ExportConfig[] }>("/api/exports") });
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ExportConfig | null>(null);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const invalidate = () => client.invalidateQueries({ queryKey: ["exports"] });
  const toggle = useMutation({ mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api(`/api/exports/${id}`, { method: "PATCH", body: JSON.stringify({ enabled }) }), onSuccess: () => void invalidate() });
  const remove = useMutation({ mutationFn: (id: string) => api(`/api/exports/${id}`, { method: "DELETE" }), onSuccess: () => { setConfirmDelete(null); void invalidate(); } });
  const run = useMutation({ mutationFn: (id: string) => api<{ uploaded: number; key: string | null }>(`/api/exports/${id}/run`, { method: "POST" }), onSuccess: (data) => { setRunMessage(`Uploaded ${data.uploaded} runs to ${data.key ?? "destination"}.`); void invalidate(); }, onError: (error: Error) => setRunMessage(error.message) });
  const exports = query.data?.exports ?? [];
  return <>
    <Panel flush title="External exports" note={`${exports.length} destinations`} actions={<Button type="button" onClick={() => setCreateOpen(true)}>New destination</Button>}>
      <div className="table-wrap"><table>
        <thead><tr><th>Provider</th><th>Bucket</th><th className="num">Every</th><th>Last export</th><th className="num">Runs</th><th>Status</th><th /></tr></thead>
        <tbody>
          {query.isPending ? <EmptyRow colSpan={7}>Loading…</EmptyRow> : exports.length ? exports.map((config) => <tr key={config.id}>
            <td><span className="chip">{config.provider}</span>{config.enabled ? null : <small className="tcell-sub">paused</small>}</td>
            <td className="min-w-0">
              <span className="cell-truncate tnum" title={`${config.bucket}${config.prefix ? `/${config.prefix}` : ""}`}>{config.bucket}</span>
              {config.prefix ? <small className="cell-truncate tcell-sub mono" title={config.prefix}>{config.prefix}</small> : null}
            </td>
            <td className="num">{config.schedule_minutes}m</td>
            <td className="tcell-muted whitespace-nowrap tnum" title={config.last_export_at ? formatDateTime(config.last_export_at) : "never"}>{config.last_export_at ? relTime(config.last_export_at) : "never"}</td>
            <td className="num">{config.last_run_count ?? 0}</td>
            <td style={{ whiteSpace: "normal", minWidth: 0 }}>
              {config.last_error
                ? <><span className={badgeClass("blocked")} title={config.last_error}><span className="dot" />error</span><small className="tcell-sub" style={{ display: "block", whiteSpace: "normal", overflowWrap: "anywhere" }}>{config.last_error}</small></>
                : config.enabled ? <span className={badgeClass("active")}><span className="dot" />ok</span> : <span className={badgeClass("suspended")}><span className="dot" />paused</span>}
            </td>
            <td>
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                <Button size="sm" variant="outline" type="button" disabled={run.isPending} onClick={() => run.mutate(config.id)}>Run now</Button>
                <Button size="sm" variant="outline" type="button" onClick={() => toggle.mutate({ id: config.id, enabled: !config.enabled })}>{config.enabled ? "Pause" : "Enable"}</Button>
                <Button size="sm" variant="outline" type="button" onClick={() => setConfirmDelete(config)}>Delete</Button>
              </div>
            </td>
          </tr>) : <EmptyRow colSpan={7}>No export destinations configured.</EmptyRow>}
        </tbody>
      </table></div>
      {runMessage ? <div className="panel-body"><Notice>{runMessage}</Notice></div> : null}
    </Panel>
    {createOpen ? <ExportEditor onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); void invalidate(); }} /> : null}
    {confirmDelete ? <Modal title="Delete destination" onClose={() => setConfirmDelete(null)}>
      <p>Delete the export to <b>{confirmDelete.bucket}</b>?</p>
      {remove.isError ? <ErrorText>{remove.error.message}</ErrorText> : null}
      <div className="modal-actions"><Button variant="outline" type="button" onClick={() => setConfirmDelete(null)}>Cancel</Button><Button variant="destructive" type="button" disabled={remove.isPending} onClick={() => remove.mutate(confirmDelete.id)}>Delete</Button></div>
    </Modal> : null}
  </>;
}

const exportSchema = z.object({
  provider: z.enum(["s3", "gcs"]),
  bucket: z.string().trim().min(1, "Bucket is required"),
  accessKey: z.string().trim().min(1, "Access key id is required"),
  secretKey: z.string().trim().min(1, "Secret access key is required"),
  endpoint: z.string(),
  prefix: z.string(),
  schedule: z.string(),
});
type ExportValues = z.infer<typeof exportSchema>;

function ExportEditor({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const form = useZodForm<ExportValues>(exportSchema, { provider: "s3", bucket: "", accessKey: "", secretKey: "", endpoint: "", prefix: "torrix", schedule: "1440" });
  const create = useMutation({
    mutationFn: (values: ExportValues) => api("/api/exports", { method: "POST", body: JSON.stringify({ provider: values.provider, bucket: values.bucket, access_key_id: values.accessKey, secret_access_key: values.secretKey, endpoint: values.endpoint || undefined, prefix: values.prefix, schedule_minutes: toNullableNumber(values.schedule) ?? 1440 }) }),
    onSuccess: onSaved,
  });
  return <FormModal title="New export destination" form={form} submitLabel="Create" pending={create.isPending} error={create.isError ? create.error.message : null} onClose={onClose} onSubmit={(values) => create.mutate(values)}>
    <SelectField form={form} name="provider" label="Provider" options={[{ value: "s3", label: "s3" }, { value: "gcs", label: "gcs" }]} />
    <TextField form={form} name="bucket" label="Bucket" placeholder="my-torrix-archive" />
    <TextField form={form} name="accessKey" label="Access key id" placeholder="AKIAIOSFODNN7EXAMPLE" />
    <TextField form={form} name="secretKey" label="Secret access key" type="password" placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" />
    <TextField form={form} name="endpoint" label="Endpoint (optional)" placeholder="https://s3.us-east-1.amazonaws.com" />
    <div className="grid-2-12">
      <TextField form={form} name="prefix" label="Prefix" placeholder="torrix" />
      <TextField form={form} name="schedule" label="Schedule (minutes)" inputMode="numeric" placeholder="1440" />
    </div>
  </FormModal>;
}

function SettingsSection() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["governance-settings"], queryFn: () => api<{ settings: GovernanceSettings; availableTypes: string[] }>("/api/governance/settings") });
  const settings = query.data?.settings;
  const [piiEnabled, setPiiEnabled] = useState(false);
  const [maskInput, setMaskInput] = useState(false);
  const [maskOutput, setMaskOutput] = useState(false);
  const [reviewEnabled, setReviewEnabled] = useState(false);
  const [auditEnabled, setAuditEnabled] = useState(true);
  const [placeholder, setPlaceholder] = useState("[redacted]");
  const [types, setTypes] = useState<string[]>([]);
  useEffect(() => {
    if (!settings) return;
    setPiiEnabled(settings.pii_enabled === 1);
    setMaskInput(settings.pii_mask_input === 1);
    setMaskOutput(settings.pii_mask_output === 1);
    setReviewEnabled(settings.human_review_enabled === 1);
    setAuditEnabled(settings.audit_enabled === 1);
    setPlaceholder(settings.pii_placeholder || "[redacted]");
    try { const parsed = JSON.parse(settings.pii_types); setTypes(Array.isArray(parsed) ? parsed.map(String) : []); } catch { setTypes([]); }
  }, [settings]);
  const save = useMutation({
    mutationFn: () => api("/api/governance/settings", {
      method: "PUT",
      body: JSON.stringify({ pii_enabled: piiEnabled, pii_mask_input: maskInput, pii_mask_output: maskOutput, human_review_enabled: reviewEnabled, audit_enabled: auditEnabled, pii_placeholder: placeholder, pii_types: types }),
    }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["governance-settings"] }),
  });
  if (query.isPending) return <PageLoading />;
  if (query.isError) return <PageError message={query.error.message} />;
  const available = query.data?.availableTypes ?? [];
  return <Panel title="PII masking & oversight" note="applied by the proxy, SDK ingest and OTLP ingest">
    <div className="flex items-center gap-2"><Checkbox id="cb-6" checked={piiEnabled} onCheckedChange={(value) => setPiiEnabled(value === true)} /><label htmlFor="cb-6" className="text-[13px] text-text-2">Mask PII before storage</label></div>
    <div className="action-row mt-2">
      <div className="flex items-center gap-2"><Checkbox id="cb-7" checked={maskInput} onCheckedChange={(value) => setMaskInput(value === true)} /><label htmlFor="cb-7" className="text-[13px] text-text-2">Mask inputs</label></div>
      <div className="flex items-center gap-2"><Checkbox id="cb-8" checked={maskOutput} onCheckedChange={(value) => setMaskOutput(value === true)} /><label htmlFor="cb-8" className="text-[13px] text-text-2">Mask outputs</label></div>
      <div className="flex items-center gap-2"><Checkbox id="cb-9" checked={reviewEnabled} onCheckedChange={(value) => setReviewEnabled(value === true)} /><label htmlFor="cb-9" className="text-[13px] text-text-2">Queue flagged runs for human review</label></div>
      <div className="flex items-center gap-2"><Checkbox id="cb-10" checked={auditEnabled} onCheckedChange={(value) => setAuditEnabled(value === true)} /><label htmlFor="cb-10" className="text-[13px] text-text-2">Record audit log</label></div>
    </div>
    <Field label="Masking placeholder"><Input value={placeholder} onChange={(event) => setPlaceholder(event.target.value)} /></Field>
    <Field label="PII types to detect">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {available.map((type) => <div key={type} className="flex items-center gap-1.5">
          <Checkbox id={`pii-${type}`} checked={types.includes(type)} onCheckedChange={(value) => setTypes((current) => value === true ? [...current, type] : current.filter((value) => value !== type))} />
          <label htmlFor={`pii-${type}`} className="font-sans text-[12px] text-text-2">{type}</label>
        </div>)}
      </div>
    </Field>
    {save.isError ? <ErrorText>{save.error.message}</ErrorText> : null}
    <div className="action-row mt-3"><Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>Save settings</Button></div>
  </Panel>;
}

const siemSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  kind: z.enum(["splunk", "sentinel"]),
  endpointUrl: z.string().trim().min(1, "Endpoint is required"),
  authType: z.enum(["token", "client_credentials"]),
  token: z.string(),
  tenantId: z.string(),
  clientId: z.string(),
  clientSecret: z.string(),
  batchSize: z.string(),
});
type SiemValues = z.infer<typeof siemSchema>;

/** OCSF decisions and audit events to Splunk HEC or Microsoft Sentinel. */
function SiemSection() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["siem-destinations"],
    queryFn: () => api<{ destinations: SiemDestinationView[]; pending: number }>("/api/v1/siem/destinations"),
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<SiemDestinationView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const invalidate = () => void client.invalidateQueries({ queryKey: ["siem-destinations"] });
  const test = useMutation({
    mutationFn: (id: string) => api(`/api/v1/siem/destinations/${id}/test`, { method: "POST", body: "{}" }),
    onSuccess: () => { setMessage("Test event delivered."); invalidate(); },
    onError: (error: Error) => setMessage(`Test failed: ${error.message}`),
  });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api(`/api/v1/siem/destinations/${id}`, { method: "PATCH", body: JSON.stringify({ enabled }) }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/v1/siem/destinations/${id}`, { method: "DELETE" }),
    onSuccess: () => { setConfirmDelete(null); invalidate(); },
  });
  const flush = useMutation({
    mutationFn: () => api<{ collected: number; delivered: number; failed: number }>("/api/v1/siem/flush", { method: "POST", body: "{}" }),
    onSuccess: (result) => { setMessage(`Flushed: ${result.collected} collected, ${result.delivered} delivered, ${result.failed} failed.`); invalidate(); },
    onError: (error: Error) => setMessage(error.message),
  });
  const destinations = query.data?.destinations ?? [];
  const pending = query.data?.pending ?? 0;
  return <>
    <Panel flush title="SIEM export" note={`OCSF to Splunk HEC or Microsoft Sentinel · ${pending} event${pending === 1 ? "" : "s"} queued`} actions={<div className="flex gap-2">
      <Button variant="outline" type="button" disabled={flush.isPending} onClick={() => flush.mutate()}>{flush.isPending ? "Flushing…" : "Flush now"}</Button>
      <Button type="button" onClick={() => setCreateOpen(true)}>Add destination</Button>
    </div>}>
      <div>
        {query.isPending ? <div style={{ padding: "14px 18px" }} className="panel-note">Loading…</div>
          : destinations.length ? destinations.map((destination) => (
            <div key={destination.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", alignItems: "center", gap: 16, padding: "12px 18px", borderTop: "1px solid var(--line)" }}>
              <div className="min-w-0">
                <div className="tcell-primary">{destination.name}</div>
                <div className="tnum" title={destination.endpoint_url} style={{ color: "var(--text-3)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{destination.endpoint_url}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                  {destination.enabled === 0
                    ? <span className={badgeClass("suspended")}><span className="dot" />disabled</span>
                    : destination.last_error
                      ? <span className={badgeClass("blocked")}><span className="dot" />error</span>
                      : <span className={badgeClass("active")}><span className="dot" />ready</span>}
                  <span className="panel-note" style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>
                    {destination.last_error ? destination.last_error : destination.last_success_at ? `delivered ${relTime(destination.last_success_at)}` : "never delivered"}
                  </span>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="chip">{destination.kind}</span>
                  <span className="chip">{destination.auth_type}</span>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <Button size="sm" variant="outline" type="button" disabled={test.isPending} onClick={() => test.mutate(destination.id)}>Test</Button>
                  <Button size="sm" variant="outline" type="button" disabled={toggle.isPending} onClick={() => toggle.mutate({ id: destination.id, enabled: destination.enabled === 0 })}>{destination.enabled === 0 ? "Enable" : "Disable"}</Button>
                  <Button size="sm" variant="outline" type="button" onClick={() => setConfirmDelete(destination)}>Delete</Button>
                </div>
              </div>
            </div>
          )) : <div style={{ padding: "14px 18px" }} className="panel-note">No SIEM destinations configured. Decisions and audit events stay local until one is added.</div>}
      </div>
    </Panel>
    {message ? <Notice>{message}</Notice> : null}
    {createOpen ? <SiemEditor onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); invalidate(); }} /> : null}
    {confirmDelete ? <Modal title="Delete SIEM destination" onClose={() => setConfirmDelete(null)}>
      <p>Delete <b>{confirmDelete.name}</b>? Queued events for it are dropped.</p>
      {remove.isError ? <ErrorText>{remove.error.message}</ErrorText> : null}
      <div className="modal-actions"><Button variant="outline" type="button" onClick={() => setConfirmDelete(null)}>Cancel</Button><Button variant="destructive" type="button" disabled={remove.isPending} onClick={() => remove.mutate(confirmDelete.id)}>Delete</Button></div>
    </Modal> : null}
  </>;
}

function SiemEditor({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const form = useZodForm<SiemValues>(siemSchema, { name: "", kind: "splunk", endpointUrl: "", authType: "token", token: "", tenantId: "", clientId: "", clientSecret: "", batchSize: "50" });
  const kind = form.watch("kind");
  const authType = form.watch("authType");
  const create = useMutation({
    mutationFn: (values: SiemValues) => api("/api/v1/siem/destinations", {
      method: "POST",
      body: JSON.stringify({
        name: values.name,
        kind: values.kind,
        endpoint_url: values.endpointUrl,
        auth_type: values.authType,
        token: values.token || undefined,
        tenant_id: values.tenantId || undefined,
        client_id: values.clientId || undefined,
        client_secret: values.clientSecret || undefined,
        batch_size: toNullableNumber(values.batchSize) ?? 50,
        enabled: true,
      }),
    }),
    onSuccess: onSaved,
  });
  return <FormModal title="New SIEM destination" form={form} submitLabel="Add destination" pending={create.isPending} error={create.isError ? create.error.message : null} onClose={onClose} onSubmit={(values) => create.mutate(values)}>
    <TextField form={form} name="name" label="Name" placeholder="Security data lake" autoFocus />
    <SelectField form={form} name="kind" label="Kind" options={[{ value: "splunk", label: "Splunk HEC" }, { value: "sentinel", label: "Microsoft Sentinel" }]} />
    <TextField form={form} name="endpointUrl" label="Endpoint URL" placeholder="https://splunk.example:8088/services/collector/event" />
    <SelectField form={form} name="authType" label="Auth" disabled={kind === "splunk"} options={[{ value: "token", label: "token" }, { value: "client_credentials", label: "Sentinel client credentials" }]} />
    {authType === "token" ? <TextField form={form} name="token" label="Token" type="password" placeholder="HEC token" /> : <>
      <div className="grid-2-12">
        <TextField form={form} name="tenantId" label="Tenant id" placeholder="00000000-0000-0000-0000-000000000000" />
        <TextField form={form} name="clientId" label="Client id" placeholder="application id" />
      </div>
      <TextField form={form} name="clientSecret" label="Client secret" type="password" placeholder="secret" />
    </>}
    <TextField form={form} name="batchSize" label="Batch size (1-500)" inputMode="numeric" placeholder="50" />
  </FormModal>;
}
