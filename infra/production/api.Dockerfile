# syntax=docker/dockerfile:1
ARG BACKUP_POSTGRES_MAJOR=17
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS dependencies
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/database/package.json ./packages/database/
COPY packages/domain/package.json ./packages/domain/
RUN npm ci --ignore-scripts

FROM dependencies AS build
COPY tsconfig.base.json ./
COPY packages/domain ./packages/domain
COPY packages/database ./packages/database
COPY apps/api ./apps/api
COPY infra/production/build-api.mjs ./infra/production/
RUN ./node_modules/.bin/prisma generate --schema packages/database/prisma/schema.prisma
RUN node infra/production/build-api.mjs

FROM dependencies AS production-dependencies
RUN npm ci --omit=dev --ignore-scripts --workspace=@flowgastronomie/api \
    --workspace=@flowgastronomie/database --workspace=@flowgastronomie/domain

FROM base AS runtime
ENV NODE_ENV=production API_PORT=4000 \
    PREMIUM_SHOWCASE_ASSETS_DIRECTORY=/app/assets/showcases
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=node:node /app/dist/production ./dist/production
COPY --from=build --chown=node:node /app/packages/database/assets/showcases ./assets/showcases
COPY --chown=node:node infra/production/healthcheck.mjs ./infra/production/
USER node
EXPOSE 4000
CMD ["node", "dist/production/server.mjs"]

# Release/jobs image: Prisma CLI is deliberately kept out of the API runtime.
FROM runtime AS operations
USER root
COPY infra/production/operations/package.json infra/production/operations/package-lock.json /tools/
RUN npm ci --prefix /tools --omit=dev
COPY --from=build --chown=node:node /app/packages/database/prisma/schema.prisma ./packages/database/prisma/
COPY --from=build --chown=node:node /app/packages/database/prisma/migrations ./packages/database/prisma/migrations
USER node
CMD ["node", "/tools/node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "packages/database/prisma/schema.prisma"]

# One-shot logical backup client. No PostgreSQL server is started by this target.
FROM postgres:${BACKUP_POSTGRES_MAJOR}-alpine AS backup
RUN apk add --no-cache python3
COPY infra/production/backup.py infra/production/backup.sh /opt/
ENTRYPOINT ["python3", "/opt/backup.py"]
