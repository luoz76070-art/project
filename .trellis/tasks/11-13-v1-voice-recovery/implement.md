# 实施与验证
1. 后端缓存/幂等/查询/撤销及隔离测试。
2. 手机恢复状态机、最小持久化及原会话草稿保护；测试网络丢失/后台/进程重启。
3. 更新语音契约，自审；依次运行 corepack pnpm test:voice、corepack pnpm test:mobile、corepack pnpm typecheck。
4. 仅用 lgit 分1–3次 conventional commits，全部通过后推 codex/v1-voice-recovery；gh-codex 创建面向 main 的 PR。
回退：按本功能提交逆向回退；localStorage新键不影响旧草稿，旧网关查询不支持时禁止重传。

## 2026-11-13 验证结果
- corepack pnpm test:voice：41/41，通过；真实HTTP响应断开使用本地假供应商，ASR/refine均仅调用一次。
- corepack pnpm test:mobile：181/181，通过；初轮新增夹具错误使用非UUID DeepSeek会话ID，修正夹具后全通过。
- corepack pnpm typecheck：Relay/Mobile均通过。
- 语音改动定向ESLint：0错误/0警告；Mobile生产构建通过；lgit diff --check通过。
- 浏览器验收脚本 scripts/test-mobile-voice-browser.mjs 已编译启动，但浏览器工具自动审批拒绝本地页面访问；脚本等待超时后自行退出。浏览器/Android系统杀进程真机行为未验，未绕过限制；进程重建与localStorage恢复已用独立协调器及生产草稿适配器单测覆盖。
- 未调用真实模型、未读取真实会话、未部署；仅当前连接scope自动恢复，切换连接后才处理对应scope记录。Relay进程重启会丢失内存结果；手机超过创建后15分钟放弃恢复，供应商超时也无法凭空取得文字。共享admin凭证仍属于同一owner。
