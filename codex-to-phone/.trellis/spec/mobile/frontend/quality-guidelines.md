# 前端验证与轻量约束

`corepack pnpm --filter @mobile-codex/mobile typecheck`、`corepack pnpm --filter @mobile-codex/mobile build`、`corepack pnpm test:messages`。结构迁移后比较原函数体与构建 gzip；不改变视觉要求来掩盖行为回归。

UI 以 Codex 手机版为参考；先收集可核验的版本/日期与真实画面，再逐页对照。复用 React/CSS、图标，避免重型依赖、大面积模糊和持续动画。

视觉验收覆盖 360/390/430 CSS px、浅深主题、键盘、安全区、字体缩放、流式消息、上拉历史与连接恢复。浏览器不能替代 Android 键盘和前后台真机验收。

新增状态回归运行 `corepack pnpm test:mobile`；发布片段隔离检查用 `node --test scripts/test-release-publication.mjs`，不得连接 SSH。UI 合成服务 `node scripts/serve-ui-fixture.mjs` 只加载构建资源和假会话；支持 API 503、断流、推送、145 条分页和 150% 字号检查。不得替换为真实会话后自动发送。

标题 flex 子容器须 `min-width: 0`，大字号时顶栏允许增长；省略标题不能覆盖操作按钮。代码块独立横向滚动，Markdown 不执行原始 HTML。新界面源码完成不等于真机验收，记录见 `docs/audits/2026-10-20/delivery.md`。

具名 APK 交付必须经 `scripts/build-debug-apk-mac.sh` 的双更新源校验；个人地址存于被 Git 忽略的 `apps/mobile/.env.production.local`，避免依赖会话临时 export。`mac-local` 才允许双通道都空；单通道遗漏必须失败。交付时检查 APK 内实际地址、资源与最终 dist 一致、版本递增和旧包签名一致；热更新原生版本范围必须匹配 bundle 的 `appVersionCode`。线上发布与隔离测试分别记录，不能把本地构建成功写成手机已可下载。
