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
- **Policy packs** are reviewed starting points for procurement, finance and customer-data controls.
  Install one under **Agents > Policies**; it creates ordinary editable policies: purchases at or
  above 10,000 need approval and those at or above 50,000 are denied, bank-detail changes need
  review, payments at or above 25,000 need review, vendor master changes need review, customer-data
  exports need review and bulk exports at or above 10,000 records are denied. Installs skip
  policies with the same name, so they are safe to repeat.
- **Testing a policy before you turn it on.** On **Agents > Policies**, choose **Test against
  history** while writing or editing a policy, or **Test turning off** on an existing one. Torrix
  replays your recorded requests from the last 7, 30 or 90 days and shows how many would get a
  different answer and which ones. Nothing is stored, no approval is used up, and no one is
  notified. The same check is available as `POST /api/v1/policies/simulate`. Requests are replayed
  against today's agents and delegations, so the result says how many already differ from what was
  decided at the time.
- **Observe-only mode.** Set a policy's **Mode** to observe only (or install a policy pack that way)
  and it is checked on every live request but never blocks anything. Torrix records what it would
  have decided, and the policy row shows how many requests it would have changed in the last 7
  days. **What it saw** lists the requests, and **Start enforcing** turns it on after showing you
  those numbers. Observe-only records are kept for 90 days, and the signed record of a decision notes
  when an observe-only policy matched. A good order for a new rule is: test against history, observe
  only for a few days, then enforce.
- **Approvals** are how a human signs off on a held action. They are bound to the exact request, can
  be used once, and expire.
- **The governed MCP gateway** is the main integration point. Register a downstream MCP server in
  the console, then point the agent's MCP client at the gateway URL for that server with the agent's
  Torrix credential. Tool discovery is filtered to what the agent may do, and every tool call is
  authorized before it runs. Denied calls get a clear error; held calls wait for an approval, and a
  client that can wait can ask Torrix to hold the call until a decision arrives.
  Only administrators register MCP servers. Torrix does not call private or loopback addresses by
  default, so for a server inside your network list its host in `TORRIX_LOCAL_HOST` (for example
  `mcp.internal:3000`) or set `TORRIX_ALLOW_PRIVATE_HOSTS=true`.
- **Tool-definition pinning** protects approved tools from silent changes. Pin all tools or one tool
  from **Agents > MCP servers > Tools**. Discovery compares the name, description, input schema and
  annotations with the pinned hash; a change raises a drift alert on your configured alert channels
  and the gateway holds calls to that tool until an administrator reviews and re-pins it.
- **Per-grant revocation** lists every delegation grant token with its creation time, expiry and
  status under **Grants** on a delegation. Revoking a grant denies it on the next call, and "revoke
  all" invalidates every outstanding token for that delegation.
- **Agents that do not speak MCP** can call the authorization endpoint before they act, and then
  proceed only on an allow.
- **Agent identity providers** let an agent authenticate with its existing enterprise token instead
  of a Torrix credential. An administrator registers an issuer and audience under **Agents >
  Settings > Agent identity providers** (Entra Agent ID, Okta, AgentCore or a custom OIDC issuer)
  and maps it to agents by their external identity provider and subject. Torrix verifies the token
  signature against the issuer JWKS, checks the issuer, audience and expiry, resolves the agent, and
  then runs the same delegation, policy and approval checks. The token proves who the agent is;
  authority still comes from delegations and grants.

Agents from any platform are governed the same way: Claude Code, opencode, Cursor, the OpenAI
Agents SDK, LangGraph, n8n, or something you wrote yourself. The console has pages for the registry,
delegations, policies, approvals, MCP servers, the permission graph and the activity trail.

The cap counts **active** agents. Suspending, revoking or expiring an agent frees its place, so
replacing an agent never needs an upgrade. Enterprise removes the cap.

## Action ledger and evidence bundles (Pro)

