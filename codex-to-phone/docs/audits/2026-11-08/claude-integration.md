# Claude Code 沿用原接口接入 MobiCodex

日期：2026-11-08。用户已确认范围为「电脑页接入 Claude Code，沿用原接口」，后明确要求清理旧配置并采用 CC Switch 当前的 `cc`。任务：[接入计划](../../../.trellis/tasks/11-08-claude-mobicodex-integration/prd.md)。用户随后指定 `cc1`。最新复测已恢复：Haiku 与 Sonnet 5.5 均 200，基础 Sonnet 流式完整结束；Desktop 连接警告消失，当前会话已从不可用的 Medium 改为基础 Sonnet。Claude Code 与 Desktop 的 CC Switch 选择均已同步为 cc1；在线桥接与手机联动继续验收。下文 502 为恢复前的历史证据。

## 初期核实与准备（历史）

- 手机0.1.8/code10已包含Claude电脑页；原网关支持ClaudeAdapter，但私有配置尚未启用Claude。当前Codex/DeepSeek沿用原网关，Tunnel connected。
- 本机默认Claude为2.1.220，未替换。另从官方npm获取固定`@anthropic-ai/claude-code-darwin-arm64@2.1.287`，99,617,644字节，SHA512 integrity与registry一致；二进制SHA256为`6eab8333fe2121553100d8f40bfada384a3e989b94f947e18ba6677a6fcb41ea`。
- 兼容运行时已单独放置在用户应用支持目录`Mobile Codex Gateway/claude/runtime/2.1.287/claude`；插件0.1.2固定副本为`claude/plugins/mobile-codex-bridge-0.1.2-86bbe81002bd`，5份文件与构建产物逐字节一致。没有安装登录项或第二个网关。

## 检查结果

| 检查 | 结果 |
| --- | --- |
| Relay构建及独立插件构建 | 通过 |
| 官方2.1.287版本门与严格plugin validate | 通过，8个hook及9个API被识别 |
| 官方plugin test | 8通过、0失败；临时HOME及官方测试hook模拟HTTP，无外部模型请求 |
| Claude项目隔离回归 | 32通过、0失败/跳过；合成宿主/HTTP |
| 固定副本核对 | 运行时版本正确、插件逐文件一致；原CLI保持2.1.220 |

原始回执：`output/audit/2026-11-08/claude-integration/`，包括`runtime-integrity.json`、`official-runtime.json`、`claude-tests.tap`及`prepared.json`。隔离通过不等于真实接口、原会话或手机验收通过。

## 初次接口同步与回退（历史）

- 只读数据库和真实 CC Switch 界面一致：Claude Desktop 当前选择 `cc`，地址为 `https://vulcanapi.com`；没有采用旧接口或当前 Codex 接口。
- 已将选定来源的 `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN` 同步至本机 Claude settings；原权限、Hooks 及 effort 设置保留。历史 `settings.json.bak` 已移入私有备份，凭证不入仓库或日志。
- 回退目录位于用户应用支持目录 `Mobile Codex Gateway/backups/2026-11-08-claude-cc-011129`，含原配置及一致性数据库备份；`config-sync.json` 保存脱敏回执。
- 初次检查中 CC Switch 的 Claude Code 页面仍选择 Claude Official，仅存在该供应商；没有把旧数据库备份恢复覆盖到用户当前数据。Claude Desktop 仍选择 `cc`。后续需完成 Code 侧选择一致性，避免把 native settings 同步误称为 CC Switch 全部已切换。

## Claude Desktop 超时诊断

用户在 2026-11-08 报告桌面 `Can't reach vulcanapi.com`，`/v1/messages`、`claude-sonnet-5-5` 超时。真实界面「Check again」复现；当前 Desktop 凭证与选定 `cc` 一致。

| 显式探测 | 结果 |
| --- | --- |
| 直连及代理 `GET /v1/models` | 均 200，8 个模型，约 1.1 秒 |
| 直连及代理 `POST /v1/messages`，空对象 | 均 400 `model is required`，约 0.8–1.3 秒，仅证明消息端点可达 |
| Sonnet 基础模型，直连及代理，`max_tokens: 1` | 均 502 `upstream_error`，约 21.7/22.1 秒 |
| Sonnet Medium、Opus，代理，`max_tokens: 1` | 均 502，同一错误，约 22.5/23.2 秒 |
| Sonnet Medium 流式请求，代理，`max_tokens: 1` | 502，同一错误，约 22.3 秒；复测时间 2026-11-08 13:01（Asia/Shanghai） |

