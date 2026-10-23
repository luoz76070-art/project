# 公网连接维护与回退

适用于已有 HTTPS Broker、systemd 服务和 Mac Relay 的环境。先记录实际主机、服务名、发布目录及配置；凭证与私钥只保留在所属机器，不写进日志或仓库。

## 当前原生网关与旧 App 清理

当前Mac使用单Node固定网关：`~/Library/Application Support/Mobile Codex Gateway/releases/<固定版本>/mobile-codex/lib/gateway.mjs`。配置为`~/Library/Application Support/Mobile Codex Gateway/gateway.json`，日志为同目录`gateway.log`；固定包内`scripts/mobile-codex.mjs status/start/stop`沿用默认配置。当前未启用LaunchAgent，退出或重启电脑后须显式start；安装插件本身也不会启用自启动。

清理旧App前，核对监听PID的完整路径、bundle SHA和`/api/gateway`的native模式，再确认旧Relay/Input进程和旧`local.mobile-codex.relay`登录服务均未运行。仅对已识别的生成App制作私有压缩归档，逐文件核对内容与权限后移除；保留旧配置、源码及打包入口。不在备份目录留可误启的同名App副本。无法读取完整系统后台项目清单时记为未知，不等同于所有登录项均不存在。

清理后确认同PID/instanceId、本地/公网鉴权及IPC健康，配置和设备文件状态保持。需要回退时先正常停止原生网关并确认端口释放，再恢复归档中的两个App；不能与当前网关同时启动。辅助功能说明仅适用于下述旧UI注入路径，当前native通道无需两个App。实际清理见[2026-10-21记录](../audits/2026-10-21/legacy-mac-app-cleanup.md)。

## 固定网关更新与退出核验

APK预览发布前，从上一轮发布记录核对实际SSH别名与IdentityFile，并先只读比较远端和公网清单SHA；不能只用公开域名和默认密钥猜测登录。2026-10-23语音发布复用原子脚本，preview26/previous25，详见[发布记录](../audits/2026-10-23/voice-release.md)。

更新前读取实际运行命令、instanceId及唯一监听PID，核对候选bundle SHA/逐文件内容，私有备份配置、设备状态及原固定入口。凭证在脚本进程内读取，只放鉴权header，不打印或放命令参数。通过原instance绑定的管理stop后，分别等待原PID自然退出和监听释放，再启动核验的新固定入口；202或端口空闲不代表退出完成。启动后核对新PID/instance、Tunnel connected、本地/公网200、无凭证401、Android预检、IPC和配置/设备状态。

若旧版释放端口后仍持有到Harness的SSE，保留失败记录，停止重复发stop或并行启动。已授权的恢复可通过官方Harness插件页仅停用再启用`dsh-mobile-codex`，确认原网关自然退出、原宿主PID保持且bridge恢复后启动固定网关；不退出Harness、不处理权限、不停止原任务或全局kill。插件重新加载可能改变会话别名，手机返回列表重新打开。恢复另存记录，不覆盖失败。此操作只用于已确认的旧版残留，不作为新版正常停止步骤。

新版使用`preClose`统一取消适配器，独立daemon隔离回归及真实只读活动流自然退出/重启已通过；一次样本不能替代长期连接验收。回退前先检查配置后续变更，正常停止并确认当前PID/端口都释放，才从备份原入口start；不覆盖新凭证或设备文件。具体固定版本、备份与证据见[2026-10-22退出修复](../audits/2026-10-22/gateway-shutdown.md)。

2026-10-23从项目分组固定网关升级语音时，原版接受stop后仍残留4条DeepSeek连接；按上节仅重载原桥接恢复，原Harness进程保持。本次再次说明关闭顺序修复未覆盖全部长期残留，失败/恢复另存，不应在切换脚本中跳过PID退出检查或自动强退。

## DeepSeek原插件升级与历史范围

升级沿用原Harness profile和既有无运行依赖插件链接，目录名称可能保留旧版本，实际以package.json/逐文件SHA与鉴权info为准。备份原插件8文件、profile package/patch/lock、两份私有配置和设备存在状态。通过官方插件页仅停用手机桥接后原子替换发布文件（manifest最后），启用后核对原宿主PID及`scope=all/history=true/interactions=true`；不重启宿主、不处理其权限或任务。新配置仅增加scope，不重新生成凭证或安装重复peer。

