import type { Edition } from "./editions";

/**
 * Marketing copy for paid capabilities, shown as upgrade cards when a feature
 * is missing from this build or not covered by the license. Copy only: the
 * implementations ship in separately licensed editions.
 */
export interface LockedFeature {
  id: string;
  label: string;
  edition: Edition;
  pitch: string;
}

const CATALOG: readonly LockedFeature[] = [
  { id: "judge", label: "LLM judge", edition: "pro", pitch: "Score runs automatically with an LLM judge, with judge spend tracked separately from production cost." },
  { id: "online-evals", label: "Online evals", edition: "pro", pitch: "Continuously evaluate live traffic per project and catch quality regressions as they happen." },
  { id: "guardrails", label: "Eval guardrails", edition: "pro", pitch: "Turn failing evals into guardrails that block bad responses at the proxy." },
  { id: "routing", label: "Model routing", edition: "pro", pitch: "Route requests by model, provider or prompt, with cost ceilings and automatic fallback models." },
  { id: "slm", label: "SLM savings", edition: "pro", pitch: "Find traffic that a smaller, cheaper model can serve and quantify the savings." },
  { id: "policies", label: "Governance policies", edition: "pro", pitch: "Block or flag requests with keyword, regex, PII, model and cost policies, plus a human review queue." },
  { id: "sso", label: "Single sign-on", edition: "enterprise", pitch: "Sign in through your identity provider with OIDC, PKCE and automatic user provisioning." },
  { id: "identity-federation", label: "Identity federation", edition: "enterprise", pitch: "Sync people from Entra ID, Okta or any SCIM 2.0 directory so delegations name real users." },
  { id: "agent-control", label: "Agent control plane", edition: "pro", pitch: "Register agents from any platform, delegate scoped authority, enforce authorization policies and require human approval for risky actions. Pro covers up to 10 governed agents." },
  { id: "mcp-gateway", label: "Governed MCP gateway", edition: "pro", pitch: "Put every agent tool call through authorization, approvals and audit before it reaches an MCP server." },
  { id: "a2a", label: "Agent-to-agent delegation", edition: "enterprise", pitch: "Let agents delegate work to each other with bounded, auditable authority." },
  { id: "attestation", label: "Signed calls to downstream servers", edition: "enterprise", pitch: "Sign every forwarded call so your own servers can reject anything that did not pass Torrix." },
  { id: "permission-graph", label: "Agent permission graph", edition: "enterprise", pitch: "See which agents can reach which systems and actions, and answer who can touch a resource." },
  { id: "resource-connectors", label: "Business record connectors", edition: "enterprise", pitch: "Look up the record behind a request, such as an order or ticket, from any REST system so policies can use real values." },
  { id: "compliance", label: "EU AI Act compliance", edition: "enterprise", pitch: "Generate EU AI Act readiness reports covering transparency, oversight and record keeping." },
  { id: "audit-export", label: "Audit export", edition: "enterprise", pitch: "Export the full audit trail for security reviews and regulators." },
  { id: "external-exports", label: "Run exports", edition: "enterprise", pitch: "Stream captured runs to your own S3 or GCS buckets on a schedule." },
];

const BY_ID = new Map(CATALOG.map((f) => [f.id, f]));

export function lockedFeature(id: string): LockedFeature | null {
  return BY_ID.get(id) ?? null;
}

export function lockedFeatures(): readonly LockedFeature[] {
  return CATALOG;
}
