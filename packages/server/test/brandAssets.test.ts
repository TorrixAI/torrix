import { expect, test } from "bun:test";
import * as fs from "node:fs";
import { createTestApp } from "./helpers";

test("console serves the monochrome brand set and the Geist type stack", async () => {
  const ctx = await createTestApp();
  try {
    const mark = await ctx.app.inject({ method: "GET", url: "/ui/assets/mark-ink.svg" });
    expect(mark.statusCode).toBe(200);
    expect(mark.headers["content-type"]).toContain("image/svg+xml");
    expect(mark.body).toContain("viewBox=\"0 -781 1057.451 781\"");
    expect(mark.body).toContain("fill=\"#15161A\"");

    const whiteMark = await ctx.app.inject({ method: "GET", url: "/ui/assets/mark-white.svg" });
    expect(whiteMark.statusCode).toBe(200);
    expect(whiteMark.body).toContain("fill=\"#FFFFFF\"");

    const lockup = await ctx.app.inject({ method: "GET", url: "/ui/assets/lockup-white.svg" });
    expect(lockup.statusCode).toBe(200);
    expect(lockup.body).toContain("aria-label=\"Torrix\"");
    expect(lockup.body).not.toContain("#15161A");

    const favicon = await ctx.app.inject({ method: "GET", url: "/ui/assets/favicon.svg" });
    expect(favicon.statusCode).toBe(200);
    expect(favicon.body).toContain("prefers-color-scheme:dark");

    for (const file of ["favicon-32.png", "apple-touch-icon.png"]) {
      const icon = await ctx.app.inject({ method: "GET", url: `/ui/assets/${file}` });
      expect(icon.statusCode).toBe(200);
      expect(icon.headers["content-type"]).toContain("image/png");
      expect(icon.rawPayload.length).toBeGreaterThan(100);
    }

    const oldLogo = await ctx.app.inject({ method: "GET", url: "/ui/assets/torrix-logo.png" });
    expect(oldLogo.statusCode).toBe(404);

    for (const file of ["geist-latin.woff2", "geist-mono-latin.woff2"]) {
      const font = await ctx.app.inject({ method: "GET", url: `/ui/fonts/${file}` });
      expect(font.statusCode).toBe(200);
      expect(font.rawPayload.length).toBeGreaterThan(1000);
    }
    const retiredFont = await ctx.app.inject({ method: "GET", url: "/ui/fonts/jetbrains-mono-latin.woff2" });
    expect(retiredFont.statusCode).toBe(404);

    const css = fs.readFileSync(new URL("../../web/src/styles/tokens.css", import.meta.url), "utf8");
    expect(css).toContain('font-family:"Geist Mono"');
    expect(css).toContain("--bg:#f6f5f1");
    expect(css).toContain("--line:rgba(21,22,26,.10)");
    expect(css).toContain("--bg:#0e1114");
    expect(css).not.toContain("Space Grotesk");
    expect(css).not.toContain("JetBrains Mono");
    expect(css).not.toContain("--r-pill:9999px");

    const login = await ctx.app.inject({ method: "GET", url: "/ui/login" });
    expect(login.statusCode).toBe(200);
    expect(login.body).toContain('type="image/svg+xml" href="/ui/assets/favicon.svg"');
  } finally {
    await ctx.cleanup();
  }
});
