# syntax=docker/dockerfile:1.7
#
# Multi-stage build for a CAD service. The "deps" stage installs the entire
# workspace because pnpm needs every workspace package.json to resolve
# 'workspace:*' references from the lockfile. The "build" stage runs a
# filtered build so only this service compiles.
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY services ./services
COPY tools ./tools
COPY apps ./apps
RUN pnpm install --frozen-lockfile

FROM deps AS build
WORKDIR /app
# Build this service AND every workspace package it transitively depends on.
# The trailing '...' is pnpm's "include dependencies" filter. Required because
# tsup resolves @cad/* via the 'import' export condition (./dist/index.js),
# which doesn't exist until the shared package is built.
RUN pnpm --filter "@cad/service.notification..." build

FROM node:20-alpine AS runtime
RUN apk add --no-cache tini
WORKDIR /app
ENV NODE_ENV=production
# Preserve the workspace layout so Node's module-resolution algorithm finds
# the service's node_modules (which contain pnpm symlinks into the root
# /app/node_modules/.pnpm store).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/services/service.notification/node_modules ./services/service.notification/node_modules
COPY --from=build /app/services/service.notification/dist ./services/service.notification/dist
COPY --from=build /app/services/service.notification/package.json ./services/service.notification/package.json
USER node
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "services/service.notification/dist/index.js"]
