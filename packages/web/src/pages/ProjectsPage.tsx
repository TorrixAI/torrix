import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import { api, fmtUsd, type OnlineEvalConfig, type Project, type ProjectMember } from "../api";
import { formatDate } from "../api";
import { EmptyRow, ErrorText, Field, InlineSelect, Modal, Notice, PageHead, Panel, toNullableNumber } from "../components";
import { FormModal, TextField, useZodForm } from "../form";

interface OnlineEvalResponse {
  config: OnlineEvalConfig | null;
  datasets: { id: string; name: string }[];
  edition_enabled: boolean;
}

export default function ProjectsPage() {
  const client = useQueryClient();
  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: () => api<{ projects: Project[] }>("/api/projects") });
  const [selected, setSelected] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [rename, setRename] = useState<Project | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null);

  const invalidate = () => client.invalidateQueries({ queryKey: ["projects"] });
  const remove = useMutation({ mutationFn: (id: string) => api(`/api/projects/${id}`, { method: "DELETE" }), onSuccess: () => { setConfirmDelete(null); setSelected(null); void invalidate(); } });

  if (projectsQuery.isPending) return <div className="startup loading-page"><span>Loading projects…</span></div>;
  const projects = projectsQuery.data?.projects ?? [];
  const activeId = selected ?? projects[0]?.id ?? null;
  const active = projects.find((project) => project.id === activeId) ?? null;

  return <>
    <PageHead title="Projects" sub="Group runs, keys and budgets. Members share access with owner, editor or viewer roles." actions={<Button type="button" onClick={() => setCreateOpen(true)}>New project</Button>} />
    <Panel flush title="Projects" note={`${projects.length} total`}>
      <div className="table-wrap"><table>
        <thead><tr><th>Name</th><th>Role</th><th className="num">Budget</th><th className="num">Hard cap</th><th>Created</th><th /></tr></thead>
        <tbody>
          {projects.length ? projects.map((project) => <tr key={project.id} className="clickable" style={project.id === activeId ? { background: "var(--row-hover)" } : undefined} onClick={() => setSelected(project.id)}>
            <td className="tcell-primary">{project.name}</td>
            <td><span className="chip">{project.role ?? "owner"}</span></td>
            <td className="num">{project.budget_usd != null ? fmtUsd(project.budget_usd) : "none"}</td>
            <td className="num">{project.hard_cap_usd != null ? fmtUsd(project.hard_cap_usd) : "none"}</td>
            <td className="tcell-muted tnum">{formatDate(project.created_at)}</td>
            <td className="text-right whitespace-nowrap" onClick={(event) => event.stopPropagation()}>
              <Button className="mr-1.5" variant="outline" type="button" disabled={project.role !== "owner"} onClick={() => setRename(project)}>Rename</Button>
              <Button variant="outline" type="button" disabled={project.role !== "owner"} onClick={() => setConfirmDelete(project)}>Delete</Button>
            </td>
          </tr>) : <EmptyRow colSpan={6}>No projects yet.</EmptyRow>}
        </tbody>
      </table></div>
    </Panel>

    {active ? <ProjectDetail key={active.id} project={active} onChanged={() => void invalidate()} /> : null}

    {createOpen ? <CreateProject onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); void invalidate(); }} /> : null}
    {rename ? <RenameProject project={rename} onClose={() => setRename(null)} onSaved={() => { setRename(null); void invalidate(); }} /> : null}
    {confirmDelete ? <Modal title="Delete project" onClose={() => setConfirmDelete(null)}>
      <p>Delete <b>{confirmDelete.name}</b> and all of its runs? This cannot be undone.</p>
      {remove.isError ? <ErrorText>{remove.error.message}</ErrorText> : null}
      <div className="modal-actions"><Button variant="outline" type="button" onClick={() => setConfirmDelete(null)}>Cancel</Button><Button variant="destructive" type="button" disabled={remove.isPending} onClick={() => remove.mutate(confirmDelete.id)}>Delete</Button></div>
    </Modal> : null}
  </>;
}

function ProjectDetail({ project, onChanged }: { project: Project; onChanged: () => void }) {
  const membersQuery = useQuery({ queryKey: ["project-members", project.id], queryFn: () => api<{ members: ProjectMember[] }>(`/api/projects/${project.id}/members`) });
  const owner = project.role === "owner";
  return <>
    <LimitsPanel project={project} disabled={!owner} onSaved={onChanged} />
    <MembersPanel project={project} owner={owner} members={membersQuery.data?.members ?? []} loading={membersQuery.isPending} />
    <OnlineEvalPanel project={project} />
  </>;
}

