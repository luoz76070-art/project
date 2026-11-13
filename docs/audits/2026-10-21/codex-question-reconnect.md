# Codex 手机提问重连保护（2026-10-21）

## 问题与修改

手机已实现独立问答卡片，但生产1.2.2不含这项功能。检查候选源码时发现，已提交原题的状态只保存在当前订阅中；IPC断开、patch缺口或离开后重新进入会话会生成新的pending令牌，使未知结果可被重复提交。

DesktopControl现在按线程和完整原题SHA-256签名保留最多128项未确认记录，提交前同步预留。失联后同一道原题仍为uncertain，旧令牌失效；权威状态移除原题或改变内容才释放记录。记录不保存答案，不提供跨进程重启去重。

## 验证

- 修改前新增的4个断线/重订阅/patch缺口/内容变化回归均复现pending与uncertain不符。
- 修复后问答27/27（新增6项）通过，另覆盖异步题的canonical acceptance与128项容量边界。
- 合并后端207/207通过；两端typecheck、Relay构建与独立插件构建通过。
- 证据：`output/audit/2026-10-21/codex-question-reconnect-regression.tap`。
- 仅重建插件ZIP，候选APK/HTML未变；交付manifest、SHA256SUMS及候选说明已更新。

## 真实只读核验

本节是修复大快照限制前的观测；后续已定位并修复，最新真实只读成功证据见[大快照接收记录](codex-large-snapshot.md)。真实问答提交仍待验收。

本次在当前原会话执行初始化、owner discovery及following订阅/释放，没有调用发送、应答、中断或审批方法。服务返回owner，但8秒观察中未收到选定会话快照，随后一次2秒契约诊断同样未见stream state事件。订阅和连接均已清理。该结果不能证明IPC版本变化，也不能证明问答可用；此前成功快照仅是历史证据。

宿主实际进程位于ChatGPT.app；读取其安装元数据为26.1013.40934/build20770，捆绑CLI为0.163.0-alpha.10.2，PATH Codex仍须单独区分。

证据分别为`codex-question-readonly-current.json`、`codex-question-readonly-contract.json`与`codex-host-current.json`，均位于上述output/audit目录；仅保存计数和结构摘要，无正文/会话ID/ownerID/答案/凭证。

## 后续顺序

1. 定位当前宿主following订阅未下发快照的原因，先恢复可靠的原会话读取。
2. 验收手机可见题目、选择/文字回答、原会话继续、电脑先答、取消与断线恢复。
3. 验收插件安装/单网关迁移、多Agent宿主兼容，再统一验证Android覆盖升级、在线更新和公网/前后台/切网。

以上源码和隔离测试不能代替真实控制验收。生产仍1.2.2/code18，未安装、部署、发布或修改Mac权限，长期测试仍暂缓。当前使用聊天正文编号和文字回复作为手机可操作的临时方式。
