# syntax=docker/dockerfile:1.7
# ============================================================================
# Library Manage — Multi-stage Dockerfile (v2.3)
# Base: node:20-alpine3.16 (Alpine 3.16 ships openssl 1.1)
# Why 3.16: Prisma 5.22 binary engine defaults to openssl-1.1.x.
# Alpine 3.17+ ships only openssl-3, breaking the default binary.
#
# v2.3 新增（v2.2 基础上）：
#   - OpenSpec CLI（npm i -g @fission-ai/openspec）
#   - frontend-design skill（来自 anthropics/skills）
#   - Superpowers plugin（14 个开发方法论 skills）
#
# 注：skill 文件必须在 build context 中预下载（受沙箱网络限制）
# ============================================================================

# Stage 1: deps
FROM node:20-alpine3.16 AS deps
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml* .npmrc ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile --prefer-offline

# Stage 2: builder（不 COPY skills/，避免 Next.js 编译 skill 里的示例 .ts 文件）
FROM node:20-alpine3.16 AS builder
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
# 只 COPY 应用代码 + prisma（不含 skills/）
COPY package.json pnpm-lock.yaml* .npmrc ./
COPY prisma ./prisma
COPY src ./src
COPY public ./public
COPY next.config.ts tsconfig.json postcss.config.mjs tailwind.config.ts ./
RUN pnpm prisma generate
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# Stage 2.5: skills（独立 stage，纯文件 COPY 不编译）
FROM alpine:3.16 AS skills
WORKDIR /skills
COPY skills/frontend-design /skills/frontend-design
COPY skills/superpowers /skills/superpowers

# Stage 3: runner
FROM node:20-alpine3.16 AS runner
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
RUN apk add --no-cache wget
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV DATABASE_URL="mysql://root:MyRoot@2024@127.0.0.1:3306/library-data"
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

# === v2.3 新增：预装 AI skill 库（从 skills stage 拉取）===
# 1) OpenSpec CLI：不在镜像内安装（应用不需要；openspec 1.7 依赖 ES2025 需 Node 22）
#    开发者如需在容器内用，可手动执行：
#      apk add --no-cache git && npm install -g @fission-ai/openspec@1.6.0 --omit=dev
# 2) frontend-design skill
COPY --from=skills /skills/frontend-design /root/.agents/skills/frontend-design

# 3) Superpowers plugin（14 skills）
COPY --from=skills /skills/superpowers /root/.config/opencode/packages/superpowers@git+https:/github.com/obra/superpowers.git/node_modules/superpowers/skills

# ==============================================

RUN mkdir -p /app/data && chown -R library:nodejs /app/data

USER library

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/login || exit 1

CMD ["sh", "-c", "echo '=== Running db push ===' && node node_modules/.pnpm/prisma@5.22.0/node_modules/prisma/build/index.js db push --skip-generate --accept-data-loss && echo '=== Running seed ===' && node node_modules/.pnpm/tsx@4.23.1/node_modules/tsx/dist/cli.mjs prisma/seed.ts && echo '=== Starting server ===' && exec node server.js"]