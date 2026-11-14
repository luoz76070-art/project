# Implementation and validation
1. Image parser + managed upload store, isolated fixtures.
2. Shared capture types, WorkItem binding/deletion and authenticated routes/SSE.
3. Online capture transaction/controller and panel, VoiceInput raw capture mode.
4. typecheck, build, lint, capture/workItems/deviceRevocation tests, test:mobile, test:voice; browser check if available.
Self-review: original/preview limits are distinct, source never client-controlled, deleted IDs cannot resurrect, persisted receipts reject changed bytes across restart; old APIs stay compatible. Native work is deferred W2b.

## 2026-11-14 验证结果
- corepack pnpm install --frozen-lockfile --prefer-offline --store-dir <repo>/.codex-lanes/pnpm-store：通过，未新增依赖或修改锁文件。
- corepack pnpm typecheck / corepack pnpm build / corepack pnpm lint：通过。
- node --test apps/relay/tests/workItems.test.mjs apps/relay/tests/deviceRevocation.test.mjs apps/relay/tests/capture.test.mjs：42/42。
- corepack pnpm test:mobile：348/348。
- corepack pnpm test:voice：139/139。
- node --test scripts/test-mobile-capture.mjs：13/13（同时已纳入 test:mobile）。
- lgit diff --check：通过；未改 Android、.github/workflows 或 npm 依赖。

浏览器打开隔离本地测试页被权限门拒绝，未绕过。窄屏/150%字号/真实 canvas 解码和原生语音联动未作真机/浏览器验收；组件处理器与 canvas 隔离测试不冒充视觉验收。临时本地服务已停止，临时测试入口已移除。
