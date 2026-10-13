# Changelog

What changed in each release, and what to do when you upgrade. Release notes with the same
information are on the [releases page](https://github.com/TorrixAI/torrix/releases).

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
