# CACiC Account Manager

Monorepo Nx do gerenciador de contas do CACiC. O projeto centraliza autenticação, onboarding, perfil do usuário, preferências de privacidade, solicitações LGPD, verificação de vínculo estudantil, integração com Discord e contratos para comunicação M2M entre serviços CACiC.

## Stack

- Nx para orquestrar aplicações e bibliotecas.
- Bun como gerenciador de pacotes e executor de comandos de desenvolvimento.
- Angular com Angular Material, SSR e Storybook no frontend.
- NestJS no backend, com Swagger, Prisma, PostgreSQL, Redis, BullMQ e sessões HTTP.
- Keycloak para autenticação, autorização e clientes M2M.
- Discord API para OAuth, bot e role connections.
- S3 compatível com SeaweedFS para arquivos de LGPD e documentos.
- Docker Compose para dependências locais e deploy com Traefik.

## Pré-requisitos

- Bun instalado.
- Docker, quando for usar PostgreSQL e Redis locais via Compose.
- Python 3, apenas para os fluxos do backend que validam PDFs.

Instale as dependências com:

```bash
bun install
```

## Configuração Local

Copie o exemplo de ambiente do backend e ajuste os valores reais:

```bash
cp apps/account-backend/.env.example apps/account-backend/.env
```

Variáveis obrigatórias ou normalmente usadas pelo backend:

- `DATABASE_URL`: conexão PostgreSQL usada pelo Prisma.
- `SESSION_SECRET`: segredo das sessões HTTP.
- `BACKEND_URL`: origem pública/local do backend. O backend normaliza os callbacks OAuth para o prefixo público `/api`.
- `FRONTEND_URL`: URL pública/local do frontend.
- `REDIS_HOST`, `REDIS_PORT` e, se necessário, `REDIS_PASSWORD`.
- `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET` e credenciais administrativas/M2M separadas.
- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN` e `DISCORD_GUILD_ID`.
- `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET_NAME` e `S3_REGION`.
- `ALLOWED_REDIRECT_URLS` e `CORS_ORIGINS`, quando houver mais de uma origem autorizada.

Para subir apenas as dependências locais:

```bash
docker compose -f docker/docker-compose.dev.yml up -d
```

O Compose de desenvolvimento expõe PostgreSQL em `localhost:5432` e Redis em `localhost:6379`.

## Prisma

Depois de instalar dependências ou alterar `apps/account-backend/prisma/schema.prisma`, gere o client:

```bash
bunx prisma generate --schema apps/account-backend/prisma/schema.prisma
```

## Desenvolvimento

```bash
bunx nx serve account-frontend
bunx nx serve account-backend
```

## Comandos principais

```bash
# Ver projetos conhecidos pelo Nx
bunx nx show projects

# Build das aplicações
bunx nx build account-frontend
bunx nx build account-backend

# Testes
bunx nx test account-frontend
bunx nx test account-backend
bunx nx e2e account-backend

# Lint
bunx nx affected -t eslint:lint --parallel=3

# Storybook do frontend
bunx nx storybook account-frontend
bunx nx build-storybook account-frontend

# Bibliotecas publicáveis no npm
bun run build:packages
bun run publish:packages
```
