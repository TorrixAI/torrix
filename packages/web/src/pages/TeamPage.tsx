import { Button } from "@/components/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { z } from "zod";
import { api, fmtUsd, type UserRecord } from "../api";
import { formatCount, formatDate } from "../api";
import { EmptyRow, ErrorText, Modal, PageHead, Panel } from "../components";
import { CheckField, FormModal, TextField, useZodForm } from "../form";

interface TeamProject { id: string; name: string; role: string; created_at: string }
interface AdminProjectRow {
  id: string;
  name: string;
  owner_email: string | null;
  members: number;
  runs: number;
  spend: number;
  budget_usd: number | null;
  hard_cap_usd: number | null;
}
interface TeamResponse {
  is_admin: boolean;
  projects: TeamProject[];
  users: UserRecord[];
  admin_projects: AdminProjectRow[];
}

export default function TeamPage() {
  const client = useQueryClient();
  const teamQuery = useQuery({ queryKey: ["team"], queryFn: () => api<TeamResponse>("/api/team") });
  const [createOpen, setCreateOpen] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<UserRecord | null>(null);

  const invalidate = () => {
    void client.invalidateQueries({ queryKey: ["team"] });
    void client.invalidateQueries({ queryKey: ["admin-users"] });
  };
  const patch = useMutation({ mutationFn: ({ id, is_admin }: { id: string; is_admin: boolean }) => api(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify({ is_admin }) }), onSuccess: () => void invalidate() });
  const remove = useMutation({ mutationFn: (id: string) => api(`/api/admin/users/${id}`, { method: "DELETE" }), onSuccess: () => { setConfirmDelete(null); void invalidate(); } });

  if (teamQuery.isPending) return <div className="startup loading-page"><span>Loading workspace members…</span></div>;
  if (teamQuery.isError) return <div className="empty mt-6.5"><span className="empty-title">Could not load team</span><span className="empty-sub">{teamQuery.error.message}</span></div>;
  const { is_admin: isAdmin, projects, users, admin_projects: adminProjects } = teamQuery.data;

  return <>
    <PageHead
      title="Team"
      sub="Project membership and account roles. Manage members per project on the Projects page."
      actions={isAdmin ? <Button type="button" onClick={() => setCreateOpen(true)}>Add user</Button> : null}
    />

    <Panel flush title="Your projects" note={`${projects.length} accessible`}>
      <div className="table-wrap"><table>
        <thead><tr><th>Project</th><th>Your role</th><th>Created</th></tr></thead>
        <tbody>
          {projects.length ? projects.map((project) => <tr key={project.id}>
            <td className="tcell-primary"><Link className="underline-offset-2 hover:underline" to="/ui/projects">{project.name}</Link></td>
            <td><span className="chip">{project.role}</span></td>
            <td className="tcell-muted tnum">{formatDate(project.created_at)}</td>
          </tr>) : <EmptyRow colSpan={3}>No projects yet.</EmptyRow>}
        </tbody>
      </table></div>
    </Panel>

    {isAdmin ? <>
      <Panel flush title="Accounts" note={`${users.length} user${users.length === 1 ? "" : "s"} · manage under Settings`}>
        <div className="table-wrap"><table>
          <thead><tr><th>Email</th><th>Role</th><th>Created</th><th /></tr></thead>
          <tbody>
            {users.map((user) => <tr key={user.id}>
              <td className="tcell-primary">{user.email}</td>
              <td>{user.is_admin === 1 ? <span className="badge accent"><span className="dot" />admin</span> : <span className="chip">member</span>}</td>
              <td className="tcell-muted tnum">{formatDate(user.created_at)}</td>
              <td className="text-right whitespace-nowrap">
                <Button className="mr-1.5" variant="outline" type="button" disabled={patch.isPending} onClick={() => patch.mutate({ id: user.id, is_admin: user.is_admin !== 1 })}>{user.is_admin === 1 ? "Revoke admin" : "Make admin"}</Button>
                <Button variant="outline" type="button" onClick={() => setConfirmDelete(user)}>Delete</Button>
              </td>
            </tr>)}
          </tbody>
        </table></div>
      </Panel>

      <Panel flush title="All projects (admin)" note="every project on this instance · spend month to date">
        <div className="table-wrap"><table>
          <thead><tr><th>Project</th><th>Owner</th><th className="num">Members</th><th className="num">Runs (month)</th><th className="num">Spend (month)</th><th className="num">Budget</th><th className="num">Hard cap</th></tr></thead>
          <tbody>
            {adminProjects.length ? adminProjects.map((row) => <tr key={row.id}>
              <td className="tcell-primary"><Link className="hover:underline" to={`/ui/runs?project=${encodeURIComponent(row.id)}`}>{row.name}</Link></td>
              <td className="tcell-muted tnum">{row.owner_email ?? row.id.slice(0, 8)}</td>
              <td className="num">{row.members}</td>
              <td className="num">{formatCount(row.runs)}</td>
              <td className="num">{fmtUsd(row.spend)}</td>
              <td className="num">{row.budget_usd == null ? "-" : fmtUsd(row.budget_usd)}</td>
              <td className="num">{row.hard_cap_usd == null ? "-" : fmtUsd(row.hard_cap_usd)}</td>
            </tr>) : <EmptyRow colSpan={7}>No projects yet.</EmptyRow>}
          </tbody>
        </table></div>
      </Panel>
    </> : null}

    {createOpen ? <CreateUser onClose={() => setCreateOpen(false)} onCreated={(key) => { setCreateOpen(false); setApiKey(key); void invalidate(); }} /> : null}
    {apiKey ? <Modal title="User created" onClose={() => setApiKey(null)}>
      <p>Share this API key with the new user. It is shown only once.</p>
      <div className="keybox"><code>{apiKey}</code><Button variant="outline" type="button" onClick={() => void navigator.clipboard?.writeText(apiKey)}>Copy key</Button></div>
      <div className="modal-actions"><Button type="button" onClick={() => setApiKey(null)}>Done</Button></div>
    </Modal> : null}
    {confirmDelete ? <Modal title="Delete user" onClose={() => setConfirmDelete(null)}>
      <p>Delete <b>{confirmDelete.email}</b>? Their projects and keys are removed.</p>
      {remove.isError ? <ErrorText>{remove.error.message}</ErrorText> : null}
      <div className="modal-actions"><Button variant="outline" type="button" onClick={() => setConfirmDelete(null)}>Cancel</Button><Button variant="destructive" type="button" disabled={remove.isPending} onClick={() => remove.mutate(confirmDelete.id)}>Delete</Button></div>
    </Modal> : null}
  </>;
}

const userSchema = z.object({
  email: z.string().trim().regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
  isAdmin: z.boolean(),
});
type UserValues = z.infer<typeof userSchema>;

function CreateUser({ onClose, onCreated }: { onClose: () => void; onCreated: (apiKey: string) => void }) {
  const form = useZodForm<UserValues>(userSchema, { email: "", password: "", isAdmin: false });
  const create = useMutation({
    mutationFn: (values: UserValues) => api<{ api_key: string }>("/api/admin/users", { method: "POST", body: JSON.stringify({ email: values.email, password: values.password, is_admin: values.isAdmin }) }),
    onSuccess: (data) => onCreated(data.api_key),
  });
  return <FormModal title="Add user" form={form} submitLabel="Create" pending={create.isPending} error={create.isError ? create.error.message : null} onClose={onClose} onSubmit={(values) => create.mutate(values)}>
    <TextField form={form} name="email" label="Email" type="email" placeholder="teammate@example.com" autoFocus />
    <TextField form={form} name="password" label="Temporary password" type="password" placeholder="at least 8 characters" />
    <CheckField form={form} name="isAdmin" label="Grant administrator" />
  </FormModal>;
}
