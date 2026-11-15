import { Button } from "@/components/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageError, PageLoading } from "./DashboardPage";
import { api, fmtMs, fmtUsd, type Dataset, type DatasetRow, type Eval, type EvalResult } from "../api";
import { formatDateTime } from "../api";
import { EmptyRow, ErrorText, Modal, PageHead, Panel } from "../components";
import { FormModal, SelectField, TextAreaField, TextField, useZodForm } from "../form";
import { z } from "zod";

function parseTags(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return value.split(",").map((tag) => tag.trim()).filter(Boolean);
  }
}

export default function DatasetDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["dataset", id],
    queryFn: () => api<{ dataset: Dataset; rows: DatasetRow[]; evals: Eval[] }>(`/api/datasets/${encodeURIComponent(id)}`),
    refetchInterval: (result) => (result.state.data?.evals ?? []).some((evaluation) => evaluation.status === "running") ? 2000 : false,
  });
  const [rowModal, setRowModal] = useState<{ mode: "add" } | { mode: "edit"; row: DatasetRow } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [evalOpen, setEvalOpen] = useState(false);
  const [resultsFor, setResultsFor] = useState<Eval | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editMeta, setEditMeta] = useState(false);

  const refresh = () => void client.invalidateQueries({ queryKey: ["dataset", id] });
  const removeDataset = useMutation({ mutationFn: () => api(`/api/datasets/${encodeURIComponent(id)}`, { method: "DELETE" }), onSuccess: () => navigate("/ui/datasets") });
  const removeRow = useMutation({ mutationFn: (rowId: string) => api(`/api/dataset-rows/${rowId}`, { method: "DELETE" }), onSuccess: refresh });

  if (query.isPending) return <PageLoading />;
  if (query.isError) return <PageError message={query.error.message} />;
  const { dataset, rows, evals } = query.data;

  return <>
    <div className="rd-links"><Link className="back-link" to="/ui/datasets">← All datasets</Link></div>
    <PageHead title={dataset.name} sub={dataset.description || "No description"} actions={<>
      <Button variant="outline" type="button" onClick={() => setEditMeta(true)}>Edit</Button>
      <Button variant="outline" type="button" onClick={() => setRowModal({ mode: "add" })}>Add row</Button>
      <Button variant="outline" type="button" onClick={() => setImportOpen(true)}>Import</Button>
      <Button type="button" onClick={() => setEvalOpen(true)} disabled={!rows.length}>Run eval</Button>
      <Button variant="outline" type="button" onClick={() => setConfirmDelete(true)}>Delete</Button>
    </>} />

    <Panel flush title="Rows" note={`${rows.length} rows`}>
      <div className="table-wrap"><table>
        <thead><tr><th className="num">#</th><th>Input</th><th>Expected</th><th>Tags</th><th /></tr></thead>
        <tbody>
          {rows.length ? rows.map((row, index) => <tr key={row.id}>
            <td className="num">{index + 1}</td>
            <td className="tnum" style={{ maxWidth: 420, whiteSpace: "normal" }}>{row.input}</td>
            <td className="tnum" style={{ maxWidth: 320, whiteSpace: "normal", color: "var(--text-3)" }}>{row.expected || "-"}</td>
            <td>{parseTags(row.tags).map((tag) => <span key={tag} className="chip mr-1">{tag}</span>)}</td>
            <td className="text-right whitespace-nowrap">
              <Button className="mr-1.5" variant="outline" type="button" onClick={() => setRowModal({ mode: "edit", row })}>Edit</Button>
              <Button variant="outline" type="button" onClick={() => removeRow.mutate(row.id)}>Delete</Button>
            </td>
          </tr>) : <EmptyRow colSpan={5}>No rows yet. Add one or import a CSV.</EmptyRow>}
        </tbody>
      </table></div>
    </Panel>

    <Panel flush title="Evaluations" note={`${evals.length} runs`}>
      <div className="table-wrap"><table>
        <thead><tr><th>Mode</th><th>Scorer</th><th>Status</th><th className="num">Progress</th><th className="num">Pass / fail</th><th className="num">Score</th><th className="num">Cost</th><th>Started</th><th /></tr></thead>
        <tbody>
          {evals.length ? evals.map((evaluation) => <tr key={evaluation.id}>
            <td><span className="chip">{evaluation.mode}</span></td>
            <td className="tnum">{evaluation.scorer}</td>
            <td><span className={`badge ${evaluation.status === "failed" ? "bad" : evaluation.status === "done" ? "good" : "accent"}`}><span className="dot" />{evaluation.status}</span></td>
            <td className="num">{evaluation.rows_done}/{evaluation.total_rows}</td>
            <td className="num">{evaluation.passed} / {evaluation.fail}</td>
            <td className="num">{evaluation.rows_done ? (evaluation.score_sum / evaluation.rows_done).toFixed(2) : "-"}</td>
            <td className="num">{fmtUsd(evaluation.cost_usd)}</td>
            <td className="tcell-muted tnum">{formatDateTime(evaluation.created_at)}</td>
            <td className="text-right"><Button variant="outline" type="button" onClick={() => setResultsFor(evaluation)}>Results</Button></td>
          </tr>) : <EmptyRow colSpan={9}>No evaluations yet.</EmptyRow>}
        </tbody>
      </table></div>
    </Panel>

    {rowModal ? <RowEditor datasetId={dataset.id} row={rowModal.mode === "edit" ? rowModal.row : null} onClose={() => setRowModal(null)} onSaved={() => { setRowModal(null); refresh(); }} /> : null}
    {importOpen ? <ImportRows datasetId={dataset.id} onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); refresh(); }} /> : null}
    {evalOpen ? <StartEval datasetId={dataset.id} onClose={() => setEvalOpen(false)} onStarted={() => { setEvalOpen(false); refresh(); }} /> : null}
    {resultsFor ? <EvalResultsModal evalRecord={resultsFor} onClose={() => setResultsFor(null)} /> : null}
    {editMeta ? <EditDataset dataset={dataset} onClose={() => setEditMeta(false)} onSaved={() => { setEditMeta(false); refresh(); }} /> : null}
    {confirmDelete ? <Modal title="Delete dataset" onClose={() => setConfirmDelete(false)}>
      <p>Delete <b>{dataset.name}</b>, its rows and evaluations? This cannot be undone.</p>
      {removeDataset.isError ? <ErrorText>{removeDataset.error.message}</ErrorText> : null}
      <div className="modal-actions"><Button variant="outline" type="button" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="destructive" type="button" disabled={removeDataset.isPending} onClick={() => removeDataset.mutate()}>Delete</Button></div>
    </Modal> : null}
  </>;
}

