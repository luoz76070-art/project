# 公网连接维护与回退

适用于已有 HTTPS Broker、systemd 服务和 Mac Relay 的环境。先记录实际主机、服务名、发布目录及配置；凭证与私钥只保留在所属机器，不写进日志或仓库。

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

## 回退边界

- Broker 回退前先停止新 Mac Tunnel，恢复原 Broker WorkingDirectory/环境，再启动原 Mac App；旧 Broker 不一定认识新 Tunnel 的 header 握手。
- 保留已经修好的有效 TLS 和续期安排，不因应用回退重新使用过期证书。
- 当前发布的 drop-in、环境文件、备份路径及检查结果应写进每次 incident 记录，且只移动本次创建的文件。服务切换可回退不代表已做真实故障回退演练。
- APK 发布独立处理；修复服务器证书或 Broker 不要求重新安装同一 APK。Mac 关机、深度睡眠或断网时仍无法实时连接。