默认近30天是下发列表过滤，官方仍list全部摘要并缓存15秒；创建/可见消息/status只使缓存失效，下次手机请求再读取。手机仅DeepSeek列表前台每30秒及回前台刷新，无后台全正文扫描。只读历史走官方page，不能用会自动promote prepared线程的follow。历史仅普通用户/助手文本，32768字符/条；子Agent、多profile和附件不计完整支持。

更新网关仍遵循上节原instance stop、PID退出与端口释放的顺序。检查本地/公网recent与all全分页、另一工作区的历史/重连、鉴权/CORS、Codex IPC及两份配置仅scope改变。无实际30天以前数据时以合成验证筛选，不伪称真实时间边界验收；原会话发送与权限决定交给用户。

回退需匹配网关、插件及scope配置，旧网关不直接搭配新历史游标协议。正常stop当前网关，确认PID/监听都释放，在官方UI仅停用手机桥接后恢复已核验旧插件和模式，启用后再start匹配入口。若配置在升级后变过，只撤销本轮scope变更，保留新凭证/设备；不能盲覆盖整个旧配置。固定入口、私有备份及本轮只读/发布证据见[2026-10-22历史交付](../audits/2026-10-22/deepseek-history.md)。该流程未做真实故障回退演练。

## 故障定位

按手机 → HTTPS → Broker → Tunnel → 本地 Relay 顺序检查：

1. 从手机配置或 Mac 共享配置取得完整 Endpoint，形如 `https://<host>/<prefix>/r/<relayId>`。仅填写域名或端口不能定位 Relay。
2. 使用正常证书校验检查证书有效期、主机名和证书链。TLS 错误必须修复证书，不关闭客户端校验。
3. Broker `/health` 检查 `connectedRelayCount`；本地及公网 `/api/connection` 带现有 Token 应返回 `{ "ok": true, "authenticated": true }`，不带 Token 应为 401。通过程序从配置读凭证，不放进命令参数、截图或打印输出。
4. 检查监听进程的真实工作目录和 App 的 `MobileCodexProjectRoot`。源码目录已优化不代表正在运行的 App 已切换。
5. 连接检查无需请求线程、`/api/status` 或提交真实模型任务。合成测试与真实控制验收分开记录。

## Mac 输入权限

`Accessibility permission is not granted for Mobile Codex Input.app` 是原生输入权限检查失败；`/api/connection` 正常不表示可以控制 Desktop。当前实现由 Relay 子进程直接启动 helper，macOS 的 TCC 责任归属可能是 Relay。2026-10-20 真实手机请求的系统日志记录 `responsible=local.mobile-codex.relay`，曾出现 Relay 授权记录指向旧工程目录的情况。

1. 查看正在运行的 Relay 完整路径，以及该工程中的 Input helper，避免误选同名旧副本。
2. 用户在“系统设置 → 隐私与安全性 → 辅助功能”中为当前 `Mobile Codex Relay.app` 和 `Mobile Codex Input.app` 手动授权。若已开仍失败，移除旧项后重新添加当前副本；重新构建的签名变化也需要核对。助手不能代替用户开启电脑控制权限。
3. 空文本、过期请求可验证 helper 在粘贴/回车前的检查，但通过开发工具直接启动时，其 TCC 责任归属可能是开发工具，不能用这个结果判定生产 Relay 是否已授权。不要为了让这项诊断通过而给开发工具新增控制权限。
4. 必须在相同启动链路下验证；否则把真实手机手动重试保留为待验收。先查看目标线程，避免误重发；不自动提交任何真实输入，不更改 TCC 数据库，也不以 AppleScript 换方法重放失败输入。

## 长期连接机制与验收

当前代码支持前台持续连接，未设置正常活跃流的固定总时长截止：

- Mac→Broker：WSS 每 15 秒 ping/pong，未响应时通常约两个周期终止旧连接；以抖动和指数退避重连，等待预算上限 30 秒。
- Relay→手机：SSE 每 15 秒 ping；Broker/Tunnel 的 180 秒是空闲截止，收到响应块会刷新，并非 3 分钟强制断开。
- 手机前台：45 秒无有效消息/心跳会进入恢复，重新取得流 token；重试等待上限 15 秒。401/403 停止重试，避免无效鉴权循环。
- 手机后台：主动关闭 SSE；重新进入前台恢复。当前没有 Android 常驻前台服务，不保证锁屏后台永久不断线。
- Mac App：15 秒健康探测、异常子进程退避重启、唤醒探测。服务可用仍要求电脑开机、网络可达且 Relay 正在运行；睡眠期间不能远程执行，唤醒恢复需要真机验证。当前实现不会自动注册登录项或更改系统休眠设置。

