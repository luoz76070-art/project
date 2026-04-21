#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
用法:
  scripts/install_monorepo_workflow.sh <monorepo_root> [project_dir]

说明:
  - 把 monorepo 版 GitHub Actions 工作流安装到 <monorepo_root>/.github/workflows/
  - 默认项目子目录名为 hermes-deploy

示例:
  scripts/install_monorepo_workflow.sh /path/to/project
  scripts/install_monorepo_workflow.sh /path/to/project hermes-deploy
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SOURCE_WORKFLOW="${PROJECT_ROOT}/deploy/github-actions/deploy.yml.example"

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  usage
  exit 1
fi

MONOREPO_ROOT="$1"
PROJECT_DIR="${2:-hermes-deploy}"
TARGET_DIR="${MONOREPO_ROOT}/.github/workflows"
TARGET_FILE="${TARGET_DIR}/deploy-hugo-to-nginx.yml"
EXPECTED_PROJECT_PATH="${MONOREPO_ROOT}/${PROJECT_DIR}"

if [ ! -d "${MONOREPO_ROOT}" ]; then
  echo "未找到 monorepo 根目录: ${MONOREPO_ROOT}"
  exit 1
fi

if [ ! -d "${EXPECTED_PROJECT_PATH}" ]; then
  echo "未找到项目子目录: ${EXPECTED_PROJECT_PATH}"
  echo "请确认 monorepo 中的实际子目录名，再重新执行。"
  exit 1
fi

if [ ! -f "${EXPECTED_PROJECT_PATH}/scripts/build.sh" ]; then
  echo "目标子目录里未找到 scripts/build.sh: ${EXPECTED_PROJECT_PATH}"
  exit 1
fi

mkdir -p "${TARGET_DIR}"

if [ "${PROJECT_DIR}" = "hermes-deploy" ]; then
  cp "${SOURCE_WORKFLOW}" "${TARGET_FILE}"
else
  sed "s#hermes-deploy#${PROJECT_DIR}#g" "${SOURCE_WORKFLOW}" > "${TARGET_FILE}"
fi

echo "已安装工作流:"
echo "  ${TARGET_FILE}"
echo
echo "后续请在 GitHub 仓库中确认以下配置："
echo "  - Secret: BLOG_DEPLOY_SSH_KEY"
echo "  - Variables: BLOG_DEPLOY_HOST / BLOG_DEPLOY_PATH / BLOG_DEPLOY_USER / BLOG_DEPLOY_PORT / BLOG_RELEASES_TO_KEEP"
