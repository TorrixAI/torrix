import { Button } from "@/components/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import { useState } from "react";
import { Link } from "react-router-dom";
import { z } from "zod";
import { PageError, PageLoading } from "./DashboardPage";
import { api, relTime, type ApiKeyRecord, type Project } from "../api";
import { formatDate, formatDateTime } from "../api";
import { CapUsage, EmptyRow, ErrorText, Field, Modal, PageHead, Panel, toNullableNumber } from "../components";
import { FormModal, SelectField, TextField, useZodForm } from "../form";

export default function KeysPage() {
  const client = useQueryClient();
  const [browserKey] = useState(() => {
    try {
      return localStorage.getItem("torrix_key") ?? "";
    } catch {
      return "";
    }
  });
  const [showBrowserKey, setShowBrowserKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const keysQuery = useQuery({ queryKey: ["keys"], queryFn: () => api<{ keys: ApiKeyRecord[]; active_key_id: string | null }>("/api/keys") });
  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: () => api<{ projects: Project[] }>("/api/projects") });
  // Same month-to-date numbers the Cost page shows, so a key's bar and the
  // 429 threshold agree.
  const costQuery = useQuery({
    queryKey: ["cost-settings"],
    queryFn: () => api<{ usage: Array<{ scope: string; id: string | null; spend: number }> }>("/api/cost/settings"),
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [revoke, setRevoke] = useState<ApiKeyRecord | null>(null);
  const [rotate, setRotate] = useState<ApiKeyRecord | null>(null);
  const [limits, setLimits] = useState<ApiKeyRecord | null>(null);

  const invalidate = () => client.invalidateQueries({ queryKey: ["keys"] });
  const remove = useMutation({ mutationFn: (id: string) => api(`/api/keys/${id}`, { method: "DELETE" }), onSuccess: () => { setRevoke(null); void invalidate(); } });
  const rotateKey = useMutation({
    mutationFn: (id: string) => api<{ key: string }>(`/api/keys/${id}/rotate`, { method: "POST" }),
    onSuccess: (data) => { setRotate(null); setSecret(data.key); void invalidate(); },
  });

  if (keysQuery.isPending) return <PageLoading />;
  if (keysQuery.isError) return <PageError message={keysQuery.error.message} />;
  const keys = keysQuery.data.keys;
  const projects = projectsQuery.data?.projects ?? [];
  const spendByKey = new Map((costQuery.data?.usage ?? []).filter((row) => row.scope === "api_key" && row.id).map((row) => [row.id as string, row.spend]));

  return <>
    <PageHead title="API keys" sub="Keys authenticate the proxy, ingest and the SDK. Secrets are shown once and stored hashed; rotate a key if it is lost." actions={<Button type="button" onClick={() => setCreateOpen(true)}>New key</Button>} />

    <Panel title="This browser's key" note="stored in localStorage">
      {browserKey ? <>
        <div className="keyline" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <code className="keybox" style={{ flex: 1 }}>{showBrowserKey ? browserKey : `${browserKey.slice(0, 8)}${"•".repeat(24)}`}</code>
          <Button variant="outline" type="button" onClick={() => setShowBrowserKey((value) => !value)}>{showBrowserKey ? "Hide" : "Show"}</Button>
          <Button variant="outline" type="button" onClick={() => { void navigator.clipboard?.writeText(browserKey); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? "Copied" : "Copy key"}</Button>
        </div>
        <p className="set-hint" style={{ marginBottom: 0 }}>Use it as <code className="mono">TORRIX_API_KEY</code> for the opencode plugin, or as the Bearer key for /proxy and /api/ingest.</p>
      </> : <p className="set-hint" style={{ marginBottom: 0 }}>No key stored in this browser. Sign in with an API key (or create one below) and it is saved here for the console and the snippets on Integrations.</p>}
    </Panel>

    <Panel flush title="Keys" note={`${keys.length} active · session keys end on sign-out`}>
      <div className="table-wrap"><table>
        <thead><tr><th>Key</th><th>Scope</th><th>Permission</th><th>Spend · MTD</th><th>Created</th><th>Last used</th><th /></tr></thead>
        <tbody>
          {keys.length ? keys.map((key) => <tr key={key.id}>
            <td className="min-w-0">
              <span className="tcell-primary">{key.name}{key.id === keysQuery.data.active_key_id ? <span className="chip ml-1.5" title="This browser is using this key; sign out to end the session.">active</span> : null}{Number(key.session) === 1 ? <span className="chip ml-1.5">session</span> : null}</span>
              <small className="tcell-sub mono">{key.key_prefix}…</small>
            </td>
            <td><span className="chip">{key.scope}</span></td>
            <td className="mono">{key.permission}</td>
            <td>
              {costQuery.isPending ? <span className="skeleton block h-7 w-[150px]" /> : costQuery.isError ? <span className="panel-note">—</span> : spendByKey.has(key.id) ? (
                <Link className="cap-link" to="/ui/cost" title="Month-to-date spend against this key's hard cap. Open Cost & alerts.">
                  <CapUsage spend={spendByKey.get(key.id) ?? 0} cap={key.hard_cap_usd} budget={key.budget_usd} />
                </Link>
              ) : <span className="panel-note">—</span>}
            </td>
            <td className="tcell-muted whitespace-nowrap tnum">{formatDate(key.created_at)}</td>
            <td className="tcell-muted whitespace-nowrap tnum" title={key.last_used_at ? formatDateTime(key.last_used_at) : "never used"}>{key.last_used_at ? relTime(key.last_used_at) : "never"}</td>
            <td>
              <div className="actions-end">
                <Button size="sm" variant="outline" type="button" onClick={() => setLimits(key)}>Limits</Button>
                {key.id !== keysQuery.data.active_key_id && Number(key.session) !== 1 ? <Button size="sm" variant="outline" type="button" onClick={() => setRotate(key)}>Rotate</Button> : null}
                {key.id !== keysQuery.data.active_key_id ? <Button size="sm" variant="outline" type="button" onClick={() => setRevoke(key)}>Delete</Button> : null}
              </div>
            </td>
          </tr>) : <EmptyRow colSpan={7}>No API keys yet.</EmptyRow>}
        </tbody>
      </table></div>
    </Panel>

    {createOpen ? <CreateKey projects={projects} onClose={() => setCreateOpen(false)} onCreated={(value) => { setCreateOpen(false); setSecret(value); void invalidate(); }} /> : null}
    {secret ? <Modal title="Copy your key now" onClose={() => setSecret(null)}>
      <p>The secret is shown only once. Store it somewhere safe.</p>
      <div className="keybox"><code>{secret}</code><Button variant="outline" type="button" onClick={() => void navigator.clipboard?.writeText(secret)}>Copy key</Button></div>
      <div className="modal-actions"><Button type="button" onClick={() => setSecret(null)}>Done</Button></div>
    </Modal> : null}
    {revoke ? <Modal title="Delete key" onClose={() => setRevoke(null)}>
      <p>Delete <b>{revoke.name}</b>? Applications using it will start receiving 401 immediately. The audit log keeps the record.</p>
      {remove.isError ? <ErrorText>{remove.error.message}</ErrorText> : null}
      <div className="modal-actions"><Button variant="outline" type="button" onClick={() => setRevoke(null)}>Cancel</Button><Button variant="destructive" type="button" disabled={remove.isPending} onClick={() => remove.mutate(revoke.id)}>Delete</Button></div>
    </Modal> : null}
    {rotate ? <Modal title="Rotate key" onClose={() => setRotate(null)}>
      <p>Create a new secret for <b>{rotate.name}</b> with the same scope, permissions and limits? The old key stops working immediately.</p>
      <p className="set-hint">The new secret is shown once.</p>
      {rotateKey.isError ? <ErrorText>{rotateKey.error.message}</ErrorText> : null}
      <div className="modal-actions"><Button variant="outline" type="button" onClick={() => setRotate(null)}>Cancel</Button><Button type="button" disabled={rotateKey.isPending} onClick={() => rotateKey.mutate(rotate.id)}>Rotate key</Button></div>
    </Modal> : null}
    {limits ? <LimitEditor keyRecord={limits} onClose={() => setLimits(null)} onSaved={() => { setLimits(null); void invalidate(); }} /> : null}
  </>;
}

const createKeySchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  permission: z.enum(["read_write", "read_only"]),
  scope: z.enum(["full", "projects"]),
});
type CreateKeyValues = z.infer<typeof createKeySchema>;

