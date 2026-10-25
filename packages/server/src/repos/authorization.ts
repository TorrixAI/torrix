import type { DbClient } from "../db/client";
import { insertRow, sqlAll, sqlGet, sqlRun, updateById } from "../db/sql";
import type { ApprovalQuery, AuthorizationJoin, AuthorizationQuery, AuthorizationRepository } from "../core/ports";
import type {
  AgentControlSettings,
  Approval,
  AuthorizationDecisionRecord,
  AuthorizationRequest,
  Delegation,
  Principal,
  RiskAssessmentRecord,
} from "../core/domain";

export interface DefaultAgentControlSettings {
  default_posture: "deny" | "allow";
  approval_timeout_minutes: number;
  max_delegation_depth: number;
  risk_escalation: string;
  authorization_retention_days: number | null;
  approval_alerts: number;
  approval_webhook_url: string | null;
  webhook_secret: string | null;
  require_grant: number;
}

export const AGENT_CONTROL_DEFAULTS: DefaultAgentControlSettings = {
  default_posture: "deny",
  approval_timeout_minutes: 60,
  max_delegation_depth: 4,
  risk_escalation: JSON.stringify({ high: "require_approval", critical: "deny" }),
  authorization_retention_days: null,
  approval_alerts: 1,
  approval_webhook_url: null,
  webhook_secret: null,
  require_grant: 0,
};

