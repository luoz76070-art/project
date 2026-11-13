# Claude Code 接入研究（2026-10-21，基础与交互切片已实施）

## 已核对的官方入口

- [Remote Control](https://code.claude.com/docs/en/remote-control)：原本机会话与Claude官方网页/手机端同步，连接经过Anthropic服务，当前文档未提供第三方客户端接管接口。
- [Channels reference](https://code.claude.com/docs/en/channels-reference)：由Claude Code创建stdio MCP子进程，声明claude/channel，推送通知进入加载此渠道的原会话，模型用reply tool回传；可选权限relay。
- [Agent SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions)：resume恢复持久会话上下文，fork复制会话，不是附着现有运行进程。

研究下载保存在output/research/2026-10-21/claude-*.md，仅用于核对，不复制上游实现。没有运行Claude、模型或安装用户插件。

## 可行方向与未解决边界

优先探索用户显式加载的Channels插件，继续使用一个Relay/Broker与设备鉴权；宿主MCP进程属于原Claude会话。自定义渠道当前仍在research preview，官方要求交互式开发加载确认；不能无人值守绕过该确认，也不能把插件安装动作写成会话已接管。

channel通知写入stdio只证明传输，宿主不提供处理ACK，未加载或策略阻止时可能静默丢弃；模型reply或明确的接收证据前不能标记消息已处理。忙碌时通知按顺序在后续turn合并，不应声称支持任意即时steer或中断。

官方权限relay只覆盖工具使用审批，不覆盖工程信任或MCP同意；preview可能含折叠、省略和遮挡，不能把不完整展示当成完整命令再允许。只有当前原请求ID可回allow/deny，均为单次权限；未知结果不得重放。尚需核验请求撤销和两端先答的可观察证据。

下一步先核实MCP进程与实际session ID的可靠绑定、原会话输出/状态来源、AskUserQuestion的真实应答入口与注销语义。Channels本身不保证完整token流或结构化问题应答；不能只加只读标签、独立SDK resume或新CLI会话就宣称Claude兼容完成。实现边界写入design后再改代码，使用合成stdio/HTTP验证，不接触真实会话。

## 本轮改用 Mods 的依据与边界

新发现的官方Mods/function hooks提供原进程API，不采用上述Channels弱确认作为主线。固定GitHub源码`bf2323b3021c9d3db7a31e1e7d61068c3f704497`、路径`mods/types/claude-code.d.ts`，首行生成版本2.1.277；当日docs的`plugins/mods/create`明确`hooks/hooks.json.modules`及`export function register(on)`，`$`在各hook的第一个参数，不能沿用早期猜测`register(on,$)`或`functions.capabilities`。

已核对并使用：session.id/cwd/version/messages、prompt.submit、turn.abort、turn.start/step/complete/session.end，以及http.fetch/clock.after。prompt.submit在空闲后执行，返回只证明进入/排队；turn.abort必须绑定turn.start的原ID；stream的next(e)只调用一次，原chunk原样yield且返回stream.result。仅转发kind=text，thinking/tool/input只作为活动信号。

API模块无Node/全局网络；`$`只允许literal调用，可传给同文件顶层helper。http.fetch返回完整text，没有本模块可用的取消/timeout参数；因此保持single-flight，poll由网关20秒返回，不能通过Promise.race假装已取消并重试。API网络挂起须真实宿主验收。

基础源码和合成宿主HTTP验收完成（当时Claude16项、合并后端179/179、手机37/37）。基础切片关闭问答/审批，后续交互研究和结果见下节。本机只执行`claude --version`得到2.1.220，没有运行模型/安装/升级，原生Mods validator和真实控制仍待满足版本条件后验收。

固定声明的手动静态检查命令：`corepack pnpm exec tsc --allowJs --checkJs --noEmit --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --lib ES2023,DOM --noImplicitAny false output/research/2026-10-21/claude-code.d.ts plugins/mobile-claude/hooks/register.mjs`。该检查不是实际宿主的`claude plugin validate`。

## 原请求交互的核验与实现

依据同一固定声明、当日官方[Hooks](https://code.claude.com/docs/en/hooks)及用户输入工具说明：AskUserQuestion可在PreToolUse收集答案、保留原questions并传入answers，以updatedInput和allow交回原工具；不需要猜造工具输出结果。答案key为完整question文本，多选字符串以逗号加空格拼接。原metadata和questions（包括preview）保留，手机只把preview按纯文本展示。固定声明未提供完整AskUserQuestion工具输出类型，不能据此伪造一个输出对象。

Mods的classic.PreToolUse输入是顶层ToolCallEnvelope，tool/tool_use_id是保留字段；返回是扁平allow/updatedInput。classic.PermissionRequest返回扁平decision.behavior，不使用shell hooks的hookSpecificOutput嵌套。先await next(e)尊重已有决定/改写。权限只对识别的六种内置工具开放，展示完整tool_input和cwd；只返回一次allow或deny，不采纳permission_suggestions添加规则，不更改输入或模式。

Mods hook自身有10秒预算，不能用自建Promise等待手机。等待放在宿主$.http.fetch内，每个原请求独立单个20秒长轮询；宿主API在途不计入自身预算。该API没有本模块可用的AbortSignal/timeout字段，不能Promise.race后叠加请求。保留next.signal并在返回前重新核对代次/原任务，取消另发close；关闭网关先唤醒等待。真实API挂起、预算和取消传播仍需宿主验证。

协议先锁原请求，重复手机应答即便换operationId也不能覆盖；随机id、serial、完整描述签名与服务端generation绑定。取消先到保留墓碑；有界关闭记录回收提升退休serial水位，已关闭正文清除，不让旧题复活。没有手机/未知结构/网络失败保留宿主流程，绝不因桥接错误授权。普通queue未知锁不阻塞回答当前原任务问题，避免等待互锁。

官方PermissionRequest文档还描述SDK场景中的先答竞争；不能把该说明直接当作Mods原生桌面面板同步证明。本轮仅完成本项目边界的合成先答锁、取消/错代次/迟到验证，真实桌面/SDK/手机谁先答、宿主是否正确取消另一侧必须另验收，不能称全部面板可同时操作。

研究文件：`output/research/2026-10-21/claude-hooks-permissions.md`是浏览器WebMCP获取后被截断的约12k摘要，**不是完整官方文档**；`claude-permission-section.txt`保存相关完整段落；固定类型文件和mods-*记录沿用。初次直接HTTP抓官方页被403拒绝，随后通过浏览器核对，没有绕过安全警告或安装扩展。

交互新增15项，Claude共31、合并后端194/194、手机37/37通过；两端typecheck/build、两独立插件包与固定声明静态检查通过。浏览器合成验收与剩余原生边界见`output/ui-review/2026-10-21/claude-interactions-checks.md`。生产仍1.2.2/versionCode18，未升级Claude、安装插件、部署、发APK、运行真实模型/审批或长期连接测试。
