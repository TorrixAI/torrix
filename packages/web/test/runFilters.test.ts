import { expect, test } from "bun:test";
import { activeFilterNames, activeRunFilters, applyRunFilter, clearRunFilters, dayToIso, filterValueLabel, isoToDay } from "../src/lib/runFilters";

const params = (entries: Record<string, string>) => new URLSearchParams(entries);

test("every URL filter becomes an ordered chip with a readable value", () => {
  const chips = activeRunFilters(params({
    q: "refund",
    status: "error",
    agent: "build",
    model: "gpt-5",
    provider: "openai",
    source: "playground",
    from: "2026-11-01T00:00:00.000Z",
    to: "2026-11-02T23:59:59.999Z",
    tag: "team=alpha",
    score: "bad",
    is_golden: "1",
    anomaly: "1",
    end_user: "cust_1",
  }));
  expect(chips.map((chip) => chip.key)).toEqual([
    "model", "provider", "source", "from", "to", "tag", "score", "is_golden", "anomaly", "end_user", "status", "agent", "q",
  ]);
  expect(chips.find((chip) => chip.key === "status")?.value).toBe("Errors");
  expect(chips.find((chip) => chip.key === "score")?.value).toBe("Bad");
  expect(chips.find((chip) => chip.key === "is_golden")?.value).toBe("Golden");
  expect(chips.find((chip) => chip.key === "anomaly")?.value).toBe("Anomalies only");
  expect(chips.find((chip) => chip.key === "end_user")?.value).toBe("cust_1");
  expect(chips.find((chip) => chip.key === "from")?.value).toContain("2026");
});

test("empty and whitespace-only values are not filters", () => {
  expect(activeRunFilters(params({ model: "", provider: "  ", q: " " }))).toEqual([]);
});

test("filter values format the enumerated filters", () => {
  expect(filterValueLabel("status", "200")).toBe("Success (200)");
  expect(filterValueLabel("score", "good")).toBe("Good");
  expect(filterValueLabel("score", "unscored")).toBe("Unscored");
  expect(filterValueLabel("is_golden", "0")).toBe("Not golden");
  expect(filterValueLabel("model", "gpt-5")).toBe("gpt-5");
});

test("day and ISO conversions use the local calendar day", () => {
  expect(dayToIso("2026-11-01")).toBe(new Date("2026-11-01T00:00:00.000").toISOString());
  expect(dayToIso("2026-11-01", true)).toBe(new Date("2026-11-01T23:59:59.999").toISOString());
  expect(dayToIso("")).toBe("");
  expect(isoToDay(dayToIso("2026-11-01"))).toBe("2026-11-01");
  expect(isoToDay(dayToIso("2026-11-01", true))).toBe("2026-11-01");
  expect(isoToDay("2026-11-01")).toBe("2026-11-01");
  expect(isoToDay("not a date")).toBe("not a date");
  expect(isoToDay(null)).toBe("");
});

test("a filter change resets the flat and grouped list cursors", () => {
  const next = applyRunFilter(params({ q: "refund", group: "trace", gpage: "3", page: "2", sort: "cost", dir: "desc" }), { q: "nemotron" });
  expect([...next.keys()]).toEqual(["q", "group", "sort", "dir"]);
  expect(next.get("q")).toBe("nemotron");

  const cleared = applyRunFilter(params({ status: "error", gpage: "1" }), { status: "" });
  expect([...cleared.keys()]).toEqual([]);
});

test("clear all removes filters and paging but keeps view state", () => {
  const next = clearRunFilters(params({
    model: "gpt-5",
    source: "sdk",
    q: "refund",
    status: "error",
    page: "3",
    gpage: "2",
    group: "trace",
    sort: "cost",
    dir: "desc",
    project: "proj_1",
  }));
  expect([...next.keys()]).toEqual(["group", "sort", "dir", "project"]);
});

test("the empty state names the active filters", () => {
  const chips = activeRunFilters(params({ model: "gpt-5", score: "bad" }));
  expect(activeFilterNames(chips)).toBe("model and score");
  expect(activeFilterNames(activeRunFilters(params({ tag: "alpha" })))).toBe("tag");
  expect(activeFilterNames([])).toBe("");
});
