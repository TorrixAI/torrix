import type { Repositories } from "../repos";
import type { EditionConfig } from "../core/config";
import type { DatasetRow, Eval, EvalScorer, Events, RunData } from "../core/domain";
import { extractOpenAI } from "./extract";
import { calculateCost } from "./pricing";
import { makeEvent, buildRunRow } from "./runMapper";
import { emitRun, emitEval } from "./events";
import { NO_ASSIST, type Assist } from "../core/extensions";

const evalKeys = new Map<string, string>();

export function retainEvalKey(evalId: string, apiKey: string): void {
  evalKeys.set(evalId, apiKey);
}

function now(): string {
  return new Date().toISOString();
}

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

export function scoreByScorer(scorer: EvalScorer, response: string, expected: string): { score: number; note: string } {
  if (!expected) {
    return { score: 0, note: "no golden answer" };
  }
  if (scorer === "exact") {
    const ok = normalize(response) === normalize(expected);
    return { score: ok ? 1 : 0, note: ok ? "exact match" : "no exact match" };
  }
  const ok = normalize(response).includes(normalize(expected));
  return { score: ok ? 1 : 0, note: ok ? "contains golden answer" : "missing golden answer" };
}

export interface CascadedScore {
  score: number;
  note: string;
  judgeCostUsd: number;
}

/**
 * Deterministic scorer first; when it fails and a judge is configured, the
 * judge gets one shot at a graded verdict. A missing judge is not an error,
 * it just leaves the deterministic result in place.
 */
export async function scoreWithCascade(
  deps: JudgeDeps,
  evalRecord: Eval,
  input: string,
  response: string,
  expected: string,
  runId: string | null = null,
): Promise<CascadedScore> {
  if (evalRecord.scorer === "judge") {
    return judgeScore(deps, evalRecord, input, response, expected, runId);
  }
  const primary: EvalScorer = evalRecord.scorer === "contains" ? "contains" : "exact";
  const scored = scoreByScorer(primary, response, expected);
  if (scored.score === 1 || !expected) {
    return { ...scored, judgeCostUsd: 0 };
  }
  const judged = await judgeScore(deps, evalRecord, input, response, expected, runId);
  return judged.score === 1 ? judged : { ...scored, judgeCostUsd: judged.judgeCostUsd };
}

/**
 * A cascade judge call is persisted as a run judgment when the scored run is
 * known, so its spend shows up in dashboard/cost judge reporting alongside
 * manual judging and insights. The eval row still carries its own
 * judge_cost_usd total for the eval detail view.
 */
async function judgeScore(
  deps: JudgeDeps,
  evalRecord: Eval,
  input: string,
  response: string,
  expected: string,
  runId: string | null,
): Promise<CascadedScore> {
  try {
    const completion = await (deps.assist ?? NO_ASSIST).judgeVerdict(evalRecord.user_id, {
      input,
      output: response,
      expected: expected || null,
    });
    if (!completion) {
      return { score: 0, note: "judge not configured", judgeCostUsd: 0 };
    }
    if (runId) {
      try {
        await deps.repos.judge.addJudgment({
          id: crypto.randomUUID(),
          run_id: runId,
          user_id: evalRecord.user_id,
          provider: completion.provider,
          model: completion.model,
          criteria: "eval cascade",
          score: completion.score,
          rationale: completion.rationale,
          input_tokens: completion.inputTokens,
          output_tokens: completion.outputTokens,
          cost_usd: completion.costUsd,
          raw: null,
          error: completion.error,
          created_at: new Date().toISOString(),
        });
      } catch (err) {
        console.error("eval judge cost persist failed", err);
      }
    }
    if (completion.error || completion.score == null) {
      return { score: 0, note: completion.error ?? "judge returned no score", judgeCostUsd: completion.costUsd };
    }
    const rationale = completion.rationale ? `: ${completion.rationale}` : "";
    return {
      score: completion.score >= 0.5 ? 1 : 0,
      note: `judge ${completion.score.toFixed(2)}${rationale}`.slice(0, 500),
      judgeCostUsd: completion.costUsd,
    };
  } catch (err) {
    return { score: 0, note: `judge error: ${(err as Error).message}`.slice(0, 500), judgeCostUsd: 0 };
  }
}

function extractPrompt(requestBody: string | null | undefined): string | null {
  if (!requestBody) {
    return null;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(requestBody) as Record<string, unknown>;
  } catch {
    return null;
  }
  const messages = parsed.messages;
  if (!Array.isArray(messages)) {
    return null;
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i] as { role?: string; content?: unknown };
    if (m.role === "user" && typeof m.content === "string") {
      return m.content;
    }
  }
  return null;
}

