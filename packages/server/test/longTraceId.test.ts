import { expect, test } from "bun:test";
import { bearer, createTestApp, expectSpaShell, seedSession } from "./helpers";

test("console pages accept long T3 trace ids", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    // T3 Code embeds the thread and attempt in its trace ids, so the value is
    // well past Fastify's 100-character default route-parameter limit.
    const traceId =
      "msg_t3_turn_ses_e43693102ffeDJYeACK1WP3iQd:run-attempt:run:run%3Athread%3A84713bcf-356a-41ef-8354-37f9ba6784b0%253Aordinal%253A13%3Aattempt%3A1";
    const res = await ctx.app.inject({
      method: "GET",
      url: `/ui/traces/${encodeURIComponent(traceId)}`,
      headers: bearer(session.key),
    });
    expect(res.statusCode).toBe(200);
    expectSpaShell(res.body);
  } finally {
    await ctx.cleanup();
  }
});
