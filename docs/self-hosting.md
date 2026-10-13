# Self-hosting

Torrix is a single server process with an embedded web console. By default it stores everything
in one SQLite file. Switch to Postgres when you want a managed database or more than one replica.

## Docker

The image is published on Docker Hub as `gettorrixai/torrix` and on GitHub as
`ghcr.io/torrixai/torrix`, for `linux/amd64` and `linux/arm64`:

```bash
docker run -d --name torrix -p 8088:8088 -v torrix_data:/data gettorrixai/torrix:latest
```

Torrix is then on http://localhost:8088. Data lives in the `torrix_data` volume (`/data` inside the
container). The image runs as a non-root user and has a health check on `/health`. Use a version tag
such as `gettorrixai/torrix:1.0.0` instead of `latest` when you want upgrades to happen only when
you choose.

To upgrade, pull the new image and recreate the container with the same volume:

```bash
docker pull gettorrixai/torrix:latest
docker rm -f torrix
docker run -d --name torrix -p 8088:8088 -v torrix_data:/data gettorrixai/torrix:latest
```

## Docker Compose

The repository ships a `docker-compose.yml` that runs the published image and keeps data in a
volume:

```bash
git clone https://github.com/TorrixAI/torrix.git
cd torrix
docker compose up -d
```

`docker compose up -d --build` builds the image from your checkout instead.

To use Postgres, start the bundled database with `docker compose --profile postgres up -d` and set
`TORRIX_DATABASE_URL` on the `torrix` service, for example
`postgres://torrix:torrix@db:5432/torrix`.

## Kubernetes with Helm

A chart lives in `deploy/helm/torrix` and uses the published `gettorrixai/torrix` image:

```bash
helm install torrix deploy/helm/torrix
```

To pull from GitHub or your own registry instead, set `image.repository`, for example
`--set image.repository=ghcr.io/torrixai/torrix`.

The chart creates a Deployment, Service, a persistent volume for SQLite and media, a ConfigMap,
and optionally an Ingress and a Secret. Use `postgres.url` or `postgres.existingSecret` to run on
Postgres. Liveness and readiness probes use `/health`. See `deploy/helm/torrix/values.yaml` for
every option.

## Single binary

Torrix compiles to one executable with no runtime to install:

```bash
bun install
bun run --cwd packages/server compile   # writes dist/torrix
./dist/torrix
```

On Linux and macOS, `deploy/install.sh` downloads a published release binary and can register it
as a systemd or launchd service.

## From source

```bash
bun install
bun run start      # or `bun run dev` to restart on code changes
```

## Database

| Setup | How |
|---|---|
| SQLite (default) | stored at `torrix.sqlite` in the working folder, or wherever `DB_PATH` points |
| Postgres | set `TORRIX_DATABASE_URL=postgres://user:password@host:5432/torrix` |
| Switch live | an administrator can move between SQLite and Postgres under **Settings > Database engine**. Torrix copies the admin account over so you stay signed in, and a failed switch leaves the old database untouched |

Database migrations run automatically every time Torrix starts.

## Backups

- **SQLite:** an administrator can click **Download SQLite backup** on the **Settings** page for a
  consistent copy, or call `GET /api/admin/backup`. You can also back up the volume or file while Torrix is stopped.
- **Postgres:** use your usual tools, such as `pg_dump`.
- **Key file:** with SQLite, credentials you saved in settings are encrypted with the key in
  `torrix.secret.key`, next to the database. Back it up with the database. A restored database
  without its key cannot read those credentials, and you would enter them again. (Set
  `TORRIX_SECRET_KEY` yourself if you prefer to keep the key outside the data volume.)
- Media files (images and audio attached to runs) are stored next to the database in a
  `torrix-media` folder, or wherever `TORRIX_MEDIA_DIR` points. Include it in backups.

## Upgrades

Stop Torrix, update the code, image or binary, and start it again. Migrations run on start. Back
up first, as you would with any database.

## Running behind a reverse proxy

Torrix honours `x-forwarded-proto` and `x-forwarded-host`, so links and install commands on the
Integrations page use your public address. Server-sent events are used for the live feed, so turn
off response buffering for `/api/stream` if your proxy buffers by default.

## Health check

`GET /health` answers `{"ok": true, "name": "Torrix", "version": "1.0.0"}` without
authentication.

See [Configuration](configuration.md) for every environment variable.
