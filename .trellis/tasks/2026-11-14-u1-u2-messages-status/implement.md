# 实施与验证

1. U1：分组、元信息与长按复制、图标横幅、品牌气泡与间距；跑渲染测试，提交。
2. U2：共享状态栏和停止操作；删除两入口重复运行提示；保留上轮结果规则；增加动效和回归。
3. 运行 corepack pnpm test:mobile、corepack pnpm typecheck、corepack pnpm lint；检查差异与未推送范围；提交 U2，推送并开 PR。

## 验证结果（2026-11-14）

- corepack pnpm test:mobile：359/359 通过，其中真实组件渲染与交互回归 71/71；新增助手身份分组、默认不显示元信息、长按成功/失败/取消/卸载、唯一状态栏/停止按钮、上轮结果去重、动效令牌断言。
- corepack pnpm typecheck：Relay 与 mobile 均通过。
- corepack pnpm lint：通过，无警告。
- corepack pnpm --filter @mobile-codex/mobile build：通过。
- lgit diff --check：通过。未改工作流、协议、状态推断模型或缓存。
- 按任务要求未打开浏览器；浅深色视觉、触摸手势与原生剪贴板效果交由 Claude 合成页/真机验收，隔离 hook 测试不代表原生验证。
