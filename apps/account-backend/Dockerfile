FROM oven/bun:1-alpine AS bun

FROM node:26-alpine AS base

WORKDIR /workspace

RUN apk add --no-cache \
      ca-certificates \
      openssl

FROM base AS build-base

ENV BUN_INSTALL=/usr/local \
    PUPPETEER_SKIP_DOWNLOAD=true

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

FROM build-base AS deps

COPY package.json bun.lock ./

RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

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

FROM build-base AS production-deps

WORKDIR /workspace

ENV NODE_ENV=production

COPY package.json bun.lock ./

RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production

COPY --from=prisma-deps /workspace/node_modules/.prisma ./node_modules/.prisma

COPY apps/account-backend/prisma.config.ts ./apps/account-backend/prisma.config.ts
COPY apps/account-backend/prisma ./apps/account-backend/prisma

FROM base AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

RUN apk add --no-cache \
      curl \
      dumb-init \
      python3 \
    && addgroup -S app \
    && adduser -S -G app -h /app app

# Install and remove pip in the same layer so it is not shipped in the image.
COPY apps/account-backend/scripts/requirements.txt ./scripts/requirements.txt

RUN apk add --no-cache --virtual .python-build-deps py3-pip \
    && python3 -m pip install --no-cache-dir --no-compile -r scripts/requirements.txt --break-system-packages \
    && apk del .python-build-deps

COPY --from=production-deps --chown=app:app /workspace/node_modules ./node_modules

COPY --from=production-deps --chown=app:app /workspace/apps/account-backend/prisma.config.ts ./apps/account-backend/prisma.config.ts
COPY --from=production-deps --chown=app:app /workspace/apps/account-backend/prisma ./apps/account-backend/prisma

COPY --from=builder --chown=app:app /workspace/apps/account-backend/dist ./
COPY --from=builder --chown=app:app /workspace/apps/account-backend/scripts ./scripts

USER app

EXPOSE 3000 50051

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl --fail --silent --show-error http://127.0.0.1:3000/api/health >/dev/null || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "main.js"]
