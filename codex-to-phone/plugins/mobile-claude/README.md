# Claude Code 原会话桥接预览

本插件在加载它的 Claude Code 原进程中执行。复用 Mobile Codex 的一个 Relay/Broker 和手机 Agent 页面，无额外 Node/MCP 子进程，不启动模型、不恢复或复制会话，不使用 macOS 辅助功能。

已完成源码、合成宿主/HTTP测试、手机浏览器验收，以及官方2.1.287严格校验和7项无模型沙箱测试；**用户 Claude 原会话和 Android 仍待验收**。协议依据 `anthropics/claude-code` 的 `bf2323b3021c9d3db7a31e1e7d61068c3f704497` 中 `mods/types/claude-code.d.ts`（2.1.277），插件入口依据2026-10-21官方 Mods create 文档的 `hooks/hooks.json.modules`。该API仍可能变化，版本门不代替真实兼容性验证。

## 能力

- 已登记的在线原会话、按手机订阅获取最近文本。
- `turn.step` 原始可见文本，40ms合并发送；推理内容和工具参数不转发。
- 正在思考/执行/输出与真实任务结束状态。
- `$.prompt.submit` 排队输入；接收确认表示进入原会话，不代表完成。
- `$.turn.abort({turnId})` 精确任务中断；返回不代表已结束，须等匹配的 aborted 生命周期。
- 原任务的 AskUserQuestion：手机显示完整题目、选项说明和文本预览，支持单选、多选、自由回答及一次提交。答案回到原工具输入，由原工具生成结果。
- 原任务的工具审批：显示工作目录和完整工具输入，仅允许一次或拒绝，不保存权限规则、不更改权限模式。
- 不支持即时追加或历史向前翻页；未知问题结构、未支持的工具和其他宿主提示仍在电脑处理。

问答与审批只有宿主登记 `interactions: 1` 时开放，旧版基础桥接保持关闭。问答仅支持已识别的 AskUserQuestion 输入结构；审批目前支持 Bash、PowerShell、Read、Write、Edit、NotebookEdit，参数超限或未知工具保留宿主流程。其他 hook 已作出的决定与输入改写优先保留。选项 preview 作为纯文本展示，不执行 HTML。

手机提交只表示网关收到本次决定，不表示工具已执行。取消、任务变化/结束、失联、最后手机订阅离开或五分钟期限使请求失效；同一请求不能换操作 ID 再回答。没有手机订阅时直接保留宿主流程。不能据此声称原生桌面面板与手机一定同时可操作，真实宿主的取消、两端先答及错误回退仍需验收。

## 配置与人工安装

先完成源码与宿主兼容性验收，再在真实环境配置；本项目没有自动安装或修改用户配置。

1. 在网关私有 `gateway.json` 中显式增加独立密钥（至少32个随机字符，不能复用手机管理员token）：

   ```json
   "claude": { "bridgeToken": "<independent-random-secret-at-least-32-characters>" }
   ```

2. Claude 宿主环境使用同一桥接密钥和本机网关根地址：

   ```sh
   export MOBILE_CODEX_CLAUDE_BRIDGE_URL=http://127.0.0.1:8787
   export MOBILE_CODEX_CLAUDE_BRIDGE_TOKEN='<same-private-bridge-token>'
   ```

   不把密钥加入仓库或启动参数。网关与宿主保持本机连接，手机远程连接继续经过Broker。URL只接受字面loopback的HTTP根地址；不接受localhost、子路径、用户信息或公网URL。

3. 官方Mods入门文档要求2.1.287或以后；模块及网关当前只接受2.1.x且patch>=287。固定API类型文件生成于2.1.277，与宿主最低版本分别记录。2026-10-21用户安装的CLI仍为**2.1.220**，没有升级或加载模块；旧校验器拒绝modules入口。另在临时目录核对官方2.1.287发布包完整性后，严格校验发现helper与局部变量同名导致静态分析失败；插件0.1.1将HTTP helper改名为唯一的bridgeRequest后，`plugin validate --strict`及官方7项无模型测试通过。该临时校验器没有安装到用户PATH，不解决用户旧宿主本身的版本限制。使用前仍需在兼容宿主的原测试会话验收，不能用空hooks伪装兼容或把隔离通过称为用户原会话验收。

