# Privacy and security

Torrix is built for teams that cannot send prompts and responses to someone else's cloud. This
page lists what Torrix stores, what it sends out, and how to lock it down.

## What Torrix stores

Everything is stored in your own database (SQLite or Postgres) and media folder:

- each run: prompt, response, reasoning, tool calls, model, tokens, cost, timing, status
- request bodies, capped at a few kilobytes per run
- images and audio attached to requests, up to 5 MB each
- your accounts, projects, API keys, prompts, datasets and settings

Provider API keys sent through the proxy are passed on to the provider and **never stored**.

## What Torrix sends out

| Traffic | When | How to turn it off |
|---|---|---|
| Your AI calls to the provider you chose | when you use the proxy, by design | not applicable |
| An anonymous ping: a random instance id, your OS and runtime version. No usage data | once a day | `TORRIX_TELEMETRY=false` (already off in the Docker Compose file) |
| A download of public model prices from openrouter.ai, or LiteLLM's price list on GitHub. Nothing about your usage is sent | once a day | `TORRIX_PRICING_SYNC=false` |
| A release check | only if you set `TORRIX_UPDATE_REPO` | leave it unset |
| Alerts and digests | to webhooks, Slack, PagerDuty or email addresses you configure | remove them in **Cost & Alerts** |

With telemetry and pricing sync turned off, Torrix makes no outbound calls of its own.

## PII masking

Under **Governance**, turn on PII masking to redact personal data before anything is stored. It
recognizes email addresses, card numbers, social security numbers, IBANs, passport numbers, phone
numbers, IP addresses, postal codes and API-key-like strings. You choose:

- which types to mask
- whether to mask inputs, outputs, or both
- the placeholder text

Masking applies to stored prompts, responses, reasoning and tool calls on every ingestion path.
The request your app sends to the provider is not changed.

## Access

- Torrix API keys start with `trxk_`, are stored only as SHA-256 hashes, and are shown once when
  created. Each key can be read-only or read and write, and can be limited to certain projects.
- Give every integration its own key (the Integrations page does this for you), so you can revoke
  one without breaking the others.
- Run ids chosen by clients can never overwrite another account's data.
- The console uses an HTTP-only session cookie. Sign-in attempts are rate limited.
- Only the first account can sign itself up. After that, an administrator creates accounts, so a
  console that is reachable from the internet does not hand out accounts. Set
  `TORRIX_ALLOW_SIGNUP=true` only if you want open sign-up.
- Credentials you save in settings are encrypted at rest. With SQLite, Torrix creates the key for
  you in a file next to the database (`torrix.secret.key`, readable only by its owner). With
  Postgres, set `TORRIX_SECRET_KEY`.

## Network

- The proxy refuses to forward to private and local network addresses unless you allow one with
  `TORRIX_LOCAL_HOST`, so it cannot be turned into a way into your internal network.
- Every request Torrix makes to an address someone supplied (MCP servers, connectors, directory
  sync) is checked first. Cloud metadata and link-local addresses are never reachable, private and
  loopback addresses are blocked until you allow them with `TORRIX_LOCAL_HOST` or
  `TORRIX_ALLOW_PRIVATE_HOSTS`, redirects are not followed, and what a remote system answers is not
  shown back to the person who asked.
- Put Torrix behind your usual TLS-terminating reverse proxy or ingress. The Helm chart can create
  an Ingress for you.

## Retention

Torrix keeps every run until you delete it, in every edition. To remove old runs automatically,
set `TORRIX_RETENTION_DAYS`, for example `30`. Golden runs are never removed by this cleanup.

## Reporting a vulnerability

Please report security issues privately as described in [SECURITY.md](../SECURITY.md).
