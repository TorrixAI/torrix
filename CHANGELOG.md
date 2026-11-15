# Changelog

What changed in each release, and what to do when you upgrade. Release notes with the same
information are on the [releases page](https://github.com/TorrixAI/torrix/releases).

## 1.5.0 (2026-11-15)

The console release. The browser UI is now a separate single-page app with its own design system,
and the Community edition gains trace judging, spend limits, key rotation and session keys.

- Runs and Traces search keep focus while results load: typing one character at a time no longer drops every character after the first, and the previous rows stay visible until the new response arrives. The agent activity, permission graph and audit-log filters now debounce typing and keep their inputs mounted as well.
- **Spend limits** are now part of containment. An administrator can set a daily or monthly limit for an agent or a project; once recorded run cost reaches the limit, governed calls are refused with `spend_limit_reached` before identity or policy and the refusal is written to the action ledger. The Containment panel shows each limit, the spend in the current window and whether it is paused, and the window resets by itself at the next day or month.
- Governed action parameters are now PII-masked at the source before they are stored, and simulation plus shadow previews mask historical rows as well. Shadow mode and "What it saw" can no longer surface raw emails, cards or credentials from authorization history.
- API keys can now be **rotated**: a replacement with the same name, scope, permissions, projects and limits is created, the old secret stops working immediately, and the new secret is shown once. **Delete** replaces the old Revoke wording with clear 401/audit copy; the active browser key is managed by signing out. Secrets remain hashed and are never revealed.
- Browser sign-in keys are now first-class **session keys**: migration 0027 adds the flag and backfills existing `Session key %` rows, the Keys table marks them with a **session** chip, signing out revokes the current session key, and session keys idle for 30 days are retired at the next sign-in. Manually created and default keys are never touched.
- Density now lives in a **Quick settings** menu in the topbar (the separate density dropdown is gone) and the Ctrl/Cmd+K palette has **Density: Comfortable / Compact** actions. Both change tables and the trace rail immediately, persist in localStorage, announce the current value (checked menu item, "current" in the palette), and keep a 36px control at narrow widths.
- API keys now show month-to-date spend against their hard cap in the Keys table and the Cost usage table. The bar carries the volume; **80%** and **100%** are labelled with an icon and text ("Near cap", "Cap reached") so colour is never the only signal. Uncapped keys say "no cap" with no bar, and both surfaces read the same spend the 429 gate enforces.
- The dashboard is easier to read: spend is a single-axis daily bar chart with the previous window dashed (and a **vs previous** toggle), while runs and errors get their own daily bar charts instead of sharing a dual axis with spend. Short day labels, money/count tooltips, a caption naming the peak spend day and anomaly days, and a click-through from any day to the matching Runs filter. Empty windows show an explicit state instead of blank axes.
- Trace filters are production-hardened: sessions and traces page independently instead of stopping at 50 groups, the step tool filter matches every tool a run used (not just the first), text filters wait for typing to settle before querying, run-id search has an exact-match branch, and agent/provider/status/end-user filters gain indexes. Dimmed step rows now announce that they do not match the step filter.
- Traces & Sessions now filters on status, agent, model, source and a date range beside search, all in the URL with removable chips and an honest "N of M groups" count. Trace detail adds a step filter (agent, model, tool, step kind, failures only) that dims non-matching rows while keeping the lane rail, spawn edges, fold state and keyboard navigation intact; the count reads "N of M steps", and the filter survives Tree | Flow. The rail now draws the legend's shapes — model circles, tool squares and decision diamonds — with the spawn toggle offset beside the node so it no longer covers them.
- Runs search now matches the run id itself, so a run or message id (`msg_…`) pasted from a URL or a log finds its run. Tool events whose arguments exceed the 4,000-character event cap still show their tool name and first argument instead of collapsing to a generic "tool call".
- Changing a Runs filter or the search term now returns to the first page of grouped results. A later group page used to stay selected, so a search could say "12 runs matched" while showing an empty table; **Clear all** resets the group page too, and an out-of-range group page link opens the last page.
- Runs now has a filter panel beside search, status and agent: model, provider, source, date range, tag, score, golden, anomaly and end user. Every filter lives in the URL, active filters appear as removable chips with **Clear all**, the result count follows the filters, bulk select and export use the same query, and an empty result names the filters and offers the reset.
- The Playground now remembers the connection per provider. Base URL, API key and model are saved as you type and restored when you switch back, the provider used last time is reopened on reload, and a provider with no model list no longer keeps the previous provider's model in the box. Keys written by the older build are still picked up. Signing out clears every playground record, so a shared browser profile does not keep the previous user's provider key or transcript.
- The Playground works end to end again. Anthropic streams now render: the client read a wrapped `content_block_delta` and expected a `text` delta, while Anthropic sends `delta: { type: "text_delta" }`; the server-side stream extractor had the same shape bug, so streamed Claude runs also stored no response text, tokens or stop reason. OpenAI reasoning models (`gpt-5`, `o1`/`o3`/`o4`) now receive `max_completion_tokens` without a custom temperature instead of a rejected `max_tokens`, Gemini streams through `:streamGenerateContent?alt=sse` and parses candidates, and the Playground has a Stream toggle for the non-streaming path. Non-JSON provider errors show their real status and body instead of "request rejected". Tests cover each stream shape, body builder and the full proxy round trip.
- Insights KPI values are fluid: the value scales with the card (up to 28px) instead of a fixed 28px, so long amounts and the `/mo` suffix no longer clip at the 7→4→2-column breakpoints; values stay tabular, subtitles ellipsize with the full text in `title`, and boxes keep one height.
- Trace and session Tree views now read as a commit-graph rail: one fixed-height row per run, agent lanes with stable categorical colours, model circles, tool squares, governed-decision diamonds, failure rings, spawn and return connectors, subagent collapse with a steps/cost/span/errors summary, and Jump to first failure. Rows are virtualised, so a 1,000-run trace renders 24 rows in the DOM and scrolls at 60fps. The tree is a keyboard treeitem list, collapses to indentation below 700px, and keeps a Simple list option. Trace pages now request authorization annotations so held, allowed and denied decisions appear as rows with the decision strip and evidence chip. Flow remains the time view, and Tree | Flow plus the tree mode persist. Agent colours now also mark Runs agent chips. Tests: lane assignment, collapse, first failure, a real-browser rail, a 1,000-run performance trace and expanded uiAudit rail checks.
- The dashboard now shows **Governed coverage**: the percentage of observed agents that match a registered agent, the uncovered agents with their runs and cost, and registered agents with no traffic. The figure is free for every edition and links the gap to the Pro registry.
- Other gateways can now use Torrix as their decision point. `POST /api/v1/authorize/external` accepts an account API key and a governed agent id, runs the same delegation, policy, risk, approval and ledger path as the agent endpoint, and returns the decision, decision id and signed ledger entry. Envoy, Kong, OPA-style callers and in-house gateways do not need the Torrix SDK or an agent credential. Read-only keys are refused, and the agent must belong to the caller's account.
- Evidence packs and ledger anchors are available to Enterprise. **Compliance > Evidence pack and anchors** can sign the current ledger head, optionally send it to an outside HTTP witness, and list the anchors. **Download evidence pack** produces one signed JSON file with the agent inventory, delegations, policy versions, decision totals, approval oversight and canary results, containment drills, the signed ledger export and the anchors, mapped to EU AI Act Articles 12 and 14, the NIST AI RMF, ISO 42001 and the NAIC language. Administrators can mint read-only `trxv_` auditor tokens that reach only the evidence routes. `bun run anchor:verify <anchor.json>` verifies an anchor receipt offline, optionally against the published JWKS and a ledger export.
- Agents now have a kill switch: freeze every agent, one agent or one tool from **Agents > Settings > Containment**, with a reason. Frozen calls return `agents_frozen` or `tool_frozen`, and the freeze and unfreeze are written to the action ledger. A per-agent decisions-per-minute limit and automatic quarantine after a configured number of denials are available. **Run freeze drill** freezes one agent, checks that the engine refuses a call, restores the agent and records the result, so the switch can be tested before an incident.
- Claude Code and opencode can now enforce tool calls through Torrix. The Claude Code plugin adds a `PreToolUse` hook and the opencode plugin adds an `execute.before` hook, both calling `/api/v1/authorize` with a governed agent credential. Enforcement is off by default, can run in observe mode, and has an explicit fail-open or fail-closed switch when Torrix is unreachable. Denied tools are blocked; held tools ask the person at the keyboard (Claude Code) or fail the tool call with the approval reason (opencode). The plugin README and `docs/pro-and-enterprise.md` describe the settings.
- Approvals now carry an oversight panel with approval and rejection rates, median and p95 time to decide, fast approvals, a rubber-stamp flag, per-tool and per-risk counts, and canary catch rates. Administrators can inject a known-bad canary request; rejecting it records a catch and approving it records a miss. Enterprise admins can sign the report into the action ledger, so the canary result and the metrics become verifiable evidence. The panel is aggregate by default and per-reviewer figures are an administrator-only opt-in. New setting: **Auto-approve below risk** (default `low`, which changes nothing). New APIs: `GET /api/v1/oversight/metrics`, `GET /api/v1/oversight/report`, `POST /api/v1/oversight/report/sign`, `POST /api/v1/oversight/canary`.
- Policy suggestions draft a least-privilege delegation and a starter policy set from the last 7, 30 or 90 days of an agent's governed decisions and observed tool calls. **Suggest from observed behavior** on **Agents > Authorization policies** shows the actions, resources, amount range and working hours it saw, lists denied and ungoverned outliers, and explains every line. Suggested policies are created in observe-only mode and can be replayed against history before anyone enforces them. Nothing is written by the suggestion itself. New API: `POST /api/v1/policies/suggest`.
- Runs bulk selection now caps at 500 runs, selects only the visible page and offers **Select all matching** for filtered runs and trace groups. Bulk errors are translated to plain language, and filtered deletion asks for a typed count confirmation.
- Trace-level judging is now the default when Runs is grouped by trace. One judge call covers the trace prompt, final answer, ordered step digest, failing steps and totals; results are stored in `trace_judgments` and applied to the outcome run. Trace groups show Good/Bad with the reason and a first failing step link. Trace and session pages show the same score chips.
- Judge selected now creates a queued job (maximum 200 traces, or 500 runs in ungrouped mode) with an estimate, progress, Stop, skip-already-judged behaviour for traces, retry with backoff, per-item errors and a good/bad/failed finish summary. A new `trace_judgments` migration in both dialects stores trace scores and judge costs separately.
- Primary and meta table cells now clip inside their own columns at every width; the Runs step label is shortened to 60 characters with the full text in the title. The expanded uiAudit checks cell overflow on Runs, Traces and the trace tree at 1024, 1280, 1440 and 1920.
- `/ui/console.css` is content-addressed. The server hashes `STYLE` at startup and injects `/ui/console.<hash>.css` into the SPA HTML (including the login page). The hashed URL is cached for a year with `immutable`; the unversioned `/ui/console.css` still answers, with `no-cache`, for old links. A stale stylesheet can no longer pair with a new hashed SPA bundle.
- Console component CSS is consolidated around one final definition for the topbar, density, avatar, theme toggle, tabs and project select. A server test now fails if a shared component selector gains a second top-level definition, and the stylesheet tests cover the cache headers and the changing build URL.
- The density control becomes icon-only below 1100px with a title and accessible name. Agents, Governance, Settings and Login use the same underlined tab language: labels start at the content edge, 40px high, 13px, with a 2px ink underline under the active label only. Risk chips use the alert icon; the cross stays reserved for denied and failed states. The approvals status filter shows counts in a neutral segmented control.
- `uiAudit` now checks topbar control bounding boxes at 1024, 1280, 1440 and 1920, in addition to page overflow, tab alignment, field width, money, dates and table fit. Topbar before/after captures live in `ui-preview/console-style/v4d/topbar/`.
- Console polish pass: the Spend hero stats have 24px gutters, page breadcrumbs are removed in favour of the sidebar and titles, and the scrollbar gutter is reserved so header action edges match on every route. Sidebar group chevrons are rotating icons, every nav item has a unique icon, and the account menu uses an ink initials avatar.
- Controls now share one boxed 36px style with a 6px radius: search, project select, inputs and buttons. Tabs are ink text with a 2px underline that spans the label only; tab labels start at the content edge. Segment controls always use a neutral surface-2 selected state, including the time range. Each page has at most one lime primary button.
- The Runs page has one toolbar: search, status and agent filters, a Group dropdown, sortable column headers, one Export menu and Columns, plus a quiet Refresh/Auto pair. The old summary chips are merged into the KPI strip, empty tiles are hidden, group headers are sans with only the id in mono, and the first data row sits above y=500 at 1440x900.
- Tables now use content-aware widths and full-width header rules. Approvals uses one decision shape (status, risk on the same line, two-line reason), the queue card no longer carries a stray timeline rule, and Approvals, Agents, Activity, Traces, Analytics, MCP and Governance tables fit at 1024, 1280, 1440 and 1920 by hiding low-priority columns.
- One formatter set now covers money, counts, percentages, durations and dates. Money uses two decimals at or above $1 and four below with thousands separators; dates use "3 Oct 2026" and "3 Oct 2026, 14:02"; ISO is reserved for exports. `deltaTone(metric, direction)` gives spend, errors, latency and runs one meaning-based delta policy.
- Form fields share one pattern: 12px/500 labels, 36px controls, ink-3 helpers, red errors with an icon, 480px maximum width (320px for numbers) and two-column related fields at 1440. Cost and alerts uses the shared KPI strip, Settings has a sticky section nav and a database-switch confirmation, Compliance cards share a height with PII detector chips, and Insights renders highlights with severity dots.
- Empty values are muted with a next step, loading tables and charts use skeletons, and errors share one retry panel. The design seed gives the Procurement Agent its purpose and owner so registry rows stay realistic.
- Login now leads with "The system of record for AI agents", describes observing and controlling agents, and shows the real build version from the health endpoint. The decorative chart is replaced by a quiet alpine ridge line.
- The Agents sidebar group is one item that opens Registry; the in-page tab bar owns the control-plane pages. The Approvals table gives Decision and expiry the width they need and wraps full reasons. Governance uses the same KPI strip as Agents.
- Trace Flow now uses 10px minimum bars, parent-child connectors, direct lane labels and a hover tooltip, with no duplicate legend. Run detail uses quiet trace and session links, an overflow menu for Delete with confirmation, readable tool payloads, and an evidence chip beside the title for ledger-backed runs.
- The design seed now uses current Claude, GPT and Gemini families, varied activity times, realistic approval reasons and expiry hours, correct agent capitalization, one ledger entry tied to the shared run detail, and fixed MCP tool-pin drift.
- The console is now Alpine Ledger: a paper light edition, a cool slate ink dark
  edition, Geist and Geist Mono type, ink-alpha hairlines, and one glacial lime
  signature. Lime is used only for the primary button, selected navigation
  marker, focus ring, verified evidence tick and chart hero series. Links and
  table first columns use ink, and chart labels use the darker accent text token.
- Dark mode uses cool-tinted neutrals rather than gray inversion. The six-color
  categorical palette is used for charts, agent lanes and Flow, while allowed,
  pending, denied and info keep separate semantic tones with an icon and label.
- Evidence is now first-class. Authorization decisions and approvals carry a
  compact evidence chip with a short hash, a lime verified tick and a link to the
  signed ledger export. Allowed, held and denied use one decision strip in
  tables and detail views. Trace trees, Flow and approval history use a record
  timeline ruler.
- Page anatomy is consistent: breadcrumb, 28px title, one description sentence,
  right-aligned actions, filter row and content. Tabs are underlined rather than
  pill buttons. The sidebar groups collapse and remember their state, the nav no
  longer scrolls inside the viewport at 1440x900, density moved to a quiet icon
  menu, and search is one field with a Ctrl K hint.
- The KPI row no longer uses solid color blocks or unit chips. Each figure has a
  real sparkline with a hairline baseline and a last-point dot, or no sparkline
  when there is no series. The hero spend card is the only accent card; the
  others are ink. Charts use flat fills, 6% gridlines and a single hero series.
- Trace Turn summary now shows the first human prompt, skips tool results,
  pasted files and JSON blobs, and clamps the prompt and answer to six lines with
  Show more. The hierarchy table shows tool arguments or an answer excerpt on
  the second line, and run status is an accessible icon and label.
- Text has an 11px floor. Geist Mono is reserved for identifiers, hashes, tree
  guides and code; metrics, timestamps, labels and money use Geist with tabular
  figures. Runs, approvals, activity and agent tables use 13px cells, 44px
  comfortable or 32px compact rows, and no primary table clips at 1280, 1440 or
  1920. Approval actions and evidence chips fit inside their columns. The Runs
  table has a remembered Columns menu, and its time, token, cost, latency and
  score headers sort with a visible arrow.
- Run detail and shared runs show tool calls as a readable label and keep the raw
  payload behind a disclosure. The shared run metadata uses a four-column grid
  with no empty cell, and the shared view never prints a raw tool JSON blob as
  its primary text.
- New instances now mask credential shapes by default: API keys, GitHub and OAuth tokens, AWS
  access keys and secrets, Google API keys, private-key blocks, JWTs and bearer tokens. Email,
  phone and other personal-data types stay off until an admin selects them. Existing instances
  keep their current masking setting. The upgrade copies the old defaults to existing users before
  the new default takes effect.
- Traces and runs now label each step by what the tool call did, such as
  `Edit packages/server/src/lib/x.ts` or `Bash bun test`, instead of repeating the prompt. Runs
  with no tool call show `Answer` or `Thinking`, and the Tools column names the first tool.
- The Runs page opens grouped by trace when most matched runs belong to multi-run traces. The
  choice is remembered per browser.
- Run detail leads with a readable Conversation panel, then Reasoning and Tool calls. Raw request
  and response JSON are collapsed at the bottom, and the metadata grid only shows fields that are
  set. Windows paths and line breaks render correctly, and provider envelopes with no text fall
  back to reasoning, tool calls or `No text answer captured`.
- Wide tables now keep their first column sticky, show a visible scrollbar and a clipped-edge cue,
  and hide low-priority columns below 1500 px. Runs, traces, the trace and session trees, activity,
  agents, delegations and cost use it.
- Durations use one format from milliseconds to days, such as `412ms`, `4.3s`, `15m 04s` or
  `2h 15m`. Trace and session headers show whole-group totals, and a separate `this page` label
  names the page-scoped count.
- PII masking now recognizes GitHub fine-grained and OAuth tokens, AWS access key ids and secret
  keys, Google API keys, private-key blocks, JWTs and `Authorization: Bearer` tokens. When masking
  is off and one of those shapes was stored in the last seven days, Runs and Governance show a
  dismissible warning with the number of affected runs and never the value.
- The sidebar now groups Observability, Build, Agents, Governance, Workspace and System. Agents
  expands to Registry, Observed, Delegations, Authorization policies, Approvals, Activity, MCP
  servers and Who can do what. Governance > Content rules is the former Policy engine; the
  authorization page keeps its name, and Who can do what keeps the `/ui/agents/graph` route.
- Governance opens with a seven-day overview strip, and the agent registry adds Last active,
  Actions 7d, Denied 7d and Pending approvals while hiding empty Source and Model columns.
- Cost hides unused API keys behind **Show unused keys**, moves prompt compression into **Project
  settings**, and shows two decimals at or above $1 and four below. Sign-in reuses the browser's
  existing session key. The dashboard labels each chart series axis, and the Runs mean-score tile
  waits for ten scored runs.
- Added a 4,000-run browser performance check for Datasets, Insights, Prompts and Observed agents.
  The reported 15-second delay did not reproduce; each page loaded in under 100 ms on the fixture.
- The proxy no longer forwards Torrix's own session cookie upstream. The console authenticates `/proxy` with a `torrix_auth` cookie that holds the API key itself, so browser-originated calls were handing that key to whichever provider they targeted. `cookie`, `set-cookie`, `x-target-url` and every `x-upstream-*` header are now stripped before forwarding; provider credentials supplied through `x-upstream-authorization`, `x-api-key` and `x-goog-api-key` still travel as before.

**When you upgrade**

- There are database migrations (0022 to 0027). They run automatically when the server starts, on
  both SQLite and Postgres. Back up your database first, as you would for any release.
- Stored credentials stay readable; migration 0022 only changes the masking default for new rows.
- If you build the image yourself, the Dockerfile now has a `web-build` stage that compiles
  `packages/web`. The published images already do this for you.
- Console assets are content addressed, so a hard refresh clears a stale stylesheet. No API is
  removed.

## 1.4.0 (2026-10-25)

The agent hand-off release. Agent-to-agent hops now become traceable runs, and the console shows
who handed authority to whom. MCP gateway runs also mask personal data before storage.

- Enterprise: agent-to-agent hand-offs are visible and traceable. Each `/a2a/message` hop
  creates a masked run under the calling agent, with a returned `run_id` so the receiving agent can
  parent its own work to it. Pass `x-torrix-parent-run-id`, `x-torrix-session` and `x-torrix-trace`
  (or the body fields) to join an existing trace. Authorization activity gains a protocol chip and
  filter, decision details show an Agent hand-off panel, and the delegation chain names each agent
  correctly. The Delegations page marks A2A hops and shows the delegating agent. Policies can match
  `context.a2a.from_agent_slug`, and the action ledger records the same hop facts. The Pro and
  Enterprise guide now shows a request and response, the error codes, and where to see hops, and
  `examples/a2a-delegation/` provisions the whole flow against a local server.
- MCP gateway runs now mask personal data in tool arguments and response text before saving the run
  and its events, matching the proxy and ingest paths. The run records whether masking was applied.

Upgrade: there is no database migration. Swap the image or binary as usual. The A2A additions
require the Enterprise build and an Enterprise license.

## 1.3.0 (2026-10-25)

The evidence and operations release. The MCP transport moves to the 2026-07-28 revision, the paid
image is compiled, licenses gain serials and an opt-in revocation path, stored credentials can be
rotated, and every Community release now ships platform binaries.

- Pro: observe-only policies. Give a policy the mode **observe only** (in the policy form, with
  **Observe only** on a row, or by installing a policy pack that way) and it is checked on live traffic
  but never blocks. Torrix records what it would have decided; each row shows how many requests it
  would have changed in the last 7 days, **What it saw** lists them, and **Start enforcing** turns the
  policy on after showing those numbers. The API is `enforcement` on policies and policy-pack installs
  (`enforce` or `shadow`) plus `GET /api/v1/policies/:id/shadow`. Observe-only records are deleted after
  90 days. Existing policies keep enforcing.
- Pro: test a policy before you turn it on. Under **Agents > Policies**, **Test against history**
  (in the policy form) and **Test turning off** (on each policy) replay the requests Torrix recorded in
  the last 7, 30 or 90 days and show how many would get a different answer, with examples. Nothing is
  stored, no approval is used up and no one is notified. It is also available as
  `POST /api/v1/policies/simulate`.
- Security: when you test or sync an MCP server, an error from that server is now reduced to a short
  label such as `upstream_status_500` or `upstream_jsonrpc_error_-32000`. Before, a failing server's
  response could be copied into the console, the stored last error and the audit log. Nothing
  changes for servers that work.
- The settings for single sign-on (`TORRIX_OIDC_*`), the embeddings endpoint (`TORRIX_EMBEDDINGS_*`)
  and the signed-call issuer (`TORRIX_ATTESTATION_ISSUER`) are now in the configuration guide and the
  Docker Hub overview. The overview's tag list now names the current release.
- Pro: admins can list and rotate the signing key used for evidence bundles. It used to need
  Enterprise even though Pro signs bundles with the same key. Signing calls to your own servers stays
  an Enterprise feature.
- The version reported by the TypeScript and Java SDKs and by Torrix's own MCP client now follows the
  release version.
- Stored credentials can be rotated to a new `TORRIX_SECRET_KEY`. Set `TORRIX_SECRET_KEY_PREVIOUS` to
  the old key, restart, and the sweep re-encrypts MCP server credentials, OAuth tokens, the judge key
  and the gateway signing key onto the new key; values saved before a key existed are encrypted by the
  same sweep. Admins on the paid image can trigger it with `POST /api/v1/secrets/rotate`, which reports
  `checked`, `rotated` and `unreadable` counts. A value neither key can read is left in place, never
  dropped.
- Every Community release now attaches `torrix-linux-x64`, `torrix-linux-arm64`,
  `torrix-darwin-x64`, `torrix-darwin-arm64`, `torrix-windows-x64.exe` and `SHA256SUMS`, so
  `deploy/install.sh` works from a clean machine. Build them with `bun run compile` (host) or
  `bun run compile:all` (every platform).
- The paid image now compiles the server and the enterprise extension into one binary during the
  build (`bun build --compile`), so the image no longer ships readable TypeScript. Migrations, assets
  and routes are embedded, as in the standalone binaries.
- Licenses carry a stable `serial` and `customer` marker (the Studio ledger and `GET /api/license`
  show them). A new opt-in `TORRIX_LICENSE_REVOCATIONS` setting points at a signed revocation list
  (URL or file); listed serials return the instance to Community with the reason shown in the
  console, and the list is cached so offline restarts keep applying it. Issue one with
  `sign-license.ts --revoke <serial>,<serial>`.
- Governed-agent creation, import and reactivation check the edition cap inside one transaction, so
  simultaneous requests cannot exceed it.
- The MCP server and the governed MCP gateway speak the 2026-07-28 stateless transport as well as
  the 2025-06-18 session transport. Modern clients send `Mcp-Protocol-Version`, `Mcp-Method` and
  `Mcp-Name` per request with no initialize handshake; legacy clients keep sessions and SSE. The MCP
  proxy forwards those transport headers to the downstream server.
- Directory sync follows Entra `@odata.nextLink`, Okta `Link` and SCIM `startIndex` paging and
  deactivates principals that are missing from a complete walk (reactivating them when they return).
  `max_pages` bounds a run; a truncated walk never disables missing users. Directory-disabled users
  are skipped on creation and marked disabled when seen.
- MCP tool definitions can be pinned per server. Discovery compares name, description, input schema and
  annotations against the pinned hash; a change raises a drift alert on the configured alert channels
  and the gateway holds calls to that tool until an administrator re-pins it.
- Delegation grants now carry a JTI and are recorded when issued. The new Grants panel lists creation,
  expiry and status, revokes one token immediately, and can revoke every outstanding token for a
  delegation.
- SIEM export sends authorization decisions, approvals, gateway executions and audit events to\n  Splunk HEC or Microsoft Sentinel as OCSF-shaped records (`class_uid` 3003 or 6003). Administrators\n  configure destinations under Governance > SIEM export; delivery runs every minute with retry and\n  backoff, credentials are encrypted, and endpoints go through the outbound guard. The outbox keeps\n  local evidence if a destination is down.\n- Authorization policy packs are available under Agents > Policies: procurement thresholds (review at\n  10,000, deny at 50,000, review bank-detail changes), finance controls (review payments at 25,000\n  and vendor master changes) and customer-data controls (review exports and external sharing, deny\n  bulk exports at 10,000 records). Installing a pack creates ordinary editable, versioned policies,\n  skips policies with the same name, and leaves the default posture unchanged.\n- A tamper-evident action ledger now hash-chains every authorization decision, approval event and
  governed gateway execution per account. The API lists and verifies the chain, exports it as one
  signed document, and returns a signed evidence bundle per action. Bundles are ES256-signed with
  the instance gateway key and can be verified offline with `bun run ledger:verify <file> --jwks
  <published JWKS>`. A tampered or missing entry fails verification at its sequence number.
- Torrix now accepts ID-JAG (Identity Assertion JWT Authorization Grant) exchanges for\n  Enterprise-Managed Authorization. Register the IdP under Agents > Settings, then `POST /oauth/token`\n  with the jwt-bearer or token-exchange grant returns a short-lived `trxj_` access token bound to\n  the end-user principal and the MCP client's agent. Assertions are single-use, tokens expire within\n  five minutes by default and never outlive the delegation, `POST /oauth/revoke` revokes one, and\n  every call still goes through delegations, policies and approvals.\n- Agents can authenticate with Entra Agent ID, Okta or AgentCore access tokens. Administrators
  register an issuer and audience under Agents > Settings > Agent identity providers; Torrix verifies
  the token against the issuer JWKS, checks issuer, audience and expiry, resolves the agent by its
  external identity provider and subject, then applies the same delegations, policies and approvals.
  A Torrix `trxa_` credential keeps working, and grants remain the authority binding.
- Helicone `Helicone-Property-<key>` headers now become run tags, and a new
  [migration guide](docs/migrating-from-helicone-langfuse.md) covers Helicone and Langfuse, including
  OpenTelemetry and the headers Torrix understands. Torrix headers still win when both are present.
- Adding a Pro or Enterprise license to the Community build now says so plainly. Settings, License
  shows that the license is active but the paid features are not in this build, and the Agents and
  Governance pages stop asking you to activate a license and point to the paid image instead.
  `GET /api/license` and the activation response carry `paid_build` and a `notice`.
- Running Torrix from a source checkout now always opens the same default database
  (`packages/server/torrix.sqlite`), whichever folder or entry point starts it. Before, starting from
  another folder silently created a new empty database. An explicit `DB_PATH`, Docker, the install
  script and compiled binaries behave as before.
- PII masking now also covers the run name when it is derived from the prompt, and failed proxy
  calls (connect errors) are masked like every other path. Turning masking on without selecting a
  type now masks every type instead of silently storing everything.
- The outbound check now covers the rest of the server's user-configured calls: cost-alert webhooks
  and PagerDuty, the online-eval endpoint, the S3 and GCS exporter, OIDC discovery, token and key
  fetches, and the embeddings endpoint. It also connects to the address it resolved, so DNS
  rebinding cannot swap it between the check and the request. A lint-style test (`outboundLint`)
  fails on any new bare fetch of a user-supplied address.

**When you upgrade**

- If one of those endpoints lives inside your network (a MinIO or S3-compatible store, a Keycloak
  or Dex issuer, an internal mail gateway, a self-hosted embeddings server), list its host in
  `TORRIX_LOCAL_HOST` or set `TORRIX_ALLOW_PRIVATE_HOSTS=true`, the same switch MCP servers use.
- The paid image is now one compiled binary and ships no TypeScript. Use the same data volume and
  license key; nothing is migrated by hand.
- To rotate `TORRIX_SECRET_KEY`, set `TORRIX_SECRET_KEY_PREVIOUS` to the old value, set the new key,
  restart, and wait for the `secrets: checked ...` log line before removing the old variable. On the
  paid image an admin can run `POST /api/v1/secrets/rotate` instead of waiting.
- License revocation is opt-in. Leave `TORRIX_LICENSE_REVOCATIONS` unset and nothing changes; set it
  to a signed list only if you want the server to enforce one.
- A source checkout now always uses `packages/server/torrix.sqlite` for the default database. If you
  previously started Torrix from another folder and relied on that working-folder database, set
  `DB_PATH` to the old file.
- Linux, macOS and Windows binaries are attached to the release (`torrix-<os>-<arch>` plus
  `SHA256SUMS`), so `deploy/install.sh` works from a clean machine.

## 1.2.1 (2026-10-13)

Safer defaults, from a review of 1.2.0. If you run the paid image, please upgrade.

- Requests the server makes to an address someone supplied (MCP servers, OAuth discovery, record
  connectors, directory sync, the judge) go through one check. Cloud metadata and link-local
  addresses are never reachable, private and loopback addresses are blocked unless you allow them,
  and redirects are refused. What a remote system answers is no longer shown back to the person who
  asked.
- Registering those addresses is for administrators only.
- Sign-up closes after the first account. An administrator adds people on the Team page.
- Stored credentials are encrypted by default. With SQLite, Torrix creates a key file
  (`torrix.secret.key`) next to the database.

**When you upgrade**

- To keep open sign-up, set `TORRIX_ALLOW_SIGNUP=true`.
- If your MCP servers or business systems are inside your network, list their host in
  `TORRIX_LOCAL_HOST` (for example `mcp.internal:3000`) or set `TORRIX_ALLOW_PRIVATE_HOSTS=true`.
- Back up `torrix.secret.key` with your database. Credentials saved earlier stay readable. With
  Postgres, set `TORRIX_SECRET_KEY` yourself.

## 1.2.0 (2026-10-13)

- Agent governance now starts on Pro, for up to 10 governed agents. Enterprise has no limit and adds
  agent-to-agent delegation, signed calls to your own servers, the permission graph, record
  connectors, directory sync, single sign-on and compliance. Community keeps unlimited observed
  agents.
- After a person approves a held action, an identical retry runs once with no special header.
  Retries before the approval reuse the same pending approval.
- The record connector works with any REST system, and directory sync supports any SCIM 2.0
  directory.
- Agent authorization decisions are kept. Set `TORRIX_AUTH_RETENTION_DAYS` for a cleanup window.
- Traces: trace trees expand into tool calls, reasoning and policy flags. A stepper moves between
  runs, the Flow view has zoom and idle-gap compression, and the runs list groups on the server.
- Projects: the project scope sticks across every page, with project spend views in analytics and
  cost.
- New guides: a tour of the console and a guide to the Pro and Enterprise features.

## 1.1.1 (2026-10-11)

- The TypeScript SDK is published on npm as `torrix-sdk`, matching the Python package.
- Database migrations and brand assets are embedded, so compiled binaries and images start without
  extra files on disk.
- The opencode plugin sends each step as soon as it ends.
- Continuous integration for the server, the SDKs and the plugins.

## 1.1.0 (2026-10-11)

- The Community edition has no run cap, no weekly wipe and no retention limit, and allows 5 users.
  No edition deletes your data on its own. `TORRIX_RETENTION_DAYS` is available if you want cleanup.
- The Python SDK is published on PyPI as `torrix-sdk` (`pip install torrix-sdk`, `import torrix`).
- A comparison page, issue and pull request templates, and a code of conduct.

## 1.0.0 (2026-10-11)

First public release of the Community edition: a self-hosted proxy and recorder for model calls
with traces, cost tracking and budgets, evaluations, a prompt library, PII masking, SDKs, a Claude
Code plugin, an opencode plugin, and a Docker image.
