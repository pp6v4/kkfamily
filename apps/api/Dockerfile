FROM node:22-bookworm-slim AS build
WORKDIR /workspace
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build?schema=public

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/client/package.json ./apps/client/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN corepack enable && pnpm install --filter @family-life/api... --no-frozen-lockfile

COPY apps/api ./apps/api
COPY packages/contracts ./packages/contracts
RUN pnpm --filter @family-life/api prisma:generate && pnpm --filter @family-life/api build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /workspace/apps/api/dist ./dist
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /workspace/node_modules/.pnpm ./node_modules/.pnpm
COPY --from=build /workspace/apps/api/package.json ./package.json
COPY --from=build /workspace/apps/api/prisma ./prisma
EXPOSE 3000
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/main.js"]