const rowSchema = z.object({ input: z.string().trim().min(1, "Input is required"), expected: z.string(), tags: z.string() });
type RowValues = z.infer<typeof rowSchema>;

function RowEditor({ datasetId, row, onClose, onSaved }: { datasetId: string; row: DatasetRow | null; onClose: () => void; onSaved: () => void }) {
  const form = useZodForm<RowValues>(rowSchema, { input: row?.input ?? "", expected: row?.expected ?? "", tags: parseTags(row?.tags).join(", ") });
  const save = useMutation({
    mutationFn: (values: RowValues) => {
      const body = { input: values.input, expected: values.expected, tags: values.tags.split(",").map((tag) => tag.trim()).filter(Boolean) };
      return row ? api(`/api/dataset-rows/${row.id}`, { method: "PUT", body: JSON.stringify(body) }) : api(`/api/datasets/${datasetId}/rows`, { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: onSaved,
  });
  return <FormModal title={row ? `Edit row #${row.idx}` : "Add row"} form={form} submitLabel={row ? "Save" : "Add row"} pending={save.isPending} error={save.isError ? save.error.message : null} onClose={onClose} onSubmit={(values) => save.mutate(values)}>
    <TextAreaField form={form} name="input" label="Input" rows={3} placeholder="How do I reset my password?" autoFocus />
    <TextAreaField form={form} name="expected" label="Expected answer" rows={2} placeholder="You can reset it in Settings > Security" />
    <TextField form={form} name="tags" label="Tags (comma separated)" placeholder="refund, billing" />
  </FormModal>;
}

const importRowsSchema = z.object({ csv: z.string(), json: z.string() }).refine((values) => values.csv.trim() || values.json.trim(), { message: "Provide CSV or JSON", path: ["csv"] });
type ImportRowsValues = z.infer<typeof importRowsSchema>;

function ImportRows({ datasetId, onClose, onDone }: { datasetId: string; onClose: () => void; onDone: () => void }) {
  const form = useZodForm<ImportRowsValues>(importRowsSchema, { csv: "", json: "" });
  const importRows = useMutation({
    mutationFn: (values: ImportRowsValues) => {
      if (values.json.trim()) {
        const rows = JSON.parse(values.json) as unknown;
        return api(`/api/datasets/${datasetId}/rows/import`, { method: "POST", body: JSON.stringify({ rows }) });
      }
      return api(`/api/datasets/${datasetId}/rows/import`, { method: "POST", body: JSON.stringify({ csv: values.csv }) });
    },
    onSuccess: onDone,
  });
  return <FormModal title="Import rows" form={form} submitLabel="Import" pending={importRows.isPending} error={importRows.isError ? (importRows.error.message === "SyntaxError" ? "Invalid JSON" : importRows.error.message) : null} onClose={onClose} onSubmit={(values) => importRows.mutate(values)}>
    <TextAreaField form={form} name="csv" label="CSV (input,expected,tags)" rows={5} placeholder={"What is 2+2?,4,math\nRefund policy?,30 days,billing"} autoFocus />
    <TextAreaField form={form} name="json" label="or JSON array" rows={3} placeholder={'[{"input":"...","expected":"...","tags":["a"]}]'} />
  </FormModal>;
}

const startEvalSchema = z.object({
  mode: z.enum(["offline", "online"]),
  scorer: z.enum(["exact", "contains"]),
  provider: z.string(),
  model: z.string(),
  targetUrl: z.string(),
  apiKey: z.string(),
  temperature: z.string(),
  maxTokens: z.string(),
}).refine((values) => values.mode === "offline" || (values.model.trim() !== "" && values.apiKey.trim() !== ""), { message: "Model and API key are required for online evals", path: ["model"] });
type StartEvalValues = z.infer<typeof startEvalSchema>;

function StartEval({ datasetId, onClose, onStarted }: { datasetId: string; onClose: () => void; onStarted: () => void }) {
  const form = useZodForm<StartEvalValues>(startEvalSchema, { mode: "offline", scorer: "exact", provider: "openai", model: "", targetUrl: "", apiKey: "", temperature: "0.2", maxTokens: "512" });
  const mode = form.watch("mode");
  const start = useMutation({
    mutationFn: (values: StartEvalValues) => api(`/api/datasets/${datasetId}/evaluations`, {
      method: "POST",
      body: JSON.stringify(values.mode === "offline"
        ? { mode: values.mode, scorer: values.scorer }
        : {
            mode: values.mode,
            scorer: values.scorer,
            provider: values.provider,
            model: values.model,
            target_url: values.targetUrl || undefined,
            api_key: values.apiKey,
            temperature: Number(values.temperature) || 0.2,
            max_tokens: Number(values.maxTokens) || 512,
          }),
    }),
    onSuccess: onStarted,
  });
  return <FormModal title="Run evaluation" form={form} submitLabel="Start" pending={start.isPending} error={start.isError ? start.error.message : null} onClose={onClose} onSubmit={(values) => start.mutate(values)}>
    <SelectField form={form} name="mode" label="Mode" options={[{ value: "offline", label: "offline (score captured runs)" }, { value: "online", label: "online (call a model per row)" }]} />
    <SelectField form={form} name="scorer" label="Scorer" options={[{ value: "exact", label: "exact" }, { value: "contains", label: "contains" }]} />
    {mode === "online" ? <>
      <TextField form={form} name="provider" label="Provider" />
      <TextField form={form} name="model" label="Model" placeholder="gpt-4o-mini" />
      <TextField form={form} name="targetUrl" label="Target URL" placeholder="https://api.openai.com/v1/chat/completions" />
      <TextField form={form} name="apiKey" label="API key" type="password" placeholder="held in memory only" />
      <div className="grid grid-cols-2 gap-3">
        <TextField form={form} name="temperature" label="Temperature" inputMode="decimal" placeholder="0.2" />
        <TextField form={form} name="maxTokens" label="Max tokens" inputMode="numeric" placeholder="512" />
      </div>
    </> : null}
  </FormModal>;
}

function EvalResultsModal({ evalRecord, onClose }: { evalRecord: Eval; onClose: () => void }) {
  const query = useQuery({
    queryKey: ["eval", evalRecord.id],
    queryFn: () => api<{ eval: Eval; results: EvalResult[] }>(`/api/evals/${evalRecord.id}`),
    refetchInterval: (result) => (result.state.data?.eval.status === "running" ? 2000 : false),
  });
  const results = query.data?.results ?? [];
  const current = query.data?.eval ?? evalRecord;
  return <Modal title={`Eval results · ${current.status}`} onClose={onClose}>
    <p className="panel-note mt-0">{current.rows_done}/{current.total_rows} rows · {current.passed} passed · {current.fail} failed · {fmtUsd(current.cost_usd)} · {fmtMs(current.avg_latency_ms)} avg</p>
    <div className="table-wrap" style={{ maxHeight: 340, overflow: "auto" }}>
      <table>
        <thead><tr><th className="num">Score</th><th>Input</th><th>Note</th></tr></thead>
        <tbody>
          {results.length ? results.map((result) => <tr key={result.id}>
            <td className="num">{result.score ? <span className="badge good"><span className="dot" />{result.score}</span> : <span className="badge bad"><span className="dot" />0</span>}</td>
            <td className="tnum" style={{ maxWidth: 300, whiteSpace: "normal" }}>{result.input_hint || "-"}</td>
            <td style={{ color: "var(--text-3)", maxWidth: 220, whiteSpace: "normal" }}>{result.score_note || result.error || "-"}</td>
          </tr>) : <EmptyRow colSpan={3}>No results yet.</EmptyRow>}
        </tbody>
      </table>
    </div>
    <div className="modal-actions"><Button type="button" onClick={onClose}>Close</Button></div>
  </Modal>;
}

const editDatasetSchema = z.object({ name: z.string().trim().min(1, "Name is required"), description: z.string() });
type EditDatasetValues = z.infer<typeof editDatasetSchema>;

function EditDataset({ dataset, onClose, onSaved }: { dataset: Dataset; onClose: () => void; onSaved: () => void }) {
  const form = useZodForm<EditDatasetValues>(editDatasetSchema, { name: dataset.name, description: dataset.description ?? "" });
  const save = useMutation({ mutationFn: (values: EditDatasetValues) => api(`/api/datasets/${dataset.id}`, { method: "PATCH", body: JSON.stringify(values) }), onSuccess: onSaved });
  return <FormModal title="Edit dataset" form={form} submitLabel="Save" pending={save.isPending} error={save.isError ? save.error.message : null} onClose={onClose} onSubmit={(values) => save.mutate(values)}>
    <TextField form={form} name="name" label="Name" autoFocus />
    <TextField form={form} name="description" label="Description" />
  </FormModal>;
}
