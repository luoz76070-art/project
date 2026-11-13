# Blurt × MobiCodex 优化任务清单

日期：2026-11-13　状态：待用户决定启动

依据：

- [Blurt 分析报告](2026-11-12-blurt-mobicodex-optimization.md)（Blurt 参考提交 `d4f257d`，MIT）
- <https://github.com/AGIHunt/blurt> 当前 README（MCP 工具、`To verify` 状态流、热词、30 天历史等）
- 本轮对当前源码的只读核对（下表）。未运行测试、未改源码、未调用模型。

## 0. 源码核对后对报告的修正

| 报告条目 | 当前源码实际情况 | 清单处理 |
| --- | --- | --- |
| 语音“原文/整理稿双轨、取消、防旧结果覆盖” | 已实现：`VoiceInput.tsx` 分别显示「识别原文」「整理后的提示词」，有「采用原文」「重新整理」；`requestId` + `/api/voice/cancel`；`mergeVoiceDraft` 在输入框变化时拒绝合并 | 不再列为任务；P0 语音改为结果恢复、失败保留录音、整理校验、热词 |
| 模型可用性分级（手机菜单） | 手机端没有模型菜单；Claude 菜单误导已于 2026-11-08 通过关闭 Model discovery 解决（`audits/2026-11-08/claude-model-options.md`） | 降为 P1 的 M1，范围需用户确认 |
| 新增 WorkItem 交接 | 已有 `ProductHandoff`（draft → uncertain → confirmed，先预留再发送，结果未知不重发），但 `submitProductHandoff` 被 `isDesktopSource` 限定为 Codex Desktop 会话，且 localStorage 单键只存一份草稿 | 在 ProductHandoff 之上扩展，不另起一套 |
| 统一执行状态 | `AgentSessionSnapshot` 只有 `status: idle/running` 和 `activity`，没有回合结果；失败/中断无法区分（参照 2026-10-30 DeepSeek 失败漏显） | 先补回合结果字段（S1） |
| 设备安全 | 配对码为 16 字符 base64url、5 分钟一次性、需手输；撤销已联动清 Agent token、语音、消息队列；Broker 转发明文 body（`transport/protocol.ts`） | 二维码配对与端到端加密是真实缺口 |

## 1. 任务清单

规模：S ≤ 1 天，M 2–3 天，L ≥ 1 周（单人估计，不含真机验收）。

### P0：低风险，先做

| ID | 任务 | 主要改动 | 验收 | 规模 |
| --- | --- | --- | --- | --- |
| V1 | 语音结果可恢复：Relay 按 `owner:requestId` 缓存转写/整理结果 15 分钟，新增 `GET /api/voice/result/:requestId`；手机在响应丢失或重连后先查结果。现状下 `seen` 只存时间戳，响应丢失后同 ID 重试得到 `voice_request_used`，换 ID 又要再付费一次 | `relay/src/voice/service.ts`、`server/voiceRoutes.ts`、`mobile/src/features/voice/api.ts`、`VoiceInput.tsx` | 隔离测试模拟响应丢失：重查取回同一文本，供应商调用次数为 1 | S |
| V2 | 转写失败时保留录音：面板关闭前保留本次 `dataBase64`，提供「重新转写」，不用重录 | `VoiceInput.tsx` | 模拟 ASR 502 后重转成功；关闭面板才释放录音 | S |
| V3 | 整理稿关键信息校验：refine 后做确定性比对，原文中的数字、版本号、路径/文件名、英文标识、否定与边界词（不要/只/暂不/先/禁止）在整理稿缺失时返回 `warnings`，手机提示并默认推荐原文。现状只靠 prompt 约束 | `voice/service.ts`、`voice/model.ts`、`VoiceInput.tsx` | 假 fetcher 返回删掉「不要发布」的整理稿 → 出现警告，默认按钮为「采用原文」 | S–M |
| V4 | 自定义识别热词：把硬编码的 4 项 `asrVocabulary` 改为用户可配置词表（≤ 50 项），只作识别提示、不做替换；设置页注明 `qwen3-asr-flash` 接口不支持词表 | `voice/credentials.ts`、`voice/service.ts`、`VoiceSettings.tsx` | 原生 3.1 请求体含词表；flash 路径请求体不变 | S |
| S1 | 回合结果字段：`AgentSessionSnapshot` 增加 `lastTurn { turnId?, outcome: completed/failed/interrupted, code?, endedAt }`，Codex 侧在 `turnActivity` 对应补齐；四个 Adapter 各自映射 | `agents/sessions.ts`、各 `*Adapter.ts`、`store/turnActivity.ts`、`generated-protocol` | 每个通道的夹具覆盖完成、失败、中断三种结果；DeepSeek 上游失败能显示 | M |
| S2 | 手机统一状态：纯函数 `executionPhase()` 输出 准备中 / 思考中 / 执行中 / 等待审批或提问 / 已完成 / 失败 / 中断，Codex 聊天与 AgentWorkspace 共用一个状态组件；按钮仍由 `control.canSend/canSteer/canInterrupt` 决定 | `mobile/src/features/chat/*`、`features/agents/AgentWorkspace.tsx` | 浏览器夹具：四通道 × 7 状态表现一致；code8 已确认的折叠范围不回退 | M |

