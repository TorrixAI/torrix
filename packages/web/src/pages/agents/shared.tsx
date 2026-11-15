import { NavLink } from "react-router-dom";
import type { DelegationLimits } from "../../api";
import { useFeature } from "../../features";

const TABS: Array<[string, string]> = [
  ["/ui/agents", "Registry"],
  ["/ui/agents/observed", "Observed"],
  ["/ui/agents/delegations", "Delegations"],
  ["/ui/agents/policies", "Authorization policies"],
  ["/ui/agents/approvals", "Approvals"],
  ["/ui/agents/mcp", "MCP servers"],
  ["/ui/agents/graph", "Who can do what"],
  ["/ui/agents/activity", "Activity"],
  ["/ui/agents/settings", "Settings"],
];

export function AgentNav() {
  const { allowed, ready } = useFeature("agent-control");
  // Without the control plane the paid sections only lead to 404s, so Community
  // shows Observed plus a Registry link that explains what Pro adds.
  if (ready && !allowed) {
    return (
      <div className="agent-tabs console-tabs">
        <NavLink to="/ui/locked/agent-control" title="Available in Pro">Registry <span className="nav-lock">Pro</span></NavLink>
        <NavLink to="/ui/agents/observed" className={({ isActive }) => (isActive ? "active" : "")}>Observed</NavLink>
      </div>
    );
  }
  return (
    <div className="agent-tabs console-tabs">
      {TABS.map(([href, label]) => (
        <NavLink key={href} to={href} end={href === "/ui/agents"} className={({ isActive }) => (isActive ? "active" : "")}>{label}</NavLink>
      ))}
    </div>
  );
}

export function listOf(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return value.split(",").map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

export function limitsOf(value: DelegationLimits | string | null | undefined): DelegationLimits {
  if (value && typeof value === "object") return value;
  if (typeof value === "string" && value.trim()) {
    try { return JSON.parse(value) as DelegationLimits; } catch { return {}; }
  }
  return {};
}

export function conditionsOf(value: Record<string, unknown> | string | null | undefined): Record<string, unknown> {
  if (value && typeof value === "object") return value;
  if (typeof value === "string" && value.trim()) {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
  }
  return {};
}

export function badgeTone(status: string): string {
  if (status === "active" || status === "allow" || status === "approved" || status === "connected" || status === "success" || status === "executed") return "good";
  if (status === "revoked" || status === "blocked" || status === "deny" || status === "rejected" || status === "error" || status === "failed") return "bad";
  if (status === "suspended" || status === "expired" || status === "require_approval" || status === "pending" || status === "unknown") return "warn";
  return "neutral";
}

export function badgeClass(status: string): string {
  const tone = badgeTone(status);
  return tone === "neutral" ? "badge" : `badge ${tone}`;
}

export function agentLabel(agents: Array<{ id: string; name: string }>, id: string | null | undefined): string {
  if (!id) return "-";
  return agents.find((agent) => agent.id === id)?.name ?? id.slice(0, 8);
}