function CreateKey({ projects, onClose, onCreated }: { projects: Project[]; onClose: () => void; onCreated: (secret: string) => void }) {
  const form = useZodForm<CreateKeyValues>(createKeySchema, { name: "", permission: "read_write", scope: "full" });
  const [selected, setSelected] = useState<string[]>([]);
  const scope = form.watch("scope");
  const create = useMutation({
    mutationFn: (values: CreateKeyValues) => api<{ key: string }>("/api/keys", { method: "POST", body: JSON.stringify({ ...values, projects: values.scope === "projects" ? selected : undefined }) }),
    onSuccess: (data) => onCreated(data.key),
  });
  return <FormModal title="New API key" form={form} submitLabel="Create" pending={create.isPending} error={create.isError ? create.error.message : null} onClose={onClose} onSubmit={(values) => create.mutate(values)}>
    <TextField form={form} name="name" label="Name" placeholder="Production proxy" autoFocus />
    <SelectField form={form} name="permission" label="Permission" options={[{ value: "read_write", label: "read_write" }, { value: "read_only", label: "read_only" }]} />
    <SelectField form={form} name="scope" label="Scope" options={[{ value: "full", label: "full" }, { value: "projects", label: "projects" }]} />
    {scope === "projects" ? <Field label="Projects">
      <div style={{ display: "grid", gap: 6, maxHeight: 180, overflow: "auto" }}>
        {projects.length ? projects.map((project) => <div key={project.id} className="flex items-center gap-2">
          <Checkbox id={`proj-${project.id}`} checked={selected.includes(project.id)} onCheckedChange={(value) => setSelected((current) => value === true ? [...current, project.id] : current.filter((id) => id !== project.id))} />
          <label htmlFor={`proj-${project.id}`} className="text-[13px] text-text-2">{project.name}</label>
        </div>) : <span className="panel-note">No projects available.</span>}
      </div>
    </Field> : null}
  </FormModal>;
}

