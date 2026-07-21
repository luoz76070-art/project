# syntax=docker/dockerfile:1.7
# ============================================================================
# Library Manage — Multi-stage Dockerfile
# Stage 1: deps    — pnpm install with production + dev deps for build
# Stage 2: builder — Prisma generate + Next.js build
# Stage 3: runner  — minimal runtime image
# ============================================================================

# ----------------------------------------------------------------------------
# Stage 1: Install dependencies
# ----------------------------------------------------------------------------
FROM node:20-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# Copy only lockfile + package.json first for better layer caching
COPY package.json pnpm-lock.yaml* .npmrc ./
RUN pnpm install --frozen-lockfile --prefer-offline

# ----------------------------------------------------------------------------
# Stage 2: Build the Next.js application
# ----------------------------------------------------------------------------
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN pnpm prisma generate

# Build Next.js production bundle
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ----------------------------------------------------------------------------
# Stage 3: Minimal runtime image
# ----------------------------------------------------------------------------
FROM node:20-alpine AS runner
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Create non-root user for better security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs library

# Copy built artifacts and necessary runtime files
COPY --from=builder /app/public ./public
COPY --from=builder --chown=library:nodejs /app/.next/standalone ./
COPY --from=builder --chown=library:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=library:nodejs /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/package.json ./package.json

# Prepare data directory for SQLite persistence
RUN mkdir -p /app/data && chown -R library:nodejs /app/data

# Switch to non-root user
USER library

EXPOSE 3000

# Health check (Next.js will respond with 200 on /login)
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/login || exit 1

CMD ["sh", "-c", "node node_modules/prisma/build/index.js db push --skip-generate --accept-data-loss 2>/dev/null; node prisma/seed.js 2>/dev/null || true; node server.js"]