import { useSyncExternalStore } from "react";

// The shared stylesheet drives every surface through CSS custom properties on
// <html data-theme>. Canvas charts cannot read those variables, so this exposes
// the current theme (to recompute) and the resolved token values.
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

export function useTheme(): string {
  return useSyncExternalStore(subscribe, () => document.documentElement.dataset.theme ?? "light", () => "light");
}

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