隔离回归与源码检查只能确认上述机制，不能替代真实移动网络、睡眠唤醒或 2/24 小时测试。长期测试需单独约定时长与边界，记录成功率、断连次数、恢复耗时、资源趋势和手机前后台行为。2026-10-20 用户明确选择暂不开启长期测试，未启动持续探测或自动化。

## 证书修复

- 先备份 Nginx 配置、证书和服务配置，备份目录仅管理员可读。确认公共 DNS 的 A/AAAA 指向，不能只依赖被 `/etc/hosts` 覆盖的解析结果。
- certbot webroot 使用 `/.well-known/acme-challenge/`。HTTP server 级直接 `return 301` 时，需将重定向放进 `location /`，才能让 challenge location 直接返回文件；先从外部验证一个随机测试文件，再申请证书。
- 复用现有 ACME account 和已配置域名，避免改动其他站点。核对证书 SAN、有效期及私钥匹配，`nginx -t` 成功后 graceful reload；从外部再次严格检查 HTTPS。
- 若 ACME/npm 报连接本机代理端口被拒绝，检查此次命令继承的代理环境。可仅为维护子进程去掉代理变量，不改全局网络设置。
- 配置 certbot deploy hook 执行 `nginx -t` 和 reload，确认续期 timer 为 enabled/active。续期服务不要继承失效代理。对目标 cert-name 执行一次 `certbot renew --cert-name <name> --dry-run --non-interactive --no-random-sleep-on-renew`，单独验证 hook 命令可以成功。
- 失败时恢复刚修改的配置并再次检查；恢复过期证书只能恢复原状，不能称为连接问题已修复。

## Broker 与 Mac 切换

1. 保留原发布目录和服务环境。编译产物、package manifests 和 lockfile 打包后核对 SHA；不要上传 Mac 的 node_modules。
2. 在独立 Linux 发布目录用项目指定的 pnpm 安装：`corepack pnpm install --prod --filter @mobile-codex/relay --frozen-lockfile`。
3. 先在随机本机端口启动合成 Broker/Tunnel，验证 header 鉴权、普通响应、401 和 EOF 之前可读取 SSE 首块。临时服务检查结束后全部关闭。
4. 新 Broker 要求配置 `MOBILE_CODEX_BROKER_RELAYS`，复用现有 Relay ID/Secret；密钥环境文件设为 0600，生产环境关闭动态 Relay。用 systemd drop-in 切 WorkingDirectory，保留原 unit，重启后检查 `/health` 和进程 cwd；失败移开此次 drop-in 并恢复原服务。
5. 顺序为 Broker → Tunnel/Mac。新 Tunnel 使用 Authorization header，不能先切到只接受 query secret 的旧 Broker。
6. 先通过旧 Mac App 的 Stop Relay 停止它持有的子进程，确认端口释放，再退出旧 App 并用绝对路径打开新 App。旧 App 无退出入口时，只可结束已核实完整路径且已停止服务的 App PID；不可按端口任意杀进程或全局 pkill。
7. 复用共享配置，检查本地与公网 `/api/connection`、无 Token 的 401、Android Origin 的 OPTIONS 预检和 Mac 界面的 Remote 状态。向用户提供完整 Endpoint，并让手机重试；电脑端成功不能代替真机验收。

## 切换到插件管理网关

适用于已完成隔离验证、用户明确同意切换的候选包。先保留旧 App、配置、设备文件和原发布 dist，再将已核验 ZIP 展开到独立版本目录；不要从会持续重建的源码 dist 启动候选。

1. 用原工程绝对路径作为 `init --workspace`，显式 `--import-legacy` 导入旧配置。测试工程单独建立，不能为了测试改 workspace 而丢失 `.mobile-codex/devices.json` 的位置。比对原 Token、端口、Broker、Relay ID/Secret 与设备文件，配置权限保持 0600。
   首次设备配对前 `devices.json` 可以不存在。升级前记录文件是否存在及鉴权设备列表数量；不存在且列表为空时保留该状态，不创建空文件，也不把“没有文件”写成“已备份设备文件”。
