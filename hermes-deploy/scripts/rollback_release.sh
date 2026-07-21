#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
用法:
  scripts/rollback_release.sh <server_host> <site_root> [user] [--release <release_id>] [--port <ssh_port>]

说明:
  - 默认回滚到上一个可用发布版本
  - 也可以用 --release 指定某个 release_id

示例:
  scripts/rollback_release.sh 8.153.100.129 /var/www/blog root
  scripts/rollback_release.sh 8.153.100.129 /var/www/blog deploy --release 20260417093015
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "缺少依赖命令: $1"
    exit 1
  fi
}

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

TARGET_RELEASE=""
SSH_PORT=22

while [ "$#" -gt 0 ]; do
  case "$1" in
    --release)
      if [ "$#" -lt 2 ]; then
        echo "--release 需要一个 release_id"
        exit 1
      fi
      TARGET_RELEASE="$2"
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

SSH_TARGET="${SERVER_USER}@${SERVER_HOST}"

ssh -p "${SSH_PORT}" "${SSH_TARGET}" "bash -s" -- "${SITE_ROOT}" "${TARGET_RELEASE}" <<'REMOTE_ROLLBACK'
set -euo pipefail

site_root="$1"
target_release="${2:-}"
releases_dir="${site_root}/releases"
current_link="${site_root}/current"

if [ ! -d "${releases_dir}" ]; then
  echo "未找到发布目录: ${releases_dir}"
  exit 1
fi

if [ -n "${target_release}" ]; then
  target_dir="${releases_dir}/${target_release}"
  if [ ! -d "${target_dir}" ]; then
    echo "未找到指定版本: ${target_dir}"
    exit 1
  fi
else
  current_target="$(readlink -f "${current_link}")"
  mapfile -t releases < <(find "${releases_dir}" -mindepth 1 -maxdepth 1 -type d | sort)
  target_dir=""
  for (( idx=${#releases[@]}-1; idx>=0; idx-- )); do
    candidate="${releases[idx]}"
    if [ "${candidate}" != "${current_target}" ]; then
      target_dir="${candidate}"
      break
    fi
  done

  if [ -z "${target_dir}" ]; then
    echo "没有可回滚的旧版本"
    exit 1
  fi
fi

tmp_link="${site_root}/.rollback-$(basename "${target_dir}")"
rm -f "${tmp_link}"
ln -s "${target_dir}" "${tmp_link}"
mv -Tf "${tmp_link}" "${current_link}"

echo "已回滚到版本: $(basename "${target_dir}")"
echo "线上目录: ${current_link} -> ${target_dir}"
REMOTE_ROLLBACK
