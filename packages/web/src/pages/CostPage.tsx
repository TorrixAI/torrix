import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { PageError, PageLoading } from "./DashboardPage";
import { api, fmtUsd, formatDate, formatDateTime, type AlertSettings, type CostUsageRow, type PricingOverride } from "../api";
import { CapUsage, EmptyRow, ErrorText, InlineSelect, Notice, PageHead, Panel, SkeletonRows, toNullableNumber } from "../components";
import { FormModal, TextField, useZodForm } from "../form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

interface CostSelected { id: string; name: string; budget_usd: number | null; hard_cap_usd: number | null }

interface CostSettingsResponse {
  settings: AlertSettings;
  month: string;
  usage: CostUsageRow[];
  judge_spend: number;
  projects: Array<{ id: string; name: string }>;
  selected: CostSelected | null;
  selected_spend: number;
}

export default function CostPage() {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const project = params.get("project") ?? "";
  const query = useQuery({
    queryKey: ["cost-settings", project],
    queryFn: () => api<CostSettingsResponse>(project ? `/api/cost/settings?project=${encodeURIComponent(project)}` : "/api/cost/settings"),
  });
  const [digestMessage, setDigestMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<CostUsageRow | null>(null);
  const [priceModal, setPriceModal] = useState<PricingOverride | "new" | null>(null);
  const digest = useMutation({
    mutationFn: () => api<{ sent: boolean }>("/api/cost/digest", { method: "POST" }),
    onSuccess: () => setDigestMessage("Digest sent."),
    onError: (error: Error) => setDigestMessage(error.message === "digest_not_sent" ? "Configure a webhook URL first." : error.message),
  });

  if (query.isPending) return <PageLoading />;
  if (query.isError) return <PageError message={query.error.message} />;
  const { settings, month, usage, judge_spend: judgeSpend, projects, selected, selected_spend: selectedSpend } = query.data;

  return <>
    <PageHead title="Cost & alerts" sub={`Month-to-date usage since ${formatDate(month)}. Budgets raise webhooks; hard caps return 429.`} actions={<Button variant="outline" type="button" disabled={digest.isPending} onClick={() => digest.mutate()}>Send weekly digest</Button>} />
    {digestMessage ? <Notice>{digestMessage}</Notice> : null}
    {judgeSpend > 0 ? <Notice>Judge spend this month: {fmtUsd(judgeSpend)}</Notice> : null}

    <div className="co-scope" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
      <label htmlFor="co-project" className="co-scope-label">View</label>
      <InlineSelect
        id="co-project"
        aria-label="Project scope"
        value={project}
        placeholder="All projects"
        onValueChange={(value) => {
          const next = new URLSearchParams(params);
          if (value) next.set("project", value); else next.delete("project");
          setParams(next, { replace: true });
        }}
        options={[{ value: "", label: "All projects" }, ...projects.map((entry) => ({ value: entry.id, label: entry.name }))]}
      />
      <span className="panel-note">{selected ? `scoped to ${selected.name}: month spend, limits and keys for this project` : "every project on this account in one table"}</span>
    </div>

    <CostCards settings={settings} spend={selected ? selectedSpend : usage.find((row) => row.scope === "user")?.spend ?? 0} selected={selected} />

    {selected ? <div style={{ display: "flex", gap: 8, marginTop: 12, marginBottom: 4 }}>
      <Link className={buttonVariants({ variant: "outline" })} to={`/ui/runs?project=${encodeURIComponent(selected.id)}`}>Open runs</Link>
      <Link className={buttonVariants({ variant: "outline" })} to={`/ui/analytics?project=${encodeURIComponent(selected.id)}`}>Open analytics</Link>
    </div> : null}

    <SettingsPanel settings={settings} onSaved={() => void client.invalidateQueries({ queryKey: ["cost-settings"] })} />
    <UsagePanel month={month} usage={usage} selected={selected} onEdit={setEditing} />
    <PricingPanel onEdit={setPriceModal} />

    {editing ? <UsageLimits row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void client.invalidateQueries({ queryKey: ["cost-settings"] }); }} /> : null}
    {priceModal ? <PriceEditor price={priceModal === "new" ? null : priceModal} onClose={() => setPriceModal(null)} /> : null}
  </>;
}

