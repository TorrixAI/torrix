# Pro and Enterprise features

Community covers observing: recording, storing and reporting on what your apps and agents did. Pro
and Enterprise add control: deciding what an agent may do before it happens, and the reports that
prove it. This page is a guide to those features: what each one does, where it lives in the console,
and how to set it up. For what each edition includes and how licensing works, see
[Editions and licensing](editions-and-licensing.md). Features you do not have yet show up in the
console with a **Pro** or **Ent** badge and a short description, so you can see what an upgrade
adds.

## LLM judge and evaluations (Pro)

The judge is any OpenAI-compatible model you point Torrix at. It grades things:

- **Run judging.** Open a run and use the judge panel, or select runs on the Runs page and choose
  **Judge selected**. The score and a short rationale are stored on the run.
- **Dataset scoring.** Offline evals score captured runs against golden answers by exact match or
  containment first; the judge is used when those are inconclusive. CSV and JSON import are built
  in.
- **Online evaluations.** Per project, choose to judge every new run or a sample of them. Results
  are stored next to the run.
- **Guardrails.** Turn an evaluation into a guardrail: when a run fails the criteria, later calls in
  that session are refused before they reach the provider, and the refusal is recorded.

Set the endpoint, key and model under **Settings > Judge**. The key is stored encrypted on your
server. Judge spend is tracked separately from your application spend and appears on the cost
pages.

## Model routing and savings (Pro)

Routing rules decide which model actually serves a request, and what to do when that fails:

- Match on model (exact, prefix or regular expression), optionally on provider, or on the prompt
  text (contains or regular expression).
- Rewrite the request to another model, or to a cheaper endpoint entirely.
- Name a **fallback model**: if the routed call returns 404, 429 or a server error, or the
  connection fails, Torrix retries once against the fallback.
- Optionally cap the routed target's cost so an expensive match falls back to the cheapest option.

Routed runs record the model you asked for and the one that served it, and responses carry an
`x-torrix-routed-from` header. The same page lists **SLM signals**: clusters of similar prompts that
would be much cheaper on a smaller model, which also feed the Insights savings panel.

## Policy engine and review queue (Pro)

Policies inspect requests before they leave and responses before they are stored:

- Match on keywords, regular expressions, PII, model, a list of allowed models, token counts or a
  cost threshold.
- **Block** stops the call with a clear 451 error, records an auditable run and can queue it for
  human review.
- **Flag** marks the run, stamps it with the policy name and can queue it for review.

Review items are worked in the review queue on the Governance page: approve or reject with a note,
and the run records the outcome. PII masking itself is available in every edition.

## Agent control plane (Pro: up to 10 governed agents, Enterprise: unlimited)

Observing shows what agents did. The control plane decides what they may do first, and keeps a
record of every decision.

- **Principals** are the sources of authority: a person, a service, an application or an external
  system.
- **Agents** get an identity and a credential of their own. **Delegations** grant an agent a subset
  of a principal's authority: which actions, on which resources, with amount or daily limits, and
  until when. Delegation chains are checked for subset scope and non-increasing limits.
- **Policies** describe what is allowed, denied or needs approval, and they are versioned so you can
  see what changed. **Risk scoring** rates each action; the settings decide what a high or critical
  rating does.
- **Approvals** are how a human signs off on a held action. They are bound to the exact request, can
  be used once, and expire.
- **The governed MCP gateway** is the main integration point. Register a downstream MCP server in
  the console, then point the agent's MCP client at the gateway URL for that server with the agent's
  Torrix credential. Tool discovery is filtered to what the agent may do, and every tool call is
  authorized before it runs. Denied calls get a clear error; held calls wait for an approval, and a
  client that can wait can ask Torrix to hold the call until a decision arrives.
- **Agents that do not speak MCP** can call the authorization endpoint before they act, and then
  proceed only on an allow.

Agents from any platform are governed the same way: Claude Code, opencode, Cursor, the OpenAI
Agents SDK, LangGraph, n8n, or something you wrote yourself. The console has pages for the registry,
delegations, policies, approvals, MCP servers, the permission graph and the activity trail.

The cap counts **active** agents. Suspending, revoking or expiring an agent frees its place, so
replacing an agent never needs an upgrade. Enterprise removes the cap.

## Enterprise extras

- **Agent-to-agent delegation**: one agent can hand a task to another, with the same subset-scope
  checks.
- **Signed calls to downstream servers**: every request the gateway forwards can carry a short-lived
  signed token that names the agent, the tool, the exact arguments and the decision. Your downstream
  server can verify it offline against Torrix's public keys, so it can refuse anything that did not
  pass through the gateway.
- **Permission graph**: a materialized view of who can reach which tool through which chain.
- **Business record connectors**: resolve records from SAP, ServiceNow or Salesforce before an agent
  acts on them, using the customer's own OAuth2 credentials.
- **Directory sync**: bring people and service identities in from Entra ID, Okta or any SCIM 2.0
  directory.
- **Single sign-on**: sign in to the console with your own OIDC provider, with optional automatic
  user provisioning. Configure it with environment variables or under **Settings > SSO**.
- **Compliance and audit**: the EU AI Act readiness report, downloadable as Markdown or CSV, and the
  audit log export.
- **Scheduled exports**: ship new runs as NDJSON to your own S3 or GCS bucket on a schedule, with
  identity fields removed.

## Trying, upgrading and asking

- The upgrade itself is two steps, described in
  [Editions and licensing](editions-and-licensing.md#upgrading-from-community): run the paid image on
  the same data volume, then add your license key. Your Community data, users and keys stay in
  place.
- If a license expires, Torrix returns to Community and your data stays where it is.
- For a trial or a question, open a discussion on GitHub or contact the Torrix team.
