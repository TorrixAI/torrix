# syntax=docker/dockerfile:1
# The console is a static Vite build (packages/web), so it is built with dev
# dependencies in its own stage and copied next to the server sources.
FROM oven/bun:1.4-alpine AS web-build
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
RUN bun install --frozen-lockfile
COPY packages/web ./packages/web
RUN bun run --cwd packages/web build

FROM oven/bun:1.4-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4-alpine AS runtime
WORKDIR /app

# server code + migrations; sdk-python is host-language only and not shipped here
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/server/node_modules packages/server/node_modules
COPY package.json ./
COPY packages/server/package.json packages/server/package.json
COPY packages/server/src ./packages/server/src
COPY packages/server/drizzle ./packages/server/drizzle
COPY packages/server/drizzle-pg ./packages/server/drizzle-pg
COPY --from=web-build /app/packages/web/dist ./packages/web/dist

ENV NODE_ENV=production \
    PORT=8088 \
    DB_PATH=/data/torrix.sqlite \
    TORRIX_TELEMETRY=false \
    TORRIX_OPEN_BROWSER=false \
    DOCKER_CONTAINER=true

RUN mkdir -p /data && chown -R bun:bun /data /app
USER bun

EXPOSE 8088
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||8088)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "packages/server/src/index.ts"]