function LimitsPanel({ project, disabled, onSaved }: { project: Project; disabled: boolean; onSaved: () => void }) {
  const [budget, setBudget] = useState(project.budget_usd != null ? String(project.budget_usd) : "");
  const [cap, setCap] = useState(project.hard_cap_usd != null ? String(project.hard_cap_usd) : "");
  const [mode, setMode] = useState(project.prompt_compression ?? "off");
  const [words, setWords] = useState(project.compression_words ?? "");
  const save = useMutation({
    mutationFn: () => api(`/api/cost/project/${project.id}`, { method: "PUT", body: JSON.stringify({ budget_usd: toNullableNumber(budget), hard_cap_usd: toNullableNumber(cap), prompt_compression: mode, compression_words: words || null }) }),
    onSuccess: onSaved,
  });
  return <Panel title={`Limits · ${project.name}`} note={disabled ? "owner only" : undefined} actions={save.isSuccess ? <span className="badge good"><span className="dot" />saved</span> : undefined}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
      <Field label="Monthly budget (USD)"><Input value={budget} disabled={disabled} inputMode="decimal" placeholder="none" onChange={(event) => setBudget(event.target.value)} /></Field>
      <Field label="Hard cap (USD)"><Input value={cap} disabled={disabled} inputMode="decimal" placeholder="none" onChange={(event) => setCap(event.target.value)} /></Field>
      <Field label="Prompt compression"><InlineSelect value={mode} disabled={disabled} onValueChange={setMode} options={[{ value: "off", label: "off" }, { value: "conservative", label: "conservative" }, { value: "balanced", label: "balanced" }]} /></Field>
    </div>
    <Field label="Custom words to preserve (comma separated)"><Textarea value={words} disabled={disabled} rows={2} onChange={(event) => setWords(event.target.value)} /></Field>
    {save.isError ? <ErrorText>{save.error.message}</ErrorText> : null}
    <div className="action-row mt-3"><Button variant="outline" type="button" disabled={disabled || save.isPending} onClick={() => save.mutate()}>Save limits</Button></div>
  </Panel>;
}