错误正文均为 `Upstream service temporarily unavailable`。应用包只读检查确认 Desktop 的配置健康检查预算为 10 秒，早于上述 502 返回，因此界面呈现超时。未修改安装包、关闭 TLS 校验或更改系统代理；延长本机超时本身不能修复上游 502。该证据仅针对当前密钥/线路和已测模型，不能据此宣称服务商所有用户均故障。

原始脱敏回执位于 `output/audit/2026-11-08/claude-integration/desktop-health-network.json`、`desktop-other-models.json`、`desktop-stream-health.json`。上述 5 次最小消息请求属于用户报错后的真实接口健康探测，与前述无模型隔离测试分开记录；没有向用户的 Claude 会话重发「你好」、提交工具任务、审批或中断。Desktop 自带检查另有自身的健康探测。

当时的处置是让服务商排查这枚密钥对应的上游模型线路，恢复后复测，或按用户指定的新来源切换。用户已选择「改用我在 CC Switch 中指定的新接口」，随后指定 `cc1`。数据库与真实 UI 均确认 Desktop 当前已选择 `cc1`；但它与原 `cc` 的完整连接配置相同，包括地址和密钥。native settings 已与 `cc1` 的这两个字段一致，无需覆盖写入；当时 Code 侧仍为官方配置。

2026-11-08 13:28（Asia/Shanghai）复测 `cc1`：模型列表 200，Sonnet 最小消息请求约 22 秒后仍 502 `upstream_error`。证据为 `output/audit/2026-11-08/claude-integration/cc1-models.json`、`cc1-messages.json`。此次额外 1 次最小真实消息健康探测与此前 5 次分开留存。已请用户在 `cc1` 保存实际的新地址或新密钥后回复，不要求在聊天中发送密钥；不自行选择历史服务商。

## 固定启动入口准备

已在私有应用支持目录 `Mobile Codex Gateway/claude/start-claude.command` 准备启动入口，0700；读取同目录的固定运行时/插件回执、原 native settings 和父目录网关配置，不把模型或桥接密钥放入 argv。准备就绪后沿用原 HOME/工作目录、权限与 Hooks，通过官方 `--plugin-dir` 加载，明确指定已验证模型；不加载历史会话，也不自动发送 prompt。

`--check` 只读返回脱敏就绪状态，不启动运行时。初次准备时运行时/插件检查通过；当时新供应商尚未验证、模型尚未确认、网关尚未配置 Claude，返回 2 符合预期。无参数启动也被同一门禁拒绝，未创建会话、联网请求模型或更改在线网关。语法检查通过，回执为 `output/audit/2026-11-08/claude-integration/launcher-prepared.json`。当时真实加载待接口及桥接配置完成后验证；最终加载结果见后文。

## 13:33 后的接口恢复与配置一致性

用户回复「现在试试呢」后，2026-11-08 13:33（Asia/Shanghai）复测 cc1：模型列表 200/14 个，Haiku 最小消息 200，约 1.90 秒。Desktop 执行 Check again 后连接警告消失。当前会话原选择 `claude-sonnet-5-5-medium`，13:37 流式探测返回 404，明确提示该模型不适用于当前分组。已通过真实 UI 将当前会话改为 `claude-sonnet-5-5`，13:38 流式探测 200，约 3.35 秒，完整收到 message_start、content_block、message_delta、message_stop。

恢复前后显式最小真实消息健康探测合计 9 次，与无模型隔离检查分开。供应商实际输出超过请求的 max_tokens:1，不声称零消耗。没有点击原会话 Try again 或重发「你好」；旧 Server error 保持历史含义，用户真实会话收发尚未验收。

原始回执：`cc1-reprobe-133308.json`、`cc1-current-model-stream.json`、`cc1-sonnet-stream.json`，位于本轮 ignored 证据目录。cc1 地址和密钥仍与此前相同，不宣称已经换成不同服务商；恢复由最新实际响应确认。

当前配置变更前另做私有一致性数据库和配置备份，目录 `Mobile Codex Gateway/backups/2026-11-08-claude-cc1-135611`。通过 SQLite 事务仅新增一条未选中的 Claude Code cc1 配置，原供应商未覆盖；返回真实 UI 后出现该项，再通过切换按钮选中，界面显示切换成功。数据库、CC Switch 设置及 native settings 交叉核对：Desktop/Code 均选 cc1，两个 API 字段一致，Code 默认模型为 claude-sonnet-5-5，原非接口设置、权限、Hooks 与其他环境字段保留。凭证只在私有配置中。

