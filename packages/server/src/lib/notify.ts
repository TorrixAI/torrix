import type { AlertSettings } from "../core/domain";

const NOTIFY_TIMEOUT_MS = 8000;
const DEFAULT_PAGERDUTY_BASE_URL = "https://events.pagerduty.com";

export interface NotifyDeps {
  pagerdutyBaseUrl?: string;
}

export type NotificationSettings = Pick<
  AlertSettings,
  "webhook_url" | "webhook_secret" | "pagerduty_routing_key" | "email_webhook_url" | "email_webhook_token" | "email_recipients"
>;

export function emailRecipients(raw: string | null | undefined): string[] {
  return String(raw ?? "")
    .split(/[,;\n]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function hasNotificationChannel(settings: Partial<NotificationSettings> | null | undefined): boolean {
  if (!settings) {
    return false;
  }
  return Boolean(
    settings.webhook_url ||
      settings.pagerduty_routing_key ||
      (settings.email_webhook_url && emailRecipients(settings.email_recipients).length > 0),
  );
}

function pagerDutyBaseUrl(deps?: NotifyDeps): string {
  const base = deps?.pagerdutyBaseUrl ?? process.env.TORRIX_PAGERDUTY_BASE_URL ?? DEFAULT_PAGERDUTY_BASE_URL;
  return base.replace(/\/+$/, "");
}

function pagerDutySeverity(payload: Record<string, unknown>): "critical" | "error" | "warning" | "info" {
  const event = String(payload.event ?? "");
  if (event === "run.error") {
    return "error";
  }
  if (event === "cost.budget") {
    return Number(payload.level) >= 1 ? "critical" : "warning";
  }
  if (event === "cost.anomaly") {
    return "warning";
  }
  if (event === "guardrail.triggered") {
    return "warning";
  }
  if (event === "approval.pending") {
    return String(payload.risk_level ?? "").toLowerCase() === "critical" ? "critical" : "warning";
  }
  return "info";
}

function pagerDutyDedupKey(event: string, payload: Record<string, unknown>): string {
  const stable = payload.run_id ?? payload.approval_id ?? payload.scope_id ?? payload.period_start ?? "global";
  return `${event}:${String(stable)}`;
}

function formatPayloadText(payload: Record<string, unknown>): string {
  return Object.entries(payload)
    .map(
      ([key, value]) =>
        `${key.replaceAll("_", " ")}: ${typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)}`,
    )
    .join("\n");
}

export async function dispatchPagerDuty(
  routingKey: string,
  payload: Record<string, unknown>,
  deps?: NotifyDeps,
): Promise<void> {
  const key = routingKey.trim();
  if (!key) {
    return;
  }
  const event = typeof payload.event === "string" ? payload.event : "torrix.alert";
  const body = JSON.stringify({
    routing_key: key,
    event_action: "trigger",
    payload: {
      summary: String(payload.message ?? event),
      source: "torrix",
      severity: pagerDutySeverity(payload),
      custom_details: payload,
    },
    dedup_key: pagerDutyDedupKey(event, payload),
  });
  try {
    await fetch(`${pagerDutyBaseUrl(deps)}/v2/enqueue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
    });
  } catch {
    // fire-and-forget; never affects the request path
  }
}

export async function dispatchEmailGateway(
  url: string,
  recipients: string[],
  payload: Record<string, unknown>,
  token?: string | null,
): Promise<void> {
  const to = recipients.map((value) => value.trim()).filter(Boolean);
  if (!url || !to.length) {
    return;
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const body = JSON.stringify({
    to,
    subject: `Torrix alert: ${String(payload.message ?? payload.event ?? "notification")}`,
    text: formatPayloadText(payload),
  });
  try {
    await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
    });
  } catch {
    // fire-and-forget; never affects the request path
  }
}

export async function dispatchWebhook(webhookUrl: string, payload: Record<string, unknown>, secret?: string | null): Promise<void> {
  const isSlack = /hooks\.slack\.com|slack\.com\/services/.test(webhookUrl);
  const body = JSON.stringify(isSlack ? slackBlocks(payload) : payload);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret) {
    headers["x-torrix-signature"] = `sha256=${await signPayload(body, secret)}`;
  }
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
    });
  } catch {
    // fire-and-forget; never affects the request path
  }
}

export async function notifyChannels(
  settings: Partial<NotificationSettings> | null | undefined,
  payload: Record<string, unknown>,
  deps?: NotifyDeps,
): Promise<string[]> {
  if (!settings) {
    return [];
  }
  const channels: string[] = [];
  const dispatches: Promise<void>[] = [];
  if (settings.webhook_url) {
    channels.push("webhook");
    dispatches.push(dispatchWebhook(settings.webhook_url, payload, settings.webhook_secret));
  }
  if (settings.pagerduty_routing_key) {
    channels.push("pagerduty");
    dispatches.push(dispatchPagerDuty(settings.pagerduty_routing_key, payload, deps));
  }
  const recipients = emailRecipients(settings.email_recipients);
  if (settings.email_webhook_url && recipients.length) {
    channels.push("email");
    dispatches.push(dispatchEmailGateway(settings.email_webhook_url, recipients, payload, settings.email_webhook_token));
  }
  await Promise.all(dispatches);
  return channels;
}

async function signPayload(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function slackBlocks(payload: Record<string, unknown>): unknown {
  const blocks: ({ type: string; text?: { type: string; text: string } } | { type: string })[] = [];
  for (const [key, value] of Object.entries(payload)) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*${key.replaceAll("_", " ")}*: \`${String(value)}\`` },
    });
  }
  blocks.push({ type: "divider" });
  return { blocks };
}
