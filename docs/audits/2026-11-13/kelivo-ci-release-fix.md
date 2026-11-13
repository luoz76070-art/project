# Kelivo Android CI 与预览发布修复

日期：2026-11-13（Asia/Shanghai）

## 目标

修复 GitHub-hosted Ubuntu runner 上 Kelivo Android 预览构建的阻塞问题，并完成 `mobicodex-kelivo-v0.1.8-native-preview` 的远程构建、产物上传和 Release 资产核对。

## 根因与修复

上一轮 Run `43248198447` 在 Flutter 插件的 `releaseUnitTestRuntimeClasspath` 上失败：Jetifier 读取 `org.bouncycastle:bcprov-jdk18on:1.85`，无法处理其中的 Java 25 class file（major 69）。

在 `apps/kelivo/android/build.gradle.kts` 的公共依赖解析策略中，将 `bcprov-jdk18on` 固定为 `1.78.1`，避免 Jetifier 处理 1.85 的多版本 class。该修复只影响构建依赖，不读取真实会话、token、Desktop IPC 或真实设备。

第一次复跑证明依赖修复有效：Gradle `BUILD SUCCESSFUL`，Kelivo lint 为 `Error=0 / Fatal=0 / Warning=66`，远控模块 lint 为 `Error=0 / Fatal=0 / Warning=1`。随后发现发布工作流仍从 `apps/kelivo/build/app/outputs/apk/release` 查找 APK，而 `verify-kelivo.mjs --preview` 的正式输出是 `output/kelivo/`。在 `.github/workflows/release-kelivo.yml` 中改为从 `output/kelivo/*.apk` 收集产物。

## 远程验证

最终 Run `43270398301` 使用提交 `da16f4331bd2355552a2c9eb63a5f599c0d2cbc1`，结果为 success，耗时约 54 分钟：

- Flutter analysis：通过，`No issues found!`。
- Kelivo Flutter UI 测试：Ubuntu report-only 阶段完成。
- markstream 测试：全部通过。
- Android lint、原生单元测试和 arm64 预览构建：通过。
- Android 构建日志：`BUILD SUCCESSFUL in 19m 8s`。
- 签名预览 APK：`output/kelivo/mobile-codex-kelivo-0.1.8-preview-arm64.apk` 已验证。
- CI artifact：`mobicodex-kelivo-10-ci` 已下载并核对。
- CI 独立验证 APK SHA256：`055de1f787787e7418c79a2bf49a03de4de358ed4224094107f147c37750844f`。

## GitHub Release 核对

现有 tag 没有移动或覆盖，Release 仍为 prerelease：

`mobicodex-kelivo-v0.1.8-native-preview`

Release 的六份资产均存在：APK、APK 元数据、源码归档、README、SHA256SUMS、source-package.json。正式预览 APK SHA256 为 `55cd1ba56009fde374f2964c560a6f6a0224aba8e0555c79096b3583f7b3c049`，与 Release 内的 `SHA256SUMS` 和 GitHub asset digest 一致。

本轮只修复构建与发布链路，没有修改产品代码或 APK 功能，因此正式预览 APK 保持原 SHA 是预期结果；最新 CI/工作流修复已在 `main` 的 `62b3fd2`、`da16f43` 提交中。

## 本机检查与边界

- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm build`：通过。
- `pnpm test:verification`：8/8 通过。
- `node --test scripts/test-release-publication.mjs`：6/6 通过。
- 本机没有 Java Runtime，未在 macOS 本地启动 Gradle；Android 结果以 Ubuntu runner 的完整日志和 artifact 为准。
- Ubuntu 上游 Flutter UI 差异仍按 report-only 记录，不作为 Android 发布阻塞。
- 用户既有的 `hermes-deploy` 修改、未跟踪的推广/文档/插件目录均未纳入本轮提交。
