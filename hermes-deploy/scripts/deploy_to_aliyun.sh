#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
用法:
  scripts/deploy_to_aliyun.sh <server_host> <site_root> [user] [--skip-build] [--keep <count>] [--port <ssh_port>]

说明:
  - 站点会发布到 <site_root>/releases/<release_id>
  - 当前线上版本由 <site_root>/current 符号链接指向
  - Nginx 的 root 应指向 <site_root>/current

示例:
  scripts/deploy_to_aliyun.sh 8.153.100.129 /var/www/blog root
  scripts/deploy_to_aliyun.sh 8.153.100.129 /var/www/blog deploy --keep 7 --port 22
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "缺少依赖命令: $1"
    exit 1
  fi
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

if [ "$#" -lt 2 ]; then
  usage
  exit 1
fi

SERVER_HOST="$1"
SITE_ROOT="$2"
shift 2

SERVER_USER="root"
if [ "$#" -gt 0 ] && [[ "$1" != --* ]]; then
  SERVER_USER="$1"
  shift
fi

SKIP_BUILD=0
RELEASES_TO_KEEP=5
SSH_PORT=22

while [ "$#" -gt 0 ]; do
  case "$1" in
    --skip-build)
      SKIP_BUILD=1
      ;;
    --keep)
      if [ "$#" -lt 2 ]; then
        echo "--keep 需要一个数字参数"
        exit 1
      fi
      RELEASES_TO_KEEP="$2"
      shift
      ;;
    --port)
      if [ "$#" -lt 2 ]; then
        echo "--port 需要一个端口参数"
        exit 1
      fi
      SSH_PORT="$2"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数: $1"
      usage
      exit 1
      ;;
  esac
  shift
done

require_cmd ssh
require_cmd rsync

if [ "${SKIP_BUILD}" -eq 0 ]; then
  "${SCRIPT_DIR}/build.sh"
fi

if [ ! -d "${PROJECT_ROOT}/public" ]; then
  echo "未找到 public/，请先执行构建。"
  exit 1
fi

RELEASE_ID="$(date -u +%Y%m%d%H%M%S)"
SSH_TARGET="${SERVER_USER}@${SERVER_HOST}"
REMOTE_RELEASE_DIR="${SITE_ROOT}/releases/${RELEASE_ID}"

echo "准备创建远程发布目录: ${REMOTE_RELEASE_DIR}"
ssh -p "${SSH_PORT}" "${SSH_TARGET}" "bash -s" -- "${SITE_ROOT}" "${RELEASE_ID}" <<'REMOTE_PREPARE'
set -euo pipefail
site_root="$1"
release_id="$2"
mkdir -p "${site_root}/releases/${release_id}"
REMOTE_PREPARE

echo "开始同步 public/ 到远程发布目录"
rsync -az --delete -e "ssh -p ${SSH_PORT}" "${PROJECT_ROOT}/public/" "${SSH_TARGET}:${REMOTE_RELEASE_DIR}/"

echo "切换 current 链接并清理旧版本"
ssh -p "${SSH_PORT}" "${SSH_TARGET}" "bash -s" -- "${SITE_ROOT}" "${RELEASE_ID}" "${RELEASES_TO_KEEP}" <<'REMOTE_ACTIVATE'
set -euo pipefail

site_root="$1"
release_id="$2"
releases_to_keep="$3"
releases_dir="${site_root}/releases"
release_dir="${releases_dir}/${release_id}"
current_link="${site_root}/current"
tmp_link="${site_root}/.current-${release_id}"

rm -f "${tmp_link}"
ln -s "${release_dir}" "${tmp_link}"
mv -Tf "${tmp_link}" "${current_link}"

mapfile -t releases < <(find "${releases_dir}" -mindepth 1 -maxdepth 1 -type d | sort)
if [ "${#releases[@]}" -gt "${releases_to_keep}" ]; then
  current_target="$(readlink -f "${current_link}")"
  delete_count=$((${#releases[@]} - releases_to_keep))
  for stale_release in "${releases[@]:0:delete_count}"; do
    if [ "${stale_release}" = "${current_target}" ]; then
      continue
    fi
    rm -rf "${stale_release}"
  done
fi

echo "当前线上版本: ${release_id}"
echo "线上目录: ${current_link} -> ${release_dir}"
REMOTE_ACTIVATE

echo "发布完成: ${SSH_TARGET}:${SITE_ROOT}/current"
