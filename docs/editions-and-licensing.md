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
| Agent control plane: agent identities, delegated authority, authorization policies, approvals | | | ✓ |
| Governed MCP gateway and agent-to-agent delegation | | | ✓ |
| Single sign-on (OIDC) and directory sync | | | ✓ |
| EU AI Act compliance reports, audit log export, S3 and GCS exports | | | ✓ |

## Limits

| | Community | Pro | Enterprise |
|---|---|---|---|
| User accounts | 5 | unlimited | unlimited |
| Stored runs | unlimited | unlimited | unlimited |
| Run retention | kept until you delete them | same | same |
| Datasets, playground, search | unlimited | unlimited | unlimited |

Torrix never deletes your data on its own in any edition. If you want old runs cleaned up, set
`TORRIX_RETENTION_DAYS`. Golden runs are always kept.

Paid features you do not have yet appear in the console with a small **Pro** or **Ent** badge and
a short description, so you can see what an upgrade adds.

## Upgrading from Community

The Community image does not contain the paid features, so an upgrade has two parts:

1. **Switch the image.** With your license you get access to the Torrix paid image. Replace
   `gettorrixai/torrix` with it and start it on the **same data volume** (or the same
   `TORRIX_DATABASE_URL`). Nothing is exported or migrated by hand: the paid image opens your
   existing database and adds what it needs.
2. **Add the license key.** Paste it under **Settings > License**, or start Torrix with
   `TORRIX_LICENSE_KEY=<your key>`. The features of your edition turn on right away.

If you add a license to the Community image, the higher user limit applies,
and the paid features show a note that they need the paid image.

When a license expires, Torrix returns to the Community edition and your data stays where it is.
Going back to the Community image works the same way: start it on the same volume.

License keys are checked on your own server against a public key built into Torrix. Nothing is sent
to us to validate them.

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
