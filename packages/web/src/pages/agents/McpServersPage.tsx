import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, fmtMs, relTime, type McpServer, type McpServerTool, type ToolPin } from "../../api";
import { EmptyRow, ErrorText, Modal, Notice, PageHead, Panel, SkeletonRows } from "../../components";
import { FormModal, SelectField, TextAreaField, TextField, useZodForm } from "../../form";
import { z } from "zod";
import { AgentNav, badgeClass } from "./shared";
import { useFeature } from "../../features";

interface TestResult {
  status: "success" | "failed";
  transport: string;
  server: string;
  server_name?: string | null;
  server_version?: string | null;
  protocol_version?: string | null;
  latency_ms: number;
  tools_count: number;
  tools?: string[];
  error?: string;
}

export default function McpServersPage() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["mcp-servers"], queryFn: () => api<{ servers: McpServer[] }>("/api/v1/mcp-servers") });
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<McpServer | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [toolsFor, setToolsFor] = useState<McpServer | null>(null);
  const invalidate = () => client.invalidateQueries({ queryKey: ["mcp-servers"] });
  const remove = useMutation({ mutationFn: (id: string) => api(`/api/v1/mcp-servers/${id}`, { method: "DELETE" }), onSuccess: () => { setConfirmDelete(null); void invalidate(); } });
  const test = useMutation({ mutationFn: (id: string) => api<{ test: TestResult }>(`/api/v1/mcp-servers/${id}/test`, { method: "POST" }), onSuccess: (data) => { setTestResult(data.test); void invalidate(); }, onError: (error: Error) => setMessage(error.message) });
  const sync = useMutation({ mutationFn: (id: string) => api<{ tools: unknown[] }>(`/api/v1/mcp-servers/${id}/sync`, { method: "POST", body: "{}" }), onSuccess: (data) => { setMessage(`Synced ${data.tools.length} tools.`); void invalidate(); }, onError: (error: Error) => setMessage(error.message) });
  const servers = query.data?.servers ?? [];

  return <>
    <PageHead title="MCP servers" sub="Remote MCP servers the governed gateway can call on an agent's behalf." actions={<Button type="button" onClick={() => setCreateOpen(true)}>Register server</Button>} />
    <AgentNav />
    {message ? <Notice>{message}</Notice> : null}
    <Panel flush title="Servers" note={`${servers.length} registered`}>
      <div className="table-wrap"><table className="table-fixed w-full mcp-table" data-test="primary">
        <colgroup>
          <col style={{ width: "29%" }} />
          <col style={{ width: "29%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "28%" }} />
        </colgroup>
        <thead><tr><th>Server</th><th>Status</th><th className="num">Tools</th><th /></tr></thead>
        <tbody>
          {query.isPending ? <SkeletonRows columns={4} rows={4} /> : servers.length ? servers.map((server) => <tr key={server.id}>
            <td className="min-w-0">
              <span className="cell-truncate tcell-primary" title={`${server.name} · ${server.slug}`}>{server.name}</span>
              <small className="cell-truncate tcell-sub">{server.slug}</small>
              <small className="cell-truncate tcell-sub mono" title={server.endpoint}>{server.endpoint}</small>
            </td>
            <td>
              <span className={badgeClass(server.status)} title={server.last_error || undefined}><span className="dot" />{server.status}</span>
              <small className="tcell-sub" style={{ display: "block" }} title={`${server.environment} · ${server.auth_type} · checked ${server.last_checked_at ? relTime(server.last_checked_at) : "never"}`}>{server.environment} · {server.auth_type} · checked {server.last_checked_at ? relTime(server.last_checked_at) : "never"}</small>
              {server.last_error ? <small className="tcell-sub" style={{ display: "block", whiteSpace: "normal", overflowWrap: "anywhere" }}>{server.last_error}</small> : null}
            </td>
            <td className="num">{server.tool_count ?? 0}</td>
            <td>
              <div className="actions-end">
              <Button size="sm" variant="outline" type="button" onClick={() => setToolsFor(server)}>Tools</Button>
              <Button size="sm" variant="outline" type="button" disabled={test.isPending} onClick={() => test.mutate(server.id)}>Test</Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button size="sm" variant="outline" type="button" aria-label={`More actions for ${server.name}`}>⋯</Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => sync.mutate(server.id)}>Sync tools</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setConfirmDelete(server)}>Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              </div>
            </td>
          </tr>) : <EmptyRow colSpan={4}>No MCP servers registered.</EmptyRow>}
        </tbody>
      </table></div>
    </Panel>
    {createOpen ? <McpServerEditor onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); void invalidate(); }} /> : null}
    {confirmDelete ? <Modal title="Delete MCP server" onClose={() => setConfirmDelete(null)}>
      <p>Delete <b>{confirmDelete.name}</b> and its synced tools?</p>
      {remove.isError ? <ErrorText>{remove.error.message}</ErrorText> : null}
      <div className="modal-actions"><Button variant="outline" type="button" onClick={() => setConfirmDelete(null)}>Cancel</Button><Button variant="destructive" type="button" disabled={remove.isPending} onClick={() => remove.mutate(confirmDelete.id)}>Delete</Button></div>
    </Modal> : null}
    {toolsFor ? <ToolsModal server={toolsFor} onClose={() => setToolsFor(null)} onSynced={() => void invalidate()} /> : null}
    {testResult ? <Modal title="Connection test" onClose={() => setTestResult(null)}>
      <p className="panel-note mt-0">{testResult.status === "success" ? "Connected" : "Failed"} · {testResult.transport} · {fmtMs(testResult.latency_ms)}{testResult.protocol_version ? ` · ${testResult.protocol_version}` : ""}</p>
      {testResult.status === "success" ? <Notice>{testResult.tools_count} tools discovered{testResult.server_name ? ` on ${testResult.server_name}` : ""}.</Notice> : <ErrorText>{testResult.error || "connection failed"}</ErrorText>}
      <div className="modal-actions"><Button type="button" onClick={() => setTestResult(null)}>Close</Button></div>
    </Modal> : null}
  </>;
}

const mcpServerSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  endpoint: z.string().trim().min(1, "Endpoint is required"),
  environment: z.string().trim().min(1, "Environment is required"),
  authType: z.enum(["none", "bearer", "api_key", "custom_headers"]),
  token: z.string(),
  header: z.string(),
  value: z.string(),
  headers: z.string(),
});
type McpServerValues = z.infer<typeof mcpServerSchema>;

function McpServerEditor({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const form = useZodForm<McpServerValues>(mcpServerSchema, { name: "", endpoint: "", environment: "production", authType: "none", token: "", header: "x-api-key", value: "", headers: "" });
  const authType = form.watch("authType");
  const create = useMutation({
    mutationFn: (values: McpServerValues) => {
      const auth = values.authType === "bearer" ? { token: values.token } : values.authType === "api_key" ? { header: values.header, value: values.value } : values.authType === "custom_headers" ? { headers: Object.fromEntries(values.headers.split("\n").map((line) => line.split(":").map((part) => part.trim())).filter((pair) => pair.length === 2 && pair[0])) } : undefined;
      return api("/api/v1/mcp-servers", { method: "POST", body: JSON.stringify({ name: values.name, endpoint: values.endpoint, environment: values.environment, auth_type: values.authType, auth }) });
    },
    onSuccess: onSaved,
  });
  return <FormModal title="Register MCP server" form={form} submitLabel="Register" pending={create.isPending} error={create.isError ? create.error.message : null} onClose={onClose} onSubmit={(values) => create.mutate(values)}>
    <div className="grid-2-12">
      <TextField form={form} name="name" label="Name" placeholder="Everything server" autoFocus />
      <TextField form={form} name="environment" label="Environment" placeholder="production" />
    </div>
    <TextField form={form} name="endpoint" label="Endpoint" placeholder="https://host/mcp" />
    <SelectField form={form} name="authType" label="Auth type" options={[{ value: "none", label: "none" }, { value: "bearer", label: "bearer" }, { value: "api_key", label: "api_key" }, { value: "custom_headers", label: "custom_headers" }]} />
    {authType === "bearer" ? <TextField form={form} name="token" label="Token" type="password" placeholder="bearer token" /> : null}
    {authType === "api_key" ? <>
      <TextField form={form} name="header" label="Header" placeholder="x-api-key" />
      <TextField form={form} name="value" label="Value" type="password" placeholder="secret value" />
    </> : null}
    {authType === "custom_headers" ? <TextAreaField form={form} name="headers" label="Headers (one per line, name: value)" rows={3} placeholder="X-Api-Key: value" /> : null}
  </FormModal>;
}

/** Discovered tools, with pin state: a pinned definition that changes is held at the gateway. */
function ToolsModal({ server, onClose, onSynced }: { server: McpServer; onClose: () => void; onSynced: () => void }) {
  const client = useQueryClient();
  const { allowed: pinning } = useFeature("tool-pinning");
  const query = useQuery({
    queryKey: ["mcp-server", server.id],
    queryFn: () => api<{ server: McpServer; tools: McpServerTool[]; tool_pins: ToolPin[]; drift_count: number }>(`/api/v1/mcp-servers/${server.id}`),
  });
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: ["mcp-server", server.id] });
    onSynced();
  };
  const pin = useMutation({
    mutationFn: (tools: string[]) => api(`/api/v1/mcp-servers/${server.id}/tools/pin`, { method: "POST", body: JSON.stringify({ tools }) }),
    onSuccess: invalidate,
  });
  const sync = useMutation({
    mutationFn: () => api<{ tools: McpServerTool[] }>(`/api/v1/mcp-servers/${server.id}/sync`, { method: "POST", body: "{}" }),
    onSuccess: invalidate,
  });
  const tools = query.data?.tools ?? [];
  const pins = new Map((query.data?.tool_pins ?? []).map((entry) => [entry.tool_name, entry]));
  const drift = query.data?.drift_count ?? 0;

  return <Modal title={`Discovered tools · ${server.name}`} onClose={onClose}>
    <div className="flex flex-wrap items-center gap-3">
      <span className="panel-note">{tools.length} tools · {pins.size} pinned{drift ? ` · ${drift} drifted` : ""}</span>
      <Button variant="outline" type="button" disabled={sync.isPending} onClick={() => sync.mutate()}>{sync.isPending ? "Syncing…" : "Sync"}</Button>
      {pinning ? <Button variant="outline" type="button" disabled={pin.isPending || !tools.length} onClick={() => pin.mutate([])}>Pin all tools</Button> : null}
    </div>
    {pinning ? <p className="panel-note">Pinned tools are held at the gateway (tool_definition_changed) if their name, description, schema or annotations change, until an administrator re-approves them.</p>
      : <div className="mt-2"><Notice>Tool-definition pinning is part of Enterprise. Tools are listed here, but drift is not enforced on this edition.</Notice></div>}
    {pin.isError ? <ErrorText>{pin.error.message}</ErrorText> : null}
    {sync.isError ? <ErrorText>{sync.error.message}</ErrorText> : null}
    <div className="table-wrap" style={{ maxHeight: 360, overflow: "auto" }}>
      <table>
        <thead><tr><th>Tool</th><th>Definition</th><th /></tr></thead>
        <tbody>
          {query.isPending ? <EmptyRow colSpan={3}>Loading…</EmptyRow> : tools.length ? tools.map((tool) => {
            const entry = pins.get(tool.name);
            return <tr key={tool.id}>
              <td><span className="tcell-primary mono">{tool.name}</span>{tool.description ? <small className="tcell-sub">{tool.description}</small> : null}</td>
              <td>{entry
                ? entry.drift_at
                  ? <span className={badgeClass("blocked")} title={entry.drift_reason ?? ""}><span className="dot" />definition changed</span>
                  : <span className={badgeClass("active")} title={`pinned ${relTime(entry.pinned_at)}`}><span className="dot" />pinned</span>
                : <span className="panel-note">not pinned</span>}</td>
              <td className="text-right">{pinning ? <Button variant="outline" type="button" disabled={pin.isPending} onClick={() => pin.mutate([tool.name])}>{entry ? "Re-pin" : "Pin"}</Button> : null}</td>
            </tr>;
          }) : <EmptyRow colSpan={3}>No tools discovered yet. Run Sync after the server answers.</EmptyRow>}
        </tbody>
      </table>
    </div>
    <div className="modal-actions"><Button type="button" onClick={onClose}>Close</Button></div>
  </Modal>;
}
