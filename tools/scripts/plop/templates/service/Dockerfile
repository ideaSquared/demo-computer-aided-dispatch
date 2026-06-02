# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY services/{{name}}/package.json ./services/{{name}}/
RUN pnpm install --frozen-lockfile

FROM deps AS build
WORKDIR /app
COPY services/{{name}} ./services/{{name}}
RUN pnpm --filter @cad/{{name}} build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/services/{{name}}/dist ./dist
COPY --from=build /app/services/{{name}}/package.json ./package.json
USER node
CMD ["node", "dist/index.js"]
