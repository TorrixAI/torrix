import { Button } from "@/components/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { Link, useNavigate } from "react-router-dom";
import { PageError, PageLoading } from "./DashboardPage";
import { api, detectPromptVariables, parseTagsText, promptTagsText, type Prompt } from "../api";
import { formatDate } from "../api";
import { EmptyRow, PageHead, Panel } from "../components";
import { FormModal, TextAreaField, TextField, useZodForm } from "../form";

export default function PromptsPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ["prompts"], queryFn: () => api<{ prompts: Prompt[] }>("/api/prompts") });
  const [createOpen, setCreateOpen] = useState(false);
  if (query.isPending) return <PageLoading />;
  if (query.isError) return <PageError message={query.error.message} />;
  const prompts = query.data.prompts;

  return <>
    <PageHead title="Prompts" sub="Versioned prompt library. Prompts are referenced by slug from the proxy or SDK." actions={<Button type="button" onClick={() => setCreateOpen(true)}>New prompt</Button>} />
    <Panel flush title="Library" note={`${prompts.length} prompts`}>
      <div className="table-wrap"><table>
        <thead><tr><th>Name</th><th>Description</th><th className="num">Latest</th><th className="num">Active</th><th>Updated</th></tr></thead>
        <tbody>
          {prompts.length ? prompts.map((prompt) => <tr key={prompt.id}>
            <td><Link className="tcell-primary mono" to={`/ui/prompts/${prompt.id}`}>{prompt.name}</Link>{promptTagsText(prompt.tags) ? <small className="tcell-sub" style={{ fontFamily: "var(--sans)" }}>{promptTagsText(prompt.tags)}</small> : null}</td>
            <td style={{ color: "var(--text-3)", whiteSpace: "normal", overflowWrap: "anywhere" }}>{prompt.description || "-"}</td>
            <td className="num">r{prompt.latest_revision}</td>
            <td className="num">r{prompt.active_revision ?? prompt.latest_revision}</td>
            <td className="tcell-muted tnum">{formatDate(prompt.updated_at)}</td>
          </tr>) : <EmptyRow colSpan={5}>No prompts yet. Create one to version it and reference it by slug from the proxy or SDK.</EmptyRow>}
        </tbody>
      </table></div>
    </Panel>
    {createOpen ? <CreatePrompt onClose={() => setCreateOpen(false)} onCreated={(id) => { setCreateOpen(false); void client.invalidateQueries({ queryKey: ["prompts"] }); if (id) navigate(`/ui/prompts/${id}`); }} /> : null}
  </>;
}

const promptSchema = z.object({
  name: z.string().trim().min(1, "Name is required").regex(/^[a-z0-9][a-z0-9-]*$/, "Lowercase letters, digits and dashes"),
  description: z.string(),
  tags: z.string(),
  template: z.string().trim().min(1, "Template is required"),
  variables: z.string(),
  model: z.string(),
});
type PromptValues = z.infer<typeof promptSchema>;

function CreatePrompt({ onClose, onCreated }: { onClose: () => void; onCreated: (id?: string) => void }) {
  const form = useZodForm<PromptValues>(promptSchema, { name: "", description: "", tags: "", template: "", variables: "", model: "" });
  const template = form.watch("template");
  const detected = detectPromptVariables(template ?? "");
  const create = useMutation({
    mutationFn: (values: PromptValues) => api<{ prompt: { id: string } }>("/api/prompts", {
      method: "POST",
      body: JSON.stringify({
        name: values.name,
        description: values.description || undefined,
        tags: parseTagsText(values.tags),
        template: values.template,
        variables: values.variables.split(",").map((item) => item.trim()).filter(Boolean),
        model: values.model || undefined,
      }),
    }),
    onSuccess: (data) => onCreated(data.prompt?.id),
  });
  return <FormModal title="New prompt" form={form} submitLabel="Create" pending={create.isPending} error={create.isError ? create.error.message : null} onClose={onClose} onSubmit={(values) => create.mutate(values)}>
    <TextField form={form} name="name" label="Name (slug)" placeholder="support-bot" autoFocus />
    <TextField form={form} name="description" label="Description" placeholder="default system instructions for the support assistant" />
    <TextField form={form} name="tags" label="Tags" placeholder="product=assistant, lang=en" />
    <TextAreaField form={form} name="template" label="Template (v1)" rows={6} placeholder="You are the support assistant for Acme. Always answer in {{language}}." />
    <div className="panel-note" style={{ marginTop: -6 }}>Detected variables: {detected.length ? detected.join(", ") : "none yet"}</div>
    <TextField form={form} name="variables" label="Variables (optional, detected automatically)" placeholder="language, region" />
    <TextField form={form} name="model" label="Suggested model (optional)" placeholder="gpt-4o-mini" />
  </FormModal>;
}
