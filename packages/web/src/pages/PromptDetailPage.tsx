import { Button } from "@/components/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageError, PageLoading } from "./DashboardPage";
import { api, compact, detectPromptVariables, fmtMs, fmtUsd, parseTagsText, promptTagsText, renderPromptPreview, type Prompt, type PromptStats, type PromptVersion } from "../api";
import { formatDateTime } from "../api";
import { z } from "zod";
import { EmptyRow, ErrorText, Modal, Notice, PageHead, Panel } from "../components";
import { FormModal, TextAreaField, TextField, useZodForm } from "../form";
import { useToast } from "../toast";

export default function PromptDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: ["prompt", id], queryFn: () => api<{ prompt: Prompt; versions: PromptVersion[] }>(`/api/prompts/${encodeURIComponent(id)}`) });
  const statsQuery = useQuery({ queryKey: ["prompt-stats", id], queryFn: () => api<{ stats: PromptStats }>(`/api/prompts/${encodeURIComponent(id)}/stats`) });
  const [editOpen, setEditOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState(false);

  const refresh = () => { void client.invalidateQueries({ queryKey: ["prompt", id] }); void client.invalidateQueries({ queryKey: ["prompt-stats", id] }); };
  const activate = useMutation({ mutationFn: (revision: number) => api(`/api/prompts/${encodeURIComponent(id)}/versions/${revision}/activate`, { method: "PUT" }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => api(`/api/prompts/${encodeURIComponent(id)}`, { method: "DELETE" }), onSuccess: () => navigate("/ui/prompts") });

  if (query.isPending) return <PageLoading />;
  if (query.isError) return <PageError message={query.error.message} />;
  const prompt = query.data.prompt;
  const versions = query.data.versions;
  const stats = statsQuery.data?.stats;
  const activeRevision = prompt.active_revision ?? prompt.latest_revision;
  const activeVersion = versions.find((version) => version.revision === activeRevision);
  // Bare name: the proxy resolves the active revision, so pinning it would freeze
  // the reference and surprise the next time a version is activated.
  const reference = `x-torrix-prompt: ${prompt.name}`;
  const variables = (() => {
    try {
      const parsed = JSON.parse(activeVersion?.variables ?? "[]") as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  })();
  const copy = (text: string, label: string) => { void navigator.clipboard?.writeText(text); toast.toast(`${label} copied.`, { type: "success", duration: 1500 }); };
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const curl = [
    `curl -X POST ${origin}/proxy/chat/completions \\`,
    `  -H "x-target-url: https://api.openai.com/v1/chat/completions" \\`,
    `  -H "x-upstream-authorization: Bearer $OPENAI_API_KEY" \\`,
    `  -H "x-torrix-prompt: ${prompt.name}" \\`,
    `  -H "x-torrix-prompt-vars: {\\"language\\":\\"Spanish\\"}" \\`,
    `  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello"}]}'`,
  ].join("\n");

  return <>
    <div className="rd-links"><Link className="back-link" to="/ui/prompts">← All prompts</Link></div>
    <PageHead title={prompt.name} sub={prompt.description || "No description"} actions={<>
      <Button variant="outline" type="button" title="Copy the proxy reference header" onClick={() => copy(reference, "Reference")}>Copy reference</Button>
      <Button variant="outline" type="button" onClick={() => setEditOpen(true)}>Edit</Button>
      <Button variant="outline" type="button" onClick={() => setVersionOpen(true)}>New version</Button>
      <Button variant="outline" type="button" onClick={() => setConfirmDelete(true)}>Delete</Button>
    </>} />

    {stats ? <div className="stat-tiles">
      <div className="stat-tile"><span className="st-label">Runs</span><div className="st-value">{compact(stats.runs)}</div><div className="st-sub">matching tagged runs</div></div>
      <div className="stat-tile"><span className="st-label">Spend</span><div className="st-value">{fmtUsd(stats.cost)}</div><div className="st-sub">{compact(stats.tokens)} tokens</div></div>
      <div className="stat-tile"><span className="st-label">Avg latency</span><div className="st-value">{fmtMs(stats.avgLatencyMs)}</div><div className="st-sub">across revisions</div></div>
      <div className="stat-tile"><span className="st-label">Avg score</span><div className="st-value">{stats.avgScore == null ? "-" : stats.avgScore.toFixed(2)}</div><div className="st-sub">scored runs</div></div>
    </div> : null}
    {stats && stats.runs === 0 ? <Notice>No runs reference this prompt yet. Send a request through <code>/proxy</code> with <code>x-torrix-prompt: {prompt.name}</code> and its runs appear here.</Notice> : null}

    <Panel flush title="Versions" note={`${versions.length} revisions · active r${activeRevision}`}>
      <div className="table-wrap"><table>
        <thead><tr><th className="num">Rev</th><th>Model</th><th>Note</th><th>Created</th><th /></tr></thead>
        <tbody>
          {versions.length ? versions.map((version) => <tr key={version.id}>
            <td className="num">r{version.revision}{version.revision === activeRevision ? <span className="chip ml-1.5">active</span> : null}</td>
            <td className="tnum">{version.model || "-"}</td>
            <td className="tcell-muted">{version.note || "-"}</td>
            <td className="tcell-muted tnum">{formatDateTime(version.created_at)}</td>
            <td className="text-right">{version.revision === activeRevision ? null : <Button variant="outline" type="button" disabled={activate.isPending} onClick={() => activate.mutate(version.revision)}>Activate</Button>}</td>
          </tr>) : <EmptyRow colSpan={5}>No versions.</EmptyRow>}
        </tbody>
      </table></div>
      <div className="panel-body">
        <div className="flex items-center justify-between gap-3">
          <div className="panel-note">{previewTemplate ? "PREVIEW" : "ACTIVE TEMPLATE"} · r{activeRevision}</div>
          <Button variant="outline" type="button" onClick={() => setPreviewTemplate((value) => !value)}>{previewTemplate ? "Show template" : "Preview"}</Button>
        </div>
        <pre className="rd-code mt-1.5">{previewTemplate ? renderPromptPreview(activeVersion?.template ?? "") : (activeVersion?.template ?? "(no template)")}</pre>
        <div className="panel-note mt-2">VARIABLES: {variables.length ? variables.join(", ") : "-"}</div>
      </div>
    </Panel>

    <div className="detail-grid">
      <Panel title="Use from the proxy">
        <p className="int-lead">Declare the template as the system message of any OpenAI-shaped request by passing a reference header. Variables come from a JSON header or the body field <code>prompt_vars</code>. Streamed and JSON replies both work.</p>
        <div className="int-code">
          <pre>{curl}</pre>
          <Button variant="outline" size="icon" type="button" title="Copy" aria-label="Copy curl example" onClick={() => copy(curl, "Example")}>Copy</Button>
        </div>
      </Panel>
      <Panel title="Reference" note={`uses active r${activeRevision}`}>
        <p className="int-lead">Point any /proxy call at this prompt. The latest version is used unless you pin one.</p>
        <div className="int-code">
          <pre>{reference}</pre>
          <Button variant="outline" size="icon" type="button" title="Copy" aria-label="Copy reference" onClick={() => copy(reference, "Reference")}>Copy</Button>
        </div>
      </Panel>
    </div>

    {editOpen ? <EditPrompt prompt={prompt} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); refresh(); }} /> : null}
    {versionOpen ? <AddVersion promptId={prompt.id} nextRevision={prompt.latest_revision + 1} onClose={() => setVersionOpen(false)} onSaved={() => { setVersionOpen(false); refresh(); }} /> : null}
    {confirmDelete ? <Modal title="Delete prompt" onClose={() => setConfirmDelete(false)}>
      <p>Delete <b>{prompt.name}</b> and all of its versions? This cannot be undone.</p>
      {remove.isError ? <ErrorText>{remove.error.message}</ErrorText> : null}
      <div className="modal-actions"><Button variant="outline" type="button" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="destructive" type="button" disabled={remove.isPending} onClick={() => remove.mutate()}>Delete</Button></div>
    </Modal> : null}
  </>;
}