/**
 * The legacy cost page opened with four summary tiles (Monthly spend, Budget,
 * Hard cap, Alerting); the React page had dropped them, so the account-level
 * budget/cap usage and the alerting state were only visible by reading the
 * settings form. Same values, same bars, same channel summary.
 */
function CostCards({ settings, spend, selected }: { settings: AlertSettings; spend: number; selected: CostSelected | null }) {
  const pct = (cap: number | null | undefined) => (cap && cap > 0 ? Math.min(100, Math.round((100 * spend) / cap)) : 0);
  const hot = (cap: number | null | undefined) => Boolean(cap && cap > 0 && spend >= cap);
  const channels = [
    settings.webhook_url ? "webhook" : null,
    settings.pagerduty_routing_key ? "PagerDuty" : null,
    settings.email_webhook_url && (settings.email_recipients ?? "").trim() ? "email" : null,
  ].filter(Boolean) as string[];
  const budget = selected ? selected.budget_usd : settings.budget_usd;
  const cap = selected ? selected.hard_cap_usd : settings.hard_cap_usd;
  return <div className="stat-tiles cost-stats">
    <div className="stat-tile"><span className="st-label">Monthly spend</span><div className="st-value">{fmtUsd(spend)}</div><div className="st-sub">{selected ? `in ${selected.name}` : "across all projects"}</div></div>
    <div className={`stat-tile${hot(budget) ? " tone-warn" : ""}`}><span className="st-label">Budget</span><div className="st-value">{budget == null ? <span className="st-empty">Not set</span> : fmtUsd(budget)}</div><div className="co-bar"><span className={hot(budget) ? "hot" : ""} style={{ width: `${pct(budget)}%` }} /></div><div className="st-sub">{budget == null ? "set a budget to receive alerts" : selected ? "project budget" : "alerts fire at 50 / 80 / 100%"}</div></div>
    <div className={`stat-tile${hot(cap) ? " tone-bad" : ""}`}><span className="st-label">Hard cap</span><div className="st-value">{cap == null ? <span className="st-empty">Not set</span> : fmtUsd(cap)}</div><div className="co-bar"><span className={hot(cap) ? "hot" : ""} style={{ width: `${pct(cap)}%` }} /></div><div className="st-sub">{cap == null ? "no request cap is enforced" : "requests blocked once reached"}</div></div>
    <div className="stat-tile"><span className="st-label">Alerting</span><div className="st-value">{settings.enabled ? <span className="badge good"><span className="dot" />enabled</span> : <span className="badge neutral"><span className="dot" />disabled</span>}</div><div className="st-sub">{selected ? "alerts are account-wide" : channels.length ? channels.join(" + ") : "no channels configured"}</div></div>
  </div>;
}