async function findRunResponse(
  repos: Repositories,
  runId: string,
): Promise<{ response: string; error: string | null; latency: number | null; inputTokens: number | null; outputTokens: number | null }> {
  const events = await repos.events.listByRun(runId);
  const resp = events.find((e) => e.type === "response");
  return {
    response: resp?.message ?? "",
    error: null,
    latency: null,
    inputTokens: null,
    outputTokens: null,
  };
}

export interface EvalDeps {
  repos: Repositories;
  edition: EditionConfig;
  /** Online-eval capability, resolved through the extension host. */
  onlineEvals?: boolean;
  assist?: Assist;
}

/** What scoring needs: repositories plus the optional judge assist. */
export interface JudgeDeps {
  repos: Repositories;
  assist?: Assist;
}

async function patchEval(deps: EvalDeps, evalRecord: Eval, fields: Partial<Eval>): Promise<void> {
  await deps.repos.evals.update(evalRecord.id, fields);
  Object.assign(evalRecord, fields);
  emitEval(evalRecord);
}

export async function runEvaluation(deps: EvalDeps, evalId: string, userId: string): Promise<void> {
  const { repos, edition } = deps;
  const evalRecord = await repos.evals.getById(evalId, userId);
  if (!evalRecord || evalRecord.status === "done" || evalRecord.status === "failed") {
    return;
  }
  const rows = await repos.datasets.listRows(evalRecord.dataset_id);
  await patchEval(deps, evalRecord, { total_rows: rows.length, started_at: now(), rows_done: 0, passed: 0, fail: 0, score_sum: 0, judge_cost_usd: 0 });
  try {
    if (evalRecord.mode === "online" && deps.onlineEvals) {
      await runOnline(deps, evalRecord, rows);
    } else if (evalRecord.mode === "offline") {
      await runOffline(deps, evalRecord, rows);
    } else {
      await patchEval(deps, evalRecord, { status: "failed", error: "online evals are not enabled for this edition", finished_at: now() });
    }
  } catch (err) {
    await patchEval(deps, evalRecord, {
      status: "failed",
      error: truncateError((err as Error).message),
      finished_at: now(),
    });
  } finally {
    evalKeys.delete(evalId);
  }
}

function truncateError(message: string): string {
  return message.length > 300 ? `${message.slice(0, 297)}…` : message;
}

async function runOnline(deps: EvalDeps, evalRecord: Eval, rows: DatasetRow[]): Promise<void> {
  const { repos, edition } = deps;
  const dataset = await repos.datasets.getById(evalRecord.dataset_id, evalRecord.user_id);
  const datasetName = dataset?.name ?? "dataset";
  let passed = 0;
  let fail = 0;
  let cost = 0;
  let tokens = 0;
  let latSum = 0;
  let judgeCost = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const key = evalKeys.get(evalRecord.id);
    if (!key) {
      await patchEval(deps, evalRecord, { status: "failed", error: "provider key was lost (server restarted)", finished_at: now() });
      return;
    }
    const used = await repos.runs.countRuns(evalRecord.user_id);
    if (used >= edition.maxRuns) {
      await patchEval(deps, evalRecord, {
        status: "failed",
        error: `run limit reached (${edition.maxRuns})`,
        finished_at: now(),
      });
      return;
    }
    const row = rows[i];
    const startT = Date.now();
    try {
      const body = JSON.stringify({
        model: evalRecord.model,
        messages: [{ role: "user", content: row.input }],
        temperature: evalRecord.temperature ?? undefined,
        max_tokens: evalRecord.max_tokens ?? undefined,
      });
      const res = await fetch(evalRecord.target_url ?? "", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body,
      });
      const text = await res.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const extracted = extractOpenAI({ model: evalRecord.model, messages: [{ role: "user", content: row.input }] }, parsed);
      const latency = Date.now() - startT;
      const costRow = calculateCost(extracted.model ?? evalRecord.model, extracted.inputTokens, extracted.outputTokens);
      const runAt = new Date(startT).toISOString();
      const runId = crypto.randomUUID();
      const label = row.input.slice(0, 42);
      const runData: RunData = {
        id: runId,
        user_id: evalRecord.user_id,
        project_id: evalRecord.project_id,
        name: `${evalRecord.provider}/${extracted.model ?? evalRecord.model} · ${label}`,
        provider: evalRecord.provider,
        model: extracted.model ?? evalRecord.model,
        input_tokens: extracted.inputTokens ?? undefined,
        output_tokens: extracted.outputTokens ?? undefined,
        cost_usd: costRow,
        latency_ms: latency,
        status: res.status,
        finish_reason: extracted.finishReason ?? undefined,
        source: "eval",
        request_body: body,
        target_url: evalRecord.target_url ?? undefined,
        dataset_id: evalRecord.dataset_id,
        dataset_row_id: row.id,
        run_note: `Eval ${evalRecord.id}`,
        tags: { dataset: datasetName, row: String(row.idx + 1) },
        created_at: runAt,
      };
      const events: Events[] = [
        makeEvent(runId, "info", `eval ${evalRecord.id} · row ${row.idx + 1} of ${rows.length}`),
        makeEvent(runId, "request", body),
        makeEvent(runId, "response", extracted.responseText),
      ];
      const run = buildRunRow(runData);
      await repos.runs.save(run);
      await repos.events.addMany(events);
      emitRun(run);

      const scored = await scoreWithCascade(deps, evalRecord, row.input, extracted.responseText, row.expected ?? "", runId);
      passed += scored.score;
      fail += 1 - scored.score;
      cost += costRow;
      tokens += (extracted.inputTokens ?? 0) + (extracted.outputTokens ?? 0);
      latSum += latency;
      judgeCost += scored.judgeCostUsd;
      await repos.evals.addResult({
        id: crypto.randomUUID(),
        eval_id: evalRecord.id,
        dataset_row_id: row.id,
        run_id: runId,
        score: scored.score,
        score_note: scored.note,
        latency_ms: latency,
        input_tokens: extracted.inputTokens ?? null,
        output_tokens: extracted.outputTokens ?? null,
        error: res.status >= 400 ? `HTTP ${res.status}` : null,
        created_at: runAt,
      });
    } catch (err) {
      fail += 1;
      await repos.evals.addResult({
        id: crypto.randomUUID(),
        eval_id: evalRecord.id,
        dataset_row_id: row.id,
        run_id: null,
        score: 0,
        score_note: null,
        error: truncateError((err as Error).message),
        created_at: now(),
      });
    }
    await patchEval(deps, evalRecord, {
      rows_done: i + 1,
      passed,
      fail,
      cost_usd: cost,
      judge_cost_usd: judgeCost,
      tokens_total: tokens,
      avg_latency_ms: rows.length ? Number((latSum / (i + 1)).toFixed(1)) : 0,
    });
  }

  await patchEval(deps, evalRecord, { status: "done", finished_at: now() });
}

