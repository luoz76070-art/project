#!/usr/bin/env bash
# ============================================================================
# Library Manage — One-command Docker setup script
# 用法: bash scripts/docker-setup.sh
# 适合：AI Agent 自动调用、用户一键部署
# ============================================================================
set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${CYAN}[setup]${NC} $*"; }
ok() { echo -e "${GREEN}[ok]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC} $*"; }
err() { echo -e "${RED}[err]${NC} $*"; }

# ---- 1. 前置检查 ----
log "检查 Docker 与 docker compose..."
if ! command -v docker >/dev/null 2>&1; then
  err "未检测到 docker。请先安装 Docker Engine: https://docs.docker.com/engine/install/"
  exit 1
fi
ok "Docker: $(docker --version)"

if ! docker compose version >/dev/null 2>&1; then
  err "未检测到 docker compose v2。请升级 Docker 或安装 compose 插件。"
  exit 1
fi
ok "docker compose: $(docker compose version --short)"

# ---- 2. 准备 .env 文件 ----
if [ ! -f .env ]; then
  log "创建 .env 文件（从模板）..."
  cp .env.example .env
  warn "请编辑 .env，至少修改 NEXTAUTH_SECRET / AUTH_SECRET 为随机字符串。"
  warn "生成命令: openssl rand -base64 32"
else
  ok ".env 已存在，跳过"
fi

# ---- 3. 构建并启动 ----
log "构建镜像（首次约 1-3 分钟）..."
docker compose build --no-cache

log "启动服务..."
docker compose up -d

# ---- 4. 等待健康检查 ----
log "等待服务就绪..."
for i in $(seq 1 30); do
  sleep 2
  if docker compose ps library-manage 2>/dev/null | grep -q "(healthy)"; then
    ok "服务已健康"
    break
  fi
  if [ $i -eq 30 ]; then
    warn "健康检查超时，但服务可能仍在启动。查看日志: docker compose logs library-manage"
  fi
done

# ---- 5. 输出信息 ----
PORT=$(grep -E "^PORT=" .env 2>/dev/null | cut -d= -f2 | tr -d '"' || echo "3000")

echo ""
echo "==============================================="
ok "部署完成 🎉"
echo "==============================================="
echo ""
echo "🌐 本地访问:    http://localhost:${PORT:-3000}/login"
echo ""
echo "👤 演示账号:"
echo "   - 管理员:  admin / admin1234"
echo "   - 学生:    student1 ~ student5 / pass1234"
echo ""
echo "📋 常用命令:"
echo "   docker compose ps                 # 查看服务状态"
echo "   docker compose logs -f             # 查看日志"
echo "   docker compose restart library-manage  # 重启"
echo "   docker compose down                # 停止并删除容器"
echo "   docker compose down -v             # ⚠️ 同时删除数据卷"
echo ""
echo "🔄 修改源码后重新部署:"
echo "   docker compose up -d --build"
echo ""
echo "🌍 想暴露公网？取消 docker-compose.yml 中 cloudflared 服务的注释，再:"
echo "   docker compose up -d cloudflared"
echo "   docker compose logs -f cloudflared  # 查看分配的 trycloudflare URL"
echo "==============================================="