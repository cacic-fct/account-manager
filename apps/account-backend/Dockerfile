FROM oven/bun:1-alpine AS bun

FROM node:22-alpine AS base

ENV BUN_INSTALL=/usr/local \
    PUPPETEER_SKIP_DOWNLOAD=true

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /workspace

RUN apk add --no-cache \
      ca-certificates \
      openssl

FROM base AS deps

COPY package.json bun.lock ./

RUN --mount=type=cache,target=/root/.bun/install/cache \
    --mount=type=secret,id=npm_token \
    set -eu; \
    export npm_token="$(cat /run/secrets/npm_token)"; \
    printf '[install.scopes]\n"@cacic-fct" = { token = "$npm_token", url = "https://npm.pkg.github.com/" }\n' > /root/.bunfig.toml; \
    bun install --frozen-lockfile; \
    rm -f /root/.bunfig.toml

FROM deps AS prisma-deps

COPY apps/account-backend/prisma.config.ts ./apps/account-backend/prisma.config.ts
COPY apps/account-backend/prisma ./apps/account-backend/prisma

WORKDIR /workspace/apps/account-backend

RUN DATABASE_URL="postgresql://user:password@localhost:5432/db?schema=public" \
    bun x prisma generate --config prisma.config.ts

FROM prisma-deps AS builder

WORKDIR /workspace

COPY nx.json tsconfig.base.json ./

COPY apps/account-backend ./apps/account-backend
COPY libs ./libs

RUN NODE_ENV=production bun x nx run account-backend:build

FROM base AS production-deps

WORKDIR /workspace

ENV NODE_ENV=production

COPY package.json bun.lock ./

RUN --mount=type=cache,target=/root/.bun/install/cache \
    --mount=type=secret,id=npm_token \
    set -eu; \
    export npm_token="$(cat /run/secrets/npm_token)"; \
    printf '[install.scopes]\n"@cacic-fct" = { token = "$npm_token", url = "https://npm.pkg.github.com/" }\n' > /root/.bunfig.toml; \
    bun install --frozen-lockfile --production; \
    rm -f /root/.bunfig.toml

COPY --from=prisma-deps /workspace/node_modules/.prisma ./node_modules/.prisma
COPY --from=prisma-deps /workspace/node_modules/@prisma ./node_modules/@prisma

COPY apps/account-backend/prisma.config.ts ./apps/account-backend/prisma.config.ts
COPY apps/account-backend/prisma ./apps/account-backend/prisma

FROM base AS runtime

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

RUN apk add --no-cache \
      curl \
      dumb-init \
      openssl \
      python3 \
      py3-pip \
    && addgroup -S app \
    && adduser -S -G app -h /app app

COPY --from=production-deps --chown=app:app /workspace/node_modules ./node_modules

COPY --from=production-deps --chown=app:app /workspace/apps/account-backend/prisma.config.ts ./apps/account-backend/prisma.config.ts
COPY --from=production-deps --chown=app:app /workspace/apps/account-backend/prisma ./apps/account-backend/prisma

COPY --from=builder --chown=app:app /workspace/apps/account-backend/dist ./
COPY --from=builder --chown=app:app /workspace/apps/account-backend/scripts ./scripts
COPY --from=builder --chown=app:app /workspace/dist/libs ./libs
COPY --from=builder --chown=app:app /workspace/dist/libs /dist/libs

# Install Python dependencies
RUN python3 -m pip install --no-cache-dir -r scripts/requirements.txt --break-system-packages

USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl --fail --silent --show-error http://127.0.0.1:3000/api/health >/dev/null || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "main.js"]
