# syntax=docker/dockerfile:1.7
# ============================================================================
# Library Manage — Multi-stage Dockerfile
# Base: node:20-alpine3.16 (Alpine 3.16 ships openssl 1.1)
# Why 3.16: Prisma 5.22 binary engine defaults to openssl-1.1.x.
# Alpine 3.17+ ships only openssl-3, breaking the default binary.
# ============================================================================

# Stage 1: deps
FROM node:20-alpine3.16 AS deps
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml* .npmrc ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile --prefer-offline

# Stage 2: builder
FROM node:20-alpine3.16 AS builder
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# Stage 3: runner
FROM node:20-alpine3.16 AS runner
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
RUN apk add --no-cache wget
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV DATABASE_URL="file:/app/data/library.db"
ENV NEXTAUTH_SECRET="dev-secret-please-change-in-production-environment-xyz"
ENV AUTH_SECRET="dev-secret-please-change-in-production-environment-xyz"
ENV AUTH_TRUST_HOST="true"

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs library

COPY --from=builder /app/public ./public
COPY --from=builder --chown=library:nodejs /app/.next/standalone ./
COPY --from=builder --chown=library:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=library:nodejs /app/prisma ./prisma
COPY --from=builder /app/node_modules/.pnpm ./node_modules/.pnpm
COPY --from=builder --chown=library:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=library:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=library:nodejs /app/node_modules/bcryptjs ./node_modules/bcryptjs
COPY --from=builder /app/package.json ./package.json

RUN mkdir -p /app/data && chown -R library:nodejs /app/data

USER library

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/login || exit 1

CMD ["sh", "-c", "echo '=== Running db push ===' && node node_modules/.pnpm/prisma@5.22.0/node_modules/prisma/build/index.js db push --skip-generate --accept-data-loss && echo '=== Running seed ===' && node node_modules/.pnpm/tsx@4.23.1/node_modules/tsx/dist/cli.mjs prisma/seed.ts && echo '=== Starting server ===' && exec node server.js"]