function SettingsPanel({ settings, onSaved }: { settings: AlertSettings; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(settings.enabled === 1);
  const [webhookUrl, setWebhookUrl] = useState(settings.webhook_url ?? "");
  const [webhookSecret, setWebhookSecret] = useState(settings.webhook_secret ?? "");
  const [pagerdutyKey, setPagerdutyKey] = useState(settings.pagerduty_routing_key ?? "");
  const [emailUrl, setEmailUrl] = useState(settings.email_webhook_url ?? "");
  const [emailToken, setEmailToken] = useState(settings.email_webhook_token ?? "");
  const [emailRecipients, setEmailRecipients] = useState(settings.email_recipients ?? "");
  const [budget, setBudget] = useState(settings.budget_usd != null ? String(settings.budget_usd) : "");
  const [cap, setCap] = useState(settings.hard_cap_usd != null ? String(settings.hard_cap_usd) : "");
  const [notifyOnError, setNotifyOnError] = useState(settings.notify_on_error === 1);
  const [anomalyEnabled, setAnomalyEnabled] = useState(settings.anomaly_enabled === 1);
  const [multiplier, setMultiplier] = useState(String(settings.anomaly_multiplier ?? 3));
  const [digestEnabled, setDigestEnabled] = useState(settings.digest_enabled === 1);
  const save = useMutation({
    mutationFn: () => api("/api/cost/settings", {
      method: "PUT",
      body: JSON.stringify({
        enabled, webhook_url: webhookUrl, webhook_secret: webhookSecret,
        pagerduty_routing_key: pagerdutyKey, email_webhook_url: emailUrl, email_webhook_token: emailToken, email_recipients: emailRecipients,
        budget_usd: toNullableNumber(budget), hard_cap_usd: toNullableNumber(cap),
        notify_on_error: notifyOnError, anomaly_enabled: anomalyEnabled,
        anomaly_multiplier: Number(multiplier) || 3, digest_enabled: digestEnabled,
      }),
    }),
    onSuccess: onSaved,
  });
  return <Panel title="Alert settings" note={settings.last_alert_at ? `last alert ${formatDateTime(settings.last_alert_at)}` : "no alerts sent"}>
    <label className="flex items-center gap-2 text-[13px] text-text-2">
      <Checkbox checked={enabled} onCheckedChange={(value) => setEnabled(value === true)} />
      <span>Enable budget and anomaly alerts</span>
    </label>
    <div className="form-grid mt-2">
      <div className="grid gap-1.5"><Label htmlFor="alert-webhook">Webhook URL</Label><Input id="alert-webhook" value={webhookUrl} placeholder="Slack or generic HTTPS" onChange={(event) => setWebhookUrl(event.target.value)} /></div>
      <div className="grid gap-1.5"><Label htmlFor="alert-secret">Webhook secret</Label><Input id="alert-secret" type="password" value={webhookSecret} placeholder="adds x-torrix-signature" onChange={(event) => setWebhookSecret(event.target.value)} /></div>
      <div className="grid gap-1.5"><Label htmlFor="alert-budget">Account budget (USD)</Label><Input id="alert-budget" inputMode="decimal" value={budget} placeholder="none" onChange={(event) => setBudget(event.target.value)} /></div>
      <div className="grid gap-1.5"><Label htmlFor="alert-cap">Account hard cap (USD)</Label><Input id="alert-cap" inputMode="decimal" value={cap} placeholder="none" onChange={(event) => setCap(event.target.value)} /></div>
      <div className="grid gap-1.5"><Label htmlFor="alert-multiplier">Anomaly multiplier</Label><Input id="alert-multiplier" inputMode="decimal" value={multiplier} onChange={(event) => setMultiplier(event.target.value)} /></div>
    </div>
    <div className="form-subhead">Notification channels</div>
    <div className="form-grid">
      <div className="grid gap-1.5"><Label htmlFor="alert-pagerduty">PagerDuty routing key (optional)</Label><Input id="alert-pagerduty" type="password" value={pagerdutyKey} placeholder="Events API v2 routing key" onChange={(event) => setPagerdutyKey(event.target.value)} /></div>
      <div className="grid gap-1.5"><Label htmlFor="alert-email-url">Email gateway URL (optional)</Label><Input id="alert-email-url" value={emailUrl} placeholder="https://mailer.internal/send" onChange={(event) => setEmailUrl(event.target.value)} /></div>
      <div className="grid gap-1.5"><Label htmlFor="alert-email-token">Email gateway token (optional)</Label><Input id="alert-email-token" type="password" value={emailToken} onChange={(event) => setEmailToken(event.target.value)} /></div>
      <div className="grid gap-1.5"><Label htmlFor="alert-email-to">Email recipients</Label><Input id="alert-email-to" value={emailRecipients} placeholder="ops@example.com, oncall@example.com" onChange={(event) => setEmailRecipients(event.target.value)} /></div>
    </div>
    <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
      <label className="flex items-center gap-2 text-[13px] text-text-2"><Checkbox checked={notifyOnError} onCheckedChange={(value) => setNotifyOnError(value === true)} /><span>Notify on run errors</span></label>
      <label className="flex items-center gap-2 text-[13px] text-text-2"><Checkbox checked={anomalyEnabled} onCheckedChange={(value) => setAnomalyEnabled(value === true)} /><span>Anomaly alerts</span></label>
      <label className="flex items-center gap-2 text-[13px] text-text-2"><Checkbox checked={digestEnabled} onCheckedChange={(value) => setDigestEnabled(value === true)} /><span>Weekly digest</span></label>
    </div>
    {save.isError ? <ErrorText>{save.error.message}</ErrorText> : null}
    <div className="mt-3"><Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>Save settings</Button></div>
  </Panel>;
}

function UsagePanel({ month, usage, selected, onEdit }: { month: string; usage: CostUsageRow[]; selected: CostSelected | null; onEdit: (row: CostUsageRow) => void }) {
  const [showUnused, setShowUnused] = useState(false);
  const visible = usage.filter((row) => showUnused || row.scope !== "api_key" || Number(row.spend) > 0 || row.budget_usd != null || row.hard_cap_usd != null);
  const hidden = usage.length - visible.length;
  return <Panel flush title="Spend by scope" note={selected ? `${selected.name} · month to date` : `month to date · ${formatDate(month)}`} actions={
    <label className="flex items-center gap-2 text-[12px] text-text-2" htmlFor="co-show-unused">
      <Checkbox id="co-show-unused" checked={showUnused} onCheckedChange={(value) => setShowUnused(value === true)} />
      <span>Show unused keys{hidden && !showUnused ? ` (${hidden})` : ""}</span>
    </label>
  }>
    <div className="table-wrap"><table className="wide-table cost-usage-table" data-test="primary">
      <thead><tr><th>Scope</th><th>Name</th><th>Month spend · cap</th><th className="num">Budget</th><th /></tr></thead>
      <tbody>
        {visible.length ? visible.map((row, index) => <tr key={`${row.scope}-${row.id ?? index}`}>
          <td><span className="chip">{row.scope.replace("_", " ")}</span></td>
          <td className="tcell-primary">{row.name}</td>
          <td><CapUsage spend={row.spend} cap={row.hard_cap_usd} budget={row.budget_usd} /></td>
          <td className="num">{row.budget_usd != null ? fmtUsd(row.budget_usd) : "none"}</td>
          <td className="text-right">{row.scope === "user" ? null : <Button variant="outline" type="button" onClick={() => onEdit(row)}>Limits</Button>}</td>
        </tr>) : <EmptyRow colSpan={5}>No usage recorded yet.</EmptyRow>}
      </tbody>
    </table></div>
  </Panel>;
}

const optionalUsdSchema = z.string().refine((value) => value.trim() === "" || (Number.isFinite(Number(value)) && Number(value) >= 0), "Enter a number or leave blank");
const usageLimitSchema = z.object({ budget: optionalUsdSchema, cap: optionalUsdSchema });
type UsageLimitValues = z.infer<typeof usageLimitSchema>;

function UsageLimits({ row, onClose, onSaved }: { row: CostUsageRow; onClose: () => void; onSaved: () => void }) {
  const form = useZodForm<UsageLimitValues>(usageLimitSchema, { budget: row.budget_usd != null ? String(row.budget_usd) : "", cap: row.hard_cap_usd != null ? String(row.hard_cap_usd) : "" });
  const save = useMutation({
    mutationFn: (values: UsageLimitValues) => {
      const path = row.scope === "project" ? `/api/cost/project/${row.id}` : `/api/cost/key/${row.id}`;
      return api(path, { method: "PUT", body: JSON.stringify({ budget_usd: toNullableNumber(values.budget), hard_cap_usd: toNullableNumber(values.cap) }) });
    },
    onSuccess: onSaved,
  });
  return <FormModal title={`Limits · ${row.name}`} form={form} submitLabel="Save" pending={save.isPending} error={save.isError ? save.error.message : null} onClose={onClose} onSubmit={(values) => save.mutate(values)}>
    <TextField form={form} name="budget" label="Monthly budget (USD)" inputMode="decimal" placeholder="none" autoFocus />
    <TextField form={form} name="cap" label="Hard cap (USD)" inputMode="decimal" placeholder="none" />
  </FormModal>;
}

function PricingPanel({ onEdit }: { onEdit: (price: PricingOverride | "new") => void }) {
  const query = useQuery({ queryKey: ["pricing"], queryFn: () => api<{ prices: PricingOverride[] }>("/api/cost/pricing") });
  const client = useQueryClient();
  const remove = useMutation({ mutationFn: (model: string) => api(`/api/cost/pricing/${encodeURIComponent(model)}`, { method: "DELETE" }), onSuccess: () => void client.invalidateQueries({ queryKey: ["pricing"] }) });
  const prices = query.data?.prices ?? [];
  return <Panel flush title="Custom pricing" note={`${prices.length} overrides · per 1M tokens`} actions={<Button variant="outline" type="button" onClick={() => onEdit("new")}>Add override</Button>}>
    <div className="table-wrap"><table>
      <thead><tr><th>Model</th><th className="num">Input / 1M</th><th className="num">Output / 1M</th><th /></tr></thead>
      <tbody>
        {query.isPending ? <SkeletonRows columns={4} rows={3} /> : prices.length ? prices.map((price) => <tr key={price.model}>
          <td className="tcell-primary mono">{price.model}</td>
          <td className="num">{fmtUsd(price.input)}</td>
          <td className="num">{fmtUsd(price.output)}</td>
          <td className="text-right whitespace-nowrap">
            <Button className="mr-1.5" variant="outline" type="button" onClick={() => onEdit(price)}>Edit</Button>
            <Button variant="outline" type="button" onClick={() => remove.mutate(price.model)}>Delete</Button>
          </td>
        </tr>) : <EmptyRow colSpan={4}>Using builtin rates for every model.</EmptyRow>}
      </tbody>
    </table></div>
  </Panel>;
}

const nonNegative = z.string().refine((value) => value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0, "Enter a number");
const priceSchema = z.object({ model: z.string().trim().min(1, "Model is required"), input: nonNegative, output: nonNegative });
type PriceValues = z.infer<typeof priceSchema>;

function PriceEditor({ price, onClose }: { price: PricingOverride | null; onClose: () => void }) {
  const client = useQueryClient();
  const form = useZodForm<PriceValues>(priceSchema, { model: price?.model ?? "", input: price ? String(price.input) : "", output: price ? String(price.output) : "" });
  const save = useMutation({
    mutationFn: (values: PriceValues) => api("/api/cost/pricing", { method: "PUT", body: JSON.stringify({ model: values.model, input: Number(values.input), output: Number(values.output) }) }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["pricing"] }); onClose(); },
  });
  return <FormModal title={price ? "Edit pricing" : "New pricing override"} form={form} submitLabel="Save" pending={save.isPending} error={save.isError ? save.error.message : null} onClose={onClose} onSubmit={(values) => save.mutate(values)}>
    <TextField form={form} name="model" label="Model" placeholder="gpt-4o-mini" disabled={!!price} autoFocus />
    <TextField form={form} name="input" label="Input USD per 1M tokens" inputMode="decimal" placeholder="0.15" />
    <TextField form={form} name="output" label="Output USD per 1M tokens" inputMode="decimal" placeholder="0.60" />
  </FormModal>;
}
