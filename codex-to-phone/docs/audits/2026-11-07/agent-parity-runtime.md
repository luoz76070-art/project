# code9 配套网关与 DeepSeek 原桥接恢复

日期：2026-11-07。承接 [code9 统一体验交付](agent-parity.md)，用户已明确批准在线切换。当前固定网关和原 desktop profile 的 DeepSeek 桥接均已恢复，用户确认「已升级 code9，原会话和正文正常」。手机 APK 保持 0.1.7-native-preview / code9；本轮电脑兼容补充为插件 0.2.7，完整整合任务仍为 in_progress。

## 兼容修复

实际 DeepSeek Harness 已升级到 0.2.2-rc.1，旧 0.2.5 与此前交付的 0.2.6 插件被官方版本门拒绝。对照安装包真实源码后，在插件 manifest、bridge 和 Relay 握手中精确增加该版本；既有 rc.2/rc.3/rc.5 保留，未知版本继续拒绝。

新宿主使用 Cordis 4.1.0、Node >=24.9.0。隔离检查器适配 SessionProjections、拆分后的 HistoryController、只读 prepared session 及官方 Session.create。新旧官方算法的排队、引导、取消待发、停止、历史和交互均在独立运行时复核。仅修复两处消息契约：plan-review 可选 callId 允许非空且不超过 512 字符；普通工具结果允许省略 isError，非法类型及 PTC 的严格检查保留。

原审批结算的两个源码指纹未变；完整原始 JSON 参数、单次允许/拒绝与取消语义保持。新 `intent.kind="approval"` 尚未适配，手机显示不可操作并交由电脑处理，不能据此宣称全部新审批均已支持。

## 检查与实际切换

| 证据 | 结果 |
| --- | --- |
| Relay 全量回归 | 419/419，无失败或跳过 |
| 官方 0.2.2-rc.1 隔离 | runtime 14、history 4、interactions 12，共 30 项 |
| 官方 0.2.1-rc.5 隔离 | 同上，共 30 项 |
| 两端 typecheck、完整 ESLint、Relay/插件构建 | 全部通过 |
| 本地/公网真实原会话与网关 | 77/77，通过同一手机增量解码器验证 |
| 手机 code9 升级、DeepSeek 原会话与正文 | 用户确认通过，未独立回拉手机安装 SHA |

先在私有目录备份旧完整网关、插件、原 profile manifest/lock/patch 与实际存在的配置/设备/语音/队列。固定候选逐文件核验后，用官方 `plugin --profile desktop add --offline --ignore-scripts` 链接插件；官方界面仅重载手机桥接组件。原五个 Harness 宿主 PID 保持，9876 由原宿主监听，UI 显示桥接 0.2.7 运行中。

旧网关通过管理 stop 正常退出，耗时 2280ms；确认端口释放后启动新固定程序。新 bundle SHA256 为 `08bff6fea5f4b56bde294b780f7b15db58f0ee4b477ab01cdc912e61bea379ca`，native IPC 与 Tunnel connected。本地及公网指向同一实例。没有强制终止、清锁、启用登录自启动或改模型/权限策略；原配置、设备和 profile patch 字节保持。部署回执见[脱敏 JSON](agent-parity-runtime-verification.json)，私有备份和原始日志仅留本机 ignored 目录。

原 DeepSeek 列表 14 条，授权原目标首屏 40 条消息、含 14 条工具记录；重连后消息身份一致，未决问题/审批/待发均为 0。图片接口使用项目公开 JPEG 的临时文件，核对 24,806 字节及 SHA、订阅绑定、无凭证、越界、缺失、坏路径与关闭订阅后拒绝，finally 已删除临时文件。Codex 当前维护会话原生 SSE 与本地图片、公网鉴权和 Android CORS 也通过。接口检查不计作手机已展示该图或真实模型产图。

外部模型请求和真实审批均为 0。两版 runtime 各用 3 次本地确定性模型夹具；这些隔离算法检查不计作真实手机写入验收。本轮没有手机代码改动，沿用 code9 的 169 项手机、340 项原生及签名/成品验证，未机械重打 APK 或重跑原生全量。

## 诊断记录与交付

旧网关预检曾出现 SSE 500/超时，随后通过只读原生 IPC 核对当前会话未决状态；新网关实际 SSE 200，旧故障根因未确定。首次准备把隔离检查 Electron 子进程误算宿主，退出守卫阻止安装，修正为原五个宿主后才继续。联动检查器的早期断言失败保留为 attempt1–3，最终 77 项通过。归档器曾因 Git 子目录路径重复而未生成元数据，修正后在独立临时索引验证补丁、逐文件核对两份归档。补丁文本本身的空白上下文又触发新增文件的空白检查，现以 gzip 封装，解压后逐字节保持原补丁且再次应用通过；上述中间失败不隐去，也不计为产品通过。

[电脑兼容补充目录](../../../releases/android/kelivo-preview/0.1.7/desktop-0.2.7-preview/)包含实际固定安装程序的两份归档、基线源码补丁、逐文件元数据和 SHA256SUMS。补丁从 `6e52efe95de92a72c8eef79dea55a992c5378c14` 重建 11 个修改源码/契约文件，独立索引应用后与工作区 SHA 一致。原 code9 十份产物和原 preview 标签保持不变，App 更新源继续 latest9/previous8。

源码与补充包提交 `cef68905dda13d7d96fbc22c8a5c051847283651` 已推送原 main，六份补充文件与 11 个修改源码已从 GitHub 完整回下载，大小/SHA/全部字节一致；16 个归档文件和补丁重建检查通过。原 code9 十份文件及指向 `415f419` 的旧 preview 标签保持。结果见[独立交付回执](agent-parity-runtime-github.json)；最终记录同步后打新的 `codex-to-phone-v0.2.7-deepseek-preview` 标签，不创建 GitHub Release，不移动旧标签。

## 验收边界

用户本轮确认限于 code9 升级、DeepSeek 原会话和正文正常。工具展开/偏好、DeepSeek 手机图片/大图、附件语音、新输入去重、问答/单次审批/拒绝/停止及切网仍按[手机验收接续计划](../../plans/2026-11-07-agent-phone-acceptance.md)逐项开展。Claude/OpenCode 当前未配置原宿主，不能把共用界面与隔离检查扩大为其真实联动通过；完整 Kelivo 59 组和原 Desktop 新建保持原待验状态。

沿用已有版本同步与官方运行时检查流程，更新 DeepSeek 契约；未新增技能或自动化。手机剩余交互仅落计划，本轮不代发真实任务。
