import type { DbClient } from "../db/client";
import { insertRow, sqlAll, sqlGet, sqlRun, updateById } from "../db/sql";
import type { Project, ProjectMember, ProjectRole } from "../core/domain";
import type { ProjectAccess, ProjectRepository } from "../core/ports";

function normalizeRole(raw: unknown): ProjectRole {
  return raw === "editor" || raw === "owner" ? raw : "viewer";
}

export function createProjectRepository(db: DbClient): ProjectRepository {
  return {
    async create(project: Project): Promise<void> {
      await insertRow(db.engine, "projects", project as unknown as Record<string, unknown>);
    },

    async findById(id: string): Promise<Project | null> {
      const row = await sqlGet<Project>(db.engine, "SELECT * FROM projects WHERE id = ? LIMIT 1", [id]);
      return row ?? null;
    },

    async findDefault(userId: string): Promise<Project | null> {
      const owned = await sqlGet<Project>(
        db.engine,
        "SELECT * FROM projects WHERE user_id = ? ORDER BY created_at ASC LIMIT 1",
        [userId],
      );
      if (owned) {
        return owned;
      }
      const shared = await sqlGet<Project>(
        db.engine,
        `SELECT p.* FROM projects p JOIN project_members m ON m.project_id = p.id
         WHERE m.user_id = ? ORDER BY p.created_at ASC LIMIT 1`,
        [userId],
      );
      return shared ?? null;
    },

    async listByUser(userId: string): Promise<Project[]> {
      return sqlAll<Project>(
        db.engine,
        "SELECT * FROM projects WHERE user_id = ? ORDER BY created_at ASC",
        [userId],
      );
    },

    async listAll(): Promise<Project[]> {
      return sqlAll<Project>(db.engine, "SELECT * FROM projects ORDER BY created_at ASC", []);
    },

    async memberCounts(): Promise<Array<{ projectId: string; count: number }>> {
      const rows = await sqlAll<{ projectId: string; count: number }>(
        db.engine,
        `SELECT project_id AS "projectId", COUNT(*) AS count FROM project_members GROUP BY project_id`,
        [],
      );
      return rows.map((row) => ({ projectId: String(row.projectId), count: Number(row.count) }));
    },

    async listAccessible(userId: string): Promise<ProjectAccess[]> {
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        `SELECT p.*, 'owner' AS role FROM projects p WHERE p.user_id = ?
         UNION ALL
         SELECT p.*, m.role AS role FROM projects p JOIN project_members m ON m.project_id = p.id
         WHERE m.user_id = ? AND p.user_id <> ?
         ORDER BY created_at ASC`,
        [userId, userId, userId],
      );
      return rows.map((row) => ({
        project: row as unknown as Project,
        role: normalizeRole(row.role),
      }));
    },

    async roleFor(userId: string, projectId: string): Promise<ProjectRole | null> {
      const owned = await sqlGet<{ id: string }>(
        db.engine,
        "SELECT id FROM projects WHERE id = ? AND user_id = ?",
        [projectId, userId],
      );
      if (owned) {
        return "owner";
      }
      const member = await sqlGet<{ role: string }>(
        db.engine,
        "SELECT role FROM project_members WHERE project_id = ? AND user_id = ?",
        [projectId, userId],
      );
      return member ? normalizeRole(member.role) : null;
    },

    async rename(id: string, name: string): Promise<void> {
      await updateById(db.engine, "projects", id, { name });
    },

    async delete(id: string): Promise<boolean> {
      const existing = await sqlGet<{ id: string }>(db.engine, "SELECT id FROM projects WHERE id = ?", [id]);
      if (!existing) {
        return false;
      }
      await sqlRun(db.engine, "DELETE FROM project_members WHERE project_id = ?", [id]);
      await sqlRun(db.engine, "DELETE FROM projects WHERE id = ?", [id]);
      return true;
    },

    async addMember(projectId: string, userId: string, role: ProjectRole): Promise<void> {
      await sqlRun(
        db.engine,
        "INSERT OR IGNORE INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
        [projectId, userId, role, new Date().toISOString()],
      );
      await sqlRun(db.engine, "UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?", [
        role,
        projectId,
        userId,
      ]);
    },

    async updateMemberRole(projectId: string, userId: string, role: ProjectRole): Promise<void> {
      await sqlRun(db.engine, "UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?", [
        role,
        projectId,
        userId,
      ]);
    },

    async removeMember(projectId: string, userId: string): Promise<boolean> {
      const existing = await sqlGet<{ user_id: string }>(
        db.engine,
        "SELECT user_id FROM project_members WHERE project_id = ? AND user_id = ?",
        [projectId, userId],
      );
      await sqlRun(db.engine, "DELETE FROM project_members WHERE project_id = ? AND user_id = ?", [projectId, userId]);
      return Boolean(existing);
    },

    async listMembers(projectId: string): Promise<ProjectMember[]> {
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM project_members WHERE project_id = ? ORDER BY created_at ASC",
        [projectId],
      );
      return rows.map((row) => ({
        project_id: String(row.project_id),
        user_id: String(row.user_id),
        role: normalizeRole(row.role),
        created_at: String(row.created_at),
      }));
    },

    async updateBudget(id: string, fields: Partial<Pick<Project, "budget_usd" | "hard_cap_usd">>): Promise<void> {
      const allowed: Record<string, unknown> = {};
      if ("budget_usd" in fields) allowed.budget_usd = fields.budget_usd;
      if ("hard_cap_usd" in fields) allowed.hard_cap_usd = fields.hard_cap_usd;
      if (Object.keys(allowed).length) {
        await updateById(db.engine, "projects", id, allowed);
      }
    },

    async updateCompression(
      id: string,
      fields: Partial<Pick<Project, "prompt_compression" | "compression_words">>,
    ): Promise<void> {
      const allowed: Record<string, unknown> = {};
      if ("prompt_compression" in fields) allowed.prompt_compression = fields.prompt_compression;
      if ("compression_words" in fields) allowed.compression_words = fields.compression_words;
      if (Object.keys(allowed).length) {
        await updateById(db.engine, "projects", id, allowed);
      }
    },
  };
}
