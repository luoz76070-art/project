# Journal - rorance (Part 1)

> AI development session journal
> Started: 2026-10-20

---



## Session 1: Trellis 工程布局与首批流传输优化
<!-- trellis-session: v=2 fp=a0c064d16d41033b -->

**Date**: 2026-10-20
**Task**: Trellis 工程布局与首批流传输优化
**Package**: mobile
**Branch**: `main`

### Summary

完成模块布局和 A1 传输；14 项隔离回归通过。完整记录 docs/audits/2026-10-20/execution.md；下一批 A2 手机订阅恢复、档案隔离与数据正确性。未提交或部署。

### Git Commits

(No commits - planning session)

### Status

[OK] **Completed**


## Session 2: A2–D 优化源码收尾与 APK16 交付
<!-- trellis-session: v=2 fp=d990b761fb4d718e -->

**Date**: 2026-10-20
**Task**: A2–D 优化源码收尾与 APK16 交付
**Package**: mobile
**Branch**: `main`

### Summary

完成正确性、热索引/增量/缓存、配对/监督/安全和手机版 UI；54 项隔离回归、消息/Java、类型检查及原生构建通过。交付 APK16，真实平台统一验收待办。

### Main Changes

- 证据、统一实测步骤和限制记录在 docs/audits/2026-10-20/delivery.md；同步前后端 Trellis 规范。

### Git Commits

(No commits - planning session)

### Testing

- [OK] 后端39、客户端/发布15、消息与Java热更新路径、浏览器合成验收、完整APK和Swift构建。

### Status

[OK] **Completed**

### Next Steps

- 用户统一实测真实发送、Android键盘/网络切换、Mac唤醒与长期运行；保持父任务未完成。


## Session 3: 公网连接修复：TLS续期与Broker/Mac切换
<!-- trellis-session: v=2 fp=a526244f7eae9238 -->

**Date**: 2026-10-20
**Task**: 公网连接修复：TLS续期与Broker/Mac切换
**Package**: relay
**Branch**: `main`

### Summary

用户明确授权后，完成有效证书、续期、Broker独立发布与新版Mac运行切换，电脑侧公网鉴权通过；手机重试待验收。

### Main Changes

- 保留原凭证与回退目录；记录 connection-repair.md 并新增公网维护 runbook。

### Git Commits

(No commits - planning session)

### Testing

- [OK] 严格TLS、目标证书续期dry-run与hook、服务器合成JSON/SSE、正式公网200/401与Android预检204、Mac reachable 均通过。

### Status

[OK] **Completed**

### Next Steps

- 用户用完整Remote Endpoint和原Token在手机重试；真实发送/网络切换/唤醒与长期测试保留待办。


## Session 4: 恢复手机更新通道与 APK18 发布
<!-- trellis-session: v=2 fp=825c1e6534abc497 -->

**Date**: 2026-10-20
**Task**: 恢复手机更新通道与 APK18 发布
**Package**: mobile
**Branch**: `main`

### Summary

修复 APK16/17 构建遗漏双更新源，持久本地生产配置并增加交付构建校验。APK18 和仅原生18兼容的热更新已通过原静态通道发布；手机覆盖安装待验收。

### Main Changes

- 复用原子发布脚本，保留 APK15 清单与资源；更新恢复记录、README、在线更新文档、前端规范和当前任务。

### Git Commits

(No commits - planning session)

### Testing

- [OK] 更新与发布4/4、客户端16/16、消息回归、typecheck、完整APK构建、旧生产签名、包内资源、公网SHA/大小/HTTPS/CORS和390px浏览器更新检查通过。

### Status

[OK] **Completed**

### Next Steps

- 手机浏览器覆盖安装APK18一次，检查连接数据、工作状态和App内后续更新；原生热更新切换/回退及统一真机验收保持待办。


## Session 5: 输入权限责任归属与长期连接机制核对
<!-- trellis-session: v=2 fp=0528c4ff04c73347 -->

**Date**: 2026-10-20
**Task**: 输入权限责任归属与长期连接机制核对
**Package**: relay
**Branch**: `main`

### Summary

核对手机权限报错与当前运行路径，TCC 记录真实手机请求责任归属为 Relay。修正文档只要求授权 Input 的遗漏；本地/公网鉴权正常，真实手机输入待用户重新授权当前 Relay 后验收。用户明确暂不开长期测试。

### Main Changes

- 复用公网维护 runbook，补权限责任归属、旧副本授权排查与长期连接边界；未更改运行代码、签名或系统授权。

### Git Commits

(No commits - planning session)

### Testing

- [OK] 11项心跳、恢复、后台暂停、鉴权停止与禁止重放隔离回归通过；只读连接200。工具启动的空文本权限检查归属不同，不能作为生产 Relay 权限结论。

### Status

[OK] **Completed**

### Next Steps

- 用户重新添加当前工程 Relay 并手动验证手机发送；2/24小时与移动网络睡眠恢复保持未执行。
