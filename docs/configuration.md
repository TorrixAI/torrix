# Configuration

Torrix is configured with environment variables. Every one of them is optional.

## Server

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8088` | port the server listens on |
| `DB_PATH` | `torrix.sqlite` in the working folder (`packages/server/torrix.sqlite` when run from a source checkout) | SQLite file location |
| `TORRIX_DATABASE_URL` | none | Postgres connection URL. When set, Postgres is used instead of SQLite |
| `TORRIX_MEDIA_DIR` | `torrix-media` next to the database | where images and audio attached to runs are stored |
| `TORRIX_OPEN_BROWSER` | `true` | open the console in a browser on start (skipped in Docker and in watch mode) |
| `DOCKER_CONTAINER` | unset | set to `true` inside containers |
| `NODE_ENV` | unset | `production` tightens sign-in rate limits |

## Proxy

| Variable | Default | What it does |
|---|---|---|
| `TORRIX_LOCAL_HOST` | none | lets Torrix reach a server on your own network, for example `host.docker.internal:11434` for Ollama. Comma separated, `host` or `host:port`. Without it, private addresses are refused. Covers MCP servers and business systems, directory sync, OIDC, alert webhooks, S3 or GCS exports and the embeddings endpoint |
| `TORRIX_ALLOW_PRIVATE_HOSTS` | `false` | set to `true` to let Torrix call any private or loopback address, for example MCP servers and business systems inside your network. Covers the same integrations as `TORRIX_LOCAL_HOST`. Cloud metadata and link-local addresses are never reachable. Prefer listing hosts in `TORRIX_LOCAL_HOST` |

## Privacy

| Variable | Default | What it does |
|---|---|---|
| `TORRIX_TELEMETRY` | `true` | sends an anonymous daily ping (random instance id, OS, runtime version). Set to `false` to turn it off |
| `TORRIX_PRICING_SYNC` | `true` | downloads public model prices once a day. Set to `false` to keep the server fully offline |
| `TORRIX_SECRET_KEY` | created for you with SQLite | encrypts stored credentials (provider keys such as the judge and MCP server credentials) with AES-256-GCM. With SQLite, Torrix creates a key file called `torrix.secret.key` next to the database on first start. With Postgres, set this to a long random string yourself. Keep the key safe: changing it makes credentials saved earlier unreadable unless you rotate with `TORRIX_SECRET_KEY_PREVIOUS` |
| `TORRIX_SECRET_KEY_PREVIOUS` | none | the old key while rotating `TORRIX_SECRET_KEY`. Torrix reads values written with it and re-encrypts them with the current key automatically (a sweep runs within seconds of boot and every 6 hours; the paid image also has `POST /api/v1/secrets/rotate` for admins). Remove it once the sweep reports no unreadable values |

See [Privacy and security](privacy-and-security.md) for everything Torrix stores and sends.

## Accounts and editions

| Variable | Default | What it does |
|---|---|---|
| `TORRIX_LICENSE_KEY` | none | a Pro or Enterprise license key, applied on first start. You can also paste it under **Settings** |
| `TORRIX_LICENSE_REVOCATIONS` | none | opt-in URL or file path to a signed revocation list. Listed license serials return the instance to the Community edition; the list is verified against the Torrix signing key and cached, so an offline restart keeps applying the last one |
| `TORRIX_EDITION` | none | caps the edition, for example `community` to keep a licensed server on community features. It can never unlock a paid edition |
| `TORRIX_ALLOW_SIGNUP` | `false` | the first account is always allowed. After that, new accounts are created by an administrator. Set to `true` to let anyone who can reach the console create an account |
| `TORRIX_USER_LIMIT` | edition default | lowers the number of user accounts allowed. It cannot raise the edition's limit |
| `TORRIX_RETENTION_DAYS` | keep everything | deletes runs older than this many days, once a day. Golden runs are kept |
| `TORRIX_DEMO` | `false` | read-only demo mode with sample data (`IS_DEMO` also works) |
| `TORRIX_AUTH_RETENTION_DAYS` | keep everything | Pro and Enterprise: deletes agent authorization decisions older than this many days, once a day. Off by default because decisions are the audit record |

## Notifications

| Variable | Default | What it does |
|---|---|---|
| `TORRIX_PAGERDUTY_BASE_URL` | PagerDuty Events API | override the PagerDuty endpoint, for example for an EU account |

Budgets, alert webhooks, Slack, PagerDuty and email recipients are set in the console under
**Cost & Alerts**.

## Single sign-on, embeddings and signed calls (paid editions)

| Variable | Default | What it does |
|---|---|---|
| `TORRIX_OIDC_ISSUER` | none | Enterprise: the OpenID Connect issuer URL for single sign-on, for example your Entra or Okta tenant. You can also set this under **Settings**, which takes priority over the variable |
| `TORRIX_OIDC_CLIENT_ID` | none | Enterprise: the client id registered for Torrix at your identity provider |
| `TORRIX_OIDC_CLIENT_SECRET` | none | Enterprise: the client secret. Prefer saving it under **Settings**, where it is stored encrypted |
| `TORRIX_OIDC_REDIRECT_URI` | built from the request | Enterprise: the callback URL registered at your identity provider. Set it when Torrix sits behind a proxy that hides the public address |
| `TORRIX_OIDC_SCOPES` | `openid email profile` | Enterprise: the scopes requested at sign-in |
| `TORRIX_OIDC_AUTO_PROVISION` | `true` | Enterprise: create an account the first time someone signs in, within the user limit. Set to `false` to allow only existing accounts |
| `TORRIX_EMBEDDINGS_URL` | none | Pro and Enterprise: an OpenAI compatible embeddings endpoint used to group similar prompts when looking for savings. Without it Torrix uses a built-in method that needs no network |
| `TORRIX_EMBEDDINGS_KEY` | none | Pro and Enterprise: the bearer token for the embeddings endpoint, if it needs one |
| `TORRIX_EMBEDDINGS_MODEL` | `text-embedding-3-small` | Pro and Enterprise: the model name sent to the embeddings endpoint |
| `TORRIX_ATTESTATION_ISSUER` | `torrix` | Enterprise: the `iss` value in the signed token Torrix adds to calls it forwards to your own MCP servers. Your server checks for the same value |

SSO and the embeddings endpoint are reached through the same outbound guard as other integrations, so
a server on your own network needs `TORRIX_LOCAL_HOST` or `TORRIX_ALLOW_PRIVATE_HOSTS`.

## Updates and integrations

| Variable | Default | What it does |
|---|---|---|
| `TORRIX_UPDATE_REPO` | none | `owner/repo` to check for new releases. Update checks are off unless you set this |
| `TORRIX_UPDATE_CHECK` | `true` | set to `false` to disable update checks even when a repo is set |
| `TORRIX_PLUGIN_MARKETPLACE` | `TorrixAI/torrix` | where the Integrations page tells Claude Code to install the Torrix plugin from |
