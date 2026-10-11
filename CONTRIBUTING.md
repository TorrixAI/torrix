# Contributing to Torrix

Thanks for helping. Bug reports, ideas, docs fixes and code are all welcome.

## Reporting a bug or asking for a feature

Open an issue and include:

- what you did, what you expected, and what happened instead
- your Torrix version (shown in the account menu and on `/health`)
- how you run it: Docker, Helm, binary or source, and SQLite or Postgres
- the integration involved: proxy, Python or TypeScript SDK, Claude Code, opencode, OpenTelemetry

Please leave prompts, responses and API keys out of issues.

For security problems, do not open a public issue. See [SECURITY.md](SECURITY.md).

## Setting up for development

You need [Bun](https://bun.sh) 1.2 or newer. Python 3.9+ is only needed for the Python SDK tests.

```bash
git clone https://github.com/TorrixAI/torrix.git
cd torrix
bun install
bun run dev          # server on http://localhost:8088, restarts on changes
```

## Checks to run before a pull request

```bash
bun run typecheck    # server types
bun run test         # server tests
bun run test:sdk     # TypeScript SDK
bun run test:plugin  # Claude Code plugin
bun run test:py      # Python SDK
```

## Layout

| Path | What it is |
|---|---|
| `packages/server` | the server and web console (Fastify, Bun, SQLite or Postgres) |
| `packages/server/src/routes` | HTTP routes and the server-rendered console pages |
| `packages/server/src/lib` | shared logic: extraction, pricing, cost, masking, events |
| `packages/server/src/repos` | data access, one SQL path for SQLite and Postgres |
| `packages/server/drizzle`, `drizzle-pg` | database migrations for SQLite and Postgres |
| `packages/sdk-python`, `packages/sdk-ts` | Python and TypeScript SDKs |
| `packages/sdk-dotnet`, `packages/sdk-java` | .NET and Java clients |
| `packages/claude-code-plugin` | the Claude Code plugin |
| `.opencode/plugins` | the opencode plugin |
| `deploy` | Helm chart, install script and service files |
| `docs` | the documentation you are reading |

## Code style

- TypeScript, strict mode. Match the style of the file you are editing.
- Add a comment only when it explains something the code cannot.
- Every change that alters behavior comes with a test.
- Database changes need a migration for both SQLite (`drizzle/`) and Postgres (`drizzle-pg/`).
- User-facing text is short and plain.

## License of contributions

By opening a pull request you agree that your contribution is licensed under the project's
[license](LICENSE).
