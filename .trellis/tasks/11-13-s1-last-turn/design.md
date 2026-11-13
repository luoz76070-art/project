# 设计

shared/lastTurn.d.ts 只共享类型，Relay 的 store/lastTurn.ts 拥有脱敏原因映射与有界缓存。既有 Desktop/turn/agent-session 快照与 delta 元数据增加可选 lastTurn，旧字段保持兼容。null 表示没有可靠结果，缺字段表示旧生产者。新轮开始保留上轮结果，终态直接发布。

字段为 `turnId`、`status: completed|failed|interrupted`、`reason: {code,message}`、`endedAt`（ISO 8601）、`timeSource: provider|observed`。ID 在会话内唯一；没有原轮次 ID 时仅使用已有权威结束标记 ID。缺少引擎时间则记录首次观察时间，并允许同轮后续权威时间补正。中文原因只来自固定字典。

| 通道 | 原始证据 | 结果 |
| --- | --- | --- |
| Codex 桌面 | canonical/legacy turn 明确 status；已有 rollout 窗口的 task_complete(d)、task_failed/turn_failed、turn_aborted | 对应 completed/failed/interrupted；未知状态或身份为 null |
| Relay Codex | turn/start 返回或 turn/completed 的明确 status；error 且 willRetry=false；进程 exit | 对应终态；不可重试错误为 failed；已确认退出为 failed/engine_exited |
| Claude Code | 既有 state aborted=true；aborted=false 后同轮 assistant final_answer | interrupted/cancelled；completed/ok；其余 null |
| DeepSeek Harness | turn/end reason.kind completed、aborted、error、max-tokens、blocked | completed/ok、interrupted/cancelled、failed/白名单原因、failed/token_limit、failed/blocked；未知 null |
| OpenCode | 最新 idle 消息的 outcome succeeded、failed、interrupted | completed/ok、failed/provider_error、interrupted/cancelled；无 outcome 为 null |

不增加路由和事件名：`POST /api/live/turns`、`GET /api/live/turns/:turnId` 的 turn 快照，以及 `/api/live/threads/:id`、旧 `/api/live/messages`、`/api/desktop/threads/:id` 和 `/delta` 的已有响应附带结果；SSE 继续使用 `turn`、`desktop`、`delta`、`agent-session`。v1 增量帧把结果作为元数据，消息没有变化时也能发送；旧完整帧同样携带字段。delta 窗口无终态时省略字段，避免抹掉实时来源已知结果。旧 status/error/message/delivery 字段和 DeepSeek 失败提示继续保留。

Codex 使用明确终态及完成时间；落盘读取仅投影现有窗口。Relay 区分重试、断线、引擎退出及中断 ACK。Claude 使用既有 aborted 和与刚结束轮次匹配的 final_answer。DeepSeek 原 turn/end 投影，保留旧失败消息；OpenCode 使用 idle outcome 原始边界。所有原因只输出白名单，不输出 provider 错误原文。

手机扩展现有 runtime 合并及提示区，区分上轮结果和当前活动状态；不实施 S2 七态组件，不缓存结果到磁盘。

新增独立缓存最多 128 个会话、每会话一份结果；Codex rollout 的 generation 替换同会话旧条目。桌面和 Claude 复用既有有界会话容器。无新增文件写入、历史扫描、宿主发现或模型执行。Claude 新 activation、无法投影的历史以及已淘汰结果均为 null；现有读取窗口恰好含可靠终态时可顺带投影。OpenCode 仍依赖既有最近 50 条消息刷新，窗口外终态不保证恢复。

重试、发送/中断 ACK、普通断线不结算；Relay 仅确认其自有进程退出后结算 engine_exited。start 回复前的边界事件有界缓冲；旧 turn 的迟到事件不覆盖当前会话结果；手机沿用已有请求代次/游标防迟到保护，只有可比较的 provider 时间才作时间排序。
