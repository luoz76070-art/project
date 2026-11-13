# 实施与验证
1. Relay 撤销顺序、鉴权复核、初始化 SSE 收尾；新增真实 HTTP 隔离测试覆盖所有流、慢清理、迟到响应、owner 隔离。
2. Mobile 共享失效门、订阅与自动轮询接线，新增生产函数回归；自审凭证隔离/竞态/清理。
3. corepack pnpm typecheck；corepack pnpm build；corepack pnpm lint；相关 Relay node --test；corepack pnpm test:mobile。
4. 检查 diff，只提交 D2；英文 conventional commit，推功能分支，中文 PR 至 main。真机/真实引擎不在隔离验收范围。

## 最终结果（2026-11-14）
- 安装：指定 frozen-lockfile/prefer-offline/store-dir 命令退出 0。
- `corepack pnpm typecheck`、`corepack pnpm build`、`corepack pnpm lint` 均退出 0。
- `node --test --test-concurrency=2 apps/relay/tests/{deviceRevocation,availability,transport,openCode,claude,deepSeek,voice,desktopMessageQueue,threadImages}.test.mjs`：211/211 通过，其中 D2 新增 7 项。
- `corepack pnpm test:mobile`：316/316 通过；覆盖同凭证 REST 401 联动多订阅、重挂载/前后台不重连、重复轮询不发 HTTP、不同 Broker 路径/新令牌隔离、Web/原生迟到响应丢弃、实际 App 轮询/SSE effect 停止。
- 自审核对：全部 SSE 入口均在现有 deviceStreams 内；撤销前已鉴权、等待解析/上游的请求仍复核；匿名 health/配对保留公开，但显式无效凭证返回 401。未改工作流、插件协议或无关文件。
- 边界：已发送给引擎的动作不自动撤回；已发头 SSE 通过断开失效，尚未发头的在途请求返回 401。磁盘写失败时当前进程保持封禁并返回错误，须重试成功才能保证重启后的撤销。未进行真实模型、真机或生产代理链路验收。
