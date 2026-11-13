# MobiCodex 仓库边界迁移记录

日期：2026-11-13

## 结果

`/Users/rorance/workspace/project` 的 Git 工作树已按 MobiCodex 根项目整理。原 `codex-to-phone` 中的源码、Trellis 规则、插件、集成、生成协议、脚本、文档和发布资料已提升到仓库根目录；`apps/kelivo`、`apps/mobile`、`apps/relay` 的职责和产品协议保持不变。

根目录保留的相关用户内容包括 `docs/`、`plugins/` 和 `codex-to-phone-promo/`。旧 `codex-to-phone/` 目录只保留未跟踪的本地构建输出、上传文件、Flutter/Android 临时目录和个人设备状态，未纳入 Git，也未修改其内容；根 ESLint 明确忽略该残留目录。

## 其他项目归档

以下目录已从 Git 工作树移动到仓库外：

- `Windsurf-api`
- `auto-zhaoping`
- `hermes-deploy`
- `image-studio`
- `library-manage`
- `library-manage-broken`
- `sub2api-v1`

归档位置：`/Users/rorance/workspace/project-archive/20261113-mobicodex-repo-boundary/moved-projects/`。根仓库原 `README.md`、`SECURITY.md` 和 Hermes 的 `deploy-hugo-to-nginx.yml` 分别保存在同一归档下的 `root-files-before-mobicodex/` 与 `moved-root-workflows/`。完整 Git bundle、迁移前工作树和清单也在该归档目录中。

## CI 与文档

- `.github/workflows/ci.yml` 现在从仓库根目录运行，并保留 lint、typecheck、build、`test:verification`、`test:messages`、Android debug APK 和 lint。
- 重复的 `codex-to-phone-ci.yml` 已移入外部归档；其独有的 `test:messages` 已并入普通 CI。
- `release-android.yml`、`release-kelivo.yml` 的 working-directory、pnpm 缓存、Android/Kelivo 路径和 artifact 路径已改为根目录。
- Hermes 的部署 workflow 已移出 MobiCodex 根 `.github/workflows`，源码保留在外部归档。
- 根 README、贡献指南、AGENTS、项目布局、版本同步说明、Flutter 关于/文档入口已改为 MobiCodex 根路径。
- 历史审计和迁移记录中的旧路径保留，用于还原当时的 GitHub 地址和发布事实；仍需执行的发布重建说明已改用仓库根路径。

## 验证

通过：

- `corepack pnpm install --frozen-lockfile`
- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm build`
- `corepack pnpm test:messages`
- `corepack pnpm test:verification`
- `corepack pnpm verify`：422/422 Relay、169/169 mobile 及所有选定检查通过
- `corepack pnpm verify:android`：lint Error 0、Fatal 0、Warning 8
- Android `:app:assembleDebug`：成功生成 `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`
- `git diff --check`
- GitHub Actions YAML 结构和当前 workflow 路径检查

本轮没有读取真实 Codex 会话、真实 token、个人模型配置、Desktop IPC 或真实设备；Android 仅使用本机隔离 SDK/JDK 进行编译和 lint。

## 回退与交付边界

本轮未提交、未推送、未建分支、未创建 PR。恢复材料位于：

`/Users/rorance/workspace/project-archive/20261113-mobicodex-repo-boundary`

Git index 尚未更新，因此 `git status` 会把根目录提升显示为新增、旧路径显示为删除；后续提交前应先人工检查重命名范围和用户已有修改，再决定是否暂存。
