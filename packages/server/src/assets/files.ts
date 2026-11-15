// Brand asset paths. Bun resolves these to real files at runtime and to
// embedded paths inside compiled binaries, so `Bun.file()` works in both.
import markInk from "./mark-ink.svg" with { type: "file" };
import markWhite from "./mark-white.svg" with { type: "file" };
import lockupInk from "./lockup-ink.svg" with { type: "file" };
import lockupWhite from "./lockup-white.svg" with { type: "file" };
import faviconSvg from "./favicon.svg" with { type: "file" };
import favicon32 from "./favicon-32.png" with { type: "file" };
import appleTouchIcon from "./apple-touch-icon-180.png" with { type: "file" };
import geistLatin from "./fonts/geist-latin.woff2" with { type: "file" };
import geistLatinExt from "./fonts/geist-latin-ext.woff2" with { type: "file" };
import geistMonoLatin from "./fonts/geist-mono-latin.woff2" with { type: "file" };
import geistMonoLatinExt from "./fonts/geist-mono-latin-ext.woff2" with { type: "file" };

export const BRAND_ASSET_PATHS: Record<string, { path: string; type: string }> = {
  "mark-ink.svg": { path: markInk, type: "image/svg+xml" },
  "mark-white.svg": { path: markWhite, type: "image/svg+xml" },
  "lockup-ink.svg": { path: lockupInk, type: "image/svg+xml" },
  "lockup-white.svg": { path: lockupWhite, type: "image/svg+xml" },
  "favicon.svg": { path: faviconSvg, type: "image/svg+xml" },
  "favicon-32.png": { path: favicon32, type: "image/png" },
  "apple-touch-icon.png": { path: appleTouchIcon, type: "image/png" },
};

export const FONT_PATHS: Record<string, string> = {
  "geist-latin.woff2": geistLatin,
  "geist-latin-ext.woff2": geistLatinExt,
  "geist-mono-latin.woff2": geistMonoLatin,
  "geist-mono-latin-ext.woff2": geistMonoLatinExt,
};
