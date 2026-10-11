import type { Repositories } from "../repos";
import type { AuditEntry } from "../core/domain";

export interface AuditInput {
  userId: string;
  projectId?: string | null;
  actor: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  detail?: Record<string, unknown> | string | null;
  ip?: string | null;
}

/**
 * Fire-and-forget audit write. Governance must never slow down or break the
 * request path, so failures are swallowed after a console warning.
 */
export function recordAudit(repos: Repositories, input: AuditInput): void {
  const entry = buildEntry(input);
  void repos.audit.record(entry).catch((err: unknown) => {
    console.error("audit write failed", err);
  });
}

export async function recordAuditSafe(repos: Repositories, input: AuditInput): Promise<void> {
  await repos.audit.record(buildEntry(input)).catch((err: unknown) => {
    console.error("audit write failed", err);
  });
}

function buildEntry(input: AuditInput): AuditEntry {
  const detail =
    typeof input.detail === "string" || input.detail == null
      ? (input.detail ?? null)
      : safeStringify(input.detail);
  return {
    id: crypto.randomUUID(),
    user_id: input.userId,
    project_id: input.projectId ?? null,
    actor: input.actor,
    action: input.action,
    target_type: input.targetType,
    target_id: input.targetId ?? null,
    detail,
    ip: input.ip ?? null,
    created_at: new Date().toISOString(),
  };
}

function safeStringify(value: Record<string, unknown>): string {
  const redacted: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    redacted[k] = /secret|password|token|key$/i.test(k) && typeof v === "string" ? "***" : v;
  }
  try {
    return JSON.stringify(redacted);
  } catch {
    return "{}";
  }
}

export function clientIp(request: { headers: unknown; ip?: string }): string | null {
  if (request.ip) {
    return request.ip;
  }
  const headers = request.headers as Record<string, string | string[] | undefined>;
  const forwarded = headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (raw) {
    return raw.split(",")[0].trim() || null;
  }
  return null;
}