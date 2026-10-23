# DeepSeek Harness 桌面实际接入

日期：2026-10-21。用户在接入方法说明后要求执行，并选择当前DeepSeek的“附件1”工作区。原进程插件安装、本机与公网链路核验完成；用户在手机确认“能看到会话并打开正文”。

## 安装与配置

- 官方桌面版`0.2.1-rc.2`使用原`desktop`配置，安装`dsh-mobile-codex@0.1.1`。未安装、升级或启动另一套Harness。
- 插件固定目录：`~/Library/Application Support/Mobile Codex Gateway/deepseek/mobile-deepseek-0.1.1-995eea83826f/`。接入时6个发布文件逐字节匹配源码及根LICENSE，组合SHA为`995eea83826f64d6a5c715b7816cbcb22da8b5aeb5e5aa2a98c53508ad4c89fa`。
- 私有桥接配置：`~/Library/Application Support/Mobile Codex Gateway/deepseek/bridge.json`，目录0700、文件0600，独立随机密钥，精确绑定用户选择的工作区。只监听`127.0.0.1:9876`。
- 原`~/.dsh/profiles/desktop/cordis.patch.yml`追加`mobile-codex.configFile`覆盖。原5个配置项及模型/provider配置保持；`cordis.yml`和`pnpm-workspace.yaml`逐字节保持。
- 现有`gateway.json`只增加`deepseek`字段，保留其余字段、手机凭证及设备状态，权限保持0600。原设备文件不存在，操作后仍不存在。

原始配置、私有操作报告和操作脚本保存在`/Users/rorance/workspace/backups/codex-to-phone/20261021-214642-deepseek-desktop-connect/`。该备份含凭证，不应公开。

## 加载与网关切换

官方桌面自带CLI位于`/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`。它允许`plugin --profile desktop`管理插件，但普通`--profile desktop --dump-config`被官方拒绝，因为该保留profile仅由Electron应用启动。此次拒绝没有修改配置；未绕过限制或用CLI启动另一desktop。

使用自带CLI执行`plugin --profile desktop add --offline --ignore-scripts <固定插件目录>`，离线链接且不执行安装脚本。pnpm提示linked peer依赖；原profile已有`autoInstallPeers:false`，官方运行时共享宿主`dsh-llm`，实际加载及bridge响应通过，因此没有安装重复宿主依赖。

官方HMR动态加载插件，Harness主进程PID68334及后端PID68372保持，9876监听属于原后端68372。桌面插件页显示已安装且启用；最终恢复原会话视图，原任务仍等待审批。未重启Harness，未操作审批、发送、追加或中断。

bridge就绪后，通过原instance绑定管理接口正常停止网关，等待原PID83844与监听释放，再启动原固定程序。程序仍为`releases/2026-10-21-question-lifecycle-6efac3ab10aa/mobile-codex/lib/gateway.mjs`，没有替换bundle。新instance为`6424f4b1-780c-460d-8175-ad0c07c1b9ba`，Tunnel恢复connected；未启用自启动。

## 验证结果

- bridge鉴权`/info`和`/sessions`均200，版本符合契约，精确目录内有1个在线根会话；无凭证403。9876仅单个loopback监听者。
- 本地与公网连接、网关状态、DeepSeek会话列表均200；网关无凭证401、Android预检204。DeepSeek只读probe为connected。
- Codex原生IPC健康200、connected且initialized；8787仅单个loopback监听者，网关原字段与设备状态保持。
- 公网手机v1订阅17.07秒：1全量、1增量、1心跳，20,087字节，首快照约902ms。直接使用当前手机`createSnapshotReducer`及`verifyAgentSnapshot`还原66条文本，消息ID无重复且无序列缺口。
- 关闭后重订阅3.43秒，首快照约709ms，仍还原66条文本并绑定同一原live Agent别名。自建订阅均关闭，未建立持续监测。
- 用户通过原题结构化回复确认手机“能看到会话并打开正文”，Android列表和打开正文实际验收通过。

没有修改运行代码，因此未重复运行已有隔离单元回归。此次验证使用实际安装、官方桌面插件页、鉴权HTTP和有截止的公网只读SSE，操作脚本语法检查通过。脱敏证据为`output/audit/2026-10-21/deepseek-desktop-connect.json`，不保存正文、密钥或控制令牌。

## 使用与边界

手机沿用现有APK和公网连接，在“切换Agent → DeepSeek Harness”中打开在线会话。当前标题使用`DeepSeek · 内部ID`；只展示选定工作区内的在线根Agent，不自动恢复未激活历史。

发送、追加和中断入口已就绪，但本次未对原任务进行真实写入，仍须分别验收。DeepSeek手机审批/提问尚不支持，当前等待的审批须在电脑处理。附件、完整历史分页和多进程聚合仍不支持；长期连接测试按用户要求继续暂缓。

## 回退

先用自带CLI执行`plugin --profile desktop remove dsh-mobile-codex`，再从原profile patch仅移除此次追加的`mobile-codex`项。HMR卸载只停止插件监听和订阅，不终止原Agent或清空inbox。核对原任务及9876监听释放；若宿主要求重启，等待任务安全结束后正常重启。

从网关配置仅移除此次增加的`deepseek`字段，使用现有固定程序正常stop/start，核对Codex IPC、本地/公网鉴权与Tunnel。备份用于逐项对照，存在后续用户修改时不整文件覆盖。固定插件和私有配置可先保留供重新接入，密钥不放命令参数或共享文档。
