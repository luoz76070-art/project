# OpenCode 接入研究（2026-10-21）

## 当前固定基线：2.0.16

本机PATH安装@opencode/cli 2.0.16；官方v2.0.16 tag解析为commit `3a103fe0aff726a4edc7492f03f7b88195d9e4c9`。从真实tree定位到`packages/protocol/openapi.json`，不能沿用旧SDK文件路径。原始资料仅保存output/research/2026-10-21/opencode-v2.0.16。

| 边界 | 当前主源 | 原1.19.3差异 |
| --- | --- | --- |
| 版本/健康 | GET /api/info，version | 不再有/api/health |
| 发送 | 顶层text，data为inbox user/payload/delivery | 不再prompt.text/admittedSeq |
| 中断 | 200 JSON interrupted | 不再204；false为idle no-op |
| 问答 | /form，原key→answer值 | 不再/question及二维answers |
| 审批 | reply正文decision | 不再reply字段 |
| 事件 | session.text.*、session.inbox.enqueued | 不再session.next.* |
| 文字段 | created在envelope，text ordinal | 不再textID/timestamp；canonical text无id |

额外核对`schema/session-event.ts`、`core/session/runner/publish-llm-event.ts`及`message-updater.ts`：text与reasoning分别从0计数ordinal；不能把ordinal当混合content下标。builtin question工具在`core/tool/plugin/question.ts`生成kind=question表单，字段q0…，用option.value回传，由原工具读取原字段产出结果。

唯一支持基线切换到2.0.16；旧候选未发布，不增加双协议回退。列表/历史/新SSE先核验info版本；未识别版本明确拒绝。仅完整映射普通question字段，其他表单显示需电脑处理，完整原数据仍参与签名。此次只读取固定官方源码并做合成测试，没有连接真实OpenCode服务、读取真实会话或启动模型。

## 以下为原1.19.3研究（已由上述基线修正）

## 固定主源

发布版v1.19.3（2026-10-16），commit `e3c4eb242585dcd77be1a867391b7c25fd47ce52`：

- [SDK OpenAPI](https://github.com/anomalyco/opencode/blob/e3c4eb242585dcd77be1a867391b7c25fd47ce52/packages/sdk/openapi.json)
- [Session路由](https://github.com/anomalyco/opencode/blob/e3c4eb242585dcd77be1a867391b7c25fd47ce52/packages/server/src/handlers/session.ts)
- [Core消息投影](https://github.com/anomalyco/opencode/blob/e3c4eb242585dcd77be1a867391b7c25fd47ce52/packages/core/src/session/projector.ts)

主源研究下载仅保存在被忽略的`output/research/2026-10-21`，不把上游源码复制进工程。未以开发分支当前HEAD作为协议基线。

## 决策

当前GUI使用`/api/` v2：会话/消息/问题/权限通常包在`{data,cursor?}`，prompt含msg_ ID、prompt.text和delivery；不能沿用旧prose的`/session` v1。session.location.directory决定控制范围，workspaceID会话需要独立设计，本阶段拒绝。

事件SSE先server.connected，15秒注释heartbeat；JSON为`{id,type,data}`。特别是text.delta没有逐字写入SQL投影，只有Started/Ended投影；仅收到事件后重读message无法实现真实文字流。因此使用内存overlay合并Started/Delta/Ended，以40ms批量输出；中途加入缺段首明确提示，Ended以全文校正。私有推理/工具参数delta只更新活动状态。

prompt返回admittedSeq、原ID和delivery，只证明接收。排队消息尚未进入canonical message时，可由匹配ID与文本hash的prompt.admitted事件确认。interrupt没有expectedTurnId，只能发送前核验活动状态并等待idle；必须保留宿主原子性边界。

question与permission回复均绑定原session/requestID。请求签名必须覆盖tool/source等内部来源与未知字段，不能因Zod默认strip把旧卡片误认作新来源的请求；手机DTO仅选择明确字段。未知结果进程内锁定、重订阅不重放；服务重启无恰好一次保证。

## 当前证据

后端合并163/163（OpenCode25），手机35/35、消息回归、两端typecheck/build及独立插件包通过。浏览器浅深色/150%字体/360-430px、真实界面合成问答/审批/发送/追加/排队/中断/恢复/草稿通过。证据在output/audit与output/ui-review的2026-10-21目录。未连接真实OpenCode或触发模型；未部署、发APK、安装用户插件或开启长期测试。
