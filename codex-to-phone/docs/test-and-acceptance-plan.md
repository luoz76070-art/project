# 测试与验收计划

更新时间：2026-10-22

## 当前网关优化的统一验收顺序

2026-10-22最新[Android兼容性与手机验收](audits/2026-10-22/android-compat.md)：APK25独立preview已发布，用户确认24→25 App内升级成功且原连接保留；DeepSeek空闲原会话手机发送、电脑一次接收、手机完整回复结束且无重复通过。完整Android lint0错误/5警告、后端321/321、手机46/46和两Agent短时公网只读重连通过。正式仍18；下文旧版本记录保留，当前版本/验收范围以此为准。实际授权拒绝/取消后继续、Codex普通控制本轮新增证据、两Agent追加/中断/审批及Android前后台/切网/电脑睡眠仍待验，长期测试继续暂缓。

最新[当前会话手机验收](audits/2026-10-21/current-session-phone-acceptance.md)：用户报告`v1.3.0-deepseek-dedup-preview`，明确使用当前开发会话，已取代此前等待版本和空白会话的条件。第一张异步选择卡已由用户确认手机显示/提交，原题回复与公网权威移除通过；重新订阅未重新出现，后台/切网卡仍待用户结果。原会话指定不等于授权助手代答、自动审批或中断自己的开发任务。

最新[固定运行包兼容更新](audits/2026-10-21/agent-compat-runtime-upgrade.md)已按用户既有授权切换，备份/正常回退/二次切换、10项本地公网状态检查与配置保持通过。实际手机v1协议17.34秒的完整/增量快照、心跳及当前手机解码器还原通过，只证明真实只读传输；Android渲染、原请求写入、宿主插件安装与后台托管仍未验收，不把下文历史“未切换”继续当作当前状态。

此节用于v1.2.2之后的开发版本，优先于下方早期烟测示例。源码/隔离回归和浏览器合成验收已通过，真实原会话、插件安装和Android仍待办；不把独立CLI/SDK新建或resume/fork的会话当成Desktop原会话验证。生产APK仍1.2.2/versionCode18。按照用户安排，全部开发准备完成后统一实测，长期连接测试暂不开。

2026-10-21 用户已授权空白工程、手机安装和网关切换：当前APK21独立预览与Mac网关升级已经交付，公网下载与连接健康核对通过，详见[最新交接](audits/2026-10-21/deepseek-dedup.md)。[DeepSeek官方运行时复核](audits/2026-10-21/deepseek-official-runtime.md)进一步以真实Loader/内存Session/事件总线和生产AgentLoop验证13项，模型响应仅由本地fixture提供。逐帧revision缺陷已修复为独立插件0.1.1，22项回归通过；用户原dsh与真实provider仍待验。手机版本与测试会话现按本节最新确认执行；长期连接继续暂缓。

后续[Claude官方运行时复核](audits/2026-10-21/claude-official-runtime.md)补齐兼容版本严格校验与7项无模型测试，修复helper命名导致的沙箱加载错误，独立插件0.1.1及31项合成回归通过。未升级用户旧CLI，Classic原面板问答/审批、真实取消/两端先答和Android仍须单列实测，不能将静态识别或沙箱API应答替代原会话验收。

后续[OpenCode官方服务复核](audits/2026-10-21/opencode-official-runtime.md)以本机2.0.16、自建HOME/XDG/数据库及simulation验证12项，生产适配器原字段问答、owner先答、空闲中断与15秒心跳通过；修复官方nullable cursor后合成34/34。脚本只创建自身空白fixture、不提交prompt，不计用户原会话发送/真实输出/审批、Android或长期连接验收。

原生网关[可选macOS后台托管](audits/2026-10-21/gateway-service.md)已有插件0.2.0本地候选，26项隔离检查及真实plutil解析通过；没有真实bootstrap/bootout。用户明确启用后另验登录启动、异常恢复、正常stop保持停止/start恢复、卸载保留配置/设备及公网健康，不能把loaded=true当作Tunnel在线。

1. 固定候选包与回退点。保留`codex-to-phone-v1.2.2`及本地备份；记录候选Git状态、构建资源hash和宿主版本。现有两个Mac App与辅助功能授权保留，单实例网关迁移按[插件说明](../plugins/mobile-codex/README.md)安排，避免端口冲突。安装/停旧服务/部署另行执行，隔离检查不代替迁移。
2. 先验原宿主。Codex必须是目标原会话与原任务；OpenCode使用已存在的v2.0.16 `/api/`服务，先核验info版本；普通question表单与暂不支持的复杂表单分别验收；Claude宿主需满足2.1.x且patch>=287，并对照固定2.1.277生成API声明通过兼容宿主的官方plugin validate。本机2.1.220不满足，不自动升级或绕过版本门；未加载插件的进程不称已接管。
3. 在用户指定的原会话中执行下表，优先使用可丢弃工程；本轮用户已指定当前开发会话，先验证无副作用的问答，不自发中断或审批。真实发送/中断/审批不放入自动隔离测试；逐项记录实际宿主、所选原会话、任务终态和脱敏证据，不在日志或文档保存凭证/私有问答正文。
4. 再构建升级候选APK。沿用applicationId与签名，递增versionCode，检查包内资源和双更新通道地址。先验证从1.2.2覆盖安装可保留连接档案/设备配对，再验证应用内更新；本地构建不能记成线上可下载。
5. Android使用移动数据或不同Wi-Fi连接公网Broker，验收键盘/字体/前后台/切网/短时断网，记录连接恢复时间与重复提交次数。一次性短流程通过后再决定是否迁移生产；长期驻留另按用户指定时间单独安排。

