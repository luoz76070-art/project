# syntax=docker/dockerfile:1.7
# ============================================================================
# Library Manage — Multi-stage Dockerfile
# Uses Alpine with openssl-3 (Prisma schema is configured for openssl-3.0.x).
# ============================================================================

# Stage 1: deps
FROM node:20-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml* .npmrc ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile --prefer-offline

# Stage 2: builder
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# Stage 3: runner
FROM node:20-alpine AS runner
RUN corepack enable && corepack prepare pnpm@9 --activate
RUN apk add --no-cache wget
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs library

COPY --from=builder /app/public ./public
COPY --from=builder --chown=library:nodejs /app/.next/standalone ./
COPY --from=builder --chown=library:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=library:nodejs /app/prisma ./prisma
COPY --from=builder /app/node_modules/.pnpm ./node_modules/.pnpm
COPY --from=builder --chown=library:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=library:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/package.json ./package.json

RUN mkdir -p /app/data && chown -R library:nodejs /app/data

USER library

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/login || exit 1

CMD ["sh", "-c", "node node_modules/prisma/build/index.js db push --skip-generate --accept-data-loss 2>/dev/null; node prisma/seed.js 2>/dev/null || true; node server.js"]