const optionalUsd = z.string().refine((value) => value.trim() === "" || (Number.isFinite(Number(value)) && Number(value) >= 0), "Enter a number or leave blank");
const limitSchema = z.object({ budget: optionalUsd, cap: optionalUsd });
type LimitValues = z.infer<typeof limitSchema>;

function LimitEditor({ keyRecord, onClose, onSaved }: { keyRecord: ApiKeyRecord; onClose: () => void; onSaved: () => void }) {
  const form = useZodForm<LimitValues>(limitSchema, { budget: keyRecord.budget_usd != null ? String(keyRecord.budget_usd) : "", cap: keyRecord.hard_cap_usd != null ? String(keyRecord.hard_cap_usd) : "" });
  const save = useMutation({
    mutationFn: (values: LimitValues) => api(`/api/cost/key/${keyRecord.id}`, { method: "PUT", body: JSON.stringify({ budget_usd: toNullableNumber(values.budget), hard_cap_usd: toNullableNumber(values.cap) }) }),
    onSuccess: onSaved,
  });
  return <FormModal title={`Limits · ${keyRecord.name}`} form={form} submitLabel="Save" pending={save.isPending} error={save.isError ? save.error.message : null} onClose={onClose} onSubmit={(values) => save.mutate(values)}>
    <p>Monthly budget raises a webhook alert; the hard cap rejects requests with 429.</p>
    <TextField form={form} name="budget" label="Monthly budget (USD)" inputMode="decimal" placeholder="no budget" />
    <TextField form={form} name="cap" label="Hard cap (USD)" inputMode="decimal" placeholder="no cap" />
  </FormModal>;
}
