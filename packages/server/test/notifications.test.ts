import { expect, test } from "bun:test";
import { evaluateRunCost } from "../src/lib/costGate";
import { dispatchEmailGateway, dispatchPagerDuty, notifyChannels } from "../src/lib/notify";
import { createTestApp, seedSession } from "./helpers";

interface CapturedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

function captureServer() {
  const requests: CapturedRequest[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const headers: Record<string, string> = {};
      req.headers.forEach((value, name) => {
        headers[name] = value;
      });
      requests.push({
        method: req.method,
        path: new URL(req.url).pathname,
        headers,
        body: await req.text(),
      });
      return new Response("ok");
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    stop: () => server.stop(true),
  };
}

async function waitFor(assert: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (assert()) {
      return;
    }
    await Bun.sleep(10);
  }
  throw new Error("timed out waiting for condition");
}

test("pagerduty trigger posts an Events API v2 envelope", async () => {
  const server = captureServer();
  try {
    await dispatchPagerDuty(
      "rk-123",
      { event: "cost.budget", message: "Monthly spend reached 80% of budget", scope_id: "proj-1", level: 0.8 },
      { pagerdutyBaseUrl: server.url },
    );
    await dispatchPagerDuty(
      "rk-123",
      { event: "run.error", message: "A run failed", run_id: "run-9", http_status: 502 },
      { pagerdutyBaseUrl: server.url },
    );
    expect(server.requests).toHaveLength(2);

    const first = server.requests[0];
    expect(first.method).toBe("POST");
    expect(first.path).toBe("/v2/enqueue");
    expect(first.headers["content-type"]).toContain("application/json");
    const budget = JSON.parse(first.body) as {
      routing_key: string;
      event_action: string;
      payload: { summary: string; source: string; severity: string; custom_details: Record<string, unknown> };
      dedup_key?: string;
    };
    expect(budget.routing_key).toBe("rk-123");
    expect(budget.event_action).toBe("trigger");
    expect(budget.payload.summary).toContain("80% of budget");
    expect(budget.payload.source).toBe("torrix");
    expect(budget.payload.severity).toBe("warning");
    expect(budget.payload.custom_details.event).toBe("cost.budget");
    expect(budget.payload.custom_details.level).toBe(0.8);
    expect(budget.dedup_key).toBe("cost.budget:proj-1");

    const failed = JSON.parse(server.requests[1].body) as {
      payload: { severity: string };
      dedup_key?: string;
    };
    expect(failed.payload.severity).toBe("error");
    expect(failed.dedup_key).toBe("run.error:run-9");
  } finally {
    server.stop();
  }
});

test("email gateway posts recipients, subject, text and an optional bearer token", async () => {
  const server = captureServer();
  try {
    await dispatchEmailGateway(
      `${server.url}/send`,
      ["ops@example.com", "oncall@example.com"],
      { event: "cost.anomaly", message: "A run exceeded the model cost baseline", run_id: "r1" },
      "tok-123",
    );
    await dispatchEmailGateway(`${server.url}/send`, ["solo@example.com"], { event: "run.error", message: "A run failed" });
    expect(server.requests).toHaveLength(2);

    const authed = server.requests[0];
    expect(authed.method).toBe("POST");
    expect(authed.path).toBe("/send");
    expect(authed.headers.authorization).toBe("Bearer tok-123");
    expect(authed.headers["content-type"]).toContain("application/json");
    const body = JSON.parse(authed.body) as { to: string[]; subject: string; text: string };
    expect(body.to).toEqual(["ops@example.com", "oncall@example.com"]);
    expect(body.subject).toContain("A run exceeded the model cost baseline");
    expect(body.text).toContain("event: cost.anomaly");
    expect(body.text).toContain("run id: r1");

    expect(server.requests[1].headers.authorization).toBeUndefined();
    expect((JSON.parse(server.requests[1].body) as { to: string[] }).to).toEqual(["solo@example.com"]);

    await dispatchEmailGateway("http://127.0.0.1:1/send", ["solo@example.com"], { event: "run.error", message: "x" });
    await dispatchPagerDuty("rk-down", { event: "run.error", message: "x" }, { pagerdutyBaseUrl: "http://127.0.0.1:1" });
  } finally {
    server.stop();
  }
});

test("cost alerts fan out to every configured channel", async () => {
  const webhook = captureServer();
  const pagerduty = captureServer();
  const email = captureServer();
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = crypto.randomUUID();
    await ctx.repos.projects.create({ id: projectId, user_id: session.user.id, name: "Default", created_at: new Date().toISOString() });
    await ctx.repos.alerts.update(session.user.id, {
      enabled: 1,
      webhook_url: `${webhook.url}/hook`,
      pagerduty_routing_key: "rk-fanout",
      email_webhook_url: `${email.url}/send`,
      email_webhook_token: "tok-fanout",
      email_recipients: "ops@example.com, oncall@example.com",
      notify_on_error: 1,
    });

    const outcome = await evaluateRunCost(
      { repos: ctx.repos, notify: { pagerdutyBaseUrl: pagerduty.url } },
      { userId: session.user.id, projectId, apiKeyId: null },
      0.002,
      { runId: "run-fanout", model: "gpt-4o", status: 502, error: "upstream down" },
    );
    expect(outcome.alertSent).toBe(true);
    await waitFor(() => webhook.requests.length === 1 && pagerduty.requests.length === 1 && email.requests.length === 1);

    expect((JSON.parse(webhook.requests[0].body) as { event: string }).event).toBe("run.error");
    const pdBody = JSON.parse(pagerduty.requests[0].body) as {
      routing_key: string;
      payload: { severity: string; custom_details: { event: string } };
    };
    expect(pdBody.routing_key).toBe("rk-fanout");
    expect(pdBody.payload.severity).toBe("error");
    expect(pdBody.payload.custom_details.event).toBe("run.error");
    const emailBody = JSON.parse(email.requests[0].body) as { to: string[]; subject: string };
    expect(emailBody.to).toEqual(["ops@example.com", "oncall@example.com"]);
    expect(emailBody.subject).toContain("A run failed");
    expect(email.requests[0].headers.authorization).toBe("Bearer tok-fanout");

    const channels = await notifyChannels(
      {
        webhook_url: `${webhook.url}/hook`,
        pagerduty_routing_key: "rk-fanout",
        email_webhook_url: `${email.url}/send`,
        email_recipients: "ops@example.com",
      },
      { event: "cost.weekly_digest", message: "Weekly digest" },
      { pagerdutyBaseUrl: pagerduty.url },
    );
    expect(channels).toEqual(["webhook", "pagerduty", "email"]);
    await waitFor(() => webhook.requests.length === 2 && pagerduty.requests.length === 2 && email.requests.length === 2);
  } finally {
    webhook.stop();
    pagerduty.stop();
    email.stop();
    await ctx.cleanup();
  }
});