Decisions are only useful if you can prove them later. Every authorization decision, approval event
and governed gateway execution is appended to a per-account hash chain:

- `GET /api/v1/ledger` lists entries (filter by `kind`, `from`, `to`), newest first.
- `GET /api/v1/ledger/verify` checks the sequence, previous hashes and recomputed hashes, and reports
  the first broken entry.
- `GET /api/v1/ledger/export` returns the full chain as one signed document.
- `GET /api/v1/ledger/:id/bundle` returns one signed evidence bundle: the agent, principal,
  delegation, action, resource, tool, request hash, risk, policy, decision, approval and outcome.

Bundles and exports are signed with the instance gateway key (ES256) and include the signing public
key. Verify one offline with the published JWKS so the signer cannot be swapped with the bundle:

```bash
curl -fsS http://localhost:8088/.well-known/jwks.json -o jwks.json
bun run ledger:verify evidence-bundle.json --jwks jwks.json
```

The same command verifies a chain export. Administrators can read another account's chain by adding
`?user_id=`; everyone else sees their own. The ledger is stored in your database and is never sent
anywhere.

## ID-JAG and Enterprise-Managed Authorization (Pro)

Torrix can act as the resource authorization server in an Enterprise-Managed Authorization (EMA)
deployment. The enterprise IdP issues an Identity Assertion JWT Authorization Grant (ID-JAG) to the
MCP client. The client exchanges it at Torrix and calls the gateway with the short-lived Torrix
access token:

1. An administrator registers the IdP under **Agents > Settings > Agent identity providers** with
   kind **ID-JAG**, the issuer, the audience that identifies Torrix, and the agent identity provider
   used by the registered agents. The defaults read `client_id` as the agent and `sub` as the human
   principal; `agent_claim`, `principal_claim`, `principal_provider` and `token_ttl_seconds` can be
   changed through `/api/v1/agent-identity-providers`.
2. The agent and the principal must already exist, and an active **delegation** must link them. The
   ID-JAG proves who the user is; the delegation still decides what the agent may do.
3. The MCP client exchanges the assertion:

   ```bash
   curl -s http://localhost:8088/oauth/token \
     -H 'content-type: application/x-www-form-urlencoded' \
     --data-urlencode 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer' \
     --data-urlencode 'assertion=<ID-JAG>' \
     --data-urlencode 'client_id=<agent client id>'
   ```

   The RFC 8693 token-exchange form (`grant_type=urn:ietf:params:oauth:grant-type:token-exchange`,
   `subject_token`, `subject_token_type=urn:ietf:params:oauth:token-type:id-jag`) returns the same
   token with `issued_token_type`.
4. The response carries a `trxj_` bearer token, valid for five minutes by default and never longer
   than the assertion or delegation. Use it at the gateway or `/api/v1/authorize` exactly like an
   agent credential. It is bound to the end-user principal, so a caller cannot substitute another
   principal, and every action is still checked against delegations, policies, risk and approvals.
   Revoke it at `POST /oauth/revoke` with the token.

Assertions are single-use: the `jti` is recorded, so a replay is rejected.

## Enterprise extras