2. 先检查实际监听者、App 完整路径、工作目录及父子进程。按绝对路径定位 App；按应用名打开可能启动旧目录的同名副本，导致多个 Tunnel 争用同一 Relay ID。优先正常 Stop/退出；界面状态与实际进程不符时，只对刚核实的旧 App 及其直属 Relay/Tunnel 发终止信号，不能按端口任意杀进程。确认旧副本均已退出且端口释放，再运行候选 CLI 的 start。
3. 验证本地及公网 `/api/connection`、未认证 401、Android Origin OPTIONS、`/api/gateway` 的 native 模式及 connected Tunnel，另核对 Desktop IPC 健康状态。短时 HTTP 成功不能代替 SSE、真实写入或长期稳定性验收。新网关未注册自启动，退出后需显式 start。
4. 先给手机提供独立预览下载：复用 APK 发布入口，将 release dir 和 base URL 指向既有静态资源下的 `android/preview` 子目录。只切预览目录自己的 latest，不覆盖正式 Android/hot 清单；从公网完整下载后核对 SHA、大小、CORS 与正式清单未变化。手机覆盖安装保留数据。
5. 回退先用候选自身 CLI 的 stop，确认实例退出和端口释放，再恢复原运行文件及经核实的原 App 启动链。旧发布 dist 与切换前磁盘 dist 分开备份；恢复范围限于生成文件，不回退用户源码或改变 App 签名/权限。记录“备份已准备”与“真实回退已演练”的差别。

2026-10-21 的实际迁移、同名副本争用修正及剩余验收见[候选迁移记录](../audits/2026-10-21/gateway-migration.md)。此流程不要求重启 Codex，也不通过独立 CLI 会话替代 Desktop 原会话验收。

## 回退边界

- 2026-10-23语音质量更新再次发生旧网关停止后持有到Harness9876的连接、20秒未退出；官方仅重载原dsh-mobile-codex手机桥接后自然退出，再启动新固定网关，约3分钟离线。84健康/17重连和配置/设备/Key/Harness保持通过，隔离30项通过不能视作此残留已根治；失败/恢复及当前入口见[语音实测](../audits/2026-10-23/voice-live.md)。后续升级先审查此风险，不能强杀宿主或重跑旧state切换。此次ASR上线与第三方DeepSeek生成502分别记录，模型服务故障不通过反复重启网关处理。

- 2026-10-22项目分组交付复用上述固定网关/独立预览流程：新bundle`58fef1a52eaf`，仅更新网关程序，DeepSeek插件/profile/配置保持；Codex近期69/全部126及DeepSeek11/3项目只读通过。APK23独立preview，previous22，正式18/hot保持。当前入口、私有备份与待手机验收见[项目分组记录](../audits/2026-10-22/project-groups.md)；回退不恢复上轮旧scope配置，不停止Harness。
- 更新已运行的原生固定网关时，继续使用已核验ZIP的独立版本目录。先私有备份原固定版本、配置及实际存在的设备文件；按原instanceId正常停止，并分别等待端口释放与旧进程退出，再启动新固定版本。端口释放不等于操作系统已移除旧进程，不能立即据此宣告进程检查失败。失败回退也须先确认候选停止，避免第二个Tunnel。2026-10-21的实际切换/正常回退及鉴权检查见[兼容更新记录](../audits/2026-10-21/agent-compat-runtime-upgrade.md)。此流程不隐式启用service或安装宿主插件。
- Broker 回退前先停止新 Mac Tunnel，恢复原 Broker WorkingDirectory/环境，再启动原 Mac App；旧 Broker 不一定认识新 Tunnel 的 header 握手。
- 保留已经修好的有效 TLS 和续期安排，不因应用回退重新使用过期证书。
- 当前发布的 drop-in、环境文件、备份路径及检查结果应写进每次 incident 记录，且只移动本次创建的文件。服务切换可回退不代表已做真实故障回退演练。
- APK 发布独立处理；修复服务器证书或 Broker 不要求重新安装同一 APK。Mac 关机、深度睡眠或断网时仍无法实时连接。
