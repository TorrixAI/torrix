import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { downloadFile } from "../download";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { Link } from "react-router-dom";
import { PageError, PageLoading } from "./DashboardPage";
import { api, fmtUsd, relTime, type Dataset, type Eval, type Run } from "../api";
import { formatDate } from "../api";
import { EmptyRow, Field, PageHead, Panel } from "../components";
import { FormModal, TextField, useZodForm } from "../form";
import { UpgradeCard, useFeature } from "../features";

interface EvalWithDataset extends Eval { dataset_name: string | null }

interface JudgeSettingsView {
  provider: string;
  base_url: string | null;
  model: string | null;
  criteria: string | null;
  has_api_key: boolean;
  updated_at: string | null;
}

export default function DatasetsPage() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["datasets"], queryFn: () => api<{ datasets: Dataset[] }>("/api/datasets") });
  const [createOpen, setCreateOpen] = useState(false);
  if (query.isPending) return <PageLoading />;
  if (query.isError) return <PageError message={query.error.message} />;
  const datasets = query.data.datasets;

  return <>
    <PageHead title="Datasets & evals" sub="Golden-input sets, judged against your captured runs or live providers." actions={<Button type="button" onClick={() => setCreateOpen(true)}>New dataset</Button>} />
    <Panel flush title="Datasets" note={`${datasets.length} total`}>
      <div className="table-wrap"><table>
        <thead><tr><th>Name</th><th>Description</th><th className="num">Rows</th><th>Updated</th></tr></thead>
        <tbody>
          {datasets.length ? datasets.map((dataset) => <tr key={dataset.id}>
            <td><Link className="tcell-primary" to={`/ui/datasets/${dataset.id}`}>{dataset.name}</Link></td>
            <td className="tcell-muted">{dataset.description || "-"}</td>
            <td className="num">{dataset.rows ?? 0}</td>
            <td className="tcell-muted tnum">{formatDate(dataset.updated_at)}</td>
          </tr>) : <EmptyRow colSpan={4}>No datasets yet. Build a set of prompt / golden-answer pairs, then judge captured runs against them.</EmptyRow>}
        </tbody>
      </table></div>
    </Panel>

    <JudgeCard />
    <RecentEvaluations />

    <Panel flush title="Golden runs" note="most recent · exempt from retention and exportable for fine-tuning">
      <GoldenRuns />
    </Panel>

    {createOpen ? <CreateDataset onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); void client.invalidateQueries({ queryKey: ["datasets"] }); }} /> : null}
  </>;
}

/** LLM-as-judge settings: judge-written run verdicts and the eval fallback scorer. */
function JudgeCard() {
  const { allowed, ready } = useFeature("judge");
  if (!ready) return <div className="startup loading-page"><span>Loading…</span></div>;
  if (!allowed) return <UpgradeCard feature="judge" label="LLM judge" />;
  return <JudgeForm />;
}

function JudgeForm() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["judge-settings"],
    queryFn: () => api<{ settings: JudgeSettingsView; default_criteria: string }>("/api/judge/settings"),
  });
  const [draft, setDraft] = useState<JudgeSettingsView | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState(false);
  const settings = draft ?? query.data?.settings ?? null;
  const save = useMutation({
    mutationFn: () => api("/api/judge/settings", {
      method: "PUT",
      body: JSON.stringify({
        provider: settings?.provider ?? "openai",
        model: settings?.model ?? "",
        base_url: settings?.base_url ?? "",
        criteria: settings?.criteria ?? "",
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
      }),
    }),
    onSuccess: () => { setApiKey(""); setSaved(true); void client.invalidateQueries({ queryKey: ["judge-settings"] }); },
  });
  if (query.isPending) return <div className="startup loading-page"><span>Loading judge settings…</span></div>;
  if (query.isError) return <Panel title="Judge"><p className="panel-note" style={{ margin: 0 }}>Could not load judge settings: {query.error.message}</p></Panel>;
  if (!settings) return null;
  const update = (patch: Partial<JudgeSettingsView>) => setDraft({ ...settings, ...patch });
  return <Panel title="Judge" note="LLM-as-judge for run verdicts and eval fallback · cost tracked separately">
    <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
      <Field label="Provider"><Input value={settings.provider} placeholder="openai" onChange={(event) => update({ provider: event.target.value })} /></Field>
      <Field label="Model"><Input value={settings.model ?? ""} placeholder="gpt-4o-mini" onChange={(event) => update({ model: event.target.value })} /></Field>
    </div>
    <div className="mt-3"><Field label="Chat completions endpoint"><Input value={settings.base_url ?? ""} placeholder="https://api.openai.com/v1/chat/completions" onChange={(event) => update({ base_url: event.target.value })} /></Field></div>
    <div className="mt-3"><Field label={settings.has_api_key ? "API key (stored: leave empty to keep)" : "API key"}>
      <Input type="password" value={apiKey} placeholder={settings.has_api_key ? "unchanged" : "sk-..."} onChange={(event) => setApiKey(event.target.value)} />
    </Field></div>
    <div className="mt-3"><Field label="Criteria">
      <Textarea rows={2} value={settings.criteria ?? ""} placeholder={query.data?.default_criteria ?? "Accuracy, relevance, completeness and clarity"} onChange={(event) => update({ criteria: event.target.value })} />
    </Field></div>
    <div className="mt-3 flex items-center gap-3">
      <Button variant="outline" type="button" disabled={save.isPending} onClick={() => save.mutate()}>Save judge settings</Button>
      {saved ? <span className="panel-note">{settings.updated_at ? `saved ${relTime(settings.updated_at)}` : "saved"}</span> : null}
    </div>
  </Panel>;
}

