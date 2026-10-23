# OpenCode 官方服务隔离复核（2026-10-21）

本轮以本机安装的OpenCode 2.0.16和已固定的官方源码commit `3a103fe0aff726a4edc7492f03f7b88195d9e4c9`核对实际服务接口。没有下载、安装或升级Agent；本机二进制SHA-256为`27aff98364f326b929a86ebd013c44c9b2ea60bd90e1c2f219e236cd0932e70f`。版本与serve帮助的隔离记录在`output/audit/2026-10-21/opencode-official-runtime-preflight.json`。

新增显式检查器：

```sh
corepack pnpm --filter @mobile-codex/relay build
node scripts/check-opencode-runtime.mjs /absolute/path/to/opencode
```

检查器创建独立HOME、XDG、配置、工作目录、TMPDIR及数据库；白名单环境不继承模型密钥，禁用项目配置、模型目录抓取和文件监控。前台`serve --hostname 127.0.0.1 --port 0`使用自有随机密码，不用service/恢复模式。官方`OPENCODE_SIMULATE=1`以内存路由替换Effect HTTP客户端，未知出站目的地拒绝；检查器不设置Drive、不提交prompt或执行模型/工具任务。仅测试owner在自建数据库创建空白fixture及表单，生产适配器仍只操作已存在会话。退出停止自有子进程并删除临时目录。

首次实际检查在空列表解码失败。官方返回`{"data":[],"cursor":{"previous":null,"next":null}}`，会话与消息分页的共用Zod schema却只接受省略或字符串，故报告`OPENCODE_PROTOCOL_ERROR`。既有合成服务用`cursor:{}`，未覆盖此情况。实际响应及失败栈保存在`opencode-official-runtime-null-cursor.json`；新增列表/订阅/历史与边界校验两项回归，修复前均失败，证据为`opencode-null-cursor-before.tap`。

修复仅在`apps/relay/src/agents/openCodeProtocol.ts`的cursorSchema允许nullish值。原8192字符上限和类型检查保留；适配器原有`?? null`与真假值判断可直接处理，无需修改手机或写接口。回归覆盖字段省略、双null、字符串/null混合、非法类型及超长值。

最终官方服务12/12通过：

- 固定版本、前台loopback服务及独立临时根路径。
- info/session/event未认证401、错误密码401及正确Basic Auth。
- 生产适配器的空会话列表、active响应和nullable cursor解码。
- 自有fixture、精确目录筛选与官方分页游标继续读取。
- 生产SSE初始化及空会话快照/能力。
- 空闲interrupt返回false，适配器明确拒绝且不留未知写锁。
- question表单经原SSE出现，手机标签转换为原字段key/option.value提交，官方状态保存精确答案并清卡片。
- 复杂约束表单在适配器拒绝，测试owner处理后卡片移除。
- owner先回答的普通表单拒绝迟到手机回答，官方原答案保持。
- 真实15秒注释heartbeat被收到，生产SSE仍连接。
- 取消订阅后旧控制令牌失效，重连取得新令牌且原已答表单不复活。
- 产品调用记录中无create/fork/resume或模型prompt。

最终证据`output/audit/2026-10-21/opencode-official-runtime.json`。OpenCode34/34及三Agent合并87/87（OpenCode34、Claude31、DeepSeek22）通过，日志分别为`opencode-null-cursor-after.tap`和`agent-official-fixes-regression.tap`。Relay构建、类型检查、脚本语法与独立插件构建通过；新的候选bundle还通过managed gateway10/10隔离检查，日志为`opencode-candidate-managed-gateway.tap`。本轮没有手机源码变更，因此未重打APK或重复浏览器检查。仓库无独立lint命令。

本地候选位于`output/delivery/2026-10-21/opencode-cursor-fix/mobile-codex-agent-plugins-opencode-fix.zip`，340,706字节，SHA-256 `f3dc80f19decc27d751614c0d92395c2e63d097358f1c6c0fc00f7ad594f5c40`。包含此前Claude/DeepSeek 0.1.1修复及本次网关；18个文件与构建逐字节一致，无测试fixture。相对上一Claude候选只有gateway.mjs内容改变，未覆盖旧候选或已发布包。详情见同目录manifest.json。

`opencode-official-runtime-verification.json`另核对源码/检查器hash与候选一致，并实读固定运行网关及APK21本地原件hash，均保持此前发布值。

已发布APK21、当前固定运行网关和用户Agent配置未变。官方simulation及脚本自有fixture的检查不计用户原会话发送、真实provider、工具审批、输出流或Android验收；15秒heartbeat检查也不是用户暂缓的长期测试。整体目标与Trellis任务继续in_progress，待手机版本/可丢弃测试原会话及真实联测。
