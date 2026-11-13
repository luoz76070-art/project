# MobiCodex 仓库边界后的发布与本地清理计划

日期：2026-11-13

## 当前证据

- `origin/main` 已与本地 `main` 同步到 `1388a0a`。
- MobiCodex Android 预览 APK 目前仍被 Git 跟踪：
  - `releases/android/kelivo-preview/0.1.5/mobile-codex-kelivo-0.1.5-preview-arm64.apk`
  - `releases/android/kelivo-preview/0.1.6/mobile-codex-kelivo-0.1.6-preview-arm64.apk`
  - `releases/android/kelivo-preview/0.1.7/mobile-codex-kelivo-0.1.7-preview-arm64.apk`
  - `releases/android/kelivo-preview/0.1.8/mobile-codex-kelivo-0.1.8-preview-arm64.apk`
- 每个 APK 约 58MB；GitHub 已提示超过 50MB 推荐阈值。
- `.github/workflows/release-kelivo.yml` 会校验仓库内 APK，然后再上传 GitHub Release。
- `docs/github-public-release-plan.md` 已规定源码仓库不应直接跟踪 APK、压缩包和签名文件。
- 迁移前旧工作树仍在本机：`/Users/rorance/workspace/project/codex-to-phone/`，约 3.8GB，其中约 3.7GB 是 `output/` 生成资料；它不是当前 Git 树的一部分。
- 其他项目的可恢复归档位于 `/Users/rorance/workspace/project-archive/20261113-mobicodex-repo-boundary/`，约 1GB，不能作为普通缓存清理。

## 推荐后续方案

### A. 发布物与源码分离

1. 保留当前 GitHub Release 和已发布下载地址，确保旧版本可回滚。
2. 修改 `release-kelivo.yml`：从源码构建 APK，在 runner 中生成 APK 元数据、SHA256 和源码归档，再上传 GitHub Release。
3. 先用一个新的 preview tag 完成一次端到端验证：构建、清单、Release asset、公开下载、SHA256 和 App 内更新地址。
4. 新流程稳定后，再从 Git 跟踪范围移除未来版本的 APK 与压缩包；历史版本是否清理单独决定，避免破坏旧链接。

### B. 本机旧工作树清理

只考虑明显可再生的内容：

- `codex-to-phone/output/`：执行输出、临时报告和渲染结果，约 3.7GB。
- `codex-to-phone/dist-apk/`：旧 APK 构建输出，约 108MB。
- `codex-to-phone/.playwright-cli/`：浏览器临时状态，约 212KB。

以下内容暂不处理：源码目录、`docs/`、`mobile-uploads/`、`releases/`、`.trellis/`、`plugins/` 和迁移归档。删除前需要逐项确认是否仍作为历史证据或用户资料保留。

### C. 当前未提交资料

`codex-to-phone-promo/`、`plugins/codex-live-session/`、移动会话文档、Blurt 优化计划和 Trellis 归档仍保留在本机工作区，没有混入已推送的仓库整理提交。后续应先按归属分组，再决定单独提交或继续作为本地工作资料。

## 验收条件

- 新 preview Release 能从干净 GitHub runner 构建，不读取个人配置、真实 token、真实会话或设备数据。
- GitHub Release 包含 APK、更新清单、SHA256 和必要的版本元数据。
- APK 公开下载地址、清单地址和 App 内更新地址一致。
- 旧版本回滚地址仍有效。
- 清理本地旧工作树后，当前根目录源码、发布资料和可恢复归档均可独立使用。
- 未执行 `git reset`、`git clean`、强制推送或不可恢复删除。

## 当前状态

方案 A 已在本地工作区完成第一版实现：Kelivo workflow 现在使用 runner 构建的 APK，现场生成源码包、元数据和 SHA256，再上传 GitHub Release；`verify-kelivo.mjs` 的预览版本与输出文件名也改为跟随 `pubspec.yaml`。本轮尚未在 GitHub-hosted runner 实际触发 workflow，也没有删除历史发布物、提交或推送。
