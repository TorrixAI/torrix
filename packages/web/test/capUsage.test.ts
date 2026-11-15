import { expect, test } from "bun:test";
import { capUsage } from "../src/lib/capUsage";

test("a hard cap produces percentage, remaining and a semantic state", () => {
  const half = capUsage(5, 10)!;
  expect(half).toMatchObject({ spend: 5, cap: 10, rawPct: 50, pct: 50, remaining: 5, tone: "ok", label: "Within cap" });
  const near = capUsage(8, 10)!;
  expect(near.tone).toBe("warn");
  expect(near.label).toBe("Near cap");
  const at = capUsage(10, 10)!;
  expect(at.tone).toBe("limit");
  expect(at.label).toBe("Cap reached");
  expect(at.remaining).toBe(0);
  const over = capUsage(12, 10)!;
  expect(over.rawPct).toBe(120);
  expect(over.pct).toBe(100);
  expect(over.tone).toBe("limit");
});

test("no cap, zero cap or a bad cap means no bar", () => {
  expect(capUsage(5, null)).toBeNull();
  expect(capUsage(5, 0)).toBeNull();
  expect(capUsage(5, -1)).toBeNull();
  expect(capUsage(5, Number.NaN)).toBeNull();
});

test("spend is clamped at zero and percentages cannot go below zero", () => {
  const value = capUsage(-2, 10)!;
  expect(value.spend).toBe(0);
  expect(value.rawPct).toBe(0);
  expect(value.remaining).toBe(10);
});