function MembersPanel({ project, owner, members, loading }: { project: Project; owner: boolean; members: ProjectMember[]; loading: boolean }) {
  const client = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const invalidate = () => client.invalidateQueries({ queryKey: ["project-members", project.id] });
  const add = useMutation({ mutationFn: () => api(`/api/projects/${project.id}/members`, { method: "POST", body: JSON.stringify({ email, role }) }), onSuccess: () => { setEmail(""); void invalidate(); } });
  const setMemberRole = useMutation({ mutationFn: ({ userId, value }: { userId: string; value: string }) => api(`/api/projects/${project.id}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ role: value }) }), onSuccess: () => void invalidate() });
  const remove = useMutation({ mutationFn: (userId: string) => api(`/api/projects/${project.id}/members/${userId}`, { method: "DELETE" }), onSuccess: () => void invalidate() });
  return <Panel flush title={`Members · ${project.name}`} note={`${members.length} with access`}>
    <div className="table-wrap"><table>
      <thead><tr><th>Email</th><th>Role</th><th /></tr></thead>
      <tbody>
        {loading ? <EmptyRow colSpan={3}>Loading…</EmptyRow> : members.length ? members.map((member) => <tr key={member.user_id}>
          <td className="tcell-primary">{member.email}</td>
          <td>{member.role === "owner" ? <span className="chip">owner</span> : <InlineSelect className="w-[120px]" disabled={!owner} value={member.role} onValueChange={(value) => setMemberRole.mutate({ userId: member.user_id, value })} options={[{ value: "editor", label: "editor" }, { value: "viewer", label: "viewer" }]} />}</td>
          <td className="text-right">{member.role === "owner" ? null : <Button variant="outline" type="button" disabled={!owner} onClick={() => remove.mutate(member.user_id)}>Remove</Button>}</td>
        </tr>) : <EmptyRow colSpan={3}>No members yet.</EmptyRow>}
      </tbody>
    </table></div>
    {owner ? <div className="panel-body">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 140px auto", gap: 10, alignItems: "end" }}>
        <Field label="Invite by email"><Input type="email" value={email} placeholder="teammate@example.com" onChange={(event) => setEmail(event.target.value)} /></Field>
        <Field label="Role"><InlineSelect value={role} onValueChange={setRole} options={[{ value: "viewer", label: "viewer" }, { value: "editor", label: "editor" }]} /></Field>
        <Button variant="outline" type="button" disabled={add.isPending || !email.trim()} onClick={() => add.mutate()}>Add</Button>
      </div>
      {add.isError ? <ErrorText>{add.error.message}</ErrorText> : null}
    </div> : null}
  </Panel>;
}

function OnlineEvalPanel({ project }: { project: Project }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["online-eval", project.id], queryFn: () => api<OnlineEvalResponse>(`/api/projects/${project.id}/online-eval`) });
  const config = query.data?.config ?? null;
  const [enabled, setEnabled] = useState(false);
  const [datasetId, setDatasetId] = useState("");
  const [scorer, setScorer] = useState("exact");
  const [judgeEnabled, setJudgeEnabled] = useState(false);
  const [criteria, setCriteria] = useState("");
  useEffect(() => {
    setEnabled(config?.enabled === 1);
    setDatasetId(config?.dataset_id ?? "");
    setScorer(config?.scorer ?? "exact");
    setJudgeEnabled(config?.judge_enabled === 1);
    setCriteria(config?.judge_criteria ?? "");
  }, [config?.id, config?.enabled, config?.dataset_id, config?.scorer, config?.judge_enabled, config?.judge_criteria]);
  const save = useMutation({ mutationFn: () => api(`/api/projects/${project.id}/online-eval`, { method: "PUT", body: JSON.stringify({ enabled, dataset_id: datasetId || null, scorer, judge_enabled: judgeEnabled, judge_criteria: criteria || null }) }), onSuccess: () => void client.invalidateQueries({ queryKey: ["online-eval", project.id] }) });
  const clear = useMutation({ mutationFn: () => api(`/api/projects/${project.id}/online-eval`, { method: "DELETE" }), onSuccess: () => void client.invalidateQueries({ queryKey: ["online-eval", project.id] }) });
  const editionEnabled = query.data?.edition_enabled ?? false;
  return <Panel title={`Online eval · ${project.name}`} note={editionEnabled ? undefined : "pro and cloud only"}>
    {!editionEnabled ? <Notice>Online evaluations require a pro or cloud edition.</Notice> : <>
      <div className="flex items-center gap-2"><Checkbox id="cb-2" checked={enabled} onCheckedChange={(value) => setEnabled(value === true)} /><label htmlFor="cb-2" className="text-[13px] text-text-2">Judge every run against a dataset</label></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12, marginTop: 6 }}>
        <Field label="Dataset"><InlineSelect value={datasetId} onValueChange={setDatasetId} options={[{ value: "", label: "none" }, ...(query.data?.datasets ?? []).map((dataset) => ({ value: dataset.id, label: dataset.name }))]} /></Field>
        <Field label="Scorer"><InlineSelect value={scorer} onValueChange={setScorer} options={[{ value: "exact", label: "exact" }, { value: "contains", label: "contains" }, { value: "judge", label: "judge" }]} /></Field>
      </div>
      {scorer === "judge" ? <>
        <div className="flex items-center gap-2"><Checkbox id="cb-3" checked={judgeEnabled} onCheckedChange={(value) => setJudgeEnabled(value === true)} /><label htmlFor="cb-3" className="text-[13px] text-text-2">Use the judge settings</label></div>
        <Field label="Judge criteria"><Textarea value={criteria} rows={2} onChange={(event) => setCriteria(event.target.value)} /></Field>
      </> : null}
      {(save.isError || clear.isError) ? <ErrorText>{(save.error ?? clear.error)?.message}</ErrorText> : null}
      <div className="action-row mt-3">
        <Button variant="outline" type="button" disabled={save.isPending} onClick={() => save.mutate()}>Save</Button>
        {config ? <Button variant="outline" type="button" disabled={clear.isPending} onClick={() => clear.mutate()}>Disable</Button> : null}
      </div>
    </>}
  </Panel>;
}

const projectNameSchema = z.object({ name: z.string().trim().min(1, "Name is required") });
type ProjectNameValues = z.infer<typeof projectNameSchema>;

function CreateProject({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const form = useZodForm<ProjectNameValues>(projectNameSchema, { name: "" });
  const create = useMutation({ mutationFn: (values: ProjectNameValues) => api("/api/projects", { method: "POST", body: JSON.stringify(values) }), onSuccess: onCreated });
  return <FormModal title="New project" form={form} submitLabel="Create" pending={create.isPending} error={create.isError ? create.error.message : null} onClose={onClose} onSubmit={(values) => create.mutate(values)}>
    <TextField form={form} name="name" label="Name" placeholder="Support bot" autoFocus />
  </FormModal>;
}

function RenameProject({ project, onClose, onSaved }: { project: Project; onClose: () => void; onSaved: () => void }) {
  const form = useZodForm<ProjectNameValues>(projectNameSchema, { name: project.name });
  const save = useMutation({ mutationFn: (values: ProjectNameValues) => api(`/api/projects/${project.id}`, { method: "PATCH", body: JSON.stringify(values) }), onSuccess: onSaved });
  return <FormModal title="Rename project" form={form} submitLabel="Save" pending={save.isPending} error={save.isError ? save.error.message : null} onClose={onClose} onSubmit={(values) => save.mutate(values)}>
    <TextField form={form} name="name" label="Name" autoFocus />
  </FormModal>;
}
