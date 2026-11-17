# syntax=docker/dockerfile:1
# MOM API image. Build from the REPO ROOT (it needs the workspace files):
#   docker build -f apps/api/Dockerfile -t mom-api .

# Keep ALPINE_IMAGE on the same Alpine release that NODE_IMAGE is built on (node needs its libs).
ARG NODE_IMAGE=node:24-alpine3.24
ARG ALPINE_IMAGE=alpine:3.24

# ---- 1. build: install everything, bundle the API with esbuild -------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @mom/api

# ---- 2. deps: production dependencies of the API only ----------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --workspace @mom/api --include-workspace-root=false --no-audit --no-fund \
 && rm -rf node_modules/@mom node_modules/@types \
 && find node_modules \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.cts' -o -name '*.d.mts' \
      -o -iname 'README*' -o -iname 'CHANGELOG*' -o -name '*.md' \) -type f -delete

# ---- 3. runtime: plain Alpine + the node binary only (no npm/yarn/corepack) --------
FROM ${NODE_IMAGE} AS node
FROM ${ALPINE_IMAGE} AS runtime
RUN apk add --no-cache libstdc++ \
 && addgroup -g 1000 node && adduser -u 1000 -G node -s /sbin/nologin -D node
COPY --from=node /usr/local/bin/node /usr/local/bin/node
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=4000 \
    MIGRATIONS_DIR=/app/drizzle
WORKDIR /app
COPY --from=deps --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
COPY --from=build --chown=node:node /repo/apps/api/drizzle ./drizzle
COPY --chown=node:node apps/api/package.json ./package.json
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:4000/health || exit 1
# Run migrations as a one-off task with:  node dist/migrate.js
CMD ["node", "--enable-source-maps", "dist/server.js"]
