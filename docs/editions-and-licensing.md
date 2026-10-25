# Editions and licensing

Torrix comes in three editions. Community is the free, public image. Pro and Enterprise use the
Torrix paid image plus a license key. All three share the same database, so upgrading keeps your
runs, settings, users and API keys.

## What each edition includes

| | Community | Pro | Enterprise |
|---|---|---|---|
| Proxy, SDKs, plugins, OpenTelemetry, MCP | ✓ | ✓ | ✓ |
| Runs, traces, sessions, tree and flow views, live feed | ✓ | ✓ | ✓ |
| Dashboards, analytics, cost tracking, budgets, hard caps, alerts | ✓ | ✓ | ✓ |
| Prompt library, datasets and evaluations, playground | ✓ | ✓ | ✓ |
| PII masking | ✓ | ✓ | ✓ |
| Observed agents (agents seen in your runs) | ✓ | ✓ | ✓ |
| LLM judge, online evaluations, eval guardrails | | ✓ | ✓ |
| Model routing and fallback, small-model savings analysis | | ✓ | ✓ |
| Policy engine and human review queue | | ✓ | ✓ |
| Agent control plane: agent identities and credentials, enterprise agent tokens (Entra Agent ID, Okta, AgentCore), signed grants with per-grant revocation, delegated authority, authorization policies and policy packs, risk scoring, single-use approvals | | ✓ (10 agents) | ✓ (unlimited) |
| MCP tool-definition pinning with drift alerts and held calls | | | ✓ |
| Tamper-evident action ledger with signed evidence bundles | | ✓ | ✓ |
| ID-JAG / Enterprise-Managed Authorization token exchange | | ✓ | ✓ |
| Governed MCP gateway | | ✓ | ✓ |
| Agent-to-agent delegation | | | ✓ |
| Signed calls to downstream servers and the agent permission graph | | | ✓ |
| Single sign-on (OIDC), directory sync (Entra ID, Okta, any SCIM 2.0 directory) and business record connectors | | | ✓ |
| EU AI Act compliance reports, audit log export, S3 and GCS exports | | | ✓ |
| SIEM export to Splunk and Microsoft Sentinel (OCSF-shaped) | | | ✓ |

## Limits

| | Community | Pro | Enterprise |
|---|---|---|---|
| User accounts | 5 | unlimited | unlimited |
| Stored runs | unlimited | unlimited | unlimited |
| Run retention | kept until you delete them | same | same |
| Datasets, playground, search | unlimited | unlimited | unlimited |
| Governed agents (agents with an identity that Torrix authorizes) | none, unlimited observed agents | 10 | unlimited |

Torrix never deletes your data on its own in any edition. If you want old runs cleaned up, set
`TORRIX_RETENTION_DAYS`. Golden runs are always kept. Authorization decisions, the audit record of
what agents were allowed to do, are kept too, unless you set `TORRIX_AUTH_RETENTION_DAYS`.

A governed agent counts while it is active. Suspending or revoking an agent, or letting it expire,
frees its place, so replacing an agent never needs an upgrade. Observed agents, the ones Torrix sees
in your runs, are never limited.

Paid features you do not have yet appear in the console with a small **Pro** or **Ent** badge and
a short description, so you can see what an upgrade adds. What each one does and how to set it up is
in [Pro and Enterprise features](pro-and-enterprise.md).

## Upgrading from Community

The Community image does not contain the paid features, so an upgrade has two parts:

1. **Switch the image.** With your license you get access to the Torrix paid image. Replace
   `gettorrixai/torrix` with it and start it on the **same data volume** (or the same
   `TORRIX_DATABASE_URL`). Nothing is exported or migrated by hand: the paid image opens your
   existing database and adds what it needs.
2. **Add the license key.** Paste it under **Settings > License**, or start Torrix with
   `TORRIX_LICENSE_KEY=<your key>`. The features of your edition turn on right away.

If you add a license to the Community image, the higher user limit applies. The license is
accepted, and Settings, License and the paid pages (such as Agents and Governance) say that the
features need the paid image and that your data volume and key carry over.

When a license expires, Torrix returns to the Community edition and your data stays where it is.
Going back to the Community image works the same way: start it on the same volume.

License keys are checked on your own server against a public key built into Torrix. Nothing is sent
to us to validate them. Each key carries a serial. If someone has published a signed revocation
list for keys that were lost or leaked, point `TORRIX_LICENSE_REVOCATIONS` at it (a URL or a local
file) and Torrix checks it daily and on activation, returning listed keys to Community. This is
opt-in: without the setting, Torrix never checks and never calls out.

To buy a license or start a trial, open a discussion on GitHub or contact the Torrix team.

## The license, in plain words

Torrix Community is released under the **Functional Source License 1.1 with an Apache 2.0 future
license** (FSL-1.1-ALv2). The full text is in [LICENSE](../LICENSE). In short:

**You can:**

- use Torrix for free, for any purpose, inside your company or for your own projects
- read, change and build on the code
- self-host it for your team and your customers' workloads
- use it while providing services to a client, such as consulting

**You cannot:**

- offer Torrix, or a product built from it, as a commercial service that competes with Torrix

**Every release becomes Apache 2.0** two years after it is published, with no restrictions at all.

If you are unsure whether your use is allowed, open a discussion and ask.
