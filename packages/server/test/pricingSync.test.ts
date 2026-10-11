import { expect, test } from "bun:test";
import { calculateCost } from "../src/lib/pricing";
import { loadStoredPricing, syncLivePricing } from "../src/lib/pricingSync";
import { createTestApp } from "./helpers";

test("pricing sync cascades OpenRouter to LiteLLM and falls back to the stored copy", async () => {
  const openrouter = Bun.serve({
    port: 0,
    async fetch() {
      return Response.json({
        data: [{ id: "openai/test-model-x", pricing: { prompt: "0.000002", completion: "0.000008" } }],
      });
    },
  });
  const litellm = Bun.serve({
    port: 0,
    async fetch() {
      return Response.json({
        "test-model-y": { input_cost_per_token: 0.000001, output_cost_per_token: 0.000003 },
      });
    },
  });
  const ctx = await createTestApp();
  try {
    const first = await syncLivePricing(ctx.repos, {
      openRouterUrl: `http://127.0.0.1:${openrouter.port}/models`,
      liteLlmUrl: `http://127.0.0.1:${litellm.port}/prices`,
      timeoutMs: 2000,
    });
    expect(first.source).toBe("openrouter");
    expect(first.models).toBe(1);
    expect(calculateCost("openai/test-model-x", 1_000_000, 0)).toBeCloseTo(2, 6);
    expect(calculateCost("test-model-x", 0, 1_000_000)).toBeCloseTo(8, 6);

    const second = await syncLivePricing(ctx.repos, {
      openRouterUrl: "http://127.0.0.1:1/models",
      liteLlmUrl: `http://127.0.0.1:${litellm.port}/prices`,
      timeoutMs: 500,
    });
    expect(second.source).toBe("litellm");
    expect(calculateCost("test-model-y", 1_000_000, 0)).toBeCloseTo(1, 6);

    const third = await syncLivePricing(ctx.repos, {
      openRouterUrl: "http://127.0.0.1:1/models",
      liteLlmUrl: "http://127.0.0.1:1/prices",
      timeoutMs: 500,
    });
    expect(third.source).toBe("stored");
    expect(calculateCost("test-model-y", 0, 1_000_000)).toBeCloseTo(3, 6);

    const boot = await loadStoredPricing(ctx.repos);
    expect(boot.source).toBe("stored");
    expect(boot.models).toBe(1);
    expect(boot.fetchedAt).toBeTruthy();
  } finally {
    openrouter.stop(true);
    litellm.stop(true);
    await ctx.cleanup();
  }
});
