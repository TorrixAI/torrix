# Changelog

What changed in each release, and what to do when you upgrade. Release notes with the same
information are on the [releases page](https://github.com/TorrixAI/torrix/releases).

## Unreleased

Nothing yet.

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