function RecentEvaluations() {
  const query = useQuery({ queryKey: ["evals-recent"], queryFn: () => api<{ evals: EvalWithDataset[] }>("/api/evals") });
  const evals = (query.data?.evals ?? []).slice(0, 8);
  return <Panel flush title="Recent evaluations" note="across all datasets">
    <div className="table-wrap"><table>
      <thead><tr><th>Dataset</th><th>Mode</th><th>Status</th><th className="num">Passed</th><th>Started</th><th /></tr></thead>
      <tbody>
        {evals.length ? evals.map((record) => {
          const passRate = record.total_rows ? Math.round((100 * record.passed) / record.total_rows) : 0;
          return <tr key={record.id}>
            <td><Link className="tcell-primary" to={`/ui/datasets/${record.dataset_id}`}>{record.dataset_name ?? record.dataset_id.slice(0, 8)}</Link></td>
            <td className="tnum">{record.mode}{record.model ? ` · ${record.model}` : ""}</td>
            <td><span className={`badge ${record.status === "failed" ? "bad" : record.status === "done" ? "good" : "accent"}`}><span className="dot" />{record.status}</span></td>
            <td className="num">{record.passed}/{record.total_rows} · {passRate}%</td>
            <td className="tcell-muted tnum">{relTime(record.created_at)}</td>
            <td className="text-right"><Link className="panel-note" to={`/ui/datasets/${record.dataset_id}`}>Open</Link></td>
          </tr>;
        }) : <EmptyRow colSpan={6}>Nothing evaluated yet.</EmptyRow>}
      </tbody>
    </table></div>
  </Panel>;
}

function GoldenRuns() {
  const query = useQuery({ queryKey: ["golden-runs"], queryFn: () => api<{ runs: Run[] }>("/api/runs?is_golden=1&limit=10") });
  const runs = query.data?.runs ?? [];
  const [message, setMessage] = useState<string | null>(null);
  return <>
    <div className="table-wrap"><table>
      <thead><tr><th>Run</th><th>Model</th><th className="num">Score</th><th className="num">Cost</th></tr></thead>
      <tbody>
        {runs.length ? runs.map((run) => <tr key={run.id}>
          <td><Link className="tcell-primary" to={`/ui/runs/${run.id}`}>{run.name || run.id.slice(0, 8)}</Link></td>
          <td className="tnum">{run.model || "-"}</td>
          <td className="num">{run.score == null ? "-" : run.score >= 1 ? "good" : "bad"}</td>
          <td className="num">{fmtUsd(run.cost_usd)}</td>
        </tr>) : <EmptyRow colSpan={4}>Mark a run golden from its detail page to build fine-tune data.</EmptyRow>}
      </tbody>
    </table></div>
    <div className="pager" style={{ justifyContent: "flex-start" }}>
      <Button variant="outline" type="button" onClick={() => { void downloadFile("/api/runs/golden/export", "torrix-golden.jsonl").then(() => setMessage("Exported.")).catch((error: Error) => setMessage(error.message)); }}>Export fine-tune JSONL</Button>
      {message ? <span>{message}</span> : null}
      <span style={{ marginLeft: "auto" }}>one JSONL line per golden run</span>
    </div>
  </>;
}

const datasetSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string(),
});
type DatasetValues = z.infer<typeof datasetSchema>;

function CreateDataset({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const form = useZodForm<DatasetValues>(datasetSchema, { name: "", description: "" });
  const create = useMutation({ mutationFn: (values: DatasetValues) => api("/api/datasets", { method: "POST", body: JSON.stringify({ name: values.name, description: values.description || undefined }) }), onSuccess: onCreated });
  return <FormModal title="New dataset" form={form} submitLabel="Create" pending={create.isPending} error={create.isError ? create.error.message : null} onClose={onClose} onSubmit={(values) => create.mutate(values)}>
    <TextField form={form} name="name" label="Name" placeholder="Support QA goldens" autoFocus />
    <TextField form={form} name="description" label="Description" placeholder="optional" />
  </FormModal>;
}
