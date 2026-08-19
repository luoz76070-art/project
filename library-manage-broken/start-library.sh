#!/bin/bash
set -e
echo "[start-library] 端口=${LM_PORT:-3000}, DB=${DB_HOST}/${DB_NAME}"
cd /work/src
which pnpm 2>/dev/null || { corepack enable; corepack prepare pnpm@9.15.0 --activate; }
pnpm install --frozen-lockfile || pnpm install
pnpm prisma generate
python3 - <<PYEOF
import pymysql
try:
    c=pymysql.connect(host='${DB_HOST}',port=3306,user='${DB_USER}',password='${DB_PASSWORD}')
    c.cursor().execute('CREATE DATABASE IF NOT EXISTS `${DB_NAME}` DEFAULT CHARSET utf8mb4')
    c.close()
    print('  DB OK')
except Exception as e:
    print(f'  DB skip: {e}')
PYEOF
export DATABASE_URL="mysql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:3306/${DB_NAME}"
export NEXTAUTH_SECRET AUTH_SECRET NEXTAUTH_URL AUTH_TRUST_HOST=true
export NODE_ENV=development PORT=${LM_PORT:-3000} HOSTNAME=0.0.0.0
export NEXT_TELEMETRY_DISABLED=1
nohup pnpm dev -- -H 0.0.0.0 -p ${LM_PORT:-3000} > /tmp/lm-dev.log 2>&1 &
LM_PID=$!
echo "[start-library] dev server PID=$LM_PID"
for i in $(seq 1 60); do
  if curl -sf http://localhost:${LM_PORT:-3000}/login >/dev/null 2>&1; then
    echo "[start-library] ✅ Ready on http://localhost:${LM_PORT:-3000}"
    break
  fi
  sleep 1
done
exec "$@"
