# S2 验证记录（2026-11-14）

| 检查 | 结果 |
| --- | --- |
| `corepack pnpm install --frozen-lockfile --prefer-offline --store-dir /Users/rorance/workspace/project/.codex-lanes/pnpm-store` | 成功；296 包从现有 store 复用，锁文件未修改 |
| `corepack pnpm typecheck` | Relay/mobile 均通过 |
| `corepack pnpm build` | Relay TypeScript 与 mobile Vite 均通过 |
| `corepack pnpm test:mobile` | 226/226，含 5×7 七态展示矩阵、纯推导、真实通道归一化、同步失效与 DeepSeek 失败提示 |
| `corepack pnpm lint` | 通过，0 warnings |
| `node --test apps/relay/tests/{correctness,desktopNativeControl,desktopApprovals,userInput,claude,deepSeek,openCode}.test.mjs` | 292/292 |
| `corepack pnpm test:voice` | 41/41 |
| `lgit diff --check` | 通过 |

Relay 回归覆盖：kind/turnId/observedAt 白名单与长度限制、私有载荷不泄露、单条覆盖、换轮与终态清除、断开不结算、迟到事件不复活、原有 full/incremental SSE 元数据更新、Claude 原协议映射、DeepSeek 插件到 Relay 的真实隔离链路、OpenCode 缺起点不猜。

自审修正：避免证据 ID 投影改变 S1 对缺 ID 终态的处理；手机端保留同步代次检查；未知状态不当作 idle 成功；OpenCode 部分历史没有轮次起点时返回 null；活动展示不改变发送/审批/停止能力。

浏览器视觉检查未完成：浏览器权限检查拒绝访问本地合成页，未绕过。已运行 React 组件渲染测试，但不将它等同于浏览器或 Android 真机验收；未接触真实会话、未发送模型请求、未部署或改工作流。

已知边界：旧服务没有 activityEvidence 时只显示有证据的交互/结果；三个 Agent 的准备阶段及 Claude 未报告的失败保持未知；Desktop native item 缺明确运行标记、OpenCode 缺已知轮次起点时不推测活动。U2 再合并状态栏、停止按钮并移除重复过程胶囊。
