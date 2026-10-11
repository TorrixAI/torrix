// Brand asset paths. Bun resolves these to real files at runtime and to
// embedded paths inside compiled binaries, so `Bun.file()` works in both.
import brandLogo from "./torrix-logo.png" with { type: "file" };
import geistLatin from "./fonts/geist-latin.woff2" with { type: "file" };
import geistLatinExt from "./fonts/geist-latin-ext.woff2" with { type: "file" };
import jetbrainsMonoLatin from "./fonts/jetbrains-mono-latin.woff2" with { type: "file" };
import jetbrainsMonoLatinExt from "./fonts/jetbrains-mono-latin-ext.woff2" with { type: "file" };
import spaceGroteskLatin from "./fonts/space-grotesk-latin.woff2" with { type: "file" };
import spaceGroteskLatinExt from "./fonts/space-grotesk-latin-ext.woff2" with { type: "file" };

export const BRAND_LOGO_PATH = brandLogo;

export const FONT_PATHS: Record<string, string> = {
  "geist-latin.woff2": geistLatin,
  "geist-latin-ext.woff2": geistLatinExt,
  "jetbrains-mono-latin.woff2": jetbrainsMonoLatin,
  "jetbrains-mono-latin-ext.woff2": jetbrainsMonoLatinExt,
  "space-grotesk-latin.woff2": spaceGroteskLatin,
  "space-grotesk-latin-ext.woff2": spaceGroteskLatinExt,
};
