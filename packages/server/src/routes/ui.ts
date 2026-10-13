import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import * as path from "node:path";
import { BRAND_LOGO_PATH, FONT_PATHS } from "../assets/files";
import { editionAtLeast, type Edition, type ServerConfig } from "../core/config";
import type { ExtensionHost } from "../core/extensionHost";
import type { TraceAnnotation } from "../core/extensions";
import { lockedFeature, type LockedFeature } from "../core/lockedFeatures";
import type { Repositories } from "../repos";
import { extractBearer, authenticateKey, readAuthCookie, buildAuthCookie, clearAuthCookie } from "../lib/auth";
import { monthStart, spendSince } from "../lib/costGate";
import { getInsights, type InsightsReport } from "../lib/insights";
import { savingsReport, type SavingsReport } from "../lib/savings";
import { buildRunTree, runEndMs, runStartMs } from "../lib/runTree";
import { extractUserPrompt } from "../lib/extract";
import { PII_TYPES, parsePiiTypes } from "../lib/pii";
import type { AuthResult, Run, Events, Prompt, PromptVersion, Dataset, DatasetRow, Eval, Project, ApiKey, AlertSettings, PricingOverride, AuditEntry, GovernanceSettings, Policy, ReviewItem, RoutingRule, ExportConfig, OnlineEvalConfig, RunJudgment, JudgeSettings } from "../core/domain";
import type { DashboardStats, GroupRoot, ProjectAccess, RunEventCount, RunListSummary, RunToolEvent, TraceGroup, AnalyticsRow } from "../core/ports";

export interface UiDeps {
  repos: Repositories;
  config: ServerConfig;
  env: NodeJS.ProcessEnv;
  host?: ExtensionHost;
}

const STYLE = String.raw`
@font-face{font-family:"Geist";font-style:normal;font-weight:100 900;font-display:swap;
  src:url("/ui/fonts/geist-latin-ext.woff2") format("woff2");
  unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:"Geist";font-style:normal;font-weight:100 900;font-display:swap;
  src:url("/ui/fonts/geist-latin.woff2") format("woff2");
  unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:"Space Grotesk";font-style:normal;font-weight:300 700;font-display:swap;
  src:url("/ui/fonts/space-grotesk-latin-ext.woff2") format("woff2");
  unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:"Space Grotesk";font-style:normal;font-weight:300 700;font-display:swap;
  src:url("/ui/fonts/space-grotesk-latin.woff2") format("woff2");
  unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:"JetBrains Mono";font-style:normal;font-weight:100 800;font-display:swap;
  src:url("/ui/fonts/jetbrains-mono-latin-ext.woff2") format("woff2");
  unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:"JetBrains Mono";font-style:normal;font-weight:100 800;font-display:swap;
  src:url("/ui/fonts/jetbrains-mono-latin.woff2") format("woff2");
  unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
:root{
  color-scheme:light;
  --bg:#f8fafc; --bg-2:#f1f5f9; --surface:#ffffff; --surface-2:#f1f5f9; --surface-3:#e2e8f0; --surface-4:#cbd5e1;
  --line:#e2e8f0; --line-2:#cbd5e1;
  --text:#0f172a; --text-2:#334155; --text-3:#5b6a80; --text-mute:#94a3b8; --link:#0369a1;
  --heading:#0f172a; --placeholder:#94a3b8;
  --accent:#0284c7; --accent-strong:#0ea5e9; --accent-deep:#0369a1; --accent-fill:#0369a1; --on-accent:#ffffff;
  --accent-dim:rgba(2,132,199,.08); --accent-line:rgba(2,132,199,.26);
  --good:#059669; --good-dim:#ecfdf5; --good-line:#a7f3d0;
  --bad:#dc2626; --bad-dim:#fef2f2; --bad-line:#fecaca; --bad-strong:#b91c1c;
  --warn:#d97706; --warn-dim:#fffbeb; --warn-line:#fde68a;
  --info:#0284c7; --info-dim:#eff6ff; --info-line:#bfdbfe;
  --violet:#8b5cf6; --violet-dim:#f5f3ff; --violet-line:#ddd6fe;
  --s1:#0284c7; --s2:#8b5cf6; --s3:#f59e0b; --s4:#10b981; --s5:#ef4444;
  --chip-bg:#e0f2fe; --chip-on:#075985; --track:#e2e8f0; --nav-on:#ffffff;
  --selection:#bae6fd; --t-dot-bg:#ffffff;
  --sans:"Geist",system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --display:"Space Grotesk","Geist",system-ui,-apple-system,sans-serif;
  --mono:"JetBrains Mono",ui-monospace,"SF Mono","Cascadia Code",Menlo,Consolas,monospace;
  --shadow:0 1px 2px rgba(15,23,42,.04),0 10px 30px -14px rgba(15,23,42,.12);
  --shadow-sm:0 1px 2px rgba(15,23,42,.05),0 6px 18px -12px rgba(15,23,42,.10);
  --shadow-md:0 16px 44px -18px rgba(15,23,42,.26),0 2px 6px rgba(15,23,42,.06);
  --shadow-blue:0 1px 2px rgba(15,23,42,.05);
  --r:10px; --r-lg:14px; --r-xl:16px; --r-pill:9999px;
  --wash:rgba(148,163,184,.10); --wash-2:rgba(148,163,184,.07);
  --grid-dot:rgba(100,116,139,.12); --grid-dot-hot:#0284c7; --mx:-500px; --my:-500px;
  --row-hover:#f8fafc; --row-error:#fef2f2;
  --side-bg:#ffffff; --side-bg-2:#f8fafc; --side-line:#e2e8f0;
  --side-text:#0f172a; --side-text-2:#475569; --side-text-3:#94a3b8;
  --side-hover:#f1f5f9; --side-active-bg:rgba(2,132,199,.08); --side-active-text:#0369a1;
  --side-brand-text:#0f172a; --side-btn-bg:#f8fafc; --side-btn-hover:#f1f5f9;
  --topbar-bg:rgba(255,255,255,.96);
  --scroll:#cbd5e1; --scroll-hover:#94a3b8;
  --bar-from:#0ea5e9; --bar-to:#0284c7;
  --tooltip-bg:#0f172a; --tooltip-line:#1e293b; --tooltip-text:#f8fafc;
}
*{box-sizing:border-box}
::selection{background:var(--selection);color:var(--text)}
html{-webkit-text-size-adjust:100%;scrollbar-color:var(--scroll) transparent}
*::-webkit-scrollbar{width:10px;height:10px}
*::-webkit-scrollbar-track{background:transparent}
*::-webkit-scrollbar-thumb{background:var(--scroll);border:3px solid transparent;background-clip:content-box;border-radius:99px}
*::-webkit-scrollbar-thumb:hover{background:var(--scroll-hover);border:3px solid transparent;background-clip:content-box}
body{margin:0;background:var(--bg);color:var(--text);font:13.5px/1.55 var(--sans);letter-spacing:-.006em;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
  font-variant-numeric:tabular-nums}
body::before{content:"";position:fixed;inset:0;z-index:-2;pointer-events:none;
  background-image:radial-gradient(circle,var(--grid-dot) 0.75px,transparent 0.75px);
  background-size:16px 16px}
body::after{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;
  background-image:radial-gradient(circle,var(--grid-dot-hot) 1px,transparent 1px);
  background-size:16px 16px;
  -webkit-mask-image:radial-gradient(220px 220px at var(--mx) var(--my),rgba(0,0,0,.7) 0%,rgba(0,0,0,.22) 45%,transparent 80%);
  mask-image:radial-gradient(220px 220px at var(--mx) var(--my),rgba(0,0,0,.7) 0%,rgba(0,0,0,.22) 45%,transparent 80%)}
@media(prefers-reduced-motion:reduce){body::after{display:none}}
a{color:var(--link);text-decoration:none}
a:hover{color:var(--accent-strong)}
button{font:inherit;cursor:pointer}
svg{display:block}
code{font-family:var(--mono);font-size:.92em;background:var(--surface-2);border:1px solid var(--line);border-radius:6px;padding:.06em .4em;color:var(--text-2)}
:focus-visible{outline:2px solid var(--accent-line);outline-offset:2px}
.mono{font-family:var(--mono)}
.tnum{font-feature-settings:"tnum" 1}

/* layout */
.app{display:flex;min-height:100vh;padding:12px;gap:16px}
.main{flex:1;min-width:0;display:flex;flex-direction:column}
.content{width:100%;max-width:1260px;margin:0 auto;padding:22px 18px 72px;animation:rise .22s ease;transition:opacity .12s ease,transform .12s ease}
.content.spa-exit{opacity:.4;transform:translateY(3px)}
@keyframes rise{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}

/* sidebar */
.sidebar{flex:0 0 248px;height:calc(100vh - 24px);position:sticky;top:12px;display:flex;flex-direction:column;padding:12px;
  background:var(--side-bg);border:1px solid var(--side-line);border-radius:20px;box-shadow:var(--shadow)}
.brand{display:flex;align-items:center;gap:10px;padding:6px 8px 14px;margin-bottom:6px;flex:0 0 auto}
.brand .brand-mark{width:28px;height:28px;border-radius:8px;object-fit:cover;flex:0 0 auto}
.brand-text{display:flex;flex-direction:column;min-width:0}
.brand .word{font-family:var(--display);font-size:15px;font-weight:600;letter-spacing:-.015em;line-height:1.1;color:var(--side-brand-text)}
.brand-sub{font-family:var(--mono);font-size:9px;font-weight:500;letter-spacing:.1em;text-transform:uppercase;color:var(--side-text-2);margin-top:3px;white-space:nowrap}
.nav-groups{display:flex;flex-direction:column;gap:16px;padding:2px 0 8px}
.nav-group{display:flex;flex-direction:column;gap:1px}
.nav-cap{padding:0 8px 6px;font-family:var(--mono);font-size:9.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--side-text-2)}
.nav-item{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:12px;color:var(--side-text-2);font-size:13px;font-weight:450;
  border:1px solid transparent;transition:background .12s,color .12s,border-color .12s,box-shadow .12s}
.nav-item svg{width:18px;height:18px;flex:0 0 18px;opacity:.9}
.nav-item:hover{background:var(--side-hover);color:var(--side-text)}
.nav-item.active{background:var(--surface);color:var(--side-active-text);font-weight:600;border-color:var(--side-line);box-shadow:var(--shadow-sm)}
.nav-item.active svg{opacity:1}
.side-foot{margin-top:auto;display:flex;flex-direction:column;gap:8px;padding-top:12px;border-top:1px solid var(--side-line)}
.edition-chip{display:flex;align-items:center;gap:9px;font-family:var(--mono);font-size:9.5px;font-weight:500;letter-spacing:.05em;
  color:var(--side-text-2);background:var(--side-btn-bg);border:1px solid var(--side-line);border-radius:var(--r);padding:8px 10px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.edition-chip::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--accent-strong);flex:0 0 6px}
.side-foot .btn{width:100%}
.side-foot .btn-ghost{background:var(--side-btn-bg);border-color:var(--side-line);color:var(--side-text)}
.side-foot .btn-ghost:hover{background:var(--side-btn-hover);color:var(--side-text)}
.side-foot .theme-toggle{background:var(--side-btn-bg);border-color:var(--side-line);color:var(--side-text-2)}
.side-foot .theme-toggle:hover{background:var(--side-btn-hover);color:var(--side-text);border-color:var(--side-line)}
.side-foot-row{display:flex;align-items:center;justify-content:space-between;gap:8px}

/* topbar */
.topbar{height:56px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0;position:sticky;top:12px;z-index:30;margin-bottom:16px;
  background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow-sm)}
.topbar-inner{display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;max-width:1260px;margin:0 auto;padding:0 18px}
.crumbs{display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:11px;color:var(--text-3);white-space:nowrap;min-width:0;flex:0 1 auto;overflow:hidden}
.crumbs b{color:var(--text);font-weight:600}
.topbar-search{display:flex;align-items:center;gap:9px;flex:0 1 420px;margin-right:auto;background:var(--surface-2);border:1px solid var(--line);
  border-radius:var(--r-pill);padding:7px 14px;color:var(--text-3);transition:border-color .15s,box-shadow .15s,background .15s}
.topbar-search:focus-within{background:var(--surface);border-color:var(--accent);box-shadow:none}
.topbar-search svg{width:15px;height:15px;flex:0 0 15px}
.topbar-search input[type=text]{flex:1;min-width:0;width:auto;background:transparent;border:0;border-radius:0;padding:0;outline:none;color:var(--text);font:inherit;font-size:12.5px}
.topbar-search input::placeholder{color:var(--placeholder)}
.topbar-search kbd{font:10px var(--mono);color:var(--text-3);border:1px solid var(--line);border-radius:var(--r-pill);padding:1px 6px;background:var(--surface-3)}
.topbar-right{display:flex;align-items:center;gap:10px;min-width:0}
.avatar{width:30px;height:30px;border-radius:50%;background:var(--accent-deep);color:var(--on-accent);display:inline-flex;align-items:center;justify-content:center;
  font:600 11px var(--mono);letter-spacing:.02em;flex:0 0 30px}
.avatar-btn{border:1px solid transparent;cursor:pointer;padding:0}
.avatar-btn:hover,.user-menu.open .avatar-btn{border-color:var(--accent-line);box-shadow:0 0 0 3px var(--accent-dim)}
.user-menu{position:relative}
.user-menu-panel{display:none;position:absolute;right:0;top:calc(100% + 10px);z-index:55;min-width:230px;background:var(--surface);border:1px solid var(--line-2);
  border-radius:var(--r-lg);box-shadow:var(--shadow-md);padding:6px}
.user-menu.open .user-menu-panel{display:block}
.um-head{display:flex;flex-direction:column;gap:7px;padding:9px 11px 10px;border-bottom:1px solid var(--line);margin-bottom:6px}
.um-head b{font-family:var(--mono);font-size:12px;font-weight:600;color:var(--text);word-break:break-all}
.um-item{display:flex;align-items:center;gap:9px;width:100%;padding:8px 11px;border:0;border-radius:6px;background:transparent;color:var(--text-2);
  font:inherit;font-size:13px;text-align:left;cursor:pointer;text-decoration:none}
.um-item:hover{background:var(--surface-2);color:var(--text)}
.um-item svg{width:15px;height:15px;flex:0 0 15px}

/* page head */
.page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:18px;flex-wrap:wrap}
.page-head h1{font-family:var(--display);font-size:24px;letter-spacing:-.022em;margin:0;font-weight:600;color:var(--heading)}
.page-sub{margin:6px 0 0;color:var(--text-2);font-family:var(--mono);font-size:11px}
.head-actions{display:flex;gap:8px;align-items:center}
.demo-banner{display:flex;align-items:center;gap:8px;background:var(--warn-dim);border:1px solid var(--warn-line);color:var(--warn);border-radius:var(--r-lg);padding:10px 14px;font-family:var(--mono);font-size:11px;margin-bottom:14px}
.sys-banner{display:flex;align-items:center;gap:8px;background:var(--accent-dim);border:1px solid var(--accent-line);color:var(--accent);border-radius:var(--r-lg);padding:10px 14px;font-family:var(--mono);font-size:11px;margin-bottom:14px}
.sys-banner code{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:1px 6px}
.up-banner{display:flex;align-items:center;gap:8px;background:var(--surface-2);border:1px solid var(--line);color:var(--text-2);border-radius:var(--r-lg);padding:10px 14px;font-size:12px;margin-bottom:14px}
.up-banner a{color:var(--link)}
.nav-lock{margin-left:auto;font:600 9.5px/1.5 var(--mono);letter-spacing:.06em;text-transform:uppercase;padding:0 5px;border:1px solid var(--line-2);border-radius:4px;color:var(--text-3)}
.app.side-collapsed .nav-lock{display:none}
.locked-card{padding:22px 24px;display:grid;gap:14px;max-width:680px}
.locked-card p{margin:0;color:var(--text-2);line-height:1.65}
.locked-actions{display:flex;gap:8px;flex-wrap:wrap}
/* Page accents: every console section tints its chrome with a data-series
   color, while links and primary actions keep the azure brand color. */
body[data-page]{--page-accent:var(--s1);--page-accent-dim:color-mix(in srgb,var(--s1) 10%,transparent);--page-accent-line:color-mix(in srgb,var(--s1) 34%,transparent)}
body[data-page="analytics"],body[data-page="agents"],body[data-page="governance"],body[data-page="playground"],body[data-page="insights"]{--page-accent:var(--s2);--page-accent-dim:color-mix(in srgb,var(--s2) 10%,transparent);--page-accent-line:color-mix(in srgb,var(--s2) 34%,transparent)}
body[data-page="traces"],body[data-page="prompts"],body[data-page="cost"],body[data-page="keys"],body[data-page="query"]{--page-accent:var(--s3);--page-accent-dim:color-mix(in srgb,var(--s3) 10%,transparent);--page-accent-line:color-mix(in srgb,var(--s3) 34%,transparent)}
body[data-page="live"],body[data-page="datasets"],body[data-page="team"],body[data-page="compliance"]{--page-accent:var(--s4);--page-accent-dim:color-mix(in srgb,var(--s4) 10%,transparent);--page-accent-line:color-mix(in srgb,var(--s4) 34%,transparent)}
.page-head h1::after,.co-head h1::after,.ds-head h1::after,.ph-head h1::after,.rh-title::after{content:"";display:block;width:38px;height:2px;margin-top:9px;border-radius:2px;background:var(--page-accent,var(--accent))}
.panel-head{background-image:linear-gradient(90deg,var(--page-accent-dim,transparent),transparent 280px)}
.panel-title .sig,.spend-title .sig{background:var(--page-accent,var(--accent-strong))}
.panel{transition:border-color .14s ease,box-shadow .14s ease}
.panel:hover{border-color:var(--line-2);box-shadow:var(--shadow-sm)}
.stat-tile::before{content:"";position:absolute;left:0;right:0;top:0;height:2px;border-radius:var(--r-xl) var(--r-xl) 0 0;background:linear-gradient(90deg,var(--page-accent,var(--accent)),transparent 72%)}
.stat-tile .st-label{color:var(--text-3)}
thead th{background:var(--surface-2)}
.filters-card{border-left:3px solid var(--page-accent-line,var(--line))}
.toast-wrap{position:fixed;right:18px;bottom:18px;z-index:60;display:flex;flex-direction:column;gap:8px}
.toast{display:flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--line-2);border-left:3px solid var(--accent);
  border-radius:var(--r-lg);padding:10px 14px;font-size:13px;color:var(--text-2);box-shadow:var(--shadow-md);min-width:220px;max-width:380px}
.toast.success{border-left-color:var(--good)} .toast.error{border-left-color:var(--bad)}
.toast button{background:transparent;border:0;color:var(--accent);font-weight:600;cursor:pointer;font-size:12.5px}
.cmdk-overlay{position:fixed;inset:0;z-index:70;background:rgba(8,12,22,.45);display:none;align-items:flex-start;justify-content:center;padding-top:12vh}
.cmdk-overlay.open{display:flex}
.cmdk{width:min(560px,92vw);background:var(--surface);border:1px solid var(--line-2);border-radius:var(--r-lg);box-shadow:var(--shadow-md);overflow:hidden}
.cmdk input[type=text]{width:100%;border:0;border-bottom:1px solid var(--line);border-radius:0;background:transparent;color:var(--text);padding:14px 16px;font-size:14px;outline:none;font-family:inherit}
.cmdk-list{max-height:320px;overflow:auto;padding:6px}
.cmdk-item{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:6px;color:var(--text-2);cursor:pointer;font-size:13px}
.cmdk-item.active,.cmdk-item:hover{background:var(--surface-2);color:var(--text)}
.cmdk-item kbd{margin-left:auto;font-family:var(--mono);font-size:10px;color:var(--text-3)}
.modal-overlay{position:fixed;inset:0;z-index:80;background:rgba(8,12,22,.45);display:none;align-items:center;justify-content:center}
.modal-overlay.open{display:flex}
.modal{width:min(420px,92vw);background:var(--surface);border:1px solid var(--line-2);border-radius:var(--r-lg);box-shadow:var(--shadow-md);padding:18px 20px}
.modal h3{margin:0 0 6px;font-size:16px}
.modal p{margin:0 0 14px;color:var(--text-2);font-size:13px}
.modal-actions{display:flex;justify-content:flex-end;gap:8px}
.skeleton{background:linear-gradient(90deg,var(--surface-2) 25%,var(--surface-3) 37%,var(--surface-2) 63%);
  background-size:400% 100%;animation:skel 1.4s ease infinite;border-radius:6px;height:14px}
@keyframes skel{0%{background-position:100% 0}100%{background-position:0 0}}
.side-toggle{background:transparent;border:1px solid var(--line);color:var(--text-3);border-radius:10px;width:26px;height:26px;cursor:pointer;line-height:1}
.side-toggle:hover{color:var(--text);border-color:var(--line-2)}
.project-pick{background:var(--surface-2);border:1px solid var(--line);color:var(--text-2);border-radius:var(--r-pill);padding:6px 12px;font-size:12px;font-family:var(--mono);max-width:190px;outline:none}
.mobile-menu{display:none;background:transparent;border:1px solid var(--line);border-radius:10px;color:var(--text-2);width:30px;height:30px;cursor:pointer}
@media(max-width:920px){
  .mobile-menu{display:inline-flex;align-items:center;justify-content:center}
  .sidebar{position:fixed;left:0;top:0;bottom:0;z-index:50;transform:translateX(-100%);transition:transform .18s ease}
  .app.side-open .sidebar{transform:none}
  .main{margin-left:0 !important}
  .project-pick{display:none}
}
.app.side-collapsed .sidebar{flex:0 0 56px;width:56px;padding:10px 6px 12px}
.app.side-collapsed .side-foot-row{justify-content:center}
.app.side-collapsed .brand-text{display:none}
.app.side-collapsed .nav-cap,.app.side-collapsed .edition-chip{font-size:0}
.app.side-collapsed .nav-item span{display:none}
.app.side-collapsed .nav-item{justify-content:center;padding:9px 0}
.app.side-collapsed .nav-item svg{width:18px;height:18px}
.app.side-collapsed .sidebar .brand{justify-content:center;padding:0}
.app.side-collapsed .sidebar .brand .brand-mark{width:18px;height:18px;border-radius:5px}
.app.side-collapsed .side-foot{align-items:center}
.app.side-collapsed .side-foot .btn-ghost{overflow:hidden;padding:8px 0;width:100%;white-space:nowrap}
.app.side-collapsed .side-toggle{transform:rotate(180deg)}
.back-link{display:inline-flex;align-items:center;gap:7px;color:var(--text-2);font-family:var(--mono);font-size:11.5px;margin-bottom:14px}
.back-link:hover{color:var(--accent)}

/* panels */
.panel{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-xl);
  box-shadow:var(--shadow);margin-bottom:16px;overflow:hidden}
.panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 18px;border-bottom:1px solid var(--line)}
.panel-title{font-size:13.5px;font-weight:600;letter-spacing:-.01em;color:var(--text);display:flex;align-items:center;gap:8px}
.panel-title .sig{width:3px;height:13px;border-radius:2px;background:var(--accent-strong);flex:0 0 3px}
.panel-note{font-family:var(--mono);font-size:10.5px;color:var(--text-3)}
.panel-body{padding:16px 18px}
.panel-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}

/* kpis */
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px}
.kpi{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-xl);
  box-shadow:var(--shadow);padding:15px 16px;position:relative;overflow:hidden}
.k-label{font-family:var(--mono);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.09em;color:var(--text-3)}
.k-value{font-family:var(--mono);font-size:24px;font-weight:600;letter-spacing:-.02em;margin-top:7px;color:var(--heading);font-variant-numeric:tabular-nums}
.k-sub{margin-top:7px;font-size:12px;color:var(--text-3)}
.k-sub b{color:var(--text);font-weight:600}
.tone-good{color:var(--good)} .tone-bad{color:var(--bad)} .tone-warn{color:var(--warn)} .tone-accent{color:var(--accent)}

/* hero */
.db-hero{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:var(--r-xl);margin-bottom:16px;padding:20px 24px;
  background:var(--surface);box-shadow:var(--shadow)}
.db-hero-spectrum{position:absolute;top:0;left:0;right:0;height:1px;
  background:linear-gradient(90deg,transparent,var(--s1),var(--s2),var(--s3),transparent);opacity:.9}
.db-hero-accent{display:none}
.db-hero-foot{position:relative;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:30px;flex-wrap:wrap;margin-top:0}
.db-hero-label{display:flex;align-items:center;gap:7px;font-family:var(--mono);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:var(--accent-deep)}
.db-hero-num{font-family:var(--mono);font-size:38px;line-height:1.05;font-weight:600;letter-spacing:-.028em;font-variant-numeric:tabular-nums;margin-top:9px;color:var(--heading);display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.db-hero-num em{font-style:normal;color:var(--heading)}
.db-hero-sub{display:block;margin-top:8px;color:var(--text-3);font-family:var(--mono);font-size:11px}
.db-hero-sub b{color:var(--text-2);font-weight:600}
.db-hero-stats{display:flex;gap:0;flex-wrap:wrap;margin-top:0}
.db-hero-stats .db-stat{padding:2px 26px;border-left:1px solid var(--line)}
.db-hero-stats .db-stat:first-child{padding-left:0;border-left:0}
.db-stat .v{font-family:var(--mono);font-size:19px;font-weight:600;letter-spacing:-.018em;color:var(--heading);font-variant-numeric:tabular-nums}
.db-stat .v.s1{color:var(--s1)} .db-stat .v.s2{color:var(--s2)} .db-stat .v.s3{color:var(--s3)}
.db-stat .l{display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:10px;color:var(--text-3);margin-top:5px;white-space:nowrap;letter-spacing:.03em}
.db-stat .s{font-family:var(--mono);font-size:10.5px;color:var(--text-3);margin-top:5px;white-space:nowrap}
.db-stat .s.good{color:var(--good)}
.db-dot{width:6px;height:6px;border-radius:50%;display:inline-block;flex:0 0 6px}
.db-dot.s1{background:var(--s1)} .db-dot.s2{background:var(--s2)} .db-dot.s3{background:var(--s3)} .db-dot.s4{background:var(--s4)}
.db-delta{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:var(--r-pill);border:1px solid var(--accent-line);
  background:var(--accent-dim);color:var(--accent);font:600 10.5px var(--mono);white-space:nowrap}
.db-delta.bad{border-color:var(--bad-line);background:var(--bad-dim);color:var(--bad)}
.db-delta.good{border-color:var(--good-line);background:var(--good-dim);color:var(--good)}
.db-hero-line{display:none}
.db-live{display:inline-flex;align-items:center;gap:7px;padding:5px 11px;border-radius:var(--r-pill);font-family:var(--mono);font-size:9.5px;font-weight:600;
  letter-spacing:.09em;text-transform:uppercase;color:var(--text-2);border:1px solid var(--good-line);background:var(--good-dim);white-space:nowrap}
.db-live-dot{width:6px;height:6px;border-radius:50%;background:var(--good);flex:0 0 6px}

/* kpi tiles */
.db-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:16px}
.db-kpi{position:relative;background:var(--surface);border:1px solid var(--line);
  border-radius:var(--r-xl);padding:16px 18px 14px;overflow:hidden;box-shadow:var(--shadow);transition:border-color .15s,box-shadow .15s}
.db-kpi:hover{border-color:var(--line-2);box-shadow:var(--shadow)}
a.db-kpi{display:block;text-decoration:none;color:inherit}
.db-kpi.tone-s1{--k-tone:var(--s1)} .db-kpi.tone-s2{--k-tone:var(--s2)} .db-kpi.tone-s3{--k-tone:var(--s3)} .db-kpi.tone-s4{--k-tone:var(--s4)} .db-kpi.tone-s5{--k-tone:var(--s5)}
.db-kpi-label{display:flex;align-items:center;justify-content:space-between;gap:8px;font-family:var(--mono);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.09em;color:var(--text-3)}
.k-badge{padding:2px 8px;border-radius:var(--r-pill);border:1px solid var(--line);background:var(--surface-2);color:var(--text-2);font:600 9px var(--mono);letter-spacing:.06em}
.db-kpi-value{font-family:var(--mono);font-size:26px;font-weight:600;letter-spacing:-.022em;margin-top:8px;color:var(--heading);font-variant-numeric:tabular-nums;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.db-kpi-sub{margin-top:7px;font-size:11px;color:var(--text-3);font-variant-numeric:tabular-nums;display:flex;align-items:center;gap:6px}
.db-kpi-sub b{color:var(--text);font-weight:600}
.db-art{display:block;margin-top:12px;pointer-events:none}
.db-art svg{display:block;width:100%;height:34px}

/* stat tiles */
.stat-tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px}
.stat-tile{position:relative;background:var(--surface);border:1px solid var(--line);
  border-radius:var(--r-xl);padding:15px 16px 14px;overflow:hidden;box-shadow:var(--shadow);transition:border-color .15s}
.stat-tile:hover{border-color:var(--line-2)}
a.stat-tile{display:block;text-decoration:none;color:inherit}
.stat-tile .st-label{display:block;font-family:var(--mono);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.09em;color:var(--text-3)}
.stat-tile .st-value{margin-top:9px;font-family:var(--mono);font-size:26px;font-weight:600;letter-spacing:-.022em;color:var(--heading);font-variant-numeric:tabular-nums}
.stat-tile .st-sub{margin-top:7px;font-size:11px;color:var(--text-3);position:relative;z-index:1}
.stat-tile .st-sub b{color:var(--text);font-weight:600}
.stat-tile .st-sub a{color:var(--link);font-weight:500}

/* trends */
.trend{display:inline-flex;align-items:center;gap:3px;font-family:var(--mono);font-size:10px;font-weight:600;color:var(--text-3)}
.trend.up{color:var(--good)} .trend.down{color:var(--bad)} .trend.flat{color:var(--text-3)}
.db-kpi-value .trend,.db-kpi-sub .trend,.stat-tile .st-sub .trend{padding:2px 9px;border-radius:var(--r-pill);border:1px solid transparent}
.db-kpi-value .trend.up,.db-kpi-sub .trend.up,.stat-tile .st-sub .trend.up{background:var(--good-dim);border-color:var(--good-line)}
.db-kpi-value .trend.down,.db-kpi-sub .trend.down,.stat-tile .st-sub .trend.down{background:var(--bad-dim);border-color:var(--bad-line)}
.kpi-trend-sep{margin:0 5px;color:var(--line-2)}

/* spend panel / charts */
.spend-panel{position:relative;background:var(--surface);border:1px solid var(--line);
  border-radius:var(--r-xl);margin-bottom:16px;overflow:hidden;box-shadow:var(--shadow)}
.spend-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 18px;border-bottom:1px solid var(--line)}
.spend-title{display:flex;align-items:center;gap:9px;font-size:13px;font-weight:600;white-space:nowrap}
.spend-title .sig{width:3px;height:13px;border-radius:2px;background:var(--accent-strong)}
.spend-title .sig.live{background:var(--good)}
.spend-sub{color:var(--text-3);font-family:var(--mono);font-weight:500;font-size:10.5px}
.spend-title-block{display:flex;flex-direction:column;gap:3px;min-width:0}
.spend-note{font-family:var(--mono);font-size:10.5px;color:var(--text-3);white-space:nowrap}
.spend-body{position:relative}
.spend-axis{position:absolute;left:20px;right:20px;top:18px;height:176px;pointer-events:none}
.spend-axis i{position:absolute;left:0;right:0;border-top:1px dashed var(--line)}
.axis-label{position:absolute;left:0;transform:translateY(-50%);font:10px var(--mono);color:var(--text-3);background:var(--surface);padding:0 5px;border-radius:3px}
.spend-svg{position:absolute;left:20px;right:20px;top:18px;height:176px;pointer-events:none}
.spend-svg svg{width:100%;height:100%}
.spend-head .range,.filters-card .range{display:inline-flex;gap:2px;margin-left:0;background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r-pill);padding:3px}
.range a{padding:4px 11px;border-radius:var(--r-pill);font-family:var(--mono);font-size:10px;font-weight:600;color:var(--text-3);text-decoration:none;line-height:1.4}
.range a:hover{color:var(--text);background:var(--surface-3)}
.range a.active{color:var(--on-accent);background:var(--accent-fill)}
.bars{display:flex;align-items:flex-end;gap:9px;height:176px;padding:18px 20px 0}
.bar-group{flex:1;height:100%;display:flex;align-items:flex-end;justify-content:center;gap:3px}
.bar{width:100%;max-width:14px;border-radius:6px 6px 2px 2px;min-height:2px;position:relative;transition:filter .12s}
.bar:hover{filter:brightness(1.12)}
.bar:hover::after{content:attr(data-label);position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);
  background:var(--tooltip-bg);border:1px solid var(--tooltip-line);padding:4px 9px;border-radius:4px;font:10px var(--mono);
  color:var(--tooltip-text);white-space:nowrap;z-index:5}
.days{display:flex;gap:9px;padding:10px 20px 0;border-top:1px solid var(--line)}
.days span{flex:1;font-family:var(--mono);font-size:9.5px;color:var(--text-mute);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chart-legend{display:flex;align-items:center;gap:16px;padding:10px 20px 14px;font-family:var(--mono);font-size:10.5px;color:var(--text-3);flex-wrap:wrap}
.chart-legend span{display:inline-flex;align-items:center;gap:6px}
.chart-legend i{width:8px;height:8px;border-radius:2px;display:inline-block}
.chart-legend .g1{background:var(--s1)} .chart-legend .g2{background:var(--s2)} .chart-legend .g3{background:var(--s3)}
.chart-legend .note{margin-left:auto}
.spend-plot{position:relative;padding:18px 20px 0}
.spend-plot svg{display:block;width:100%;height:176px;overflow:visible}
.chart-tip{position:absolute;top:10px;transform:translateX(-50%);z-index:6;background:var(--tooltip-bg);border:1px solid var(--tooltip-line);color:var(--tooltip-text);border-radius:12px;padding:10px 12px;font:10.5px var(--mono);display:flex;flex-direction:column;gap:5px;box-shadow:var(--shadow-md);pointer-events:none;min-width:150px}
.chart-tip[hidden]{display:none}
.chart-tip b{font-size:10px;letter-spacing:.07em;text-transform:uppercase;opacity:.72;font-weight:600}
.chart-tip .ct-row{display:flex;align-items:center;gap:8px}
.chart-tip .ct-row i{width:7px;height:7px;border-radius:2px;flex:0 0 7px}
.chart-tip .ct-row em{margin-left:auto;font-style:normal;font-weight:600}
.chart-tip .g1{background:var(--s1)} .chart-tip .g2{background:var(--s2)} .chart-tip .g3{background:var(--s3)}

/* donut */
.donut-wrap{display:flex;align-items:center;gap:22px;padding:20px}
.donut{position:relative;width:132px;height:132px;flex:0 0 132px}
.donut svg{width:100%;height:100%;transform:rotate(-90deg)}
.donut-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none}
.donut-center b{font:600 15px var(--mono);color:var(--heading);letter-spacing:-.02em}
.donut-center span{font:9px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--text-3);margin-top:2px}
.donut-legend{display:flex;flex-direction:column;gap:10px;flex:1;min-width:0}
.donut-legend .row{display:flex;align-items:center;gap:9px;font-size:12px;color:var(--text-2);min-width:0}
.donut-legend .sw{width:9px;height:9px;border-radius:2px;flex:0 0 9px}
.donut-legend .lbl{font-family:var(--mono);font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.donut-legend .val{margin-left:auto;font:600 10.5px var(--mono);color:var(--text-2);flex:0 0 auto}
.donut-legend .pct{margin-left:10px;width:44px;text-align:right;font:600 10.5px var(--mono);color:var(--text);flex:0 0 auto}
.donut-legend a.row{text-decoration:none}
.donut-legend a.row:hover .lbl{color:var(--text)}
.gauge-wrap{display:flex;align-items:center;gap:24px;padding:18px 20px 20px}
.gauge{position:relative;width:190px;flex:0 0 190px}
.gauge svg{width:100%;height:auto;display:block}
.gauge-center{position:absolute;left:0;right:0;bottom:2px;text-align:center;pointer-events:none}
.gauge-center b{font:600 24px var(--mono);color:var(--heading);letter-spacing:-.02em}
.gauge-center span{display:block;font:9px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--text-3);margin-top:3px}

/* dashboard grids */
.db-mid{display:grid;grid-template-columns:1.55fr 1fr;gap:16px;align-items:start;margin-bottom:16px}
.db-mid .spend-panel{margin-bottom:0}
.db-cols{display:grid;grid-template-columns:1.5fr 1fr;gap:16px;align-items:start;margin-bottom:16px}
.db-cols .panel,.db-cols .spend-panel{margin-bottom:0}

/* live feed */
.db-live-panel{display:flex;flex-direction:column}
#liveFeed{min-height:150px;max-height:340px;overflow:auto;padding:8px 14px 14px}
.live-empty{color:var(--text-3);font-size:12.5px;padding:16px 2px;line-height:1.6}
.live-empty code{background:var(--surface-2);border:1px solid var(--line);border-radius:6px;padding:1px 6px;color:var(--text-2);font-size:11.5px}
.live-row{display:flex;align-items:center;gap:8px;padding:9px 11px;margin:3px 0;border:1px solid var(--line);
  border-radius:var(--r-lg);background:var(--surface-2);animation:liveIn .26s ease}
@keyframes liveIn{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:none}}
.lr-time{font:10.5px var(--mono);color:var(--text-mute);flex:0 0 50px}
.lr-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--text-2)}
.lr-model{font:500 10.5px var(--mono);padding:3px 9px;border-radius:var(--r-pill);border:1px solid var(--line-2);background:var(--surface-3);
  color:var(--text-2);white-space:nowrap;max-width:150px;overflow:hidden;text-overflow:ellipsis}
.lr-meta{font-family:var(--mono);font-size:10.5px;color:var(--text-3);white-space:nowrap}
.lr-cost{font:11.5px var(--mono);color:var(--text);font-variant-numeric:tabular-nums;white-space:nowrap}
.live-row .chip{max-width:158px;overflow:hidden;text-overflow:ellipsis}
.live-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;border-top:1px solid var(--line);
  font-family:var(--mono);font-size:10.5px;color:var(--text-3)}
.live-foot a{font-weight:600}

/* tables */
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:12.5px}
thead th{position:sticky;top:0;background:var(--surface-2);color:var(--text-3);text-align:left;
  font-family:var(--mono);font-size:9.5px;font-weight:600;text-transform:uppercase;letter-spacing:.09em;padding:9px 16px;
  border-bottom:1px solid var(--line);white-space:nowrap}
tbody td{padding:11px 16px;border-bottom:1px solid var(--line);white-space:nowrap;vertical-align:middle}
tbody tr:last-child td{border-bottom:none}
tbody tr{transition:background .12s}
tbody tr:hover{background:var(--row-hover)}
tbody tr.row-error{background:var(--row-error)}
tbody tr.row-error:hover{background:var(--row-error)}
td.num,th.num{text-align:right}
td.mono,th.mono{font-family:var(--mono)}
.tcell-primary{font-weight:550;color:var(--heading)}
.tcell-sub{display:block;font-family:var(--mono);font-size:10.5px;color:var(--text-3);margin-top:2px}
.tcell-sub a{color:var(--text-3);text-decoration:underline;text-decoration-color:var(--line-2)}
.tcell-sub a:hover{color:var(--accent)}
.tree-cell{display:flex;align-items:flex-start;gap:7px;min-width:0}
.tree-guides{white-space:pre;font-family:var(--mono);font-size:12px;line-height:1.5;color:var(--text-mute);user-select:none}
.tree-toggle{width:18px;height:18px;flex:0 0 18px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--text-2);font-size:10px;line-height:1;padding:0;margin-top:1px;cursor:pointer}
.tree-toggle:hover{background:var(--surface-2);border-color:var(--line-2);color:var(--text)}
.tree-toggle-spacer{width:18px;flex:0 0 18px}
tr.tree-hidden{display:none}
.agent-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 9px 3px 8px;border-radius:var(--r-pill);font-family:var(--mono);font-size:10px;font-weight:600;color:var(--text-2);background:var(--surface-2);border:1px solid var(--line);white-space:nowrap}
.agent-chip::before{content:"";width:6px;height:6px;border-radius:2px;background:var(--agent-tone,var(--accent-strong));flex:0 0 6px}
.think-mark{display:inline-flex;align-items:center;padding:2px 8px;border-radius:var(--r-pill);font-family:var(--mono);font-size:9.5px;font-weight:600;color:var(--warn);border:1px solid var(--warn-line);background:var(--warn-dim)}
.group-stats{display:flex;gap:7px;flex-wrap:wrap;margin:-6px 0 16px}
tr.group-row td{background:var(--surface-2);border-top:1px solid var(--line-2);border-bottom:1px solid var(--line);padding:8px 14px}
.group-head-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.group-head-row .group-id{font-family:var(--mono);font-size:11px;font-weight:600;color:var(--text-2);text-decoration:underline;text-decoration-color:var(--line-2)}
.group-head-row .group-id:hover{color:var(--accent)}
.group-head-row .group-kind{font-family:var(--mono);font-size:9.5px;font-weight:600;text-transform:uppercase;letter-spacing:.09em;color:var(--text-3)}
.sub-indent{color:var(--text-mute);font-family:var(--mono);margin-right:3px}
.refresh-ctl{display:flex;align-items:center;gap:10px}
.auto-refresh{display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:10.5px;color:var(--text-3);cursor:pointer;user-select:none}
.media-thumb{display:block;max-width:240px;max-height:170px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}
.media-audio{width:100%;max-width:340px}
.media-preview{margin-top:8px}
tr.clickable{cursor:pointer}
.row-error .tcell-primary{color:var(--bad-strong)}
.cell-stack{display:flex;flex-direction:column;gap:3px;min-width:0}
.cell-inline{display:flex;align-items:center;gap:8px;min-width:0}
.prov-dot{width:6px;height:6px;border-radius:2px;background:var(--accent-strong);flex:0 0 6px}

/* badges */
.badge{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:var(--r-pill);font-family:var(--mono);font-size:10px;font-weight:600;
  background:var(--surface-2);border:1px solid var(--line);color:var(--text-2);white-space:nowrap}
.badge .dot{width:5px;height:5px;border-radius:50%;background:currentColor}
.badge.good{color:var(--good);border-color:var(--good-line);background:var(--good-dim)}
.badge.bad{color:var(--bad-strong);border-color:var(--bad-line);background:var(--bad-dim)}
.badge.warn{color:var(--warn);border-color:var(--warn-line);background:var(--warn-dim)}
.badge.accent{color:var(--accent);border-color:var(--accent-line);background:var(--accent-dim)}
.badge.neutral{color:var(--text-3)}
.chip{display:inline-block;padding:3px 9px;border-radius:var(--r-pill);font-family:var(--mono);font-size:10px;font-weight:500;color:var(--text-2);
  background:var(--surface-2);border:1px solid var(--line);white-space:nowrap}
.chip-mono{font-family:var(--mono);font-size:11px}
.score-badge{display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);font-size:10px;font-weight:600;font-variant-numeric:tabular-nums;
  padding:3px 9px;border-radius:var(--r-pill);border:1px solid var(--line);background:var(--surface-2);color:var(--text-2)}
.score-badge.good{color:var(--good);border-color:var(--good-line);background:var(--good-dim)}
.score-badge.bad{color:var(--bad-strong);border-color:var(--bad-line);background:var(--bad-dim)}
.score-badge.none{color:var(--text-mute)}
.flag-ico{display:inline-flex;width:18px;height:18px;align-items:center;justify-content:center;border-radius:4px;color:var(--text-mute)}
.flag-ico.on{color:var(--warn);background:var(--warn-dim)}

/* buttons */
.btn{display:inline-flex;align-items:center;gap:7px;border-radius:var(--r-pill);padding:8px 15px;font-family:var(--display);font-size:12.5px;font-weight:600;
  letter-spacing:-.005em;border:1px solid transparent;transition:background .15s,color .15s,border-color .15s,filter .15s}
.btn:active{filter:brightness(.97)}
.btn-primary{background:var(--accent-fill);color:var(--on-accent)}
.btn-primary:hover{filter:brightness(1.06);color:var(--on-accent)}
.btn-ghost{background:var(--surface);color:var(--text-2);border-color:var(--line-2)}
.btn-ghost:hover{background:var(--surface-2);color:var(--text)}
.btn-icon{padding:6px;border-radius:50%}
.btn-icon svg{width:16px;height:16px}

/* filters + pager */
.filters-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);
  padding:11px;margin-bottom:14px;display:flex;flex-direction:column;gap:10px;box-shadow:var(--shadow-sm)}
.filter-tabs{display:flex;gap:5px;flex-wrap:wrap;align-items:center}
.filter-tabs a{padding:5px 11px;border-radius:var(--r-pill);font-family:var(--mono);font-size:10px;font-weight:550;color:var(--text-2);
  background:var(--surface-2);border:1px solid transparent}
.filter-tabs a:hover{background:var(--surface-3);color:var(--text)}
.filter-tabs a.active{color:var(--chip-on);background:var(--chip-bg);font-weight:600}
.filter-tabs .filter-clear{margin-left:auto;color:var(--text-3);font-weight:400;font-size:11px;background:transparent}
.filter-tabs .filter-clear:hover{color:var(--text);background:transparent}
.filter-search{display:flex;align-items:center;gap:9px;background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r);
  padding:6px 11px;color:var(--text-3);transition:border-color .15s,box-shadow .15s,background .15s}
.filter-search:focus-within{background:var(--surface);border-color:var(--accent);box-shadow:none}
.filter-search svg{width:15px;height:15px;flex:0 0 15px}
.filter-search input[type=text]{flex:1;min-width:0;width:auto;background:transparent;border:0;border-radius:0;padding:0;outline:none;color:var(--text);font:inherit;font-size:12.5px}
.filter-search button{border:0;background:var(--accent-fill);color:var(--on-accent);border-radius:var(--r);padding:5px 12px;font-family:var(--display);font-size:12px;font-weight:600}
.filter-search button:hover{filter:brightness(1.06)}
.pager{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 18px;border-top:1px solid var(--line);
  background:var(--surface-2);font-family:var(--mono);font-size:10.5px;color:var(--text-3);flex-wrap:wrap}
.pager b{color:var(--text);font-weight:600}
.pager-links{display:flex;gap:6px;align-items:center}
.pager-links a,.pager-links span{padding:5px 12px;border-radius:var(--r-pill);border:1px solid var(--line);background:var(--surface);color:var(--text-2);font-size:10.5px;font-weight:600}
.pager-links a:hover{border-color:var(--line-2);color:var(--text);background:var(--surface-3)}
.pager-links span{opacity:.4}

/* run list old filter bar (agent pages) */
.run-filters{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
.run-filters a{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:var(--r-pill);font-family:var(--mono);font-size:10px;
  font-weight:550;color:var(--text-2);background:var(--surface-2);border:1px solid var(--line)}
.run-filters a:hover{border-color:var(--line-2);color:var(--text)}
.run-filters a.active{color:var(--chip-on);background:var(--chip-bg);border-color:transparent;font-weight:600}
.run-filters form{display:flex;gap:8px;align-items:center;margin-left:auto}
.run-filters input[type=text]{background:var(--surface-2);border:1px solid var(--line);color:var(--text);border-radius:var(--r);
  padding:6px 12px;font-size:12.5px;outline:none;min-width:190px}
.run-filters input[type=text]:focus{border-color:var(--accent);box-shadow:none}

/* share bars */
.share{display:flex;align-items:center;gap:9px;min-width:132px}
.share-track{flex:1;height:6px;border-radius:var(--r-pill);background:var(--track);overflow:hidden}
.share-fill{height:100%;border-radius:var(--r-pill);background:var(--accent-fill)}
.share-val{font-family:var(--mono);font-size:10.5px;color:var(--text-2);font-variant-numeric:tabular-nums;width:40px;text-align:right}

/* metagrid */
.metagrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:1px;background:var(--line);
  border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden;margin-bottom:18px}
.metagrid .cell{background:var(--surface);padding:11px 14px;min-width:0;position:relative}
.metagrid .cell:hover .meta-copy{opacity:1}
.meta-label{font-family:var(--mono);font-size:9.5px;font-weight:600;text-transform:uppercase;letter-spacing:.09em;color:var(--text-3)}
.meta-val{margin-top:5px;font-size:12.5px;color:var(--text);word-break:break-all}
.meta-val.mono{font-family:var(--mono);font-size:11.5px;color:var(--text-2)}
.meta-copy{position:absolute;top:8px;right:8px;opacity:0;padding:5px;background:var(--surface-2)}

/* timeline */
.timeline{margin:2px 0 6px 5px;border-left:1px solid var(--line-2);padding-left:22px}
.t-item{position:relative;padding:12px 0;border-bottom:1px solid var(--line)}
.t-item:last-child{border-bottom:none}
.t-dot{position:absolute;left:-27px;top:17px;width:9px;height:9px;border-radius:50%;background:var(--t-dot-bg);border:2px solid var(--accent-strong);box-shadow:0 0 0 3px var(--bg)}
.t-dot.request,.t-dot.prompt{border-color:var(--accent)}
.t-dot.response{border-color:var(--good)}
.t-dot.error{border-color:var(--bad)}
.t-dot.thinking{border-color:var(--warn)}
.t-dot.tool_call{border-color:var(--violet)}
.t-head{display:flex;gap:10px;align-items:baseline;margin-bottom:5px}
.t-type{font-family:var(--mono);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--accent)}
.t-time{font-size:11px;color:var(--text-3);font-family:var(--mono)}
.t-msg{font-family:var(--mono);font-size:12px;line-height:1.62;color:var(--text-2);white-space:pre-wrap;word-break:break-word;
  background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r);padding:12px;margin-top:6px}

/* empty */
.empty{display:flex;flex-direction:column;align-items:center;gap:8px;padding:52px 24px;text-align:center;
  border:1px dashed var(--line-2);border-radius:var(--r-lg);background:var(--surface)}
.empty-icon{opacity:.55;margin-bottom:4px;color:var(--accent-strong)}
.empty-icon svg{width:38px;height:38px}
.empty-title{font-size:15px;font-weight:600;color:var(--text)}
.empty-sub{font-size:13px;color:var(--text-3);max-width:440px}

/* detail head */
.run-head{display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap;margin-bottom:18px}
.run-head .rh-title{font-family:var(--display);font-size:23px;font-weight:600;letter-spacing:-.022em;margin:0 0 10px;color:var(--heading);word-break:break-word}
.run-head .rh-chips{display:flex;gap:7px;flex-wrap:wrap}
.rd-links{display:flex;gap:8px;margin:-4px 0 14px}
.rd-breadcrumb{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 14px;font-size:12.5px}
.rd-breadcrumb a{color:var(--accent);text-decoration:none}
.rd-breadcrumb a:hover{text-decoration:underline}
.rd-crumb-sep{color:var(--text-3)}
.rd-crumb-current{color:var(--text-2);font-weight:600}
.rd-stepper{display:inline-flex;align-items:center;gap:8px;margin-left:auto}
.rd-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:2px 0 4px}
.rd-form{display:flex;flex-direction:column;gap:6px;margin-top:10px;max-width:680px}
.rd-form label{font-family:var(--mono);font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--text-3);margin:10px 0 0}
.rd-form input[type=text],.rd-form textarea{width:100%;background:var(--surface);border:1px solid var(--line-2);color:var(--text);
  border-radius:var(--r);padding:9px 12px;font-size:13px;font-family:inherit;outline:none}
.rd-form textarea{min-height:74px;resize:vertical}
.rd-form input:focus,.rd-form textarea:focus{border-color:var(--accent);box-shadow:none;background:var(--surface)}
.rd-share{margin-top:8px;font-size:12.5px;color:var(--text-3);word-break:break-all;min-height:18px}
.rd-share code{font-family:var(--mono);color:var(--accent)}
.rd-findings{margin-top:10px;font-size:12.5px;color:var(--text-2);line-height:1.7}
.rd-docs{display:flex;flex-direction:column;gap:10px;padding:16px 18px}
.rd-doc{background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r);padding:12px 14px}
.rd-doc-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.rd-doc-idx{font-family:var(--mono);font-size:10px;font-weight:600;color:var(--accent);background:var(--accent-dim);border:1px solid var(--accent-line);border-radius:var(--r-pill);padding:2px 9px}
.rd-doc-text{font-family:var(--mono);font-size:12px;line-height:1.62;color:var(--text-2);white-space:pre-wrap;word-break:break-word}
.rd-code{margin:0;background:var(--bg);border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:var(--r);
  padding:12px 14px;font:12px/1.62 var(--mono);color:var(--text-2);white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto}

/* token split */
.tok-split{display:flex;width:170px;height:6px;border-radius:var(--r-pill);overflow:hidden;margin:9px 0 5px auto;background:var(--track)}
.tok-split .in{background:var(--accent-fill)}
.tok-split .out{background:var(--accent-strong)}
.tok-legend{display:flex;justify-content:flex-end;gap:12px;font:10px var(--mono);color:var(--text-3)}

/* forms */
label{display:block;font-size:12px;font-weight:550;color:var(--text-2);margin:16px 0 7px}
input[type=text],input[type=email],input[type=password]{width:100%;background:var(--surface);color:var(--text);
  border:1px solid var(--line-2);border-radius:var(--r);padding:9px 12px;font-size:13.5px;transition:border-color .15s,box-shadow .15s}
input::placeholder{color:var(--placeholder)}
input:focus{outline:none;border-color:var(--accent);box-shadow:none}
select{width:100%;background:var(--surface);color:var(--text);border:1px solid var(--line-2);border-radius:var(--r);padding:9px 12px;font:inherit;font-size:13.5px}
select:focus{outline:none;border-color:var(--accent);box-shadow:none}
textarea{font-family:inherit}
input[type=checkbox],input[type=radio],input[type=range],progress{accent-color:var(--accent-deep)}
input[type=checkbox],input[type=radio]{cursor:pointer}
.field-hint{font-size:11.5px;color:var(--text-3);margin-top:5px}
.field-error{color:var(--bad);font-size:12.5px;min-height:18px;margin-top:8px}
.seg{display:flex;gap:3px;background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r-pill);padding:3px;margin-bottom:4px}
.seg button{flex:1;background:transparent;border:0;color:var(--text-3);padding:7px 10px;font-family:var(--display);font-size:12.5px;font-weight:600;border-radius:var(--r-pill)}
.seg button.active{background:var(--surface);color:var(--text);box-shadow:var(--shadow-sm)}
.keybox{display:flex;gap:8px;background:var(--surface-2);border:1px dashed var(--line-2);border-radius:var(--r);padding:10px 12px;margin:14px 0}
.keybox code{all:unset;font-family:var(--mono);font-size:12.5px;color:var(--accent);word-break:break-all;flex:1}
.action-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}

/* responsive */
@media(max-width:900px){
  .db-kpis,.stat-tiles,.kpis{grid-template-columns:repeat(2,1fr)}
  .db-mid,.db-cols{grid-template-columns:1fr}
  .db-hero-num{font-size:34px}
  .db-hero-stats{gap:0}
  .db-hero{padding:22px 18px 96px}
  .app{display:block;padding:0}
  .sidebar{position:static;width:100%;height:auto;flex-direction:row;align-items:center;gap:6px;padding:10px 14px;border:0;border-bottom:1px solid var(--line);border-radius:0;box-shadow:none}
  .brand{height:auto;padding:0 6px 0 0;margin-right:2px;border-bottom:0;flex:0 0 auto}
  .brand-text{display:none}
  .nav-groups{flex-direction:row;gap:6px;padding:0;overflow-x:auto}
  .nav-group{flex-direction:row;gap:2px}
  .nav-cap{display:none}
  .nav-item{padding:7px 9px}
  .side-foot{margin-top:0;margin-left:auto;border-top:0;padding-top:0;flex-direction:row}
  .side-foot .btn{width:auto}
  .edition-chip{display:none}
  .topbar{display:none}
  .content{padding:18px 14px 48px}
}
@media(max-width:560px){
  .db-kpis,.stat-tiles,.kpis{grid-template-columns:1fr}
}
@media(prefers-reduced-motion:reduce){
  *{animation:none!important;transition:none!important}
}

/* ── theme toggle ───────────────────────────────────────────────────── */
.theme-toggle{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;flex:0 0 30px;border:1px solid var(--line);
  border-radius:50%;background:var(--surface);color:var(--text-3);transition:background .15s,color .15s,border-color .15s}
.theme-toggle:hover{background:var(--surface-2);color:var(--text);border-color:var(--line-2)}
.theme-toggle svg{width:15px;height:15px}
.theme-toggle .ico-sun,.theme-toggle .ico-moon{display:none}
[data-theme="light"] .theme-toggle .ico-moon{display:block}
[data-theme="dark"] .theme-toggle .ico-sun{display:block}
.side-theme{display:none}
@media(max-width:900px){.side-theme{display:inline-flex}}

/* ── dark theme ─────────────────────────────────────────────────────── */
[data-theme="dark"]{
  color-scheme:dark;
  --bg:#0b101c; --bg-2:#0d1320; --surface:#141924; --surface-2:#1a2130; --surface-3:#202a3c; --surface-4:#28334a;
  --line:#232c3d; --line-2:#33405a;
  --text:#d8e3fb; --text-2:#a9b7d0; --text-3:#7d8ba6; --text-mute:#5d6b85; --link:#38bdf8;
  --heading:#f4f7ff; --placeholder:#5d6b85;
  --accent:#38bdf8; --accent-strong:#00d2ff; --accent-deep:#0891b2; --accent-fill:#00d2ff; --on-accent:#06121a;
  --accent-dim:rgba(0,210,255,.10); --accent-line:rgba(0,210,255,.30);
  --good:#10b981; --good-dim:rgba(16,185,129,.12); --good-line:rgba(16,185,129,.30);
  --bad:#ef4444; --bad-dim:rgba(239,68,68,.12); --bad-line:rgba(239,68,68,.30); --bad-strong:#fca5a5;
  --warn:#f59e0b; --warn-dim:rgba(245,158,11,.12); --warn-line:rgba(245,158,11,.30);
  --info:#38bdf8; --info-dim:rgba(56,189,248,.12); --info-line:rgba(56,189,248,.30);
  --violet:#a855f7; --violet-dim:rgba(168,85,247,.12); --violet-line:rgba(168,85,247,.30);
  --s1:#38bdf8; --s2:#a855f7; --s3:#f97316; --s4:#10b981; --s5:#ef4444;
  --chip-bg:rgba(56,189,248,.13); --chip-on:#bae6fd; --track:#202a3c; --nav-on:#06121a;
  --selection:rgba(56,189,248,.25); --t-dot-bg:#141924;
  --shadow:0 1px 2px rgba(0,0,0,.35),0 12px 34px -16px rgba(0,0,0,.6);
  --shadow-sm:0 1px 2px rgba(0,0,0,.3),0 8px 20px -14px rgba(0,0,0,.5);
  --shadow-md:0 18px 48px -20px rgba(0,0,0,.72),0 2px 8px rgba(0,0,0,.4);
  --shadow-blue:0 1px 2px rgba(0,0,0,.4);
  --wash:rgba(148,163,184,.06); --wash-2:rgba(148,163,184,.05);
  --grid-dot:rgba(148,163,184,.14); --grid-dot-hot:#00d2ff;
  --row-hover:#1a2130; --row-error:rgba(239,68,68,.10);
  --side-bg:#0b101c; --side-bg-2:#0d1320; --side-line:#232c3d;
  --side-text:#d8e3fb; --side-text-2:#8fa0bd; --side-text-3:#5d6b85;
  --side-hover:rgba(148,163,184,.08); --side-active-bg:rgba(56,189,248,.10); --side-active-text:#38bdf8;
  --side-brand-text:#f4f7ff; --side-btn-bg:rgba(255,255,255,.03); --side-btn-hover:rgba(255,255,255,.06);
  --topbar-bg:rgba(11,16,28,.96);
  --scroll:#28334a; --scroll-hover:#3b4763;
  --bar-from:#38bdf8; --bar-to:#0891b2;
  --tooltip-bg:#05080f; --tooltip-line:#334155; --tooltip-text:#e2e8f0;
}
`;

const ICON_DASH = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
  <rect x="2.5" y="8" width="3" height="5.5" rx="1" fill="currentColor" fill-opacity="0.55"/>
  <rect x="6.5" y="4" width="3" height="9.5" rx="1" fill="currentColor" fill-opacity="0.85"/>
  <rect x="10.5" y="9.5" width="3" height="4" rx="1" fill="currentColor"/>
</svg>`;

const ICON_RUNS = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M2.5 12.5 13.5 3.5"/>
  <path d="M6.5 3.5h7v7"/>
</svg>`;

const ICON_SET = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="8" cy="8" r="2.4"/>
  <path d="M13.2 8c0-.5-.1-1-.2-1.5l1.4-1.1-1.4-2.4-1.7.7A6.5 6.5 0 0 0 9.8 2.7L9.5.8H6.5l-.3 1.9c-.6.3-1.2.7-1.7 1.2l-1.7-.7-1.4 2.4 1.4 1.1c-.1.5-.2 1-.2 1.5s.1 1 .2 1.5l-1.4 1.1 1.4 2.4 1.7-.7c.5.5 1.1.9 1.7 1.2l.3 1.9h3l.3-1.9c.6-.3 1.2-.7 1.7-1.2l1.7.7 1.4-2.4-1.4-1.1c.1-.5.2-1 .2-1.5z"/>
</svg>`;

const ICON_OUT = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M9.5 2.5H4.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h5"/>
  <path d="M10.5 5.5 13.5 8l-3 2.5"/>
  <path d="M13 8H6.5"/>
</svg>`;

const ICON_EMPTY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M3.5 17l4.5-6 4 3 5-8"/>
  <path d="M3.5 21h17"/>
</svg>`;

const ICON_COPY = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/>
  <path d="M10.5 5.5v-1A1.5 1.5 0 0 0 9 3H4.5A1.5 1.5 0 0 0 3 4.5V11a1.5 1.5 0 0 0 1.5 1.5h1"/>
</svg>`;

const ICON_KEY = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="5.2" cy="10.8" r="2.7"/>
  <path d="M7.3 8.8 12.9 3.2M10.5 5.6l1.4 1.4M12.7 3.4l1.4 1.4"/>
</svg>`;

const ICON_PLUG = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M6 2.5v3M10 2.5v3"/>
  <path d="M4 5.5h8v2.5a4 4 0 0 1-8 0z"/>
  <path d="M8 12v1.5"/>
</svg>`;

const ICON_SHIELD = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M8 1.9 13 3.6v4.2c0 3-2.1 5.4-5 6.3-2.9-.9-5-3.3-5-6.3V3.6z"/>
  <path d="M5.9 7.9 7.4 9.4l2.9-3"/>
</svg>`;

const ICON_SEARCH = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
  <circle cx="7" cy="7" r="4.4"/>
  <path d="m13.4 13.4-3.3-3.3"/>
</svg>`;

const ICON_SUN = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
  <circle cx="8" cy="8" r="3"/>
  <path d="M8 1.4v1.7M8 12.9v1.7M1.4 8h1.7M12.9 8h1.7M3.3 3.3l1.2 1.2M11.5 11.5l1.2 1.2M12.7 3.3l-1.2 1.2M4.5 11.5l-1.2 1.2"/>
</svg>`;

const ICON_MOON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M13.4 9.7A5.7 5.7 0 0 1 6.3 2.6a6 6 0 1 0 7.1 7.1Z"/>
</svg>`;

const ICON_AGENT = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="3.2" y="5.4" width="9.6" height="7.2" rx="2.2"/>
  <path d="M8 5.4V2.9"/><circle cx="8" cy="2.1" r="0.9" fill="currentColor" stroke="none"/>
  <circle cx="6.1" cy="8.7" r="0.9" fill="currentColor" stroke="none"/>
  <circle cx="9.9" cy="8.7" r="0.9" fill="currentColor" stroke="none"/>
  <path d="M6.2 10.7h3.6"/>
</svg>`;

const THEME_BOOT = `<script>(function(){var t="light";try{var s=localStorage.getItem("torrix_theme");t=(s==="light"||s==="dark")?s:(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="light"}})();</script>`;

const THEME_SCRIPT = `<script>
function torrixCurrentTheme(){return document.documentElement.dataset.theme==="dark"?"dark":"light"}
function torrixApplyTheme(t,persist){
  t=t==="dark"?"dark":"light";
  document.documentElement.dataset.theme=t;
  if(persist){try{localStorage.setItem("torrix_theme",t)}catch(e){}}
  var meta=document.querySelector('meta[name="theme-color"]');
  if(meta)meta.setAttribute("content",t==="dark"?"#0b101c":"#f8fafc");
  document.querySelectorAll("[data-theme-toggle]").forEach(function(b){
    b.setAttribute("aria-pressed",t==="dark"?"true":"false");
    var label=t==="dark"?"Switch to light theme":"Switch to dark theme";
    b.setAttribute("aria-label",label);b.setAttribute("title",label);
  });
}
function torrixToggleTheme(){torrixApplyTheme(torrixCurrentTheme()==="dark"?"light":"dark",true)}
window.torrixTheme={get:torrixCurrentTheme,set:function(t){torrixApplyTheme(t,true)},toggle:torrixToggleTheme};
document.querySelectorAll("[data-theme-toggle]").forEach(function(b){b.addEventListener("click",torrixToggleTheme)});
torrixApplyTheme(torrixCurrentTheme(),false);
try{
  var mq=window.matchMedia("(prefers-color-scheme: dark)");
  var onSystem=function(e){try{if(!localStorage.getItem("torrix_theme"))torrixApplyTheme(e.matches?"dark":"light",false)}catch(err){}};
  if(mq.addEventListener)mq.addEventListener("change",onSystem);else if(mq.addListener)mq.addListener(onSystem);
}catch(e){}
window.addEventListener("storage",function(e){if(e.key==="torrix_theme"&&(e.newValue==="light"||e.newValue==="dark"))torrixApplyTheme(e.newValue,false)});
try{
  if(!(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches)&&window.matchMedia&&window.matchMedia("(pointer:fine)").matches){
    var groot=document.documentElement;
    window.addEventListener("pointermove",function(e){
      groot.style.setProperty("--mx",e.clientX.toFixed(1)+"px");
      groot.style.setProperty("--my",e.clientY.toFixed(1)+"px");
    },{passive:true});
  }
}catch(e){}
</script>`;

function themeToggleButton(extraClass = ""): string {
  return `<button type="button" class="theme-toggle${extraClass ? ` ${extraClass}` : ""}" data-theme-toggle aria-pressed="false" aria-label="Switch color theme" title="Switch color theme">
    <span class="ico-moon">${ICON_MOON}</span><span class="ico-sun">${ICON_SUN}</span>
  </button>`;
}

export function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "-";
  const neg = n < 0;
  const a = Math.abs(n);
  let s: string;
  if (a >= 10000) s = a.toLocaleString(undefined, { maximumFractionDigits: 0 });
  else if (a >= 1000) s = a.toFixed(0);
  else if (a >= 1) s = a.toFixed(2);
  else if (a >= 0.01) s = a.toFixed(4);
  else s = a.toFixed(6);
  s = s.replace(/\.?0+$/, "");
  return `${neg ? "-" : ""}$${s === "" ? (a > 0 ? "0.00" : "0") : s}`;
}

/** Fixed 6 decimals so micro amounts (judge spend) never collapse to $0. */
export function fmtUsdMicro(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "-";
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(6)}`;
}

export function fmtTokens(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "-";
  const a = Math.abs(n);
  if (a < 1000) return Math.round(n).toLocaleString();
  if (a < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  if (a < 1_000_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  return `${(n / 1_000_000_000).toFixed(2)}B`;
}

export function fmtMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "-";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

function fmtBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "-";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "-";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return shortDate(iso);
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "-";
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${m} ${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return date;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function chips(parts: Array<string | null>, sep = " · "): string {
  return parts.filter(Boolean).slice(0, 3).join(sep);
}

const PROJECT_COOKIE = "torrix_project";

/** Reads the sticky project scope cookie; empty string when unset. */
export function readProjectCookie(headers: unknown): string {
  const raw = String((headers as Record<string, unknown>).cookie ?? "");
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) {
      continue;
    }
    if (part.slice(0, eq).trim() === PROJECT_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return "";
}

export function buildProjectCookie(value: string): string {
  return `${PROJECT_COOKIE}=${encodeURIComponent(value)}; SameSite=Lax; Path=/; Max-Age=31536000`;
}

export function clearProjectCookie(): string {
  return `${PROJECT_COOKIE}=; SameSite=Lax; Path=/; Max-Age=0`;
}

export interface ProjectScope {
  projectId: string | undefined;
  setCookie: string | null;
  clearCookie: boolean;
}

/**
 * The effective project for a page: an explicit `?project=` wins (`?project=` with no
 * value means all projects), otherwise the sticky cookie applies, so the topbar
 * selector follows the operator across pages.
 */
export async function resolveProjectScope(
  request: FastifyRequest,
  repos: Repositories,
  userId: string,
): Promise<ProjectScope> {
  const q = request.query as { project?: string };
  const cookieValue = readProjectCookie(request.headers);
  if (q.project !== undefined) {
    const wanted = q.project ?? "";
    if (!wanted) {
      return { projectId: undefined, setCookie: null, clearCookie: cookieValue !== "" };
    }
    const allowed = await repos.projects.roleFor(userId, wanted);
    if (!allowed) {
      return { projectId: undefined, setCookie: null, clearCookie: false };
    }
    return { projectId: wanted, setCookie: wanted !== cookieValue ? wanted : null, clearCookie: false };
  }
  if (!cookieValue) {
    return { projectId: undefined, setCookie: null, clearCookie: false };
  }
  const allowed = await repos.projects.roleFor(userId, cookieValue);
  return { projectId: allowed ? cookieValue : undefined, setCookie: null, clearCookie: false };
}

export function applyProjectScope(reply: FastifyReply, scope: ProjectScope): void {
  if (scope.setCookie) {
    reply.header("set-cookie", buildProjectCookie(scope.setCookie));
  } else if (scope.clearCookie) {
    reply.header("set-cookie", clearProjectCookie());
  }
}

export function backLink(href: string, label = "Back"): string {
  return `<a class="back-link" href="${href}">← ${label}</a>`;
}

export function emptyState(title: string, sub: string): string {
  return `<div class="empty">
    <div class="empty-icon">${ICON_EMPTY}</div>
    <div class="empty-title">${escapeHtml(title)}</div>
    <div class="empty-sub">${escapeHtml(sub)}</div>
  </div>`;
}

export function statusBadge(status: number | null | undefined, finish: string | null | undefined = null): string {
  if (status == null) return '<span class="badge neutral">-</span>';
  const tone = status >= 400 ? "bad" : status >= 300 ? "warn" : "good";
  const label = [String(status), finish && finish !== "null" ? truncate(finish, 14) : null].filter(Boolean).join(" · ");
  return `<span class="badge ${tone}"><span class="dot"></span>${escapeHtml(label)}</span>`;
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function providerChip(provider: string | null | undefined): string {
  if (!provider) return '<span class="badge neutral">-</span>';
  return `<span class="chip">${escapeHtml(provider)}</span>`;
}

function clusterLabel(model: string | null | undefined): string {
  if (!model) return "-";
  return `<span class="mono" style="color:var(--text-2)">${escapeHtml(model)}</span>`;
}
export function shell(_repos: Repositories, config: ServerConfig, host?: ExtensionHost) {
  const navItems: Array<{ id: string; href: string; label: string; icon: string; admin: boolean; feature?: string }> = [
    { id: "dashboard", href: "/ui/dashboard", label: "Dashboard", icon: ICON_DASH, admin: false },
    { id: "analytics", href: "/ui/analytics", label: "Analytics", icon: ICON_ANALYTICS, admin: false },
    { id: "runs", href: "/ui/runs", label: "Runs", icon: ICON_RUNS, admin: false },
    { id: "traces", href: "/ui/traces", label: "Traces", icon: ICON_TRACE, admin: false },
    { id: "live", href: "/ui/live", label: "Live feed", icon: ICON_LIVE, admin: false },
    { id: "agents", href: "/ui/agents", label: "Agents", icon: ICON_AGENT, admin: false },
    { id: "prompts", href: "/ui/prompts", label: "Prompts", icon: ICON_PROMPT, admin: false },
    { id: "datasets", href: "/ui/datasets", label: "Datasets & Evals", icon: ICON_DATA, admin: false },
    { id: "cost", href: "/ui/cost", label: "Cost & Alerts", icon: ICON_COST, admin: false },
    { id: "projects", href: "/ui/projects", label: "Projects", icon: ICON_FOLDER, admin: false },
    { id: "team", href: "/ui/team", label: "Team", icon: ICON_TEAM, admin: false },
    { id: "keys", href: "/ui/keys", label: "API Keys", icon: ICON_KEY, admin: false },
    { id: "integrations", href: "/ui/integrations", label: "Integrations", icon: ICON_PLUG, admin: false },
    { id: "governance", href: "/ui/governance", label: "Governance", icon: ICON_SHIELD, admin: false },
    { id: "compliance", href: "/ui/compliance", label: "Compliance", icon: ICON_COMPLIANCE, admin: false, feature: "compliance" },
    { id: "insights", href: "/ui/insights", label: "Insights", icon: ICON_INSIGHTS, admin: false },
    { id: "playground", href: "/ui/playground", label: "Playground", icon: ICON_PLAY, admin: false },
    { id: "query", href: "/ui/query", label: "SQL console", icon: ICON_TERMINAL, admin: true },
    { id: "settings", href: "/ui/settings", label: "Settings", icon: ICON_SET, admin: true },
  ];
  const navGroups: Array<{ label: string; ids: string[] }> = [
    { label: "Observability", ids: ["dashboard", "analytics", "runs", "traces", "live", "insights", "playground"] },
    { label: "Management", ids: ["agents", "prompts", "datasets", "cost", "projects", "team", "keys", "integrations", "governance", "compliance"] },
    { label: "System", ids: ["query", "settings"] },
  ];
  return {
    page(title: string, body: string, active: string, user: { email: string; is_admin?: number } | null): string {
      const isAdmin = user != null && user.is_admin === 1;
      const visible = navItems.filter((n) => !n.admin || isAdmin);
      const nav = navGroups
        .map((group) => {
          const items = visible.filter((n) => group.ids.includes(n.id));
          if (!items.length) return "";
          const links = items
            .map((n) => {
              const locked = n.feature && !host?.featureAllowed(n.feature) ? lockedFeature(n.feature) : null;
              // Observed agents are free; the managed registry needs the agent control plane.
              const href = n.id === "agents" && !host?.featureAllowed("agent-control") ? "/ui/agents/observed" : n.href;
              return locked
                ? `<a class="nav-item${active === n.id ? " active" : ""}" href="/ui/locked/${locked.id}" title="Available in ${editionName(locked.edition)}">${n.icon}<span>${n.label}</span><span class="nav-lock">${locked.edition === "pro" ? "Pro" : "Ent"}</span></a>`
                : `<a class="nav-item${active === n.id ? " active" : ""}" href="${href}">${n.icon}<span>${n.label}</span></a>`;
            })
            .join("");
          return `<div class="nav-group"><span class="nav-cap">${group.label}</span>${links}</div>`;
        })
        .join("");
      const edition = escapeHtml(`${config.edition} · v${config.version}`);
      const initials = user ? (user.email.split("@")[0]?.slice(0, 2).toUpperCase() || "TX") : "TX";
      const palette = [
        ...visible.map((item) => ({ label: item.label, href: item.href })),
        { label: "Compare runs", href: "/ui/compare" },
        { label: "Settings", href: "/ui/settings" },
      ];
      const paletteJson = JSON.stringify(palette).replace(/</g, "\\u003c");
      const userArea = user
        ? `<div class="user-menu" id="user-menu">
             <button class="avatar avatar-btn" id="user-menu-btn" type="button" aria-haspopup="menu" aria-expanded="false" title="${escapeHtml(user.email)}">${escapeHtml(initials)}</button>
             <div class="user-menu-panel" id="user-menu-panel" role="menu">
               <div class="um-head"><b>${escapeHtml(user.email)}</b><span class="edition-chip">${edition}</span></div>
               ${user.is_admin === 1 ? `<a class="um-item" href="/ui/settings" role="menuitem">${ICON_SET}<span>Settings</span></a>` : ""}
               <button class="um-item" type="button" role="menuitem" onclick="signOut()">${ICON_OUT}<span>Sign out</span></button>
             </div>
           </div>`
        : "";
      return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f8fafc">
<link rel="icon" type="image/png" href="/ui/assets/torrix-logo.png"><link rel="apple-touch-icon" href="/ui/assets/torrix-logo.png">
${THEME_BOOT}
<title>${escapeHtml(title)} · Torrix</title><style>${STYLE}</style></head>
<body data-page="${escapeHtml(active)}"><div class="app" id="app">
<aside class="sidebar">
  <div class="brand"><img class="brand-mark" src="/ui/assets/torrix-logo.png" alt="" width="28" height="28"><div class="brand-text"><span class="word">Torrix</span><span class="brand-sub">AI Observability</span></div></div>
  <nav class="nav-groups">${nav}</nav>
  <div class="side-foot">
    <div class="side-foot-row">
      <button class="side-toggle" id="side-toggle" title="Collapse sidebar">«</button>
      ${themeToggleButton("side-theme")}
    </div>
  </div>
</aside>
<div class="main">
  <header class="topbar">
    <div class="topbar-inner">
      <button class="mobile-menu" id="mobile-menu" aria-label="Open navigation">☰</button>
      <form class="topbar-search" method="get" action="/ui/runs" role="search">
        ${ICON_SEARCH}
        <input type="text" name="q" placeholder="Search runs, models, metadata…" autocomplete="off" aria-label="Search runs">
        <kbd>/</kbd>
      </form>
      <div class="topbar-right">
        <select class="project-pick" id="project-pick" aria-label="Project scope"><option value="">All projects</option></select>
        <button class="btn btn-ghost" id="cmdk-open" type="button" title="Command palette (Ctrl+K)">⌘K</button>
        ${themeToggleButton()}
        ${userArea}
      </div>
    </div>
  </header>
  <main class="content">${config.isDemo ? `<div class="demo-banner">Demo mode · read-only: writes are disabled</div>` : ""}${config.edition === "community" ? `<div class="up-banner">Community edition · Pro adds LLM judges, guardrails, routing, policies and agent governance (10 agents); Enterprise adds unlimited agents, SSO and compliance reporting. Licenses live under <a href="/ui/settings">Settings</a>.</div>` : ""}<div id="update-banner" class="sys-banner" style="display:none"></div>${body}</main>
</div>
</div>
<script>function signOut(){localStorage.removeItem("torrix_key");location.href="/ui/logout"}</script>
<div class="cmdk-overlay" id="cmdk"><div class="cmdk">
  <input id="cmdk-input" type="text" placeholder="Jump to a page… (Ctrl+K)" autocomplete="off" aria-label="Command palette">
  <div class="cmdk-list" id="cmdk-list"></div>
</div></div>
<div class="modal-overlay" id="modal"><div class="modal">
  <h3 id="modal-title"></h3>
  <p id="modal-desc"></p>
  <div class="modal-actions"><button class="btn btn-ghost" id="modal-cancel" type="button">Cancel</button><button class="btn btn-primary" id="modal-confirm" type="button">Confirm</button></div>
</div></div>
<div class="toast-wrap" id="toasts"></div>
<script>(function(){
  var PALETTE=${paletteJson};
  var overlay=document.getElementById("cmdk"),list=document.getElementById("cmdk-list"),input=document.getElementById("cmdk-input");
  var active=0;
  function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;")}
  function navigate(href){location.href=href}
  function render(q){
    q=(q||"").toLowerCase();
    var matches=PALETTE.filter(function(it){return !q||it.label.toLowerCase().indexOf(q)!==-1});
    list.innerHTML=matches.map(function(it,i){return '<div class="cmdk-item'+(i===0?" active":"")+'" data-href="'+esc(it.href)+'"><span>'+esc(it.label)+'</span><kbd>↵</kbd></div>'}).join("")||'<div class="cmdk-item">No matches</div>';
    active=0;
  }
  function open(){overlay.classList.add("open");input.value="";render("");setTimeout(function(){input.focus()},0)}
  function close(){overlay.classList.remove("open")}
  function items(){return Array.prototype.slice.call(list.querySelectorAll("[data-href]"))}
  document.getElementById("cmdk-open").addEventListener("click",open);
  document.addEventListener("keydown",function(e){
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();overlay.classList.contains("open")?close():open();return}
    if(e.key==="Escape"){close();closeConfirm();closeUserMenu()}
  });
  input.addEventListener("input",function(){render(input.value)});
  input.addEventListener("keydown",function(e){
    var all=items();if(!all.length)return;
    if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();if(all[active])all[active].classList.remove("active");active=(active+(e.key==="ArrowDown"?1:-1)+all.length)%all.length;all[active].classList.add("active");all[active].scrollIntoView({block:"nearest"})}
    if(e.key==="Enter"){e.preventDefault();navigate(all[active].getAttribute("data-href"))}
  });
  list.addEventListener("click",function(e){var it=e.target&&e.target.closest?e.target.closest("[data-href]"):null;if(it)navigate(it.getAttribute("data-href"))});
  overlay.addEventListener("click",function(e){if(e.target===overlay)close()});
  var toasts=document.getElementById("toasts");
  window.showToast=function(msg,type,duration,undoFn){
    var el=document.createElement("div");el.className="toast "+(type||"info");
    el.innerHTML="<span>"+esc(msg)+"</span>";
    var timer=setTimeout(dismiss,duration||3200);
    function dismiss(){clearTimeout(timer);el.remove()}
    if(undoFn){var b=document.createElement("button");b.type="button";b.textContent="Undo";b.onclick=function(){try{undoFn()}catch(e){}dismiss()};el.appendChild(b)}
    toasts.appendChild(el);return dismiss;
  };
  var modal=document.getElementById("modal"),confirmFn=null;
  window.closeConfirm=function(){modal.classList.remove("open");confirmFn=null};
  window.showConfirm=function(title,desc,onConfirm,opts){
    document.getElementById("modal-title").textContent=title;
    document.getElementById("modal-desc").textContent=desc||"";
    var btn=document.getElementById("modal-confirm");
    btn.style.color=(opts&&opts.danger)?"var(--bad)":"";
    confirmFn=onConfirm;modal.classList.add("open");
  };
  document.getElementById("modal-confirm").addEventListener("click",function(){var fn=confirmFn;closeConfirm();if(fn)fn()});
  document.getElementById("modal-cancel").addEventListener("click",closeConfirm);
  modal.addEventListener("click",function(e){if(e.target===modal)closeConfirm()});
  var app=document.getElementById("app");
  try{if(localStorage.getItem("torrix_sidebar")==="collapsed")app.classList.add("side-collapsed")}catch(e){}
  document.getElementById("side-toggle").addEventListener("click",function(){
    app.classList.toggle("side-collapsed");
    try{localStorage.setItem("torrix_sidebar",app.classList.contains("side-collapsed")?"collapsed":"expanded")}catch(e){}
  });
  document.getElementById("mobile-menu").addEventListener("click",function(){app.classList.toggle("side-open")});
  var pick=document.getElementById("project-pick");
  var current="";try{current=localStorage.getItem("torrix_project_id")||""}catch(e){}
  // An explicit ?project= in the URL wins and syncs the sticky scope (empty value = all projects).
  try{
    var urlProject=new URL(location.href).searchParams.get("project");
    if(urlProject!==null){current=urlProject;localStorage.setItem("torrix_project_id",urlProject)}
  }catch(e){}
  fetch("/api/projects").then(function(r){return r.ok?r.json():null}).then(function(j){
    if(!j||!j.projects)return;
    j.projects.forEach(function(p){var o=document.createElement("option");o.value=p.id;o.textContent=p.name;if(p.id===current)o.selected=true;pick.appendChild(o)});
  }).catch(function(){});
  pick.addEventListener("change",function(){
    var v=pick.value;
    try{localStorage.setItem("torrix_project_id",v);localStorage.setItem("torrix_project_name",pick.options[pick.selectedIndex].textContent)}catch(e){}
    document.cookie="torrix_project="+encodeURIComponent(v)+"; Path=/; Max-Age="+(v?31536000:0)+"; SameSite=Lax";
    var u=new URL(location.href);u.searchParams.set("project",v);
    location.href=u.toString();
  });
  // SPA-style transition: fade the content out briefly before same-origin page navigation.
  document.addEventListener("click",function(e){
    if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
    var anchor=e.target&&e.target.closest?e.target.closest("a[href]"):null;
    if(!anchor)return;
    var href=anchor.getAttribute("href")||"";
    if(href.indexOf("/ui/")!==0||href.indexOf("/ui/logout")===0)return;
    if(anchor.target==="_blank"||anchor.hasAttribute("download")||anchor.getAttribute("data-no-spa")!==null)return;
    e.preventDefault();
    var content=document.querySelector(".content");
    if(content)content.classList.add("spa-exit");
    setTimeout(function(){location.href=href},110);
  },false);
  var userMenu=document.getElementById("user-menu"),userBtn=document.getElementById("user-menu-btn");
  function closeUserMenu(){if(!userMenu)return;userMenu.classList.remove("open");if(userBtn)userBtn.setAttribute("aria-expanded","false")}
  if(userMenu&&userBtn){
    userBtn.addEventListener("click",function(e){
      e.stopPropagation();
      var open=userMenu.classList.toggle("open");
      userBtn.setAttribute("aria-expanded",open?"true":"false");
    });
    document.addEventListener("click",function(e){
      if(userMenu.classList.contains("open")&&!userMenu.contains(e.target))closeUserMenu();
    });
  }
})();</script>
<script>(function(){var el=document.getElementById("update-banner");if(!el)return;fetch("/api/config").then(function(r){return r.ok?r.json():null}).then(function(c){if(!c||!c.update_available)return;el.innerHTML="Update available: v"+String(c.update_available).replace(/</g,"&lt;")+" · run <code>"+String(c.update_command||"").replace(/</g,"&lt;")+"</code>";el.style.display="flex"}).catch(function(){})})();</script>
${THEME_SCRIPT}
</body></html>`;
    },
  };
}

export function editionName(edition: Edition): string {
  return edition === "enterprise" ? "Enterprise" : edition === "pro" ? "Pro" : "Community";
}

function lockedBody(feature: LockedFeature | null, edition: Edition, current: Edition): string {
  const name = editionName(feature?.edition ?? edition);
  const title = feature ? feature.label : `${name} feature`;
  const pitch = feature?.pitch ?? `This part of Torrix is available on the ${name} edition.`;
  if (editionAtLeast(current, feature?.edition ?? edition)) {
    return `<div class="page-head"><div><h1>${escapeHtml(title)}</h1><p class="page-sub">Included in your ${escapeHtml(editionName(current))} license · not in this build</p></div></div>
  <section class="panel"><div class="locked-card">
    <span class="badge neutral" style="justify-self:start">${escapeHtml(name)}</span>
    <p>${escapeHtml(pitch)}</p>
    <p>Your license covers this feature, but this server runs the Community image, which does not contain the paid features. Switch to the Torrix ${escapeHtml(editionName(current))} image and keep your data volume and license key. Your runs, settings and users carry over.</p>
    <div class="locked-actions"><a class="btn btn-ghost" href="/ui/dashboard">Back to dashboard</a></div>
  </div></section>`;
  }
  return `<div class="page-head"><div><h1>${escapeHtml(title)}</h1><p class="page-sub">Available on Torrix ${escapeHtml(name)} · this instance runs ${escapeHtml(editionName(current))}</p></div></div>
  <section class="panel"><div class="locked-card">
    <span class="badge neutral" style="justify-self:start">${escapeHtml(name)}</span>
    <p>${escapeHtml(pitch)}</p>
    <p>Paid editions run on your own infrastructure like the community edition, so captured data still never leaves your host.</p>
    <div class="locked-actions"><a class="btn btn-primary" href="/ui/settings">Activate a license</a><a class="btn btn-ghost" href="/ui/dashboard">Back to dashboard</a></div>
  </div></section>`;
}

/** Upgrade card for a paid page that this build or license does not cover. */
export function lockedPageHtml(
  repos: Repositories,
  config: ServerConfig,
  host: ExtensionHost | undefined,
  info: { feature: string | null; edition: Edition },
  user: { email: string; is_admin?: number } | null,
): string {
  const feature = info.feature ? lockedFeature(info.feature) : null;
  return shell(repos, config, host).page(feature?.label ?? "Upgrade", lockedBody(feature, info.edition, config.edition), "", user);
}

export async function uiRoute(app: FastifyInstance, deps: UiDeps): Promise<void> {
  const { repos, config } = deps;
  const pages = shell(repos, config, deps.host);

  const authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (
    request,
    reply,
  ) => {
    const headerKey = extractBearer(String((request.headers as Record<string, unknown>).authorization ?? ""));
    let auth = headerKey ? await authenticateKey(repos.db, headerKey) : null;
    if (!auth) {
      const cookieKey = readAuthCookie(request.headers);
      auth = cookieKey ? await authenticateKey(repos.db, cookieKey) : null;
    }
    if (!auth) {
      return reply.redirect("/ui/login");
    }
    (request as unknown as { auth: AuthResult }).auth = auth;
  };

  app.get("/", async (_request, reply) => reply.redirect("/ui/dashboard"));

  app.get("/ui/assets/torrix-logo.png", async (_request, reply) => {
    const logo = Bun.file(BRAND_LOGO_PATH);
    if (!(await logo.exists())) {
      return reply.code(404).send({ error: "not_found" });
    }
    reply.header("cache-control", "public, max-age=86400").type("image/png");
    return reply.send(Buffer.from(await logo.arrayBuffer()));
  });

  app.get("/ui/sso-complete", async (request, reply) => {
    const q = request.query as { key?: string; token?: string };
    const key = (q.key ?? q.token ?? "").trim();
    const auth = key ? await authenticateKey(repos.db, key) : null;
    if (!auth) {
      return reply.redirect("/ui/login");
    }
    reply.header("set-cookie", buildAuthCookie(key));
    reply.type("text/html").send(`<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" type="image/png" href="/ui/assets/torrix-logo.png"><link rel="apple-touch-icon" href="/ui/assets/torrix-logo.png">
${THEME_BOOT}<title>Signing in · Torrix</title></head>
<body><main style="font:14px system-ui;padding:48px">Signing you in…<script>try{localStorage.setItem("torrix_key",${JSON.stringify(key)})}catch(e){}location.replace("/ui/dashboard")</script></main>${THEME_SCRIPT}</body></html>`);
    return reply;
  });

  app.post("/ui/session", async (request, reply) => {
    const body = (request.body ?? {}) as { api_key?: string };
    const key = typeof body.api_key === "string" ? body.api_key.trim() : "";
    if (!key) {
      return reply.code(400).send({ error: "missing_api_key" });
    }
    const auth = await authenticateKey(repos.db, key);
    if (!auth) {
      return reply.code(401).send({ error: "invalid_api_key" });
    }
    reply.header("set-cookie", buildAuthCookie(key));
    return reply.send({ ok: true });
  });

  app.get("/ui/logout", async (_request, reply) => {
    reply.header("set-cookie", clearAuthCookie());
    return reply.redirect("/ui/login");
  });

  app.get("/ui/fonts/:file", async (request, reply) => {
    const { file } = request.params as { file: string };
    const fontPath = FONT_PATHS[file];
    if (!fontPath) {
      return reply.code(404).send({ error: "not_found" });
    }
    const font = Bun.file(fontPath);
    if (!(await font.exists())) {
      return reply.code(404).send({ error: "not_found" });
    }
    reply.header("cache-control", "public, max-age=31536000, immutable").type("font/woff2");
    return reply.send(Buffer.from(await font.arrayBuffer()));
  });

  app.get("/ui/login", async (_request, reply) => {
    reply.type("text/html").send(loginPage((await deps.host?.loginProviders()) ?? []));
  });

  app.get("/ui/dashboard", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const q = request.query as Record<string, string | undefined>;
    const range = q.range === "7" ? 7 : q.range === "30" ? 30 : 14;
    const scope = await resolveProjectScope(request, repos, authUser.user.id);
    applyProjectScope(reply, scope);
    const projectId = scope.projectId;
    const [stats, judgeCostUsd] = await Promise.all([
      repos.runs.dashboardStats(authUser.user.id, { from: daysAgo(range), projectId }),
      repos.judge.sumCostSince(authUser.user.id, monthStart()),
    ]);
    const projectName = projectId ? (await repos.projects.findById(projectId))?.name ?? null : null;
    reply.type("text/html").send(pages.page("Dashboard", dashboardBody({ ...stats, judgeCostUsd }, range, allowed("judge"), projectName), "dashboard", authUser.user));
  });

  app.get("/ui/analytics", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const q = request.query as Record<string, string | undefined>;
    const range = q.range === "7" ? 7 : q.range === "30" ? 30 : 14;
    const scope = await resolveProjectScope(request, repos, authUser.user.id);
    applyProjectScope(reply, scope);
    const projectId = scope.projectId;
    const projectName = projectId ? (await repos.projects.findById(projectId))?.name ?? null : null;
    const [stats, models, agents, endUsers, tools, byProject, accessible] = await Promise.all([
      repos.runs.dashboardStats(authUser.user.id, { from: daysAgo(range), projectId }),
      repos.runs.analyticsByModel(authUser.user.id, { days: range, projectId }),
      repos.runs.analyticsByAgent(authUser.user.id, { days: range, projectId }),
      repos.runs.analyticsByEndUser(authUser.user.id, { days: range, projectId }),
      repos.runs.analyticsByTool(authUser.user.id, { days: range, projectId }),
      repos.runs.analyticsByProject(authUser.user.id, { days: range, projectId }),
      repos.projects.listAccessible(authUser.user.id),
    ]);
    const projectNames = new Map(accessible.map((entry) => [entry.project.id, entry.project.name]));
    reply
      .type("text/html")
      .send(pages.page("Analytics", analyticsBody(stats, models, agents, endUsers, tools, byProject, projectNames, range, projectId ?? null, projectName), "analytics", authUser.user));
  });

  app.get("/ui/live", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const scope = await resolveProjectScope(request, repos, authUser.user.id);
    applyProjectScope(reply, scope);
    const projectName = scope.projectId ? (await repos.projects.findById(scope.projectId))?.name ?? null : null;
    reply.type("text/html").send(pages.page("Live feed", liveFeedBody(scope.projectId ?? null, projectName), "live", authUser.user));
  });

  app.get("/ui/team", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const access = await repos.projects.listAccessible(authUser.user.id);
    const isAdmin = authUser.user.is_admin === 1;
    const users = isAdmin ? await repos.users.list() : [];
    let adminProjects: AdminProjectRow[] = [];
    if (isAdmin) {
      const [projects, members, spend] = await Promise.all([
        repos.projects.listAll(),
        repos.projects.memberCounts(),
        repos.runs.spendByProjectSince(monthStart()),
      ]);
      const ownerEmail = new Map(users.map((user) => [user.id, user.email]));
      const memberCount = new Map(members.map((entry) => [entry.projectId, entry.count]));
      const spendByProject = new Map(spend.map((entry) => [entry.projectId, entry]));
      adminProjects = projects.map((project) => ({
        project,
        ownerEmail: ownerEmail.get(project.user_id) ?? null,
        members: memberCount.get(project.id) ?? 0,
        spend: spendByProject.get(project.id)?.spend ?? 0,
        runs: spendByProject.get(project.id)?.runs ?? 0,
      }));
    }
    reply
      .type("text/html")
      .send(pages.page("Team", teamBody(access, users, isAdmin, adminProjects), "team", authUser.user));
  });

  app.get("/ui/runs", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const q = request.query as Record<string, string | undefined>;
    const score: "good" | "bad" | "unscored" | undefined =
      q.score === "good" || q.score === "bad" || q.score === "unscored" ? q.score : undefined;
    const group: RunGroupMode = q.group === "session" || q.group === "trace" ? q.group : "none";
    const scope = await resolveProjectScope(request, repos, authUser.user.id);
    applyProjectScope(reply, scope);
    const projectId = scope.projectId;
    const filters: RunListFilters = {
      score,
      source: q.source || undefined,
      model: q.model || undefined,
      provider: q.provider || undefined,
      status: q.status === "error" ? "error" : undefined,
      endUser: q.end_user || undefined,
      tag: q.tag || undefined,
      reviewState: q.review_state || undefined,
      search: q.q || undefined,
      agent: q.agent || undefined,
      anomaly: q.anomaly === "1",
      group,
      project: projectId,
      sort: q.sort || undefined,
      dir: q.dir === "asc" ? "asc" : q.dir === "desc" ? "desc" : undefined,
    };
    const limit = 50;
    const offset = Math.max(0, Number(q.offset) || 0);
    const groupLimit = 10;
    const groupPage = Math.max(0, Number(q.gpage) || 0);
    const listFilters = {
      projectId,
      source: filters.source,
      model: filters.model,
      provider: filters.provider,
      status: filters.status,
      endUserId: filters.endUser,
      tag: filters.tag,
      score,
      reviewState: filters.reviewState,
      search: filters.search,
      agentName: filters.agent,
      deepSearch: config.editionConfig.fullTextSearch,
      anomalyOnly: filters.anomaly,
      sort: filters.sort,
      dir: filters.dir,
    };
    const [stats, summary, projects] = await Promise.all([
      repos.runs.dashboardStats(authUser.user.id, { from: daysAgo(30), projectId }),
      repos.runs.listSummary(authUser.user.id, listFilters),
      repos.projects.listAccessible(authUser.user.id),
    ]);
    let runs: Run[] = [];
    let total = 0;
    let groups: TraceGroup[] | undefined;
    let groupTotal = 0;
    if (group !== "none") {
      const grouped = await repos.runs.listGroupsFiltered(authUser.user.id, group, listFilters, groupLimit, groupPage * groupLimit);
      groups = grouped.groups;
      groupTotal = grouped.total;
      runs = groups.length
        ? await repos.runs.listByGroupIds(authUser.user.id, group, groups.map((entry) => entry.id), listFilters, 600)
        : [];
      total = runs.length;
    } else {
      const listed = await repos.runs.list(authUser.user.id, { ...listFilters, limit, offset });
      runs = listed.runs;
      total = listed.total;
    }
    const [counts, childCounts] = await Promise.all([
      repos.events.countByRunIds(runs.map((r) => r.id)),
      repos.runs.countChildren(authUser.user.id, runs.map((r) => r.id)),
    ]);
    const view: RunsView = {
      group,
      summary,
      eventStats: runEventStats(counts),
      childCounts: new Map(childCounts.map((c) => [c.parentRunId, c.count])),
      projects,
      groups,
      groupTotal,
      groupPage,
      groupLimit,
    };
    reply.type("text/html").send(pages.page("Runs", runsListBody(runs, total, filters, offset, limit, stats, view), "runs", authUser.user));
  });

  app.get("/ui/compare", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const q = request.query as { ids?: string };
    const ids = (q.ids ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 4);
    const entries: Array<{ run: Run; events: Events[] }> = [];
    for (const id of ids) {
      const run = await repos.runs.getById(id, authUser.user.id);
      if (run) {
        entries.push({ run, events: await repos.events.listByRun(id) });
      }
    }
    reply.type("text/html").send(pages.page("Compare runs", compareRunsBody(entries), "runs", authUser.user));
  });

  app.get("/ui/query", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    if (authUser.user.is_admin !== 1) {
      return reply.redirect("/ui/dashboard");
    }
    reply.type("text/html").send(pages.page("SQL console", queryConsoleBody(), "query", authUser.user));
  });

  app.get("/ui/insights", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const assist = deps.host?.assist();
    const scope = await resolveProjectScope(request, repos, authUser.user.id);
    applyProjectScope(reply, scope);
    const report = await getInsights(repos, authUser.user.id, 7, false, assist, scope.projectId);
    const savings = await savingsReport(repos, authUser.user.id, { days: report.windowDays, assist, projectId: scope.projectId });
    const projectName = scope.projectId ? (await repos.projects.findById(scope.projectId))?.name ?? null : null;
    reply.type("text/html").send(pages.page("Insights", insightsBody(report, savings, projectName), "insights", authUser.user));
  });

  app.get("/ui/traces", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const scope = await resolveProjectScope(request, repos, authUser.user.id);
    applyProjectScope(reply, scope);
    const [sessionPage, tracePage] = await Promise.all([
      repos.runs.listGroupsFiltered(authUser.user.id, "session", { projectId: scope.projectId }, 40, 0),
      repos.runs.listGroupsFiltered(authUser.user.id, "trace", { projectId: scope.projectId }, 40, 0),
    ]);
    const sessions = sessionPage.groups;
    const traces = tracePage.groups;
    const [sessionRoots, traceRoots] = await Promise.all([
      repos.runs.listGroupRoots(authUser.user.id, "session", sessions.map((group) => group.id), scope.projectId),
      repos.runs.listGroupRoots(authUser.user.id, "trace", traces.map((group) => group.id), scope.projectId),
    ]);
    const roots = new Map([...sessionRoots, ...traceRoots].map((root) => [root.groupId, root]));
    const projectName = scope.projectId ? (await repos.projects.findById(scope.projectId))?.name ?? null : null;
    reply.type("text/html").send(pages.page("Traces", tracesIndexBody(sessions, traces, roots, projectName), "traces", authUser.user));
  });

  const GROUP_PAGE = 200;
  const groupPage = async (request: FastifyRequest, kind: "trace" | "session"): Promise<string> => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    const probe = await repos.runs.listGroup(authUser.user.id, { kind, id, limit: 1, offset: 0 });
    const pageCount = Math.max(1, Math.ceil(probe.total / GROUP_PAGE));
    const requested = Number((request.query as { page?: string }).page);
    // Sessions open on their latest page so new turns are visible; traces open at the start.
    const page = Number.isInteger(requested) && requested >= 1 ? Math.min(requested, pageCount) : kind === "session" ? pageCount : 1;
    const { runs, total } = await repos.runs.listGroup(authUser.user.id, { kind, id, limit: GROUP_PAGE, offset: (page - 1) * GROUP_PAGE });
    const descendants = await collectDescendantRuns(repos, authUser.user.id, runs, runs.length + 200);
    const all = [...runs, ...descendants];
    const counts = await repos.events.countByRunIds(all.map((r) => r.id));
    const annotations =
      kind === "trace" && deps.host
        ? await deps.host.traceAnnotations({ userId: authUser.user.id, traceId: id, runIds: all.map((r) => r.id) })
        : [];
    let answerText: string | null = null;
    if (kind === "trace" && all.length) {
      const last = [...all].sort((a, b) => runEndMs(a) - runEndMs(b))[all.length - 1];
      const lastEvents = await repos.events.listByRun(last.id);
      const response = [...lastEvents].reverse().find((event) => event.type === "response");
      answerText = response?.message ?? last.error ?? null;
    }
    const toolEvents = await repos.events.listToolEvents(all.map((run) => run.id), 400);
    const body = runGroupBody(kind, id, all, total, counts, descendants.length, { page, pages: pageCount, pageSize: GROUP_PAGE }, annotations, answerText, toolEvents);
    return pages.page(kind === "trace" ? "Trace" : "Session", body, "traces", authUser.user);
  };

  app.get("/ui/traces/:id", { preHandler: authenticate }, async (request, reply) => {
    reply.type("text/html").send(await groupPage(request, "trace"));
  });

  app.get("/ui/sessions/:id", { preHandler: authenticate }, async (request, reply) => {
    reply.type("text/html").send(await groupPage(request, "session"));
  });

  app.get("/share/:token", async (request, reply) => {
    const { token } = request.params as { token: string };
    const run = token && token.length >= 16 ? await repos.runs.getByShareToken(token) : null;
    if (!run) {
      reply.code(404).type("text/html").send(sharedRunPage(null, "This share link is invalid or has been revoked."));
      return;
    }
    if (run.share_expires_at && Date.parse(run.share_expires_at) < Date.now()) {
      reply.code(410).type("text/html").send(sharedRunPage(null, "This share link has expired."));
      return;
    }
    const events = await repos.events.listByRun(run.id);
    reply.type("text/html").send(sharedRunPage({ run, events }, null));
  });

  app.get("/ui/prompts", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const prompts = await repos.prompts.listByUser(authUser.user.id);
    reply.type("text/html").send(pages.page("Prompts", promptsListBody(prompts), "prompts", authUser.user));
  });

  app.get("/ui/prompts/:id", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    const prompt = await repos.prompts.getById(id, authUser.user.id);
    if (!prompt) {
      const body = `${backLink("/ui/prompts")}${emptyState("Prompt not found", "This prompt does not exist or is not visible to your account.")}`;
      reply.type("text/html").send(pages.page("Prompt not found", body, "prompts", authUser.user));
      return;
    }
    const versions = await repos.prompts.listVersions(id);
    reply.type("text/html").send(pages.page(prompt.name ?? "Prompt", promptDetailBody(prompt, versions), "prompts", authUser.user));
  });

  app.get("/ui/datasets", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const datasets = await repos.datasets.listByUser(authUser.user.id);
    const counts = [];
    for (const ds of datasets) {
      counts.push({ ...ds, rows: await repos.datasets.countRows(ds.id) });
    }
    const evals = await repos.evals.listByUser(authUser.user.id);
    const evalRows = [];
    for (const e of evals) {
      const ds = e.dataset_id ? await repos.datasets.getById(e.dataset_id, authUser.user.id) : null;
      evalRows.push({ eval: e, dataset_name: ds?.name ?? "-" });
    }
    const judgeCard = (await deps.host?.renderSlot("datasets.judge", { userId: authUser.user.id })) ?? "";
    const goldenRuns = await repos.runs.listGolden(authUser.user.id, 20);
    reply
      .type("text/html")
      .send(
        pages.page(
          "Datasets & Evals",
          datasetsListBody(counts, evalRows, config.editionConfig.maxDatasets, goldenRuns, judgeCard),
          "datasets",
          authUser.user,
        ),
      );
  });

  app.get("/ui/datasets/:id", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    const dataset = await repos.datasets.getById(id, authUser.user.id);
    if (!dataset) {
      const body = `${backLink("/ui/datasets")}${emptyState("Dataset not found", "This dataset does not exist or is not visible to your account.")}`;
      reply.type("text/html").send(pages.page("Dataset not found", body, "datasets", authUser.user));
      return;
    }
    const rows = await repos.datasets.listRows(id);
    const evals = await repos.evals.listByUser(authUser.user.id, id);
    const resultsByEval = new Map<string, number>();
    for (const e of evals) {
      resultsByEval.set(e.id, (await repos.evals.listResults(e.id)).length);
    }
    reply.type("text/html").send(
      pages.page(
        dataset.name ?? "Dataset",
        datasetDetailBody(dataset, rows, evals, resultsByEval, {
          onlineEvals: deps.host?.featureAllowed("online-evals") ?? false,
          maxDatasetRows: config.editionConfig.maxDatasetRows,
        }),
        "datasets",
        authUser.user,
      ),
    );
  });

  app.get("/ui/playground", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    reply.type("text/html").send(pages.page("Playground", playgroundBody(), "playground", authUser.user));
  });

  app.get("/ui/locked/:feature", { preHandler: authenticate }, async (request, reply) => {
    const auth = (request as unknown as { auth: AuthResult }).auth;
    const feature = lockedFeature((request.params as { feature: string }).feature);
    if (!feature) {
      return reply.code(404).type("text/html").send(pages.page("Not found", emptyState("Unknown feature", "There is no paid feature with that name."), "", auth.user));
    }
    return reply
      .type("text/html")
      .send(pages.page(feature.label, lockedBody(feature, feature.edition, config.edition), "", auth.user));
  });

  app.get("/ui/settings", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    if (authUser.user.is_admin !== 1) {
      return reply.redirect("/ui/dashboard");
    }
    reply.type("text/html").send(pages.page("Settings", settingsBody(config, allowed("sso")), "settings", authUser.user));
  });

  app.get("/ui/cost", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const q = request.query as { project?: string };
    const settings = await repos.alerts.getByUser(authUser.user.id);
    const since = monthStart();
    const userSpend = await spendSince(repos, authUser.user.id, since);
    const accessible = await repos.projects.listAccessible(authUser.user.id);
    const projects = accessible.map((entry) => entry.project);
    const keys = await repos.apiKeys.listByUser(authUser.user.id);
    const prices = await repos.prices.list();
    const projectSpend: Record<string, number> = {};
    const keySpend: Record<string, number> = {};
    for (const project of projects) {
      projectSpend[project.id] = await spendSince(repos, authUser.user.id, since, "project", project.id);
    }
    for (const key of keys) {
      keySpend[key.id] = await spendSince(repos, authUser.user.id, since, "api_key", key.id);
    }
    const selectedScope = await resolveProjectScope(request, repos, authUser.user.id);
    applyProjectScope(reply, selectedScope);
    const selected = selectedScope.projectId ? projects.find((project) => project.id === selectedScope.projectId) ?? null : null;
    const selectedStats = selected ? await repos.runs.dashboardStats(authUser.user.id, { from: since, projectId: selected.id }) : null;
    reply.type("text/html").send(
      pages.page(
        "Cost & Alerts",
        costPageBody({ settings, since, userSpend, projects, keys, prices, projectSpend, keySpend, selected, selectedStats }),
        "cost",
        authUser.user,
      ),
    );
  });

  app.get("/ui/keys", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const keys = await repos.apiKeys.listByUser(authUser.user.id);
    reply.type("text/html").send(
      pages.page("API keys", keysPageBody(keys, authUser.keyRecord?.id ?? null), "keys", authUser.user),
    );
  });

  app.get("/ui/projects", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const access = await repos.projects.listAccessible(authUser.user.id);
    const members = new Map<string, Array<{ user_id: string; email: string; role: string }>>();
    for (const entry of access) {
      const owner = await repos.users.findById(entry.project.user_id);
      const rows: Array<{ user_id: string; email: string; role: string }> = [
        { user_id: entry.project.user_id, email: owner?.email ?? "", role: "owner" },
      ];
      for (const member of await repos.projects.listMembers(entry.project.id)) {
        const user = await repos.users.findById(member.user_id);
        rows.push({ user_id: member.user_id, email: user?.email ?? member.user_id, role: member.role });
      }
      members.set(entry.project.id, rows);
    }
    const datasets = (await repos.datasets.listByUser(authUser.user.id)).map((d) => ({ id: d.id, name: d.name }));
    const onlineSections = new Map<string, string>();
    for (const entry of access) {
      const section = await deps.host?.renderSlot("project.onlineEval", {
        userId: authUser.user.id,
        projectId: entry.project.id,
        canEdit: entry.role !== "viewer",
        datasets,
      });
      if (section) {
        onlineSections.set(entry.project.id, section);
      }
    }
    const onlineScript = (await deps.host?.renderSlot("projects.script", { userId: authUser.user.id })) ?? "";
    reply.type("text/html").send(
      pages.page(
        "Projects",
        projectsBody(access, members, onlineSections, onlineScript),
        "projects",
        authUser.user,
      ),
    );
  });

  const allowed = (feature: string): boolean => deps.host?.featureAllowed(feature) ?? false;

  app.get("/ui/governance", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const settings = await repos.governance.getSettings(authUser.user.id);
    const paidPanels = (await deps.host?.renderSlot("governance.panels", { userId: authUser.user.id })) ?? "";
    reply.type("text/html").send(pages.page("Governance", governanceBody(settings, config, paidPanels), "governance", authUser.user));
  });

  if (!deps.host?.installed("compliance")) {
    app.get("/ui/compliance", { preHandler: authenticate }, async (request, reply) => {
      const authUser = (request as unknown as { auth: AuthResult }).auth;
      return reply
        .type("text/html")
        .send(pages.page("Compliance", lockedBody(lockedFeature("compliance"), "enterprise", config.edition), "compliance", authUser.user));
    });
  }

  app.get("/ui/runs/:id", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id } = request.params as { id: string };
    const run = await repos.runs.getById(id, authUser.user.id);
    if (!run) {
      const body = `${backLink("/ui/runs")}${emptyState("Run not found", "This run does not exist or is not visible to your account.")}`;
      reply.type("text/html").send(pages.page("Run not found", body, "runs", authUser.user));
      return;
    }
    const [events, children, judgeSlot] = await Promise.all([
      repos.events.listByRun(id),
      repos.runs.listByParents(authUser.user.id, [id], 100),
      deps.host?.renderSlot("run.judge", { userId: authUser.user.id, runId: id }) ?? Promise.resolve(""),
    ]);
    const parents: Run[] = [];
    let cursor = run.parent_run_id;
    for (let depth = 0; cursor && depth < 8; depth += 1) {
      const parent = await repos.runs.getById(cursor, authUser.user.id);
      if (!parent) {
        break;
      }
      parents.unshift(parent);
      cursor = parent.parent_run_id;
    }
    let navRuns: Run[] = [];
    if (run.trace_id) {
      navRuns = (await repos.runs.listGroup(authUser.user.id, { kind: "trace", id: run.trace_id, limit: 500, offset: 0 })).runs;
    } else if (run.session_id) {
      navRuns = (await repos.runs.listGroup(authUser.user.id, { kind: "session", id: run.session_id, limit: 500, offset: 0 })).runs;
    }
    const ordered = [...navRuns].sort((a, b) => runStartMs(a) - runStartMs(b));
    const position = ordered.findIndex((candidate) => candidate.id === run.id);
    const nav: RunNav = {
      parents,
      prev: position > 0 ? ordered[position - 1] : null,
      next: position >= 0 && position < ordered.length - 1 ? ordered[position + 1] : null,
      position: position >= 0 ? position + 1 : 0,
      total: ordered.length,
    };
    reply.type("text/html").send(pages.page("Run detail", runDetailBody(run, events, children, judgeSlot, nav), "runs", authUser.user));
  });

  app.get("/ui/runs/:id/media/:index", { preHandler: authenticate }, async (request, reply) => {
    const authUser = (request as unknown as { auth: AuthResult }).auth;
    const { id, index } = request.params as { id: string; index: string };
    const run = await repos.runs.getById(id, authUser.user.id);
    if (!run) {
      return reply.code(404).send({ error: "run_not_found" });
    }
    const asset = safeJsonArray(run.media_assets)[Number(index)];
    if (!asset) {
      return reply.code(404).send({ error: "media_not_found" });
    }
    const stored = asset.stored_path != null ? path.basename(String(asset.stored_path)) : "";
    if (!stored) {
      const ref = String(asset.ref ?? "");
      if (/^https?:\/\//i.test(ref)) {
        return reply.redirect(ref);
      }
      return reply.code(404).send({ error: "media_not_stored" });
    }
    const file = Bun.file(path.join(config.mediaDir, stored));
    if (!(await file.exists())) {
      return reply.code(404).send({ error: "media_file_missing" });
    }
    const mime = asset.mime != null ? String(asset.mime) : "application/octet-stream";
    reply.header("cache-control", "private, max-age=3600").type(mime);
    return reply.send(Buffer.from(await file.arrayBuffer()));
  });
}

function dbMiniBars(series: number[], color: string): string {
  const w = 220, h = 30;
  const n = Math.max(1, Math.min(series.length, 14));
  const slice = series.slice(-n);
  const max = Math.max(...slice, 0.000001);
  const gap = 5;
  const bw = (w - (n - 1) * gap) / n;
  const bars = slice
    .map((v, i) => {
      const bh = Math.max(3, Math.round((v / max) * (h - 2)));
      const x = i * (bw + gap);
      const last = i === n - 1;
      return `<rect x="${x.toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh}" rx="3" style="fill:${color}" fill-opacity="${last ? 1 : 0.26}"/>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${bars}</svg>`;
}

function dbCard(label: string, value: string, sub: string, art: string, tone = "", trend = "", badge = "", href = ""): string {
  const open = href ? `<a class="db-kpi ${tone}" href="${href}">` : `<div class="db-kpi ${tone}">`;
  const close = href ? "</a>" : "</div>";
  return `${open}
    <span class="db-kpi-label"><span>${escapeHtml(label)}</span>${badge ? `<span class="k-badge">${escapeHtml(badge)}</span>` : ""}</span>
    <div class="db-kpi-value"><span>${value}</span>${trend}</div>
    <div class="db-kpi-sub">${sub}</div>
    ${art ? `<span class="db-art">${art}</span>` : ""}
  ${close}`;
}

function deltaTrend(current: number, previous: number | null | undefined, opts: { invert?: boolean; suffix?: string } = {}): string {
  if (previous == null || !Number.isFinite(previous) || previous === 0 || !Number.isFinite(current)) {
    return "";
  }
  const pct = ((current - previous) / previous) * 100;
  const up = pct >= 0.05;
  const down = pct <= -0.05;
  const suffix = opts.suffix ?? "";
  if (!up && !down) {
    return `<span class="trend flat">flat${suffix}</span>`;
  }
  const good = opts.invert ? down : up;
  return `<span class="trend ${good ? "up" : "down"}">${up ? "↑" : "↓"} ${Math.abs(pct).toFixed(1)}%${suffix}</span>`;
}

const DONUT_COLORS = ["#38bdf8", "#a855f7", "#f97316", "#10b981", "#ef4444"];

const CHART_SERIES = [
  { rgb: "56,189,248", label: "Spend" },
  { rgb: "168,85,247", label: "Runs" },
  { rgb: "249,115,22", label: "Errors" },
];

function smoothPath(points: Array<{ x: number; y: number }>): string {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

function lineChart(days: Array<{ date: string; cost: number; runs: number; errors: number }>): string {
  const W = 1000, H = 176, TOP = 10;
  const n = days.length;
  if (!n) return "";
  const series = [
    { key: "cost" as const, rgb: CHART_SERIES[0].rgb, max: Math.max(...days.map((d) => d.cost), 0.000001) },
    { key: "runs" as const, rgb: CHART_SERIES[1].rgb, max: Math.max(...days.map((d) => d.runs), 1) },
    { key: "errors" as const, rgb: CHART_SERIES[2].rgb, max: Math.max(...days.map((d) => d.errors), 1) },
  ];
  const xAt = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const yAt = (v: number, max: number) => H - Math.max(3, (v / max) * (H - TOP));
  const layers = series.map((s) => {
    const pts = days.map((d, i) => ({ x: xAt(i), y: yAt(d[s.key], s.max) }));
    return { s, line: smoothPath(pts), dots: pts.map((p) => `M ${p.x.toFixed(2)} ${p.y.toFixed(2)} l 0.01 0`).join(" ") };
  });
  const area = `${layers[0].line} L ${W} ${H} L 0 ${H} Z`;
  const paths = layers
    .map((l) => `<path d="${l.line}" fill="none" stroke="rgb(${l.s.rgb})" stroke-width="2.2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>`)
    .join("");
  const dots = layers
    .map((l) => `<path d="${l.dots}" fill="none" stroke="rgb(${l.s.rgb})" stroke-width="6" vector-effect="non-scaling-stroke" stroke-linecap="round"/>`)
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="chartArea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgb(${CHART_SERIES[0].rgb})" stop-opacity=".16"/>
      <stop offset="100%" stop-color="rgb(${CHART_SERIES[0].rgb})" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#chartArea)"/>
    ${paths}${dots}
  </svg>`;
}

function chartHoverScript(perDay: Array<{ date: string; cost: number; runs: number; errors: number }>): string {
  const data = JSON.stringify(perDay.map((d) => ({ d: d.date, c: d.cost, r: d.runs, e: d.errors }))).replace(/</g, "\\u003c");
  return `(function(){
  var plot=document.getElementById("spendPlot"),tip=document.getElementById("chartTip");
  if(!plot||!tip)return;
  var days=${data};
  function usd(v){var n=Number(v)||0;return "$"+n.toFixed(n>=1?2:n>=0.01?4:6).replace(/0+$/,"").replace(/\\.$/,"")}
  plot.addEventListener("mousemove",function(e){
    if(!days.length)return;
    var svg=plot.querySelector("svg");if(!svg)return;
    var r=svg.getBoundingClientRect(),br=plot.parentElement.getBoundingClientRect();
    var f=Math.min(1,Math.max(0,(e.clientX-r.left)/r.width));
    var i=Math.round(f*(days.length-1)),d=days[i];if(!d)return;
    tip.innerHTML='<b>'+d.d+'</b><span class="ct-row"><i class="g1"></i>Spend<em>'+usd(d.c)+'</em></span><span class="ct-row"><i class="g2"></i>Runs<em>'+d.r+'</em></span><span class="ct-row"><i class="g3"></i>Errors<em>'+d.e+'</em></span>';
    tip.hidden=false;
    var x=(days.length===1?0.5:i/(days.length-1))*r.width+(r.left-br.left);
    tip.style.left=Math.min(Math.max(x,80),br.width-80)+"px";
  });
  plot.addEventListener("mouseleave",function(){tip.hidden=true});
})();`;
}

function sourcePanel(bySource: Array<{ source: string; runs: number; cost: number }>, totalRuns: number): string {
  if (!bySource.length) {
    return `<div class="spend-panel"><div class="spend-head"><span class="spend-title"><span class="sig"></span>Sources</span></div><div style="padding:18px">${emptyState("No sources yet", "Runs grouped by ingress: proxy, SDK, playground, ingest, OTLP.")}</div></div>`;
  }
  const total = bySource.reduce((sum, s) => sum + s.runs, 0) || 1;
  const top = bySource.slice(0, 4).map((s) => ({ label: s.source, runs: s.runs, pct: (s.runs / total) * 100 }));
  const otherRuns = bySource.slice(4).reduce((sum, s) => sum + s.runs, 0);
  if (otherRuns > 0) {
    top.push({ label: "other", runs: otherRuns, pct: (otherRuns / total) * 100 });
  }
  let acc = 0;
  const ARC = Math.PI * 88;
  const arcs = top
    .map((seg, i) => {
      const color = DONUT_COLORS[i % DONUT_COLORS.length];
      const len = (seg.pct / 100) * ARC;
      const el = `<path d="M 12 100 A 88 88 0 0 1 188 100" fill="none" stroke="${color}" stroke-width="15" stroke-linecap="butt" stroke-dasharray="${len.toFixed(2)} ${(ARC - len).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}"></path>`;
      acc += len;
      return el;
    })
    .join("");
  const legend = top
    .map((seg, i) => {
      const swatch = `<span class="sw" style="background:${DONUT_COLORS[i % DONUT_COLORS.length]}"></span><span class="lbl">${escapeHtml(seg.label)}</span><span class="val">${seg.runs.toLocaleString()}</span><span class="pct">${seg.pct.toFixed(1)}%</span>`;
      return seg.label === "other"
        ? `<div class="row">${swatch}</div>`
        : `<a class="row" href="/ui/runs?source=${encodeURIComponent(seg.label)}">${swatch}</a>`;
    })
    .join("");
  return `<div class="spend-panel">
    <div class="spend-head"><span class="spend-title"><span class="sig"></span>Sources<span class="spend-sub">&nbsp;runs by ingress</span></span><span class="spend-note">${totalRuns.toLocaleString()} runs</span></div>
    <div class="gauge-wrap">
      <div class="gauge">
        <svg viewBox="0 0 200 110" aria-hidden="true">
          <path d="M 12 100 A 88 88 0 0 1 188 100" fill="none" stroke="var(--track)" stroke-width="15" stroke-linecap="round"></path>
          ${arcs}
        </svg>
        <div class="gauge-center"><b>${totalRuns.toLocaleString()}</b><span>runs</span></div>
      </div>
      <div class="donut-legend">${legend}</div>
    </div>
  </div>`;
}

function livePanel(): string {
  return `<div class="spend-panel db-live-panel">
    <div class="spend-head"><span class="spend-title"><span class="sig live"></span>Live feed</span><span class="spend-note">streaming · /api/stream</span></div>
    <div id="liveFeed"><div class="live-empty">Point your LLM client at <code>/proxy</code> or ship the SDK: new runs stream in here live.</div></div>
    <div class="live-foot"><span>New runs appear here as they are captured</span><a href="/ui/runs">View all runs</a></div>
  </div>`;
}

const dashboardScript = `(function(){
  var key=localStorage.getItem("torrix_key");if(!key)return;
  var feed=document.getElementById("liveFeed");if(!feed)return;
  var dot=document.getElementById("liveDot");
  var retry=1,closed=false;
  function esc(s){var d=document.createElement("div");d.textContent=(s==null?"":String(s));return d.innerHTML;}
  function time(r){var t=new Date(r.created_at);if(isNaN(t.getTime()))return "--:--";return t.toLocaleTimeString([],{hour12:false,hour:"2-digit",minute:"2-digit"});}
  function cost(v){var n=Number(v);if(!isFinite(n)||n<=0)return "";return "$"+n.toFixed(n>=1?2:n>=0.01?4:6).replace(/0+$/,"").replace(/\\.$/,"");}
  function badge(r){var ok=(r.status||0)<400;return '<span class="badge '+(ok?"good":"bad")+'"><span class="dot"></span>'+(ok?"OK":String(r.status||"err"))+'</span>';}
  function modelColor(m){var s=String(m||""),h=0,i;for(i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;var c=["#38bdf8","#a855f7","#f97316","#10b981","#818cf8"];return c[h%c.length];}
  function lat(r){var n=Number(r.latency_ms);if(!isFinite(n)||n<=0)return "";return n>=1000?(n/1000).toFixed(2)+"s":Math.round(n)+"ms";}
  function add(r){
    if(feed.querySelector(".live-empty"))feed.innerHTML="";
    var el=document.createElement("div");el.className="live-row";
    var model="",m=String(r.model||"");
    if(m){var c=modelColor(m);model='<span class="lr-model" title="'+esc(m)+'" style="color:'+c+';border-color:'+c+'55;background:'+c+'1a">'+esc(m)+"</span>";}
    var l=lat(r);var meta=l?'<span class="lr-meta">'+l+"</span>":"";
    el.innerHTML='<span class="lr-time">'+time(r)+'</span>'+model+badge(r)+'<span class="lr-name">'+esc(r.name||r.id||"")+'</span>'+meta+'<span class="lr-cost">'+cost(r.cost_usd)+"</span>";
    feed.prepend(el);
    while(feed.children.length>40)feed.removeChild(feed.lastChild);
  }
  function reopen(){if(closed||document.hidden)return;setTimeout(open,Math.min(15000,1000*retry++));}
  function terminate(){closed=true;dot.classList.remove("on");}
  function pump(rd,buf,dec){
    return rd.read().then(function(r){
      if(r.done){reopen();return;}
      buf+=dec.decode(r.value,{stream:true});
      var k;
      while((k=buf.indexOf("\\n\\n"))>=0){
        var chunk=buf.slice(0,k);buf=buf.slice(k+2);
        var i,line=null,parts=chunk.split("\\n");
        for(i=0;i<parts.length;i++){if(parts[i].indexOf("data: ")===0){line=parts[i].slice(6);break;}}
        if(!line)continue;
        var obj;try{obj=JSON.parse(line);}catch(e){continue;}
        if(obj&&obj.type==="connected")continue;
        if(obj&&obj.id)add(obj);
      }
      return pump(rd,buf,dec);
    }).catch(function(){reopen();});
  }
  function open(){
    if(closed)return;
    fetch("/api/stream",{headers:{"Authorization":"Bearer "+key}}).then(function(res){
      if(!res.ok||!res.body){terminate();return;}
      dot.classList.add("on");retry=1;
      pump(res.body.getReader(),"",new TextDecoder());
    }).catch(function(){reopen();});
  }
  document.addEventListener("visibilitychange",function(){if(!document.hidden&&!closed)open();});
  if(!document.hidden)open();
})();
`;

function liveFeedBody(projectId: string | null = null, projectName: string | null = null): string {
  return `<style>
  #live-rows tr.live-new{animation:liveIn .35s ease-out}
  @keyframes liveIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
  </style>
  <div class="page-head">
    <div><h1>Live feed</h1><p class="page-sub">New runs stream in as they are captured${projectName ? ` · project ${escapeHtml(projectName)}` : ""}. Pause to read without losing the buffer.</p></div>
    <div style="display:flex;gap:8px;align-items:center"><button class="btn btn-ghost" id="live-pause" type="button">Pause</button><span class="panel-note" id="live-state">connecting…</span></div>
  </div>
  <div class="stat-tiles" style="margin-bottom:14px">
    <div class="stat-tile"><span class="st-label">Runs this session</span><div class="st-value" id="live-count-runs">0</div></div>
    <div class="stat-tile"><span class="st-label">Spend this session</span><div class="st-value" id="live-count-cost">$0.000000</div></div>
    <div class="stat-tile"><span class="st-label">Errors this session</span><div class="st-value" id="live-count-errors">0</div></div>
  </div>
  <div class="panel"><div class="panel-head"><span class="panel-title">Incoming</span><span class="panel-note" id="live-buffer"></span></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Time</th><th>Run</th><th>Agent</th><th>Model</th><th class="num">Tokens</th><th class="num">Cost</th><th>Status</th></tr></thead>
      <tbody id="live-rows"><tr id="live-empty"><td colspan="7" class="panel-note" style="padding:16px">Waiting for the first run${projectName ? " in this project" : ""}…</td></tr></tbody>
    </table></div>
  </div>
  <script>(function(){
    var rows=document.getElementById("live-rows"),state=document.getElementById("live-state"),
      bufferNote=document.getElementById("live-buffer"),pauseBtn=document.getElementById("live-pause");
    var scope=${JSON.stringify(projectId)};
    var runs=0,cost=0,errors=0,paused=false,buffer=[];
    function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}
    function fmtUsd(n){return "$"+Number(n||0).toFixed(6)}
    function fmtTokens(n){return Number(n||0)>999?(Number(n||0)/1000).toFixed(1)+"k":String(Number(n||0))}
    function fmtMs(n){return n==null?"-":(Number(n)<1000?Math.round(Number(n))+"ms":(Number(n)/1000).toFixed(1)+"s")}
    function badge(status){var err=Number(status||0)>=400;return '<span class="badge '+(err?"bad":"good")+'"><span class="dot"></span>'+esc(status==null?"-":status)+"</span>"}
    function paint(){
      document.getElementById("live-count-runs").textContent=String(runs);
      document.getElementById("live-count-cost").textContent=fmtUsd(cost);
      document.getElementById("live-count-errors").textContent=String(errors);
    }
    function add(run){
      if(scope&&String(run.project_id||"")!==scope)return;
      runs+=1;cost+=Number(run.cost_usd||0);if(Number(run.status||0)>=400)errors+=1;
      var empty=document.getElementById("live-empty");if(empty)empty.remove();
      var tr=document.createElement("tr");
      tr.className="clickable live-new";
      tr.setAttribute("onclick","location.href='/ui/runs/"+encodeURIComponent(run.id)+"'");
      tr.innerHTML="<td class='mono' style='color:var(--text-3);font-size:12px'>"+esc(new Date(run.created_at).toLocaleTimeString())+"</td>"+
        "<td><span class='tcell-primary'>"+esc(run.name||"untitled")+"</span></td>"+
        "<td>"+(run.agent_name?esc(run.agent_name):"-")+"</td>"+
        "<td>"+esc(run.model||run.routed_from||"-")+"</td>"+
        "<td class='num'>"+fmtTokens((run.input_tokens||0)+(run.output_tokens||0))+"</td>"+
        "<td class='num'>"+fmtUsd(run.cost_usd)+"</td>"+
        "<td>"+badge(run.status)+"</td>";
      rows.insertBefore(tr,rows.firstChild);
      paint();
    }
    pauseBtn.onclick=function(){
      paused=!paused;
      pauseBtn.textContent=paused?"Resume":"Pause";
      state.textContent=paused?"paused":(buffer.length?("flushing "+buffer.length):"live");
      if(!paused){buffer.forEach(add);buffer=[];bufferNote.textContent=""}
    };
    function read(){
      fetch("/api/stream",{headers:{authorization:"Bearer "+(localStorage.getItem("torrix_key")||"")}}).then(function(res){
        if(!res.ok||!res.body){state.textContent="stream unavailable";return}
        state.textContent="live";
        var reader=res.body.getReader(),dec=new TextDecoder(),buf="";
        function pump(){
          reader.read().then(function(step){
            if(step.done){state.textContent="stream closed";return}
            buf+=dec.decode(step.value,{stream:true});
            var idx;
            while((idx=buf.indexOf("\\n\\n"))!==-1){
              var chunk=buf.slice(0,idx);buf=buf.slice(idx+2);
              chunk.split("\\n").forEach(function(line){
                if(line.indexOf("data:")!==0)return;
                try{
                  var run=JSON.parse(line.slice(5).trim());
                  if(!run||!run.id)return;
                  if(paused){buffer.push(run);bufferNote.textContent=buffer.length+" buffered";}
                  else add(run);
                }catch(e){}
              });
            }
            pump();
          }).catch(function(){state.textContent="stream error"});
        }
        pump();
      }).catch(function(){state.textContent="stream unavailable"});
    }
    paint();
    read();
  })();</script>`;
}

interface AdminProjectRow {
  project: Project;
  ownerEmail: string | null;
  members: number;
  spend: number;
  runs: number;
}

function teamBody(
  access: ProjectAccess[],
  users: Array<{ id: string; email: string; is_admin: number; created_at: string }>,
  isAdmin: boolean,
  adminProjects: AdminProjectRow[] = [],
): string {
  const projectRows = access
    .map(
      (entry) => `<tr>
      <td><a href="/ui/projects">${escapeHtml(entry.project.name)}</a></td>
      <td>${escapeHtml(entry.role)}</td>
      <td class="mono">${escapeHtml(entry.project.created_at.slice(0, 10))}</td>
    </tr>`,
    )
    .join("");
  const userRows = users
    .map(
      (user) => `<tr>
      <td class="mono">${escapeHtml(user.email)}</td>
      <td>${user.is_admin ? '<span class="badge accent">admin</span>' : '<span class="badge neutral">member</span>'}</td>
      <td class="mono">${escapeHtml(user.created_at.slice(0, 10))}</td>
    </tr>`,
    )
    .join("");
  const adminProjectRows = adminProjects
    .map(
      (row) => `<tr>
      <td><a href="/ui/runs?project=${encodeURIComponent(row.project.id)}">${escapeHtml(row.project.name)}</a></td>
      <td class="mono">${escapeHtml(row.ownerEmail ?? row.project.user_id.slice(0, 8))}</td>
      <td class="num">${row.members}</td>
      <td class="num">${row.runs.toLocaleString()}</td>
      <td class="num mono">${fmtUsd(row.spend)}</td>
      <td class="num mono">${row.project.budget_usd == null ? "-" : fmtUsd(row.project.budget_usd)}</td>
      <td class="num mono">${row.project.hard_cap_usd == null ? "-" : fmtUsd(row.project.hard_cap_usd)}</td>
    </tr>`,
    )
    .join("");
  return `<div class="page-head"><div><h1>Team</h1><p class="page-sub">Project membership and account roles. Manage members per project on the Projects page.</p></div></div>
  <div class="panel" style="margin-bottom:16px"><div class="panel-head"><span class="panel-title">Your projects</span><span class="panel-note">${access.length} accessible</span></div>
    <div class="table-wrap"><table><thead><tr><th>Project</th><th>Your role</th><th>Created</th></tr></thead>
    <tbody>${projectRows || `<tr><td colspan="3" class="panel-note" style="padding:14px">No projects yet.</td></tr>`}</tbody></table></div>
  </div>
  ${
    isAdmin
      ? `<div class="panel"><div class="panel-head"><span class="panel-title">Accounts</span><span class="panel-note">${users.length} user${users.length === 1 ? "" : "s"} · manage under Settings</span></div>
    <div class="table-wrap"><table><thead><tr><th>Email</th><th>Role</th><th>Created</th></tr></thead><tbody>${userRows}</tbody></table></div></div>
    <div class="panel" style="margin-top:16px"><div class="panel-head"><span class="panel-title">All projects (admin)</span><span class="panel-note">every project on this instance · spend month to date</span></div>
    <div class="table-wrap"><table><thead><tr><th>Project</th><th>Owner</th><th class="num">Members</th><th class="num">Runs (month)</th><th class="num">Spend (month)</th><th class="num">Budget</th><th class="num">Hard cap</th></tr></thead>
    <tbody>${adminProjectRows || `<tr><td colspan="7" class="panel-note" style="padding:14px">No projects yet.</td></tr>`}</tbody></table></div></div>`
      : ""
  }`;
}

function dashboardBody(stats: DashboardStats, range = 14, judgeAllowed = false, projectName: string | null = null): string {
  const errorRate = stats.totalRuns > 0 ? (stats.errorCount / stats.totalRuns) * 100 : 0;
  const prev = stats.previous;
  const suffix = ` vs previous ${range}d`;
  const p = stats.perDay.length
    ? {
        runs: stats.perDay.map((d) => d.runs),
        tokens: stats.perDay.map((d) => d.tokens),
        errors: stats.perDay.map((d) => d.errors),
        latency: stats.perDay.map((d) => d.latencyMs),
        maxCost: Math.max(...stats.perDay.map((d) => d.cost), 0.000001),
        maxRuns: Math.max(...stats.perDay.map((d) => d.runs), 1),
        maxErrors: Math.max(...stats.perDay.map((d) => d.errors), 1),
        peak: stats.perDay.reduce((best, d, i) => (d.cost > stats.perDay[best].cost ? i : best), 0),
      }
    : null;

  const header = `<div class="page-head">
    <div><h1>Dashboard</h1><p class="page-sub">Last ${range} days · ${projectName ? `project ${escapeHtml(projectName)}` : "all projects"}</p></div>
    <div class="head-actions">
      <span class="db-live" id="liveDot"><span class="db-live-dot"></span>Live</span>
      <a class="btn btn-ghost" href="/ui/analytics">Open Analytics</a>
      <a class="btn btn-ghost" href="/ui/dashboard?range=${range}">Refresh</a>
    </div>
  </div>`;

  const successRate = stats.totalRuns > 0 ? 100 - errorRate : 100;
  const projected = stats.perDay.length ? (stats.totalCost / stats.perDay.length) * 30 : stats.totalCost;
  const spendDelta = prev && prev.totalCost > 0 ? ((stats.totalCost - prev.totalCost) / prev.totalCost) * 100 : null;
  const spendChip = spendDelta == null
    ? ""
    : `<span class="db-delta">${spendDelta >= 0 ? "↑" : "↓"} ${Math.abs(spendDelta).toFixed(1)}% vs previous</span>`;
  const avgTokensPerRun = stats.totalRuns > 0 ? Math.round(stats.totalTokens / stats.totalRuns) : 0;
  const latencyDelta = prev ? prev.avgLatencyMs - stats.avgLatencyMs : null;

  const hero = `<section class="db-hero">
    <span class="db-hero-spectrum"></span>
    <div class="db-hero-foot">
      <div>
        <span class="db-hero-label"><span class="db-dot s1"></span>Spend · last ${range} days</span>
        <span class="db-hero-num"><em>${fmtUsd(stats.totalCost)}</em>${spendChip}</span>
        <span class="db-hero-sub">Projected 30-day: <b>${fmtUsd(projected)}</b></span>
      </div>
      <div class="db-hero-stats">
        <div class="db-stat"><div class="l"><span class="db-dot s1"></span>Total runs</div><div class="v">${stats.totalRuns.toLocaleString()}</div><div class="s good">${successRate.toFixed(1)}% succeeded</div></div>
        <div class="db-stat"><div class="l"><span class="db-dot s2"></span>Tokens processed</div><div class="v s2">${fmtTokens(stats.totalTokens)}</div><div class="s">${avgTokensPerRun.toLocaleString()} avg / run</div></div>
        <div class="db-stat"><div class="l"><span class="db-dot s3"></span>Avg latency</div><div class="v">${fmtMs(stats.avgLatencyMs)}</div><div class="s">${latencyDelta != null ? `${latencyDelta >= 0 ? "-" : "+"}${fmtMs(Math.abs(latencyDelta))} vs previous` : `p95 ${fmtMs(stats.p95LatencyMs)}`}</div></div>
      </div>
    </div>
  </section>`;

  const prevErrorRate = prev && prev.totalRuns > 0 ? (prev.errorCount / prev.totalRuns) * 100 : 0;
  const kpis = `<div class="db-kpis">
    ${dbCard("Requests", stats.totalRuns.toLocaleString(), `${stats.errorCount} errored`, p ? dbMiniBars(p.runs, "var(--s1)") : "", "tone-s1", prev ? deltaTrend(stats.totalRuns, prev.totalRuns, { suffix }) : "", "VOL", "/ui/runs")}
    ${dbCard("Error rate", `${errorRate.toFixed(2)}%`, `${stats.errorCount} failed`, p ? dbMiniBars(p.errors, "var(--s5)") : "", "tone-s5", prev ? deltaTrend(errorRate, prevErrorRate, { invert: true, suffix }) : "", "HEALTH", "/ui/runs?status=error")}
    ${dbCard("p95 latency", fmtMs(stats.p95LatencyMs), `p50 ${fmtMs(stats.p50LatencyMs)} · p99 ${fmtMs(stats.p99LatencyMs)}`, p ? dbMiniBars(p.latency, "var(--s3)") : "", "tone-s3", prev ? deltaTrend(stats.p95LatencyMs, prev.p95LatencyMs, { invert: true, suffix }) : "", "P95", "/ui/runs?sort=latency&dir=desc")}
    ${dbCard("p99 latency", fmtMs(stats.p99LatencyMs), "tail latency over the window", p ? dbMiniBars(p.latency, "var(--s2)") : "", "tone-s2", "", "P99", "/ui/runs?sort=latency&dir=desc")}
    ${dbCard("Active models", String(stats.byModel.length), `${stats.bySource.length} ingress sources`, p ? dbMiniBars(p.tokens, "var(--s4)") : "", "tone-s4", "", "MODELS", "/ui/analytics")}
    ${
      judgeAllowed
        ? dbCard("Judge spend · MTD", fmtUsdMicro(stats.judgeCostUsd ?? 0), "run judging, online evals and insights", "", "tone-s2", "", "JUDGE", "/ui/cost")
        : dbCard("Agents", String(stats.byAgent.length), "seen in this window", "", "tone-s2", "", "AGENTS", "/ui/agents/observed")
    }
  </div>`;

  const rangeBadges = [7, 14, 30]
    .map((r) => `<a href="/ui/dashboard?range=${r}" class="${r === range ? "active" : ""}">${r}D</a>`)
    .join("");

  let chart: string;
  if (!p) {
    chart = `<div class="spend-panel"><div class="spend-head"><span class="spend-title"><span class="sig"></span>Spend &amp; telemetry</span><span class="range">${rangeBadges}</span></div><div style="padding:18px">${emptyState("No data yet", "Point your LLM client at /proxy or send via the SDK: activity will appear here.")}</div></div>`;
  } else {
    const days = stats.perDay.map((d) => `<span title="${d.date}">${dayLabel(d.date)}</span>`).join("");
    const peakDay = stats.perDay[p.peak];
    const avgCost = stats.totalCost / stats.perDay.length;
    const axisLabels = [0.75, 0.5, 0.25]
      .map((f, i) => `<span class="axis-label" style="top:${25 * (i + 1)}%">${fmtUsd(p.maxCost * f)}</span>`)
      .join("");
    chart = `<div class="spend-panel">
      <div class="spend-head">
        <div class="spend-title-block">
          <span class="spend-title"><span class="sig"></span>Spend &amp; telemetry by day</span>
          <span class="spend-note">${fmtUsd(avgCost)}/day avg · peak ${fmtUsd(peakDay.cost)} on ${peakDay.date}</span>
        </div>
        <span class="range">${rangeBadges}</span>
      </div>
      <div class="spend-body">
        <div class="spend-axis"><i style="top:25%"></i><i style="top:50%"></i><i style="top:75%"></i>${axisLabels}</div>
        <div class="spend-plot" id="spendPlot">${lineChart(stats.perDay)}</div>
        <div class="days">${days}</div>
        <div class="chart-legend">
          <span><i class="g1"></i>Spend</span><span><i class="g2"></i>Runs</span><span><i class="g3"></i>Errors</span>
          <span class="note">values normalized per series</span>
        </div>
        <div class="chart-tip" id="chartTip" hidden></div>
      </div>
    </div>`;
  }

  const cols = `<div class="db-cols">
    <div>${modelPanel(stats.byModel)}</div>
    <div>${sourcePanel(stats.bySource, stats.totalRuns)}</div>
  </div>`;

  const agentCols = `<div class="db-cols">
    <div>${agentPanel(stats.byAgent)}</div>
    <div>${mcpPanel(stats.mcp)}</div>
  </div>`;

  const dayPanels = `<div class="db-cols">
    <div>${dayBarPanel("Requests per day", stats.perDay.map((d) => ({ date: d.date, value: d.runs })), CHART_SERIES[1].rgb, (n) => `${n.toLocaleString()} requests`, "daily")}</div>
    <div>${dayBarPanel("Spend per day", stats.perDay.map((d) => ({ date: d.date, value: d.cost })), CHART_SERIES[0].rgb, fmtUsd, "daily")}</div>
  </div>`;

  // The donut and latency histogram live on the Analytics console; the
  // dashboard stays the compact at-a-glance view.
  return `${header}${hero}${kpis}<div class="db-mid">${chart}${livePanel()}</div>${dayPanels}${cols}${agentCols}<script>${dashboardScript}${chartHoverScript(stats.perDay)}</script>`;
}

function dayBarPanel(
  title: string,
  days: Array<{ date: string; value: number }>,
  rgb: string,
  format: (value: number) => string,
  caption: string,
): string {
  if (!days.length) {
    return `<div class="spend-panel"><div class="spend-head"><span class="spend-title"><span class="sig"></span>${escapeHtml(title)}</span></div><div style="padding:18px">${emptyState("No data yet", "Activity will appear here once runs are captured.")}</div></div>`;
  }
  const max = Math.max(...days.map((d) => d.value), 0.000001);
  const bars = days
    .map(
      (d) =>
        `<div class="bar-group"><div class="bar" style="height:${Math.max(2, Math.round((d.value / max) * 100))}%;background:linear-gradient(180deg,rgb(${rgb}),rgba(${rgb},.28))" data-label="${escapeHtml(d.date)} · ${escapeHtml(format(d.value))}"></div></div>`,
    )
    .join("");
  const labels = days.map((d) => `<span title="${escapeHtml(d.date)}">${dayLabel(d.date)}</span>`).join("");
  return `<div class="spend-panel">
    <div class="spend-head"><span class="spend-title"><span class="sig"></span>${escapeHtml(title)}</span><span class="range">${escapeHtml(caption)}</span></div>
    <div class="spend-body"><div class="bars">${bars}</div><div class="days">${labels}</div></div>
  </div>`;
}

function donutPanel(bySource: Array<{ source: string; runs: number; cost: number }>): string {
  if (!bySource.length) {
    return `<div class="spend-panel"><div class="spend-head"><span class="spend-title"><span class="sig"></span>By provider</span></div><div style="padding:18px">${emptyState("No sources yet", "Ingress sources appear here once runs are captured.")}</div></div>`;
  }
  const colors = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "#0ea5e9", "#8b5cf6", "#f97316"];
  const total = bySource.reduce((sum, entry) => sum + entry.runs, 0) || 1;
  let acc = 0;
  const stops = bySource
    .map((entry, index) => {
      const from = (acc / total) * 100;
      acc += entry.runs;
      const to = (acc / total) * 100;
      return `${colors[index % colors.length]} ${from.toFixed(2)}% ${to.toFixed(2)}%`;
    })
    .join(", ");
  const legend = bySource
    .map(
      (entry, index) =>
        `<a href="/ui/runs?source=${encodeURIComponent(entry.source)}" style="display:inline-flex;align-items:center;gap:6px;text-decoration:none;color:inherit"><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${colors[index % colors.length]}"></i>${escapeHtml(entry.source)} · ${entry.runs.toLocaleString()} runs</a>`,
    )
    .join("");
  return `<div class="spend-panel">
    <div class="spend-head"><span class="spend-title"><span class="sig"></span>By provider</span><span class="range">${total.toLocaleString()} runs</span></div>
    <div style="display:flex;align-items:center;gap:20px;padding:18px;flex-wrap:wrap">
      <div style="width:136px;height:136px;border-radius:50%;background:conic-gradient(${stops});border:1px solid var(--line);flex:0 0 136px"></div>
      <div class="chart-legend" style="flex-direction:column;align-items:flex-start;gap:7px;margin:0">${legend}</div>
    </div>
  </div>`;
}

function latencyHistogramPanel(buckets: Array<{ bucket: string; count: number }>): string {
  const max = Math.max(...buckets.map((b) => b.count), 1);
  const rgb = CHART_SERIES[2].rgb;
  const bars = buckets
    .map(
      (b) =>
        `<div class="bar-group"><div class="bar" style="height:${Math.max(2, Math.round((b.count / max) * 100))}%;background:linear-gradient(180deg,rgb(${rgb}),rgba(${rgb},.28))" data-label="${escapeHtml(b.bucket)} · ${b.count} runs"></div></div>`,
    )
    .join("");
  const labels = buckets.map((b) => `<span>${escapeHtml(b.bucket)}</span>`).join("");
  const observed = buckets.reduce((sum, b) => sum + b.count, 0);
  return `<div class="spend-panel">
    <div class="spend-head"><span class="spend-title"><span class="sig"></span>Latency histogram</span><span class="range">${observed.toLocaleString()} observed</span></div>
    <div class="spend-body"><div class="bars">${bars}</div><div class="days">${labels}</div></div>
  </div>`;
}

function modelPanel(byModel: { model: string; runs: number; cost: number }[]): string {
  if (!byModel.length) {
    return `<div class="spend-panel"><div class="spend-head"><span class="spend-title"><span class="sig"></span>Models by spend</span></div><div style="padding:18px">${emptyState("No models yet", "Once requests flow through Torrix, spend is broken down by model here.")}</div></div>`;
  }
  const totalCost = byModel.reduce((s, m) => s + m.cost, 0);
  const rows = byModel
    .map((m) => {
      const share = totalCost > 0 ? (m.cost / totalCost) * 100 : 0;
      const perRun = m.runs > 0 ? m.cost / m.runs : 0;
      return `<tr>
        <td><a href="/ui/runs?model=${encodeURIComponent(m.model)}">${clusterLabel(m.model)}</a><span class="tcell-sub">${fmtUsd(perRun)} avg / run</span></td>
        <td class="num">${m.runs.toLocaleString()}</td>
        <td><div class="share"><div class="share-track"><div class="share-fill" style="width:${Math.max(1, share)}%"></div></div><span class="share-val">${share.toFixed(1)}%</span></div></td>
        <td class="num" style="color:var(--text)">${fmtUsd(m.cost)}</td>
      </tr>`;
    })
    .join("");
  return `<div class="spend-panel">
    <div class="spend-head"><span class="spend-title"><span class="sig"></span>Models<span class="spend-sub">&nbsp;breakdown by volume and token cost</span></span><a class="spend-note" href="/ui/runs">View all runs</a></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Model</th><th class="num">Runs</th><th>Share</th><th class="num">Total cost</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}

function agentPanel(byAgent: DashboardStats["byAgent"]): string {
  if (!byAgent.length) {
    return `<div class="spend-panel"><div class="spend-head"><span class="spend-title"><span class="sig"></span>Agent activity</span></div><div style="padding:18px">${emptyState("No agents observed", "Runs carrying agent_name or agent_id are grouped here across every ingestion path.")}</div></div>`;
  }
  const rows = byAgent
    .map((a) => {
      const errorRate = a.runs > 0 ? (a.errorCount / a.runs) * 100 : 0;
      return `<tr>
        <td><a href="/ui/runs?agent=${encodeURIComponent(a.agent)}">${clusterLabel(a.agent)}</a><span class="tcell-sub">${a.errorCount} errored · ${errorRate.toFixed(1)}%</span></td>
        <td class="num">${a.runs.toLocaleString()}</td>
        <td class="num" style="color:var(--text)">${fmtUsd(a.cost)}</td>
      </tr>`;
    })
    .join("");
  return `<div class="spend-panel">
    <div class="spend-head"><span class="spend-title"><span class="sig"></span>Agents<span class="spend-sub">&nbsp;top by run volume</span></span><a class="spend-note" href="/ui/agents">Observed agents</a></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Agent</th><th class="num">Runs</th><th class="num">Cost</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}

function mcpPanel(mcp: DashboardStats["mcp"]): string {
  if (!mcp.calls) {
    return `<div class="spend-panel"><div class="spend-head"><span class="spend-title"><span class="sig"></span>MCP activity</span></div><div style="padding:18px">${emptyState("No MCP traffic", "Calls through /mcp, /mcp/proxy or the governed gateway appear here.")}</div></div>`;
  }
  const toolRows = mcp.tools.length
    ? mcp.tools
        .map(
          (t) =>
            `<tr><td><a href="/ui/runs?q=${encodeURIComponent(t.tool)}">${clusterLabel(t.tool)}</a></td><td class="num">${t.runs.toLocaleString()}</td><td class="num"${t.errorCount ? ` style="color:var(--bad)"` : ""}>${t.errorCount}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="3" class="panel-note" style="padding:12px">No tool names captured.</td></tr>`;
  return `<div class="spend-panel">
    <div class="spend-head"><span class="spend-title"><span class="sig"></span>MCP activity<span class="spend-sub">&nbsp;tool calls, denies and holds</span></span><a class="spend-note" href="/ui/runs?source=mcp_gateway">Governed runs</a></div>
    <div class="panel-body" style="padding:12px 16px 4px;display:flex;gap:6px;flex-wrap:wrap">
      <span class="chip">${mcp.calls.toLocaleString()} calls</span>
      <span class="chip"${mcp.denied ? ` style="color:var(--bad)"` : ""}>${mcp.denied} denied</span>
      <span class="chip">${mcp.pending} pending</span>
      <span class="chip"${mcp.errorCount ? ` style="color:var(--bad)"` : ""}>${mcp.errorCount} errors</span>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Tool</th><th class="num">Runs</th><th class="num">Errors</th></tr></thead>
      <tbody>${toolRows}</tbody>
    </table></div>
  </div>`;
}

type RunGroupMode = "none" | "session" | "trace";

interface RunListFilters {
  score?: "good" | "bad" | "unscored";
  source?: string;
  model?: string;
  provider?: string;
  status?: "error";
  endUser?: string;
  tag?: string;
  reviewState?: string;
  search?: string;
  agent?: string;
  anomaly: boolean;
  group: RunGroupMode;
  project?: string;
  sort?: string;
  dir?: "asc" | "desc";
}

interface RunsView {
  group: RunGroupMode;
  summary: RunListSummary;
  eventStats: Map<string, RunEventStats>;
  childCounts: Map<string, number>;
  projects: ProjectAccess[];
  groups?: TraceGroup[];
  groupTotal?: number;
  groupPage?: number;
  groupLimit?: number;
}

function runsListBody(runs: Run[], total: number, filters: RunListFilters, offset = 0, limit = 50, stats?: DashboardStats, view?: RunsView): string {
  const group = view?.group ?? "none";
  const chip = (label: string, href: string, active: boolean) =>
    `<a class="${active ? "active" : ""}" href="${href}">${escapeHtml(label)}</a>`;
  const buildHref = (patch: Partial<RunListFilters> & { offset?: number; gpage?: number }): string => {
    const merged = { ...filters, offset: patch.offset ?? 0, ...patch };
    const params = new URLSearchParams();
    if (merged.gpage) params.set("gpage", String(merged.gpage));
    if (merged.score) params.set("score", merged.score);
    if (merged.source) params.set("source", merged.source);
    if (merged.model) params.set("model", merged.model);
    if (merged.provider) params.set("provider", merged.provider);
    if (merged.status) params.set("status", merged.status);
    if (merged.endUser) params.set("end_user", merged.endUser);
    if (merged.tag) params.set("tag", merged.tag);
    if (merged.reviewState) params.set("review_state", merged.reviewState);
    if (merged.search) params.set("q", merged.search);
    if (merged.agent) params.set("agent", merged.agent);
    if (merged.anomaly) params.set("anomaly", "1");
    if (merged.group && merged.group !== "none") params.set("group", merged.group);
    if (merged.project !== undefined) params.set("project", merged.project);
    if (merged.sort) params.set("sort", merged.sort);
    if (merged.dir) params.set("dir", merged.dir);
    if (merged.offset) params.set("offset", String(merged.offset));
    const qs = params.toString();
    return qs ? `/ui/runs?${qs}` : "/ui/runs";
  };
  const anyFilter = Boolean(
    filters.score ||
      filters.reviewState ||
      filters.anomaly ||
      filters.search ||
      filters.agent ||
      filters.source ||
      filters.model ||
      filters.provider ||
      filters.status ||
      filters.endUser ||
      filters.tag,
  );
  const activeFilterChip = (label: string, clear: Partial<RunListFilters>): string =>
    chip(truncate(label, 28), buildHref(clear), true);
  const filterBar = `<div class="filters-card">
    <div class="filter-tabs">
      ${chip("All", buildHref({ score: undefined, reviewState: undefined, anomaly: false, search: undefined, agent: undefined, source: undefined, model: undefined, provider: undefined, status: undefined, endUser: undefined, tag: undefined }), !anyFilter)}
      ${chip("Good", buildHref({ score: "good", reviewState: undefined, anomaly: false }), filters.score === "good")}
      ${chip("Bad", buildHref({ score: "bad", reviewState: undefined, anomaly: false }), filters.score === "bad")}
      ${chip("Unscored", buildHref({ score: "unscored", reviewState: undefined, anomaly: false }), filters.score === "unscored")}
      ${chip("Flagged", buildHref({ reviewState: "pending", score: undefined, anomaly: false }), filters.reviewState === "pending")}
      ${chip("Anomalies", buildHref({ anomaly: true, score: undefined, reviewState: undefined }), filters.anomaly)}
      ${filters.agent ? activeFilterChip(`agent: ${filters.agent}`, { agent: undefined }) : ""}
      ${filters.model ? activeFilterChip(`model: ${filters.model}`, { model: undefined }) : ""}
      ${filters.provider ? activeFilterChip(`provider: ${filters.provider}`, { provider: undefined }) : ""}
      ${filters.source ? activeFilterChip(`source: ${filters.source}`, { source: undefined }) : ""}
      ${filters.status ? activeFilterChip(`status: ${filters.status}`, { status: undefined }) : ""}
      ${filters.endUser ? activeFilterChip(`end user: ${filters.endUser}`, { endUser: undefined }) : ""}
      ${filters.tag ? activeFilterChip(`tag: ${filters.tag}`, { tag: undefined }) : ""}
      ${anyFilter ? `<a class="filter-clear" href="/ui/runs">Clear filters</a>` : ""}
    </div>
    <div class="filter-tabs">
      <span style="font-family:var(--mono);font-size:10px;color:var(--text-3);margin-right:2px">Group</span>
      ${chip("None", buildHref({ group: "none" }), group === "none")}
      ${chip("By session", buildHref({ group: "session" }), group === "session")}
      ${chip("By trace", buildHref({ group: "trace" }), group === "trace")}
    </div>
    <div class="filter-tabs">
      <span style="font-family:var(--mono);font-size:10px;color:var(--text-3);margin-right:2px">Sort</span>
      ${chip("Newest", buildHref({ sort: undefined, dir: undefined }), !filters.sort)}
      ${chip("Cost ↓", buildHref({ sort: "cost", dir: "desc" }), filters.sort === "cost" && filters.dir !== "asc")}
      ${chip("Cost ↑", buildHref({ sort: "cost", dir: "asc" }), filters.sort === "cost" && filters.dir === "asc")}
      ${chip("Latency ↓", buildHref({ sort: "latency", dir: "desc" }), filters.sort === "latency")}
      ${chip("Tokens ↓", buildHref({ sort: "tokens", dir: "desc" }), filters.sort === "tokens")}
    </div>
    ${
      view && view.projects.length > 1
        ? `<div class="filter-tabs">
      <span style="font-family:var(--mono);font-size:10px;color:var(--text-3);margin-right:2px">Project</span>
      ${chip("All projects", buildHref({ project: "" }), !filters.project)}
      ${view.projects
        .map((entry) => chip(entry.project.name, buildHref({ project: entry.project.id }), filters.project === entry.project.id))
        .join("")}
    </div>`
        : ""
    }
    <form method="get" action="/ui/runs" class="filter-search">
      ${filters.score ? `<input type="hidden" name="score" value="${escapeHtml(filters.score)}">` : ""}
      ${filters.reviewState ? `<input type="hidden" name="review_state" value="${escapeHtml(filters.reviewState)}">` : ""}
      ${filters.agent ? `<input type="hidden" name="agent" value="${escapeHtml(filters.agent)}">` : ""}
      ${filters.anomaly ? `<input type="hidden" name="anomaly" value="1">` : ""}
      ${group !== "none" ? `<input type="hidden" name="group" value="${escapeHtml(group)}">` : ""}
      ${filters.project ? `<input type="hidden" name="project" value="${escapeHtml(filters.project)}">` : ""}
      ${ICON_SEARCH}
      <input type="text" name="q" value="${escapeHtml(filters.search ?? "")}" placeholder="Search names, models, notes…" autocomplete="off">
      <button type="submit">Search</button>
    </form>
  </div>`;
  const head = `<div class="page-head">
    <div><h1>Runs</h1><p class="page-sub">${total.toLocaleString()} run${total === 1 ? "" : "s"} matched${filters.agent ? ` · agent ${escapeHtml(filters.agent)}` : ""}${group !== "none" ? ` · grouped by ${group}` : ` · showing ${runs.length ? `${offset + 1}–${offset + runs.length}` : "0"}`}</p></div>
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
      <span class="panel-note" style="font-family:var(--mono);font-size:10px">Export</span>
      <button class="btn btn-ghost" type="button" onclick="exportRuns('csv')">CSV</button>
      <button class="btn btn-ghost" type="button" onclick="exportRuns('ndjson')">NDJSON</button>
      <button class="btn btn-ghost" type="button" onclick="exportRuns('jsonl')">OpenAI JSONL</button>
      <button class="btn btn-ghost" type="button" onclick="exportRuns('slm')">SLM JSONL</button>
      ${refreshControls()}
    </div>
  </div>`;
  const summaryStrip = view
    ? `<div class="group-stats">
    <span class="chip" title="Runs matching the current filters">${total.toLocaleString()} runs</span>
    <span class="chip" title="Distinct agents across matched runs">${view.summary.agents.toLocaleString()} agent${view.summary.agents === 1 ? "" : "s"}</span>
    <span class="chip" title="Matched runs spawned by a parent run">${view.summary.subagents.toLocaleString()} subagent run${view.summary.subagents === 1 ? "" : "s"}</span>
    <span class="chip" title="Distinct sessions across matched runs">${view.summary.sessions.toLocaleString()} session${view.summary.sessions === 1 ? "" : "s"}</span>
    <span class="chip" title="Distinct traces across matched runs">${view.summary.traces.toLocaleString()} trace${view.summary.traces === 1 ? "" : "s"}</span>
  </div>`
    : "";
  const errorRate = stats && stats.totalRuns > 0 ? (stats.errorCount / stats.totalRuns) * 100 : 0;
  const p95Trend = stats?.previous ? deltaTrend(stats.p95LatencyMs, stats.previous.p95LatencyMs, { invert: true }) : "";
  const costTrend = stats?.previous ? deltaTrend(stats.totalCost, stats.previous.totalCost) : "";
  const tiles = stats
    ? `<div class="stat-tiles">
    <div class="stat-tile">
      <span class="st-label">P95 latency · 30d</span>
      <div class="st-value">${fmtMs(stats.p95LatencyMs)}</div>
      <div class="st-sub">avg ${fmtMs(stats.avgLatencyMs)}${p95Trend ? ` · ${p95Trend}` : ""}</div>
    </div>
    <div class="stat-tile">
      <span class="st-label">Mean eval score</span>
      <div class="st-value">${stats.avgScore == null ? "-" : stats.avgScore.toFixed(3)}</div>
      <div class="st-sub">${stats.scoredCount.toLocaleString()} scored run${stats.scoredCount === 1 ? "" : "s"}</div>
    </div>
    <div class="stat-tile">
      <span class="st-label">Run cost · 30d</span>
      <div class="st-value">${fmtUsd(stats.totalCost)}</div>
      <div class="st-sub">${fmtTokens(stats.totalTokens)} tokens${costTrend ? ` · ${costTrend}` : ""}</div>
    </div>
    <div class="stat-tile${stats.errorCount ? " tone-bad" : " tone-good"}">
      <span class="st-label">Error / flag rate</span>
      <div class="st-value">${errorRate.toFixed(2)}%</div>
      <div class="st-sub">${stats.errorCount} errors · ${stats.flaggedCount} flagged</div>
    </div>
  </div>`
    : "";
  if (!runs.length) {
    return `${head}${summaryStrip}${tiles}${filterBar}${emptyState("No runs match", "Point your LLM client at /proxy or send via the SDK: activity will appear here. Clear filters to see everything.")}${autoRefreshScript()}`;
  }
  const runsById = new Map(runs.map((r) => [r.id, r]));
  const depthFor = (run: Run): number => {
    let depth = 0;
    let parentId = run.parent_run_id;
    while (parentId && depth < 6) {
      const parent = runsById.get(parentId);
      if (!parent) {
        break;
      }
      depth += 1;
      parentId = parent.parent_run_id;
    }
    return depth;
  };
  const runRow = (r: Run, indent: boolean): string => {
    const score = r.score == null ? null : Number(r.score) >= 1 ? "good" : "bad";
    const review = r.review_state ?? null;
    const ev = view?.eventStats.get(r.id);
    const childCount = view?.childCounts.get(r.id) ?? 0;
    const depth = indent ? depthFor(r) : 0;
    const flags = [
      r.is_golden ? `<span class="flag-ico on" title="Golden run">★</span>` : "",
      r.pii_masked ? `<span class="flag-ico on" title="PII masked">${ICON_SHIELD}</span>` : "",
      r.policy_flags && r.policy_flags !== "[]" ? `<span class="flag-ico on" title="Policy flagged">⚑</span>` : "",
      childCount ? `<span class="chip" title="Subagent runs linked to this run">${childCount} sub</span>` : "",
      r.media_count ? `<span class="chip" title="Media parts captured">${r.media_count} media</span>` : "",
      ev?.toolCalls ? `<span class="chip" title="Tool calls recorded">${ev.toolCalls} tools</span>` : "",
      ev?.hasThinking || (r.thinking_tokens ?? 0) > 0 ? `<span class="think-mark" title="Reasoning captured">think</span>` : "",
      r.parent_run_id ? `<span class="chip" title="Spawned by a parent run">sub</span>` : "",
      review ? `<span class="chip">${escapeHtml(review)}</span>` : "",
    ]
      .filter(Boolean)
      .join("");
    const links = [
      r.session_id
        ? `<a href="/ui/sessions/${encodeURIComponent(r.session_id)}" onclick="event.stopPropagation()">session …${escapeHtml(r.session_id.slice(-8))}</a>`
        : "",
      r.trace_id
        ? `<a href="/ui/traces/${encodeURIComponent(r.trace_id)}" onclick="event.stopPropagation()">trace …${escapeHtml(r.trace_id.slice(-8))}</a>`
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const indentMark = depth > 0 ? `<span class="sub-indent">${"└ ".repeat(depth)}</span>` : "";
    const errored = (r.status ?? 0) >= 400;
    return `<tr class="clickable${errored ? " row-error" : ""}" onclick="location.href='/ui/runs/${r.id}'">
      <td onclick="event.stopPropagation()"><input type="checkbox" class="run-check" value="${escapeHtml(r.id)}" aria-label="Select run"></td>
      <td class="mono" style="color:var(--text-3);font-size:12px"><span title="${escapeHtml(r.created_at)}">${relTime(r.created_at)}</span></td>
      <td><div class="tree-cell">${indentMark}<span class="cell-stack">
        <span class="cell-inline"><span class="tcell-primary">${escapeHtml(truncate(r.name ?? "untitled", 46))}</span></span>
        <span class="tcell-sub">${r.model ? clusterLabel(r.model) : "-"}${r.provider ? ` · ${escapeHtml(r.provider)}` : ""}</span>
        ${links ? `<span class="tcell-sub">${links}</span>` : ""}
      </span></div></td>
      <td>${r.agent_name ? treeAgentChip(r.agent_name) : '<span class="badge neutral">-</span>'}</td>
      <td>${r.source ? `<span class="chip chip-mono">${escapeHtml(r.source)}</span>` : "-"}</td>
      <td>${statusBadge(r.status, r.finish_reason)}</td>
      <td class="num">${fmtTokens(((r.input_tokens ?? 0) + (r.output_tokens ?? 0)) || null)}</td>
      <td class="num mono">${fmtUsd(r.cost_usd)}</td>
      <td class="num">${fmtMs(r.latency_ms)}</td>
      <td>${score ? `<span class="score-badge ${score}">${score === "good" ? "1.0" : "0.0"}</span>` : `<span class="score-badge none">-</span>`}</td>
      <td>${flags || "-"}</td>
    </tr>`;
  };
  let tableBody: string;
  if (group !== "none" && view?.groups) {
    const keyOf = (r: Run) => (group === "session" ? r.session_id : r.trace_id) ?? "";
    const kind = group === "session" ? "sessions" : "traces";
    tableBody = view.groups
      .map((entry) => {
        const members = runs
          .filter((r) => keyOf(r) === entry.id)
          .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
        const spanMs = Math.max(0, (Date.parse(entry.lastAt) || 0) - (Date.parse(entry.firstAt) || 0));
        const errors = entry.errorCount
          ? `<span class="badge bad"><span class="dot"></span>${entry.errorCount} error${entry.errorCount === 1 ? "" : "s"}</span>`
          : "";
        const header = `<tr class="group-row"><td colspan="11"><div class="group-head-row">
          <span class="group-kind">${group}</span>
          ${entry.id ? `<a class="group-id" href="/ui/${kind}/${encodeURIComponent(entry.id)}">${escapeHtml(truncate(entry.id, 44))}</a>` : `<span class="group-id">(no ${group} id)</span>`}
          <span class="chip">${entry.runs} run${entry.runs === 1 ? "" : "s"}</span>
          <span class="chip">${entry.agents.length} agent${entry.agents.length === 1 ? "" : "s"}</span>
          <span class="chip">${entry.subagents} subagent${entry.subagents === 1 ? "" : "s"}</span>
          <span class="chip">${fmtUsd(entry.cost)}</span>
          <span class="chip">${fmtTokens(entry.tokens || null)} tokens</span>
          ${errors}
          ${spanMs ? `<span class="chip">${fmtMs(spanMs)} span</span>` : ""}
        </div></td></tr>`;
        return header + members.map((r) => runRow(r, true)).join("");
      })
      .join("");
  } else if (group !== "none" && view) {
    const keyOf = (r: Run) => (group === "session" ? r.session_id : r.trace_id) ?? "";
    const buckets = new Map<string, Run[]>();
    for (const r of runs) {
      const bucket = buckets.get(keyOf(r)) ?? [];
      bucket.push(r);
      buckets.set(keyOf(r), bucket);
    }
    const entries = [...buckets.entries()];
    entries.sort((a, b) => {
      const at = Math.max(...a[1].map((r) => Date.parse(r.created_at) || 0));
      const bt = Math.max(...b[1].map((r) => Date.parse(r.created_at) || 0));
      return bt - at;
    });
    tableBody = entries
      .map(([key, members]) => {
        members.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
        const window = groupWindowStats(members);
        const subCount = members.filter((m) => m.parent_run_id).length;
        const kind = group === "session" ? "sessions" : "traces";
        const errors = window.errors
          ? `<span class="badge bad"><span class="dot"></span>${window.errors} error${window.errors === 1 ? "" : "s"}</span>`
          : "";
        const header = `<tr class="group-row"><td colspan="11"><div class="group-head-row">
          <span class="group-kind">${group}</span>
          ${key ? `<a class="group-id" href="/ui/${kind}/${encodeURIComponent(key)}">${escapeHtml(truncate(key, 44))}</a>` : `<span class="group-id">(no ${group} id)</span>`}
          <span class="chip">${members.length} run${members.length === 1 ? "" : "s"}</span>
          <span class="chip">${window.agents.length} agent${window.agents.length === 1 ? "" : "s"}</span>
          <span class="chip">${subCount} subagent${subCount === 1 ? "" : "s"}</span>
          <span class="chip">${fmtUsd(window.cost)}</span>
          <span class="chip">${fmtTokens(window.tokens || null)} tokens</span>
          ${errors}
          ${window.spanMs ? `<span class="chip">${fmtMs(window.spanMs)} span</span>` : ""}
        </div></td></tr>`;
        return header + members.map((r) => runRow(r, true)).join("");
      })
      .join("");
  } else {
    tableBody = runs.map((r) => runRow(r, false)).join("");
  }
  const groupedPaging = group !== "none" && view?.groups !== undefined;
  const groupPageIndex = view?.groupPage ?? 0;
  const groupPageSize = view?.groupLimit ?? 10;
  const groupTotal = view?.groupTotal ?? 0;
  const shownGroups = view?.groups?.length ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + runs.length < total;
  const pager = groupedPaging
    ? `<div class="pager">
    <span>Groups <b>${shownGroups ? groupPageIndex * groupPageSize + 1 : 0}–${groupPageIndex * groupPageSize + shownGroups}</b> of <b>${groupTotal.toLocaleString()}</b> · showing <b>${runs.length.toLocaleString()}</b> run${runs.length === 1 ? "" : "s"}</span>
    <div class="pager-links">
      ${groupPageIndex > 0 ? `<a href="${buildHref({ gpage: groupPageIndex - 1 })}">← Prev</a>` : `<span>← Prev</span>`}
      <a href="${buildHref({})}">Top</a>
      ${groupPageIndex * groupPageSize + shownGroups < groupTotal ? `<a href="${buildHref({ gpage: groupPageIndex + 1 })}">Next →</a>` : `<span>Next →</span>`}
    </div>
  </div>`
    : `<div class="pager">
    <span>Showing <b>${offset + 1}–${offset + runs.length}</b> of <b>${total.toLocaleString()}</b></span>
    <div class="pager-links">
      ${hasPrev ? `<a href="${buildHref({ offset: Math.max(0, offset - limit) })}">← Prev</a>` : `<span>← Prev</span>`}
      <a href="${buildHref({ offset: 0 })}">Top</a>
      ${hasNext ? `<a href="${buildHref({ offset: offset + limit })}">Next →</a>` : `<span>Next →</span>`}
    </div>
  </div>`;
  return `${head}${summaryStrip}${tiles}${filterBar}
  <div class="bulk-bar" id="bulk-bar" style="display:none;align-items:center;gap:8px;padding:8px 12px;margin-bottom:8px;background:var(--surface-2);border:1px solid var(--accent-line);border-radius:var(--r-lg)">
    <span class="panel-note" id="bulk-count" style="font-family:var(--mono)">0 selected</span>
    <button class="btn btn-ghost" type="button" data-bulk="score" data-score="good">Mark good</button>
    <button class="btn btn-ghost" type="button" data-bulk="score" data-score="bad">Mark bad</button>
    <button class="btn btn-ghost" type="button" data-bulk="score" data-score="unscored">Clear score</button>
    <button class="btn btn-ghost" type="button" data-bulk="judge">Judge selected</button>
    <button class="btn btn-ghost" type="button" data-bulk="delete" style="color:var(--bad)">Delete</button>
    <button class="btn btn-ghost" type="button" data-bulk="compare">Compare</button>
    <span class="panel-note" id="bulk-msg"></span>
  </div>
  <div class="panel"><div class="table-wrap"><table>
    <thead><tr><th style="width:26px"><input type="checkbox" id="run-all" aria-label="Select all"></th><th>Time</th><th>Run</th><th>Agent</th><th>Source</th><th>Status</th><th class="num">Tokens</th><th class="num">Cost</th><th class="num">Latency</th><th>Score</th><th>Flags</th></tr></thead>
    <tbody>${tableBody}</tbody>
  </table></div>${pager}</div>
  <script>
  function exportRuns(format){
    var params=new URLSearchParams(location.search);params.set("format",format);
    fetch("/api/runs/export?"+params.toString(),{headers:{authorization:"Bearer "+(localStorage.getItem("torrix_key")||"")}}).then(function(res){
      if(!res.ok){return res.json().then(function(j){alert(j.error||"export failed")}).catch(function(){alert("export failed")})}
      return res.blob().then(function(blob){
        var a=document.createElement("a");a.href=URL.createObjectURL(blob);
        a.download="torrix-runs."+(format==="csv"?"csv":"jsonl");
        document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(a.href);
      });
    });
  }
  (function(){
    var boxes=function(){return Array.prototype.slice.call(document.querySelectorAll(".run-check"))};
    var bar=document.getElementById("bulk-bar"),count=document.getElementById("bulk-count"),msg=document.getElementById("bulk-msg");
    function refresh(){var n=boxes().filter(function(b){return b.checked}).length;count.textContent=n+" selected";bar.style.display=n?"flex":"none"}
    var all=document.getElementById("run-all");
    all.addEventListener("change",function(){boxes().forEach(function(b){b.checked=all.checked});refresh()});
    boxes().forEach(function(b){b.addEventListener("change",refresh)});
    document.querySelectorAll("[data-bulk]").forEach(function(btn){btn.addEventListener("click",function(){
      var ids=boxes().filter(function(b){return b.checked}).map(function(b){return b.value});
      if(!ids.length)return;
      var action=btn.dataset.bulk;
      if(action==="compare"){
        if(ids.length<2){msg.textContent="Select at least two runs to compare.";return}
        location.href="/ui/compare?ids="+ids.slice(0,4).map(encodeURIComponent).join(",");
        return;
      }
      if(action==="delete"&&!confirm("Delete "+ids.length+" run(s)? This cannot be undone."))return;
      var payload={action:action,ids:ids};
      if(action==="score")payload.score=btn.dataset.score;
      fetch("/api/runs/bulk",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+(localStorage.getItem("torrix_key")||"")},body:JSON.stringify(payload)})
        .then(function(r){return r.json().then(function(j){return {ok:r.ok,status:r.status,body:j}})})
        .then(function(r){
          if(!r.ok){msg.textContent=r.body.error||"failed";if(window.showToast)window.showToast(r.body.error||"judge failed","error");return}
          if(action==="judge"){
            msg.textContent="";
            if(window.showToast)window.showToast("Judging "+r.body.queued+" run(s) in the background. Refresh in a moment to see scores.","info",5000);
            return;
          }
          location.reload();
        });
    })});
  })();
  </script>${autoRefreshScript()}`;
}

function compareRunsBody(entries: Array<{ run: Run; events: Events[] }>): string {
  if (entries.length < 2) {
    return `${backLink("/ui/runs", "All runs")}${emptyState("Nothing to compare", "Open the Runs page, select two to four runs, then choose Compare.")}`;
  }
  const fields: Array<[string, (run: Run) => string]> = [
    ["Name", (run) => run.name ?? "-"],
    ["Created", (run) => `${shortDate(run.created_at)} · ${relTime(run.created_at)}`],
    ["Model", (run) => run.model ?? run.routed_from ?? "-"],
    ["Provider", (run) => run.provider ?? "-"],
    ["Source", (run) => run.source ?? "-"],
    ["Status", (run) => (run.status == null ? "-" : String(run.status))],
    ["Tokens", (run) => fmtTokens(((run.input_tokens ?? 0) + (run.output_tokens ?? 0)) || null)],
    ["Cost", (run) => fmtUsd(run.cost_usd)],
    ["Latency", (run) => fmtMs(run.latency_ms)],
    ["Score", (run) => (run.score == null ? "-" : run.score >= 1 ? "good" : "bad")],
    ["Agent", (run) => run.agent_name ?? "-"],
    ["Session", (run) => (run.session_id ? truncate(run.session_id, 22) : "-")],
    ["Trace", (run) => (run.trace_id ? truncate(run.trace_id, 22) : "-")],
  ];
  const header = `<tr><th>Field</th>${entries
    .map((entry) => `<th><a href="/ui/runs/${encodeURIComponent(entry.run.id)}">${escapeHtml(truncate(entry.run.name ?? entry.run.id, 34))}</a><div class="panel-note" style="font-family:var(--mono);font-size:10px">${escapeHtml(entry.run.id.slice(0, 8))}</div></th>`)
    .join("")}</tr>`;
  const rows = fields
    .map(
      ([label, read]) =>
        `<tr><td style="color:var(--text-3)">${escapeHtml(label)}</td>${entries
          .map((entry) => `<td>${escapeHtml(read(entry.run))}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  const responses = entries
    .map((entry) => {
      const responses = entry.events.filter((event) => event.type === "response");
      const text = responses.map((event) => event.message).join("\n\n") || "No response recorded.";
      return `<div class="panel"><div class="panel-head"><span class="panel-title">${escapeHtml(truncate(entry.run.name ?? entry.run.id, 40))}</span><span class="panel-note">${responses.length} response event${responses.length === 1 ? "" : "s"}</span></div>
        <div style="padding:14px 16px"><pre style="white-space:pre-wrap;word-break:break-word;margin:0;font:12px/1.55 var(--mono);color:var(--text-2)">${escapeHtml(truncate(text, 6000))}</pre></div></div>`;
    })
    .join("");
  return `${backLink("/ui/runs", "All runs")}
  <div class="page-head"><div><h1>Compare runs</h1><p class="page-sub">${entries.length} runs side by side · prompts and responses stay on this host</p></div></div>
  <div class="panel" style="margin-bottom:16px"><div class="table-wrap"><table>
    <thead>${header}</thead><tbody>${rows}</tbody>
  </table></div></div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px">${responses}</div>`;
}

function queryConsoleBody(): string {
  return `<style>
  .q-sql{width:100%;background:var(--bg);border:1px solid var(--line-2);color:var(--text);border-radius:var(--r);padding:12px;font:12.5px/1.6 var(--mono);outline:none;resize:vertical}
  .q-sql:focus{border-color:var(--accent)}
  .q-result table{width:100%;border-collapse:collapse;font-size:12.5px}
  .q-result th{position:sticky;top:0;background:var(--surface-2);text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);padding:7px 9px;border-bottom:1px solid var(--line)}
  .q-result td{padding:6px 9px;border-bottom:1px solid var(--line);color:var(--text-2);font-family:var(--mono);white-space:nowrap;max-width:340px;overflow:hidden;text-overflow:ellipsis}
  </style>
  <div class="page-head"><div><h1>SQL console</h1><p class="page-sub">Read-only queries against the Torrix store: one SELECT or WITH statement, capped at 500 rows. Writes are rejected.</p></div></div>
  <div class="panel"><div class="panel-body">
    <textarea class="q-sql" id="q-sql" rows="6" spellcheck="false">SELECT model, COUNT(*) AS runs, ROUND(SUM(cost_usd), 4) AS cost
FROM runs
GROUP BY model
ORDER BY cost DESC</textarea>
    <div style="display:flex;gap:10px;align-items:center;margin-top:10px">
      <button class="btn btn-primary" id="q-run">Run query</button>
      <button class="btn btn-ghost" id="q-clear">Clear</button>
      <span class="panel-note" id="q-status"></span>
    </div>
    <div class="q-result" id="q-result" style="margin-top:14px;max-height:520px;overflow:auto"></div>
  </div></div>
  <script>
  (function(){
    var sql=document.getElementById("q-sql"),status=document.getElementById("q-status"),out=document.getElementById("q-result");
    function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}
    document.getElementById("q-run").onclick=function(){
      status.textContent="Running…";
      fetch("/api/query",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+(localStorage.getItem("torrix_key")||"")},body:JSON.stringify({sql:sql.value})})
        .then(function(r){return r.json().then(function(j){return {ok:r.ok,body:j}})})
        .then(function(r){
          if(!r.ok){status.textContent=r.body.error||"Query failed";out.innerHTML="";return}
          status.textContent=r.body.rowCount+" row(s) · "+r.body.elapsedMs+" ms"+(r.body.truncated?" · truncated to 500":"");
          var head="<tr>"+r.body.columns.map(function(c){return "<th>"+esc(c)+"</th>"}).join("")+"</tr>";
          var rows=r.body.rows.map(function(row){return "<tr>"+r.body.columns.map(function(c){var v=row[c];return "<td title='"+esc(v)+"'>"+esc(v)+"</td>"}).join("")+"</tr>"}).join("");
          out.innerHTML='<table><thead>'+head+'</thead><tbody>'+(rows||'<tr><td>No rows.</td></tr>')+'</tbody></table>';
        })
        .catch(function(err){status.textContent=String(err);out.innerHTML=""});
    };
    document.getElementById("q-clear").onclick=function(){out.innerHTML="";status.textContent=""};
  })();
  </script>`;
}

function insightsBody(report: InsightsReport, savings: SavingsReport, projectName: string | null = null): string {
  const highlights = report.highlights.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
  const cachingRows = report.caching.repeatedGroups.length
    ? report.caching.repeatedGroups
        .map(
          (row) =>
            `<tr><td class="mono">${escapeHtml(truncate(row.promptPrefix, 90))}</td><td class="num">${row.calls}</td><td class="num">${row.avgInputTokens.toLocaleString()}</td><td class="num">${fmtUsd(row.potentialSavingsUsd)}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="4" class="panel-note" style="padding:12px">No repeated prompt prefixes found in this window.</td></tr>`;
  const slmRows = report.slm.opportunities.length
    ? report.slm.opportunities
        .map(
          (row) =>
            `<tr><td class="mono">${escapeHtml(truncate(row.cluster, 28))}</td><td class="num">${row.runs}</td><td class="num">${fmtUsd(row.spendUsd)}</td><td>${escapeHtml(truncate(row.suggestion, 90))}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="4" class="panel-note" style="padding:12px">No SLM substitution clusters detected yet.</td></tr>`;
  const agentRows = report.agents.length
    ? report.agents
        .map(
          (row) =>
            `<tr><td><a href="/ui/runs?agent=${encodeURIComponent(row.name)}">${escapeHtml(row.name)}</a></td><td class="num">${row.runs.toLocaleString()}</td><td class="num">${fmtUsd(row.cost)}</td><td class="num"${row.errorCount ? ` style="color:var(--bad)"` : ""}>${row.errorCount}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="4" class="panel-note" style="padding:12px">No agent-attributed runs in this window.</td></tr>`;
  const mcpToolRows = report.mcp.tools.length
    ? report.mcp.tools
        .map(
          (row) =>
            `<tr><td class="mono">${escapeHtml(row.tool)}</td><td class="num">${row.runs.toLocaleString()}</td><td class="num">${fmtUsd(row.cost)}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="3" class="panel-note" style="padding:12px">No MCP tool calls in this window.</td></tr>`;
  const actionItems = report.actions.length
    ? report.actions
        .map(
          (action) =>
            `<a class="in-action" href="${action.href}"><span class="a-label">${escapeHtml(action.label)}</span><span class="a-detail">${escapeHtml(action.detail)}</span></a>`,
        )
        .join("")
    : `<div class="panel-note" style="padding:6px 2px">Nothing to act on in this window.</div>`;
  const savingsRows = savings.recommendations.length
    ? savings.recommendations
        .map((item) => {
          const model = item.evidence.models?.[0];
          const href = model ? `/ui/runs?model=${encodeURIComponent(model)}` : null;
          const link = href ? `<a class="btn btn-ghost" href="${href}">View runs</a>` : "";
          return `<tr>
            <td><span class="tcell-primary">${escapeHtml(item.title)}</span><span class="in-opp-detail">${escapeHtml(item.detail)}</span></td>
            <td><span class="in-conf ${item.confidence}">${escapeHtml(item.confidence)}</span></td>
            <td class="num"><span class="in-usd">${fmtUsd(item.monthly_usd)}/mo</span></td>
            <td>${link}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="4" class="panel-note" style="padding:12px">No dollar-denominated savings found in this window.</td></tr>`;
  const topSavings = savings.recommendations[0] ?? null;
  return `<style>
  .in-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:18px 0}
  .in-card{display:block;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:14px 16px;text-decoration:none;color:inherit;transition:border-color .15s}
  .in-card:hover{border-color:var(--line-2)}
  .in-card .lbl{font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-3)}
  .in-card .val{font-size:21px;font-weight:600;letter-spacing:-.02em;margin-top:5px}
  .in-card .sub{font-size:12px;color:var(--text-3);margin-top:3px}
  .in-list{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:7px;color:var(--text-2);font-size:13.5px}
  .in-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
  .in-action{display:block;padding:11px 13px;border:1px solid var(--line);border-radius:var(--r-lg);background:var(--surface-2);text-decoration:none;transition:border-color .15s}
  .in-action:hover{border-color:var(--accent)}
  .in-action .a-label{display:block;font-size:13px;font-weight:600;color:var(--text)}
  .in-action .a-detail{display:block;margin-top:3px;font-family:var(--mono);font-size:10.5px;color:var(--text-3)}
  .in-opp-detail{display:block;margin-top:3px;font-size:12px;color:var(--text-2);max-width:640px;white-space:normal;line-height:1.45}
  .in-conf{display:inline-block;padding:3px 8px;border-radius:4px;border:1px solid var(--line);background:var(--surface-2);font-family:var(--mono);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-3)}
  .in-conf.high{color:var(--good);border-color:var(--good-line);background:var(--good-dim)}
  .in-conf.medium{color:var(--warn);border-color:var(--warn-line);background:var(--warn-dim)}
  .in-usd{font-family:var(--mono);font-variant-numeric:tabular-nums;font-weight:600}
  .in-mo{font-size:12px;color:var(--text-3);font-weight:500;margin-left:2px}
  </style>
  <div class="page-head">
    <div><h1>Insights</h1><p class="page-sub">${projectName ? `Project ${escapeHtml(projectName)} · ` : ""}Automatic read on the last ${report.windowDays} days: cost, errors, agents, MCP, caching headroom and SLM savings. Generated <b>${escapeHtml(relTime(report.generatedAt))}</b>${report.generatedWith === "judge" ? ` by the judge LLM (${fmtUsd(report.judgeCostUsd)} judge cost)` : " from rules"}.</p></div>
    <div class="head-actions"><button class="btn btn-primary" id="ins-generate" type="button">Generate now</button></div>
  </div>
  <div class="in-cards">
    <a class="in-card" href="/ui/analytics"><div class="lbl">Spend</div><div class="val">${fmtUsd(report.spendUsd)}</div><div class="sub">${report.priorSpendUsd == null ? "no prior window" : `prior ${fmtUsd(report.priorSpendUsd)}`}</div></a>
    <a class="in-card" href="/ui/runs"><div class="lbl">Runs</div><div class="val">${report.runs.toLocaleString()}</div><div class="sub">error rate ${report.errorRate}%</div></a>
    <a class="in-card" href="/ui/runs?anomaly=1"><div class="lbl">Anomalies</div><div class="val">${report.anomalyCount}</div><div class="sub">cost above baseline</div></a>
    <a class="in-card" href="#caching"><div class="lbl">Cache headroom</div><div class="val">${fmtUsd(report.caching.totalPotentialSavingsUsd)}</div><div class="sub">repeated prefixes</div></a>
    <a class="in-card" href="#slm"><div class="lbl">SLM savings</div><div class="val">${fmtUsd(report.slm.estimatedSavingsUsd)}</div><div class="sub">estimated at 70%</div></a>
    <a class="in-card" href="#savings"><div class="lbl">Savings found</div><div class="val">${topSavings ? `${fmtUsd(topSavings.monthly_usd)}<span class="in-mo">/mo</span>` : "$0"}</div><div class="sub">${topSavings ? escapeHtml(truncate(topSavings.title, 46)) : "no opportunities in this window"}</div></a>
    <a class="in-card" href="/ui/runs?source=mcp_gateway"><div class="lbl">MCP calls</div><div class="val">${report.mcp.calls.toLocaleString()}</div><div class="sub">${report.mcp.denied} denied · ${report.mcp.pending} pending</div></a>
  </div>
  <div class="panel" style="margin-bottom:16px"><div class="panel-head"><span class="panel-title">Highlights</span><span class="panel-note">${report.generatedWith === "judge" ? "written by the configured judge model" : "rule-based; configure the judge for LLM-written bullets"}</span></div><div class="panel-body"><ul class="in-list">${highlights}</ul></div></div>
  <div class="panel" style="margin-bottom:16px"><div class="panel-head"><span class="panel-title">Suggested actions</span><span class="panel-note">click through to the underlying runs and settings</span></div><div class="panel-body"><div class="in-actions">${actionItems}</div></div></div>
  <div class="panel" id="savings" style="margin-bottom:16px"><div class="panel-head"><span class="panel-title">Savings opportunities</span><span class="panel-note">ranked by estimated monthly impact; last ${report.windowDays} days projected to a 30-day month</span></div>
    <div class="table-wrap"><table><thead><tr><th>Opportunity</th><th>Confidence</th><th class="num">Est. monthly</th><th></th></tr></thead><tbody>${savingsRows}</tbody></table></div>
  </div>
  <div class="panel" style="margin-bottom:16px"><div class="panel-head"><span class="panel-title">Agent activity</span><span class="panel-note">runs, spend and errors by agent_name / agent_id</span></div>
    <div class="table-wrap"><table><thead><tr><th>Agent</th><th class="num">Runs</th><th class="num">Cost</th><th class="num">Errors</th></tr></thead><tbody>${agentRows}</tbody></table></div>
  </div>
  <div class="panel" style="margin-bottom:16px"><div class="panel-head"><span class="panel-title">MCP activity</span><span class="panel-note">${report.mcp.calls.toLocaleString()} calls · ${report.mcp.denied} denied · ${report.mcp.pending} pending approval</span></div>
    <div class="table-wrap"><table><thead><tr><th>Tool</th><th class="num">Runs</th><th class="num">Cost</th></tr></thead><tbody>${mcpToolRows}</tbody></table></div>
  </div>
  <div class="panel" id="caching" style="margin-bottom:16px"><div class="panel-head"><span class="panel-title">Prompt caching candidates</span><span class="panel-note">prefixes repeated 3+ times</span></div>
    <div class="table-wrap"><table><thead><tr><th>Prompt prefix</th><th class="num">Calls</th><th class="num">Avg input tokens</th><th class="num">Potential savings</th></tr></thead><tbody>${cachingRows}</tbody></table></div>
  </div>
  <div class="panel" id="slm"><div class="panel-head"><span class="panel-title">Smaller-model opportunities</span><span class="panel-note">clusters at least 70% cheaper on a smaller model</span></div>
    <div class="table-wrap"><table><thead><tr><th>Cluster</th><th class="num">Runs</th><th class="num">Spend</th><th>Suggestion</th></tr></thead><tbody>${slmRows}</tbody></table></div>
  </div>
  <script>(function(){
    var button=document.getElementById("ins-generate");
    if(!button)return;
    button.onclick=function(){
      button.disabled=true;button.textContent="Generating…";
      fetch("/api/insights/generate",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+(localStorage.getItem("torrix_key")||"")},body:JSON.stringify({days:${report.windowDays}})})
        .then(function(res){
          if(res.ok){location.reload();return}
          button.disabled=false;button.textContent="Generate now";
          if(window.showToast)window.showToast("Insight generation failed","error");
        })
        .catch(function(){button.disabled=false;button.textContent="Generate now"});
    };
  })();</script>`;
}

export function lockedPanel(featureId: string): string {
  const feature = lockedFeature(featureId);
  if (!feature) {
    return "";
  }
  const edition = editionName(feature.edition);
  return `<div class="panel"><div class="panel-head"><span class="panel-title">${escapeHtml(feature.label)}</span><span class="badge neutral">${escapeHtml(edition)}</span></div>
    <div class="locked-card" style="max-width:none"><p>${escapeHtml(feature.pitch)}</p><div class="locked-actions"><a class="btn btn-ghost" href="/ui/locked/${escapeHtml(feature.id)}">See what ${escapeHtml(edition)} adds</a></div></div></div>`;
}

function governanceBody(settings: GovernanceSettings, config: ServerConfig, paidPanels: string): string {
  const activeTypes = new Set(parsePiiTypes(settings.pii_types));

  const typeChecks = PII_TYPES.map(
    (t) => `<label><input type="checkbox" class="gv-pii-type" value="${escapeHtml(t)}"${activeTypes.has(t) ? " checked" : ""}>${escapeHtml(t)}</label>`,
  ).join("");

  const settingsPanel = `<div class="panel"><div class="panel-head"><span class="panel-title">PII masking &amp; oversight</span><span class="panel-note">${escapeHtml(settings.updated_at ? `updated ${relTime(settings.updated_at)}` : "")}</span></div>
    <div class="gv-form">
      <div class="gv-wide gv-checks">
        <label><input type="checkbox" id="gv-pii-enabled"${settings.pii_enabled ? " checked" : ""}>Mask PII before storage</label>
        <label><input type="checkbox" id="gv-mask-input"${settings.pii_mask_input ? " checked" : ""}>Mask inputs</label>
        <label><input type="checkbox" id="gv-mask-output"${settings.pii_mask_output ? " checked" : ""}>Mask outputs</label>
        <label><input type="checkbox" id="gv-review"${settings.human_review_enabled ? " checked" : ""}>Queue flagged runs for human review</label>
        <label><input type="checkbox" id="gv-audit"${settings.audit_enabled ? " checked" : ""}>Record audit log</label>
      </div>
      <div class="gv-wide gv-checks" id="gv-pii-types">${typeChecks}</div>
      <div><label for="gv-placeholder">Placeholder</label><input id="gv-placeholder" type="text" value="${escapeHtml(settings.pii_placeholder)}"></div>
      <div class="gv-actions"><button class="btn btn-primary" id="gv-save">Save settings</button><span class="gv-status" id="gv-status"></span></div>
    </div>
  </div>`;

  const script = `<script>(function(){
  function key(){return localStorage.getItem("torrix_key")||""}
  function api(path,opts){opts=opts||{};opts.headers=Object.assign({"content-type":"application/json",authorization:"Bearer "+key()},opts.headers||{});return fetch(path,opts).then(function(r){return r.json().then(function(j){return {ok:r.ok,status:r.status,body:j}}).catch(function(){return {ok:r.ok,status:r.status,body:{}}})})}
  function on(id,fn){var el=document.getElementById(id);if(el)el.addEventListener("click",fn)}
  function note(id,msg,err){var el=document.getElementById(id);el.textContent=msg;el.className="gv-status"+(err?" err":"");setTimeout(function(){el.textContent=""},4000)}

  on("gv-save",function(){
    var types=[];document.querySelectorAll(".gv-pii-type").forEach(function(c){if(c.checked)types.push(c.value)});
    api("/api/governance/settings",{method:"PUT",body:JSON.stringify({
      pii_enabled:document.getElementById("gv-pii-enabled").checked?1:0,
      pii_mask_input:document.getElementById("gv-mask-input").checked?1:0,
      pii_mask_output:document.getElementById("gv-mask-output").checked?1:0,
      human_review_enabled:document.getElementById("gv-review").checked?1:0,
      audit_enabled:document.getElementById("gv-audit").checked?1:0,
      pii_placeholder:document.getElementById("gv-placeholder").value,
      pii_types:types
    })}).then(function(r){if(r.ok)location.reload();else note("gv-status","save failed",true)});
  });

})();</script>`;

  const panels =
    paidPanels ||
    ["policies", "routing", "slm", "external-exports"].map((feature) => lockedPanel(feature)).join("\n");
  return `<style>${GOVERNANCE_STYLE}</style>
  <div class="page-head"><div><h1>Governance</h1><p class="page-sub">Policy, privacy and routing controls for this instance · ${escapeHtml(config.edition)} edition</p></div></div>
  ${settingsPanel}
  ${panels}
  ${script}`;
}

function analyticsBody(
  stats: DashboardStats,
  models: AnalyticsRow[],
  agents: AnalyticsRow[],
  endUsers: AnalyticsRow[],
  tools: AnalyticsRow[],
  byProject: AnalyticsRow[],
  projectNames: Map<string, string>,
  range: number,
  projectId: string | null,
  projectName: string | null,
): string {
  const errorRate = stats.totalRuns > 0 ? (stats.errorCount / stats.totalRuns) * 100 : 0;
  const prevErrorRate = stats.previous && stats.previous.totalRuns > 0 ? (stats.previous.errorCount / stats.previous.totalRuns) * 100 : 0;
  const suffix = ` vs previous ${range}d`;
  const rangeHref = (days: number) => `/ui/analytics?range=${days}${projectId ? `&project=${encodeURIComponent(projectId)}` : ""}`;
  const rangeBadges = [7, 14, 30].map((r) => `<a href="${rangeHref(r)}" class="${r === range ? "active" : ""}">${r}D</a>`).join("");
  const tiles = `<div class="stat-tiles">
    <a class="stat-tile" href="/ui/runs?sort=cost&dir=desc"><span class="st-label">Spend</span><div class="st-value">${fmtUsd(stats.totalCost)}</div><div class="st-sub">${stats.previous ? deltaTrend(stats.totalCost, stats.previous.totalCost, { suffix }) : `${fmtTokens(stats.totalTokens || null)} tokens`}</div></a>
    <a class="stat-tile" href="/ui/runs"><span class="st-label">Runs</span><div class="st-value">${stats.totalRuns.toLocaleString()}</div><div class="st-sub">${stats.previous ? deltaTrend(stats.totalRuns, stats.previous.totalRuns, { suffix }) : "this window"}</div></a>
    <a class="stat-tile${stats.errorCount ? " tone-bad" : " tone-good"}" href="/ui/runs?status=error"><span class="st-label">Error rate</span><div class="st-value">${errorRate.toFixed(2)}%</div><div class="st-sub">${stats.errorCount} errors${stats.previous ? ` · ${deltaTrend(errorRate, prevErrorRate, { invert: true })}` : ""}</div></a>
    <a class="stat-tile" href="/ui/runs?sort=latency&dir=desc"><span class="st-label">Latency</span><div class="st-value">${fmtMs(stats.p95LatencyMs)}</div><div class="st-sub">p50 ${fmtMs(stats.p50LatencyMs)} · p99 ${fmtMs(stats.p99LatencyMs)}</div></a>
    <a class="stat-tile" href="/ui/runs?sort=tokens&dir=desc"><span class="st-label">Tokens</span><div class="st-value">${fmtTokens(stats.totalTokens || null)}</div><div class="st-sub">avg ${stats.totalRuns ? Math.round(stats.totalTokens / stats.totalRuns).toLocaleString() : 0} / run</div></a>
    <a class="stat-tile" href="/ui/runs?sort=score&dir=desc"><span class="st-label">Mean score</span><div class="st-value">${stats.avgScore == null ? "-" : stats.avgScore.toFixed(3)}</div><div class="st-sub">${stats.scoredCount.toLocaleString()} scored</div></a>
  </div>`;
  const rowCells = (row: AnalyticsRow, link?: (row: AnalyticsRow) => string, label?: (row: AnalyticsRow) => string): string => {
    const key = (label ? label(row) : row.key) || "-";
    const first = link ? `<a href="${link(row)}">${escapeHtml(key)}</a>` : escapeHtml(key);
    return `<td class="mono">${first}</td><td class="num">${row.runs.toLocaleString()}</td><td class="num">${fmtTokens(row.tokens || null)}</td><td class="num">${fmtUsd(row.cost)}</td><td class="num">${row.tokens > 0 ? fmtUsd((row.cost / row.tokens) * 1000) : "-"}</td><td class="num">${row.runs > 0 ? `${((row.errorCount / row.runs) * 100).toFixed(1)}%` : "-"}</td><td class="num">${fmtMs(row.avgLatencyMs)}</td><td class="num">${row.avgScore == null ? "-" : row.avgScore.toFixed(2)}</td>`;
  };
  const table = (title: string, note: string, rows: AnalyticsRow[], firstHeader: string, link?: (row: AnalyticsRow) => string, label?: (row: AnalyticsRow) => string): string =>
    `<div class="panel" style="margin-bottom:18px"><div class="panel-head"><span class="panel-title">${escapeHtml(title)}</span><span class="panel-note">${escapeHtml(note)}</span></div>
    <div class="table-wrap"><table>
      <thead><tr><th>${escapeHtml(firstHeader)}</th><th class="num">Runs</th><th class="num">Tokens</th><th class="num">Cost</th><th class="num">Cost / 1k</th><th class="num">Errors</th><th class="num">Avg latency</th><th class="num">Avg score</th></tr></thead>
      <tbody>${rows.length ? rows.map((row) => `<tr>${rowCells(row, link, label)}</tr>`).join("") : `<tr><td colspan="8" class="panel-note" style="padding:14px">No data in this window.</td></tr>`}</tbody>
    </table></div></div>`;
  return `<div class="page-head">
    <div><h1>Analytics</h1><p class="page-sub">Last ${range} days${projectName ? ` · project ${escapeHtml(projectName)}` : " · all projects"} · deep breakdowns: models, agents, end users and projects</p></div>
    <div class="head-actions"><a class="btn btn-ghost" href="/ui/dashboard">Dashboard home</a><span class="range">${rangeBadges}</span></div>
  </div>
  ${tiles}
  ${table("Model leaderboard", "per-model spend, efficiency and quality for the window", models, "Model", (row) => `/ui/runs?model=${encodeURIComponent(row.key)}`)}
  ${table("Cost by agent", "agent_name / agent_id from every ingestion path", agents, "Agent", (row) => `/ui/runs?agent=${encodeURIComponent(row.key)}`)}
  ${table("Cost by end user", "x-torrix-user-id or record.end_user_id", endUsers, "End user", (row) => `/ui/runs?end_user=${encodeURIComponent(row.key)}`)}
  ${table("Cost by project", "project_id from proxy, SDK, ingest and OTLP runs", byProject, "Project", (row) => `/ui/runs?project=${encodeURIComponent(row.key)}`, (row) => projectNames.get(row.key) ?? row.key)}
  ${table("MCP tools", "tool calls from /mcp, /mcp/proxy and the governed gateway", tools, "Tool", (row) => `/ui/runs?q=${encodeURIComponent(row.key)}`)}
  <div class="db-cols">
    <div>${donutPanel(stats.bySource)}</div>
    <div>${latencyHistogramPanel(stats.latencyBuckets)}</div>
  </div>`;
}

export const GOVERNANCE_STYLE = `
.gv-section{margin-bottom:20px}
.gv-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px}
.gv-head h2{font-size:15px;font-weight:620;letter-spacing:-.02em;margin:0}
.gv-head p{color:var(--text-3);font-size:12.5px;margin:4px 0 0}
.gv-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;align-items:end;padding:16px 18px}
.gv-form label{display:block;font-size:11.5px;font-weight:600;color:var(--text-2);margin:0 0 5px}
.gv-form input,.gv-form select{width:100%;background:var(--bg);border:1px solid var(--line-2);color:var(--text);
  border-radius:var(--r);padding:8px 10px;font-size:13px;font-family:inherit;outline:none}
.gv-form input:focus,.gv-form select:focus{border-color:var(--accent)}
.gv-form .gv-wide{grid-column:1 / -1}
.gv-form .gv-actions{display:flex;gap:8px;align-items:center;grid-column:1 / -1;flex-wrap:wrap}
.gv-checks{display:flex;gap:14px;flex-wrap:wrap;padding:4px 0}
.gv-checks label{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;color:var(--text-2);font-weight:540;margin:0}
.gv-checks input{width:auto}
.gv-note{font-size:12px;color:var(--text-3);margin-top:8px}
.gv-status{font-size:12.5px;min-height:18px;color:var(--good)}
.gv-status.err{color:var(--bad)}
.gv-risk{padding:10px 14px;border-left:2px solid var(--warn);background:var(--warn-dim);border-radius:var(--r-lg);
  font-size:12.5px;color:var(--text-2);margin-bottom:8px}
.gv-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;padding:16px 18px}
.gv-kpi{background:var(--bg);border:1px solid var(--line);border-radius:var(--r);padding:10px 12px}
.gv-kpi .n{font-size:19px;font-weight:640;font-variant-numeric:tabular-nums}
.gv-kpi .l{font-size:11px;color:var(--text-3);text-transform:uppercase;letter-spacing:.04em;margin-top:2px}
.gv-toggle{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--text-3);cursor:pointer}
.gv-empty{padding:14px 18px;color:var(--text-3);font-size:13px}
`;

const ICON_PLAY = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M2.5 8a5.5 5.5 0 1 1 11 0 5.5 5.5 0 0 1-11 0z"/>
  <path d="M6.75 5.9c0-.68.75-1.1 1.33-.74l2.57 1.63c.54.34.54 1.14 0 1.48l-2.57 1.63c-.58.36-1.33-.06-1.33-.74z" fill="currentColor" stroke="none"/>
</svg>`;

const ICON_PROMPT = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M3 2.5h6L12.5 6v7.5h-9.5z"/>
  <path d="M9 2.5V6h3.5"/>
  <path d="M5.4 9.2h5.2"/>
  <path d="M5.4 11.4h3.4"/>
</svg>`;

const ICON_DATA = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <ellipse cx="8" cy="3.2" rx="5.6" ry="1.8"/>
  <path d="M2.4 3.2v4.6c0 1 2.5 1.8 5.6 1.8s5.6-.8 5.6-1.8V3.2"/>
  <path d="M2.4 7.8v4.6c0 1 2.5 1.8 5.6 1.8s5.6-.8 5.6-1.8V7.8"/>
</svg>`;

const ICON_COST = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M8 11.5a2.6 2.6 0 0 0 2-3c-.3-2-2-2-2-4 0-.4.1-.6.2-.8"/>
  <path d="M8 15.5A6.5 6.5 0 0 0 11.5 3.5c.9 1.4 1.7 3.5 1.4 5.3A2.8 2.8 0 0 1 10 10.9"/>
  <path d="M8 11.5A2.6 2.6 0 0 0 6 8.5c.3-2 2-2 2-4 0 .5-.1.5 0 1.7"/>
  <path d="M4.5 3.5A6.5 6.5 0 0 0 8 15.5c-2.4 0-4.4-1-5.7-2.7"/>
  <path d="M3 2.5h10"/>
</svg>`;

const ICON_ANALYTICS = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M2.5 13.5h11"/>
  <path d="M4.5 13.5V8.8"/><path d="M7.5 13.5V4.5"/><path d="M10.5 13.5V7"/><path d="M13 13.5V6"/>
</svg>`;

const ICON_LIVE = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M1.5 8h3l2-4.5L9.5 12l2-4h3"/>
</svg>`;

const ICON_TRACE = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="4" cy="3.5" r="1.8"/><circle cx="12" cy="7" r="1.8"/><circle cx="5.5" cy="12.5" r="1.8"/>
  <path d="M5.3 5.2 10.5 6.2"/><path d="M10.9 8.6 6.9 11.2"/>
</svg>`;

const ICON_TEAM = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="6" cy="5.5" r="2.2"/>
  <path d="M2.5 13c.4-2.2 1.8-3.4 3.5-3.4S9.1 10.8 9.5 13"/>
  <path d="M10.6 3.9a2 2 0 0 1 0 3.4"/><path d="M11.5 9.9c1.3.3 2.1 1.4 2.4 3.1"/>
</svg>`;

const ICON_COMPLIANCE = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M4 1.8h6.2L13 4.6v9.6H4z"/><path d="M10 1.8v3h3"/>
  <path d="M6.2 9.2l1.4 1.4 2.6-2.8"/>
</svg>`;

const ICON_INSIGHTS = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M8 1.8v1.4"/><path d="M3.4 3.4 4.4 4.4"/><path d="M12.6 3.4 11.6 4.4"/>
  <path d="M5.2 11.2a4 4 0 1 1 5.6 0c-.5.5-.8 1-.8 1.6H6c0-.6-.3-1.1-.8-1.6Z"/>
  <path d="M6.6 14.2h2.8"/>
</svg>`;

const ICON_FOLDER = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M1.8 4.2h4l1.4 1.6h7v7.4a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z"/>
  <path d="M1.8 4.2V3.1a1 1 0 0 1 1-1h3.3l1.6 2.1"/>
</svg>`;

const ICON_TERMINAL = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="1.8" y="2.6" width="12.4" height="10.8" rx="1.6"/>
  <path d="M4.4 6.2 6.6 8l-2.2 1.8"/><path d="M8.4 10h3.2"/>
</svg>`;

const PROMPTS_STYLE = `
.ph-head{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}
.ph-head h1{font-size:22px;letter-spacing:-.03em;margin:0;font-weight:580}
.ph-list{display:flex;flex-direction:column;gap:10px}
.ph-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:14px 18px;background:var(--surface);
  border:1px solid var(--line);border-radius:var(--r-lg);transition:border-color .12s,background .12s}
.ph-row:hover{border-color:var(--accent-line);background:var(--surface-2)}
.ph-row-main{min-width:0}
.ph-row-title{display:flex;align-items:center;gap:10px;font-weight:640;font-size:14px;color:var(--text)}
.ph-desc{color:var(--text-2);font-size:13px;margin-top:3px}
.ph-tags{color:var(--text-3);font-size:12px;margin-top:5px}
.ph-row-meta{color:var(--text-3);font-size:12px;white-space:nowrap;padding-top:3px}
.ph-form{display:flex;flex-direction:column;gap:12px;max-width:640px}
.ph-form label{font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:6px;display:block}
.ph-form input,.ph-form textarea,.ph-form select{width:100%;background:var(--bg);border:1px solid var(--line-2);color:var(--text);
  border-radius:var(--r);padding:10px 12px;font-size:13.5px;font-family:inherit;outline:none}
.ph-form input:focus,.ph-form textarea:focus,.ph-form select:focus{border-color:var(--accent)}
.ph-form textarea{resize:vertical;min-height:150px;font-family:var(--mono);font-size:12.5px;line-height:1.6}
.ph-form input[type="text"]{font-family:var(--mono);font-size:12.5px}
.ph-msg{min-height:20px;font-size:13px;margin-top:10px}
.panel-body{padding:18px 22px}
.ph-msg.ok{color:var(--good)} .ph-msg.err{color:var(--bad)}
.ph-detail{display:grid;grid-template-columns:230px 1fr;gap:18px;align-items:start}
@media(max-width:860px){.ph-detail{grid-template-columns:1fr}}
.ph-side{display:flex;flex-direction:column;gap:6px;position:sticky;top:18px}
@media(max-width:860px){.ph-side{position:static}}
.ph-side h4{font-size:11.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-3);margin:4px 0 8px}
.ph-rev{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 12px;border:1px solid var(--line);
  border-radius:var(--r);background:var(--surface);color:var(--text-2);font-size:12.5px;text-align:left;cursor:pointer;transition:border-color .12s,background .12s}
.ph-rev:hover{border-color:var(--accent-line)}
.ph-rev.active{border-color:var(--page-accent-line,var(--accent-line));background:var(--page-accent-dim,var(--accent-dim));color:var(--text)}
.ph-rev .v{font-weight:640;color:var(--text)}
.ph-editor .panel-body{padding:18px 22px}
.ph-editor .panel-body input,.ph-editor .panel-body textarea{width:100%;background:var(--bg);border:1px solid var(--line-2);color:var(--text);
  border-radius:var(--r);padding:10px 12px;font-size:13px;font-family:inherit;outline:none}
.ph-editor .panel-body input:focus,.ph-editor .panel-body textarea:focus{border-color:var(--accent)}
.ph-editor .panel-body textarea{font-family:var(--mono);font-size:12.5px;line-height:1.6;resize:vertical}
.ph-editor .panel-body label{font-size:12px;font-weight:600;color:var(--text-2);margin:14px 0 6px;display:block}
.ph-preview{white-space:pre-wrap;word-break:break-word;font-family:var(--mono);font-size:12.5px;line-height:1.6;
  background:var(--bg);border:1px solid var(--line);border-radius:var(--r);padding:14px 16px;color:var(--text-2);max-height:300px;overflow:auto}
.ph-ref{display:flex;flex-direction:column;gap:10px}
.ph-ref code{white-space:pre-wrap;word-break:break-all;display:block;padding:12px 14px;line-height:1.6;font-size:12px;max-height:190px;overflow:auto}
.ph-meta{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:860px){.ph-meta{grid-template-columns:1fr}}`;

function promptTagsText(tags: string | null | undefined): string {
  if (!tags) return "";
  try {
    const parsed = JSON.parse(tags) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.keys(parsed as Record<string, unknown>).join(", ");
    }
  } catch {
    // non-object tags are ignored
  }
  return "";
}

function promptsListBody(prompts: Prompt[]): string {
  const rows = prompts.length
    ? prompts
        .map((p) => {
          const desc = p.description ? `<div class="ph-desc">${escapeHtml(p.description)}</div>` : "";
          const tagText = promptTagsText(p.tags);
          const tags = tagText ? `<div class="ph-tags">${escapeHtml(tagText)}</div>` : "";
          return `<a class="ph-row" href="/ui/prompts/${p.id}">
            <div class="ph-row-main">
              <div class="ph-row-title">${escapeHtml(p.name)} <span class="badge accent">v${p.latest_revision}</span></div>
              ${desc}${tags}
            </div>
            <div class="ph-row-meta">${shortDate(p.updated_at)}</div>
          </a>`;
        })
        .join("")
    : emptyState("No prompts yet", "Create your first prompt to keep versioned templates you can reference from the proxy.");
  return `<style>${PROMPTS_STYLE}</style>
  <div class="ph-head">
    <div><h1>Prompts</h1><p class="page-sub">Versioned templates you can inject into any /proxy request</p></div>
    <button class="btn btn-primary" id="newBtn">+ New prompt</button>
  </div>
  <div class="panel" id="createPanel" style="display:none">
    <div class="panel-head"><span class="panel-title">New prompt</span></div>
    <div class="panel-body"><div class="ph-form">
      <div>
        <label for="cf-name">Name</label>
        <input id="cf-name" type="text" placeholder="support-bot" autocomplete="off">
      </div>
      <div>
        <label for="cf-desc">Description</label>
        <input id="cf-desc" type="text" placeholder="Default system instructions for the support assistant" autocomplete="off">
      </div>
      <div>
        <label for="cf-tags">Tags</label>
        <input id="cf-tags" type="text" placeholder="product=assistant, lang=en" autocomplete="off">
      </div>
      <div>
        <label for="cf-template">Template (v1): use {{variable}} placeholders</label>
        <textarea id="cf-template" spellcheck="false" placeholder="You are the support assistant for Acme. Always answer in {{language}}."></textarea>
      </div>
      <div>
        <label for="cf-vars">Variables (optional, detected automatically)</label>
        <input id="cf-vars" type="text" placeholder="language, region" autocomplete="off">
      </div>
      <div>
        <label for="cf-model">Suggested model (optional)</label>
        <input id="cf-model" type="text" placeholder="gpt-4o-mini" autocomplete="off">
      </div>
      <div style="display:flex;gap:10px">
        <button class="btn btn-primary" id="cf-save">Create prompt</button>
        <button class="btn btn-ghost" id="cf-cancel">Cancel</button>
      </div>
      <div class="ph-msg" id="cf-msg"></div>
    </div></div>
  </div>
  <div class="ph-list">${rows}</div>
  <script>
  const newBtn=document.getElementById("newBtn"),createPanel=document.getElementById("createPanel");
  newBtn.onclick=()=>{createPanel.style.display=createPanel.style.display==="none"?"block":"none"};
  document.getElementById("cf-cancel").onclick=()=>{createPanel.style.display="none"};
  document.getElementById("cf-save").onclick=async()=>{
    const msg=document.getElementById("cf-msg");
    const tags={};
    document.getElementById("cf-tags").value.split(",").map(s=>s.trim()).filter(Boolean).forEach(k=>{
      const i=k.indexOf("="); if(i>0){tags[k.slice(0,i).trim()]=k.slice(i+1).trim();} else {tags[k]=k;}
    });
    const body={name:document.getElementById("cf-name").value.trim(),
      description:document.getElementById("cf-desc").value.trim(),
      template:document.getElementById("cf-template").value,
      variables:document.getElementById("cf-vars").value.split(",").map(s=>s.trim()).filter(Boolean),
      model:document.getElementById("cf-model").value.trim(),tags};
    if(!body.name||!body.template){msg.textContent="Name and template are required.";msg.className="ph-msg err";return;}
    msg.className="ph-msg";msg.textContent="Creating…";
    try{
      const res=await fetch("/api/prompts",{method:"POST",headers:{"content-type":"application/json",
        authorization:"Bearer "+(localStorage.getItem("torrix_key")||"")},body:JSON.stringify(body)});
      const j=await res.json();
      if(!res.ok){msg.textContent=j.error||"Failed";msg.className="ph-msg err";return;}
      location.href="/ui/prompts/"+j.prompt.id;
    }catch(e){msg.textContent=String(e);msg.className="ph-msg err";}
  };
  </script>`;
}

function promptDetailBody(prompt: Prompt, versions: PromptVersion[]): string {
  const activeRevision = prompt.active_revision ?? prompt.latest_revision;
  const revRows = versions.length
    ? versions
        .map((v) => {
          return `<button type="button" class="ph-rev" data-rev="${v.revision}">
            <span class="v">v${v.revision}</span>${v.revision === activeRevision ? '<span class="badge accent">active</span>' : ""}<span class="meta">${shortDate(v.created_at)}</span>
          </button>`;
        })
        .join("")
    : `<div class="panel-note" style="padding:4px 2px">No versions yet</div>`;
  const data = versions
    .map((v) => {
      let vars: string[] = [];
      try {
        const parsed = JSON.parse(v.variables ?? "[]") as unknown;
        if (Array.isArray(parsed)) vars = parsed.map(String);
      } catch {
        vars = [];
      }
      return JSON.stringify({
        revision: v.revision,
        text: v.template,
        variables: vars,
        model: v.model ?? "",
        note: v.note ?? "",
        created_at: v.created_at,
      });
    })
    .join(",");
  return `<style>${PROMPTS_STYLE}</style>
  ${backLink("/ui/prompts", "All prompts")}
  <div class="ph-head">
    <div>
      <h1>${escapeHtml(prompt.name)} <span class="badge accent">v${prompt.latest_revision}</span></h1>
      <p class="page-sub">${escapeHtml(prompt.description ?? "")}</p>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-ghost" id="refBtn" title="Copy the proxy reference header">${ICON_COPY} Copy reference</button>
      <button class="btn btn-ghost" id="delBtn" title="Delete this prompt">Delete</button>
    </div>
  </div>
  <div class="ph-detail">
    <div class="ph-side">
      <h4>Version history</h4>
      <div id="revList" style="display:flex;flex-direction:column;gap:6px">${revRows}</div>
      <div class="ph-ref panel" style="margin-top:14px">
        <div class="panel-head"><span class="panel-title">Reference</span></div>
        <div style="padding:12px 16px">
          <p class="set-hint">Point any /proxy call at this prompt. The latest version is used unless you pin one.</p>
          <code id="refCode">x-torrix-prompt: ${escapeHtml(prompt.name)}</code>
        </div>
      </div>
      <div class="panel" style="margin-top:14px" id="ph-stats">
        <div class="panel-head"><span class="panel-title">Run stats</span><span class="panel-note" id="ph-stats-note">loading…</span></div>
        <div style="padding:12px 16px" id="ph-stats-body"></div>
      </div>
    </div>
    <div class="ph-editor">
      <input type="hidden" id="pf-id" value="${prompt.id}">
      <div class="panel">
        <div class="panel-head"><span class="panel-title">Editor</span><span class="panel-note" id="revLabel">v1</span></div>
        <div class="panel-body">
          <div class="ph-meta">
            <div>
              <label for="pf-name">Name</label>
              <input id="pf-name" type="text" value="${escapeHtml(prompt.name)}" autocomplete="off" style="font-family:var(--mono)">
            </div>
            <div>
              <label for="pf-desc">Description</label>
              <input id="pf-desc" type="text" value="${escapeHtml(prompt.description ?? "")}" autocomplete="off">
            </div>
          </div>
          <div>
            <label for="pf-tags">Tags</label>
            <input id="pf-tags" type="text" value="${escapeHtml(promptTagsText(prompt.tags))}" autocomplete="off">
          </div>
          <div>
            <label for="pf-template">Template</label>
            <textarea id="pf-template" spellcheck="false" rows="10"></textarea>
          </div>
          <div style="display:flex;gap:10px;align-items:center">
            <button class="btn btn-ghost" id="pf-preview" type="button">Preview</button>
            <span class="panel-note" style="flex:1" id="pf-vars">Variables: -</span>
          </div>
          <div class="ph-preview" id="pf-preview-box" style="display:none;margin-top:10px"></div>
          <div class="ph-meta">
            <div>
              <label for="pf-model">Model hint</label>
              <input id="pf-model" type="text" placeholder="gpt-4o-mini" autocomplete="off">
            </div>
            <div>
              <label for="pf-note">Version note</label>
              <input id="pf-note" type="text" placeholder="Tightened tone, added language var" autocomplete="off">
            </div>
          </div>
          <div style="display:flex;gap:10px;align-items:center;margin-top:6px">
            <button class="btn btn-primary" id="pf-save" type="button">Save as new version</button>
            <button class="btn btn-ghost" id="pf-activate" type="button">Activate this version</button>
            <button class="btn btn-ghost" id="pf-meta" type="button">Save metadata</button>
          </div>
          <div class="ph-msg" id="pf-msg"></div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><span class="panel-title">Use from the proxy</span></div>
        <div class="panel-body">
          <p class="set-hint">Declare the template as the system message of any OpenAI-shaped request by passing a reference header. Variables come from a JSON header or the body field <code>prompt_vars</code>. Streamed and JSON replies both work.</p>
          <div class="ph-ref">
            <code>curl -X POST http://localhost:8088/proxy \\\\n  -H "x-target-url: https://api.openai.com/v1/chat/completions" \\\\n  -H "x-upstream-authorization: Bearer sk-..." \\\\n  -H "x-torrix-prompt: ${escapeHtml(prompt.name)}:1" \\\\n  -H "x-torrix-prompt-vars: {\\"language\\":\\"Spanish\\"}" \\\\n  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello"}]}'</code>
          </div>
        </div>
      </div>
    </div>
  </div>
  <script>
  const PF={name:${JSON.stringify(escapeHtml(prompt.name))},id:${JSON.stringify(prompt.id)},latest:${prompt.latest_revision},active:${activeRevision},
    versions:[${data}].map(v=>({...v,el:null})).sort((a,b)=>b.revision-a.revision)};
  const revList=document.getElementById("revList"),revLabel=document.getElementById("revLabel"),
    pfTemplate=document.getElementById("pf-template"),pfVars=document.getElementById("pf-vars"),
    pfModel=document.getElementById("pf-model"),pfNote=document.getElementById("pf-note"),
    pfMsg=document.getElementById("pf-msg"),prevBox=document.getElementById("pf-preview-box");
  let pinned=PF.versions.length&&PF.versions[0].revision||PF.latest,current=null;
  function load(rev){
    const v=PF.versions.find(x=>x.revision===rev); if(!v) return;
    current=v; pfTemplate.value=v.text; pfModel.value=v.model;
    pfVars.textContent="Variables: "+((v.variables&&v.variables.join(", "))||"-");
    revLabel.textContent="v"+v.revision;
    document.querySelectorAll(".ph-rev").forEach(b=>b.classList.toggle("active",Number(b.dataset.rev)===rev));
    document.getElementById("refCode").textContent="x-torrix-prompt: "+PF.name+(rev===PF.active?"":":"+rev);
  }
  revList.addEventListener("click",e=>{const b=e.target.closest(".ph-rev");if(b){load(Number(b.dataset.rev));pinned=Number(b.dataset.rev);}});
  document.getElementById("pf-preview").onclick=()=>{
    const text=pfTemplate.value.replace(/\\{\\{\\s*([a-zA-Z0-9_.-]+)\\s*\\}\\}/g,(m,v)=>"["+v+"]");
    prevBox.style.display="block";prevBox.textContent=text;
  };
  document.getElementById("pf-save").onclick=async()=>{
    const body={template:pfTemplate.value,note:pfNote.value.trim(),model:pfModel.value.trim()};
    if(!body.template){pfMsg.textContent="Template is required.";pfMsg.className="ph-msg err";return;}
    pfMsg.className="ph-msg";pfMsg.textContent="Saving…";
    try{
      const res=await fetch("/api/prompts/"+PF.id+"/versions",{method:"POST",
        headers:{"content-type":"application/json",authorization:"Bearer "+(localStorage.getItem("torrix_key")||"")},
        body:JSON.stringify(body)});
      const j=await res.json();
      if(!res.ok){pfMsg.textContent=j.error||"Failed";pfMsg.className="ph-msg err";return;}
      location.reload();
    }catch(err){pfMsg.textContent=String(err);pfMsg.className="ph-msg err";}
  };
  document.getElementById("pf-activate").onclick=async()=>{
    if(!current){pfMsg.textContent="Pick a version first.";pfMsg.className="ph-msg err";return;}
    pfMsg.className="ph-msg";pfMsg.textContent="Activating…";
    const res=await fetch("/api/prompts/"+PF.id+"/versions/"+current.revision+"/activate",{method:"PUT",
      headers:{authorization:"Bearer "+(localStorage.getItem("torrix_key")||"")}});
    const j=await res.json();
    if(res.ok){location.reload();}else{pfMsg.textContent=j.error||"Failed";pfMsg.className="ph-msg err";}
  };
  document.getElementById("pf-meta").onclick=async()=>{
    const name=document.getElementById("pf-name").value.trim();
    const tags={};
    document.getElementById("pf-tags").value.split(",").map(s=>s.trim()).filter(Boolean).forEach(k=>{
      const i=k.indexOf("=");if(i>0){tags[k.slice(0,i).trim()]=k.slice(i+1).trim();}else{tags[k]=k;}
    });
    const res=await fetch("/api/prompts/"+PF.id,{method:"PATCH",
      headers:{"content-type":"application/json",authorization:"Bearer "+(localStorage.getItem("torrix_key")||"")},
      body:JSON.stringify({name,description:document.getElementById("pf-desc").value.trim(),tags})});
    const j=await res.json();
    if(res.ok){location.reload();}else{pfMsg.textContent=j.error||"Failed";pfMsg.className="ph-msg err";}
  };
  document.getElementById("delBtn").onclick=async()=>{
    if(!confirm("Delete this prompt and all of its versions?")) return;
    const res=await fetch("/api/prompts/"+PF.id,{method:"DELETE",
      headers:{authorization:"Bearer "+(localStorage.getItem("torrix_key")||"")}});
    if(res.ok){location.href="/ui/prompts";}else{pfMsg.textContent="Delete failed";pfMsg.className="ph-msg err";}
  };
  document.getElementById("refBtn").onclick=()=>{
    const t=document.createElement("textarea");t.value="x-torrix-prompt: "+PF.name+(pinned===PF.latest?"":":"+pinned);
    document.body.appendChild(t);t.select();document.execCommand("copy");t.remove();
    document.getElementById("refBtn").textContent="Copied ✓";
    setTimeout(()=>{document.getElementById("refBtn").innerHTML='${ICON_COPY.replace(/\n\s*/g, " ")} Copy reference';},1400);
  };
  fetch("/api/prompts/"+PF.id+"/stats",{headers:{authorization:"Bearer "+(localStorage.getItem("torrix_key")||"")}}).then(r=>r.json()).then(j=>{
    const s=j.stats;if(!s)return;
    const note=document.getElementById("ph-stats-note"),box=document.getElementById("ph-stats-body");
    const usd=n=>"$"+Number(n||0).toFixed(4);
    note.textContent=s.runs+" run"+(s.runs===1?"":"s");
    const revRows=(s.revisions||[]).map(r=>'<tr><td style="padding:4px 8px 4px 0">v'+r.revision+(r.revision===s.active_revision?' <span class="badge accent">active</span>':'')+'</td><td style="padding:4px 8px;text-align:right">'+r.runs+'</td><td style="padding:4px 0 4px 8px;text-align:right;font-family:var(--mono)">'+usd(r.cost)+'</td><td style="padding:4px 0 4px 8px;text-align:right;font-family:var(--mono)">'+r.tokens.toLocaleString()+'</td></tr>').join("");
    box.innerHTML='<div style="font-size:13px;color:var(--text-2);margin-bottom:8px">'+s.runs+' runs · '+usd(s.cost)+' · '+s.tokens.toLocaleString()+' tokens · '+s.avgLatencyMs+' ms avg'+(s.avgScore!=null?' · avg score '+s.avgScore:'')+'</div>'+
      (revRows?'<table style="width:100%;border-collapse:collapse;font-size:12.5px;color:var(--text-2)"><thead><tr><th style="text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);padding:0 8px 6px 0">Revision</th><th style="text-align:right;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);padding:0 8px 6px">Runs</th><th style="text-align:right;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);padding:0 0 6px 8px">Cost</th><th style="text-align:right;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);padding:0 0 6px 8px">Tokens</th></tr></thead><tbody>'+revRows+'</tbody></table>':'<p class="panel-note">No runs reference this prompt yet.</p>');
  }).catch(()=>{document.getElementById("ph-stats-note").textContent="unavailable"});
  load(pinned);
  </script>`;
}

const DATASETS_STYLE = `
.ds-head{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}
.ds-head h1{font-size:22px;letter-spacing:-.03em;margin:0;font-weight:580}
.ds-list{display:flex;flex-direction:column;gap:10px}
.ds-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:15px 18px;background:var(--surface);
  border:1px solid var(--line);border-left:3px solid var(--page-accent-line,var(--line));border-radius:var(--r-lg);transition:border-color .12s,background .12s}
.ds-row:hover{border-color:var(--accent-line);background:var(--surface-2)}
.ds-row-main{min-width:0}
.ds-row-title{display:flex;align-items:center;gap:10px;font-weight:640;font-size:14px;color:var(--text)}
.ds-desc{color:var(--text-2);font-size:13px;margin-top:3px}
.ds-row-meta{color:var(--text-3);font-size:12px;white-space:nowrap;padding-top:3px;display:flex;align-items:center;gap:10px}
.ds-form{display:flex;flex-direction:column;gap:12px;max-width:640px}
.ds-form label{font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:6px;display:block}
.ds-form input,.ds-form textarea,.ds-form select{width:100%;background:var(--bg);border:1px solid var(--line-2);color:var(--text);
  border-radius:var(--r);padding:10px 12px;font-size:13.5px;font-family:inherit;outline:none}
.ds-form input:focus,.ds-form textarea:focus,.ds-form select:focus{border-color:var(--accent)}
.ds-form input[type="text"]{font-family:var(--mono);font-size:12.5px}
.ds-msg{min-height:20px;font-size:13px;margin-top:10px}
.ds-msg.ok{color:var(--good)} .ds-msg.err{color:var(--bad)}
.ds-table{width:100%;border-collapse:collapse;font-size:13px}
.ds-table th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--text-3);font-weight:600;padding:8px 10px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,var(--page-accent-dim,transparent),transparent 70%)}
.ds-table td{padding:10px;border-bottom:1px solid var(--line);vertical-align:top;color:var(--text-2)}
.ds-table tr:last-child td{border-bottom:0}
.ds-table .mono{font-family:var(--mono)}
.ds-eval-shell{display:flex;flex-direction:column;gap:8px}
.ds-step{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 18px;background:var(--surface);
  border:1px solid var(--line);border-left:3px solid var(--page-accent-line,var(--line));border-radius:var(--r-lg)}
.ds-step.pass{border-color:var(--good-line);background:var(--good-dim)}
.ds-step.fail{border-color:var(--bad-line);background:var(--bad-dim)}
.ds-step .ds-kind{display:flex;align-items:center;gap:9px;min-width:0}
.ds-step .ds-kind b{font-size:13.5px;font-weight:640;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ds-tags{display:flex;flex-wrap:wrap;gap:5px}
.ds-tag{font-family:var(--mono);font-size:11px;color:var(--text-3);border:1px solid var(--line);border-radius:4px;padding:1px 7px}
.ds-bar{height:5px;border-radius:3px;background:var(--track);overflow:hidden;border:1px solid var(--line)}
.ds-bar>span{display:block;height:100%;background:var(--accent-fill);transition:width .4s}
.mode-tabs{display:flex;gap:3px;background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r-lg);padding:3px;margin-bottom:16px;max-width:380px}
.mode-tabs button{flex:1;background:transparent;border:0;color:var(--text-3);padding:8px 10px;font-family:var(--display);font-size:12.5px;font-weight:600;border-radius:4px;transition:background .12s,color .12s;cursor:pointer}
.mode-tabs button.active{background:var(--surface);color:var(--text);box-shadow:var(--shadow-sm)}
.mode-tabs button:disabled{opacity:.5;cursor:not-allowed}
.ds-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:860px){.ds-grid{grid-template-columns:1fr}}`;

function datasetTags(tags: string | null | undefined): string[] {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // ignored
  }
  return [];
}

function evalStatusBadge(status: string): string {
  if (status === "done") return '<span class="badge good"><span class="dot"></span>done</span>';
  if (status === "failed") return '<span class="badge bad"><span class="dot"></span>failed</span>';
  return '<span class="badge warn"><span class="dot"></span>running</span>';
}

interface EvalWithDataset {
  eval: Eval;
  dataset_name: string;
}

function datasetsListBody(
  datasets: (Dataset & { rows: number })[],
  evals: EvalWithDataset[],
  maxDatasets: number,
  goldenRuns: Run[] = [],
  judgeCard = "",
): string {
  const list = datasets.length
    ? datasets
        .map(
          (d) => `<a class="ds-row" href="/ui/datasets/${d.id}">
            <div class="ds-row-main">
              <div class="ds-row-title">${escapeHtml(d.name)} <span class="badge accent">${d.rows} rows</span></div>
              ${d.description ? `<div class="ds-desc">${escapeHtml(d.description)}</div>` : ""}
            </div>
            <div class="ds-row-meta">${shortDate(d.updated_at)}</div>
          </a>`,
        )
        .join("")
    : emptyState("No datasets yet", "Build a dataset of prompt / golden-answer pairs, then judge captured runs against them offline, or run live batch evaluations.");
  const capNote = Number.isFinite(maxDatasets) ? ` · max ${maxDatasets}` : "";
  const evalRows = evals.length
    ? evals
        .map(
          ({ eval: e, dataset_name }) => `<div class="ds-step">
            <div class="ds-kind">
              ${evalStatusBadge(e.status)}
              <b>${escapeHtml(dataset_name)}</b>
              <span style="color:var(--text-3);font-size:12.5px">${e.mode} · ${escapeHtml(e.model || e.provider)}</span>
            </div>
            <div style="display:flex;align-items:center;gap:14px;color:var(--text-3);font-size:12.5px">
              <span>${e.passed}/${e.total_rows} passed</span>
              <span>${shortDate(e.created_at)}</span>
            </div>
          </div>`,
        )
        .join("")
    : `<p class="panel-note" style="margin:0">Nothing evaluated yet.</p>`;
  return `<style>${DATASETS_STYLE}</style>
  <div class="ds-head">
    <div><h1>Datasets &amp; Evals</h1><p class="page-sub">Golden-input sets, judged against your captured runs or live providers</p></div>
    <button class="btn btn-primary" id="newDsBtn">+ New dataset</button>
  </div>
  <div class="panel" id="dsCreate" style="display:none">
    <div class="panel-head"><span class="panel-title">New dataset</span></div>
    <div class="panel-body"><div class="ds-form">
      <div>
        <label for="ds-name">Name</label>
        <input id="ds-name" type="text" placeholder="customer-support-set" autocomplete="off">
      </div>
      <div>
        <label for="ds-desc">Description</label>
        <input id="ds-desc" type="text" placeholder="Golden inputs for the support assistant" autocomplete="off">
      </div>
      <div style="display:flex;gap:10px">
        <button class="btn btn-primary" id="ds-save">Create dataset</button>
        <button class="btn btn-ghost" id="ds-cancel">Cancel</button>
      </div>
      <div class="ds-msg" id="ds-msg"></div>
    </div></div>
  </div>
  <div class="ds-list">${list}</div>
  ${judgeCard || lockedPanel("judge")}
  <div class="panel" style="margin-top:22px">
    <div class="panel-head"><span class="panel-title">Recent evaluations</span><span class="panel-note">across all datasets</span></div>
    <div style="padding:14px 18px 18px"><div class="ds-eval-shell">${evalRows}</div></div>
  </div>
  <div class="panel" style="margin-top:22px">
    <div class="panel-head"><span class="panel-title">Golden runs</span><span class="panel-note">${goldenRuns.length} most recent · exempt from retention and exportable for fine-tuning</span></div>
    <div style="padding:14px 18px 18px">
      ${
        goldenRuns.length
          ? `<table class="ds-table"><thead><tr><th>Run</th><th>Model</th><th class="num">Score</th><th class="num">Cost</th></tr></thead><tbody>${goldenRuns
              .map(
                (run) =>
                  `<tr><td><a href="/ui/runs/${encodeURIComponent(run.id)}">${escapeHtml(truncate(run.name ?? run.id, 48))}</a></td><td class="mono">${escapeHtml(run.model ?? "-")}</td><td class="num">${run.score == null ? "-" : run.score >= 1 ? "good" : "bad"}</td><td class="num">${fmtUsd(run.cost_usd)}</td></tr>`,
              )
              .join("")}</tbody></table>`
          : `<p class="panel-note" style="margin:0">Mark a run golden from its detail page to build fine-tune data.</p>`
      }
      <div style="margin-top:10px"><button class="btn btn-ghost" id="dsGoldenExport" type="button">Export fine-tune JSONL</button><span class="ds-msg" id="dsGoldenMsg"></span></div>
    </div>
  </div>
  <script>
  const newDsBtn=document.getElementById("newDsBtn"),dsCreate=document.getElementById("dsCreate");
  newDsBtn.onclick=()=>{dsCreate.style.display=dsCreate.style.display==="none"?"block":"none"};
  document.getElementById("ds-cancel").onclick=()=>{dsCreate.style.display="none"};
  document.getElementById("ds-save").onclick=async()=>{
    const name=document.getElementById("ds-name").value.trim();
    const description=document.getElementById("ds-desc").value.trim();
    const msg=document.getElementById("ds-msg");
    if(!name){msg.textContent="Name is required.";msg.className="ds-msg err";return;}
    msg.className="ds-msg";msg.textContent="Creating…";
    try{
      const res=await fetch("/api/datasets",{method:"POST",headers:{"content-type":"application/json",
        authorization:"Bearer "+(localStorage.getItem("torrix_key")||"")},body:JSON.stringify({name,description})});
      const j=await res.json();
      if(!res.ok){msg.textContent=j.error||"Failed";msg.className="ds-msg err";return;}
      location.href="/ui/datasets/"+j.dataset.id;
    }catch(err){msg.textContent=String(err);msg.className="ds-msg err";}
  };
  document.getElementById("dsGoldenExport").onclick=async()=>{
    const gm=document.getElementById("dsGoldenMsg");
    const res=await fetch("/api/runs/golden/export",{headers:{authorization:"Bearer "+(localStorage.getItem("torrix_key")||"")}});
    if(!res.ok){const j=await res.json().catch(()=>({}));gm.textContent=j.error||"export failed";gm.className="ds-msg err";return;}
    const blob=await res.blob();
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="torrix-golden.jsonl";
    document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(a.href);
    gm.textContent="Exported.";gm.className="ds-msg ok";
  };
  </script>`;
}

function datasetDetailBody(
  dataset: Dataset,
  rows: DatasetRow[],
  evals: Eval[],
  resultsByEval: Map<string, number>,
  flags: { onlineEvals: boolean; maxDatasetRows: number },
): string {
  const rowRows = rows
    .map(
      (r, i) => `<tr data-row="${r.id}">
        <td class="mono" style="color:var(--text-3)">${i + 1}</td>
        <td>${escapeHtml(truncate(r.input, 160))}</td>
        <td class="mono">${r.expected ? escapeHtml(truncate(r.expected, 90)) : ""}</td>
        <td><div class="ds-tags">${datasetTags(r.tags).map((t) => `<span class="ds-tag">${escapeHtml(t)}</span>`).join("")}</div></td>
        <td style="white-space:nowrap"><button class="btn btn-ghost" data-edit="${r.id}" data-input="${escapeHtml(truncate(r.input, 400))}" data-expected="${escapeHtml(truncate(r.expected ?? "", 400))}" data-tags="${escapeHtml(datasetTags(r.tags).join(","))}" title="Edit row">Edit</button> <button class="btn btn-ghost btn-icon" data-del="${r.id}" title="Delete row">✕</button></td>
      </tr>`,
    )
    .join("");
  const rowTable = rows.length
    ? `<table class="ds-table"><thead><tr><th>#</th><th>Input</th><th>Golden answer</th><th>Tags</th><th></th></tr></thead><tbody>${rowRows}</tbody></table>`
    : `<p class="panel-note" style="margin:0">No rows yet: add prompt / golden-answer pairs below.</p>`;
  const evalSteps = evals
    .map((e) => {
      const passRate = e.total_rows ? Math.round((100 * e.passed) / e.total_rows) : 0;
      return `<div class="ds-step ${e.status === "done" && passRate >= 70 ? "pass" : e.status === "failed" ? "fail" : ""}">
        <div class="ds-kind">
          ${evalStatusBadge(e.status)}
          <b>${e.mode}${e.model ? " · " + escapeHtml(e.model) : ""}</b>
          <span style="color:var(--text-3);font-size:12.5px">${e.scorer} scorer</span>
        </div>
        <div style="display:flex;align-items:center;gap:16px;color:var(--text-3);font-size:12.5px;min-width:0">
          ${e.status === "running" ? `<div class="ds-bar" style="width:94px"><span style="width:${e.total_rows ? Math.round((100 * e.rows_done) / e.total_rows) : 0}%"></span></div>` : ""}
          <span>${e.passed}/${e.total_rows} passed · ${passRate}%</span>
          <a href="/ui/runs?eval=${e.id}" style="display:none"></a>
          <span>${shortDate(e.created_at)}</span>
        </div>
      </div>`;
    })
    .join("") || `<p class="panel-note" style="margin:0">Run your first evaluation above.</p>`;
  const onlineDisabled = flags.onlineEvals ? "" : "disabled title='Online evals require pro or enterprise'";
  const rowCap = Number.isFinite(flags.maxDatasetRows) ? ` · max ${flags.maxDatasetRows} rows` : "";
  return `<style>${DATASETS_STYLE}</style>
  ${backLink("/ui/datasets", "All datasets")}
  <div class="ds-head">
    <div>
      <h1>${escapeHtml(dataset.name ?? "")}</h1>
      <p class="page-sub">${escapeHtml(dataset.description ?? "No description")}</p>
    </div>
    <button class="btn btn-ghost" id="dsDelBtn" title="Delete this dataset">Delete</button>
  </div>

  <div class="panel">
    <div class="panel-head"><span class="panel-title">Rows</span><span class="panel-note">${rows.length}${rowCap}</span></div>
    <div class="panel-body">
      <div class="ds-form" style="flex-direction:row;flex-wrap:wrap;gap:10px;max-width:none">
        <div style="flex:2 1 320px"><label for="r-input">Prompt input</label><input id="r-input" type="text" placeholder="How do I reset my password?" autocomplete="off"></div>
        <div style="flex:2 1 320px"><label for="r-expected">Golden answer</label><input id="r-expected" type="text" placeholder="You can reset it in Settings > Security" autocomplete="off"></div>
        <div style="flex:1 1 180px"><label for="r-tags">Tags</label><input id="r-tags" type="text" placeholder="intent=password" autocomplete="off"></div>
        <div style="display:flex;align-items:flex-end"><button class="btn btn-primary" id="r-add">Add row</button></div>
      </div>
      <div class="ds-msg" id="r-msg"></div>
      <div style="overflow:auto">${rowTable}</div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-head"><span class="panel-title">Import rows</span><span class="panel-note">CSV columns: input, expected, tags (pipe-separated) · or a JSON array</span></div>
    <div class="panel-body">
      <div class="ds-form">
        <div><label for="ds-import">Paste CSV or JSON</label><textarea id="ds-import" rows="4" style="font-family:var(--mono);font-size:12.5px" placeholder='input,expected,tags
"How do I reset my password?","Settings > Security",password'></textarea></div>
        <div style="display:flex;align-items:center;gap:10px"><button class="btn btn-primary" id="ds-import-btn">Import</button><span class="ds-msg" id="ds-import-msg"></span></div>
      </div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-head"><span class="panel-title">Run evaluation</span><span class="panel-note">offline judges captured runs · online calls a live provider</span></div>
    <div class="panel-body">
      <div class="mode-tabs">
        <button type="button" class="active" id="tab-off" onclick="switchMode('offline')">Offline</button>
        <button type="button" id="tab-on" onclick="switchMode('online')" ${onlineDisabled}>Online (pro)</button>
      </div>
      <div class="ds-form" style="max-width:none">
        <div class="ds-grid">
          <div>
            <label for="e-scorer">Scorer</label>
            <select id="e-scorer">
              <option value="exact">exact: response equals golden answer</option>
              <option value="contains">contains: response includes golden answer</option>
            </select>
          </div>
          <div id="e-provider-field" style="display:none">
            <label for="e-provider">Provider</label>
            <input id="e-provider" type="text" placeholder="openai" autocomplete="off">
          </div>
          <div id="e-model-field" style="display:none">
            <label for="e-model">Model</label>
            <input id="e-model" type="text" placeholder="gpt-4o-mini" autocomplete="off">
          </div>
          <div id="e-url-field" style="display:none">
            <label for="e-url">Chat completions endpoint</label>
            <input id="e-url" type="text" placeholder="https://api.openai.com/v1/chat/completions" autocomplete="off" style="font-family:var(--mono);font-size:12.5px">
          </div>
          <div id="e-key-field" style="display:none">
            <label for="e-key">Provider API key (never stored)</label>
            <input id="e-key" type="password" placeholder="sk-..." autocomplete="off">
          </div>
          <div id="e-temp-field" style="display:none">
            <label for="e-temp">Temperature</label>
            <input id="e-temp" type="number" step="0.1" min="0" max="2" value="0.2" autocomplete="off">
          </div>
          <div id="e-max-field" style="display:none">
            <label for="e-max">Max tokens</label>
            <input id="e-max" type="number" min="1" max="128000" value="512" autocomplete="off">
          </div>
        </div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button class="btn btn-primary" id="e-run">Start evaluation</button>
          <span class="panel-note" id="e-hint">Offline mode judges runs already captured by Torrix: each row is matched to a run by its prompt, then scored against the golden answer.</span>
        </div>
        <div class="ds-msg" id="e-msg"></div>
        <div id="e-status"></div>
      </div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-head"><span class="panel-title">Evaluations</span><span class="panel-note">${evals.length} total</span></div>
    <div style="padding:14px 18px 18px"><div class="ds-eval-shell">${evalSteps}</div></div>
  </div>
  <script>
  const DS={id:${JSON.stringify(dataset.id)},name:${JSON.stringify(escapeHtml(dataset.name ?? ""))}};
  let evalsRunning=[];
  function switchMode(mode){
    const offline=mode==="offline";
    document.getElementById("tab-off").classList.toggle("active",offline);
    document.getElementById("tab-on").classList.toggle("active",!offline);
    const on=!offline;
    ["e-provider-field","e-model-field","e-url-field","e-key-field","e-temp-field","e-max-field"].forEach(id=>{
      document.getElementById(id).style.display=on?"block":"none";
    });
    document.getElementById("e-hint").textContent=on
      ? "Online mode sends each row to the endpoint and logs a run per row (source=eval). On community edition this requires pro or enterprise."
      : "Offline mode judges runs already captured by Torrix: each row is matched to a run by its prompt, then scored against the golden answer.";
  }
  const msg=document.getElementById("e-msg");
  document.getElementById("r-add").onclick=async()=>{
    const tags=document.getElementById("r-tags").value.split(",").map(s=>s.trim()).filter(Boolean);
    const body={input:document.getElementById("r-input").value.trim(),
      expected:document.getElementById("r-expected").value.trim(),tags};
    if(!body.input){msg.textContent="Input is required.";msg.className="ds-msg err";return;}
    msg.className="ds-msg";msg.textContent="Adding…";
    const res=await fetch("/api/datasets/"+DS.id+"/rows",{method:"POST",
      headers:{"content-type":"application/json",authorization:"Bearer "+(localStorage.getItem("torrix_key")||"")},
      body:JSON.stringify(body)});
    const j=await res.json();
    if(!res.ok){msg.textContent=j.error||"Failed";msg.className="ds-msg err";return;}
    location.reload();
  };
  document.querySelectorAll("[data-del]").forEach(btn=>{
    btn.onclick=async()=>{
      const res=await fetch("/api/dataset-rows/"+btn.dataset.del,{method:"DELETE",
        headers:{authorization:"Bearer "+(localStorage.getItem("torrix_key")||"")}});
      if(res.ok){location.reload();}else{msg.textContent="Delete failed";msg.className="ds-msg err";}
    };
  });
  document.querySelectorAll("[data-edit]").forEach(btn=>{
    btn.onclick=async()=>{
      const input=prompt("Prompt input",btn.dataset.input||"");
      if(input===null)return;
      const expected=prompt("Golden answer",btn.dataset.expected||"");
      if(expected===null)return;
      const tags=prompt("Tags (comma separated)",btn.dataset.tags||"");
      if(tags===null)return;
      msg.className="ds-msg";msg.textContent="Saving…";
      const res=await fetch("/api/dataset-rows/"+btn.dataset.edit,{method:"PUT",
        headers:{"content-type":"application/json",authorization:"Bearer "+(localStorage.getItem("torrix_key")||"")},
        body:JSON.stringify({input:input.trim(),expected:expected.trim(),tags:tags.split(",").map(s=>s.trim()).filter(Boolean)})});
      const j=await res.json();
      if(!res.ok){msg.textContent=j.error||"Save failed";msg.className="ds-msg err";return;}
      location.reload();
    };
  });
  const importMsg=document.getElementById("ds-import-msg");
  document.getElementById("ds-import-btn").onclick=async()=>{
    const text=document.getElementById("ds-import").value.trim();
    if(!text){importMsg.textContent="Paste rows first.";importMsg.className="ds-msg err";return;}
    let contentType="text/csv";let payload=text;
    try{
      const parsed=JSON.parse(text);
      const rows=Array.isArray(parsed)?parsed:(Array.isArray(parsed.rows)?parsed.rows:[]);
      if(!rows.length)throw new Error("empty");
      contentType="application/json";payload=JSON.stringify({rows});
    }catch(e){}
    importMsg.className="ds-msg";importMsg.textContent="Importing…";
    const res=await fetch("/api/datasets/"+DS.id+"/rows/import",{method:"POST",
      headers:{"content-type":contentType,authorization:"Bearer "+(localStorage.getItem("torrix_key")||"")},
      body:payload});
    const j=await res.json();
    if(!res.ok){importMsg.textContent=j.error||"Import failed";importMsg.className="ds-msg err";return;}
    importMsg.className="ds-msg";importMsg.textContent="Imported "+j.imported+" row(s).";
    setTimeout(()=>location.reload(),600);
  };
  document.getElementById("dsDelBtn").onclick=async()=>{
    if(!confirm("Delete this dataset, its rows and evaluations?")) return;
    const res=await fetch("/api/datasets/"+DS.id,{method:"DELETE",
      headers:{authorization:"Bearer "+(localStorage.getItem("torrix_key")||"")}});
    if(res.ok){location.href="/ui/datasets";}
  };
  document.getElementById("e-run").onclick=async()=>{
    const offline=document.getElementById("tab-off").classList.contains("active");
    const body={mode:offline?"offline":"online",
      scorer:document.getElementById("e-scorer").value,
      provider:offline?undefined:document.getElementById("e-provider").value.trim(),
      model:offline?undefined:document.getElementById("e-model").value.trim(),
      target_url:offline?undefined:document.getElementById("e-url").value.trim(),
      api_key:offline?undefined:document.getElementById("e-key").value.trim(),
      temperature:offline?undefined:parseFloat(document.getElementById("e-temp").value),
      max_tokens:offline?undefined:parseInt(document.getElementById("e-max").value,10)};
    msg.className="ds-msg";msg.textContent="Starting…";
    try{
      const res=await fetch("/api/datasets/"+DS.id+"/evaluations",{method:"POST",
        headers:{"content-type":"application/json",authorization:"Bearer "+(localStorage.getItem("torrix_key")||"")},
        body:JSON.stringify(body)});
      const j=await res.json();
      if(!res.ok){msg.textContent=j.error||"Failed";msg.className="ds-msg err";return;}
      msg.className="ds-msg";msg.textContent="Evaluation started.";
      pollEval(j.eval.id);
    }catch(err){msg.textContent=String(err);msg.className="ds-msg err";}
  };
  function pollEval(evalId){
    const box=document.getElementById("e-status");
    const renderEval=(e,results)=>{
      const pct=e.total_rows?Math.round(100*e.passed/e.total_rows):0;
      const pctDone=e.total_rows?Math.round(100*e.rows_done/e.total_rows):0;
      const rowsHtml=(results||[]).map((r,i)=>{
        const badge=r.score>=1?'<span class="badge good"><span class="dot"></span>PASS</span>':'<span class="badge bad"><span class="dot"></span>FAIL</span>';
        const link=r.run_id?'<a href="/ui/runs/'+r.run_id+'">view run</a>':"";
        const note=r.score_note||r.error||"";
        return '<tr><td class="mono" style="color:var(--text-3)">'+(i+1)+'</td><td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc((r.text||""))+"</td><td>"+badge+"</td><td>"+esc(note)+"</td><td>"+link+"</td></tr>";
      }).join("");
      box.innerHTML='<div class="panel" style="margin:16px 0 0;border-color:var(--accent-line)"><div class="panel-head"><span class="panel-title">'+esc(DS.name)+' · '+(e.status==="running"?"running… "+pctDone+"%":"results")+'</span><span class="panel-note">'+e.passed+" "+e.total_rows+" · cost "+fmtMoney(e.cost_usd)+" · "+fmtTokens(e.tokens_total)+' tokens</span></div><div class="panel-body">'+
        '<div class="ds-bar" style="margin:2px 0 12px;max-width:420px"><span style="width:'+pctDone+'%"></span></div>'+
        '<table class="ds-table"><thead><tr><th>#</th><th>Input</th><th>Score</th><th>Note</th><th></th></tr></thead><tbody>'+(rowsHtml||'<tr><td colspan="5">No results yet.</td></tr>')+'</tbody></table></div></div>';
      if(e.status==="running"){setTimeout(()=>fetchEval(e.id),5000);}
    };
    const fetchEval=(id)=>{
      fetch("/api/evals/"+id,{headers:{authorization:"Bearer "+(localStorage.getItem("torrix_key")||"")}})
        .then(r=>r.json())
        .then(j=>renderEval(j.eval,(j.results||[]).map(res=>({text:res.input_hint,score:res.score,score_note:res.score_note,run_id:res.run_id,error:res.error}))))
        .catch(()=>setTimeout(()=>fetchEval(id),3000));
    };
    fetchEval(evalId);
    try{
      const streamRes=fetch("/api/evals/"+evalId+"/stream",{headers:{authorization:"Bearer "+(localStorage.getItem("torrix_key")||"")}});
      streamRes.then(function(res){
        if(!res.ok||!res.body)return;
        const reader=res.body.getReader();const dec=new TextDecoder();let buf="";
        const pump=function(){
          reader.read().then(function(step){
            if(step.done)return;
            buf+=dec.decode(step.value,{stream:true});
            let idx;
      while((idx=buf.indexOf("\\n\\n"))!==-1){
        const chunk=buf.slice(0,idx);buf=buf.slice(idx+2);
        const lines=chunk.split("\\n");
              for(let i=0;i<lines.length;i++){
                if(lines[i].indexOf("data:")!==0)continue;
                try{
                  const msg=JSON.parse(lines[i].slice(5).trim());
                  if(msg.eval&&msg.eval.id===evalId)fetchEval(evalId);
                  if(msg.eval&&msg.eval.status!=="running")return;
                }catch(e){}
              }
            }
            pump();
          }).catch(function(){});
        };
        pump();
      }).catch(function(){});
    }catch(e){}
    box.scrollIntoView({behavior:"smooth",block:"center"});
  }
  function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
  function fmtMoney(n){return "$"+(Number(n||0).toFixed(6))}
  function fmtTokens(n){return Number(n||0)>999?(Number(n||0)/1000).toFixed(1)+"k":String(n||0)}
  switchMode("offline");
  </script>`;
}

interface CostPageData {
  settings: AlertSettings;
  since: string;
  userSpend: number;
  projects: Project[];
  keys: ApiKey[];
  prices: PricingOverride[];
  projectSpend: Record<string, number>;
  keySpend: Record<string, number>;
  selected: Project | null;
  selectedStats: DashboardStats | null;
}

const COST_STYLE = `
.co-scope{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:14px 0 0}
.co-scope label{font-size:11.5px;font-weight:600;color:var(--text-2);text-transform:uppercase;letter-spacing:.04em}
.co-scope select{background:var(--surface);border:1px solid var(--line);color:var(--text);border-radius:var(--r);padding:7px 10px;font-size:13px;font-family:inherit;min-width:200px}
.co-head{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}
.co-head h1{font-size:22px;letter-spacing:-.03em;margin:0;font-weight:580}
.co-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:20px 0}
.co-card{background:var(--surface);border:1px solid var(--line);border-top:2px solid var(--page-accent,var(--accent));border-radius:var(--r-lg);padding:16px 18px}
.co-card label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-3);font-weight:600}
.co-card b{display:block;font-size:20px;font-weight:620;margin-top:6px;letter-spacing:-.02em}
.co-card .sub{font-size:12.5px;color:var(--text-3);margin-top:4px}
.co-bar{height:5px;border-radius:3px;background:var(--track);overflow:hidden;border:1px solid var(--line);margin-top:12px}
.co-bar>span{display:block;height:100%;background:linear-gradient(90deg,var(--accent-deep),var(--accent))}
.co-bar>span.hot{background:linear-gradient(90deg,#f59e0b,#ef4444)}
.co-form{display:flex;flex-direction:column;gap:14px;max-width:640px}
.co-form label{font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:6px;display:block}
.co-form input,.co-form select{width:100%;background:var(--bg);border:1px solid var(--line-2);color:var(--text);border-radius:var(--r);padding:10px 12px;font-size:13.5px;font-family:inherit;outline:none}
.co-form input:focus,.co-form select:focus{border-color:var(--accent)}
.co-form input[type="text"]{font-family:var(--mono);font-size:12.5px}
.co-msg{min-height:20px;font-size:13px;margin-top:12px}
.co-msg.ok{color:var(--good)} .co-msg.err{color:var(--bad)}
.co-grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:860px){.co-grid2{grid-template-columns:1fr}}
.co-switch{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--text-2)}
.co-switch input{width:auto}
.co-usage{width:100%;border-collapse:collapse;font-size:13px}
.co-usage th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--text-3);font-weight:600;padding:8px 10px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,var(--page-accent-dim,transparent),transparent 70%)}
.co-usage td{padding:10px;border-bottom:1px solid var(--line);vertical-align:middle;color:var(--text-2)}
.co-usage tr:last-child td{border-bottom:0}
.co-usage .mono{font-family:var(--mono)}
.co-usage input{width:110px;background:var(--bg);border:1px solid var(--line-2);color:var(--text);border-radius:var(--r);padding:7px 9px;font-size:12.5px;font-family:var(--mono);outline:none}
.co-usage input:focus{border-color:var(--accent)}
.co-usage select{background:var(--bg);border:1px solid var(--line-2);color:var(--text);border-radius:var(--r);padding:6px 8px;font-size:12px;font-family:var(--mono);outline:none}
.co-usage select:focus{border-color:var(--accent)}
.co-badge{display:inline-flex;align-items:center;gap:6px;font-size:10.5px;font-weight:580;padding:2px 8px;border-radius:4px;border:1px solid var(--line)}
.co-badge.ok{color:var(--good);border-color:var(--good-line);background:var(--good-dim)}
.co-badge.off{color:var(--text-3)}`;

function costPageBody(data: CostPageData): string {
  const { settings } = data;
  const fmt = (n: number | null | undefined): string => (n == null ? "-" : `$${Number(n).toFixed(2)}`);
  const barPct = (spend: number, cap: number | null | undefined): number => (cap && cap > 0 ? Math.min(100, Math.round((100 * spend) / cap)) : 0);
  const spendingClass = (spend: number, cap: number | null | undefined): string => (cap && cap > 0 && spend >= cap ? "hot" : "");
  const statusBadge = settings.enabled ? '<span class="co-badge ok"><span class="dot"></span>enabled</span>' : '<span class="co-badge off">disabled</span>';
  const channelLabels: string[] = [];
  if (settings.webhook_url) channelLabels.push("webhook");
  if (settings.pagerduty_routing_key) channelLabels.push("PagerDuty");
  if (settings.email_webhook_url && (settings.email_recipients ?? "").trim()) channelLabels.push("email");
  const channelSummary = channelLabels.length ? channelLabels.join(" + ") : "no channels configured";

  const selected = data.selected;
  const selectedSpend = selected ? data.projectSpend[selected.id] ?? 0 : 0;
  const scopedKeyRows = selected
    ? data.keys
        .filter((key) => {
          const scope = safeJsonArray(key.projects).map((value) => String(value));
          return scope.length === 0 || scope.includes(selected.id);
        })
        .map((key) => usageRow("api_key", key.id, escapeHtml(key.name), data.keySpend[key.id] ?? 0, key.budget_usd ?? null, key.hard_cap_usd ?? null))
    : [];
  const usageRows = selected
    ? [
        usageRow("project", selected.id, escapeHtml(selected.name), selectedSpend, selected.budget_usd ?? null, selected.hard_cap_usd ?? null, selected.prompt_compression ?? "off", selected.compression_words ?? ""),
        ...scopedKeyRows,
      ].join("")
    : [
        usageRow("user", null, "Account (all projects)", data.userSpend, settings.budget_usd, settings.hard_cap_usd),
        ...data.projects.map((p) => usageRow("project", p.id, escapeHtml(p.name), data.projectSpend[p.id] ?? 0, p.budget_usd ?? null, p.hard_cap_usd ?? null, p.prompt_compression ?? "off", p.compression_words ?? "")),
        ...data.keys.map((k) => usageRow("api_key", k.id, escapeHtml(k.name), data.keySpend[k.id] ?? 0, k.budget_usd ?? null, k.hard_cap_usd ?? null)),
      ].join("");
  const scopeBar = `<div class="co-scope">
    <label for="co-project">View</label>
    <select id="co-project" onchange="if(this.value)location.href=this.value">
      <option value="/ui/cost"${selected ? "" : " selected"}>All projects</option>
      ${data.projects.map((p) => `<option value="/ui/cost?project=${encodeURIComponent(p.id)}"${selected?.id === p.id ? " selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
    </select>
    <span class="panel-note">${selected ? `scoped to ${escapeHtml(selected.name)}: month spend, limits and keys for this project` : "every project on this account in one table"}</span>
  </div>`;

  const priceRows = data.prices
    .map(
      (p) => `<tr data-price="${escapeHtml(p.model)}">
        <td class="mono">${escapeHtml(p.model)}</td>
        <td class="mono">$${p.input}/1M in · $${p.output}/1M out</td>
        <td style="text-align:right"><button class="btn btn-ghost btn-icon" data-del-price="${escapeHtml(p.model)}" title="Remove override">✕</button></td>
      </tr>`,
    )
    .join("");

  return `<style>${COST_STYLE}</style>
  <div class="co-head">
    <div><h1>Cost &amp; Alerts</h1><p class="page-sub">Budgets, hard caps, alert channels and custom pricing: month shown starts at UTC month start</p></div>
    <button class="btn btn-ghost" id="digBtn">Send weekly digest now</button>
  </div>
  ${scopeBar}

  <div class="co-cards" style="margin-top:14px">
    <div class="co-card"><label>Monthly spend</label><b class="tnum">${fmt(selected ? selectedSpend : data.userSpend)}</b><div class="sub">${selected ? `in ${escapeHtml(selected.name)}${data.selectedStats ? ` · ${data.selectedStats.totalRuns.toLocaleString()} run${data.selectedStats.totalRuns === 1 ? "" : "s"}` : ""}` : "across all projects"}</div></div>
    <div class="co-card"><label>Budget</label><b class="tnum">${fmt(selected ? selected.budget_usd ?? null : settings.budget_usd)}</b>
      <div class="co-bar"><span class="${spendingClass(selected ? selectedSpend : data.userSpend, selected ? selected.budget_usd ?? null : settings.budget_usd)}" style="width:${barPct(selected ? selectedSpend : data.userSpend, selected ? selected.budget_usd ?? null : settings.budget_usd)}%"></span></div>
      <div class="sub">${selected ? "project budget" : "alerts fire at 50 / 80 / 100%"}</div></div>
    <div class="co-card"><label>Hard cap</label><b class="tnum">${fmt(selected ? selected.hard_cap_usd ?? null : settings.hard_cap_usd)}</b>
      <div class="co-bar"><span class="${spendingClass(selected ? selectedSpend : data.userSpend, selected ? selected.hard_cap_usd ?? null : settings.hard_cap_usd)}" style="width:${barPct(selected ? selectedSpend : data.userSpend, selected ? selected.hard_cap_usd ?? null : settings.hard_cap_usd)}%"></span></div>
      <div class="sub">requests blocked once reached</div></div>
    <div class="co-card"><label>Alerting</label><b>${statusBadge}</b><div class="sub">${selected ? "alerts are account-wide" : channelSummary}</div></div>
  </div>
  ${selected ? `<div style="display:flex;gap:8px;margin-top:12px"><a class="btn btn-ghost" href="/ui/runs?project=${encodeURIComponent(selected.id)}">Open runs</a><a class="btn btn-ghost" href="/ui/analytics?project=${encodeURIComponent(selected.id)}">Open analytics</a></div>` : ""}

  <div class="panel">
    <div class="panel-head"><span class="panel-title">Spend &amp; limits</span><span class="panel-note">${selected ? `${escapeHtml(selected.name)} · month to date` : "per scope: month to date"}</span></div>
    <div style="padding:6px 18px 18px;overflow:auto">
      <table class="co-usage">
        <thead><tr><th>Scope</th><th>Spend</th><th>Budget $</th><th>Hard cap $</th><th></th></tr></thead>
        <tbody>${usageRows}</tbody>
      </table>
    </div>
  </div>

  <div class="panel" style="margin-top:18px">
    <div class="panel-head"><span class="panel-title">Alert settings</span><span class="panel-note">account-wide defaults</span></div>
    <div class="panel-body"><div class="co-form">
      <div>
        <label for="s-webhook">Webhook URL</label>
        <input id="s-webhook" type="text" placeholder="https://hooks.slack.com/services/... or any HTTPS endpoint" value="${escapeHtml(settings.webhook_url ?? "")}" autocomplete="off">
      </div>
      <div>
        <label for="s-webhook-secret">Webhook signing secret (optional)</label>
        <input id="s-webhook-secret" type="password" placeholder="outbound calls get x-torrix-signature: sha256=…" value="${escapeHtml(settings.webhook_secret ?? "")}" autocomplete="off">
      </div>
      <div class="co-grid2">
        <div>
          <label for="s-pagerduty">PagerDuty routing key (optional)</label>
          <input id="s-pagerduty" type="password" placeholder="Events API v2 integration key" value="${escapeHtml(settings.pagerduty_routing_key ?? "")}" autocomplete="off">
        </div>
        <div>
          <label for="s-email-url">Email gateway URL (optional)</label>
          <input id="s-email-url" type="text" placeholder="https://mail-gateway.internal/send" value="${escapeHtml(settings.email_webhook_url ?? "")}" autocomplete="off">
        </div>
      </div>
      <div class="co-grid2">
        <div>
          <label for="s-email-token">Email gateway token (optional)</label>
          <input id="s-email-token" type="password" placeholder="sent as authorization: Bearer …" value="${escapeHtml(settings.email_webhook_token ?? "")}" autocomplete="off">
        </div>
        <div>
          <label for="s-email-recipients">Email recipients</label>
          <input id="s-email-recipients" type="text" placeholder="ops@example.com, oncall@example.com" value="${escapeHtml(settings.email_recipients ?? "")}" autocomplete="off">
        </div>
      </div>
      <div class="co-grid2">
        <div>
          <label for="s-budget">Budget (USD / month)</label>
          <input id="s-budget" type="text" inputmode="decimal" placeholder="e.g. 25.00 (blank = none)" value="${settings.budget_usd ?? ""}" autocomplete="off">
        </div>
        <div>
          <label for="s-cap">Hard cap (USD / month)</label>
          <input id="s-cap" type="text" inputmode="decimal" placeholder="e.g. 50.00 (blank = none)" value="${settings.hard_cap_usd ?? ""}" autocomplete="off">
        </div>
      </div>
      <div class="co-grid2">
        <label class="co-switch"><input id="s-enabled" type="checkbox" ${settings.enabled ? "checked" : ""}> Enable cost alerts</label>
        <label class="co-switch"><input id="s-anomaly" type="checkbox" ${settings.anomaly_enabled ? "checked" : ""}> Flag cost anomalies</label>
      </div>
      <div class="co-grid2">
        <div>
          <label for="s-mult">Anomaly multiplier</label>
          <input id="s-mult" type="text" inputmode="decimal" value="${settings.anomaly_multiplier}" autocomplete="off">
        </div>
        <label class="co-switch" style="align-items:flex-end;padding:0 0 10px"><input id="s-digest" type="checkbox" ${settings.digest_enabled ? "checked" : ""}> Weekly digest</label>
      </div>
      <div style="display:flex;gap:10px;align-items:center">
        <button class="btn btn-primary" id="s-save">Save settings</button>
        <span class="panel-note">Slack URLs get a Block Kit payload, other endpoints get the JSON event object; PagerDuty uses Events API v2 and email posts to the gateway URL.</span>
      </div>
      <div class="co-msg" id="s-msg"></div>
    </div></div>
  </div>

  <div class="panel" style="margin-top:18px">
    <div class="panel-head"><span class="panel-title">Custom pricing</span><span class="panel-note">overrides the built-in price table for matching models</span></div>
    <div class="panel-body"><div class="co-form" style="flex-direction:row;flex-wrap:wrap;gap:10px;max-width:none">
      <div style="flex:2 1 260px"><label for="p-model">Model prefix</label><input id="p-model" type="text" placeholder="gpt-4o-mini-2024-07-18" autocomplete="off"></div>
      <div style="flex:1 1 150px"><label for="p-in">Input $/1M</label><input id="p-in" type="text" inputmode="decimal" placeholder="0.15" autocomplete="off"></div>
      <div style="flex:1 1 150px"><label for="p-out">Output $/1M</label><input id="p-out" type="text" inputmode="decimal" placeholder="0.60" autocomplete="off"></div>
      <div style="display:flex;align-items:flex-end"><button class="btn btn-primary" id="p-add">Add / update</button></div>
    </div>
    <div class="co-msg" id="p-msg"></div>
    ${data.prices.length ? `<table class="co-usage" style="margin-top:6px"><thead><tr><th>Model</th><th>Price</th><th></th></tr></thead><tbody>${priceRows}</tbody></table>` : ""}
    </div>
  </div>

  <script>
  const AUTH="Bearer "+(localStorage.getItem("torrix_key")||"");
  const jh=(r)=>{try{return r.json()}catch{return Promise.resolve({})}};
  const msg=(el,text,cls)=>{const m=document.getElementById(el);m.textContent=text;m.className="co-msg "+(cls||"")};
  async function put(path,body){return fetch(path,{method:"PUT",headers:{"content-type":"application/json",authorization:AUTH},body:JSON.stringify(body)});}
  document.getElementById("s-save").onclick=async()=>{
    const res=await put("/api/cost/settings",{
      enabled:document.getElementById("s-enabled").checked?1:0,
      webhook_url:document.getElementById("s-webhook").value.trim(),
      webhook_secret:document.getElementById("s-webhook-secret").value.trim(),
      pagerduty_routing_key:document.getElementById("s-pagerduty").value.trim(),
      email_webhook_url:document.getElementById("s-email-url").value.trim(),
      email_webhook_token:document.getElementById("s-email-token").value.trim(),
      email_recipients:document.getElementById("s-email-recipients").value.trim(),
      budget_usd:document.getElementById("s-budget").value.trim()||null,
      hard_cap_usd:document.getElementById("s-cap").value.trim()||null,
      anomaly_enabled:document.getElementById("s-anomaly").checked?1:0,
      anomaly_multiplier:document.getElementById("s-mult").value,
      digest_enabled:document.getElementById("s-digest").checked?1:0,
    });
    const j=await jh(res);
    if(!res.ok){msg("s-msg",j.error||"Save failed","err");return;}
    msg("s-msg","Saved.","ok");location.reload();
  };
  document.querySelectorAll("[data-scope]").forEach(row=>{
    row.querySelector("[data-save]").addEventListener("click",async()=>{
      const scope=row.dataset.scope,id=row.dataset.id;
      const path=scope==="project"?"/api/cost/project/"+id:scope==="api_key"?"/api/cost/key/"+id:"/api/cost/settings";
      const payload={
        budget_usd:row.querySelector("[data-budget]").value.trim()||null,
        hard_cap_usd:row.querySelector("[data-cap]").value.trim()||null,
      };
      if(scope==="project"){
        payload.prompt_compression=row.querySelector("[data-compression]").value;
        payload.compression_words=row.querySelector("[data-words]").value.trim();
      }
      const res=await put(path,payload);
      const j=await jh(res);
      if(!res.ok){msg("s-msg",j.error||"Failed","err");return;}
      msg("s-msg","Limits saved.","ok");location.reload();
    });
  });
  document.getElementById("p-add").onclick=async()=>{
    const model=document.getElementById("p-model").value.trim();
    const input=document.getElementById("p-in").value;
    const output=document.getElementById("p-out").value;
    if(!model||input===""||output===""){msg("p-msg","Model, input and output are required.","err");return;}
    const res=await fetch("/api/cost/pricing",{method:"PUT",headers:{"content-type":"application/json",authorization:AUTH},body:JSON.stringify({model,input:Number(input),output:Number(output)})});
    const j=await jh(res);
    if(!res.ok){msg("p-msg",j.error||"Failed","err");return;}
    msg("p-msg","Price override saved.","ok");location.reload();
  };
  document.querySelectorAll("[data-del-price]").forEach(btn=>{
    btn.onclick=async()=>{
      const res=await fetch("/api/cost/pricing/"+encodeURIComponent(btn.dataset.delPrice),{method:"DELETE",headers:{authorization:AUTH}});
      if(res.ok)location.reload();
    };
  });
  document.getElementById("digBtn").onclick=async()=>{
    const res=await fetch("/api/cost/digest",{method:"POST",headers:{authorization:AUTH}});
    const j=await jh(res);
    if(!res.ok){msg("s-msg",j.error+": "+(j.reason||""),"err");return;}
    msg("s-msg","Weekly digest sent to configured channels ("+Object.keys(j.payload||{}).length+" fields).","ok");
  };
  </script>`;

  function usageRow(
    scope: string,
    id: string | null,
    name: string,
    spend: number,
    budget: number | null,
    cap: number | null,
    compression: string = "off",
    words: string = "",
  ): string {
    const compressionCell =
      scope === "project"
        ? `<div style="margin-top:7px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <select data-compression title="Prompt compression applied by the proxy">
              <option value="off"${compression === "off" ? " selected" : ""}>compression off</option>
              <option value="conservative"${compression === "conservative" ? " selected" : ""}>conservative</option>
              <option value="balanced"${compression === "balanced" ? " selected" : ""}>balanced</option>
            </select>
            <input data-words type="text" placeholder="custom filler words" value="${escapeHtml(words)}" autocomplete="off" style="width:170px">
          </div>`
        : "";
    return `<tr data-scope="${scope}" data-id="${id ?? ""}">
      <td>${name} <span class="co-badge off">${scope}</span>${compressionCell}</td>
      <td class="mono tnum">$${spend.toFixed(4)}</td>
      <td><input data-budget type="text" placeholder="none" value="${budget ?? ""}" autocomplete="off"></td>
      <td><input data-cap type="text" placeholder="none" value="${cap ?? ""}" autocomplete="off"></td>
      <td style="text-align:right"><button class="btn btn-ghost" data-save>Save</button></td>
    </tr>`;
  }
}

const KEYS_STYLE = `
.keyline{display:flex;align-items:center;gap:10px;background:var(--bg);border:1px solid var(--line-2);border-radius:var(--r);padding:10px 12px;flex-wrap:wrap}
.keyline code{font-family:var(--mono);font-size:12.5px;color:var(--text);word-break:break-all;flex:1;min-width:220px}
.keyline .set-hint{margin:0}
`;

function projectsBody(
  access: ProjectAccess[],
  members: Map<string, Array<{ user_id: string; email: string; role: string }>>,
  onlineSections: Map<string, string> = new Map(),
  onlineScript = "",
): string {
  const onlineEvalSection = (p: Project): string =>
    onlineSections.get(p.id) ||
    `<div style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px"><div class="meta-label">Online eval</div><p class="panel-note" style="margin:6px 0 0">Continuous evals and guardrails for this project are available in Pro. <a href="/ui/locked/online-evals">See what Pro adds</a></p></div>`;
  const cards = access
    .map((entry) => {
      const p = entry.project;
      const isOwner = entry.role === "owner";
      const rows = (members.get(p.id) ?? [])
        .map(
          (m) => `<tr>
          <td>${escapeHtml(m.email)}${m.role === "owner" ? ' <span class="co-badge ok">owner</span>' : ""}</td>
          <td>${escapeHtml(m.role)}</td>
          <td style="text-align:right">${isOwner && m.role !== "owner" ? `<button class="btn btn-ghost" data-member-remove="${escapeHtml(m.user_id)}">Remove</button>` : ""}</td>
        </tr>`,
        )
        .join("");
      return `<div class="panel" style="margin-bottom:14px" data-project="${escapeHtml(p.id)}">
      <div class="panel-head"><span class="panel-title">${escapeHtml(p.name)}</span><span class="panel-note">${escapeHtml(entry.role)}${isOwner ? "" : " · shared with you"}</span></div>
      <div style="padding:14px 18px">
        ${
          isOwner
            ? `<div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
          <div style="flex:1;max-width:320px"><label class="meta-label" for="rename-${escapeHtml(p.id)}">Rename</label><input class="co-input" data-rename id="rename-${escapeHtml(p.id)}" type="text" value="${escapeHtml(p.name)}" maxlength="120"></div>
          <button class="btn btn-ghost" data-rename-save>Save name</button>
          <button class="btn btn-ghost" data-project-delete>Delete project</button>
        </div>`
            : ""
        }
        <div style="margin-top:14px">
          <div class="meta-label">Members</div>
          <table class="co-usage" style="margin-top:6px"><thead><tr><th>User</th><th>Role</th><th></th></tr></thead><tbody>${rows}</tbody></table>
          ${
            isOwner
              ? `<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
            <input class="co-input" data-member-email type="text" placeholder="teammate@example.com" autocomplete="off" style="flex:1;max-width:260px">
            <select data-member-role><option value="viewer">viewer</option><option value="editor">editor</option></select>
            <button class="btn btn-ghost" data-member-add>Add member</button>
          </div>`
              : ""
          }
        </div>
        ${onlineEvalSection(p)}
      </div>
    </div>`;
    })
    .join("");
  return `<style>${COST_STYLE}
  .co-input{background:var(--bg);border:1px solid var(--line-2);color:var(--text);border-radius:var(--r);padding:8px 10px;font-size:13px;outline:none}
  </style>
  <div class="page-head"><div><h1>Projects</h1><p class="page-sub">Runs, budgets, prompts and keys are scoped to projects. Owners manage members and roles; editors can write runs, viewers can only read.</p></div></div>
  <div class="panel" style="margin-bottom:16px">
    <div class="panel-head"><span class="panel-title">New project</span></div>
    <div style="padding:14px 18px;display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
      <div style="flex:1;max-width:320px"><label class="meta-label" for="pj-name">Name</label><input class="co-input" id="pj-name" type="text" maxlength="120" placeholder="e.g. Production" autocomplete="off"></div>
      <button class="btn btn-primary" id="pj-create">Create project</button>
      <span class="co-msg" id="pj-msg"></span>
    </div>
  </div>
  ${cards}
  <script>
  (function(){
    var AUTH="Bearer "+(localStorage.getItem("torrix_key")||"");
    var msg=function(text,cls){var m=document.getElementById("pj-msg");m.textContent=text;m.className="co-msg "+(cls||"")};
    var api=async function(path,opts){opts=opts||{};opts.headers=Object.assign({"content-type":"application/json",authorization:AUTH},opts.headers||{});var r=await fetch(path,opts);var j={};try{j=await r.json()}catch(e){};return {ok:r.ok,body:j}};
    document.getElementById("pj-create").onclick=async function(){
      var name=document.getElementById("pj-name").value.trim();
      if(!name){msg("Name is required.","err");return}
      var r=await api("/api/projects",{method:"POST",body:JSON.stringify({name:name})});
      if(!r.ok){msg(r.body.error||"failed","err");return}
      msg("Created.","ok");location.reload();
    };
    document.querySelectorAll("[data-project]").forEach(function(card){
      var id=card.dataset.project;
      var rename=card.querySelector("[data-rename-save]");
      if(rename)rename.onclick=async function(){
        var name=card.querySelector("[data-rename]").value.trim();
        var r=await api("/api/projects/"+id,{method:"PATCH",body:JSON.stringify({name:name})});
        if(!r.ok){msg(r.body.error||"failed","err");return}
        msg("Renamed.","ok");location.reload();
      };
      var del=card.querySelector("[data-project-delete]");
      if(del)del.onclick=async function(){
        if(!confirm("Delete this project? Its runs stay in the database but lose their project."))return;
        var r=await api("/api/projects/"+id,{method:"DELETE"});
        if(!r.ok){msg(r.body.error||"failed","err");return}
        msg("Deleted.","ok");location.reload();
      };
      var add=card.querySelector("[data-member-add]");
      if(add)add.onclick=async function(){
        var email=card.querySelector("[data-member-email]").value.trim();
        var role=card.querySelector("[data-member-role]").value;
        var r=await api("/api/projects/"+id+"/members",{method:"POST",body:JSON.stringify({email:email,role:role})});
        if(!r.ok){msg(r.body.error||"failed","err");return}
        msg("Member added.","ok");location.reload();
      };
      card.querySelectorAll("[data-member-remove]").forEach(function(btn){
        btn.onclick=async function(){
          var r=await api("/api/projects/"+id+"/members/"+btn.dataset.memberRemove,{method:"DELETE"});
          if(!r.ok){msg(r.body.error||"failed","err");return}
          msg("Member removed.","ok");location.reload();
        };
      });
    });
  })();
  </script>
  ${onlineScript}`;
}

function keysPageBody(keys: ApiKey[], activeKeyId: string | null): string {
  const rows = keys.length
    ? keys
        .map((k) => {
          const active = activeKeyId != null && k.id === activeKeyId;
          const perm = k.permission === "read_only" ? "read only" : "read and write";
          const scope = k.scope === "projects" ? "projects (scoped)" : "all projects";
          return `<tr>
      <td>${escapeHtml(k.name)}${active ? ' <span class="co-badge ok">current</span>' : ""}</td>
      <td class="mono">${escapeHtml(k.key_prefix)}…</td>
      <td>${perm} · ${scope}</td>
      <td class="mono">${escapeHtml(k.created_at.slice(0, 10))}</td>
      <td class="mono">${k.last_used_at ? escapeHtml(k.last_used_at.slice(0, 16).replace("T", " ")) : "never"}</td>
      <td style="text-align:right">${active ? "" : `<button class="btn btn-ghost" data-revoke="${escapeHtml(k.id)}">Revoke</button>`}</td>
    </tr>`;
        })
        .join("")
    : `<tr><td colspan="6">${emptyState("No keys yet", "Create a key below to authenticate the proxy, SDK ingest or the API.")}</td></tr>`;

  return `<style>${COST_STYLE}${KEYS_STYLE}</style>
  <div class="co-head">
    <div><h1>API keys</h1><p class="page-sub">Keys authenticate /proxy, /api/ingest and the REST API. Torrix stores only SHA-256 hashes, so a secret is shown once at creation.</p></div>
  </div>

  <div class="panel">
    <div class="panel-head"><span class="panel-title">This browser's key</span><span class="panel-note">stored in localStorage</span></div>
    <div class="panel-body">
      <div class="keyline">
        <code id="curKey">loading…</code>
        <button class="btn btn-ghost" id="curShow">Show</button>
        <button class="btn btn-ghost" id="curCopy"><span id="curCopyLabel">Copy key</span></button>
      </div>
      <p class="set-hint">Use it as <code class="mono">TORRIX_API_KEY</code> for the opencode plugin, or as the Bearer key for /proxy and /api/ingest.</p>
    </div>
  </div>

  <div class="panel" style="margin-top:18px">
    <div class="panel-head"><span class="panel-title">Create key</span><span class="panel-note">secret shown once</span></div>
    <div class="panel-body"><div class="co-form">
      <div class="co-grid2">
        <div><label for="k-name">Name</label><input id="k-name" type="text" maxlength="80" placeholder="e.g. opencode laptop" autocomplete="off"></div>
        <div><label for="k-perm">Permission</label><select id="k-perm">
          <option value="read_write">read and write (proxy + ingest)</option>
          <option value="read_only">read only (API reads)</option>
        </select></div>
      </div>
      <div><button class="btn btn-primary" id="k-create">Create key</button></div>
      <div id="k-fresh" style="display:none">
        <label>New key</label>
        <div class="keyline"><code id="k-freshval"></code><button class="btn btn-ghost" id="k-freshcopy"><span id="k-freshlabel">Copy</span></button></div>
      </div>
      <div class="co-msg" id="k-msg"></div>
    </div></div>
  </div>

  <div class="panel" style="margin-top:18px">
    <div class="panel-head"><span class="panel-title">Active keys</span><span class="panel-note">${keys.length} total</span></div>
    <div style="padding:6px 18px 18px;overflow:auto">
      <table class="co-usage">
        <thead><tr><th>Name</th><th>Prefix</th><th>Permission</th><th>Created</th><th>Last used</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>
  <script>
  (function(){
    var AUTH="Bearer "+(localStorage.getItem("torrix_key")||"");
    var jh=async function(r){try{return await r.json()}catch(e){return {}}};
    var current=localStorage.getItem("torrix_key")||"";
    var shown=false;
    var keyEl=document.getElementById("curKey");
    function paint(){keyEl.textContent=!current?"no key stored in this browser":(shown?current:current.slice(0,8)+"…"+current.slice(-4))}
    paint();
    document.getElementById("curShow").onclick=function(){shown=!shown;this.textContent=shown?"Hide":"Show";paint()};
    document.getElementById("curCopy").onclick=async function(){
      if(!current)return;
      try{await navigator.clipboard.writeText(current);document.getElementById("curCopyLabel").textContent="Copied";setTimeout(function(){document.getElementById("curCopyLabel").textContent="Copy key"},1400)}catch(e){}
    };
    function msg(text,cls){var m=document.getElementById("k-msg");m.textContent=text;m.className="co-msg "+(cls||"")}
    document.getElementById("k-create").onclick=async function(){
      var name=document.getElementById("k-name").value.trim();
      if(!name){msg("Name is required.","err");return}
      var res=await fetch("/api/keys",{method:"POST",headers:{"content-type":"application/json",authorization:AUTH},body:JSON.stringify({name:name,permission:document.getElementById("k-perm").value})});
      var j=await jh(res);
      if(!res.ok){msg(j.error||"Create failed","err");return}
      document.getElementById("k-freshval").textContent=j.key;
      document.getElementById("k-fresh").style.display="block";
      msg("Key created. Copy it now: it will not be shown again.","ok");
    };
    document.getElementById("k-freshcopy").onclick=async function(){
      try{await navigator.clipboard.writeText(document.getElementById("k-freshval").textContent);document.getElementById("k-freshlabel").textContent="Copied";setTimeout(function(){document.getElementById("k-freshlabel").textContent="Copy"},1400)}catch(e){}
    };
    document.querySelectorAll("[data-revoke]").forEach(function(btn){
      btn.onclick=async function(){
        var res=await fetch("/api/keys/"+btn.dataset.revoke,{method:"DELETE",headers:{authorization:AUTH}});
        var j=await jh(res);
        if(!res.ok){msg(j.error==="cannot_revoke_active_key"?"You cannot revoke the key this browser is signed in with.":(j.error||"Revoke failed"),"err");return}
        location.reload();
      };
    });
  })();
  </script>`;
}

function settingsBody(config: ServerConfig, ssoAllowed = false): string {
  return `<style>
  .set-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:20px 22px;margin-bottom:18px;max-width:680px}
  .set-current{display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--bg);border:1px solid var(--line);border-radius:var(--r-lg);margin-bottom:18px}
  .set-current .dot{width:9px;height:9px;border-radius:50%;background:var(--good);box-shadow:0 0 0 4px var(--good-dim);flex:0 0 9px}
  .set-current b{font-size:13.5px;font-weight:640}
  .set-current .share-val{color:var(--text-2);font-size:12.5px;word-break:break-all}
  .set-hint{font-size:12.5px;color:var(--text-3);line-height:1.6;margin:10px 0 0}
  .set-note{margin-top:12px;font-size:12.5px;color:var(--warn)}
  .set-fields{display:flex;flex-direction:column;gap:12px;max-width:560px}
  .set-fields label{font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:6px;display:block}
  .set-fields select,.set-fields input{width:100%;background:var(--bg);border:1px solid var(--line-2);color:var(--text);
    border-radius:var(--r);padding:10px 12px;font-size:13.5px;font-family:inherit;outline:none}
  .set-fields select:focus,.set-fields input:focus{border-color:var(--accent)}
  .set-msg{min-height:20px;font-size:13px;margin-top:14px}
  .set-msg.ok{color:var(--good)} .set-msg.err{color:var(--bad)}
  .set-fields input[type="text"]{font-family:var(--mono);font-size:12.5px}
  .set-tabs{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:18px}
  .set-tabs a{font-family:var(--display);font-size:12.5px;font-weight:600;color:var(--text-3);border:1px solid var(--line);
    border-radius:var(--r);padding:7px 12px;text-decoration:none;background:var(--surface-2)}
  .set-tabs a:hover{color:var(--text);border-color:var(--line-2)}
  .set-tabs a.active{color:var(--text);background:var(--surface);border-color:var(--accent-line)}
</style>
<div class="page-head">
  <div><h1>Settings</h1><p class="page-sub">Instance configuration</p></div>
</div>
<div class="set-tabs">
  <a class="active" href="#general">General</a>
  <a href="/ui/cost">Budget &amp; alerts</a>
  <a href="/ui/datasets">Judge &amp; evals</a>
  <a href="/ui/keys">API keys</a>
  <a href="/ui/governance">Routing</a>
  <a href="/ui/governance">Privacy &amp; PII</a>
  <a href="/ui/cost">Compression</a>
  <a href="/ui/governance">Governance</a>
  <a href="/ui/team">Team</a>
  ${ssoAllowed ? `<a href="#sso">SSO</a>` : `<a href="/ui/locked/sso">SSO <span class="nav-lock">Ent</span></a>`}
  <a href="/ui/governance">Audit log</a>
</div>
<div class="set-card">
  <div class="panel-title">Database engine</div>
  <p class="set-hint" style="margin-left:0">Torrix stores every run in a single SQLite file by default. Switch to PostgreSQL and swap back at any time: the change applies immediately, migrates the schema on the fly, and survives a restart.</p>
  <div class="set-current"><span class="dot"></span><div><b>SQLite</b><span class="share-val"> · loading…</span></div></div>
  <div class="set-fields">
    <div>
      <label for="db-driver">Where should run data live?</label>
      <select id="db-driver">
        <option value="sqlite">SQLite: local file</option>
        <option value="postgres">PostgreSQL: external server</option>
      </select>
    </div>
    <div id="db-url-wrap" style="display:none">
      <label for="db-url">Connection string <span style="font-weight:500;color:var(--text-3)">postgres://user:password@host:5432/dbname</span></label>
      <input id="db-url" type="text" autocomplete="off" placeholder="postgres://user:password@host:5432/torrix" spellcheck="false">
    </div>
  </div>
  <div style="margin-top:16px"><button class="btn btn-primary" id="db-save" onclick="saveDb()">Switch database</button></div>
  <div id="db-msg" class="set-msg"></div>
  <p class="set-hint">If the target database has no accounts, the local admin user, default project and API keys are copied across automatically so nothing locks you out.</p>
</div>
<div class="set-card">
  <div class="panel-title">Global sampling</div>
  <p class="set-hint" style="margin-left:0">Share of proxy traffic recorded as runs. 1 logs every call, 0 logs nothing except errors; per-request <code>x-torrix-sample</code> headers still override this value. Cost caps and policy checks always run.</p>
  <div class="set-fields">
    <div>
      <label for="sample-rate">Sample rate (0 to 1)</label>
      <input id="sample-rate" type="text" autocomplete="off" placeholder="1" spellcheck="false">
    </div>
  </div>
  <div style="margin-top:16px"><button class="btn btn-primary" id="sample-save">Save sampling</button></div>
  <div id="sample-msg" class="set-msg"></div>
</div>
<div class="set-card">
  <div class="panel-title">Users</div>
  <p class="set-hint" style="margin-left:0">Accounts that can sign in to this instance. Creating a user also creates their default project and a first API key, shown once.</p>
  <div id="users-table"><p class="set-hint">Loading…</p></div>
  <div class="set-fields" style="margin-top:14px;display:grid;grid-template-columns:1.4fr 1fr auto;gap:10px;max-width:640px;align-items:end">
    <div><label for="user-email">Email</label><input id="user-email" type="text" autocomplete="off" placeholder="teammate@example.com"></div>
    <div><label for="user-password">Password</label><input id="user-password" type="password" autocomplete="off" placeholder="at least 8 characters"></div>
    <label class="auto-refresh" style="padding-bottom:10px"><input id="user-admin" type="checkbox"> admin</label>
  </div>
  <div style="margin-top:12px;display:flex;gap:10px;align-items:center">
    <button class="btn btn-primary" id="user-create">Create user</button>
    <button class="btn btn-ghost" id="backup-btn">Download SQLite backup</button>
  </div>
  <div id="user-msg" class="set-msg"></div>
</div>
<div class="set-card">
  <div class="panel-title">License</div>
  <p class="set-hint" style="margin-left:0">Paste a signed license key to move this instance to pro or enterprise. Keys are verified offline (RSA-SHA256) against the Torrix signing key built into this release; the instance returns to community when the license is removed or expires.</p>
  <div class="set-fields">
    <div>
      <label for="license-key">License key</label>
      <input id="license-key" type="text" autocomplete="off" placeholder="payload.signature" spellcheck="false">
    </div>
  </div>
  <div style="margin-top:14px;display:flex;gap:10px">
    <button class="btn btn-primary" id="license-save">Activate</button>
    <button class="btn btn-ghost" id="license-clear">Deactivate</button>
  </div>
  <div id="license-msg" class="set-msg"></div>
</div>
${ssoAllowed ? `<div class="set-card">
  <div class="panel-title">Single sign-on (OIDC)</div>
  <p class="set-hint" style="margin-left:0">Enterprise edition. Values saved here override the <code>TORRIX_OIDC_*</code> environment variables; the client secret is stored in instance_config and never returned by the API.</p>
  <div class="set-fields">
    <div><label for="sso-issuer">Issuer URL</label><input id="sso-issuer" type="text" placeholder="https://idp.example.com" autocomplete="off"></div>
    <div><label for="sso-client-id">Client ID</label><input id="sso-client-id" type="text" autocomplete="off"></div>
    <div><label for="sso-secret">Client secret (blank keeps the current one)</label><input id="sso-secret" type="password" autocomplete="off"></div>
    <div><label for="sso-scopes">Scopes</label><input id="sso-scopes" type="text" placeholder="openid email profile" autocomplete="off"></div>
    <div><label for="sso-redirect">Redirect URI override (optional)</label><input id="sso-redirect" type="text" placeholder="https://torrix.example.com/auth/oidc/callback" autocomplete="off"></div>
    <label class="auto-refresh"><input id="sso-auto" type="checkbox"> auto-provision users</label>
  </div>
  <div style="margin-top:14px;display:flex;gap:10px"><button class="btn btn-primary" id="sso-save">Save SSO</button><button class="btn btn-ghost" id="sso-clear">Remove settings</button></div>
  <div id="sso-msg" class="set-msg"></div>
</div>` : ""}
<script>
  var key=localStorage.getItem("torrix_key");
  var msg=document.getElementById("db-msg");
  var driverSel=document.getElementById("db-driver");
  var urlWrap=document.getElementById("db-url-wrap");
  var urlInput=document.getElementById("db-url");
  async function api(url,opts){opts=opts||{};opts.headers=Object.assign({},opts.headers,{"Authorization":"Bearer "+key});return fetch(url,opts);}
  function showNow(driver,label){var now=document.querySelector(".set-current b");var sub=document.querySelector(".set-current .share-val");now.textContent=driver;var prefix=driver+" · ";var rest=label&&label.indexOf(prefix)===0?label.slice(prefix.length):(label===driver?"":(label||""));sub.textContent=rest?" · "+rest:"";driverSel.value=driver;urlWrap.style.display=driver==="postgres"?"block":"none";}
  function ready(){var b=document.querySelector(".set-current");var dot=b.querySelector(".dot");dot.style.background="var(--good)";dot.style.boxShadow="0 0 0 4px var(--good-dim)";}
  driverSel.onchange=function(){urlWrap.style.display=driverSel.value==="postgres"?"block":"none";};
  (async function init(){var b=document.querySelector(".set-current");var dot=b.querySelector(".dot");dot.style.background="var(--warn)";dot.style.boxShadow="0 0 0 4px var(--warn-dim)";
    try{
      var r=await api("/api/admin/db");var j=await r.json();
      if(j.error==="forbidden"){msg.className="set-msg err";msg.textContent="Administrator access is required to manage the database engine.";return;}
      showNow(j.driver==="postgres"?"PostgreSQL":"SQLite",j.label);ready();
      if(j.envOverride&&!msg.textContent){msg.className="set-msg err";msg.textContent="TORRIX_DATABASE_URL is set in the environment, so it wins at boot. Changes here apply until the process restarts.";}
    }catch(e){msg.className="set-msg err";msg.textContent="Could not load database status. "+e.message;
      dot.style.background="var(--bad)";dot.style.boxShadow="0 0 0 4px var(--bad-dim)";}
  })();
  async function saveDb(){
    var b=document.getElementById("db-save");b.disabled=true;msg.className="set-msg";msg.textContent="Switching…";
    var body=driverSel.value==="postgres"?{driver:"postgres",url:urlInput.value.trim()}:{driver:"sqlite"};
    try{
      var r=await api("/api/admin/db",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      var j=await r.json();
      if(!r.ok){msg.className="set-msg err";msg.textContent=(j.detail?j.detail+": ":"")+(j.error?String(j.error):"switch failed");return;}
      showNow(j.driver==="postgres"?"PostgreSQL":"SQLite",j.label);ready();
      msg.className="set-msg ok";
      msg.textContent=j.swapped?("Switched. "+(j.seeded?"Seeded the admin account, default project and API keys into the new database. ":"")):"Already connected to that database: nothing to do.";
    }catch(e){msg.className="set-msg err";msg.textContent=e.message;}
    finally{b.disabled=false;}
  }
  var sampleMsg=document.getElementById("sample-msg");
  var sampleInput=document.getElementById("sample-rate");
  var sampleBtn=document.getElementById("sample-save");
  (async function loadSampling(){
    try{var r=await api("/api/sampling-config");var j=await r.json();if(r.ok)sampleInput.value=String(j.sample_rate);}catch(e){}
  })();
  sampleBtn.onclick=async function(){
    sampleBtn.disabled=true;sampleMsg.className="set-msg";sampleMsg.textContent="Saving…";
    try{
      var r=await api("/api/sampling-config",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({sample_rate:Number(sampleInput.value)})});
      var j=await r.json();
      if(!r.ok){sampleMsg.className="set-msg err";sampleMsg.textContent=String(j.error||"save failed");return;}
      sampleMsg.className="set-msg ok";sampleMsg.textContent="Sampling set to "+j.sample_rate+".";
    }catch(e){sampleMsg.className="set-msg err";sampleMsg.textContent=e.message;}
    finally{sampleBtn.disabled=false;}
  };
  var userMsg=document.getElementById("user-msg");
  function renderUsers(users){
    var host=document.getElementById("users-table");
    if(!users.length){host.innerHTML='<p class="set-hint">No users.</p>';return}
    host.innerHTML='<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>'+
      '<th style="text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--text-3);padding:8px 10px;border-bottom:1px solid var(--line)">Email</th>'+
      '<th style="text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--text-3);padding:8px 10px;border-bottom:1px solid var(--line)">Role</th>'+
      '<th style="text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--text-3);padding:8px 10px;border-bottom:1px solid var(--line)">Created</th><th></th></tr></thead><tbody>'+
      users.map(function(u){
        var admin=u.is_admin===1;
        return '<tr><td style="padding:9px 10px;border-bottom:1px solid var(--line)">'+String(u.email).replace(/</g,"&lt;")+'</td>'+
          '<td style="padding:9px 10px;border-bottom:1px solid var(--line)">'+(admin?'<span class="co-badge ok">admin</span>':'<span class="co-badge off">member</span>')+'</td>'+
          '<td style="padding:9px 10px;border-bottom:1px solid var(--line);font-family:var(--mono);font-size:12px">'+String(u.created_at).slice(0,10)+'</td>'+
          '<td style="padding:9px 10px;border-bottom:1px solid var(--line);text-align:right">'+
          '<button class="btn btn-ghost" data-role="'+u.id+'" data-next="'+(admin?0:1)+'">'+(admin?'Demote':'Promote')+'</button> '+
          '<button class="btn btn-ghost" data-del-user="'+u.id+'">Delete</button></td></tr>';
      }).join("")+'</tbody></table>';
    host.querySelectorAll("[data-role]").forEach(function(b){b.onclick=async function(){
      var r=await api("/api/admin/users/"+b.dataset.role,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({is_admin:b.dataset.next==="1"})});
      var j=await r.json();if(!r.ok){userMsg.className="set-msg err";userMsg.textContent=String(j.error||"failed");return}
      loadUsers();
    }});
    host.querySelectorAll("[data-del-user]").forEach(function(b){b.onclick=async function(){
      if(!confirm("Delete this user and all of their runs?"))return;
      var r=await api("/api/admin/users/"+b.dataset.delUser,{method:"DELETE"});
      var j=await r.json();if(!r.ok){userMsg.className="set-msg err";userMsg.textContent=String(j.error||"failed");return}
      loadUsers();
    }});
  }
  async function loadUsers(){
    try{var r=await api("/api/admin/users");var j=await r.json();if(r.ok)renderUsers(j.users||[]);}catch(e){}
  }
  document.getElementById("user-create").onclick=async function(){
    var email=document.getElementById("user-email").value.trim();
    var password=document.getElementById("user-password").value;
    var isAdmin=document.getElementById("user-admin").checked;
    userMsg.className="set-msg";userMsg.textContent="Creating…";
    try{
      var r=await api("/api/admin/users",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:email,password:password,is_admin:isAdmin})});
      var j=await r.json();
      if(!r.ok){userMsg.className="set-msg err";userMsg.textContent=String(j.error||"failed");return}
      userMsg.className="set-msg ok";userMsg.textContent="Created. API key: "+j.api_key;
      document.getElementById("user-email").value="";document.getElementById("user-password").value="";loadUsers();
    }catch(e){userMsg.className="set-msg err";userMsg.textContent=e.message;}
  };
  document.getElementById("backup-btn").onclick=async function(){
    try{
      var r=await api("/api/admin/backup");
      if(!r.ok){var j={};try{j=await r.json()}catch(e){};userMsg.className="set-msg err";userMsg.textContent=String(j.error||"backup failed");return}
      var blob=await r.blob();
      var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="torrix-backup.sqlite";a.click();URL.revokeObjectURL(a.href);
    }catch(e){userMsg.className="set-msg err";userMsg.textContent=e.message;}
  };
  loadUsers();
  var licenseMsg=document.getElementById("license-msg");
  (async function loadLicense(){
    try{var r=await api("/api/license");var j=await r.json();if(r.ok&&j.source==="license")licenseMsg.textContent="Active: "+j.edition+(j.licensee?" · "+j.licensee:"");}catch(e){}
  })();
  document.getElementById("license-save").onclick=async function(){
    licenseMsg.className="set-msg";licenseMsg.textContent="Verifying…";
    try{
      var r=await api("/api/license",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:document.getElementById("license-key").value.trim()})});
      var j=await r.json();
      if(!r.ok){licenseMsg.className="set-msg err";licenseMsg.textContent=String(j.error||"failed")+(j.reason?": "+j.reason:"");return}
      licenseMsg.className="set-msg ok";licenseMsg.textContent="Activated "+j.edition+" edition.";
      setTimeout(function(){location.reload()},800);
    }catch(e){licenseMsg.className="set-msg err";licenseMsg.textContent=e.message;}
  };
  document.getElementById("license-clear").onclick=async function(){
    try{
      var r=await api("/api/license",{method:"DELETE"});var j=await r.json();
      if(!r.ok){licenseMsg.className="set-msg err";licenseMsg.textContent=String(j.error||"failed");return}
      licenseMsg.className="set-msg ok";licenseMsg.textContent="License removed.";
      setTimeout(function(){location.reload()},800);
    }catch(e){licenseMsg.className="set-msg err";licenseMsg.textContent=e.message;}
  };
  var ssoIssuer=document.getElementById("sso-issuer");
  if(ssoIssuer){
    var ssoMsg=document.getElementById("sso-msg");
    (async function loadSso(){
      try{
        var r=await api("/api/sso/config");var j=await r.json();
        if(!r.ok){ssoMsg.textContent=String(j.error||"");return}
        if(j.issuer)ssoIssuer.value=j.issuer;
        if(j.client_id)document.getElementById("sso-client-id").value=j.client_id;
        document.getElementById("sso-scopes").value=j.scopes||"openid email profile";
        if(j.redirect_uri)document.getElementById("sso-redirect").value=j.redirect_uri;
        document.getElementById("sso-auto").checked=!!j.auto_provision;
        ssoMsg.textContent=j.configured?("Configured via "+(j.source==="env"?"environment":"settings")+"."):"Not configured.";
      }catch(e){}
    })();
    document.getElementById("sso-save").onclick=async function(){
      ssoMsg.className="set-msg";ssoMsg.textContent="Saving…";
      try{
        var r=await api("/api/sso/config",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({
          issuer:ssoIssuer.value.trim(),
          client_id:document.getElementById("sso-client-id").value.trim(),
          client_secret:document.getElementById("sso-secret").value,
          scopes:document.getElementById("sso-scopes").value.trim(),
          redirect_uri:document.getElementById("sso-redirect").value.trim(),
          auto_provision:document.getElementById("sso-auto").checked
        })});
        var j=await r.json();
        if(!r.ok){ssoMsg.className="set-msg err";ssoMsg.textContent=String(j.error||"failed");return}
        ssoMsg.className="set-msg ok";ssoMsg.textContent="SSO settings saved.";document.getElementById("sso-secret").value="";
      }catch(e){ssoMsg.className="set-msg err";ssoMsg.textContent=e.message;}
    };
    document.getElementById("sso-clear").onclick=async function(){
      try{
        var r=await api("/api/sso/config",{method:"DELETE"});var j=await r.json();
        if(!r.ok){ssoMsg.className="set-msg err";ssoMsg.textContent=String(j.error||"failed");return}
        ssoMsg.className="set-msg ok";ssoMsg.textContent="SSO settings removed.";
        setTimeout(function(){location.reload()},600);
      }catch(e){ssoMsg.className="set-msg err";ssoMsg.textContent=e.message;}
    };
  }
</script>`;
}

function playgroundBody(): string {
  return `<style>
  .pg-layout{display:grid;grid-template-columns:280px 1fr;gap:18px;align-items:start}
  @media(max-width:880px){.pg-layout{grid-template-columns:1fr}}
  .pg-rail .panel{border-radius:var(--r-lg);overflow:hidden}
  .pg-rail .field{margin-bottom:14px}
  .pg-rail label{display:block;font-size:11.5px;font-weight:650;text-transform:uppercase;letter-spacing:.07em;color:var(--text-3);margin-bottom:6px}
  .pg-rail select,.pg-rail input[type="text"],.pg-rail input[type="password"],.pg-rail textarea,.pg-chat textarea{width:100%;background:var(--bg);border:1px solid var(--line-2);color:var(--text);
    border-radius:var(--r);padding:9px 11px;font-size:13px;font-family:inherit;outline:none}
  .pg-rail select:focus,.pg-rail input:focus,.pg-rail textarea:focus,.pg-chat textarea:focus{border-color:var(--accent)}
  .pg-rail textarea{resize:vertical;min-height:64px}
  .pg-rail .temp-row{display:flex;align-items:center;gap:10px}
  .pg-rail .temp-row input[type="range"]{flex:1}
  .pg-rail .temp-val{font-family:var(--mono);font-size:12px;color:var(--text-2);min-width:32px;text-align:right}
  .pg-chat{display:flex;flex-direction:column;min-height:calc(100vh - 210px);max-height:calc(100vh - 210px)}
  .pg-track{flex:1;overflow-y:auto;padding:20px 20px 8px;display:flex;flex-direction:column;gap:14px}
  .pg-msg{display:flex;gap:12px;max-width:88%}
  .pg-msg.user{align-self:flex-end;flex-direction:row-reverse}
  .pg-av{flex:0 0 28px;height:28px;border-radius:var(--r);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;letter-spacing:.02em}
  .pg-msg.user .pg-av{background:var(--accent-dim);color:var(--accent)}
  .pg-msg.assistant .pg-av{background:var(--good-dim);color:var(--good)}
  .pg-bubble{background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r-lg);padding:11px 14px;font-size:13.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word}
  .pg-msg.user .pg-bubble{background:var(--accent-dim);border-color:var(--accent-line)}
  .pg-msg.error .pg-bubble{background:var(--bad-dim);border-color:var(--bad-line);color:var(--bad)}
  .pg-msg.cursor .pg-bubble::after{content:"▍";color:var(--accent);animation:pgblink 1s steps(2) infinite}
  @keyframes pgblink{50%{opacity:0}}
  .pg-bubble .pg-run{display:block;margin-top:7px;font-family:var(--mono);font-size:10.5px;color:var(--text-3)}
  .pg-input{border-top:1px solid var(--line);padding:14px 16px;background:var(--surface)}
  .pg-input-row{display:flex;gap:10px;align-items:flex-end}
  .pg-input-row textarea{min-height:52px;max-height:140px;resize:none}
  .pg-foot{display:flex;justify-content:space-between;align-items:center;padding-top:9px}
  .pg-status{font-size:11.5px;color:var(--text-3);font-family:var(--mono)}
  .pg-empty{color:var(--text-3);font-size:13px;text-align:center;padding:44px 20px}
.pg-tools{background:var(--warn-dim);border:1px solid var(--warn-line);border-radius:var(--r);color:var(--text-2);
  font:11.5px/1.6 var(--mono);padding:9px 11px;margin:8px 0 0;white-space:pre-wrap;word-break:break-word;max-height:260px;overflow:auto}
</style>
<div class="page-head">
  <div><h1>Playground</h1><p class="page-sub">Chat against any provider: every turn is recorded as a run</p></div>
</div>
<div class="pg-layout">
  <div class="pg-rail">
    <div class="panel"><div class="panel-head"><span class="panel-title">Connection</span></div>
      <div style="padding:16px 18px">
        <div class="field"><label for="pg-provider">Provider</label>
          <select id="pg-provider"><option value="">Loading…</option></select></div>
        <div class="field"><label for="pg-base">Base URL</label>
          <input id="pg-base" type="text" autocomplete="off" placeholder="https://api.openai.com/v1"></div>
        <div class="field"><label for="pg-key">Provider API key</label>
          <input id="pg-key" type="password" autocomplete="off" placeholder="sk-…" spellcheck="false"></div>
        <div class="field"><label for="pg-model">Model</label>
          <input id="pg-model" type="text" list="pg-models" autocomplete="off" placeholder="model name"></div>
        <datalist id="pg-models"></datalist>
        <div class="field"><label for="pg-temp">Temperature</label>
          <div class="temp-row"><input id="pg-temp" type="range" min="0" max="1" step="0.05" value="0.7">
            <span class="temp-val" id="pg-temp-val">0.7</span></div></div>
        <div class="field"><label for="pg-system">System prompt</label>
          <textarea id="pg-system" spellcheck="false" placeholder="You are a helpful assistant."></textarea></div>
        <button class="btn btn-ghost" style="width:100%" onclick="pgNewChat()">New chat</button>
      </div>
    </div>
  </div>
  <div class="panel pg-chat">
    <div class="panel-head"><span class="panel-title">Conversation</span>
      <span class="panel-note" id="pg-session-note"></span></div>
    <div class="pg-track" id="pg-track"><div class="pg-empty" id="pg-empty">Say something to start a conversation. Each turn is logged to Runs as source <b>playground</b> and tagged with its session.</div></div>
    <div class="pg-input">
      <div class="pg-input-row">
        <textarea id="pg-input" placeholder="Type a message… press Enter to send"></textarea>
        <button class="btn btn-primary" id="pg-send" onclick="pgSend()">Send</button>
      </div>
      <div class="pg-foot" style="gap:10px;flex-wrap:wrap;align-items:center">
        <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--text-3)"><input type="checkbox" id="pg-compare">Compare</label>
        <input id="pg-model-b" type="text" list="pg-models" placeholder="second model" autocomplete="off" style="display:none;max-width:190px;background:var(--bg);border:1px solid var(--line-2);color:var(--text);border-radius:var(--r);padding:6px 9px;font-size:12.5px">
        <span class="pg-status" id="pg-status"></span><span class="pg-status" id="pg-hint"></span>
      </div>
    </div>
  </div>
</div>
<script>
  const key=localStorage.getItem("torrix_key");
  const el=(id)=>document.getElementById(id);
  const sel=el("pg-provider"),baseEl=el("pg-base"),keyEl=el("pg-key"),modelEl=el("pg-model"),
    tempEl=el("pg-temp"),tempVal=el("pg-temp-val"),sysEl=el("pg-system"),
    track=el("pg-track"),inputEl=el("pg-input"),sendEl=el("pg-send"),
    statusEl=el("pg-status"),hintEl=el("pg-hint"),sessionNote=el("pg-session-note"),
    compareEl=el("pg-compare"),modelBEl=el("pg-model-b");
  let emptyEl=el("pg-empty"),meta=null,prov=null,history=[],sessionId=newPgId(),busy=false;
  function newPgId(){return "pg-"+crypto.randomUUID();}
  compareEl.onchange=()=>{modelBEl.style.display=compareEl.checked?"block":"none";if(compareEl.checked&&!modelBEl.value)modelBEl.value=modelEl.value;};
  const CONV_KEY="torrix_pg_conv";
  function saveConv(){try{localStorage.setItem(CONV_KEY,JSON.stringify({sessionId:sessionId,history:history}))}catch(e){}}
  function restoreConv(){
    try{
      const raw=localStorage.getItem(CONV_KEY);if(!raw)return;
      const conv=JSON.parse(raw);
      if(!conv||!conv.sessionId||!Array.isArray(conv.history)||!conv.history.length)return;
      sessionId=conv.sessionId;history=conv.history;
      for(const msg of history){addMsg(msg.role==="user"?"user":"assistant",String(msg.content||""));}
      sessionNote.textContent="restored · "+sessionId.slice(0,12);
      void refreshSessionStats();
    }catch(e){}
  }
  async function refreshSessionStats(){
    try{
      const res=await fetch("/api/runs?session="+encodeURIComponent(sessionId)+"&limit=50",{headers:{authorization:"Bearer "+key}});
      if(!res.ok)return;
      const j=await res.json();let cost=0,tokens=0,turns=0;
      for(const run of (j.runs||[])){cost+=Number(run.cost_usd||0);tokens+=(run.input_tokens||0)+(run.output_tokens||0);turns+=1;}
      sessionNote.textContent="session · "+sessionId.slice(0,12)+" · "+turns+" turn"+(turns===1?"":"s")+" · "+tokens.toLocaleString()+" tokens · $"+cost.toFixed(6);
    }catch(e){}
  }
  if(!key){sendEl.disabled=true;inputEl.disabled=true;hintEl.textContent="Sign in from the login page first.";}
  tempEl.oninput=()=>{tempVal.textContent=tempEl.value;};
  async function fetchMeta(){
    const r=await fetch("/api/playground/meta",{headers:{authorization:"Bearer "+key}});
    if(!r.ok){hintEl.textContent="Could not load providers.";return;}
    meta=await r.json();
    sel.innerHTML="";
    for(const p of meta.providers){const o=document.createElement("option");o.value=p.id;o.textContent=p.label;sel.appendChild(o);}
    sel.onchange=()=>loadProv(sel.value);
    loadProv(sel.value);
  }
  function loadProv(id){
    prov=meta.providers.find(p=>p.id===id);
    baseEl.value=prov.baseUrl;
    keyEl.placeholder=prov.auth==="bearer"?"Bearer key…":(prov.auth==="x-api-key"?"x-api-key…":"x-goog-api-key…");
    keyEl.value=localStorage.getItem("pgkey."+prov.id)||"";
    const dl=el("pg-models");dl.innerHTML="";
    for(const m of prov.models){const o=document.createElement("option");o.value=m;dl.appendChild(o);}
    if(prov.models.length){modelEl.value=prov.models[0];}
  }
  function persistProv(){if(prov)localStorage.setItem("pgkey."+prov.id,keyEl.value);}
  function addMsg(role,content,extra){
    emptyEl.style.display="none";
    const wrap=document.createElement("div");wrap.className="pg-msg "+(role==="user"?"user":role==="error"?"error":"assistant");
    const av=document.createElement("div");av.className="pg-av";av.textContent=role==="user"?"You":(role==="error"?"!":"AI");
    const bub=document.createElement("div");bub.className="pg-bubble";
    const txt=document.createElement("span");txt.textContent=content;
    bub.appendChild(txt);
    if(extra&&extra.id){const rid=document.createElement("span");rid.className="pg-run";rid.textContent="logged · "+extra.id.slice(0,12);bub.appendChild(rid);}
    wrap.appendChild(av);wrap.appendChild(bub);
    track.appendChild(wrap);
    track.scrollTop=track.scrollHeight;
    return {bub,txt};
  }
  async function pgSend(){
    if(busy||!prov)return;
    const text=inputEl.value.trim();
    if(!text)return;
    persistProv();
    const primary=modelEl.value.trim()||(prov.models[0]||"");
    inputEl.value="";
    addMsg("user",text);
    history.push({role:"user",content:text});
    busy=true;sendEl.disabled=true;
    const models=[primary];
    if(compareEl.checked){
      const second=modelBEl.value.trim();
      if(second&&second!==primary)models.push(second);
    }
    try{
      for(const model of models){
        const m=addMsg("assistant","");
        m.bub.classList.add("cursor");
        if(models.length>1){
          const tag=document.createElement("span");tag.className="pg-run";tag.textContent=model;
          m.bub.insertBefore(tag,m.txt);
        }
        await runTurn(model,m);
      }
    }finally{
      busy=false;sendEl.disabled=false;inputEl.focus();
      saveConv();void refreshSessionStats();
    }
  }
  function describeError(j,status){
    var parts=[];
    function push(value){
      if(value==null)return;
      if(typeof value==="string"){if(value&&value!=="upstream_error")parts.push(value);return}
      if(typeof value==="object"){
        if(typeof value.message==="string")parts.push(value.message);
        else if(typeof value.type==="string")parts.push(value.type);
        else parts.push(JSON.stringify(value).slice(0,220));
        return;
      }
      parts.push(String(value));
    }
    if(j&&typeof j==="object"){push(j.error);push(j.detail);push(j.message)}
    if(!parts.length)parts.push("request rejected");
    return "HTTP "+status+" · "+parts.slice(0,2).join(" · ");
  }
  async function runTurn(model,m){
    const target=(baseEl.value.trim().replace(/[/]+$/,""))+prov.endpoint.replace("{model}",encodeURIComponent(model));
    const body=buildBody(model);
    const headers={authorization:"Bearer "+key,"content-type":"application/json",
      "x-target-url":target,
      "x-torrix-provider":prov.id==="custom"?"openai":prov.id,
      "x-torrix-source":"playground",
      "x-torrix-session":sessionId,
      "x-torrix-name":"Playground · "+model,
      "x-torrix-tags":"tool=playground,"+"provider="+prov.id};
    if(prov.auth==="bearer")headers["x-upstream-authorization"]="Bearer "+keyEl.value.trim();
    else if(prov.auth==="x-api-key"){headers["x-api-key"]=keyEl.value.trim();headers["anthropic-version"]="2023-06-01";}
    else headers["x-goog-api-key"]=keyEl.value.trim();
    statusEl.textContent="calling "+model+"…";
    try{
      const res=await fetch("/proxy",{method:"POST",headers,body:JSON.stringify(body)});
      const rid=res.headers.get("x-torrix-run-id")||"";
      if(!res.ok){
        const j=await res.json().catch(()=>({}));
        const message=describeError(j,res.status);
        statusEl.textContent="";
        m.bub.classList.remove("cursor");m.bub.classList.add("error");
        m.txt.textContent=message;
        if(rid)history.push({role:"assistant",content:"(error) "+message});
        return;
      }
      statusEl.textContent=rid?"logged · "+rid.slice(0,12):"";
      if(body.stream)await streamBody(res,m);else await plainBody(res,m);
      if(rid){const chip=document.createElement("span");chip.className="pg-run";chip.textContent="run "+rid.slice(0,8);m.bub.appendChild(chip);}
    }catch(err){
      statusEl.textContent="";
      m.bub.classList.remove("cursor");m.bub.classList.add("error");
      m.txt.textContent="Request failed: "+err.message;
    }finally{
      m.bub.classList.remove("cursor");
    }
  }
  function buildBody(model){
    const temp=parseFloat(tempEl.value)||0.7;
    const sys=sysEl.value.trim();
    if(prov.format==="anthropic"){
      const msgs=history.map(h=>({role:h.role==="user"?"user":"assistant",content:h.content}));
      const b={model:model,max_tokens:1024,temperature:temp,stream:true,messages:msgs};
      if(sys)b.system=sys;
      return b;
    }
    if(prov.format==="gemini"){
      const contents=history.map(h=>({role:h.role==="user"?"user":"model",parts:[{text:h.content}]}));
      const b={contents:contents,generationConfig:{temperature:temp,maxOutputTokens:1024}};
      if(sys)b.systemInstruction={parts:[{text:sys}]};
      return b;
    }
    const msgs=[];
    if(sys)msgs.push({role:"system",content:sys});
    for(const h of history)msgs.push({role:h.role,content:h.content});
    return {model:model,messages:msgs,stream:true,stream_options:{include_usage:true},temperature:temp,max_tokens:1024};
  }
  function chunkTxt(c){
    if(c.choices){const d=c.choices[0];if(d&&d.delta&&typeof d.delta.content==="string")return d.delta.content;}
    if(c.type==="content_block_delta"){const cb=c.content_block_delta;if(cb&&cb.delta&&cb.delta.type==="text"&&typeof cb.delta.text==="string")return cb.delta.text;}
    return "";
  }
  function streamTools(c,state){
    let changed=false;
    const d=c.choices&&c.choices[0]&&c.choices[0].delta;
    if(d&&Array.isArray(d.tool_calls)){
      for(const tc of d.tool_calls){
        const idx=tc.index!=null?tc.index:0;
        state[idx]=state[idx]||{name:"",args:""};
        const fn=tc.function||{};
        if(fn.name)state[idx].name+=fn.name;
        if(fn.arguments)state[idx].args+=fn.arguments;
        changed=true;
      }
    }
    if(c.type==="content_block_start"&&c.content_block&&c.content_block.type==="tool_use"){
      const idx=c.index!=null?c.index:0;
      state[idx]=state[idx]||{name:c.content_block.name||"tool",args:""};
      changed=true;
    }
    if(c.type==="content_block_delta"&&c.content_block_delta&&c.content_block_delta.delta
      &&c.content_block_delta.delta.type==="input_json_delta"&&c.content_block_delta.delta.partial_json){
      const idx=c.index!=null?c.index:0;
      state[idx]=state[idx]||{name:"tool",args:""};
      state[idx].args+=c.content_block_delta.delta.partial_json;
      changed=true;
    }
    return changed;
  }
  function renderTools(m,state){
    let block=m.bub.querySelector(".pg-tools");
    if(!block){block=document.createElement("pre");block.className="pg-tools";m.bub.appendChild(block);}
    block.textContent=Object.keys(state).sort().map((key)=>{
      const tool=state[key];
      let args=tool.args;
      try{args=JSON.stringify(JSON.parse(tool.args),null,2);}catch(e){}
      return (tool.name||"tool")+":\\n"+args;
    }).join("\\n\\n");
  }
  async function streamBody(res,m){
    let acc="";
    const tools={};
    const reader=res.body.getReader();const dec=new TextDecoder();let buf="";
    for(;;){
      const {done,value}=await reader.read();if(done)break;
      buf+=dec.decode(value,{stream:true});
      while(buf.indexOf("\\n")!==-1){
        const idx=buf.indexOf("\\n");const line=buf.slice(0,idx);buf=buf.slice(idx+1);
        if(!line.startsWith("data:"))continue;
        const payload=line.slice(5).trim();
        if(payload==="[DONE]")continue;
        let c;try{c=JSON.parse(payload);}catch{continue;}
        const t=chunkTxt(c);
        if(t){acc+=t;m.txt.textContent=acc;}
        if(streamTools(c,tools))renderTools(m,tools);
      }
    }
    m.txt.textContent=acc;
    if(acc)history.push({role:"assistant",content:acc});
  }
  async function plainBody(res,m){
    let acc="";
    try{
      const j=await res.json();
      if(prov.format==="gemini"){const parts=(j.candidates&&j.candidates[0]&&j.candidates[0].content&&j.candidates[0].content.parts)||[];for(const p of parts)acc+=p.text||"";}
      else if(j.choices&&j.choices[0]&&j.choices[0].message)acc=j.choices[0].message.content||"";
      else if(j.content&&Array.isArray(j.content)){for(const b of j.content)acc+=(b.text||"");}
    }catch(e){acc="(unreadable response)";}
    m.txt.textContent=acc;
    if(acc)history.push({role:"assistant",content:acc});
  }
  function pgNewChat(){
    history=[];sessionId=newPgId();sessionNote.textContent="new session · "+sessionId.slice(0,12);
    try{localStorage.removeItem(CONV_KEY)}catch(e){}
    track.innerHTML="";
    const ne=document.createElement("div");ne.className="pg-empty";ne.id="pg-empty";ne.innerHTML='Say something to start a conversation. Each turn is logged to Runs as source <b>playground</b> and tagged with its session.';
    track.appendChild(ne);emptyEl=ne;
    emptyEl.style.display="";
    statusEl.textContent="";
  }
  inputEl.addEventListener("keydown",(e)=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();pgSend();}});
  sessionNote.textContent="session · "+sessionId.slice(0,12);
  const qpPrompt=new URLSearchParams(location.search).get("prompt");
  if(qpPrompt){inputEl.value=qpPrompt;}
  restoreConv();
  fetchMeta().catch(e=>{hintEl.textContent="Failed to load: "+e.message;});
</script>`;
}

interface RunNav {
  parents: Run[];
  prev: Run | null;
  next: Run | null;
  position: number;
  total: number;
}

function runDetailBody(run: Run, events: Events[], children: Run[] = [], judgeSlot = "", nav: RunNav | null = null): string {
  const totalTokens = (run.input_tokens ?? 0) + (run.output_tokens ?? 0);
  const retrievalDocs = safeJsonArray(run.retrieval_docs);
  const mediaAssets = safeJsonArray(run.media_assets);
  const cells: Array<[label: string, value: string, mono?: boolean]> = [
    ["Run ID", run.id, true],
    ["Created", `${shortDate(run.created_at)} · ${relTime(run.created_at)}`, true],
    ["Source", run.source ?? "-"],
    ["Provider", run.provider ?? "-"],
    ["Model", run.model ?? run.routed_from ?? "-", true],
    ["Routing", run.routed_from ? `${run.routed_from} → ${run.model ?? "?"}` : "-", true],
    ["Fallback used", run.fallback_used ? "yes" : "no"],
    ["Status", run.status != null ? String(run.status) : "-"],
    ["Finish reason", run.finish_reason ?? "-"],
    ["Input tokens", (run.input_tokens ?? 0).toLocaleString(), true],
    ["Output tokens", (run.output_tokens ?? 0).toLocaleString(), true],
    ["Thinking tokens", (run.thinking_tokens ?? 0).toLocaleString(), true],
    ["Total tokens", totalTokens.toLocaleString(), true],
    ["Cost", fmtUsd(run.cost_usd), true],
    ["Latency", fmtMs(run.latency_ms), true],
    ["Agent", run.agent_name ?? "-"],
    ["End user", run.end_user_id ?? "-"],
    ["Trace", run.trace_id ? truncate(run.trace_id, 26) : "-", true],
    ["Session", run.session_id ? truncate(run.session_id, 26) : "-", true],
    ["Parent run", run.parent_run_id ? truncate(run.parent_run_id, 26) : "-", true],
    ["Target", run.target_url ?? "-"],
    ["Retrieval docs", retrievalDocs.length ? String(retrievalDocs.length) : "-"],
    ["Media", run.media_count ? String(run.media_count) : "-"],
    ["JSON parsed", run.json_parse_ok == null ? "-" : run.json_parse_ok ? "yes" : "no"],
  ];
  const grid = cells
    .map(([label, value, mono]) => {
      const full = label === "Run ID" ? run.id : label === "Trace" ? run.trace_id ?? "" : label === "Session" ? run.session_id ?? "" : "";
      const tooltip = full ? ` title="${escapeHtml(full)}"` : "";
      const copy =
        label === "Run ID"
          ? `<button class="btn btn-ghost btn-icon meta-copy" title="Copy run id" onclick="event.stopPropagation();navigator.clipboard.writeText('${escapeHtml(run.id)}')">${ICON_COPY}</button>`
          : "";
      return `<div class="cell">${copy}<div class="meta-label">${escapeHtml(label)}</div><div class="meta-val${mono ? " mono" : ""}"${tooltip}>${escapeHtml(value)}</div></div>`;
    })
    .join("");

  const thinkingEvents = events.filter((e) => e.type === "thinking");
  const toolEvents = events.filter((e) => e.type === "tool_call");
  const timelineEvents = events.filter((e) => e.type !== "thinking" && e.type !== "tool_call");
  const promptText = events.find((e) => e.type === "request")?.message ?? events.find((e) => e.type === "prompt")?.message ?? run.request_body ?? "";
  const responseText = events
    .filter((e) => e.type === "response")
    .map((e) => e.message)
    .join("\n\n");
  const firstEventAt = timelineEvents.length ? Date.parse(timelineEvents[0].created_at) : Number.NaN;
  const timelineBody = timelineEvents.length
    ? timelineEvents
        .map((e) => {
          const deltaMs = Date.parse(e.created_at) - firstEventAt;
          const delta = Number.isFinite(deltaMs) ? `+${deltaMs >= 1000 ? `${(deltaMs / 1000).toFixed(1)}s` : `${Math.max(0, Math.round(deltaMs))}ms`}` : "";
          return `<div class="t-item"><span class="t-dot ${escapeHtml(e.type)}"></span>
            <div class="t-head"><span class="t-type">${escapeHtml(e.type)}</span><span class="t-time">${escapeHtml(shortDate(e.created_at))}${delta ? ` · ${delta}` : ""} <button class="ev-copy" type="button" data-ev="${escapeHtml(truncate(e.message, 6000))}" title="Copy event text">${ICON_COPY}</button></span></div>
            <div class="t-msg">${escapeHtml(e.message)}</div>
          </div>`;
        })
        .join("")
    : `<div style="padding:16px 0">${emptyState("No events", "Nothing was recorded for this run.")}</div>`;

  const score = run.score == null ? null : Number(run.score) >= 1 ? "good" : "bad";
  const reviewState = run.review_state ?? null;
  const findings = safeJsonArray(run.pii_findings);
  const flags = safeJsonArray(run.policy_flags);
  const guardrailAction = safeJsonObject(run.tags)?.torrix_guardrail;
  const traceHref = run.trace_id ? `/ui/traces/${encodeURIComponent(run.trace_id)}` : null;
  const sessionHref = run.session_id ? `/ui/sessions/${encodeURIComponent(run.session_id)}` : null;

  const governanceChips = [
    score ? `<span class="badge ${score === "good" ? "good" : "bad"}"><span class="dot"></span>${score}</span>` : `<span class="badge neutral">unscored</span>`,
    run.is_golden ? `<span class="badge accent"><span class="dot"></span>golden</span>` : "",
    typeof guardrailAction === "string" ? `<span class="badge warn" title="guardrail action: ${escapeHtml(guardrailAction)}"><span class="dot"></span>guardrail</span>` : "",
    reviewState ? `<span class="badge ${reviewState === "approved" ? "good" : reviewState === "rejected" ? "bad" : "warn"}"><span class="dot"></span>review ${escapeHtml(reviewState)}</span>` : "",
    run.pii_masked ? `<span class="badge warn"><span class="dot"></span>PII masked</span>` : "",
    flags.length ? `<span class="badge warn"><span class="dot"></span>${flags.length} policy flag${flags.length === 1 ? "" : "s"}</span>` : "",
    run.share_token ? `<span class="badge neutral">shared</span>` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const governancePanel = `
    <div class="panel"><div class="panel-head"><span class="panel-title">Review &amp; notes</span><span class="panel-note" id="rd-status"></span></div>
      <div class="panel-body">
        <div class="rd-actions">
          <button class="btn btn-ghost" id="rd-good" data-score="good">Mark good</button>
          <button class="btn btn-ghost" id="rd-bad" data-score="bad">Mark bad</button>
          <button class="btn btn-ghost" id="rd-clear" data-score="unscored">Clear score</button>
          <button class="btn btn-ghost" id="rd-golden">${run.is_golden ? "Unmark golden" : "Mark golden"}</button>
          <button class="btn btn-ghost" id="rd-replay">Replay</button>
          <button class="btn btn-ghost" id="rd-cost">Cost comparison</button>
          <button class="btn btn-ghost" id="rd-compare">Compare</button>
          ${promptText ? `<button class="btn btn-ghost" id="rd-playground" data-prompt="${escapeHtml(truncate(promptText, 2000))}">Open in Playground</button>` : ""}
        </div>
        <div class="rd-form">
          <label for="rd-score-note">Score note</label>
          <input id="rd-score-note" type="text" value="${escapeHtml(run.score_note ?? "")}" placeholder="Why this score?" autocomplete="off">
          <label for="rd-run-note">Run note</label>
          <textarea id="rd-run-note" placeholder="Notes for your team">${escapeHtml(run.run_note ?? "")}</textarea>
          <div class="rd-actions">
            <button class="btn btn-primary" id="rd-save">Save notes</button>
            <button class="btn btn-ghost" id="rd-share">${run.share_token ? "Regenerate share link" : "Create share link"}</button>
            ${run.share_token ? '<button class="btn btn-ghost" id="rd-unshare">Revoke share</button>' : ""}
            ${run.is_golden ? '<button class="btn btn-ghost" id="rd-golden-export">Export golden JSONL</button>' : ""}
          </div>
          <div class="rd-share" id="rd-share-out">${run.share_token ? `<code>${escapeHtml(run.share_token)}</code>` : ""}</div>
        </div>
        ${findings.length ? `<div class="rd-findings"><b>PII findings:</b> ${findings.map((f) => `${escapeHtml(String(f.type))} ×${Number(f.count ?? 0)}`).join(", ")}</div>` : ""}
        ${flags.length ? `<div class="rd-findings"><b>Policy flags:</b> ${flags.map((f) => `${escapeHtml(String(f.policyName ?? "policy"))} (${escapeHtml(String(f.action ?? ""))})`).join(", ")}</div>` : ""}
      </div>
    </div>`;

  const costPanel = `<div class="panel" id="rd-cost-panel" style="display:none"><div class="panel-head"><span class="panel-title">Cost comparison</span><span class="panel-note">same token counts at every known model rate</span></div>
    <div class="panel-body" id="rd-cost-body"></div>
  </div>`;

  const actionScript = `<script>(function(){
  var runId=${JSON.stringify(run.id)};
  var statusEl=document.getElementById("rd-status");
  function key(){return localStorage.getItem("torrix_key")||""}
  function api(path,opts){opts=opts||{};opts.headers=Object.assign({"content-type":"application/json",authorization:"Bearer "+key()},opts.headers||{});return fetch(path,opts).then(function(r){return r.json().then(function(j){return {ok:r.ok,status:r.status,body:j}})})}
  function note(msg,err){statusEl.textContent=msg;statusEl.style.color=err?"var(--bad)":"var(--good)";setTimeout(function(){statusEl.textContent=""},3500)}
  function patch(fields){return api("/api/runs/"+runId,{method:"PATCH",body:JSON.stringify(fields)}).then(function(r){if(!r.ok){note(r.body.error||"update failed",true);return false}return true})}
  document.getElementById("rd-good").addEventListener("click",function(){patch({score:"good"}).then(function(ok){if(ok)note("scored good")})});
  document.getElementById("rd-bad").addEventListener("click",function(){patch({score:"bad"}).then(function(ok){if(ok)note("scored bad")})});
  document.getElementById("rd-clear").addEventListener("click",function(){patch({score:"unscored"}).then(function(ok){if(ok)note("score cleared")})});
  document.getElementById("rd-golden").addEventListener("click",function(){patch({is_golden:${run.is_golden ? "false" : "true"}}).then(function(ok){if(ok)location.reload()})});
  document.getElementById("rd-save").addEventListener("click",function(){
    patch({score_note:document.getElementById("rd-score-note").value,run_note:document.getElementById("rd-run-note").value}).then(function(ok){if(ok)note("notes saved")});
  });
  document.getElementById("rd-share").addEventListener("click",function(){
    api("/api/runs/"+runId+"/share",{method:"POST",body:JSON.stringify({})}).then(function(r){
      if(!r.ok){note(r.body.error||"share failed",true);return}
      var url=location.origin+r.body.path;
      document.getElementById("rd-share-out").innerHTML='<code>'+url.replace(/</g,"&lt;")+'</code>';
      note("share link ready");
    });
  });
  var un=document.getElementById("rd-unshare");
  if(un)un.addEventListener("click",function(){
    api("/api/runs/"+runId+"/share",{method:"DELETE"}).then(function(r){if(r.ok)location.reload();else note("revoke failed",true)});
  });
  var goldenExport=document.getElementById("rd-golden-export");
  if(goldenExport)goldenExport.addEventListener("click",function(){
    fetch("/api/runs/golden/export",{headers:{authorization:"Bearer "+key()}}).then(function(res){
      if(!res.ok){note("export failed",true);return}
      return res.blob().then(function(blob){
        var a=document.createElement("a");
        a.href=URL.createObjectURL(blob);
        a.download="torrix-golden.jsonl";
        document.body.appendChild(a);a.click();a.remove();
        URL.revokeObjectURL(a.href);
      });
    });
  });
  var replayBtn=document.getElementById("rd-replay");
  if(replayBtn)replayBtn.addEventListener("click",function(){
    replayBtn.disabled=true;note("replaying…");
    api("/api/runs/"+runId+"/replay",{method:"POST",body:JSON.stringify({})}).then(function(r){
      replayBtn.disabled=false;
      if(!r.ok){note(r.body.error||"replay failed",true);return}
      location.href="/ui/runs/"+r.body.run_id;
    });
  });
  var costBtn=document.getElementById("rd-cost");
  if(costBtn)costBtn.addEventListener("click",function(){
    var panel=document.getElementById("rd-cost-panel"),body=document.getElementById("rd-cost-body");
    panel.style.display="block";body.textContent="loading…";
    api("/api/runs/"+runId+"/cost-comparison",{}).then(function(r){
      if(!r.ok){body.textContent="failed";return}
      var usd=function(n){return "$"+Number(n||0).toFixed(4)};
      var rows=(r.body.models||[]).slice(0,15).map(function(m){return '<tr><td class="mono">'+m.model+'</td><td class="num">'+usd(m.estimatedCost)+'</td></tr>'}).join("");
      body.innerHTML='<table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left">Model</th><th style="text-align:right">Estimated cost</th></tr></thead><tbody>'+rows+'</tbody></table><p class="panel-note" style="margin-top:8px">This run: '+usd(r.body.current_cost_usd)+' on '+String(r.body.current_model||"unknown")+'.</p>';
    });
  });
  var compareBtn=document.getElementById("rd-compare");
  if(compareBtn)compareBtn.addEventListener("click",function(){
    var other=prompt("Run id to compare with this one");
    if(!other)return;
    location.href="/ui/compare?ids="+encodeURIComponent(runId)+","+encodeURIComponent(other.trim());
  });
  var pgBtn=document.getElementById("rd-playground");
  if(pgBtn)pgBtn.addEventListener("click",function(){
    location.href="/ui/playground?prompt="+encodeURIComponent(pgBtn.getAttribute("data-prompt")||"");
  });
  document.querySelectorAll(".ev-copy").forEach(function(btn){
    btn.addEventListener("click",function(event){
      event.stopPropagation();
      var text=btn.getAttribute("data-ev")||"";
      try{
        navigator.clipboard.writeText(text).then(function(){note("event copied")},function(){note("copy blocked",true)});
      }catch(err){note("copy blocked",true)}
    });
  });
})();</script>`;

  const retrievalPanel = retrievalDocs.length
    ? `<div class="panel"><div class="panel-head"><span class="panel-title"><span class="sig"></span>Retrieved context</span><span class="panel-note">${retrievalDocs.length} chunk${retrievalDocs.length === 1 ? "" : "s"} sent with the request</span></div>
      <div class="rd-docs">${retrievalDocs
        .map((doc, i) => {
          const text = String(doc.text ?? doc.content ?? doc.chunk ?? doc.page_content ?? JSON.stringify(doc));
          const source = doc.source ?? doc.title ?? doc.url ?? doc.id ?? null;
          const score = doc.score ?? doc.relevance ?? doc.similarity ?? null;
          return `<div class="rd-doc">
            <div class="rd-doc-head"><span class="rd-doc-idx">#${i + 1}</span>${source != null ? `<span class="chip chip-mono">${escapeHtml(truncate(String(source), 56))}</span>` : ""}${score != null ? `<span class="score-badge none">${escapeHtml(String(score))}</span>` : ""}</div>
            <div class="rd-doc-text">${escapeHtml(truncate(text, 700))}</div>
          </div>`;
        })
        .join("")}</div>
    </div>`
    : "";

  const mediaPanel = mediaAssets.length
    ? `<div class="panel"><div class="panel-head"><span class="panel-title"><span class="sig"></span>Media assets</span><span class="panel-note">${mediaAssets.length} part${mediaAssets.length === 1 ? "" : "s"} · stored on this host</span></div>
      <div class="rd-docs">${mediaAssets
        .map((asset, i) => {
          const kind = String(asset.kind ?? "file");
          const mime = asset.mime != null ? String(asset.mime) : "unknown";
          const bytes = Number(asset.bytes ?? 0);
          const sha = String(asset.sha256 ?? "");
          const isStored = asset.stored_path != null;
          const stored = isStored ? String(asset.stored_path) : String(asset.ref ?? "");
          const href = `/ui/runs/${encodeURIComponent(run.id)}/media/${i}`;
          const preview = !isStored
            ? ""
            : kind === "image"
              ? `<div class="media-preview"><a href="${href}" target="_blank" rel="noopener"><img class="media-thumb" src="${href}" alt="${escapeHtml(mime)}" loading="lazy"></a></div>`
              : kind === "audio"
                ? `<div class="media-preview"><audio class="media-audio" controls preload="none" src="${href}"></audio></div>`
                : `<div class="media-preview"><a class="btn btn-ghost" href="${href}" target="_blank" rel="noopener">Open ${escapeHtml(kind)}</a></div>`;
          return `<div class="rd-doc">
            <div class="rd-doc-head"><span class="rd-doc-idx">#${i + 1}</span><span class="chip chip-mono">${escapeHtml(kind)}</span><span class="chip chip-mono">${escapeHtml(mime)}</span>${bytes > 0 ? `<span class="chip chip-mono">${fmtBytes(bytes)}</span>` : ""}${isStored ? "" : '<span class="chip" title="Remote reference only; bytes were not downloaded">remote</span>'}</div>
            ${preview}
            <div class="rd-doc-text">sha256 ${escapeHtml(sha.slice(0, 24))}…${stored ? `\n${escapeHtml(stored)}` : ""}</div>
          </div>`;
        })
        .join("")}</div>
    </div>`
    : "";

  const promptPanel = promptText
    ? `<div class="panel"><div class="panel-head"><span class="panel-title"><span class="sig"></span>Prompt</span><button class="btn btn-ghost" type="button" onclick="navigator.clipboard.writeText(document.getElementById('rd-prompt').textContent)">Copy</button></div>
      <div style="padding:12px 16px"><pre class="rd-code" id="rd-prompt">${escapeHtml(truncate(promptText, 20000))}</pre></div></div>`
    : "";
  const responsePanel = responseText
    ? `<div class="panel"><div class="panel-head"><span class="panel-title"><span class="sig"></span>Response</span><button class="btn btn-ghost" type="button" onclick="navigator.clipboard.writeText(document.getElementById('rd-response').textContent)">Copy</button></div>
      <div style="padding:12px 16px"><pre class="rd-code" id="rd-response">${escapeHtml(truncate(responseText, 40000))}</pre></div></div>`
    : "";

  const reasoningPanel = thinkingEvents.length
    ? `<div class="panel"><div class="panel-head"><span class="panel-title"><span class="sig"></span>Reasoning</span><span class="panel-note">${thinkingEvents.length} segment${thinkingEvents.length === 1 ? "" : "s"}${run.thinking_tokens ? ` · ${fmtTokens(run.thinking_tokens)} thinking tokens` : ""}</span></div>
      <div class="rd-docs">${thinkingEvents.map((e) => `<div class="rd-doc"><div class="rd-doc-text">${escapeHtml(e.message)}</div></div>`).join("")}</div></div>`
    : "";

  const toolCallViews: Array<{ name: string; args: string }> = [];
  for (const e of toolEvents) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(e.message) as unknown;
    } catch {
      parsed = null;
    }
    if (Array.isArray(parsed)) {
      for (const raw of parsed) {
        const entry = (raw ?? {}) as Record<string, unknown>;
        toolCallViews.push({
          name: String(entry.name ?? "tool"),
          args: typeof entry.arguments === "string" ? entry.arguments : JSON.stringify(entry.arguments ?? {}, null, 2),
        });
      }
    } else {
      toolCallViews.push({ name: "tool call", args: e.message });
    }
  }
  const prettyArgs = (raw: string): string => {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  };
  const toolCallsPanel = toolCallViews.length
    ? `<div class="panel"><div class="panel-head"><span class="panel-title"><span class="sig"></span>Tool calls</span><span class="panel-note">${toolCallViews.length} call${toolCallViews.length === 1 ? "" : "s"}</span></div>
      <div class="rd-docs">${toolCallViews.map((call, i) => `<div class="rd-doc"><div class="rd-doc-head"><span class="rd-doc-idx">#${i + 1}</span><span class="chip chip-mono">${escapeHtml(call.name)}</span></div><div class="rd-doc-text mono">${escapeHtml(prettyArgs(call.args))}</div></div>`).join("")}</div></div>`
    : "";

  const childrenPanel = children.length
    ? `<div class="panel"><div class="panel-head"><span class="panel-title"><span class="sig"></span>Subagent runs</span><span class="panel-note">${children.length} run${children.length === 1 ? "" : "s"} linked to this run</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Time</th><th>Run</th><th>Agent</th><th>Model</th><th class="num">Cost</th><th>Status</th></tr></thead>
        <tbody>${children
          .map(
            (c) => `<tr class="clickable" onclick="location.href='/ui/runs/${c.id}'">
            <td class="mono" style="color:var(--text-3);font-size:12px">${relTime(c.created_at)}</td>
            <td><span class="tcell-primary">${escapeHtml(truncate(c.name ?? "untitled", 46))}</span></td>
            <td>${c.agent_name ? treeAgentChip(c.agent_name) : '<span class="badge neutral">-</span>'}</td>
            <td>${clusterLabel(c.model)}</td>
            <td class="num">${fmtUsd(c.cost_usd)}</td>
            <td>${statusBadge(c.status, c.finish_reason)}</td>
          </tr>`,
          )
          .join("")}</tbody>
      </table></div></div>`
    : "";

  const breadcrumb = nav
    ? `<div class="rd-breadcrumb">
        <a href="/ui/runs">Runs</a>
        ${nav.parents.map((parent) => `<span class="rd-crumb-sep">/</span><a href="/ui/runs/${encodeURIComponent(parent.id)}" title="${escapeHtml(parent.name ?? parent.agent_name ?? parent.id)}">${escapeHtml(truncate(parent.name ?? parent.agent_name ?? parent.id, 28))}</a>`).join("")}
        <span class="rd-crumb-sep">/</span><span class="rd-crumb-current">${escapeHtml(truncate(run.name ?? run.id, 32))}</span>
        ${
          nav.total > 1 && nav.position > 0
            ? `<span class="rd-stepper">
          ${nav.prev ? `<a class="btn btn-ghost" href="/ui/runs/${encodeURIComponent(nav.prev.id)}" title="${escapeHtml(nav.prev.name ?? nav.prev.id)}">← Previous</a>` : ""}
          <span class="panel-note">${nav.position} of ${nav.total} in ${run.trace_id ? "trace" : "session"}</span>
          ${nav.next ? `<a class="btn btn-ghost" href="/ui/runs/${encodeURIComponent(nav.next.id)}" title="${escapeHtml(nav.next.name ?? nav.next.id)}">Next →</a>` : ""}
        </span>`
            : ""
        }
      </div>`
    : "";

  return `<div>
    ${backLink("/ui/runs", "All runs")}
    ${breadcrumb}
    <div class="run-head">
      <div style="flex:1;min-width:220px">
        <h1 class="rh-title">${escapeHtml(run.name || run.model || "Run detail")}</h1>
        <div class="rh-chips">
          ${providerChip(run.provider)}
          <span class="badge accent"><span class="dot"></span>${escapeHtml(run.model ?? "unknown model")}</span>
          ${run.source ? `<span class="chip">${escapeHtml(run.source)}</span>` : ""}
          ${statusBadge(run.status, run.finish_reason)}
          ${run.is_anomaly ? '<span class="badge warn"><span class="dot"></span>anomaly</span>' : ""}
          ${governanceChips}
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:27px;font-weight:330;letter-spacing:-.04em;font-variant-numeric:tabular-nums">${fmtUsd(run.cost_usd)}</div>
        <div style="font-size:12px;color:var(--text-3)">${fmtTokens(totalTokens || null)} tokens · ${fmtMs(run.latency_ms)}</div>
        ${
          totalTokens > 0
            ? `<div class="tok-split" title="input ${(run.input_tokens ?? 0).toLocaleString()} · output ${(run.output_tokens ?? 0).toLocaleString()}"><i class="in" style="width:${Math.round(((run.input_tokens ?? 0) / totalTokens) * 100)}%"></i><i class="out" style="width:${100 - Math.round(((run.input_tokens ?? 0) / totalTokens) * 100)}%"></i></div>
               <div class="tok-legend"><span>in ${fmtTokens(run.input_tokens || null)}</span><span>out ${fmtTokens(run.output_tokens || null)}</span></div>`
            : ""
        }
      </div>
    </div>
    ${traceHref || sessionHref || run.parent_run_id ? `<div class="rd-links">${run.parent_run_id ? `<a class="btn btn-ghost" href="/ui/runs/${encodeURIComponent(run.parent_run_id)}">Parent run</a>` : ""}${traceHref ? `<a class="btn btn-ghost" href="${traceHref}">Open trace</a>` : ""}${sessionHref ? `<a class="btn btn-ghost" href="${sessionHref}">Open session</a>` : ""}</div>` : ""}
    <div class="metagrid">${grid}</div>
    ${promptPanel}
    ${responsePanel}
    ${reasoningPanel}
    ${toolCallsPanel}
    ${childrenPanel}
    ${governancePanel}
    ${judgeSlot || lockedPanel("judge")}
    ${costPanel}
    ${retrievalPanel}
    ${mediaPanel}
    <div class="panel"><div class="panel-head"><span class="panel-title">Events</span><span class="panel-note">${timelineEvents.length} recorded${thinkingEvents.length || toolEvents.length ? " · reasoning and tool calls above" : ""}</span></div>
      <div style="padding:6px 22px 18px"><div class="timeline">${timelineBody}</div></div>
    </div>
  </div>${actionScript}`;
}

function safeJsonArray(raw: string | null | undefined): Array<Record<string, unknown>> {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}

function safeJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function sharedRunPage(data: { run: Run; events: Events[] } | null, error: string | null): string {
  const shellCss = `:root{color-scheme:light;--bg:#f8fafc;--surface:#ffffff;--surface-2:#f1f5f9;--surface-3:#e2e8f0;--line:#e2e8f0;--line-2:#cbd5e1;
    --text:#0f172a;--text-2:#334155;--text-3:#64748b;--heading:#0f172a;--accent:#0284c7;--accent-dim:rgba(2,132,199,.08);
    --accent-line:rgba(2,132,199,.26);--good:#059669;--bad:#dc2626;--warn:#d97706;--r:6px;--r-lg:8px;
    --sans:"Geist",system-ui,-apple-system,sans-serif;--display:"Space Grotesk","Geist",system-ui,sans-serif;
    --mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
    --grid-dot:rgba(100,116,139,.12);--grid-dot-hot:#0284c7;--mx:-500px;--my:-500px}
    [data-theme="dark"]{color-scheme:dark;--bg:#0b101c;--surface:#141924;--surface-2:#1a2130;--surface-3:#202a3c;--line:#232c3d;--line-2:#33405a;
      --text:#d8e3fb;--text-2:#a9b7d0;--text-3:#7d8ba6;--heading:#f4f7ff;--accent:#38bdf8;--accent-dim:rgba(56,189,248,.10);
      --accent-line:rgba(56,189,248,.30);--good:#10b981;--bad:#ef4444;--warn:#f59e0b;
      --grid-dot:rgba(148,163,184,.14);--grid-dot-hot:#00d2ff}
    *{box-sizing:border-box} body{margin:0;color:var(--text);font:13.5px/1.55 var(--sans);letter-spacing:-.006em;
      background:var(--bg)}
    body::before{content:"";position:fixed;inset:0;z-index:-2;pointer-events:none;
      background-image:radial-gradient(circle,var(--grid-dot) 0.75px,transparent 0.75px);
      background-size:16px 16px}
    body::after{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;
      background-image:radial-gradient(circle,var(--grid-dot-hot) 1px,transparent 1px);
      background-size:16px 16px;
      -webkit-mask-image:radial-gradient(220px 220px at var(--mx) var(--my),rgba(0,0,0,.7) 0%,rgba(0,0,0,.22) 45%,transparent 80%);
      mask-image:radial-gradient(220px 220px at var(--mx) var(--my),rgba(0,0,0,.7) 0%,rgba(0,0,0,.22) 45%,transparent 80%)}
    @media(prefers-reduced-motion:reduce){body::after{display:none}}
    .wrap{max-width:860px;margin:0 auto;padding:32px 22px 56px}
    .brand{display:flex;align-items:center;gap:10px;color:var(--text-2);font-weight:600;margin-bottom:22px}
    .brand .brand-mark{width:24px;height:24px;border-radius:7px;object-fit:cover}
    .brand .theme-toggle{margin-left:auto;width:30px;height:30px;flex:0 0 30px;border:1px solid var(--line);border-radius:var(--r);
      background:var(--surface);color:var(--text-3);display:inline-flex;align-items:center;justify-content:center;padding:0;cursor:pointer}
    .brand .theme-toggle:hover{background:var(--surface-2);color:var(--text);border-color:var(--line-2)}
    .brand .theme-toggle svg{width:14px;height:14px}
    .brand .theme-toggle .ico-sun,.brand .theme-toggle .ico-moon{display:none}
    [data-theme="light"] .brand .theme-toggle .ico-moon{display:block}
    [data-theme="dark"] .brand .theme-toggle .ico-sun{display:block}
    h1{font-family:var(--display);font-size:22px;letter-spacing:-.022em;margin:0 0 10px;font-weight:600;color:var(--heading)}
    .chips{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:18px}
    .badge{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border-radius:4px;font-family:var(--mono);font-size:10px;font-weight:600;
      border:1px solid var(--line);color:var(--text-2);background:var(--surface-2)}
    .badge.accent{color:var(--accent);border-color:var(--accent-line);background:var(--accent-dim)}
    .meta{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px;margin-bottom:18px}
    .cell{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:10px 12px}
    .meta-label{font-family:var(--mono);font-size:9.5px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:.09em}
    .meta-val{font-size:13px;margin-top:3px;word-break:break-word}
    .mono{font-family:var(--mono);font-size:12px;color:var(--text-2)}
    .panel{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden}
    .panel-head{padding:12px 16px;border-bottom:1px solid var(--line);font-size:13px;font-weight:600}
    .t-item{padding:12px 16px;border-bottom:1px solid var(--line)}
    .t-item:last-child{border-bottom:0}
    .t-head{display:flex;justify-content:space-between;gap:10px;font-family:var(--mono);font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:.08em}
.ev-copy{background:transparent;border:0;color:var(--text-3);cursor:pointer;padding:0 1px;vertical-align:-2px}
.ev-copy:hover{color:var(--accent)}
.ev-copy svg{width:12px;height:12px}
    .t-msg{white-space:pre-wrap;word-break:break-word;margin-top:6px;font-size:13px;color:var(--text-2);
      background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r);padding:10px 12px}
    .err{padding:40px 0;text-align:center;color:var(--text-2)} .err b{display:block;font-size:16px;color:var(--text);margin-bottom:6px}
    .foot{margin-top:26px;font-family:var(--mono);font-size:10.5px;color:var(--text-3)}`;
  const brand = `<div class="brand"><img class="brand-mark" src="/ui/assets/torrix-logo.png" alt="" width="24" height="24"><span>Torrix · shared run</span>${themeToggleButton()}</div>`;
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <link rel="icon" type="image/png" href="/ui/assets/torrix-logo.png"><link rel="apple-touch-icon" href="/ui/assets/torrix-logo.png">
      <meta name="color-scheme" content="light dark"><meta name="theme-color" content="#f8fafc">
      ${THEME_BOOT}<meta name="robots" content="noindex,nofollow">`;
  if (!data) {
    return `<!doctype html><html lang="en"><head>${head}<title>Shared run: Torrix</title><style>${shellCss}</style></head>
      <body><div class="wrap">${brand}<div class="err"><b>Link unavailable</b>${escapeHtml(error ?? "This share link cannot be opened.")}</div>
      <div class="foot">Torrix: self-hosted LLM observability</div></div>${THEME_SCRIPT}</body></html>`;
  }
  const { run, events } = data;
  const totalTokens = (run.input_tokens ?? 0) + (run.output_tokens ?? 0);
  const cells: Array<[string, string, boolean?]> = [
    ["Model", run.model ?? "-", true],
    ["Provider", run.provider ?? "-"],
    ["Source", run.source ?? "-"],
    ["Created", `${shortDate(run.created_at)} · ${relTime(run.created_at)}`, true],
    ["Status", run.status != null ? String(run.status) : "-"],
    ["Total tokens", totalTokens.toLocaleString(), true],
    ["Cost", fmtUsd(run.cost_usd), true],
    ["Latency", fmtMs(run.latency_ms), true],
  ];
  const grid = cells
    .map(([label, value, mono]) => `<div class="cell"><div class="meta-label">${escapeHtml(label)}</div><div class="meta-val${mono ? " mono" : ""}">${escapeHtml(value)}</div></div>`)
    .join("");
  const timeline = events.length
    ? events
        .map(
          (e) => `<div class="t-item"><div class="t-head"><span>${escapeHtml(e.type)}</span><span>${escapeHtml(shortDate(e.created_at))}</span></div><div class="t-msg">${escapeHtml(e.message)}</div></div>`,
        )
        .join("")
    : `<div class="t-item"><div class="t-msg">No events recorded.</div></div>`;
  return `<!doctype html><html lang="en"><head>${head}<title>${escapeHtml(run.name || run.model || "Shared run")}: Torrix</title><style>${shellCss}</style></head>
    <body><div class="wrap">${brand}
      <h1>${escapeHtml(run.name || run.model || "Shared run")}</h1>
      <div class="chips"><span class="badge accent">${escapeHtml(run.model ?? "unknown model")}</span>${run.pii_masked ? '<span class="badge">PII masked</span>' : ""}</div>
      <div class="meta">${grid}</div>
      <div class="panel"><div class="panel-head">Events</div>${timeline}</div>
      <div class="foot">Shared read-only view · data stays on the operator's host</div>
    </div>${THEME_SCRIPT}</body></html>`;
}

async function collectDescendantRuns(repos: Repositories, userId: string, seed: Run[], max: number): Promise<Run[]> {
  const found: Run[] = [];
  const seen = new Set(seed.map((r) => r.id));
  let frontier = seed.map((r) => r.id);
  for (let depth = 0; depth < 8 && frontier.length && found.length < max; depth += 1) {
    const children = await repos.runs.listByParents(userId, frontier, Math.max(1, max - found.length));
    const next: string[] = [];
    for (const child of children) {
      if (seen.has(child.id)) {
        continue;
      }
      seen.add(child.id);
      found.push(child);
      next.push(child.id);
    }
    frontier = next;
  }
  return found;
}

interface RunEventStats {
  toolCalls: number;
  hasThinking: boolean;
}

function runEventStats(counts: RunEventCount[]): Map<string, RunEventStats> {
  const map = new Map<string, RunEventStats>();
  for (const row of counts) {
    const entry = map.get(row.runId) ?? { toolCalls: 0, hasThinking: false };
    if (row.type === "tool_call") {
      entry.toolCalls += row.count;
    }
    if (row.type === "thinking") {
      entry.hasThinking = true;
    }
    map.set(row.runId, entry);
  }
  return map;
}

function groupWindowStats(runs: Run[]): { agents: string[]; cost: number; tokens: number; errors: number; spanMs: number } {
  const agents = new Set<string>();
  let cost = 0;
  let tokens = 0;
  let errors = 0;
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const run of runs) {
    if (run.agent_name) {
      agents.add(run.agent_name);
    }
    cost += run.cost_usd ?? 0;
    tokens += (run.input_tokens ?? 0) + (run.output_tokens ?? 0) + (run.thinking_tokens ?? 0);
    if (run.status != null && run.status >= 400) {
      errors += 1;
    }
    const t = Date.parse(run.created_at);
    if (Number.isFinite(t)) {
      first = Math.min(first, t);
      last = Math.max(last, t + Math.max(0, run.latency_ms ?? 0));
    }
  }
  return {
    agents: [...agents],
    cost,
    tokens,
    errors,
    spanMs: Number.isFinite(first) && Number.isFinite(last) ? Math.max(0, last - first) : 0,
  };
}

function refreshControls(): string {
  return `<div class="refresh-ctl"><button class="btn btn-ghost" type="button" onclick="location.reload()">Refresh</button><label class="auto-refresh"><input type="checkbox" id="torrix-auto-refresh"> Auto · 15s</label></div>`;
}

function autoRefreshScript(): string {
  return `<script>(function(){
  var box=document.getElementById("torrix-auto-refresh");
  if(!box)return;
  var key="torrix_auto_refresh";
  var timer=null;
  function apply(on){
    if(timer){clearInterval(timer);timer=null}
    box.checked=on;
    try{localStorage.setItem(key,on?"1":"0")}catch(e){}
    if(on)timer=setInterval(function(){location.reload()},15000);
  }
  try{apply(localStorage.getItem(key)==="1")}catch(e){apply(false)}
  box.addEventListener("change",function(){apply(box.checked)});
})();</script>`;
}

const TRACES_STYLE = `
.trace-filters{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 16px}
.trace-filters input[type="search"]{background:var(--surface);border:1px solid var(--line);border-radius:6px;color:var(--text);padding:7px 10px;font-size:13px;min-width:260px;font-family:inherit}
.trace-filters input[type="search"]:focus{outline:none;border-color:var(--accent)}
.tf-toggle{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text-2);cursor:pointer}
.tf-toggle input{accent-color:var(--accent)}
.filter-empty td{padding:14px 12px;color:var(--text-3);font-size:13px}
`;

function tracesFilterScript(): string {
  return `<script>(function(){
  var search=document.getElementById("trace-search");
  var errors=document.getElementById("trace-errors");
  var hideSingle=document.getElementById("trace-hide-single");
  if(!search||!errors||!hideSingle)return;
  var KEY="torrix_traces_hide_single";
  try{hideSingle.checked=(localStorage.getItem(KEY)||"1")==="1"}catch(e){}
  function apply(){
    var q=(search.value||"").trim().toLowerCase(),onlyErrors=errors.checked,hide=hideSingle.checked,hidden=0,shown=0;
    Array.prototype.slice.call(document.querySelectorAll("tr.trace-row")).forEach(function(row){
      var ok=true;
      if(hide&&row.getAttribute("data-runs")==="1")ok=false;
      if(ok&&onlyErrors&&Number(row.getAttribute("data-errors")||0)===0)ok=false;
      if(ok&&q&&(row.getAttribute("data-search")||"").indexOf(q)<0)ok=false;
      row.style.display=ok?"":"none";
      if(ok)shown+=1;else hidden+=1;
    });
    var note=document.getElementById("trace-filter-note");
    if(note)note.textContent=hidden?(hidden+" hidden"):(shown?shown+" shown":"nothing matches");
    Array.prototype.slice.call(document.querySelectorAll("[data-trace-panel]")).forEach(function(panel){
      var all=panel.querySelectorAll("tr.trace-row").length,visible=0;
      Array.prototype.slice.call(panel.querySelectorAll("tr.trace-row")).forEach(function(row){if(row.style.display!=="none")visible+=1});
      var empty=panel.querySelector("tr.filter-empty");
      if(empty)empty.style.display=(all>0&&visible===0)?"":"none";
    });
  }
  search.addEventListener("input",apply);
  errors.addEventListener("change",apply);
  hideSingle.addEventListener("change",function(){try{localStorage.setItem(KEY,hideSingle.checked?"1":"0")}catch(e){}apply()});
  apply();
})();</script>`;
}

function tracesIndexBody(sessions: TraceGroup[], traces: TraceGroup[], roots: Map<string, GroupRoot>, projectName: string | null = null): string {
  const panel = (title: string, kind: "trace" | "session", groups: TraceGroup[], note: string): string => {
    const rows = groups
      .map((g) => {
        const root = roots.get(g.id);
        const prompt = extractUserPrompt(root?.requestBody ?? null);
        const spanMs = Math.max(0, (Date.parse(g.lastAt) || 0) - (Date.parse(g.firstAt) || 0));
        const search = [g.id, root?.agentName ?? "", ...g.agents, prompt ?? ""].join(" ").toLowerCase().slice(0, 320);
        return `<tr class="clickable trace-row" data-runs="${g.runs}" data-errors="${g.errorCount}" data-search="${escapeHtml(search)}" onclick="location.href='/ui/${kind}s/${encodeURIComponent(g.id)}'">
        <td class="mono" style="color:var(--text-3);font-size:12px">${relTime(g.lastAt)}</td>
        <td><span class="tcell-primary mono" style="font-size:11.5px">${escapeHtml(truncate(g.id, 34))}</span>
          ${prompt ? `<span class="tcell-sub">${escapeHtml(truncate(prompt.trim(), 90))}</span>` : ""}
          <span class="tcell-sub">${g.models.slice(0, 2).map((m) => escapeHtml(m)).join(", ")}${g.models.length > 2 ? ` +${g.models.length - 2}` : ""}</span></td>
        <td>${root?.agentName ? treeAgentChip(root.agentName) : '<span class="badge neutral">-</span>'}</td>
        <td>${g.agents.length ? g.agents.slice(0, 3).map((a) => `<span class="chip">${escapeHtml(a)}</span>`).join(" ") : '<span class="badge neutral">-</span>'}</td>
        <td class="num">${g.runs}</td>
        <td class="num">${g.subagents || 0}</td>
        <td class="num mono">${spanMs ? fmtMs(spanMs) : "-"}</td>
        <td class="num">${fmtUsd(g.cost)}</td>
        <td class="num">${g.errorCount ? `<span class="badge bad"><span class="dot"></span>${g.errorCount}</span>` : "0"}</td>
      </tr>`;
      })
      .join("");
    return `<div class="panel" style="margin-bottom:18px" data-trace-panel><div class="panel-head"><span class="panel-title">${title}</span><span class="panel-note">${note}</span></div>
      ${
        groups.length
          ? `<div class="table-wrap"><table>
              <thead><tr><th>Last activity</th><th>${kind === "session" ? "Session" : "Trace"}</th><th>Root agent</th><th>Agents</th><th class="num">Runs</th><th class="num">Subagents</th><th class="num">Duration</th><th class="num">Cost</th><th class="num">Errors</th></tr></thead>
              <tbody>${rows}<tr class="filter-empty" style="display:none"><td colspan="9">No rows match the filter.</td></tr></tbody>
            </table></div>`
          : emptyState(`No ${kind}s yet`, `Runs grouped by their ${kind === "session" ? "session" : "trace"} id will appear here.`)
      }</div>`;
  };
  return `<style>${TRACES_STYLE}</style><div class="page-head">
    <div><h1>Traces</h1><p class="page-sub">${projectName ? `Project ${escapeHtml(projectName)} · ` : ""}Sessions group a whole conversation; traces follow one agent execution, including the subagent runs it spawns.</p></div>
    ${refreshControls()}
  </div>
  <div class="trace-filters">
    <input id="trace-search" type="search" placeholder="Filter by trace id, agent or prompt" autocomplete="off" aria-label="Filter groups">
    <label class="tf-toggle"><input type="checkbox" id="trace-errors"> errors only</label>
    <label class="tf-toggle"><input type="checkbox" id="trace-hide-single" checked> hide single-run</label>
    <span class="panel-note" id="trace-filter-note"></span>
  </div>
  ${panel("Sessions", "session", sessions, "grouped by session_id")}
  ${panel("Traces", "trace", traces, "grouped by trace_id")}${tracesFilterScript()}${autoRefreshScript()}`;
}

const FLOW_STYLE = `
.tcell-err{color:var(--bad)}
.turn-summary{margin-bottom:14px}
.turn-prompt{margin:4px 0 8px;font-size:14px;line-height:1.55;color:var(--text);white-space:pre-wrap}
.turn-answer{margin:4px 0 8px;font-size:13.5px;line-height:1.55;color:var(--text-2);white-space:pre-wrap}
.turn-facts{margin:0}
.turn-error{margin:8px 0 0;font-size:13px;color:var(--bad)}
.turn-error a{color:var(--bad);text-decoration:underline}
.group-pager{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 12px}
.view-toggle{display:inline-flex;gap:3px;background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r-lg);padding:3px;margin-bottom:14px;align-items:center}
.view-toggle button{background:transparent;border:0;color:var(--text-3);padding:7px 14px;font-family:var(--display);font-size:12.5px;font-weight:600;border-radius:4px;cursor:pointer;transition:background .12s,color .12s}
.view-toggle button.active{background:var(--surface);color:var(--text);box-shadow:var(--shadow-sm)}
.view-toggle button:hover:not(.active){color:var(--text-2)}
.flow-wrap{position:relative;overflow:auto;padding:8px 4px 4px;min-height:320px}
.flow-svg{display:block}
.flow-node{cursor:pointer}
.flow-node rect{transition:filter .12s,opacity .12s}
.flow-node:hover rect{filter:brightness(1.1)}
.flow-node text{fill:#fff;font:11px var(--mono);pointer-events:none}
.flow-edge{fill:none;stroke:var(--line-2);stroke-width:1.3;opacity:.85}
.flow-lane{stroke:var(--line);stroke-dasharray:2 5}
.flow-lane-label{fill:var(--text-3);font:10.5px var(--mono)}
.flow-tick{stroke:var(--line);opacity:.5}
.flow-tick-label{fill:var(--text-3);font:10px var(--mono)}
.flow-badge{fill:var(--surface);stroke:var(--line-2);cursor:pointer}
.flow-badge:hover{stroke:var(--accent)}
.flow-badge-txt{fill:var(--text-2);font:10px var(--mono);pointer-events:none}
.flow-tip{position:absolute;z-index:5;pointer-events:none;background:var(--surface);border:1px solid var(--line-2);border-radius:6px;padding:7px 9px;font-size:12px;line-height:1.5;color:var(--text-2);box-shadow:var(--shadow-sm);display:none;max-width:280px}
.authz-row{background:var(--wash)}
.authz-row:hover{background:var(--surface-2)}
.authz-cell{display:flex;align-items:flex-start;gap:9px}
.authz-mark{width:8px;height:8px;transform:rotate(45deg);flex:none;margin-top:6px;background:var(--text-3)}
.authz-mark.ok{background:var(--good)}
.authz-mark.bad{background:var(--bad)}
.authz-mark.hold{background:var(--warn)}
.authz-title{font-size:12.5px;color:var(--text-2);font-weight:600}
.authz-sub{display:block;color:var(--text-3);font-size:12px;margin-top:2px}
.authz-sub a{color:var(--accent);text-decoration:none}
.authz-sub a:hover{text-decoration:underline}
.flow-decision{cursor:pointer}
.flow-decision path{stroke-width:1.2;transition:filter .12s}
.flow-decision:hover path{filter:brightness(1.15)}
.flow-decision.ok path{fill:var(--good);stroke:var(--surface)}
.flow-decision.bad path{fill:var(--bad);stroke:var(--surface)}
.flow-decision.hold path{fill:var(--warn);stroke:var(--surface)}
.flow-wait{stroke:var(--warn-line);stroke-dasharray:3 3}
.flow-tools{display:inline-flex;align-items:center;gap:6px;margin-left:auto}
.flow-tools .btn{padding:5px 9px;font-size:12px}
.flow-tools label{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--text-2);cursor:pointer}
.flow-tools input{accent-color:var(--accent)}
.flow-tool{cursor:pointer}
.flow-tool path{fill:var(--info);stroke:var(--surface);stroke-width:1}
.flow-tool:hover path{filter:brightness(1.15)}
.flow-gap{opacity:.7}
.ev-toggle{background:transparent;border:1px solid var(--line);border-radius:4px;color:var(--text-3);font:10px var(--mono);line-height:1;padding:2px 4px;cursor:pointer;margin-right:5px;flex:none}
.ev-toggle:hover{border-color:var(--accent);color:var(--accent)}
.ev-toggle[data-expanded="1"]{color:var(--accent);border-color:var(--accent-line)}
.ev-row{background:var(--surface-2)}
.ev-row td{vertical-align:top}
.ev-kind{font-family:var(--mono);font-size:10.5px;color:var(--text-3);text-transform:uppercase;letter-spacing:.4px}
.ev-mark{width:8px;height:8px;flex:none;margin-top:6px;border-radius:2px;background:var(--text-3)}
.ev-mark.tool{background:var(--info)}
.ev-mark.think{background:var(--accent-strong)}
.ev-mark.policy{background:var(--warn)}
.ev-args{font-family:var(--mono);font-size:11.5px;color:var(--text-3);word-break:break-word}
`;

interface GroupPaging {
  page: number;
  pages: number;
  pageSize: number;
}

const GUIDE_DEPTH_CAP = 24;

function turnSummaryPanel(runs: Run[], stats: Map<string, { toolCalls: number; hasThinking: boolean }>, window: ReturnType<typeof groupWindowStats>, answerText: string | null = null): string {
  const ordered = [...runs].sort((a, b) => runStartMs(a) - runStartMs(b));
  const firstPrompt = ordered.map((run) => extractUserPrompt(run.request_body)).find((text) => Boolean(text && text.trim())) ?? null;
  const toolCalls = runs.reduce((sum, run) => sum + (stats.get(run.id)?.toolCalls ?? 0), 0);
  const subagents = new Set(runs.filter((run) => run.parent_run_id && run.agent_name).map((run) => run.agent_name)).size;
  const firstError = ordered.find((run) => run.status != null && run.status >= 400) ?? null;
  const facts = [
    window.spanMs ? `${fmtMs(window.spanMs)} wall clock` : null,
    `${runs.length} call${runs.length === 1 ? "" : "s"}`,
    `${toolCalls} tool call${toolCalls === 1 ? "" : "s"}`,
    subagents ? `${subagents} subagent${subagents === 1 ? "" : "s"}` : null,
    fmtUsd(window.cost),
  ].filter(Boolean);
  return `<div class="panel turn-summary"><div class="panel-body">
    <div class="meta-label">Started with</div>
    <p class="turn-prompt">${firstPrompt ? escapeHtml(truncate(firstPrompt.trim(), 320)) : '<span class="panel-note">No prompt text captured for this turn.</span>'}</p>
    <div class="meta-label">Answer</div>
    <p class="turn-answer">${answerText ? escapeHtml(truncate(answerText.trim(), 320)) : '<span class="panel-note">No response text captured for the last call.</span>'}</p>
    <p class="panel-note turn-facts">${facts.map((fact) => escapeHtml(String(fact))).join(" · ")}</p>
    ${
      firstError
        ? `<p class="turn-error">First failure: <a href="/ui/runs/${encodeURIComponent(firstError.id)}">${escapeHtml(truncate(firstError.name ?? firstError.id, 60))}</a> · ${escapeHtml(truncate(firstError.error ?? `HTTP ${firstError.status}`, 160))}</p>`
        : ""
    }
  </div></div>`;
}

function sessionTurnsPanel(runs: Run[]): string {
  const turns = new Map<string, Run[]>();
  for (const run of runs) {
    const key = run.trace_id ?? run.id;
    turns.set(key, [...(turns.get(key) ?? []), run]);
  }
  if (turns.size < 2) {
    return "";
  }
  const rows = [...turns.entries()]
    .map(([traceId, list]) => {
      const ordered = [...list].sort((a, b) => runStartMs(a) - runStartMs(b));
      const prompt = ordered.map((run) => extractUserPrompt(run.request_body)).find((text) => Boolean(text && text.trim())) ?? ordered[0].name ?? "untitled";
      const errors = list.filter((run) => run.status != null && run.status >= 400).length;
      const cost = list.reduce((sum, run) => sum + (run.cost_usd ?? 0), 0);
      const span = Math.max(...list.map(runEndMs)) - runStartMs(ordered[0]);
      return { start: runStartMs(ordered[0]), html: `<tr class="clickable" onclick="location.href='/ui/traces/${encodeURIComponent(traceId)}'">
        <td class="mono" style="color:var(--text-3);font-size:12px">${relTime(ordered[0].created_at)}</td>
        <td><a href="/ui/traces/${encodeURIComponent(traceId)}" onclick="event.stopPropagation()">${escapeHtml(truncate(prompt.trim(), 90))}</a></td>
        <td class="num">${list.length}</td>
        <td class="num">${fmtMs(span)}</td>
        <td class="num mono">${fmtUsd(cost)}</td>
        <td class="num">${errors ? `<span class="badge bad"><span class="dot"></span>${errors}</span>` : "0"}</td>
      </tr>` };
    })
    .sort((a, b) => a.start - b.start)
    .map((row) => row.html)
    .join("");
  return `<div class="panel" style="margin-bottom:14px"><div class="panel-head"><span class="panel-title"><span class="sig"></span>Turns</span><span class="panel-note">one row per user turn (trace) in this session</span></div>
    <div class="table-wrap"><table><thead><tr><th>Started</th><th>Turn</th><th class="num">Calls</th><th class="num">Duration</th><th class="num">Cost</th><th class="num">Errors</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function pagingBar(kind: "trace" | "session", id: string, total: number, paging: GroupPaging): string {
  if (paging.pages <= 1) {
    return "";
  }
  const base = `/ui/${kind === "trace" ? "traces" : "sessions"}/${encodeURIComponent(id)}?page=`;
  const from = (paging.page - 1) * paging.pageSize + 1;
  const to = Math.min(total, paging.page * paging.pageSize);
  return `<div class="group-pager"><span class="panel-note">Showing runs ${from.toLocaleString()} to ${to.toLocaleString()} of ${total.toLocaleString()}</span>
    ${paging.page > 1 ? `<a class="btn btn-ghost" href="${base}${paging.page - 1}">Earlier</a>` : ""}
    ${paging.page < paging.pages ? `<a class="btn btn-ghost" href="${base}${paging.page + 1}">Later</a>` : ""}
    ${paging.page < paging.pages ? `<a class="btn btn-ghost" href="${base}${paging.pages}">Latest</a>` : ""}
  </div>`;
}

function toolEventName(message: string): string {
  try {
    const parsed = JSON.parse(message) as unknown;
    const item = Array.isArray(parsed) ? parsed[0] : parsed;
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const fn = record.function && typeof record.function === "object" ? (record.function as Record<string, unknown>) : null;
      const name = record.name ?? fn?.name;
      if (typeof name === "string" && name) {
        return name.slice(0, 40);
      }
    }
  } catch {
    // fall through to the raw text
  }
  return message.replace(/\s+/g, " ").trim().slice(0, 40) || "tool";
}

function authzTone(status: string | null | undefined): "ok" | "bad" | "hold" {
  const value = (status ?? "").toLowerCase();
  if (value === "allow" || value === "allowed" || value === "approved") {
    return "ok";
  }
  if (value === "deny" || value === "denied" || value === "rejected" || value === "expired") {
    return "bad";
  }
  return "hold";
}

function annotationRow(annotation: TraceAnnotation, guides: string, orphan = false): string {
  const tone = authzTone(annotation.status);
  const meta = annotation.meta ?? {};
  const principal = meta.principal as { display_name?: string | null } | null | undefined;
  const delegation = meta.delegation as { purpose?: string | null } | null | undefined;
  const policy = meta.policy as { name?: string | null } | null | undefined;
  const chips = [
    annotation.status
      ? `<span class="badge ${tone === "ok" ? "good" : tone === "bad" ? "bad" : "warn"}">${escapeHtml(annotation.status.replace(/_/g, " "))}</span>`
      : "",
    annotation.riskLevel
      ? `<span class="badge ${annotation.riskLevel === "low" ? "neutral" : annotation.riskLevel === "medium" ? "warn" : "bad"}">risk ${escapeHtml(annotation.riskLevel)}</span>`
      : "",
    annotation.approval && annotation.approval.waitMs != null
      ? `<span class="chip chip-mono">held ${fmtMs(annotation.approval.waitMs)}</span>`
      : annotation.approval
        ? `<span class="chip chip-mono">${escapeHtml(annotation.approval.state)}</span>`
        : "",
  ]
    .filter(Boolean)
    .join(" ");
  const facts = [
    principal?.display_name ? `for ${principal.display_name}` : null,
    delegation?.purpose ? `via ${delegation.purpose} delegation` : null,
    policy?.name ? `policy ${policy.name}` : null,
    orphan ? "no run link" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return `<tr class="authz-row" data-run="${escapeHtml(annotation.runId ?? "")}" data-parent="${orphan ? "" : escapeHtml(annotation.runId ?? "")}">
    <td class="mono" style="color:var(--text-3);font-size:12px"><span title="${escapeHtml(annotation.at)}">${relTime(annotation.at)}</span></td>
    <td colspan="9"><div class="authz-cell">
      <span class="tree-guides" aria-hidden="true">${guides}</span>
      <span class="authz-mark ${tone}" aria-hidden="true"></span>
      <span class="cell-stack">
        <span class="cell-inline"><span class="authz-title">${escapeHtml(annotation.title)}</span> ${chips}</span>
        ${annotation.detail ? `<span class="authz-sub">${escapeHtml(truncate(annotation.detail, 160))}</span>` : ""}
        ${facts ? `<span class="authz-sub">${escapeHtml(facts)}</span>` : ""}
      </span>
    </div></td>
  </tr>`;
}

function runGroupBody(
  kind: "trace" | "session",
  id: string,
  runs: Run[],
  total: number,
  eventCounts: RunEventCount[],
  descendantCount: number,
  paging: GroupPaging = { page: 1, pages: 1, pageSize: 200 },
  annotations: TraceAnnotation[] = [],
  answerText: string | null = null,
  toolEvents: RunToolEvent[] = [],
): string {
  const label = kind === "trace" ? "Trace" : "Session";
  const stats = runEventStats(eventCounts);
  const window = groupWindowStats(runs);
  const tree = buildRunTree(runs);
  const FLOW_NODE_CAP = 300;
  const flowRuns = runs.slice(0, FLOW_NODE_CAP).map((r) => {
    const ev = stats.get(r.id);
    return {
      id: r.id,
      parent: r.parent_run_id ?? null,
      name: r.name ?? "untitled",
      agent: r.agent_name ?? null,
      model: r.model ?? null,
      start: Date.parse(r.created_at) || 0,
      duration: Math.max(0, r.latency_ms ?? 0),
      cost: r.cost_usd ?? 0,
      tokens: (r.input_tokens ?? 0) + (r.output_tokens ?? 0),
      status: r.status ?? null,
      error: r.status != null && r.status >= 400,
      thinking: Boolean(ev?.hasThinking || (r.thinking_tokens ?? 0) > 0),
      tools: ev?.toolCalls ?? 0,
      url: `/ui/runs/${encodeURIComponent(r.id)}`,
    };
  });
  const flowAnnotations = annotations
    .filter((annotation) => annotation.runId && runs.some((run) => run.id === annotation.runId))
    .slice(0, 400)
    .map((annotation) => ({
      id: annotation.id,
      runId: annotation.runId,
      at: Date.parse(annotation.at) || 0,
      status: annotation.status ?? null,
      title: annotation.title,
      risk: annotation.riskLevel ?? null,
      waitMs: annotation.approval?.waitMs ?? null,
      approvalState: annotation.approval?.state ?? null,
    }));
  const flowRunIdSet = new Set(flowRuns.map((run) => run.id));
  const flowTools = toolEvents
    .filter((event) => flowRunIdSet.has(event.runId))
    .slice(0, 400)
    .map((event) => ({ runId: event.runId, at: Date.parse(event.createdAt) || 0, name: toolEventName(event.message) }));
  const flowPayload = JSON.stringify({ runs: flowRuns, annotations: flowAnnotations, tools: flowTools, total: runs.length, capped: runs.length > flowRuns.length }).replace(/</g, "\\u003c");
  const traceOf = new Map(runs.map((run) => [run.id, run.trace_id ?? null]));
  const annotationsByRun = new Map<string, TraceAnnotation[]>();
  for (const annotation of annotations) {
    if (!annotation.runId) {
      continue;
    }
    annotationsByRun.set(annotation.runId, [...(annotationsByRun.get(annotation.runId) ?? []), annotation]);
  }
  const renderedRunIds = new Set(runs.map((run) => run.id));
  const orphanAnnotations = annotations.filter((annotation) => !annotation.runId || !renderedRunIds.has(annotation.runId));
  const rows = tree.flat
    .map(({ run: r, depth, lastSibling, ancestorLast, orphanParentId, cycleBroken, children, subtree }) => {
      const ev = stats.get(r.id);
      const thinking = ev?.hasThinking || (r.thinking_tokens ?? 0) > 0;
      const totalTokens = (r.input_tokens ?? 0) + (r.output_tokens ?? 0);
      const shownAncestors = ancestorLast.length > GUIDE_DEPTH_CAP ? ancestorLast.slice(-GUIDE_DEPTH_CAP) : ancestorLast;
      const guides =
        depth === 0
          ? ""
          : `${ancestorLast.length > GUIDE_DEPTH_CAP ? "⋯" : ""}${shownAncestors.map((last) => (last ? " " : "│")).join("")}${lastSibling ? "└" : "├"}`;
      const childGuides = `${shownAncestors.map((last) => (last ? " " : "│")).join("")}${lastSibling ? " " : "│"}├`;
      // A child is labelled as a subagent trace only when it really sits in a different trace from its parent.
      const parentTrace = r.parent_run_id ? traceOf.get(r.parent_run_id) : undefined;
      const showTrace = Boolean(r.trace_id && parentTrace !== undefined && parentTrace !== r.trace_id);
      const hasChildren = children.length > 0;
      const policyRows = safeJsonArray(r.policy_flags)
        .map((flag) => {
          const name = String(flag.policyName ?? flag.policy ?? flag.name ?? "policy");
          const stage = flag.stage ? String(flag.stage) : null;
          const detail = String(flag.detail ?? flag.reason ?? flag.matcher ?? "");
          const severity = flag.severity ? String(flag.severity) : null;
          return `<tr class="ev-row policy-row" data-parent="${escapeHtml(r.id)}" data-run="${escapeHtml(r.id)}">
            <td class="mono" style="color:var(--text-3);font-size:12px"><span title="${escapeHtml(r.created_at)}">${relTime(r.created_at)}</span></td>
            <td colspan="9"><div class="authz-cell">
              <span class="tree-guides" aria-hidden="true">${childGuides}</span>
              <span class="ev-mark policy" aria-hidden="true"></span>
              <span class="cell-stack">
                <span class="cell-inline"><span class="ev-kind">policy</span> <span class="authz-title">${escapeHtml(name)}</span>${stage ? ` <span class="chip chip-mono">${escapeHtml(stage)}</span>` : ""}${severity ? ` <span class="badge ${severity === "high" || severity === "critical" ? "bad" : "warn"}">${escapeHtml(severity)}</span>` : ""}</span>
                ${detail ? `<span class="authz-sub">${escapeHtml(truncate(detail, 160))}</span>` : ""}
              </span>
            </div></td>
          </tr>`;
        })
        .join("");
      return `<tr class="clickable${r.status != null && r.status >= 400 ? " row-error" : ""}" data-run="${escapeHtml(r.id)}" data-parent="${escapeHtml(r.parent_run_id ?? "")}" onclick="location.href='/ui/runs/${r.id}'">
        <td class="mono" style="color:var(--text-3);font-size:12px"><span title="${escapeHtml(r.created_at)}">${relTime(r.created_at)}</span></td>
        <td><div class="tree-cell">
          ${hasChildren ? '<button class="tree-toggle" type="button" data-toggle="1" aria-label="Collapse subtree">▾</button>' : '<span class="tree-toggle-spacer"></span>'}
          <span class="tree-guides" aria-hidden="true">${guides}</span>
          <span class="cell-stack">
            <span class="cell-inline">
              ${ev?.toolCalls || thinking ? `<button class="ev-toggle" type="button" data-events="${escapeHtml(r.id)}" title="Show tool calls and reasoning" aria-label="Show tool calls and reasoning">▸</button>` : ""}
              <span class="tcell-primary">${escapeHtml(truncate(r.name ?? "untitled", 52))}</span>
              ${thinking ? '<span class="think-mark" title="Reasoning captured">think</span>' : ""}
            </span>
            ${showTrace ? `<span class="tcell-sub">subagent · <a href="/ui/traces/${encodeURIComponent(r.trace_id ?? "")}" onclick="event.stopPropagation()">trace …${escapeHtml((r.trace_id ?? "").slice(-8))}</a></span>` : ""}
            ${r.status != null && r.status >= 400 && r.error ? `<span class="tcell-sub tcell-err">${escapeHtml(truncate(r.error, 140))}</span>` : ""}
            ${hasChildren ? `<span class="tcell-sub">branch · ${subtree.runs} call${subtree.runs === 1 ? "" : "s"} · ${fmtUsd(subtree.cost)}${subtree.errors ? ` · ${subtree.errors} error${subtree.errors === 1 ? "" : "s"}` : ""}</span>` : ""}
            ${orphanParentId ? `<span class="tcell-sub">parent <a href="/ui/runs/${encodeURIComponent(orphanParentId)}" onclick="event.stopPropagation()">${escapeHtml(truncate(orphanParentId, 18))}</a> is outside this view</span>` : ""}
            ${cycleBroken ? '<span class="tcell-sub">cycle broken: this run and its parent point at each other</span>' : ""}
          </span>
        </div></td>
        <td>${r.agent_name ? treeAgentChip(r.agent_name) : '<span class="badge neutral">-</span>'}</td>
        <td>${providerChip(r.provider)}</td>
        <td>${clusterLabel(r.model)}</td>
        <td class="num">${fmtTokens(totalTokens || null)}</td>
        <td class="num">${ev?.toolCalls ? `<span class="chip">${ev.toolCalls}</span>` : "-"}</td>
        <td class="num mono">${fmtMs(r.latency_ms)}</td>
        <td class="num">${fmtUsd(r.cost_usd)}</td>
        <td>${statusBadge(r.status, r.finish_reason)}</td>
      </tr>${policyRows}${(annotationsByRun.get(r.id) ?? []).map((annotation) => annotationRow(annotation, childGuides)).join("")}`;
    })
    .join("") + orphanAnnotations.map((annotation) => annotationRow(annotation, "", true)).join("");
  const head = `<div class="page-head">
    <div><h1>${label}</h1><p class="page-sub mono">${escapeHtml(id)} · ${total.toLocaleString()} run${total === 1 ? "" : "s"}${descendantCount ? ` · ${descendantCount} descendant run${descendantCount === 1 ? "" : "s"}` : ""}</p></div>
    ${refreshControls()}
  </div>`;
  if (!runs.length) {
    return `${backLink("/ui/traces", "All traces")}${head}${emptyState(`No runs in this ${kind}`, "Nothing was captured under this identifier.")}${autoRefreshScript()}`;
  }
  const errorsChip = window.errors
    ? `<span class="badge bad"><span class="dot"></span>${window.errors} error${window.errors === 1 ? "" : "s"}</span>`
    : '<span class="chip">0 errors</span>';
  const subagentCount = runs.filter((r) => r.parent_run_id).length;
  const summary = `<div class="group-stats">
    <span class="chip">${runs.length} run${runs.length === 1 ? "" : "s"}</span>
    <span class="chip">${window.agents.length ? `${window.agents.length} agent${window.agents.length === 1 ? "" : "s"}` : "no agent tag"}</span>
    <span class="chip">${subagentCount} child call${subagentCount === 1 ? "" : "s"}</span>
    <span class="chip">${fmtUsd(window.cost)}</span>
    <span class="chip">${fmtTokens(window.tokens || null)} tokens</span>
    ${errorsChip}
    ${window.spanMs ? `<span class="chip">${fmtMs(window.spanMs)} span</span>` : ""}
  </div>`;
  const viewToggle = `<div class="view-toggle" role="tablist" aria-label="${label} view">
    <button type="button" data-view="tree" class="active">Tree</button>
    <button type="button" data-view="flow">Flow</button>
    <span class="panel-note" id="flow-meta" style="margin-left:8px"></span>
  </div>`;
  const flowPanel = `<div id="view-flow" style="display:none"><div class="panel">
    <div class="panel-head"><span class="panel-title">Flow</span><span class="panel-note">time runs left to right · diamonds mark decisions and tool calls · click a node for the run · ± collapses a branch</span>
      <span class="flow-tools">
        <button type="button" class="btn btn-ghost" data-flow-zoom="-" aria-label="Zoom out">−</button>
        <button type="button" class="btn btn-ghost" data-flow-zoom="+" aria-label="Zoom in">+</button>
        <button type="button" class="btn btn-ghost" data-flow-zoom="reset">Fit</button>
        <label class="tf-toggle"><input type="checkbox" id="flow-compress" checked> compress gaps</label>
      </span></div>
    <div class="flow-wrap" id="flow-wrap"></div>
  </div></div>`;
  const aiPanel = `<div class="panel" style="margin-top:16px" id="ai-panel">
    <div class="panel-head"><span class="panel-title"><span class="sig"></span>AI analysis</span>
      <span style="display:flex;align-items:center;gap:10px"><span class="panel-note" id="ai-status"></span><button class="btn btn-primary" id="ai-run" type="button">Analyze with AI</button></span></div>
    <div class="panel-body" id="ai-body"><p class="panel-note">Ask the configured judge model to explain this ${label.toLowerCase()}: flow, cost drivers, errors and improvements. Nothing is sent until you click.</p></div>
  </div>`;
  const overview = kind === "trace" ? turnSummaryPanel(runs, stats, window, answerText) : sessionTurnsPanel(runs);
  return `<style>${FLOW_STYLE}</style>${backLink("/ui/traces", "All traces")}${head}${summary}${pagingBar(kind, id, total, paging)}${overview}${viewToggle}<div id="view-tree"><div class="panel"><div class="table-wrap"><table id="run-tree">
    <thead><tr><th>Time</th><th>Run</th><th>Agent</th><th>Provider</th><th>Model</th><th class="num">Tokens</th><th class="num">Tools</th><th class="num">Duration</th><th class="num">Cost</th><th>Status</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div></div></div>${flowPanel}${aiPanel}${runFlowScript(flowPayload)}${runFlowToggleScript()}${runGroupInsightsScript(kind, id)}${runTreeScript()}${runEventsScript()}${autoRefreshScript()}`;
}

function runGroupInsightsScript(kind: "trace" | "session", id: string): string {
  return `<script>(function(){
  var kind=${JSON.stringify(kind)},id=${JSON.stringify(id)};
  var body=document.getElementById("ai-body"),status=document.getElementById("ai-status"),btn=document.getElementById("ai-run");
  if(!btn)return;
  function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}
  function render(report){
    if(!report)return;
    status.textContent=(report.generatedWith==="judge"?"judge LLM":"rule-based")+" · "+new Date(report.generatedAt).toLocaleString()+(report.judgeCostUsd?" · $"+Number(report.judgeCostUsd).toFixed(6):"");
    body.innerHTML='<ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:7px;color:var(--text-2);font-size:13.5px">'+report.highlights.map(function(line){return "<li>"+esc(line)+"</li>"}).join("")+'</ul>'+
      '<p class="panel-note" style="margin-top:10px">'+report.runs+' run'+(report.runs===1?"":"s")+' · '+report.agents.length+' agent(s) · '+report.models.length+' model(s) · $'+Number(report.costUsd||0).toFixed(4)+' · '+report.errorCount+' error(s)'+(report.spanMs?' · span '+(report.spanMs/1000).toFixed(1)+'s':'')+'</p>';
    btn.textContent="Re-analyze";
  }
  fetch("/api/runs/group/"+encodeURIComponent(kind)+"/"+encodeURIComponent(id)+"/insights",{headers:{authorization:"Bearer "+(localStorage.getItem("torrix_key")||"")}})
    .then(function(res){return res.ok?res.json():null})
    .then(function(payload){if(payload&&payload.report)render(payload.report)})
    .catch(function(){});
  btn.onclick=function(){
    btn.disabled=true;btn.textContent="Analyzing…";status.textContent="";
    fetch("/api/runs/group/"+encodeURIComponent(kind)+"/"+encodeURIComponent(id)+"/insights",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+(localStorage.getItem("torrix_key")||"")},body:"{}"})
      .then(function(res){return res.json().then(function(payload){return {ok:res.ok,body:payload}})})
      .then(function(res){
        btn.disabled=false;
        if(!res.ok){btn.textContent="Analyze with AI";status.textContent=res.body.error||"analysis failed";return}
        render(res.body);
      })
      .catch(function(){btn.disabled=false;btn.textContent="Analyze with AI";status.textContent="analysis failed"});
  };
})();</script>`;
}

function runFlowScript(payloadJson: string): string {
  return `<script>(function(){
  var DATA=${payloadJson};
  var wrap=document.getElementById("flow-wrap");
  if(!wrap)return;
  var NS="http://www.w3.org/2000/svg";
  var collapsed=new Set();
  var zoom=1,compress=true;
  function setZoom(next){
    var prev=zoom;
    zoom=Math.max(0.5,Math.min(6,next));
    if(zoom===prev)return;
    var anchor=wrap.scrollLeft+wrap.clientWidth/2;
    var ratio=zoom/prev;
    draw();
    wrap.scrollLeft=Math.max(0,anchor*ratio-wrap.clientWidth/2);
  }
  window.torrixFlowZoom=function(dir){
    if(dir==="reset"){zoom=1;draw();wrap.scrollLeft=0;return}
    setZoom(dir==="+"?zoom*1.4:zoom/1.4);
  };
  function toneFor(name){
    if(!name)return "s1";
    var h=0;for(var i=0;i<name.length;i+=1)h=(h*31+name.charCodeAt(i))>>>0;
    return "s"+((h%5)+1);
  }
  function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}
  function fmtMs(ms){if(ms==null)return "-";if(ms<1000)return Math.round(ms)+"ms";return (ms/1000).toFixed(1)+"s"}
  function fmtUsd(n){return "$"+Number(n||0).toFixed(4)}
  function fmtTokens(n){return Number(n||0)>999?(Number(n||0)/1000).toFixed(1)+"k":String(Number(n||0))}
  function svgEl(name,attrs){
    var node=document.createElementNS(NS,name);
    for(var key in attrs)node.setAttribute(key,attrs[key]);
    return node;
  }
  function draw(){
    var runs=DATA.runs;
    var anns=DATA.annotations||[];
    var meta=document.getElementById("flow-meta");
    wrap.innerHTML="";
    if(!runs.length){wrap.innerHTML='<p class="panel-note" style="padding:16px">Nothing to graph.</p>';return}
    var byId={};runs.forEach(function(r){byId[r.id]=r});
    var t0=Infinity,t1=-Infinity;
    runs.forEach(function(r){var end=r.start+Math.max(r.duration,1);if(r.start<t0)t0=r.start;if(end>t1)t1=end});
    anns.forEach(function(a){var end=a.at+(a.waitMs||0);if(a.at&&a.at<t0)t0=a.at;if(end>t1)t1=end});
    if(!isFinite(t0)){t0=0;t1=1000}
    if(t1-t0<1000)t1=t0+1000;
    var merged=[];
    (function(){
      var ivs=runs.map(function(r){return {start:r.start,end:r.start+Math.max(r.duration,1)}});
      anns.forEach(function(a){if(a.at)ivs.push({start:a.at,end:a.at+(a.waitMs||0)})});
      ivs.sort(function(a,b){return a.start-b.start});
      ivs.forEach(function(iv){
        var last=merged[merged.length-1];
        if(last&&iv.start<=last.end)last.end=Math.max(last.end,iv.end);
        else merged.push({start:iv.start,end:iv.end});
      });
      if(!merged.length)merged.push({start:t0,end:t1});
    })();
    var MAX_ROWS=12;
    var lanes=[],laneIndex={},laneRows={};
    runs.slice().sort(function(a,b){return a.start-b.start}).forEach(function(r){
      var key=r.agent||"no agent";
      if(!(key in laneIndex)){laneIndex[key]=lanes.length;lanes.push(key)}
    });
    lanes.forEach(function(key){
      var list=runs.filter(function(r){return (r.agent||"no agent")===key}).sort(function(a,b){return a.start-b.start});
      // Pack by time overlap: a run goes on the first line that is free when it starts.
      var gap=(t1-t0)*0.01,rowEnds=[],index={},alt={};
      list.forEach(function(r,i){
        var end=r.start+Math.max(r.duration,1),row=-1;
        for(var k=0;k<rowEnds.length;k+=1){if(rowEnds[k]+gap<=r.start){row=k;break}}
        if(row<0){if(rowEnds.length<MAX_ROWS){row=rowEnds.length;rowEnds.push(0)}else{row=0;for(var m=1;m<rowEnds.length;m+=1){if(rowEnds[m]<rowEnds[row])row=m}}}
        rowEnds[row]=Math.max(rowEnds[row],end);
        index[r.id]=row;alt[r.id]=i%2;
      });
      laneRows[key]={count:Math.max(1,rowEnds.length),index:index,alt:alt};
    });
    var totalRows=0;
    lanes.forEach(function(key){totalRows+=laneRows[key].count});
    var laneH=46,padTop=28,padBottom=28,padX=104;
    var baseWidth=Math.max(720,Math.min(2600,wrap.clientWidth||900));
    var width=Math.max(340,Math.round(baseWidth*zoom));
    var height=padTop+totalRows*laneH+padBottom;
    var plotW=width-2*padX;
    var laneTop={},rowCursor=padTop;
    lanes.forEach(function(key){laneTop[key]=rowCursor;rowCursor+=laneRows[key].count*laneH});
    var GAP_PX=18;
    var segs=[],gapCount=0;
    (function(){
      var spans=[];
      var rawSpan=Math.max(1,merged[merged.length-1].end-merged[0].start);
      var threshold=Math.max(1500,rawSpan*0.15);
      for(var i=0;i<merged.length;i+=1){
        var iv=merged[i];
        spans.push({start:iv.start,end:iv.end,raw:Math.max(1,iv.end-iv.start),compressed:false});
        if(i<merged.length-1){
          var gap=merged[i+1].start-iv.end;
          var isGap=compress&&gap>threshold;
          if(isGap)gapCount+=1;
          spans.push({start:iv.end,end:merged[i+1].start,raw:Math.max(1,gap),compressed:isGap});
        }
      }
      var spanRaw=0;
      spans.forEach(function(s){if(!s.compressed)spanRaw+=s.raw});
      var avail=Math.max(120,plotW-gapCount*GAP_PX);
      var cursor=padX;
      spans.forEach(function(s){
        var w=s.compressed?GAP_PX:Math.max(1,(s.raw/spanRaw)*avail);
        s.x0=cursor;s.x1=cursor+w;
        cursor+=w;
      });
      segs=spans;
    })();
    function xFor(ts){
      if(!isFinite(ts))return padX;
      if(ts<=segs[0].start)return segs[0].x0;
      for(var i=0;i<segs.length;i+=1){
        var s=segs[i];
        if(ts<=s.end){
          var raw=Math.max(1,s.end-s.start);
          return s.x0+((Math.max(0,ts-s.start))/raw)*(s.x1-s.x0);
        }
      }
      return segs[segs.length-1].x1;
    }
    function wFor(r){return Math.max(12,xFor(r.start+Math.max(r.duration,1))-xFor(r.start))}
    if(meta)meta.textContent=(DATA.capped?("showing first "+runs.length+" of "+DATA.total+" runs · "):(runs.length+" run"+(runs.length===1?"":"s")+" · "))+totalRows+" line"+(totalRows===1?"":"s")+(anns.length?(" · "+anns.length+" authorization decision"+(anns.length===1?"":"s")):"")+(gapCount?(" · "+gapCount+" gap"+(gapCount===1?"":"s")+" compressed"):"")+(zoom!==1?(" · "+zoom.toFixed(1)+"x"):"");
    function rowFor(r){var k=r.agent||"no agent";return laneRows[k].index[r.id]||0}
    function yFor(r){var k=r.agent||"no agent";return laneTop[k]+rowFor(r)*laneH+laneH/2}
    var hidden=new Set();
    runs.forEach(function(r){
      var p=r.parent,g=0;
      while(p&&g<50){if(collapsed.has(p)){hidden.add(r.id);break}var pr=byId[p];p=pr?pr.parent:null;g+=1}
    });
    var svg=svgEl("svg",{viewBox:"0 0 "+width+" "+height,width:String(width),height:String(height),class:"flow-svg"});
    var defs=svgEl("defs",{});
    var hatch=svgEl("pattern",{id:"flow-hatch",width:6,height:6,patternUnits:"userSpaceOnUse",patternTransform:"rotate(45)"});
    hatch.appendChild(svgEl("rect",{width:6,height:6,fill:"var(--warn-dim)"}));
    hatch.appendChild(svgEl("line",{x1:0,y1:0,x2:0,y2:6,stroke:"var(--warn)","stroke-width":1.6}));
    defs.appendChild(hatch);
    var gapPat=svgEl("pattern",{id:"flow-gap",width:6,height:6,patternUnits:"userSpaceOnUse",patternTransform:"rotate(45)"});
    gapPat.appendChild(svgEl("rect",{width:6,height:6,fill:"var(--surface-2)"}));
    gapPat.appendChild(svgEl("line",{x1:0,y1:0,x2:0,y2:6,stroke:"var(--line-2)","stroke-width":1.1}));
    defs.appendChild(gapPat);
    svg.appendChild(defs);
    var tickStep=Math.max(1,Math.ceil(segs.length/6));
    var tickTotal=0;
    for(var ti=0;ti<segs.length;ti+=tickStep)tickTotal+=1;
    var tickIdx=0;
    for(var ti2=0;ti2<segs.length;ti2+=tickStep){
      var seg=segs[ti2],x=seg.x0;
      svg.appendChild(svgEl("line",{x1:x,x2:x,y1:padTop-8,y2:height-padBottom+4,class:"flow-tick"}));
      var lab=svgEl("text",{x:x,y:padTop-12,"text-anchor":tickIdx===0?"start":(tickIdx===tickTotal-1?"end":"middle"),class:"flow-tick-label"});
      lab.textContent=tickIdx===0?"+0s":"+"+((seg.start-t0)/1000).toFixed(1)+"s";
      svg.appendChild(lab);
      tickIdx+=1;
    }
    var lastSeg=segs[segs.length-1];
    svg.appendChild(svgEl("line",{x1:lastSeg.x1,x2:lastSeg.x1,y1:padTop-8,y2:height-padBottom+4,class:"flow-tick"}));
    var lastLab=svgEl("text",{x:lastSeg.x1,y:padTop-12,"text-anchor":"end",class:"flow-tick-label"});
    lastLab.textContent="+"+((t1-t0)/1000).toFixed(1)+"s";
    svg.appendChild(lastLab);
    segs.forEach(function(s){
      if(!s.compressed)return;
      svg.appendChild(svgEl("rect",{x:s.x0,y:padTop-6,width:Math.max(2,s.x1-s.x0),height:height-padTop-padBottom+10,fill:"url(#flow-gap)",class:"flow-gap"}));
    });
    lanes.forEach(function(lane){
      var info=laneRows[lane],top=laneTop[lane];
      for(var row=0;row<info.count;row+=1){
        var y=top+row*laneH+laneH/2;
        if(row%2===1)svg.appendChild(svgEl("rect",{x:padX-8,y:top+row*laneH+2,width:plotW+16,height:laneH-6,rx:4,fill:"var(--wash)"}));
        svg.appendChild(svgEl("line",{x1:padX-6,x2:width-padX+6,y1:y,y2:y,class:"flow-lane"}));
        var label=svgEl("text",{x:6,y:y+3.5,class:"flow-lane-label"});
        label.textContent=row===0?(lane.length>16?lane.slice(0,15)+"…":lane):"";
        svg.appendChild(label);
        if(info.count>1){
          var idx=svgEl("text",{x:padX-18,y:y+3.5,"text-anchor":"end",class:"flow-lane-label"});
          idx.textContent=(row+1)+"/"+info.count;
          svg.appendChild(idx);
        }
        if(row===0)svg.appendChild(svgEl("rect",{x:padX-15,y:y-3,width:6,height:6,rx:2,fill:"var(--"+toneFor(lane==="no agent"?null:lane)+")"}));
      }
    });
    anns.forEach(function(a){
      var r=byId[a.runId];
      if(!r||hidden.has(r.id))return;
      var start=a.at,end=start+(a.waitMs||0);
      if(!a.waitMs&&a.approvalState!=="pending")return;
      if(a.approvalState==="pending"&&!a.waitMs)end=t1;
      var x1=xFor(start),x2=Math.max(x1+3,xFor(end)),y=yFor(r)-laneH*0.32;
      svg.appendChild(svgEl("rect",{x:x1,y:y,width:x2-x1,height:laneH*0.64,fill:"url(#flow-hatch)",rx:3,class:"flow-wait"}));
    });
    runs.forEach(function(r){
      if(!r.parent||hidden.has(r.id))return;
      var p=byId[r.parent];
      if(!p||hidden.has(p.id))return;
      // A child that starts inside its parent (an enclosing span) connects from that point, not from the parent's end.
      var pEnd=p.start+Math.max(p.duration,1);
      var x1=r.start<pEnd?Math.max(xFor(p.start),xFor(r.start)-6):xFor(p.start)+wFor(p),y1=yFor(p),x2=xFor(r.start),y2=yFor(r);
      var mid=Math.max(16,(x2-x1)/2);
      svg.appendChild(svgEl("path",{d:"M"+x1+" "+y1+" C"+(x1+mid)+" "+y1+","+(x2-mid)+" "+y2+","+x2+" "+y2,class:"flow-edge"}));
    });
    var tip=document.createElement("div");
    tip.className="flow-tip";
    wrap.appendChild(tip);
    runs.forEach(function(r){
      if(hidden.has(r.id))return;
      var laneKey=r.agent||"no agent";
      var x=xFor(r.start)+1.5,y=yFor(r)-15,w=Math.max(10,wFor(r)-3),h=30;
      var g=svgEl("g",{class:"flow-node"+(r.error?" flow-error":"")});
      var op=r.error?"1":(laneRows[laneKey].alt[r.id]?"0.72":"0.95");
      g.appendChild(svgEl("rect",{x:x,y:y,width:w,height:h,rx:4,fill:r.error?"var(--bad)":"var(--"+toneFor(r.agent)+")",opacity:op}));
      if(w>86){
        var chars=Math.max(3,Math.floor((w-14)/6.4)-1);
        var txt=svgEl("text",{x:x+7,y:y+20});
        txt.textContent=r.name.length>chars?r.name.slice(0,chars)+"…":r.name;
        g.appendChild(txt);
      }
      var hasChild=runs.some(function(c){return c.parent===r.id});
      if(hasChild){
        var bx=x+w+9,by=y+15;
        var badge=svgEl("circle",{cx:bx,cy:by,r:7.5,class:"flow-badge"});
        var badgeTxt=svgEl("text",{x:bx,y:by+3.5,"text-anchor":"middle",class:"flow-badge-txt"});
        badgeTxt.textContent=collapsed.has(r.id)?"+":"−";
        badge.addEventListener("click",function(e){
          e.stopPropagation();
          if(collapsed.has(r.id))collapsed.delete(r.id);else collapsed.add(r.id);
          draw();
        });
        svg.appendChild(badge);
        svg.appendChild(badgeTxt);
      }
      g.addEventListener("click",function(){location.href=r.url});
      g.addEventListener("mousemove",function(e){
        var box=wrap.getBoundingClientRect();
        tip.style.display="block";
        tip.style.left=Math.max(4,Math.min(e.clientX-box.left+14,box.width-286))+"px";
        tip.style.top=(e.clientY-box.top+14)+"px";
        tip.innerHTML="<b>"+esc(r.name)+"</b><br>"+esc(r.agent||"no agent")+" · "+esc(r.model||"unknown model")+"<br>"+fmtTokens(r.tokens)+" tokens · "+fmtUsd(r.cost)+" · "+fmtMs(r.duration)+(r.tools?(" · "+r.tools+" tools"):"")+(r.thinking?" · thinking":"")+(r.error?' · <span style="color:var(--bad)">error</span>':"");
      });
      g.addEventListener("mouseleave",function(){tip.style.display="none"});
      svg.appendChild(g);
    });
    var toolMarks=DATA.tools||[];
    toolMarks.forEach(function(t){
      var r=byId[t.runId];
      if(!r||hidden.has(r.id)||!t.at)return;
      var cx=xFor(t.at),cy=yFor(r)+19;
      var g=svgEl("g",{class:"flow-tool"});
      g.appendChild(svgEl("path",{d:"M"+cx+" "+(cy-4)+" L"+(cx+4)+" "+cy+" L"+cx+" "+(cy+4)+" L"+(cx-4)+" "+cy+" Z"}));
      g.addEventListener("click",function(e){e.stopPropagation();location.href=r.url});
      g.addEventListener("mousemove",function(e){
        var box=wrap.getBoundingClientRect();
        tip.style.display="block";
        tip.style.left=Math.max(4,Math.min(e.clientX-box.left+14,box.width-286))+"px";
        tip.style.top=(e.clientY-box.top+14)+"px";
        tip.innerHTML="<b>"+esc(t.name)+"</b><br>tool call · "+esc(r.name||"run");
      });
      g.addEventListener("mouseleave",function(){tip.style.display="none"});
      svg.appendChild(g);
    });
    anns.forEach(function(a){
      var r=byId[a.runId];
      if(!r||hidden.has(r.id))return;
      var cx=xFor(r.start)-9,cy=yFor(r);
      var tone=(a.status==="allow"||a.status==="allowed"||a.status==="approved")?"ok":((a.status==="deny"||a.status==="denied"||a.status==="rejected"||a.status==="expired")?"bad":"hold");
      var g=svgEl("g",{class:"flow-decision "+tone});
      g.appendChild(svgEl("path",{d:"M"+cx+" "+(cy-8)+" L"+(cx+8)+" "+cy+" L"+cx+" "+(cy+8)+" L"+(cx-8)+" "+cy+" Z"}));
      g.addEventListener("click",function(e){e.stopPropagation();location.href=r.url});
      g.addEventListener("mousemove",function(e){
        var box=wrap.getBoundingClientRect();
        tip.style.display="block";
        tip.style.left=Math.max(4,Math.min(e.clientX-box.left+14,box.width-286))+"px";
        tip.style.top=(e.clientY-box.top+14)+"px";
        tip.innerHTML="<b>"+esc(a.title)+"</b><br>authorization"+(a.risk?(" · risk "+esc(a.risk)):"")+(a.waitMs!=null?(" · held "+fmtMs(a.waitMs)):"")+(a.approvalState?(" · "+esc(a.approvalState)):"");
      });
      g.addEventListener("mouseleave",function(){tip.style.display="none"});
      svg.appendChild(g);
    });
    wrap.appendChild(svg);
  }
  Array.prototype.slice.call(document.querySelectorAll("[data-flow-zoom]")).forEach(function(b){
    b.addEventListener("click",function(){window.torrixFlowZoom(b.getAttribute("data-flow-zoom"))});
  });
  var comp=document.getElementById("flow-compress");
  if(comp){
    try{comp.checked=(localStorage.getItem("torrix_flow_compress")||"1")==="1"}catch(e){}
    compress=comp.checked;
    comp.addEventListener("change",function(){compress=comp.checked;try{localStorage.setItem("torrix_flow_compress",comp.checked?"1":"0")}catch(e){}draw()});
  }
  wrap.addEventListener("wheel",function(e){
    if(!(e.ctrlKey||e.metaKey))return;
    e.preventDefault();
    setZoom(e.deltaY<0?zoom*1.2:zoom/1.2);
  },{passive:false});
  window.torrixRenderFlow=draw;
  draw();
})();</script>`;
}

function runFlowToggleScript(): string {
  return `<script>(function(){
  var KEY="torrix_trace_view";
  var tree=document.getElementById("view-tree"),flow=document.getElementById("view-flow");
  if(!tree||!flow)return;
  var buttons=Array.prototype.slice.call(document.querySelectorAll("[data-view]"));
  function apply(view){
    var isFlow=view==="flow";
    tree.style.display=isFlow?"none":"";
    flow.style.display=isFlow?"":"none";
    buttons.forEach(function(b){b.classList.toggle("active",b.getAttribute("data-view")===(isFlow?"flow":"tree"))});
    if(isFlow&&window.torrixRenderFlow)window.torrixRenderFlow();
  }
  buttons.forEach(function(b){
    b.addEventListener("click",function(){
      var view=b.getAttribute("data-view");
      try{localStorage.setItem(KEY,view)}catch(e){}
      apply(view);
    });
  });
  var saved="tree";
  try{saved=localStorage.getItem(KEY)||"tree"}catch(e){}
  apply(saved==="flow"?"flow":"tree");
})();</script>`;
}

const TREE_AGENT_TONES = ["s1", "s2", "s3", "s4", "s5"];

export function treeAgentChip(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  const tone = TREE_AGENT_TONES[hash % TREE_AGENT_TONES.length];
  return `<span class="agent-chip" style="--agent-tone:var(--${tone})">${escapeHtml(name)}</span>`;
}

function runEventsScript(): string {
  return `<script>(function(){
  var table=document.getElementById("run-tree");
  if(!table)return;
  var cache={};
  function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}
  function clip(s,n){s=String(s==null?"":s);return s.length>n?s.slice(0,n)+"…":s}
  function fmtTime(ts){var t=Date.parse(ts);return isFinite(t)?new Date(t).toLocaleTimeString():"-"}
  function argsText(raw){
    if(raw==null)return "";
    if(typeof raw==="object")return JSON.stringify(raw);
    var text=String(raw).trim();
    try{var parsed=JSON.parse(text);if(parsed&&typeof parsed==="object")return JSON.stringify(parsed)}catch(e){}
    return text;
  }
  function row(runId,kind,title,body,ts){
    return '<tr class="ev-row" data-event-row="1" data-run="'+esc(runId)+'" data-parent="'+esc(runId)+'">'
      +'<td class="mono" style="color:var(--text-3);font-size:12px">'+esc(fmtTime(ts))+'</td>'
      +'<td colspan="9"><div class="authz-cell">'
      +'<span class="ev-mark '+kind+'" aria-hidden="true"></span>'
      +'<span class="cell-stack"><span class="cell-inline"><span class="ev-kind">'+kind+'</span> <span class="authz-title">'+esc(clip(title,140))+'</span></span>'
      +(body?'<span class="ev-args">'+esc(clip(body,260))+'</span>':'')
      +'</span></div></td></tr>';
  }
  function toolRows(runId,message,ts){
    var items=null;
    try{
      var parsed=JSON.parse(message);
      if(Array.isArray(parsed))items=parsed;
      else if(parsed&&typeof parsed==="object")items=[parsed];
    }catch(e){}
    if(!items||!items.length){return row(runId,"tool",clip(message,120),"",ts)}
    return items.map(function(item){
      if(!item||typeof item!=="object"){return row(runId,"tool",String(item),"",ts)}
      var fn=item.function&&typeof item.function==="object"?item.function:null;
      var name=item.name||(fn&&fn.name)||"tool";
      var args=item.arguments!==undefined?item.arguments:(fn?fn.arguments:item.input);
      return row(runId,"tool",name,argsText(args),ts);
    }).join("");
  }
  function eventRows(runId,events){
    var html="";
    events.forEach(function(ev){
      if(ev.type==="tool_call"){html+=toolRows(runId,ev.message,ev.created_at)}
      else if(ev.type==="thinking"){html+=row(runId,"think","reasoning",ev.message,ev.created_at)}
    });
    return html||row(runId,"think","no tool calls or reasoning captured","","");
  }
  function lastChild(runId){
    var first=table.querySelector('tbody tr[data-run="'+runId+'"]');
    var last=first;
    while(last&&last.nextElementSibling){
      var next=last.nextElementSibling;
      if(next.hasAttribute("data-event-row")||next.classList.contains("authz-row")||next.classList.contains("policy-row")){last=next}else{break}
    }
    return last;
  }
  function clear(runId){
    Array.prototype.slice.call(table.querySelectorAll('tr[data-event-row="1"][data-run="'+runId+'"]')).forEach(function(r){r.parentNode.removeChild(r)});
  }
  table.addEventListener("click",function(e){
    var b=e.target&&e.target.closest?e.target.closest("[data-events]"):null;
    if(!b)return;
    e.stopPropagation();e.preventDefault();
    var runId=b.getAttribute("data-events");
    if(b.getAttribute("data-expanded")==="1"){
      clear(runId);b.setAttribute("data-expanded","0");b.textContent="▸";b.title="Show tool calls and reasoning";return;
    }
    if(cache[runId]){
      var anchor=lastChild(runId);
      if(anchor)anchor.insertAdjacentHTML("afterend",cache[runId]);
      b.setAttribute("data-expanded","1");b.textContent="▾";b.title="Hide tool calls and reasoning";return;
    }
    b.disabled=true;b.textContent="…";
    fetch("/api/runs/"+encodeURIComponent(runId)+"/events",{headers:{authorization:"Bearer "+(localStorage.getItem("torrix_key")||"")}})
      .then(function(res){return res.ok?res.json():null})
      .then(function(payload){
        b.disabled=false;b.textContent="▸";
        if(!payload||!payload.events)return;
        cache[runId]=eventRows(runId,payload.events);
        var anchor=lastChild(runId);
        if(anchor)anchor.insertAdjacentHTML("afterend",cache[runId]);
        b.setAttribute("data-expanded","1");b.textContent="▾";b.title="Hide tool calls and reasoning";
      })
      .catch(function(){b.disabled=false;b.textContent="▸"});
  },true);
})();</script>`;
}

function runTreeScript(): string {
  return `<script>(function(){
  var table=document.getElementById("run-tree");
  if(!table)return;
  var collapsed=new Set();
  function rows(){return Array.prototype.slice.call(table.querySelectorAll("tbody tr[data-run]"))}
  function refresh(){
    var hidden=new Set();
    rows().forEach(function(r){var p=r.getAttribute("data-parent");if(p&&(hidden.has(p)||collapsed.has(p)))hidden.add(r.getAttribute("data-run"))});
    rows().forEach(function(r){
      var id=r.getAttribute("data-run");
      r.classList.toggle("tree-hidden",hidden.has(id));
      var b=r.querySelector("[data-toggle]");
      if(b){var c=collapsed.has(id);b.textContent=c?"▸":"▾";b.setAttribute("aria-label",c?"Expand subtree":"Collapse subtree")}
    });
  }
  table.addEventListener("click",function(e){
    var b=e.target&&e.target.closest?e.target.closest("[data-toggle]"):null;
    if(!b)return;
    e.stopPropagation();e.preventDefault();
    var id=b.closest("tr").getAttribute("data-run");
    if(collapsed.has(id))collapsed.delete(id);else collapsed.add(id);
    refresh();
  },true);
})();</script>`;
}

const EYE_ON = `<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 9S4 4.5 9 4.5 16.5 9 16.5 9 14 13.5 9 13.5 1.5 9 1.5 9Z"/><circle cx="9" cy="9" r="2.2"/></svg>`;

const EYE_OFF = `<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3.2 15 15"/><path d="M6 6C4.4 7.1 3 8.6 2.1 10c0 0 3 4.6 6.9 4.6 1.2 0 2.3-.3 3.3-.8"/><path d="M10.6 4.9C12.8 5.9 14.8 8 15.9 10"/></svg>`;

function loginPage(providers: Array<{ label: string; href: string }> = []): string {
  const heroSignal = `
  <svg viewBox="0 0 460 118" fill="none" aria-hidden="true">
    <path d="M0 98c32-3 36-36 68-38s32 24 64 22 28-46 58-48 24 22 56 20 36-30 66-32 24 26 56 22 28-24 48-28M0 98c0-42 14-70 40-80" stroke="#0284c7" stroke-width="1.8" stroke-linecap="round" opacity=".85"/>
    <circle cx="32" cy="60" r="4" fill="none" stroke="#0284c7" stroke-width="1.6"/>
    <circle cx="196" cy="52" r="4" fill="none" stroke="#6366f1" stroke-width="1.6"/>
    <circle cx="366" cy="32" r="4" fill="none" stroke="#059669" stroke-width="1.6"/>
  </svg>`;

  const checkIcon = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5 6.5 12 13 4.5"/></svg>`;

  const pole = `
  <div class="lg-shell">
    <aside class="lg-hero">
      <div class="lg-hero-inner">
        <div class="lg-brand"><img class="brand-mark" src="/ui/assets/torrix-logo.png" alt="" width="36" height="36"><span class="word">Torrix</span></div>
        <div class="lg-hero-mid">
          <h1>Every model call,<br><span class="lg-acc">under control.</span></h1>
          <p class="lg-lead">Torrix sits between your code and any LLM provider: capturing tokens, cost, latency and the full prompt and response history, without your data ever leaving this host.</p>
          <ul class="lg-points">
            <li>${checkIcon}<span>Prompt &amp; response history for every run</span></li>
            <li>${checkIcon}<span>Spend, tokens and latency in one dashboard</span></li>
            <li>${checkIcon}<span>Proxy, SDK or both: zero app rewrites</span></li>
          </ul>
        </div>
        <div class="lg-signal">${heroSignal}</div>
        <div class="lg-hero-foot">Torrix 1.0.0 · community edition</div>
      </div>
    </aside>
    <main class="lg-main">
      <div class="lg-card">
        <div class="lg-card-head"><img class="brand-mark" src="/ui/assets/torrix-logo.png" alt="" width="28" height="28"><span class="word">Torrix</span></div>
        <p class="lg-card-tag">Self-hosted LLM observability</p>
        <div class="lg-tabs">
          <button type="button" id="tabLogin" class="active">Sign in</button>
          <button type="button" id="tabSignup">Create account</button>
          <button type="button" id="tabKey">I have a key</button>
        </div>
        <form onsubmit="return false" id="authForm">
          <div id="paneLogin">
            <label for="lemail">Email</label>
            <input id="lemail" type="email" autocomplete="email" placeholder="you@example.com" autofocus>
            <label for="lpassword">Password</label>
            <div class="lg-field">
              <input id="lpassword" type="password" autocomplete="current-password" placeholder="Your password" style="padding-right:40px">
              <button type="button" class="lg-eye" id="lpEye" aria-label="Show password">${EYE_ON}</button>
            </div>
            <div class="field-error" id="loginErr"></div>
            <button class="lg-btn" id="loginBtn">Sign in</button>
            ${providers
              .map(
                (provider) =>
                  `<a class="lg-btn ghost" href="${escapeHtml(provider.href)}" style="display:block;text-align:center;margin-top:10px;text-decoration:none">${escapeHtml(provider.label)}</a>`,
              )
              .join("")}
          </div>
          <div id="paneSignup" style="display:none">
            <label for="email">Email</label>
            <input id="email" type="email" autocomplete="email" placeholder="you@example.com">
            <label for="password">Password</label>
            <div class="lg-field">
              <input id="password" type="password" autocomplete="new-password" placeholder="At least 8 characters" style="padding-right:40px">
              <button type="button" class="lg-eye" id="pEye" aria-label="Show password">${EYE_ON}</button>
            </div>
            <div class="field-error" id="signupErr"></div>
            <button class="lg-btn" id="signupBtn">Create account &amp; get API key</button>
          </div>
          <div id="paneKey" style="display:none">
            <label for="apikey">API key</label>
            <input id="apikey" type="text" class="mono" autocomplete="off" placeholder="trxk_..." style="font-family:var(--mono)">
            <p class="lg-hint">Paste a key and validate it against this instance.</p>
            <div class="field-error" id="keyErr"></div>
            <button class="lg-btn ghost" id="keyBtn">Sign in with key</button>
          </div>
        </form>
        <div id="paneResult" style="display:none;margin-top:14px">
          <label>Your API key</label>
          <div class="keybox"><code id="keytext"></code><button class="btn btn-ghost btn-icon" id="copyBtn" title="Copy key">${ICON_COPY}</button></div>
          <p class="lg-hint">Shown once: store it somewhere safe. You can paste it back into “I have a key”.</p>
          <button class="lg-btn" id="doneBtn" style="margin-top:18px">Open dashboard</button>
        </div>
        <p class="lg-foot">Self-hosted · your data never leaves this machine</p>
      </div>
    </main>
  </div>
  <script>
  const show=(name)=>{
    ["login","signup","key","result"].forEach(p=>{
      const el=document.getElementById("pane"+p[0].toUpperCase()+p.slice(1));
      el.style.display=p===name?"block":"none";
    });
  };
  const activate=(p)=>{
    document.getElementById("tabLogin").className="";
    document.getElementById("tabSignup").className="";
    document.getElementById("tabKey").className="";
    document.getElementById("tab"+p[0].toUpperCase()+p.slice(1)).className="active";
    show(p);
  };
  document.getElementById("tabLogin").onclick=()=>activate("login");
  document.getElementById("tabSignup").onclick=()=>activate("signup");
  document.getElementById("tabKey").onclick=()=>activate("key");
  const toggleEye=(inputId,btnId)=>{
    const i=document.getElementById(inputId);const b=document.getElementById(btnId);
    const isPassword=i.type==="password";
    i.type=isPassword?"text":"password";
    b.innerHTML=isPassword?${JSON.stringify(EYE_OFF)}:${JSON.stringify(EYE_ON)};
  };
  document.getElementById("lpEye").onclick=()=>toggleEye("lpassword","lpEye");
  document.getElementById("pEye").onclick=()=>toggleEye("password","pEye");
  const qs=new URLSearchParams(location.search);
  if(qs.get("error")){document.getElementById("loginErr").textContent="Sign-in failed ("+qs.get("error")+").";}
  document.getElementById("loginBtn").onclick=async()=>{
    const err=document.getElementById("loginErr");err.textContent="";
    const email=document.getElementById("lemail").value.trim();
    const password=document.getElementById("lpassword").value;
    if(!email||!password){err.textContent="Enter your email and password.";return}
    const r=await fetch("/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password})});
    const j=await r.json().catch(()=>({}));
    if(!r.ok){err.textContent=j.error==="invalid_credentials"?"Invalid email or password.":(j.error||"Login failed. Please try again.");return}
    localStorage.setItem("torrix_key",j.api_key);
    location.href="/ui/dashboard";
  };
  document.getElementById("signupBtn").onclick=async()=>{
    const err=document.getElementById("signupErr");err.textContent="";
    const email=document.getElementById("email").value.trim();
    const password=document.getElementById("password").value;
    if(!email||password.length<8){err.textContent="Enter a valid email and a password of at least 8 characters.";return}
    const r=await fetch("/auth/signup",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password})});
    const j=await r.json().catch(()=>({}));
    if(!r.ok){err.textContent=j.error||"Signup failed. Please try again.";return}
    localStorage.setItem("torrix_key",j.api_key);
    document.getElementById("keytext").textContent=j.api_key;
    show("result");
  };
  document.getElementById("copyBtn").onclick=async()=>{
    const t=document.getElementById("keytext").textContent;
    try{await navigator.clipboard.writeText(t)}catch(e){
      const ta=document.createElement("textarea");ta.value=t;document.body.appendChild(ta);ta.select();
      document.execCommand("copy");ta.remove();
    }
    document.getElementById("copyBtn").title="Copied";
  };
  document.getElementById("doneBtn").onclick=()=>location.href="/ui/dashboard";
  document.getElementById("keyBtn").onclick=async()=>{
    const err=document.getElementById("keyErr");err.textContent="";
    const apiKey=document.getElementById("apikey").value.trim();
    if(!apiKey){err.textContent="Enter your API key.";return}
    const r=await fetch("/ui/session",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({api_key:apiKey})});
    if(!r.ok){err.textContent="That key is not valid for this instance.";localStorage.removeItem("torrix_key");return}
    localStorage.setItem("torrix_key",apiKey);
    location.href="/ui/dashboard";
  };
  document.getElementById("authForm").addEventListener("submit",e=>{
    e.preventDefault();
    const tab=document.querySelector(".lg-tabs button.active").id;
    const map={tabLogin:"loginBtn",tabSignup:"signupBtn",tabKey:"keyBtn"};
    document.getElementById(map[tab]||"loginBtn").click();
  });
  const stored=localStorage.getItem("torrix_key");
  if(stored){fetch("/ui/session",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({api_key:stored})}).then(r=>{if(r.ok)location.href="/ui/dashboard"})}
  </script>`;

  const lgStyle = `
  .lg-shell{min-height:100vh;display:flex;background:transparent}
  .lg-hero{flex:1.05;min-width:0;display:none;border-right:1px solid var(--side-line);position:relative;overflow:hidden;
    background:
      radial-gradient(760px 420px at 88% -14%,var(--wash),transparent 62%),
      radial-gradient(620px 420px at -8% 112%,var(--wash-2),transparent 60%),
      var(--side-bg)}
  .lg-hero::after{content:"";position:absolute;inset:0;pointer-events:none;
    background-image:radial-gradient(1.2px 1.2px at 28px 28px,rgba(148,163,184,.16) 50%,transparent 51%);
    background-size:56px 56px;
    mask-image:radial-gradient(760px 540px at 58% 30%,#000 32%,transparent 78%)}
  .lg-hero-inner{position:relative;z-index:1;min-height:100vh;display:flex;flex-direction:column;padding:40px 48px}
  .lg-brand{display:flex;align-items:center;gap:11px}
  .lg-brand .brand-mark{width:36px;height:36px;border-radius:10px;object-fit:cover}
  .lg-brand .word{font-family:var(--display);font-size:20px;font-weight:600;letter-spacing:-.018em;color:var(--side-brand-text)}
  .lg-hero-mid{max-width:440px;margin:auto 0;padding:52px 0 36px}
  .lg-hero-mid h1{font-family:var(--display);font-size:36px;line-height:1.14;letter-spacing:-.028em;margin:0 0 16px;font-weight:600;color:var(--heading)}
  .lg-acc{color:var(--accent)}
  .lg-lead{color:var(--side-text-2);font-size:15px;line-height:1.65;margin:0 0 26px;max-width:420px}
  .lg-points{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}
  .lg-points li{display:flex;gap:10px;align-items:center;color:var(--side-text);font-size:13.5px}
  .lg-points li svg{width:16px;height:16px;color:var(--accent);flex:0 0 16px}
  .lg-signal{margin:0 0 40px;max-width:420px}
  .lg-hero-foot{color:var(--side-text-3);font-family:var(--mono);font-size:10.5px;display:flex;align-items:center;gap:10px;margin-top:auto}
  .lg-hero-foot::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--good);flex:0 0 7px}
  .lg-main{flex:1;display:flex;align-items:center;justify-content:center;padding:40px 44px}
  .lg-card{width:100%;max-width:400px;background:var(--surface);
    border:1px solid var(--line);border-radius:var(--r-xl);padding:28px;box-shadow:var(--shadow)}
  .lg-card-head{display:flex;align-items:center;gap:11px;margin-bottom:6px}
  .lg-card-head .brand-mark{width:28px;height:28px;border-radius:8px;object-fit:cover}
  .lg-card-head .word{font-family:var(--display);font-size:18px;font-weight:600;letter-spacing:-.018em;color:var(--heading)}
  .lg-card-tag{color:var(--text-3);font-size:13px;margin:0 0 22px}
  .lg-tabs{display:flex;gap:3px;background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r-lg);padding:3px;margin-bottom:20px}
  .lg-tabs button{flex:1;background:transparent;border:0;color:var(--text-3);padding:8px 10px;font-family:var(--display);font-size:12.5px;font-weight:600;border-radius:4px;transition:background .12s,color .12s}
  .lg-tabs button.active{background:var(--surface);color:var(--text);font-weight:600;box-shadow:var(--shadow-sm)}
  .lg-field{position:relative}
  .lg-eye{position:absolute;right:5px;top:50%;transform:translateY(-50%);background:transparent;border:0;color:var(--text-3);padding:7px;border-radius:4px}
  .lg-eye:hover{color:var(--text-2);background:var(--surface-2)}
  .lg-eye svg{width:17px;height:17px;display:block}
  .lg-card label{display:block;font-family:var(--mono);font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--text-3);margin:15px 0 7px}
  .lg-card .lg-field input, .lg-card .lg-field ::placeholder{font:inherit}
  .lg-hint{font-size:12.5px;color:var(--text-3);margin:12px 0 0;line-height:1.6}
  .lg-btn{width:100%;margin-top:16px;border-radius:var(--r);padding:11px;font-family:var(--display);font-size:13.5px;font-weight:600;border:1px solid transparent;
    color:var(--on-accent);background:var(--accent-fill);transition:filter .12s}
  .lg-btn:hover{filter:brightness(1.06);color:var(--on-accent)}
  .lg-btn.ghost{background:var(--surface);color:var(--text-2);border-color:var(--line-2)}
  .lg-btn.ghost:hover{background:var(--surface-2);color:var(--text);filter:none}
  .lg-foot{margin-top:24px;text-align:center;font-family:var(--mono);font-size:10.5px;color:var(--text-3)}
  .lg-theme{position:fixed;top:18px;right:18px;z-index:5}
  @media(min-width:940px){.lg-hero{display:flex}.lg-card-head{display:none}}
  @media(prefers-reduced-motion:reduce){.lg-signal{display:none}}
  `;

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f8fafc">
<link rel="icon" type="image/png" href="/ui/assets/torrix-logo.png"><link rel="apple-touch-icon" href="/ui/assets/torrix-logo.png">
${THEME_BOOT}
<title>Sign in · Torrix</title><style>${STYLE}
${lgStyle}</style></head>
<body>${themeToggleButton("lg-theme")}${pole}
${THEME_SCRIPT}
</body></html>`;
}