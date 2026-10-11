# Configuration

Torrix is configured with environment variables. Every one of them is optional.

## Server

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8088` | port the server listens on |
| `DB_PATH` | `torrix.sqlite` | SQLite file location |
| `TORRIX_DATABASE_URL` | none | Postgres connection URL. When set, Postgres is used instead of SQLite |
| `TORRIX_MEDIA_DIR` | `torrix-media` next to the database | where images and audio attached to runs are stored |
| `TORRIX_OPEN_BROWSER` | `true` | open the console in a browser on start (skipped in Docker and in watch mode) |
| `DOCKER_CONTAINER` | unset | set to `true` inside containers |
| `NODE_ENV` | unset | `production` tightens sign-in rate limits |

## Proxy

| Variable | Default | What it does |
|---|---|---|
| `TORRIX_LOCAL_HOST` | none | lets the proxy reach a model server on your own network, for example `host.docker.internal:11434` for Ollama. Without it, private addresses are refused |

## Privacy

| Variable | Default | What it does |
|---|---|---|
| `TORRIX_TELEMETRY` | `true` | sends an anonymous daily ping (random instance id, OS, runtime version). Set to `false` to turn it off |
| `TORRIX_PRICING_SYNC` | `true` | downloads public model prices once a day. Set to `false` to keep the server fully offline |
| `TORRIX_SECRET_KEY` | none | encrypts stored credentials (for example webhook and provider keys saved in settings) with AES-256-GCM. Set it in production to a long random string and keep it safe: changing it makes credentials saved earlier unreadable |

See [Privacy and security](privacy-and-security.md) for everything Torrix stores and sends.

## Accounts and editions

| Variable | Default | What it does |
|---|---|---|
| `TORRIX_LICENSE_KEY` | none | a Pro or Enterprise license key, applied on first start. You can also paste it under **Settings** |
| `TORRIX_EDITION` | none | caps the edition, for example `community` to keep a licensed server on community features. It can never unlock a paid edition |
| `TORRIX_USER_LIMIT` | edition default | overrides the number of user accounts allowed |
| `TORRIX_DEMO` | `false` | read-only demo mode with sample data (`IS_DEMO` also works) |

## Notifications

| Variable | Default | What it does |
|---|---|---|
| `TORRIX_PAGERDUTY_BASE_URL` | PagerDuty Events API | override the PagerDuty endpoint, for example for an EU account |

Budgets, alert webhooks, Slack, PagerDuty and email recipients are set in the console under
**Cost & Alerts**.

## Updates and integrations

| Variable | Default | What it does |
|---|---|---|
| `TORRIX_UPDATE_REPO` | none | `owner/repo` to check for new releases. Update checks are off unless you set this |
| `TORRIX_UPDATE_CHECK` | `true` | set to `false` to disable update checks even when a repo is set |
| `TORRIX_PLUGIN_MARKETPLACE` | `TorrixAI/torrix` | where the Integrations page tells Claude Code to install the Torrix plugin from |
