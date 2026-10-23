# Claude 官方校验与无模型运行时复核（2026-10-21）

开发计划中“兼容宿主的官方校验”此前受用户本机2.1.220限制。本轮在系统临时目录下载固定官方`@anthropic-ai/claude-code-darwin-arm64@2.1.287`发布包，按registry的SHA-512 integrity逐字节核对后解包，不运行安装脚本，不更改用户CLI、PATH或profile。校验和测试均使用临时HOME、CLAUDE_CONFIG_DIR、工作目录及插件副本；关闭自动更新，只调用版本/help/plugin validate/plugin test，没有启动Claude会话或模型。

官方严格校验首次失败：给`$`传参的顶层HTTP helper叫request，同文件两处局部变量也叫request；该JS命名虽合法，却触发Mods静态分析的“function handed $ declared more than once”。失败记录保存为`output/audit/2026-10-21/claude-official-validator.json`。将helper及其调用改为唯一的bridgeRequest后，严格校验通过，8个hook与9个API被识别，环境仅读取两项桥接配置、不写环境变量。插件patch版本递增至0.1.1，没有修改控制协议或网关代码。

新增可复用检查器：

```sh
node scripts/check-claude-runtime.mjs /absolute/isolated/claude
```

检查器要求调用者已准备官方2.1.287二进制，本身不下载或安装。仓库fixture保存在`scripts/fixtures/claude-official-runtime/bridge.test.ts`，只复制到检查器自建目录，不进入发布插件；退出时删除临时profile与插件副本。

官方plugin test的7项通过：

- 未配置时原session.start结果原样保留，HTTP与正文读取均0次。
- 低于支持版本时不登记、不读取正文。
- 使用当前会话ID登记，手机未订阅时正文读取0次；退出通知正常。
- 收到快照命令才读一次最近文本，重复输入ID只调用一次prompt.submit并报告后续不确定回执。
- 原turn.step仅调用一次底层本地响应，全部chunk与最终结果透传；只将可见文本发给桥接，推理正文不外传。
- 中断旧turn命令被拒绝，有效命令调用原turn.abort；不将其等同真实模型任务已经结束。
- 403拒绝后不再poll，也不读取正文。

所有HTTP由官方测试hook应答，底层响应是本地async generator，无socket或外部provider。这里使用的是官方沙箱/链式调度，不能代替真实网络或用户原进程。Classic问答与审批被静态校验识别；原面板取消、预算、两端先答和真实模型输出仍须原会话验收。

检查过程中另发现测试fixture的接口差异：官方测试Engine的turn.step没有固定旧声明描述的.result便利属性，结果在标准iterator的done.value中。独立空模块探针保留终值证据，fixture改为显式读取终值并继续断言完整结果。产品hook内部next(e)的.result处理在官方测试中正常，因此未修改产品流实现。类型检查另补齐fixture的SessionEndInput.resume字段；该字段仅是合成事件数据，不执行resume。

本轮验证包括官方严格校验、官方7/7、既有Claude31/31、固定声明对模块与fixture的类型检查、脚本/模块语法、Relay及独立插件构建。源码仅修复Claude模块helper命名与patch版本；没有重跑全部后端或重打手机APK。最终证据为`output/audit/2026-10-21/claude-official-runtime.json`，下载/清理元数据为`claude-official-runtime-preflight.json`，本地修复候选及逐文件校验见`output/delivery/2026-10-21/claude-host-fix/`。

最后合并受影响的Claude31项与DeepSeek22项，共53/53通过，日志为`agent-host-fixes-regression.tap`。独立Claude ZIP为10,878字节、SHA-256 `65265f872281fe7bc5f7feafb24017cd988a696d4ed0fc2717b46a5b15c8c123`；完整三插件ZIP为341,442字节、SHA-256 `ba45dfd3ab990a1a910b58291135defb3241ef24a3c19fdf25b61c2774b70852`，包含两插件0.1.1及与原发布版本逐字节一致的Codex网关。18个包内文件已核对，无测试fixture；原发布三产物hash再次核对保持原值。两个候选均未发布或安装。

用户已安装的旧CLI仍未升级，插件未装入用户宿主；APK21、原已发布三插件ZIP和当前固定网关保持原值。Android、用户原会话输入/中断/问答/审批及其他Agent真实验收继续待办；长期连接测试按用户要求暂缓。整体目标与Trellis任务保持进行中。
