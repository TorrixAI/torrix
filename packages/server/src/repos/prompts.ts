import type { DbClient } from "../db/client";
import { insertRow, sqlAll, sqlGet, sqlRun, updateById } from "../db/sql";
import type { Prompt, PromptVersion, Run } from "../core/domain";
import type { PromptRepository, PromptRevisionStats, PromptStats } from "../core/ports";

function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function summarize(rows: Run[]): Omit<PromptStats, "prompt_id" | "name" | "active_revision" | "revisions"> {
  let cost = 0;
  let tokens = 0;
  let latencySum = 0;
  let latencyCount = 0;
  let scoreSum = 0;
  let scoreCount = 0;
  for (const run of rows) {
    cost += run.cost_usd ?? 0;
    tokens += (run.input_tokens ?? 0) + (run.output_tokens ?? 0);
    if (run.latency_ms != null) {
      latencySum += run.latency_ms;
      latencyCount += 1;
    }
    if (run.score != null) {
      scoreSum += run.score;
      scoreCount += 1;
    }
  }
  return {
    runs: rows.length,
    cost: Number(cost.toFixed(6)),
    tokens,
    avgLatencyMs: latencyCount ? Math.round(latencySum / latencyCount) : 0,
    avgScore: scoreCount ? Number((scoreSum / scoreCount).toFixed(3)) : null,
  };
}

export function createPromptRepository(db: DbClient): PromptRepository {
  return {
    async listByUser(userId: string): Promise<Prompt[]> {
      return sqlAll<Prompt>(
        db.engine,
        "SELECT * FROM prompts WHERE user_id = ? ORDER BY updated_at DESC",
        [userId],
      );
    },

    async getById(id: string, userId: string): Promise<Prompt | null> {
      const row = await sqlGet<Prompt>(
        db.engine,
        "SELECT * FROM prompts WHERE id = ? AND user_id = ? LIMIT 1",
        [id, userId],
      );
      return row ?? null;
    },

    async getByName(projectId: string, name: string): Promise<Prompt | null> {
      const row = await sqlGet<Prompt>(
        db.engine,
        "SELECT * FROM prompts WHERE project_id = ? AND name = ? LIMIT 1",
        [projectId, name],
      );
      return row ?? null;
    },

    async create(prompt: Prompt): Promise<void> {
      await insertRow(db.engine, "prompts", prompt as unknown as Record<string, unknown>);
    },

    async updateMeta(id: string, fields: Partial<Prompt>): Promise<void> {
      await updateById(db.engine, "prompts", id, fields as unknown as Record<string, unknown>);
    },

    async delete(id: string, userId: string): Promise<boolean> {
      const existing = await this.getById(id, userId);
      if (!existing) {
        return false;
      }
      await sqlRun(db.engine, "DELETE FROM prompt_versions WHERE prompt_id = ?", [id]);
      await sqlRun(db.engine, "DELETE FROM prompts WHERE id = ? AND user_id = ?", [id, userId]);
      return true;
    },

    async listVersions(promptId: string): Promise<PromptVersion[]> {
      return sqlAll<PromptVersion>(
        db.engine,
        "SELECT * FROM prompt_versions WHERE prompt_id = ? ORDER BY revision DESC",
        [promptId],
      );
    },

    async getVersion(promptId: string, revision: number): Promise<PromptVersion | null> {
      const row = await sqlGet<PromptVersion>(
        db.engine,
        "SELECT * FROM prompt_versions WHERE prompt_id = ? AND revision = ? LIMIT 1",
        [promptId, revision],
      );
      return row ?? null;
    },

    async addVersion(version: PromptVersion): Promise<void> {
      await insertRow(db.engine, "prompt_versions", version as unknown as Record<string, unknown>);
    },

    async activateVersion(promptId: string, userId: string, revision: number): Promise<boolean> {
      const prompt = await this.getById(promptId, userId);
      if (!prompt) {
        return false;
      }
      const version = await this.getVersion(promptId, revision);
      if (!version) {
        return false;
      }
      await updateById(db.engine, "prompts", promptId, { active_revision: revision, updated_at: new Date().toISOString() });
      return true;
    },

    async stats(promptId: string, userId: string): Promise<PromptStats | null> {
      const prompt = await this.getById(promptId, userId);
      if (!prompt) {
        return null;
      }
      const activeRevision = prompt.active_revision ?? prompt.latest_revision;
      const pattern = `%"torrix_prompt":"${likeEscape(prompt.name)}"%`;
      const rows = await sqlAll<Run>(
        db.engine,
        "SELECT * FROM runs WHERE user_id = ? AND tags LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT 5000",
        [userId, pattern],
      );
      const byRevision = new Map<number, Run[]>();
      for (const run of rows) {
        let revision = activeRevision;
        try {
          const tags = JSON.parse(run.tags ?? "{}") as Record<string, unknown>;
          const parsed = Number(tags.torrix_prompt_revision);
          if (Number.isFinite(parsed)) {
            revision = parsed;
          }
        } catch {
          // tags are not strict JSON; fall back to the active revision
        }
        const bucket = byRevision.get(revision) ?? [];
        bucket.push(run);
        byRevision.set(revision, bucket);
      }
      const revisions: PromptRevisionStats[] = [...byRevision.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([revision, bucket]) => ({ revision, ...summarize(bucket) }));
      return {
        prompt_id: prompt.id,
        name: prompt.name,
        active_revision: activeRevision,
        ...summarize(rows),
        revisions,
      };
    },
  };
}