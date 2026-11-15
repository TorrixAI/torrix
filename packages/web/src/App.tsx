import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQuery } from "@tanstack/react-query";
import { RequireFeature, useFeature } from "./features";
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Command } from "cmdk";
import { api, type AppConfig } from "./api";
import { Icon, ThemeToggle, TorrixMark } from "./icons";
import { InlineSelect } from "./components";
import { clearPlaygroundStorage } from "./pages/playgroundUtil";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "./toast";

// Route-level code splitting: the shell stays eager, each page loads on demand
// so the initial bundle (and the public share view) does not pull in ECharts.
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const RunsPage = lazy(() => import("./pages/RunsPage"));
const RunDetailPage = lazy(() => import("./pages/RunDetailPage"));
const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage"));
const LivePage = lazy(() => import("./pages/LivePage"));
const InsightsPage = lazy(() => import("./pages/InsightsPage"));
const TracesPage = lazy(() => import("./pages/TracesPage"));
const TraceDetailPage = lazy(() => import("./pages/TraceDetailPage"));
const PromptsPage = lazy(() => import("./pages/PromptsPage"));
const PromptDetailPage = lazy(() => import("./pages/PromptDetailPage"));
const DatasetsPage = lazy(() => import("./pages/DatasetsPage"));
const DatasetDetailPage = lazy(() => import("./pages/DatasetDetailPage"));
const CostPage = lazy(() => import("./pages/CostPage"));
const ProjectsPage = lazy(() => import("./pages/ProjectsPage"));
const TeamPage = lazy(() => import("./pages/TeamPage"));
const KeysPage = lazy(() => import("./pages/KeysPage"));
const GovernancePage = lazy(() => import("./pages/GovernancePage"));
const CompliancePage = lazy(() => import("./pages/CompliancePage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const QueryPage = lazy(() => import("./pages/QueryPage"));
const ComparePage = lazy(() => import("./pages/ComparePage"));
const PlaygroundPage = lazy(() => import("./pages/PlaygroundPage"));
const IntegrationsPage = lazy(() => import("./pages/IntegrationsPage"));
const LockedPage = lazy(() => import("./pages/LockedPage"));
const AgentsPage = lazy(() => import("./pages/agents/AgentsPage"));
const AgentDetailPage = lazy(() => import("./pages/agents/AgentDetailPage"));
const ObservedAgentsPage = lazy(() => import("./pages/agents/ObservedAgentsPage"));
const DelegationsPage = lazy(() => import("./pages/agents/DelegationsPage"));
const AgentPoliciesPage = lazy(() => import("./pages/agents/AgentPoliciesPage"));
const ApprovalsPage = lazy(() => import("./pages/agents/ApprovalsPage"));
const McpServersPage = lazy(() => import("./pages/agents/McpServersPage"));
const AgentSettingsPage = lazy(() => import("./pages/agents/AgentSettingsPage"));
const AgentGraphPage = lazy(() => import("./pages/agents/AgentGraphPage"));
const AgentActivityPage = lazy(() => import("./pages/agents/AgentActivityPage"));
const AgentActivityDetailPage = lazy(() => import("./pages/agents/AgentActivityDetailPage"));

interface NavItem { id: string; href: string; label: string; icon: string; admin?: boolean; feature?: string }

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", href: "/ui/dashboard", label: "Dashboard", icon: "dash" },
  { id: "analytics", href: "/ui/analytics", label: "Analytics", icon: "analytics" },
  { id: "runs", href: "/ui/runs", label: "Runs", icon: "runs" },
  { id: "traces", href: "/ui/traces", label: "Traces", icon: "trace" },
  { id: "live", href: "/ui/live", label: "Live feed", icon: "live" },
  { id: "insights", href: "/ui/insights", label: "Insights", icon: "insights" },
  { id: "playground", href: "/ui/playground", label: "Playground", icon: "play" },
  { id: "agents", href: "/ui/agents", label: "Agents", icon: "agent" },
  { id: "agents-registry", href: "/ui/agents", label: "Registry", icon: "registry", feature: "agent-control" },
  { id: "agents-observed", href: "/ui/agents/observed", label: "Observed", icon: "eye" },
  { id: "delegations", href: "/ui/agents/delegations", label: "Delegations", icon: "delegation", feature: "agent-control" },
  { id: "authz-policies", href: "/ui/agents/policies", label: "Authorization policies", icon: "policy", feature: "agent-control" },
  { id: "approvals", href: "/ui/agents/approvals", label: "Approvals", icon: "approval", feature: "agent-control" },
  { id: "activity", href: "/ui/agents/activity", label: "Activity", icon: "activity", feature: "agent-control" },
  { id: "mcp", href: "/ui/agents/mcp", label: "MCP servers", icon: "server", feature: "agent-control" },
  { id: "authz-graph", href: "/ui/agents/graph", label: "Who can do what", icon: "graph", feature: "permission-graph" },
  { id: "prompts", href: "/ui/prompts", label: "Prompts", icon: "prompt" },
  { id: "datasets", href: "/ui/datasets", label: "Datasets & Evals", icon: "data" },
  { id: "cost", href: "/ui/cost", label: "Cost & Alerts", icon: "cost" },
  { id: "projects", href: "/ui/projects", label: "Projects", icon: "folder" },
  { id: "team", href: "/ui/team", label: "Team", icon: "team" },
  { id: "keys", href: "/ui/keys", label: "API Keys", icon: "key" },
  { id: "integrations", href: "/ui/integrations", label: "Integrations", icon: "plug" },
  { id: "governance", href: "/ui/governance", label: "Governance", icon: "shield" },
  { id: "compliance", href: "/ui/compliance", label: "Compliance", icon: "compliance", feature: "compliance" },
  { id: "query", href: "/ui/query", label: "SQL console", icon: "terminal", admin: true },
  { id: "settings", href: "/ui/settings", label: "Settings", icon: "set", admin: true },
];

const NAV_GROUPS: Array<{ label: string; ids: string[] }> = [
  { label: "Observability", ids: ["dashboard", "analytics", "runs", "traces", "live", "insights"] },
  { label: "Build", ids: ["playground", "prompts", "datasets", "integrations"] },
  { label: "Agents", ids: ["agents"] },
  { label: "Governance", ids: ["governance", "compliance"] },
  { label: "Workspace", ids: ["cost", "projects", "team", "keys"] },
  { label: "System", ids: ["query", "settings"] },
];

const MIGRATED = new Set(NAV_ITEMS.map((item) => item.href));

// The edition a paid surface needs, for the nav badge.
function paidEdition(feature: string): "pro" | "enterprise" {
  return feature === "compliance" || feature === "audit-export" || feature === "external-exports" || feature === "sso" || feature === "permission-graph" ? "enterprise" : "pro";
}

/** The registry needs the control plane; Community falls back to observed agents. */
function AgentRegistry() {
  const { allowed, ready } = useFeature("agent-control");
  if (!ready) return <div className="startup loading-page"><span>Loading...</span></div>;
  if (!allowed) return <Navigate to="/ui/agents/observed" replace />;
  return <AgentsPage />;
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [sideOpen, setSideOpen] = useState(false);
  const [sideCollapsed, setSideCollapsed] = useState(() => localStorage.getItem("torrix_side_collapsed") === "1");
  const [density, setDensity] = useState<"comfortable" | "compact">(() => localStorage.getItem("torrix_density") === "compact" ? "compact" : "comfortable");
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("torrix_nav_groups") ?? "{}") as Record<string, boolean>;
      if (Object.keys(saved).length) return saved;
    } catch { /* fall through to the quiet default */ }
    return { Agents: location.pathname.startsWith("/ui/agents"), Governance: false, Workspace: false, System: false };
  });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [upBannerOpen, setUpBannerOpen] = useState(() => localStorage.getItem("torrix_up_banner_dismissed") !== "1");
  const searchRef = useRef<HTMLInputElement>(null);

  const userQuery = useQuery({ queryKey: ["whoami"], queryFn: () => api<{ email: string; is_admin: boolean }>("/api/whoami") });
  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: () => api<{ projects: { id: string; name: string }[] }>("/api/projects") });
  const configQuery = useQuery({ queryKey: ["config"], queryFn: () => api<AppConfig>("/api/config") });

  // Cursor-following coordinate grid (matches the server-rendered shell).
  useEffect(() => {
    if (!window.matchMedia?.("(pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = document.documentElement;
    let frame = 0;
    const onMove = (event: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; root.style.setProperty("--mx", `${event.clientX}px`); root.style.setProperty("--my", `${event.clientY}px`); });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => { window.removeEventListener("pointermove", onMove); if (frame) cancelAnimationFrame(frame); };
  }, []);

  useEffect(() => {
    const update = () => {
      document.querySelectorAll<HTMLElement>(".table-wrap").forEach((wrap) => {
        wrap.classList.toggle("is-scrollable", wrap.scrollWidth > wrap.clientWidth + 1);
      });
    };
    update();
    const frame = requestAnimationFrame(update);
    const observer = new MutationObserver(update);
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", update);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("resize", update); };
  }, [location.pathname]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (event.key === "Escape") {
        setPaletteOpen(false);
      } else if (event.key === "/") {
        const target = event.target as HTMLElement | null;
        const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
        if (!typing) { event.preventDefault(); searchRef.current?.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleTheme = () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("torrix_theme", next);
  };
  const toggleCollapse = () => {
    setSideCollapsed((current) => { localStorage.setItem("torrix_side_collapsed", current ? "0" : "1"); return !current; });
  };
  const changeDensity = (next: string) => {
    const value = next === "compact" ? "compact" : "comfortable";
    setDensity(value);
    localStorage.setItem("torrix_density", value);
    toast.toast(`Density: ${value}`, { type: "success" });
  };
  const toggleGroup = (label: string) => {
    setGroupOpen((current) => {
      const next = { ...current, [label]: current[label] === false };
      localStorage.setItem("torrix_nav_groups", JSON.stringify(next));
      return next;
    });
  };
  const searchHint = "Ctrl K";
  const signOut = () => {
    // Provider keys and the saved transcript must not outlive the session on a
    // shared browser profile.
    clearPlaygroundStorage();
    localStorage.removeItem("torrix_key");
    window.location.assign("/ui/logout");
  };

  const isAdmin = userQuery.data ? userQuery.data.is_admin === true || String(userQuery.data.is_admin) === "1" : false;
  const features = configQuery.data?.features ?? [];
  const visible = NAV_ITEMS.filter((item) => !item.admin || isAdmin);
  const paletteItems = useMemo<Array<{ label: string; href?: string; action?: () => void; hint?: string }>>(() => [
    ...visible.map((item) => ({ label: item.label, href: item.href })),
    { label: "Compare runs", href: "/ui/compare" },
    { label: "Density: Comfortable", action: () => changeDensity("comfortable"), hint: density === "comfortable" ? "current" : undefined },
    { label: "Density: Compact", action: () => changeDensity("compact"), hint: density === "compact" ? "current" : undefined },
  ], [visible, density]);
  const runPaletteItem = (item: { href?: string; action?: () => void }) => {
    setPaletteOpen(false);
    if (item.href) navigate(item.href);
    else item.action?.();
  };
  const renderNavItem = (item: NavItem) => {
    const active = item.id === "agents"
      ? location.pathname.startsWith("/ui/agents")
      : location.pathname === item.href || (item.href !== "/ui/dashboard" && location.pathname.startsWith(`${item.href}/`));
    // A paid item the instance does not have points at its upgrade page and
    // is tagged with the edition it needs, like the server-rendered nav did.
    const locked = item.feature && !features.includes(item.feature) ? paidEdition(item.feature) : null;
    const href = locked ? `/ui/locked/${item.feature}` : item.href;
    // The group heading already says Agents. The destination is Registry in
    // editions with the control plane, and Observed without it.
    const label = item.id === "agents" ? (features.includes("agent-control") ? "Registry" : "Observed") : item.label;
    return <SidebarMenuItem key={item.id}>
      {MIGRATED.has(item.href)
        ? <SidebarMenuButton asChild isActive={active}>{locked
          ? <Link to={href} title={`Available in ${locked === "pro" ? "Pro" : "Enterprise"}`}><Icon name={item.icon} /><span>{label}</span>{sideCollapsed ? null : <span className="nav-lock">{locked === "pro" ? "Pro" : "Ent"}</span>}</Link>
          : <NavLink to={href}><Icon name={item.icon} /><span>{label}</span></NavLink>}</SidebarMenuButton>
        : <SidebarMenuButton asChild isActive={active}><a href={href}><Icon name={item.icon} /><span>{label}</span></a></SidebarMenuButton>}
    </SidebarMenuItem>;
  };

  if (userQuery.isPending) return <div className="startup"><span>Opening Torrix...</span></div>;
  if (userQuery.isError) return <div className="startup"><span>Could not load your session.</span><a href="/ui/login">Sign in</a></div>;

  const email = userQuery.data.email;
  const initials = email.split("@")[0]?.slice(0, 2).toUpperCase() || "TX";
  const edition = `self-hosted · v${configQuery.data?.version ?? "..."}`;
  const editionLabel = configQuery.data?.edition === "enterprise" ? "Enterprise edition" : configQuery.data?.edition === "pro" ? "Pro edition" : "Community edition";
  return <div className={`app${sideOpen ? " side-open" : ""}${sideCollapsed ? " side-collapsed" : ""}`} data-density={density}>
    <aside className="sidebar">
      <div className="brand"><TorrixMark className="brand-mark" /><div className="brand-text"><span className="word">Torrix</span><span className="brand-sub">{editionLabel}</span></div></div>
      <nav className="nav-groups">
        {NAV_GROUPS.map((group) => {
          const items = visible.filter((item) => group.ids.includes(item.id));
          if (!items.length) return null;
          return <div className="nav-group" key={group.label}>
            <button type="button" className="nav-cap nav-group-toggle" aria-expanded={groupOpen[group.label] !== false} onClick={() => toggleGroup(group.label)}>
              <span>{group.label}</span><span className="nav-chev" aria-hidden="true"><Icon name="chevron" /></span>
            </button>
            {groupOpen[group.label] !== false ? <SidebarMenu>
              {items.map(renderNavItem)}
            </SidebarMenu> : null}
          </div>;
        })}
      </nav>
      <div className="side-foot">
        <div className="side-foot-row">
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" className="side-toggle" type="button" aria-label={sideCollapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={toggleCollapse}>{"<"}</Button></TooltipTrigger><TooltipContent>{sideCollapsed ? "Expand sidebar" : "Collapse sidebar"}</TooltipContent></Tooltip>
        </div>
      </div>
    </aside>
    {sideOpen ? <button type="button" className="side-backdrop" aria-label="Close navigation" onClick={() => setSideOpen(false)} /> : null}
    <div className="main">
      <header className="topbar">
        <div className="topbar-inner">
          <Button variant="ghost" className="mobile-menu" type="button" aria-label="Open navigation" onClick={() => setSideOpen((current) => !current)}>Menu</Button>
          <form className="topbar-search" role="search" onSubmit={(event) => { event.preventDefault(); const value = String(new FormData(event.currentTarget).get("q") ?? "").trim(); navigate(value ? `/ui/runs?q=${encodeURIComponent(value)}` : "/ui/runs"); }}>
            <Icon name="search" />
            <Input ref={searchRef} className="h-auto" type="text" name="q" placeholder="Search runs, models, metadata..." autoComplete="off" aria-label="Search runs" />
            <kbd>{searchHint}</kbd>
          </form>
          <div className="topbar-right">
            <InlineSelect
              className="h-auto w-[190px] rounded-md border-line bg-surface-2 px-3 py-1.5 font-sans text-[12px] text-text-2 max-[900px]:hidden"
              aria-label="Project scope"
              value={new URLSearchParams(location.search).get("project") ?? localStorage.getItem("torrix_project_id") ?? ""}
              onValueChange={(value) => {
                const url = new URL(window.location.href);
                if (value) { url.searchParams.set("project", value); localStorage.setItem("torrix_project_id", value); }
                else { url.searchParams.delete("project"); localStorage.removeItem("torrix_project_id"); }
                document.cookie = `torrix_project=${encodeURIComponent(value)}; Path=/; Max-Age=${value ? 31536000 : 0}; SameSite=Lax`;
                navigate(`${url.pathname}${url.search}`);
              }}
              placeholder="All projects"
              options={[{ value: "", label: "All projects" }, ...(projectsQuery.data?.projects ?? []).map((project) => ({ value: project.id, label: project.name }))]}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="quick-settings-btn" type="button" aria-label={`Quick settings. Current density: ${density}`} title="Quick settings">
                  <Icon name="set" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Quick settings</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Row density</DropdownMenuLabel>
                <DropdownMenuCheckboxItem checked={density === "comfortable"} onCheckedChange={() => changeDensity("comfortable")}>Comfortable</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={density === "compact"} onCheckedChange={() => changeDensity("compact")}>Compact</DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate("/ui/settings")}>All settings</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <ThemeToggle onClick={toggleTheme} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="avatar avatar-btn" type="button" title={email} aria-label={`Account menu for ${email}`}>{initials}</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                <DropdownMenuLabel><b>{email}</b><span className="edition-chip">{edition}</span></DropdownMenuLabel>
                <DropdownMenuSeparator />
                {isAdmin ? <DropdownMenuItem asChild><Link to="/ui/settings"><span className="ico"><Icon name="set" /></span><span>Settings</span></Link></DropdownMenuItem> : null}
                <DropdownMenuItem variant="destructive" onSelect={signOut}><span className="ico"><Icon name="out" /></span><span>Sign out</span></DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>
      <main className="content">
        {configQuery.data?.is_demo ? <div className="demo-banner">Demo mode - read-only: writes are disabled</div> : null}
        {configQuery.data?.edition === "community" && upBannerOpen ? <div className="up-banner" role="note">
          <span>Community edition - Pro adds LLM judges, guardrails, routing, policies and agent governance (10 agents); Enterprise adds unlimited agents, SSO and compliance reporting. Licenses live under <a href="/ui/settings">Settings</a>.</span>
          <button type="button" className="up-banner-close" aria-label="Dismiss Community edition notice" title="Dismiss" onClick={() => { localStorage.setItem("torrix_up_banner_dismissed", "1"); setUpBannerOpen(false); }}>&times;</button>
        </div> : null}
        {configQuery.data?.update_available ? <div className="sys-banner">Update available: v{configQuery.data.update_available} - run <code>{configQuery.data.update_command}</code></div> : null}
        <Suspense fallback={<div className="startup loading-page"><span>Loading...</span></div>}>
          <Routes>
            <Route path="/ui/dashboard" element={<DashboardPage />} />
            <Route path="/ui/analytics" element={<AnalyticsPage />} />
            <Route path="/ui/runs" element={<RunsPage />} />
            <Route path="/ui/runs/:id" element={<RunDetailPage />} />
            <Route path="/ui/traces" element={<TracesPage />} />
            <Route path="/ui/traces/:id" element={<TraceDetailPage kind="trace" />} />
            <Route path="/ui/sessions/:id" element={<TraceDetailPage kind="session" />} />
            <Route path="/ui/live" element={<LivePage />} />
            <Route path="/ui/insights" element={<InsightsPage />} />
            <Route path="/ui/prompts" element={<PromptsPage />} />
            <Route path="/ui/prompts/:id" element={<PromptDetailPage />} />
            <Route path="/ui/datasets" element={<DatasetsPage />} />
            <Route path="/ui/datasets/:id" element={<DatasetDetailPage />} />
            <Route path="/ui/cost" element={<CostPage />} />
            <Route path="/ui/projects" element={<ProjectsPage />} />
            <Route path="/ui/team" element={<TeamPage />} />
            <Route path="/ui/keys" element={<KeysPage />} />
            <Route path="/ui/governance" element={<GovernancePage />} />
            <Route path="/ui/compliance" element={<CompliancePage />} />
            <Route path="/ui/settings" element={<SettingsPage />} />
            <Route path="/ui/query" element={<QueryPage />} />
            <Route path="/ui/compare" element={<ComparePage />} />
            <Route path="/ui/playground" element={<PlaygroundPage />} />
            <Route path="/ui/integrations" element={<IntegrationsPage />} />
            <Route path="/ui/locked/:feature" element={<LockedPage />} />
            <Route path="/ui/agents" element={<AgentRegistry />} />
            <Route path="/ui/agents/observed" element={<ObservedAgentsPage />} />
            <Route path="/ui/agents/delegations" element={<RequireFeature feature="agent-control"><DelegationsPage /></RequireFeature>} />
            <Route path="/ui/agents/policies" element={<RequireFeature feature="agent-control"><AgentPoliciesPage /></RequireFeature>} />
            <Route path="/ui/agents/approvals" element={<RequireFeature feature="agent-control"><ApprovalsPage /></RequireFeature>} />
            <Route path="/ui/agents/mcp" element={<RequireFeature feature="agent-control"><McpServersPage /></RequireFeature>} />
            <Route path="/ui/agents/graph" element={<RequireFeature feature="agent-control"><AgentGraphPage /></RequireFeature>} />
            <Route path="/ui/agents/activity" element={<RequireFeature feature="agent-control"><AgentActivityPage /></RequireFeature>} />
            <Route path="/ui/agents/activity/:id" element={<RequireFeature feature="agent-control"><AgentActivityDetailPage /></RequireFeature>} />
            <Route path="/ui/agents/settings" element={<RequireFeature feature="agent-control"><AgentSettingsPage /></RequireFeature>} />
            <Route path="/ui/agents/:id" element={<RequireFeature feature="agent-control"><AgentDetailPage /></RequireFeature>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
    </div>
    {paletteOpen ? <div className="cmdk-overlay open" onClick={() => setPaletteOpen(false)}>
      <Command className="cmdk" label="Command palette" onClick={(event) => event.stopPropagation()}>
        <Command.Input autoFocus placeholder="Jump to a page or setting... (Ctrl+K)" aria-label="Command palette" />
        <Command.List className="cmdk-list">
          <Command.Empty className="tcell-muted cmdk-item">No matches</Command.Empty>
          {paletteItems.map((item) => <Command.Item key={item.label} className="cmdk-item" value={`${item.label} ${item.hint ?? ""}`} onSelect={() => runPaletteItem(item)}>{item.label}<kbd>{item.hint ?? "Enter"}</kbd></Command.Item>)}
        </Command.List>
      </Command>
    </div> : null}
  </div>;
}

function NotFound() {
  return <div className="empty mt-10" >
    <span className="empty-title">Page not found</span>
    <span className="empty-sub">This console route does not exist. Use the sidebar or the Ctrl+K palette to jump to a page.</span>
  </div>;
}