export function createAuthorizationRepository(db: DbClient): AuthorizationRepository {
  const asRequest = (row: Record<string, unknown>): AuthorizationRequest => row as unknown as AuthorizationRequest;
  const asDecision = (row: Record<string, unknown>): AuthorizationDecisionRecord =>
    row as unknown as AuthorizationDecisionRecord;
  const asApproval = (row: Record<string, unknown>): Approval => row as unknown as Approval;
  const asRisk = (row: Record<string, unknown>): RiskAssessmentRecord => row as unknown as RiskAssessmentRecord;
  const asPrincipal = (row: Record<string, unknown>): Principal => row as unknown as Principal;
  const asDelegation = (row: Record<string, unknown>): Delegation => row as unknown as Delegation;

  const joinRequests = async (requests: AuthorizationRequest[]): Promise<AuthorizationJoin[]> => {
    const out: AuthorizationJoin[] = [];
    for (const request of requests) {
      const decisionRow = await sqlGet<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM authorization_decisions WHERE request_id = ? ORDER BY created_at DESC LIMIT 1",
        [request.id],
      );
      const riskRow = await sqlGet<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM risk_assessments WHERE request_id = ? ORDER BY created_at DESC LIMIT 1",
        [request.id],
      );
      const approvalRow = await sqlGet<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM approvals WHERE request_id = ? ORDER BY created_at DESC LIMIT 1",
        [request.id],
      );
      const principalRow = request.principal_id
        ? await sqlGet<Record<string, unknown>>(
            db.engine,
            "SELECT * FROM principals WHERE id = ? AND user_id = ?",
            [request.principal_id, request.user_id],
          )
        : null;
      const delegationRow = request.delegation_id
        ? await sqlGet<Record<string, unknown>>(
            db.engine,
            "SELECT * FROM delegations WHERE id = ? AND user_id = ?",
            [request.delegation_id, request.user_id],
          )
        : null;
      out.push({
        request,
        decision: decisionRow ? asDecision(decisionRow) : null,
        risk: riskRow ? asRisk(riskRow) : null,
        approval: approvalRow ? asApproval(approvalRow) : null,
        principal: principalRow ? asPrincipal(principalRow) : null,
        delegation: delegationRow ? asDelegation(delegationRow) : null,
      });
    }
    return out;
  };

  return {
    async getSettings(userId: string): Promise<AgentControlSettings> {
      const row = await sqlGet<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM agent_control_settings WHERE user_id = ?",
        [userId],
      );
      if (row) {
        return row as unknown as AgentControlSettings;
      }
      return {
        user_id: userId,
        ...AGENT_CONTROL_DEFAULTS,
        updated_at: new Date().toISOString(),
      };
    },

    async updateSettings(userId: string, fields: Partial<AgentControlSettings>): Promise<void> {
      const existing = await sqlGet<{ user_id: string }>(
        db.engine,
        "SELECT user_id FROM agent_control_settings WHERE user_id = ?",
        [userId],
      );
      if (!existing) {
        await insertRow(db.engine, "agent_control_settings", {
          user_id: userId,
          ...AGENT_CONTROL_DEFAULTS,
          ...fields,
          updated_at: new Date().toISOString(),
        });
        return;
      }
      await updateById(
        db.engine,
        "agent_control_settings",
        userId,
        { ...fields, updated_at: new Date().toISOString() },
        "user_id",
      );
    },

    async createRequest(request: AuthorizationRequest): Promise<void> {
      await insertRow(db.engine, "authorization_requests", request as unknown as Record<string, unknown>);
    },

    async getRequest(id: string, userId: string): Promise<AuthorizationRequest | null> {
      const row = await sqlGet<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM authorization_requests WHERE id = ? AND user_id = ?",
        [id, userId],
      );
      return row ? asRequest(row) : null;
    },

    async updateRequest(id: string, fields: Partial<AuthorizationRequest>): Promise<void> {
      await updateById(db.engine, "authorization_requests", id, fields as Record<string, unknown>);
    },

    async recordDecision(decision: AuthorizationDecisionRecord): Promise<void> {
      await insertRow(db.engine, "authorization_decisions", decision as unknown as Record<string, unknown>);
    },

    async listDecisions(
      userId: string,
      query: AuthorizationQuery,
    ): Promise<{ decisions: AuthorizationDecisionRecord[]; total: number }> {
      const clauses: string[] = ["user_id = ?"];
      const params: Array<string | number> = [userId];
      if (query.agentId) {
        clauses.push("agent_id = ?");
        params.push(query.agentId);
      }
      if (query.decision) {
        clauses.push("decision = ?");
        params.push(query.decision);
      }
      if (query.action) {
        clauses.push("action = ?");
        params.push(query.action);
      }
      if (query.protocol) {
        clauses.push("protocol = ?");
        params.push(query.protocol);
      }
      if (query.from) {
        clauses.push("created_at >= ?");
        params.push(query.from);
      }
      if (query.to) {
        clauses.push("created_at <= ?");
        params.push(query.to);
      }
      const where = clauses.join(" AND ");
      const totalRow = await sqlGet<{ c: number }>(
        db.engine,
        `SELECT COUNT(*) AS c FROM authorization_decisions WHERE ${where}`,
        params,
      );
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        `SELECT * FROM authorization_decisions WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, query.limit, query.offset],
      );
      return { decisions: rows.map(asDecision), total: Number(totalRow?.c ?? 0) };
    },

    async getDecision(id: string, userId: string): Promise<AuthorizationDecisionRecord | null> {
      const row = await sqlGet<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM authorization_decisions WHERE id = ? AND user_id = ?",
        [id, userId],
      );
      return row ? asDecision(row) : null;
    },

    async listByTrace(userId: string, traceId: string): Promise<AuthorizationJoin[]> {
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM authorization_requests WHERE user_id = ? AND trace_id = ? ORDER BY created_at ASC",
        [userId, traceId],
      );
      return joinRequests(rows.map(asRequest));
    },

    async listByRuns(userId: string, runIds: string[]): Promise<AuthorizationJoin[]> {
      const ids = [...new Set(runIds.filter((id) => typeof id === "string" && id.length > 0))];
      if (ids.length === 0) {
        return [];
      }
      const placeholders = ids.map(() => "?").join(", ");
      const byRequest = await sqlAll<Record<string, unknown>>(
        db.engine,
        `SELECT * FROM authorization_requests WHERE user_id = ? AND run_id IN (${placeholders})`,
        [userId, ...ids],
      );
      const decisionLinked = await sqlAll<{ request_id: string }>(
        db.engine,
        `SELECT DISTINCT request_id FROM authorization_decisions WHERE user_id = ? AND run_id IN (${placeholders})`,
        [userId, ...ids],
      );
      const seen = new Set(byRequest.map((row) => String(row.id)));
      const extraIds = decisionLinked.map((row) => row.request_id).filter((id) => !seen.has(id));
      const extra = extraIds.length
        ? await sqlAll<Record<string, unknown>>(
            db.engine,
            `SELECT * FROM authorization_requests WHERE user_id = ? AND id IN (${extraIds.map(() => "?").join(", ")})`,
            [userId, ...extraIds],
          )
        : [];
      const requests = [...byRequest, ...extra]
        .map(asRequest)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      return joinRequests(requests);
    },

    async recordRisk(assessment: RiskAssessmentRecord): Promise<void> {
      await insertRow(db.engine, "risk_assessments", assessment as unknown as Record<string, unknown>);
    },

    async createApproval(approval: Approval): Promise<void> {
      await insertRow(db.engine, "approvals", approval as unknown as Record<string, unknown>);
    },

    async getApproval(id: string, userId: string): Promise<Approval | null> {
      const row = await sqlGet<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM approvals WHERE id = ? AND user_id = ?",
        [id, userId],
      );
      return row ? asApproval(row) : null;
    },

    async getApprovalByRequest(requestId: string): Promise<Approval | null> {
      const row = await sqlGet<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM approvals WHERE request_id = ? ORDER BY created_at DESC LIMIT 1",
        [requestId],
      );
      return row ? asApproval(row) : null;
    },

    async getApprovalByHash(userId: string, requestHash: string): Promise<Approval | null> {
      const row = await sqlGet<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM approvals WHERE user_id = ? AND request_hash = ? ORDER BY created_at DESC LIMIT 1",
        [userId, requestHash],
      );
      return row ? asApproval(row) : null;
    },

    async findOpenApprovalByHash(
      userId: string,
      agentId: string,
      requestHash: string,
      nowIso: string,
    ): Promise<Approval | null> {
      const row = await sqlGet<Record<string, unknown>>(
        db.engine,
        `SELECT * FROM approvals
         WHERE user_id = ? AND agent_id = ? AND request_hash = ?
           AND state IN ('approved', 'pending') AND consumed_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY CASE state WHEN 'approved' THEN 0 ELSE 1 END, created_at ASC
         LIMIT 1`,
        [userId, agentId, requestHash, nowIso],
      );
      return row ? asApproval(row) : null;
    },

    async listApprovals(
      userId: string,
      query: ApprovalQuery,
    ): Promise<{ approvals: Approval[]; total: number }> {
      const clauses: string[] = ["user_id = ?"];
      const params: Array<string | number> = [userId];
      if (query.state) {
        clauses.push("state = ?");
        params.push(query.state);
      }
      if (query.agentId) {
        clauses.push("agent_id = ?");
        params.push(query.agentId);
      }
      const where = clauses.join(" AND ");
      const totalRow = await sqlGet<{ c: number }>(
        db.engine,
        `SELECT COUNT(*) AS c FROM approvals WHERE ${where}`,
        params,
      );
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        `SELECT * FROM approvals WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, query.limit, query.offset],
      );
      return { approvals: rows.map(asApproval), total: Number(totalRow?.c ?? 0) };
    },

    async updateApproval(id: string, fields: Partial<Approval>): Promise<void> {
      await updateById(db.engine, "approvals", id, fields as Record<string, unknown>);
    },

    async consumeApproval(id: string): Promise<boolean> {
      const row = await sqlGet<{ id: string }>(
        db.engine,
        "UPDATE approvals SET state = 'consumed', consumed_at = ? WHERE id = ? AND state = 'approved' AND consumed_at IS NULL RETURNING id",
        [new Date().toISOString(), id],
      );
      return Boolean(row);
    },

    async expireStaleApprovals(nowIso: string): Promise<number> {
      const rows = await sqlAll<{ id: string; request_id: string }>(
        db.engine,
        "UPDATE approvals SET state = 'expired', decided_at = ? WHERE state = 'pending' AND expires_at IS NOT NULL AND expires_at <= ? RETURNING id, request_id",
        [nowIso, nowIso],
      );
      for (const row of rows) {
        await sqlRun(
          db.engine,
          "UPDATE authorization_requests SET state = 'expired', finished_at = ? WHERE id = ? AND state = 'pending_approval'",
          [nowIso, row.request_id],
        );
      }
      return rows.length;
    },

    async pendingApprovalRequestIds(): Promise<string[]> {
      const rows = await sqlAll<{ request_id: string }>(
        db.engine,
        "SELECT request_id FROM approvals WHERE state = 'pending'",
      );
      return rows.map((row) => row.request_id);
    },

    async deleteOld(userId: string, olderThanDays: number): Promise<number> {
      const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
      const countRow = await sqlGet<{ c: number }>(
        db.engine,
        "SELECT COUNT(*) AS c FROM authorization_decisions WHERE user_id = ? AND created_at <= ?",
        [userId, cutoff],
      );
      await sqlRun(db.engine, "DELETE FROM authorization_decisions WHERE user_id = ? AND created_at <= ?", [
        userId,
        cutoff,
      ]);
      await sqlRun(db.engine, "DELETE FROM risk_assessments WHERE user_id = ? AND created_at <= ?", [userId, cutoff]);
      await sqlRun(db.engine, "DELETE FROM authorization_requests WHERE user_id = ? AND created_at <= ?", [
        userId,
        cutoff,
      ]);
      await sqlRun(
        db.engine,
        "DELETE FROM approvals WHERE user_id = ? AND created_at <= ? AND state IN ('approved','rejected','expired','consumed','cancelled')",
        [userId, cutoff],
      );
      return Number(countRow?.c ?? 0);
    },
  };
}
