import { afterEach, expect, test } from "bun:test";
import { dispatchWebhook } from "../src/lib/notify";

const saved = process.env.TORRIX_ALLOW_PRIVATE_HOSTS;

afterEach(() => {
  if (saved === undefined) delete process.env.TORRIX_ALLOW_PRIVATE_HOSTS;
  else process.env.TORRIX_ALLOW_PRIVATE_HOSTS = saved;
});

test("per-user alert webhooks are blocked at dispatch time, not admin-only by accident", async () => {
  let hits = 0;
  const local = Bun.serve({
    port: 0,
    fetch() {
      hits += 1;
      return new Response("ok");
    },
  });
  try {
    process.env.TORRIX_ALLOW_PRIVATE_HOSTS = "false";
    await dispatchWebhook(`http://127.0.0.1:${local.port}/hook`, { spend_usd: 10 });
    await dispatchWebhook("http://169.254.169.254/latest/meta-data/", { spend_usd: 10 });
    expect(hits).toBe(0);

    process.env.TORRIX_ALLOW_PRIVATE_HOSTS = "true";
    await dispatchWebhook(`http://127.0.0.1:${local.port}/hook`, { spend_usd: 10 });
    expect(hits).toBe(1);
  } finally {
    local.stop(true);
  }
});
