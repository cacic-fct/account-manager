FROM oven/bun:1-alpine AS bun

FROM node:22-alpine AS base

RUN apk add --no-cache ca-certificates

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

ENV PATH="/app/node_modules/.bin:$PATH"

FROM base AS deps

COPY package.json bun.lock ./

RUN bun install --frozen-lockfile

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