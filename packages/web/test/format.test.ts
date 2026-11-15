import { expect, test } from "bun:test";
import { deltaTone, fmtCostMoney, fmtMs, formatCount, formatDate, formatDateTime, formatMoney, formatPercent, relTime } from "../src/api";

test("fmtMs uses one readable duration format at every boundary", () => {
  expect(fmtMs(null)).toBe("-");
  expect(fmtMs(0)).toBe("0ms");
  expect(fmtMs(412)).toBe("412ms");
  expect(fmtMs(999)).toBe("999ms");
  expect(fmtMs(1000)).toBe("1.0s");
  expect(fmtMs(4300)).toBe("4.3s");
  expect(fmtMs(59_999)).toBe("59.9s");
  expect(fmtMs(60_000)).toBe("1m 00s");
  expect(fmtMs(904_000)).toBe("15m 04s");
  expect(fmtMs(3_599_999)).toBe("59m 59s");
  expect(fmtMs(3_600_000)).toBe("1h 00m");
  expect(fmtMs(8_100_000)).toBe("2h 15m");
  expect(fmtMs(86_399_999)).toBe("23h 59m");
  expect(fmtMs(86_400_000)).toBe("1d 0h");
  expect(fmtMs(483_590_490)).toBe("5d 14h");
});

test("relative times read forward for expiries and backward for activity", () => {
  expect(relTime(new Date(Date.now() + 2 * 3_600_000).toISOString())).toBe("in 2h");
  expect(relTime(new Date(Date.now() + 2 * 86_400_000).toISOString())).toBe("in 2d");
  expect(relTime(new Date(Date.now() - 3 * 3_600_000).toISOString())).toBe("3h ago");
  expect(relTime(null)).toBe("-");
});

test("cost money uses two decimals at or above one dollar and four below", () => {
  expect(fmtCostMoney(null)).toBe("-");
  expect(fmtCostMoney(0.5)).toBe("$0.5000");
  expect(fmtCostMoney(1)).toBe("$1.00");
  expect(fmtCostMoney(12.345)).toBe("$12.35");
  expect(formatMoney(15.7)).toBe("$15.70");
  expect(formatMoney(1570.2)).toBe("$1,570.20");
  expect(formatMoney(0.25)).toBe("$0.2500");
});

test("counts, percentages and dates have one console format", () => {
  expect(formatCount(3120)).toBe("3,120");
  expect(formatPercent(3.2)).toBe("3.2%");
  expect(formatPercent(3.245, 2)).toBe("3.25%");
  expect(formatDate("2026-10-03T12:00:00")).toBe("3 Oct 2026");
  // Calendar keys are UTC days and keep their label in every timezone.
  expect(formatDate("2026-10-03")).toBe("3 Oct 2026");
  expect(formatDateTime("2026-10-03T14:02:00")).toBe("3 Oct 2026, 14:02");
});

test("delta tone follows the metric meaning", () => {
  expect(deltaTone("spend", 1)).toBe("neutral");
  expect(deltaTone("spend", -1)).toBe("good");
  expect(deltaTone("errors", 1)).toBe("bad");
  expect(deltaTone("latency", -1)).toBe("good");
  expect(deltaTone("runs", 1)).toBe("neutral");
  expect(deltaTone("errors", 0)).toBe("neutral");
});