const editPromptSchema = z.object({ name: z.string().trim().min(1, "Name is required"), description: z.string(), tags: z.string() });
type EditPromptValues = z.infer<typeof editPromptSchema>;

function EditPrompt({ prompt, onClose, onSaved }: { prompt: Prompt; onClose: () => void; onSaved: () => void }) {
  const form = useZodForm<EditPromptValues>(editPromptSchema, { name: prompt.name, description: prompt.description ?? "", tags: promptTagsText(prompt.tags) });
  const save = useMutation({
    mutationFn: (values: EditPromptValues) => api(`/api/prompts/${prompt.id}`, { method: "PATCH", body: JSON.stringify({ name: values.name, description: values.description, tags: parseTagsText(values.tags) }) }),
    onSuccess: onSaved,
  });
  return <FormModal title="Edit prompt" form={form} submitLabel="Save" pending={save.isPending} error={save.isError ? save.error.message : null} onClose={onClose} onSubmit={(values) => save.mutate(values)}>
    <TextField form={form} name="name" label="Name (slug)" autoFocus />
    <TextField form={form} name="description" label="Description" />
    <TextField form={form} name="tags" label="Tags" placeholder="product=assistant, lang=en" />
  </FormModal>;
}

const addVersionSchema = z.object({ template: z.string().trim().min(1, "Template is required"), model: z.string(), note: z.string() });
type AddVersionValues = z.infer<typeof addVersionSchema>;

function AddVersion({ promptId, nextRevision, onClose, onSaved }: { promptId: string; nextRevision: number; onClose: () => void; onSaved: () => void }) {
  const form = useZodForm<AddVersionValues>(addVersionSchema, { template: "", model: "", note: "" });
  const save = useMutation({ mutationFn: (values: AddVersionValues) => api(`/api/prompts/${promptId}/versions`, { method: "POST", body: JSON.stringify({ template: values.template, model: values.model || undefined, note: values.note || undefined }) }), onSuccess: onSaved });
  const template = form.watch("template");
  const previewVars = detectPromptVariables(template ?? "");
  return <FormModal title={`New version · r${nextRevision}`} form={form} submitLabel="Save version" pending={save.isPending} error={save.isError ? save.error.message : null} onClose={onClose} onSubmit={(values) => save.mutate(values)}>
    <TextAreaField form={form} name="template" label="Template" rows={6} autoFocus />
    <div className="panel-note -mt-2">VARIABLES: {previewVars.length ? previewVars.join(", ") : "-"}</div>
    {template ? <pre className="rd-code mb-3">{renderPromptPreview(template)}</pre> : null}
    <TextField form={form} name="model" label="Model" placeholder="gpt-4o-mini" />
    <TextField form={form} name="note" label="Note" placeholder="Tightened tone, added language var" />
  </FormModal>;
}
