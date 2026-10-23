# Codex 长会话快照接收修复（2026-10-21）

## 根因

前一轮“owner可发现但没有快照”的观测来自网关主动断链：真实Desktop已发送38,411,290字节快照，而DesktopIpcClient的单帧上限为16MiB。超限发生在解码和stream事件分发之前，因此只查看事件会误以为宿主没有下发状态。

通过Electron资源检查技能，只读提取本机ChatGPT.app的app.asar到`output/research/2026-10-21/ChatGPT-electron-extract-current/`。随包主源仍声明snapshot v11、following v1；没有改版本或owner路由，也没有修改已安装应用或提交提取代码。

## 修改与边界

DesktopIpcClient独立接收4字节长度头，校验后一次分配正文缓冲并按偏移填充。上限64MiB覆盖本次长会话，低于宿主256MiB上限；零长/超限头仍拒绝，非法JSON断链，断开和重连释放未完成帧。不增加依赖、配置项或后台任务，不扩大写入权限。

64MiB只是原始单帧接收预算，不是进程内存总上限；解析后的对象和缓存另计，超过预算仍会拒绝。手机仍接收已有的有界消息投影，不传原始工具/会话快照。

## 验证

- 修复前，合成17MiB长帧复现`desktop-ipc-frame-limit`。
- 修复后性能9/9、合并后端210/210、两端类型检查、Relay构建和独立插件构建通过。
- 合成长帧17,825,895字节，统计复制量同为17,825,895字节；避免按分块反复复制整个累计缓冲。另覆盖分片头、跨UTF-8边界、连续帧、64MiB超限头、坏JSON和未完成帧断开后重连。
- 隔离证据：`output/audit/2026-10-21/codex-large-frame-regression.tap`。

真实只读单独核验成功：当前原会话v11快照、120条消息、状态inProgress，约620ms取得；手机投影707,429字节。只执行一次初始化、一次owner discovery以及following订阅/释放，submittedMessages=0、controlWrites=0，连接已关闭。该会话没有待答题，故不能据此宣布真实提问提交、两端先答或审批已通过。

诊断与复核证据分别为`codex-stream-disconnect-reason.json`、`codex-stream-frame-size.json`和`codex-large-frame-readonly-verified.json`，位于上述audit目录；仅保存大小/计数/结构，无正文、会话ID、ownerID或凭证。

## 交付与后续

仅重建受影响的插件ZIP，更新候选manifest/SHA256SUMS及交付说明。APK/HTML源码未变，保持原hash。生产仍1.2.2/code18，没有安装插件、部署、发布、发真实任务/答案/审批或修改Mac权限，长期连接测试暂缓。

接下来准备并验收手机原请求问答、电脑先答、取消与断线恢复，再进行插件迁移、兼容宿主及Android公网统一验收。继续用聊天正文编号承载当前需要用户选择的事项。
