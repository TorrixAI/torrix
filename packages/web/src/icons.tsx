// Marks are copied verbatim from the server console (routes/ui.ts) so the React
// SPA and the still server-rendered pages show identical icons. Raw SVG strings
// keep a single source shape; the shared stylesheet sizes them via `.nav-item svg`.
import { Button } from "@/components/ui/button";

const TORRIX_MARK_PATH = "M16 6.399L21.979 16.754L24.561 12.283L22.095 13.706L21.283 12.299L29 7.843L21.979 20.004L16 9.649L10.021 20.004L3 7.843L10.717 12.299L9.905 13.706L7.439 12.283L10.021 16.754ZM16 11.996L20.624 20.004L18.747 20.004L16 15.246L13.253 20.004L11.376 20.004ZM7.439 21.178L24.561 21.178L23.622 22.803L10.254 22.803L10.932 23.976L22.945 23.976L22.006 25.601L9.994 25.601Z";

export function TorrixMark({ className, label }: { className?: string; label?: string }) {
  return <svg className={className} viewBox="0 0 32 32" fill="currentColor" role={label ? "img" : undefined} aria-hidden={label ? undefined : true} aria-label={label}><path d={TORRIX_MARK_PATH} /></svg>;
}

const RAW: Record<string, string> = {
  logo: `<svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><path d="${TORRIX_MARK_PATH}"/></svg>`,
  dash: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
  <rect x="2.5" y="8" width="3" height="5.5" rx="1" fill="currentColor" fill-opacity="0.55"/>
  <rect x="6.5" y="4" width="3" height="9.5" rx="1" fill="currentColor" fill-opacity="0.85"/>
  <rect x="10.5" y="9.5" width="3" height="4" rx="1" fill="currentColor"/>
</svg>`,
  analytics: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M2.5 13.5h11"/>
  <path d="M4.5 13.5V8.8"/><path d="M7.5 13.5V4.5"/><path d="M10.5 13.5V7"/><path d="M13 13.5V6"/>
</svg>`,
  runs: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M2.5 12.5 13.5 3.5"/>
  <path d="M6.5 3.5h7v7"/>
</svg>`,
  trace: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="4" cy="3.5" r="1.8"/><circle cx="12" cy="7" r="1.8"/><circle cx="5.5" cy="12.5" r="1.8"/>
  <path d="M5.3 5.2 10.5 6.2"/><path d="M10.9 8.6 6.9 11.2"/>
</svg>`,
  live: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M1.5 8h3l2-4.5L9.5 12l2-4h3"/>
</svg>`,
  insights: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M8 1.8v1.4"/><path d="M3.4 3.4 4.4 4.4"/><path d="M12.6 3.4 11.6 4.4"/>
  <path d="M5.2 11.2a4 4 0 1 1 5.6 0c-.5.5-.8 1-.8 1.6H6c0-.6-.3-1.1-.8-1.6Z"/>
  <path d="M6.6 14.2h2.8"/>
</svg>`,
  play: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M2.5 8a5.5 5.5 0 1 1 11 0 5.5 5.5 0 0 1-11 0z"/>
  <path d="M6.75 5.9c0-.68.75-1.1 1.33-.74l2.57 1.63c.54.34.54 1.14 0 1.48l-2.57 1.63c-.58.36-1.33-.06-1.33-.74z" fill="currentColor" stroke="none"/>
</svg>`,
  agent: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="3.2" y="5.4" width="9.6" height="7.2" rx="2.2"/>
  <path d="M8 5.4V2.9"/><circle cx="8" cy="2.1" r="0.9" fill="currentColor" stroke="none"/>
  <circle cx="6.1" cy="8.7" r="0.9" fill="currentColor" stroke="none"/>
  <circle cx="9.9" cy="8.7" r="0.9" fill="currentColor" stroke="none"/>
  <path d="M6.2 10.7h3.6"/>
</svg>`,
  prompt: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M3 2.5h6L12.5 6v7.5h-9.5z"/>
  <path d="M9 2.5V6h3.5"/>
  <path d="M5.4 9.2h5.2"/>
  <path d="M5.4 11.4h3.4"/>
</svg>`,
  data: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <ellipse cx="8" cy="3.2" rx="5.6" ry="1.8"/>
  <path d="M2.4 3.2v4.6c0 1 2.5 1.8 5.6 1.8s5.6-.8 5.6-1.8V3.2"/>
  <path d="M2.4 7.8v4.6c0 1 2.5 1.8 5.6 1.8s5.6-.8 5.6-1.8V7.8"/>
</svg>`,
  cost: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M8 11.5a2.6 2.6 0 0 0 2-3c-.3-2-2-2-2-4 0-.4.1-.6.2-.8"/>
  <path d="M8 15.5A6.5 6.5 0 0 0 11.5 3.5c.9 1.4 1.7 3.5 1.4 5.3A2.8 2.8 0 0 1 10 10.9"/>
  <path d="M8 11.5A2.6 2.6 0 0 0 6 8.5c.3-2 2-2 2-4 0 .5-.1.5 0 1.7"/>
  <path d="M4.5 3.5A6.5 6.5 0 0 0 8 15.5c-2.4 0-4.4-1-5.7-2.7"/>
  <path d="M3 2.5h10"/>
</svg>`,
  folder: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M1.8 4.2h4l1.4 1.6h7v7.4a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z"/>
  <path d="M1.8 4.2V3.1a1 1 0 0 1 1-1h3.3l1.6 2.1"/>
</svg>`,
  team: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="6" cy="5.5" r="2.2"/>
  <path d="M2.5 13c.4-2.2 1.8-3.4 3.5-3.4S9.1 10.8 9.5 13"/>
  <path d="M10.6 3.9a2 2 0 0 1 0 3.4"/><path d="M11.5 9.9c1.3.3 2.1 1.4 2.4 3.1"/>
</svg>`,
  key: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="5.2" cy="10.8" r="2.7"/>
  <path d="M7.3 8.8 12.9 3.2M10.5 5.6l1.4 1.4M12.7 3.4l1.4 1.4"/>
</svg>`,
  shield: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M8 1.9 13 3.6v4.2c0 3-2.1 5.4-5 6.3-2.9-.9-5-3.3-5-6.3V3.6z"/>
  <path d="M5.9 7.9 7.4 9.4l2.9-3"/>
</svg>`,
  compliance: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M4 1.8h6.2L13 4.6v9.6H4z"/><path d="M10 1.8v3h3"/>
  <path d="M6.2 9.2l1.4 1.4 2.6-2.8"/>
</svg>`,
  terminal: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="1.8" y="2.6" width="12.4" height="10.8" rx="1.6"/>
  <path d="M4.4 6.2 6.6 8l-2.2 1.8"/><path d="M8.4 10h3.2"/>
</svg>`,
  set: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="8" cy="8" r="2.4"/>
  <path d="M13.2 8c0-.5-.1-1-.2-1.5l1.4-1.1-1.4-2.4-1.7.7A6.5 6.5 0 0 0 9.8 2.7L9.5.8H6.5l-.3 1.9c-.6.3-1.2.7-1.7 1.2l-1.7-.7-1.4 2.4 1.4 1.1c-.1.5-.2 1-.2 1.5s.1 1 .2 1.5l-1.4 1.1 1.4 2.4 1.7-.7c.5.5 1.1.9 1.7 1.2l.3 1.9h3l.3-1.9c.6-.3 1.2-.7 1.7-1.2l1.7.7 1.4-2.4-1.4-1.1c.1-.5.2-1 .2-1.5z"/>
</svg>`,
  rows: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M3 4.5h10M3 8h10M3 11.5h10"/></svg>`,
  chevron: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5"/></svg>`,
  activity: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.8 8h2.2l1.4-3.1 2.2 6.2 1.6-3.1h4.9"/></svg>`,
  eye: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.6 8s2.5-4.4 6.4-4.4S14.4 8 14.4 8s-2.5 4.4-6.4 4.4S1.6 8 1.6 8Z"/><circle cx="8" cy="8" r="2"/></svg>`,
  server: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="2.8" width="11" height="4.1" rx="1.1"/><rect x="2.5" y="9.1" width="11" height="4.1" rx="1.1"/><path d="M5 4.8h.1M5 11.1h.1"/></svg>`,
  graph: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="3.4" cy="8" r="1.6"/><circle cx="12.4" cy="4" r="1.6"/><circle cx="12.4" cy="12" r="1.6"/><path d="m4.9 7.4 6-2.7M4.9 8.6l6 2.7"/></svg>`,
  registry: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="2.8" width="11" height="2.8" rx="1"/><rect x="2.5" y="6.6" width="11" height="2.8" rx="1"/><rect x="2.5" y="10.4" width="11" height="2.8" rx="1"/></svg>`,
  policy: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2.5h6.5L13 6v7.5H3z"/><path d="M9.5 2.5V6H13"/><path d="m5.5 9.1 1.5 1.5 3-3"/></svg>`,
  approval: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="5.6"/><path d="m5.3 8 1.8 1.8 3.6-3.7"/></svg>`,
  delegation: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="4.1" r="1.7"/><circle cx="11.5" cy="6.2" r="1.4"/><path d="M2.4 13c0-2.1 1.2-3.3 2.6-3.3S7.6 10.9 7.6 13"/><path d="M9.2 12.5c0-1.6.9-2.6 2.4-2.6"/><path d="m9.6 8.2-2.4-1.9"/></svg>`,
  search: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
  <circle cx="7" cy="7" r="4.4"/>
  <path d="m13.4 13.4-3.3-3.3"/>
</svg>`,
  sun: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
  <circle cx="8" cy="8" r="3"/>
  <path d="M8 1.4v1.7M8 12.9v1.7M1.4 8h1.7M12.9 8h1.7M3.3 3.3l1.2 1.2M11.5 11.5l1.2 1.2M12.7 3.3l-1.2 1.2M4.5 11.5l-1.2 1.2"/>
</svg>`,
  moon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M13.4 9.7A5.7 5.7 0 0 1 6.3 2.6a6 6 0 1 0 7.1 7.1Z"/>
</svg>`,
  out: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M9.5 2.5H4.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h5"/>
  <path d="M10.5 5.5 13.5 8l-3 2.5"/>
  <path d="M13 8H6.5"/>
</svg>`,
  plug: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M6 2.5v3M10 2.5v3"/>
  <path d="M4 5.5h8v2.5a4 4 0 0 1-8 0z"/>
  <path d="M8 12v1.5"/>
</svg>`,
};

export function Icon({ name }: { name: string }) {
  const svg = RAW[name];
  if (!svg) return null;
  return <span className="ico" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function ThemeToggle({ onClick }: { onClick?: () => void }) {
  return <Button variant="ghost" className="theme-toggle" type="button" aria-label="Switch color theme" title="Switch color theme" onClick={onClick}>
    <span className="ico-moon" dangerouslySetInnerHTML={{ __html: RAW.moon }} />
    <span className="ico-sun" dangerouslySetInnerHTML={{ __html: RAW.sun }} />
  </Button>;
}
