# Blurt 对 MobiCodex 的优化方案

状态：分析完成，待用户启动实施

更新时间：2026-11-12

## 1. 目的

本文件记录对 `https://github.com/AGIHunt/blurt` 的源码级分析结果，作为 MobiCodex 后续实施的依据。

本轮分析基于 Blurt 浅克隆提交：

`d4f257d6f0cb133da5598c3555a295254025c5ec`

对应仓库入口：<https://github.com/AGIHunt/blurt>

MobiCodex 当前实现依据：

- `docs/product-requirements.md`
- `docs/architecture-feasibility.md`
- `docs/agent-gateway.md`
- `apps/relay/src/agents/agentGateway.ts`
- `apps/relay/src/agents/sessions.ts`
- `apps/relay/src/voice/service.ts`
- `apps/mobile/src/app/types.ts`
- `apps/mobile/src/features/chat/components.tsx`

## 2. 结论

Blurt 不是一个新的 AI Agent，也不替代 Codex、Claude 或 OpenCode。它解决的是 Agent 开始工作之前的输入和证据整理问题：把语音、截图、录屏和屏幕文字变成可以审核、交接和追踪的任务。

MobiCodex 已经拥有 Agent 会话、Relay、SSE、审批、提问、图片授权、附件、语音转写和多通道适配器，因此不应该直接合并 Blurt 的完整桌面应用。适合采用的是 Blurt 的产品闭环、任务数据模型、语音安全策略、MCP 交接方式和远程协议设计。

按当前代码边界估计：

- 产品设计和交互模式可复用性：高，约 80%–90%。
- Blurt 源码直接复用比例：低，约 20%–35%。Blurt 使用 Tauri/Rust、Swift、Kotlin 和 Python；MobiCodex 使用 React/Capacitor、Fastify/TypeScript 和现有 Mac 网关。
- 截图到结构化任务：高可行。
- 统一多 Agent 任务交接：高可行。
- 完整迁移 Blurt 的屏幕远控协议：中低可行，且不是 MobiCodex 当前优先目标。

## 3. Blurt 的核心数据流

```text
语音 / 截图 / 录屏
        ↓
Capture Session
        ↓
转写、截图、时间轴、用户标注、代码定位
        ↓
Issue / Idea / Note / Task
        ↓
用户审核、修改、丢弃
        ↓
交给 Codex / Claude / OpenCode 等 Agent
        ↓
Agent 回报 In Progress / To Verify
        ↓
用户验证并标记 Done
```

Blurt 的关键设计有四层：

1. **输入层**：本地优先语音识别、可选云端润色、翻译、屏幕 OCR、截图和录屏。
2. **证据层**：录屏按时间轴生成事项，每个事项可以关联截图、视频片段、用户画线、原始语句和代码引用。
3. **协作层**：Skill、CLI 和 MCP 共同操作事项，Agent 不能绕过用户审核直接把事项标记为完成。
4. **远控层**：手机作为电脑的键盘、触控板、麦克风和屏幕查看器，使用端到端加密、能力协商和协议测试向量。

## 4. 与 MobiCodex 的能力映射

| Blurt 能力 | MobiCodex 当前情况 | 处理建议 | 优先级 |
| --- | --- | --- | --- |
| 本地优先语音 | 手机录音上传 Relay，调用 Qwen ASR 和 DeepSeek 整理 | 先保留现有模型，增加分片转写、原文/整理稿双轨、取消和恢复 | P0 |
| 截图和语音备注 | 已有图片附件、图片引用授权和大图展示 | 增加捕获会话和证据卡片，保留来源会话与设备信息 | P1 |
| 录屏拆任务 | 当前没有结构化录屏任务流水线 | 新增录屏会话、时间轴、事项生成和审核页 | P1 |
| MCP 事项管理 | 已有多 Agent Gateway，主要围绕会话和消息 | 增加统一 WorkItem 层，供所有 Agent 使用 | P1 |
| Agent 状态反馈 | 已有运行中、审批、提问、完成、失败等状态 | 映射到事项的 `in_progress` 和 `to_verify`，不写入普通聊天消息 | P0/P1 |
| 工具输出折叠 | 已有 `processGroups`、工具摘要和折叠详情 | 借鉴 Blurt 的状态机和任务日志继续优化 | P0 |
| 远程控制 | 已有 Relay、Broker、Tunnel 和 Desktop IPC | 先借鉴设备配对、能力协商、令牌失效和恢复策略 | P2 |
| 模型设置 | 模型列表可能包含已发现但不可用的模型 | 增加模型探测状态和能力过滤，解决 Claude 菜单误导 | P0 |

## 5. P0：低风险、高收益

### 5.1 模型可用性分级

模型列表不能直接等同于可用模型。每个模型至少经过以下状态：

```text
发现到 → 配置正确 → 认证通过 → 基础请求通过 → Agent 能力通过 → 默认可选
```

手机端默认只显示最后一步通过的模型；“全部模型”显示失败原因：

- 供应商返回 502。
- 模型 ID 不兼容。
- 当前账号没有权限。
- 只支持聊天，不支持工具调用。
- 只支持视觉，不支持代码任务。
- 超时、限流或服务暂不可用。

模型探测结果应带时间戳和短期缓存，不能在每次打开菜单时重复消耗 Token。

### 5.2 语音链路升级

当前 `apps/relay/src/voice/service.ts` 是一次性音频上传、ASR、可选 DeepSeek 整理。建议保留现有供应商，先增加稳定性：