| 场景 | 通过标准 | 当前证据与未验证项 |
| --- | --- | --- |
| 手机方案选择 | 显示题目/选项说明/允许时的自由回答；显式提交回到原请求；桌面已处理/取消后移除；不会创建替代会话 | 当前Codex异步原题手机显示/提交、原题回复及权威移除通过；其他题型、两端先答/取消仍待实测 |
| 实时工作状态 | 思考/执行/可见文本增量/等待处理/真实终态与宿主一致，恢复时先核验而非沿用旧状态 | 合成通过；真实宿主及手机后台节流待验 |
| 普通控制 | 对选定会话发送；支持时追加，Claude仅排队；原任务中断等匹配终态；未知结果不自动重放 | DeepSeek普通收发用户确认同一会话完整且无重复；Codex本轮普通控制、两Agent追加/中断等仍待验 |
| 工具审批 | 完整展示命令/目录/差异或权限；仅提供原请求允许的决定；Claude只本次允许/拒绝；请求变化/失联失效 | 合成通过；真实工具与桌面竞争待验 |
| 网关管理 | 只有一个Relay/Tunnel；配对一次有效、撤销立即生效；状态查询不启动模型 | 临时目录/端口隔离通过；Mac固定网关迁移/升级及配置保持已核对，宿主插件实际安装仍待验 |
| 升级与公网 | 旧版覆盖升级保留配置，两个更新通道可用；外网连接、切网和后台恢复无重复输入 | APK25已发布；用户确认24→25 App内升级及原连接保留，短时公网只读重连通过；切网/后台等分支待验，正式仍18 |

任何原会话误路由、未知结果被重发、卡片错代次、权限范围缺失或升级丢档案都停止该候选交付，保留证据并回到修复；不以切换UI输入/新CLI会话掩盖失败。完成记录区分源码/合成、真实只读、真实写入、Android及部署五种证据。阶段进度见[Agent网关](agent-gateway.md)，既有优化真机流程见[交付记录](audits/2026-10-20/delivery.md)。

## 基本原则

- 每一阶段都要有烟测。
- 任何“已完成”必须能被命令或真机操作复现。
- 本地可测先本地测，手机能测必须真机测。
- 测试结果追加到 `docs/smoke-tests.md`。
- 不以“看起来应该可以”作为完成标准。

## Relay 基础烟测

命令：

```powershell
pnpm --filter @mobile-codex/relay typecheck
pnpm --filter @mobile-codex/relay build
```

运行 Relay 后测试：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
Invoke-RestMethod -Headers @{ Authorization = "Bearer <token>" } http://127.0.0.1:8787/api/threads?limit=1
Invoke-RestMethod -Headers @{ Authorization = "Bearer <token>" } http://127.0.0.1:8787/api/live/health
```

通过标准：

- `/health` 返回 `ok=true`。
- `/api/threads` 返回线程数组。
- `/api/live/health` 返回 `ok=true` 和 `mode=app-server-ws`。
- Relay 不崩溃。

## App Server 协议烟测

命令：

```powershell
pnpm --filter @mobile-codex/relay appserver:smoke
pnpm --filter @mobile-codex/relay appserver:read-smoke
pnpm --filter @mobile-codex/relay appserver:turn-smoke
```

通过标准：

- 能列出线程。
- 能读取指定线程。
- 能启动一个测试 turn 并收到预期回复。

注意：

- `turn-smoke` 会创建测试线程，不能高频乱跑。

## Mobile 前端烟测

命令：

```powershell
pnpm --filter @mobile-codex/mobile typecheck
pnpm --filter @mobile-codex/mobile build
```

通过标准：

- TypeScript 无错误。
- Vite build 成功。
- 资源输出到 `apps/mobile/dist`。

## APK 构建验收

命令：

```powershell
.\scripts\build-debug-apk.ps1
.\.tools\android-sdk\build-tools\34.0.0\apksigner.bat verify --verbose .\dist-apk\mobile-codex-debug.apk
```

通过标准：

- APK 输出到 `dist-apk/mobile-codex-debug.apk`。
- v1/v2 签名验证为 true。
- APK 内置最新 JS/CSS 资源。
- Capacitor 配置符合当前网络方案。

## UI 验收

每次大改 UI 后必须检查：

- 竖屏 360px 宽度可用。
- 竖屏 430px 宽度可用。
- 横屏或平板宽度出现左右分屏。
- 文本不溢出按钮。
- 长路径不撑爆布局。
- 长工具输出可滚动或折叠。
- 打开线程自动滚到底部。
- 上拉历史不会被自动拉回底部。
- 白天主题可读。
- 黑夜主题可读。
- 设置面板能打开和关闭。

## 手机真机验收

操作流程：

1. 电脑启动 Relay。
2. 手机安装最新 APK。
3. 手机和电脑在同一网络或 Tailscale 网络。
4. 在设置中填 Endpoint 和 Token。
5. 执行连接测试。
6. 返回工作台。
7. 打开最近线程。
8. 确认自动定位最新消息。
9. 上拉查看历史。
10. 发送一条测试消息。
11. 确认收到 Codex 回复。
12. 刷新线程，确认消息仍在。

通过标准：

- 每一步都能完成。
- 失败时有明确错误。
- App 不白屏、不闪退。
- Relay 日志能对应看到请求。

## 回归测试记录格式

追加到 `docs/smoke-tests.md`：

```text
## YYYY-MM-DD 测试名称

命令/操作：
- ...

结果：
- ...

结论：
- 通过 / 未通过

遗留问题：
- ...
```

## 不通过定义

以下情况不能算完成：

- 只能浏览器访问，APK 不可用。
- 只能新建独立 CLI 会话，不能读取 Codex Desktop 历史线程。
- 只能看历史，不能继续发送。
- UI 首页仍以诊断为主。
- 手机端无法解释失败原因。
- 没有测试记录。
