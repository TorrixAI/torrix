import { expect, test } from "bun:test";
import * as fs from "node:fs";
import { createTestApp } from "./helpers";

// The design system is a set of checked-in stylesheets now, bundled by Vite.
// Reading the sources keeps the single-definition contract independent of any
// one build.
const DESIGN_CSS = [
  "../../web/src/styles/tokens.css",
  "../../web/src/styles/base.css",
  "../../web/src/styles/print.css",
  ...fs
    .readdirSync(new URL("../../web/src/styles/components", import.meta.url), { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(".css"))
    .sort()
    .map((file) => `../../web/src/styles/components/${file}`),
]
  .map((file) => fs.readFileSync(new URL(file, import.meta.url), "utf8"))
  .join("\n");

function topLevelSelectors(css: string): string[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[] = [];
  let index = 0;
  while (index < source.length) {
    const open = source.indexOf("{", index);
    if (open < 0) break;
    const selector = source.slice(index, open).trim();
    let depth = 1;
    let cursor = open + 1;
    while (cursor < source.length && depth > 0) {
      if (source[cursor] === "{") depth += 1;
      if (source[cursor] === "}") depth -= 1;
      cursor += 1;
    }
    if (selector && !selector.startsWith("@")) {
      for (const part of selector.split(",")) out.push(part.trim());
    }
    index = cursor;
  }
  return out;
}

test("the design system is a checked-in stylesheet with both themes and the brand tokens", () => {
  expect(DESIGN_CSS).toContain('[data-theme="dark"]');
  expect(DESIGN_CSS).toContain("color-scheme:dark");
  expect(DESIGN_CSS).toContain("--bg:#f6f5f1");
  expect(DESIGN_CSS).toContain("--bg:#0e1114");
  expect(DESIGN_CSS).toContain("--heading:#f4f6f9");
  expect(DESIGN_CSS).toContain("--brand-fill");
  expect(DESIGN_CSS).not.toContain("--accent-fill");
});

test("shared console components have one top-level definition", () => {
  const selectors = topLevelSelectors(DESIGN_CSS);
  const normalize = (value: string) => value.replace(/^(?:body|:is\([^)]*\))\s+/, "");
  for (const selector of [
    ".avatar",
    ".topbar-right",
    ".theme-toggle",
    ".topbar-search",
    ".console-tabs",
    ".settings-nav.console-tabs",
  ]) {
    expect(selectors.map(normalize).filter((value) => value === selector)).toHaveLength(1);
  }
});

test("the stylesheet import order is explicit", () => {
  const entry = fs.readFileSync(new URL("../../web/src/styles/index.css", import.meta.url), "utf8");
  const imports = [...entry.matchAll(/@import\s+"([^"]+)"/g)].map((match) => match[1]);
  const at = (needle: string) => imports.findIndex((file) => file.includes(needle));
  expect(at("./tokens.css")).toBeGreaterThanOrEqual(0);
  expect(at("./tokens.css")).toBeLessThan(at("./base.css"));
  expect(at("./base.css")).toBeLessThan(at("./components/shell.css"));
  expect(at("./components/shell.css")).toBeLessThan(at("tailwindcss/utilities.css"));
  expect(at("tailwindcss/utilities.css")).toBeLessThan(at("./features/shell.css"));
  expect(at("./features/shell.css")).toBeLessThan(at("./overrides/shadcn.css"));
  expect(imports[imports.length - 1]).toContain("./print.css");
});

test("the SPA serves the bundled design system instead of the old console.css", async () => {
  const ctx = await createTestApp();
  try {
    const page = await ctx.app.inject({ method: "GET", url: "/ui/login" });
    expect(page.statusCode).toBe(200);
    expect(page.body).not.toContain("/ui/console.css");
    const asset = /\/assets\/[^"]+\.css/.exec(page.body)?.[0];
    expect(asset).toBeTruthy();

    const css = await ctx.app.inject({ method: "GET", url: asset! });
    expect(css.statusCode).toBe(200);
    expect(css.headers["cache-control"]).toContain("immutable");
    expect(css.body).toMatch(/\[data-theme=("dark"|dark)\]/);
    expect(css.body).toContain("--brand-fill");
    expect(css.body).toContain(".runs-toolbar");
  } finally {
    await ctx.cleanup();
  }
});
