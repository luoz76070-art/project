# 实施与检查

1. 共享证据类型及 Codex 投影；隔离测试验证白名单、上限、跨轮清除。
2. Agent 适配器和 DeepSeek bridge；保留协议兼容和未知状态。
3. 手机纯模型、统一组件、既有挂点；35 格和同步/渲染回归。
4. corepack pnpm typecheck；corepack pnpm build；corepack pnpm test:mobile；corepack pnpm lint。
5. node --test apps/relay/tests/{correctness,desktopNativeControl,desktopApprovals,userInput,claude,deepSeek,openCode}.test.mjs；corepack pnpm test:voice。
6. 自审变更、分模块 conventional commits；通过后推送 codex/s2-session-status，向 main 开 PR。浏览器/Android 实测独立记录，不以隔离渲染代替。