- **Agent-to-agent delegation**: one agent can hand a task to another, with the same subset-scope
  checks. Call `POST /a2a/message` with the calling agent's credential. The request names the action,
  the receiving agent (id or slug), the resource and the parameters:

  ```bash
  curl -X POST http://localhost:8088/a2a/message \
    -H "Authorization: Bearer trxa_..." \
    -H "Content-Type: application/json" \
    -H "x-torrix-parent-run-id: 4b2c..." \
    -H "x-torrix-session: chat-42" \
    -H "x-torrix-trace: turn-42" \
    -d '{
      "action": "readPurchaseOrder",
      "to_agent": "fulfilment-agent",
      "resourceType": "SAP",
      "resourceId": "PO-1001",
      "params": { "purchase_order": "PO-1001" }
    }'
  ```

  A successful response returns the decision, the child delegation and a run id:

  ```json
  {
    "request_id": "6f18...",
    "decision": "ALLOW",
    "reason": "policy A2A: delegator may read purchase orders allowed",
    "reason_code": "policy_allow",
    "approval_id": null,
    "delegation_id": "0d51...",
    "run_id": "a93e...",
    "chain": ["b121...", "0d51..."],
    "delegated_from": { "id": "8c02...", "slug": "procurement-agent" },
    "delegated_to": { "id": "2e77...", "slug": "fulfilment-agent" }
  }
  ```

  The receiver passes `run_id` as its own `x-torrix-parent-run-id` (or ingest `parent_run_id`) so
  its calls hang under the hop. The hop is stored as a run and appears in **Traces**, **Sessions**
  and **Flow**, and the decision appears in **Agents > Activity** with the `a2a` protocol filter.
  **Agents > Delegations** marks the child delegation with the delegating agent and an `a2a` chip.
  Policies can match `context.a2a.from_agent_slug`, and the action ledger records the same hop facts.

  A missing or invalid delegation, scope, limit or target fails before authorization with one of
  `no_delegation_for_action`, `delegation_scope_exceeds_parent`, `delegation_limits_exceed_parent`,
  `delegation_depth_exceeded`, `target_agent_not_active`, `self_delegation`, `params_too_large` or
  `credential_scope_denied`. A policy can still return `DENY` or `REQUIRE_APPROVAL`; a held call
  returns `approval_id` and its run has status 202. The example in `examples/a2a-delegation/`
  provisions two agents, a principal, a delegation and a policy, then makes the call.
- **Signed calls to downstream servers**: every request the gateway forwards can carry a short-lived
  signed token that names the agent, the tool, the exact arguments and the decision. Your downstream
  server can verify it offline against Torrix's public keys, so it can refuse anything that did not
  pass through the gateway.
- **Permission graph**: a materialized view of who can reach which tool through which chain.
- **Business record connectors**: resolve records from SAP, ServiceNow or Salesforce before an agent
  acts on them, using the customer's own OAuth2 credentials.
- **Directory sync**: bring people and service identities in from Entra ID, Okta or any SCIM 2.0
  directory. Sync follows Entra `@odata.nextLink`, Okta `Link` and SCIM `startIndex` paging, marks
  users missing from a complete walk as disabled and reactivates them when they return. `max_pages`
  bounds a run; a truncated walk never disables anyone.
- **Single sign-on**: sign in to the console with your own OIDC provider, with optional automatic
  user provisioning. Configure it with environment variables or under **Settings > SSO**.
- **Compliance and audit**: the EU AI Act readiness report, downloadable as Markdown or CSV, and the
  audit log export.
- **Scheduled exports**: ship new runs as NDJSON to your own S3 or GCS bucket on a schedule, with
  identity fields removed.
- **SIEM export**: send authorization decisions, approvals, gateway executions and audit events to
  Splunk HTTP Event Collector or Microsoft Sentinel. Records follow the OCSF Authorization and API
  Activity shapes, with Torrix fields under `unmapped.torrix`. Configure it under **Governance > SIEM
  export**; only administrators can add destinations. Delivery runs every minute, retries failures
  with backoff, and keeps credentials encrypted with the instance key. Use a HEC token for Splunk, or
  a bearer token or Entra client credentials for Sentinel. Endpoints go through the outbound guard,
  so metadata and private addresses are refused unless the instance allows them.

## Trying, upgrading and asking

- The upgrade itself is two steps, described in
  [Editions and licensing](editions-and-licensing.md#upgrading-from-community): run the paid image on
  the same data volume, then add your license key. Your Community data, users and keys stay in
  place.
- If a license expires, Torrix returns to Community and your data stays where it is.
- For a trial or a question, open a discussion on GitHub or contact the Torrix team.