4. 用 Claude 官方的插件安装/加载方式，在原进程启动时加载目录；也可人工使用 `claude --plugin-dir <plugin-directory>`。仅加载了插件的原进程可登记；未加载插件的正在运行会话、热重载中的既有活动任务和已退出历史不保证可接管。

`corepack pnpm build:plugin` 生成 `dist-plugin/mobile-claude/`，源模块保持未压缩以供宿主静态校验；网关仍由 `dist-plugin/mobile-codex/` 提供。没有第二套Relay。

## 生命周期与限制

桥接API使用独立密钥、loopback和无浏览器Origin校验。宿主每会话保持一个最长20秒的命令长轮询；45秒未续租即断开手机权威状态。无手机订阅时不读取会话正文；插件仍发送少量生命周期事件并保持可发现。手机订阅后读取宿主API提供的最多4096条，再保留最近80条、约100k字符并限制编码体积；不承诺完整历史。可见实时overlay最多256k字符/128段，背压丢段会标记不完整，并在下一次最近文本快照修复。

命令取出后绝不重发。宿主返回未知、回包丢失或已取出的操作超时，会锁定写入；不把重连当作可以重试。尚未取出便过期可安全恢复，手机保留草稿。幂等和未知锁仅在进程内，网关重启不保证exactly-once。宿主还保留最近1024个操作ID作为重复保护。

`$.http.fetch`没有本模块可用的AbortSignal/timeout字段。本模块保持单个在途命令poll和event POST，每个活动交互也只保持一个独立答案请求，不用超时竞速叠加请求；正常poll由网关20秒返回。问答和审批等待放在宿主HTTP API内部，不用自建Promise长时间占用hook预算；保留原hook取消信号，返回前再次核对任务与代次。挂起的宿主HTTP调用受宿主自身限制，这部分仍需真实兼容验收。网关停止先关闭等待，再关闭HTTP；退出通知失败由租期回收。旧版本不会回退新CLI/SDK会话。

## 隔离验证

`corepack pnpm test:claude` 使用临时目录、随机HTTP端口与合成宿主API，不运行Claude或模型。覆盖所有权、版本/URL、鉴权、按需文本、可见delta/私有内容隔离、队列仅投递一次、中断终态、租期/未知锁、拒绝/过期、UTF-8体积、原题目/metadata保留、多选与自由回答、完整审批参数、取消/重复提交/错代次、记录回收和停止释放。完整回归另运行所有 `apps/relay/tests/*.test.mjs`，需先 `corepack pnpm build:plugin`。

另可显式运行`node scripts/check-claude-runtime.mjs /absolute/isolated/claude`。要求调用者已准备官方2.1.287二进制，检查器不下载/安装依赖；自行创建HOME/CLAUDE_CONFIG_DIR/工作目录，复制插件和仓库外置测试fixture，执行版本门、严格静态校验与官方plugin test，最后清理目录。7项覆盖未配置、旧版本拒绝、登记/无订阅不读正文、按需快照/输入去重、原流透传及推理正文隔离、任务绑定中断、鉴权失败停止轮询。所有HTTP由官方测试hook应答，无模型或用户会话。Classic问答/审批在官方静态校验中被识别，但原面板取消/先答仍需原会话验收。

2026-10-21本轮：官方严格校验、官方7/7、既有Claude31/31、固定声明类型检查、脚本语法与独立0.1.1插件打包通过；产品仅修正helper命名，没有改变原控制协议或运行网关。详见仓库`docs/audits/2026-10-21/claude-official-runtime.md`；以下保留初次交互切片记录。

2026-10-21：Claude 31项、合并后端194项及手机37项通过；浏览器检查360/390/430px、浅深色、150%根字号、至少44px按钮、双题提交、单次审批/拒绝和断流清卡片。以上都是源码和合成验证，未安装插件、部署或发布APK；生产仍1.2.2/versionCode18。