### P1：捕获卡片 → 交给任意 Agent → 待验证

| ID | 任务 | 主要改动 | 验收 | 规模 |
| --- | --- | --- | --- | --- |
| V5 | 长录音分段：原生端每约 30 秒切一段，按段上传转写，手机实时显示已完成段的文字，结束后拼接再整理；上限从 121 秒 / 2MB 提到约 10 分钟。依赖 V1 | `mobile/android` 录音插件、`voice/native.ts`、`voice/service.ts` | 5 分钟录音完成；取消后不再上传后续段；单段失败只重试该段 | L |
| W1 | WorkItem 存储与状态机（放在 Relay，便于多卡片和跨设备）：JSONL、0600 权限；字段含报告中的模型，另加 `target {agentId, sessionId, cwd}`、`handoff {clientMessageId, delivery}`、`events[]`。服务端强制状态跳转，`done` 只能由手机用户操作；Kelivo 现有「交给电脑」迁移为 `kind=task` 的 WorkItem | 新增 `relay/src/store/workItems.ts`、`/api/work-items` 路由；`mobile/src/features/product/handoff.ts` | 状态跳转表单测；旧交接草稿迁移；隔离测试不读真实会话 | M |
| W2 | 捕获入口：从截图（系统分享/相册）、拍照、语音原文创建卡片，保留原图、原始转写、来源设备和时间；可编辑、可丢弃（丢弃时删除资产） | `uploadAttachments.ts`、`VoiceInput.tsx`、新卡片组件 | 对应报告 P1 验收第 1、2 条 | M |
| W3 | 交接扩展到所有 SessionAdapter：去掉 `isDesktopSource` 限制；Codex 保持现有 Desktop 发送路径，其余走 `AgentGateway.sessions(id).sendMessage`，`clientMessageId = WorkItem uid`；图片沿用现有 Agent 项目图片授权；确认一次，结果未知不重发 | `handoff.ts`、`HandoffCard.tsx`、`agentSessionRoutes.ts` | 四通道夹具各交接一次；取消不发送；uncertain 一直保持预留 | M |
| W4 | 进度自动回写（第一版不需要 Agent 配合）：Relay 跟踪目标会话中该 `clientMessageId`：确认送达 → `in_progress`；该回合完成 → `to_verify`；失败或中断 → 回到 `todo` 并附原因。依赖 S1 | `workItems.ts`、各 Adapter 的 watch | `to_verify` 永远不会自动变 `done`；网关重启后继续跟踪或标记待确认 | M |
| W5 | 事项页：按 待处理 / 进行中 / 待验证 / 完成 分组，点击跳到目标会话，提供「验证通过」「退回」；Kelivo 风格，AI 页和电脑页都有入口 | `mobile/src/features/` 新页面、Kelivo 入口 | 浏览器窄屏、150% 字号通过 | M |
| W6 | 资产保留策略：图片、录音、转写默认保留 30 天，可在设置调整；删除卡片时同时删除资产；显示占用空间 | `uploadStore.ts`、`workItems.ts`、设置页 | 到期清理与删除联动单测 | S |
| M1 | 模型探测登记：`GET /api/agents/:id/models` 返回 configured/discovered 来源和最近一次探测结果（ok / auth / endpoint / upstream_5xx / timeout / no_tools + `checkedAt`），只在用户点「检测」时发 `max_tokens=1` 请求、不重试、缓存 6 小时；手机诊断页展示。**前置决定：手机是否要切换模型；不切换则只做诊断展示** | `agents/*`、`gateway/diagnostics.ts`、`connection/GatewayPanel.tsx` | 打开页面不产生模型调用；一次检测只发一次请求；失败原因可读 | M |