async function runOffline(deps: EvalDeps, evalRecord: Eval, rows: DatasetRow[]): Promise<void> {
  const { repos } = deps;
  const candidates: { runId: string; prompt: string; created: string; status: number | null; latency: number | null }[] = [];
  let offset = 0;
  const page = 2000;
  for (;;) {
    const { runs } = await repos.runs.list(evalRecord.user_id, { limit: page, offset });
    if (!runs.length) {
      break;
    }
    for (const run of runs) {
      const prompt = extractPrompt(run.request_body);
      if (prompt) {
        candidates.push({ runId: run.id, prompt, created: run.created_at, status: run.status ?? null, latency: run.latency_ms ?? null });
      }
    }
    offset += runs.length;
    if (runs.length < page) {
      break;
    }
  }

  let passed = 0;
  let fail = 0;
  let latSum = 0;
  let judgeCost = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const match =
      candidates.find((c) => c.prompt === row.input) ?? candidates.find((c) => c.prompt.includes(row.input));
    let runId: string | null = null;
    let response = "";
    let score = 0;
    let note: string | null = null;
    let error: string | null = null;
    if (match) {
      runId = match.runId;
      const { response: respText } = await findRunResponse(repos, match.runId);
      response = respText;
      const scored = await scoreWithCascade(deps, evalRecord, row.input, response, row.expected ?? "", runId);
      score = scored.score;
      note = scored.note;
      judgeCost += scored.judgeCostUsd;
      error = match.status != null && match.status >= 400 ? `HTTP ${match.status}` : null;
    } else {
      error = "no matching run";
    }
    if (error && error !== "no matching run") {
      score = 0;
    }
    passed += score;
    fail += 1 - score;
    if (match?.latency != null) {
      latSum += match.latency;
    }
    await repos.evals.addResult({
      id: crypto.randomUUID(),
      eval_id: evalRecord.id,
      dataset_row_id: row.id,
      run_id: runId,
      score,
      score_note: note,
      latency_ms: match?.latency ?? null,
      error,
      created_at: now(),
    });
    await patchEval(deps, evalRecord, {
      rows_done: i + 1,
      passed,
      fail,
      score_sum: passed,
      judge_cost_usd: judgeCost,
      avg_latency_ms: i + 1 ? Number((latSum / (i + 1)).toFixed(1)) : 0,
    });
  }

  await patchEval(deps, evalRecord, { status: "done", finished_at: now() });
}
