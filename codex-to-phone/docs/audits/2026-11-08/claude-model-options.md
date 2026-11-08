# Claude 模型清单与可用性修正

日期：2026-11-08（Asia/Shanghai）。用户反馈桌面模型菜单很长，除默认Sonnet5.5外均使用失败。本轮查明来源并通过官方配置界面精简当前cc1模型列表；不将列表返回200当作生成可用。

## 原因与最小探测

当前CC Switch的Desktop/Code均选择cc1；桌面当前profile未指定inferenceModels，启用了自动发现。实际GET /v1/models返回14项，与真实桌面菜单顺序和ID逐项对应。其中既有 `claude-opus-5-5`、`claude-sonnet-5-5`，也有 `claude-opus-5.5`、`claude-sonnet-5.5` 等不同拼写；桌面将能识别的ID格式化为友好名称，其他项显示原始ID，形成用户看到的重复观感。不是手机重复登记了模型。

已有默认 `claude-sonnet-5-5` 的真实桌面/手机收发已通过用户验收。本轮额外进行3次最小真实消息请求，每次请求max_tokens=1、无自动重试，与只读/隔离检查分开：

| 请求的精确ID | 结果 | 耗时 |
| --- | --- | --- |
| `claude-opus-5-5` | 200，有文本，响应模型同ID；usage为5输入/1输出token | 30.14秒 |
| `claude-sonnet-5.5` | 502 upstream_error，Upstream service temporarily unavailable | 21.32秒 |
| `claude-haiku-4-5-20251001` | 502 upstream_error，Upstream request failed | 1.19秒 |

这证明该接口列出的名称不都能实际生成，规范Opus短请求当前可以响应。未逐项测试其余模型，也不能从一次502断言永久不可用，或仅凭名称拼写推断所有失败原因。前轮点号Opus502与本轮连字符Opus200发生在不同时间，不将其当作严格同时对照。短请求200不等于完整Code上下文、工具调用或手机端的Opus真实会话已通过。

## 官方配置修正

私有备份位于 `Mobile Codex Gateway/backups/2026-11-08-claude-model-options-<时分秒>/`；4份文件SHA核对及CC Switch一致性数据库备份完成。精确位置保存在ignored证据目录的backup-path.txt。

在Claude的「Inference configuration → Connection → Models」中，关闭Model discovery，显式模型列表按顺序设为：

```json
{
  "modelDiscoveryEnabled": false,
  "inferenceModels": [
    { "name": "claude-sonnet-5-5" },
    { "name": "claude-opus-5-5" }
  ]
}
```

通过官方Save & Restart正常应用。应用前已确认原桌面会话idle、无待决问题/审批；重启后打开同一「你好」/「自媒体」原会话，不另建CLI或发送模型任务。真实菜单仅显示Sonnet5.5 Default、Opus5.5及Effort，截图已保存。

配置检查器首次严格预期只变两项，发现官方编辑器另移除了显式 `inferenceGatewayAuthScheme: bearer`，断言失败。核对实际代码 `resolvedAuthScheme()`：只有x-api-key才使用该方式，其余为bearer；这是默认值规范化，不是切换鉴权。更新检查后确认除此之外非模型字段不变、凭证存储字符串不变、native settings逐字节一致。CC Switch供应商、手机APK、共享网关均未修改。

## 验证与边界

- 配置的两个规范ID和顺序、关闭发现、默认Sonnet及真实菜单两项均通过。
- 正常重启前后，各36项本地/公网只读检查通过：同一固定网关/Tunnel、Codex native、DeepSeek及原Claude会话可用，原手机验收正文仍在权威快照，idle且无待决，旧独立CLI未回到在线列表。没有额外模型任务。
- 手机保持0.1.8/code10；本轮未重新进行手机UI收发或Opus完整Code会话验收，也未修复供应商上游502。更换供应商时，应针对新接口重验模型清单。
- 无产品源码变更，检查JSON、文档路径、配置差异和git diff，不重复全量产品测试。

原始证据位于ignored的 `output/audit/2026-11-08/claude-model-options/`：provider-models.json、minimal-model-probes.json、configuration-change.json、link-before.json、link-after.json、model-menu-after.png。模型调用与只读验证分别记录。[Opus后续验收计划](../../plans/2026-11-08-claude-opus-acceptance.md)等待用户启动。
