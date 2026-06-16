FROM oven/bun:1-alpine AS bun

FROM node:22-alpine AS base

RUN apk add --no-cache ca-certificates

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

ENV PATH="/app/node_modules/.bin:$PATH"

FROM base AS deps

COPY package.json bun.lock ./

RUN --mount=type=cache,target=/root/.bun/install/cache \
    --mount=type=secret,id=npm_token \
    set -eu; \
    export npm_token="$(cat /run/secrets/npm_token)"; \
    printf '[install.scopes]\n"@cacic-fct" = { token = "$npm_token", url = "https://npm.pkg.github.com/" }\n' > /root/.bunfig.toml; \
    bun install --frozen-lockfile; \
    rm -f /root/.bunfig.toml

FROM deps AS build

COPY . .

RUN nx build account-frontend --configuration production

FROM node:22-alpine AS production

WORKDIR /app

RUN apk add --no-cache ca-certificates

ENV NODE_ENV=production
ENV PORT=4000
ENV HOSTNAME=0.0.0.0

COPY --from=build /app/apps/account-frontend/dist/cacic-account-manager ./

EXPOSE 4000

CMD ["node", "server/server.mjs"]