`prepared.json` 已更新为供应商验证通过、默认基础 Sonnet。候选阶段启动器 --check 的 7 项中 6 项通过，仅网关 Claude 字段尚未应用，按设计阻止提前启动。网关候选通过现有 parseManagedConfig，唯一配置差异是独立 claude.bridgeToken，与手机/manager/DeepSeek 密钥不同。

本地/公网预检指向同一在线实例且 Tunnel connected；Codex native IPC 正常，DeepSeek 桥接正常、14 条已载入会话无 running。已备份原网关、队列/语音/桥接状态并验证原宿主存在；devices.json 当前不存在，保持缺失，不凭空创建配对记录。固定网关 bundle SHA 与已交付 a7c895b883ed 一致。预检和配置一致性回执为 `bridge-preflight.json`、`cc1-sync.json`，没有模型请求。

## 已授权启用与实际原进程登记

用户已明确批准「现在启用并验证」。首次正常 stop 接纳且端口释放，但旧网关 PID 45 秒后仍在，触发 OLD_PROCESS_EXIT_UNCONFIRMED，停止创建新实例；该失败回执保留于 `bridge-deployment.json`。这重现此前已记录的 DeepSeek 连接释放问题，没有把 stop 接纳误计为自然退出。

随后只读核对原桥接 14 条会话：全部 idle，无未确认提交、队列、提问或审批（`recovery-preflight.json`）。通过官方 DeepSeek 插件界面仅关闭再开启手机桥接组件；旧网关自然退出，原 Harness 宿主保留。之后应用唯一增加 Claude 字段的私有候选，启动同一个已交付的固定网关 bundle；本地/公网同实例，Tunnel connected，原队列、语音、DeepSeek 桥接配置及原宿主保持，devices.json 仍保持原缺失状态。结果见 `bridge-recovery.json`。原失败与恢复结果分开保存；不宣称残留连接根因已修复。

启动器全部 7 项门禁通过后，从项目目录启动固定官方 Claude Code 2.1.287 + 0.1.2 Mods。首次项目目录信任提示按本次授权范围确认，沿用原权限/Hooks；没有禁用审批或使用绕过参数。实际界面显示 Sonnet 5.5，未传 prompt、不恢复历史，登记 1 个本次真实 Claude Code 原进程。该会话为新启动的空白 Code 会话，不能称为接管 Claude Desktop 里既有「你好」会话；Desktop 原会话和历史保持。

## 本地/公网联动验证

`live-verification.json` 共 61 项断言通过：

- 本地和公网同一固定网关实例、Tunnel connected、已鉴权，Codex native IPC 及 DeepSeek 桥接恢复。
- Claude 通道 connected，原进程登记 1 条，同一项目/同一 sessionId，发送/单次审批能力可用，steer 保持不可用。
- 两端并发 SSE 实际订阅取得权威快照，connected/idle、空正文、canSend=true，无 pending 问答/审批、不可中断空闲任务；订阅未触发模型任务。
- Android CORS/预检通过，缺少凭证拒绝；手机管理员 token 不能作为 Claude 独立桥接密钥使用。
- 当前配置与审核候选一致，固定 bundle SHA 保持、仅一个网关/一个固定 Claude runtime；原宿主、队列、语音及 DeepSeek 私有配置保持。

首轮检查器对 204 无 body 响应调用 cancel 失败，保留 `live-verification-attempt1.json`；修正检查器为可空 body 后完整 61 项通过，产品代码未变。61 项及启用/恢复阶段外部模型请求为 0，单独健康探测累计 9 次保持原记录。

手机继续 0.1.8/code10，无 APK/热更新改动。启动入口为私有应用支持目录 `Mobile Codex Gateway/claude/start-claude.command`，本次会话须保持运行；以后正常退出后可从该入口启动，未安装登录项或自动发消息。该入口使用固定 runtime/plugin 和原 settings，独立桥接密钥不在 argv。

## 未完成项

已请用户在 MobiCodex「电脑」页切换 Claude Code，打开「Claude Code 会话」并发送短验收消息。手机实际打开/发送、原进程接收及回复显示仍待用户操作与真实回执，不能以接口健康或 61 项只读验证代替。未单独验收原生问答、审批、停止和附件图片，后续按产品既有验收边界执行；总整合59组状态保持。