### P2：Agent 侧接口、录屏、设备安全

| ID | 任务 | 主要改动 | 验收 | 规模 |
| --- | --- | --- | --- | --- |
| A1 | MobiCodex 任务 MCP（参考 Blurt 的 `search_items/get_item/update_item/mark_fixed`）：`list_items`、`get_item`、`add_note`、`attach_code_refs`、`mark_fixed`（只能到 `to_verify`）；安装前展示 Codex/Claude 配置差异，确认后再写入，可卸载还原 | 网关 CLI 新增 stdio MCP | Agent 无法设为 `done`；未安装时 W4 照常工作；卸载后配置逐字节还原 | M |
| R1 | 录屏拆事项：Android 录屏+旁白 → 上传 → Mac 侧抽关键帧 + 分段转写（V5）→ 用户选定的 Agent 会话生成事项草稿（带置信度和帧引用）→ 审核页。**启动条件：W1–W5 已实际使用过一段时间** | MediaProjection 插件、Mac 侧抽帧、审核页 | 报告 P1 录屏部分；低置信度事项默认不选中 | L |
| D1 | 二维码配对：网关显示含 endpoint 和一次性码的二维码，手机扫码；保留手输备用 | `gateway/cli.ts`、`PairingPanel.tsx`、扫码插件 | 二维码 5 分钟过期、只能用一次 | S–M |
| D2 | 撤销核验：确认被撤销设备已打开的 SSE 会立即断开、后续请求 401，补测试（token、队列、语音已联动清理） | `createRelayServer.ts`、`eventStream.ts` | 撤销后 1 秒内旧连接无法读取或操作 | S |
| D3 | 端到端加密：配对时 X25519 → HKDF → ChaCha20-Poly1305 加密经 Broker 的请求和响应 body，Broker 只看到路由信息；协议版本与能力协商，旧 APK 降级必须明确提示；Node ↔ WebView 共享测试向量 | `transport/*`、`remoteTunnelClient.ts`、`connection/http.ts`、`subscription.ts` | Broker 抓包无明文；两端测试向量通过；不会静默降级 | L |

## 2. 依赖与里程碑

```text
V1 → V2 → V3 → V4        S1 → S2
V1 → V5 → R1             S1 → W4
W1 → W2 → W3 → W4 → W5 → W6
W1 → A1                  D2 → D1 → D3
```

- 里程碑 A（P0）：语音不丢结果、整理不改原意、四通道状态一致。出一版 preview APK + 网关。
- 里程碑 B（P1）：截图或语音 → 卡片 → 任选 Agent 会话 → 自动到「待验证」→ 用户手动完成。
- 里程碑 C（P2）：Agent 主动回报、录屏拆事项、扫码配对、Broker 看不到明文。

## 3. 不做 / 搁置

- 不做：完整桌面画面流、触控板、Android 本地 ASR 模型、合并 Blurt 的 Tauri 应用（沿用报告第 9 节）。
- 搁置（等卡片实际用起来再评估）：屏幕 OCR 取字、翻译、Markdown/zip 导出。

## 4. 执行约束

- 每个里程碑建一个 Trellis task（PRD / design / implement），按 `AGENTS.md` 的分步本地提交流程执行。
- 隔离测试不读真实 Codex 会话、不提交模型任务；真实 Agent 与真机验收单独记录。
- 如复制 Blurt 代码或资产，在 `NOTICE` 中保留 MIT 许可和版权声明，并注明来源提交 `d4f257d`。
- 与在途计划的先后由用户决定：Claude Opus 完整验收、Agent 手机验收计划、59 组对照。