- 音频分片上传或分段处理。
- 手机实时显示临时转写。
- 保留 `rawTranscript`。
- 单独生成 `refinedText`。
- 用户明确选择原文或整理稿。
- 使用 `requestId + generation` 防止旧结果覆盖新草稿。
- 支持取消、超时、重连后查询结果。
- 语音识别失败时保留原始录音或明确提示，不静默丢弃。

Blurt 的重要原则是：润色不能改变用户原意；如果润色结果疑似删改了关键内容，应优先保留原始转写。

### 5.3 统一执行状态

执行说明直接显示，命令和输出折叠。建议统一状态模型：

```text
准备中 → 思考中 → 执行中 → 等待审批 → 已完成
                                  ↓
                                失败 / 中断
```

该状态用于 Codex、Claude、DeepSeek、OpenCode 和未来 Agent 通道。视觉可以统一，实际按钮仍由每个通道的能力决定。

## 6. P1：截图、录屏到结构化任务

不要把证据直接混进聊天消息，新增独立的 `CaptureSession` 和 `WorkItem`。

建议数据模型：

```ts
type CaptureSession = {
  id: string;
  mode: "voice" | "screenshot" | "recording";
  agentId?: string;
  sessionId?: string;
  cwd?: string;
  assets: string[];
  transcript?: string;
  createdAt: string;
};

type WorkItem = {
  uid: string;
  kind: "issue" | "idea" | "note" | "task";
  title: string;
  detail: string;
  frames: string[];
  codeRefs: string[];
  state: "todo" | "handed_off" | "in_progress" | "to_verify" | "done" | "discarded";
  confidence?: "high" | "medium" | "low";
};
```

手机端流程：

```text
截图或录音
  ↓
生成捕获卡片
  ↓
用户编辑标题和说明
  ↓
选择 Agent 和已有会话
  ↓
确认一次
  ↓
发送到现有 Agent 通道
```

此流程保持 MobiCodex 已确定的产品边界：AI 助手和电脑 Agent 可以独立使用；“交给电脑”是用户主动选择的可选操作，不自动转发上下文。

## 7. P1：统一所有 Agent 的任务接口

已有结构：

```text
AgentGateway
  ↓
SessionAdapter
  ↓
Codex / Claude / DeepSeek / OpenCode
```

建议扩展为：

```text
WorkItem
  ↓
AgentGateway
  ↓
SessionAdapter
  ↓
Codex / Claude / DeepSeek / OpenCode
```

所有通道共用以下交接字段：

- 任务标题。
- 任务说明。
- 图片和录音附件。
- 代码引用。
- 目标项目和 cwd。
- 目标 Agent 和会话。
- `clientMessageId`。
- 发送确认状态。

这样新增 Agent 时只需要实现会话适配器，不需要复制聊天、输入、图片和任务 UI。

## 8. P2：设备安全和远程协议

Blurt 远程协议值得借鉴的部分：

- X25519 临时密钥。
- HKDF 派生会话密钥。
- ChaCha20-Poly1305 加密。
- QR 配对。
- 设备列表和设备撤销。
- Agent/设备能力协商。
- 断线后清除可操作令牌。
- 重连时只恢复服务端已确认状态。
- 共享协议测试向量。

第一阶段不迁移完整桌面画面流、触控板和视频修复协议。MobiCodex 当前目标是 Agent 工作台，不是远程桌面；直接迁移会引入 Rust、Kotlin、视频编码、硬件解码和跨平台权限问题。

## 9. 不建议照搬的部分

- 不合并 Blurt 的完整 Tauri/Rust 桌面应用。
- 不把 Blurt 的本地 ASR 模型直接放进 Android 首版。
- 不把录音、截图和任务强行写入普通聊天消息。
- 不允许模型自动决定项目归属而跳过用户审核。
- 不直接把 Blurt MCP 安装到所有 Agent；由 MobiCodex 统一提供任务接口。
- 不默认加入完整桌面画面流。

## 10. 实施顺序与验收

### P0 验收

- 模型菜单默认只展示探测通过且具备当前 Agent 能力的模型。
- 不可用模型显示可理解的失败原因。
- 模型探测有缓存，不会因为打开菜单重复产生调用。
- 语音原文和整理稿可以分别查看和采用。
- 切换会话后旧语音结果不会覆盖新草稿。
- 所有 Agent 的执行说明、执行中、完成、失败和中断状态表达一致。

### P1 验收

- 能从截图或语音创建独立捕获卡片。
- 捕获卡片可以编辑、删除、保留原图和原始转写。
- 能选择任意已配置 Agent 和已有会话交接。
- 交接前必须确认一次，取消不会发送。
- Agent 处理进度能回写到 WorkItem。
- `to_verify` 不能自动变成 `done`。

### P2 验收

- 新设备可以二维码配对。
- 设备可撤销，撤销后旧连接不能继续操作。
- 重连不会重复发送未知结果的任务。
- 本地、Tunnel 和公网链路使用同一套权限与能力模型。

## 11. 依据和限制

Blurt 使用 MIT 协议，代码层面允许复用，但复制代码和资产时需要保留许可证和版权声明；模型权重、第三方库和服务商接口需单独确认授权。

本文件是 MobiCodex 的实施方案，不代表 Blurt 的功能已经移植完成，也不代表 P0/P1/P2 已经通过真实手机验收。实现时仍须遵守项目现有规则：先隔离测试，再构建检查，最后进行真实 Agent 和真机验收。
