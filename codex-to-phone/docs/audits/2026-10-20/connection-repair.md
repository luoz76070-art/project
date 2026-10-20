# 首次手机公网连接故障修复

> 公开源码说明使用示例域名；实际部署地址及原始操作记录仅保留在本地。

2026-10-20 用户明确授权执行证书修复、Broker 升级和 Mac Relay 切换。此次授权只覆盖连接修复；没有发布 APK、注册登录项或执行真实 Desktop 输入/模型任务。

## 根因与结果

| 问题 | 已执行修复 | 证据 |
| --- | --- | --- |
| TLS 证书于北京时间 2026-10-18 07:59:59 到期 | 复用现有 ACME account，webroot 签发根域名与 www 证书，Nginx 验证后 reload | 两个主机严格 TLS 校验通过；新证书到期时间为 2027-01-18 08:13:56 UTC |
| 维护命令继承失效的本机代理，ACME/npm 连接被拒绝 | 仅对维护子进程清除代理变量；续期服务加空代理环境覆盖 | ACME 签发、frozen lockfile 安装及续期 dry-run 成功 |
| 公网 Broker 仍为旧版本 | 发布到独立版本目录，以 systemd drop-in 切换并加载原 Relay Secret | 新版 health 返回 connectedRelayCount=1；进程 cwd 为新 release |
| Mac 运行旧工程，鉴权 `/api/connection` 为 404 | 旧 App 自身 Stop 后确认端口释放，退出已核实的旧 App，启动当前工程 App | 当前工程监听 8787；本地和远程 `/api/connection` 为 200；界面 Relay/Remote 均 reachable |

## 验证与边界

- 发布包 SHA-256：`210610fcf7085f58179d4518f72a7a13aff327a6d5b92d3327c9b423804098bf`；Linux 使用 pnpm 10.20.0 安装 52 个生产依赖，lockfile 未变化。
- 服务器随机端口合成 Broker/Tunnel：header 鉴权、无 Token 401、普通 JSON 和 SSE 通过；首块 4 ms、响应结束 755 ms。该数字仅代表服务器本机合成链路。
- 正式链路：本地 `/api/connection` 200，单次 11 ms；公网同接口 200，单次 452 ms；无 Token 401；Android `https://localhost` Origin 预检 204，允许 authorization。数字不代表手机网络长期延迟。
- Nginx 配置检查、Broker/Nginx active、certbot timer enabled/active、目标证书 dry-run 均通过；续期 deploy hook 会先检查 Nginx 再 reload。
- 原手机 Token、Relay ID/Secret 继续使用；未在文档中记录秘密。手机需使用 Mac App 显示的完整 Remote Endpoint，不要求同一 Wi-Fi。
- 真机重试、真实发送/附件、网络切换、睡眠唤醒、Windows 和长期资源测试仍待验收。没有因电脑侧连接检查成功而标记整个优化任务完成。

机器可读结果：`output/audit/2026-10-20/connection-repair-result.json`；初始诊断：`connection-incident.json`；发布清单和隔离脚本：`output/deploy/2026-10-20/`。这些 output 产物均未入 Git。

## 当前发布与回退点

- 服务器备份：`/root/mobile-codex-repair/20261020T090939Z`，包含原 Nginx 配置、证书、Broker unit 和旧发布目录副本；仅管理员可读。
- 新 Broker：`/opt/mobile-codex-broker-releases/20261020-1.2.0-optimization`。
- Broker drop-in：`/etc/systemd/system/mobile-codex-broker.service.d/50-optimization-release.conf`；凭证环境文件：`/etc/mobile-codex-broker/relays.env`，0600。
- 证书：`/etc/letsencrypt/live/broker.example.com/`；续期 hook：`/etc/letsencrypt/renewal-hooks/deploy/50-mobile-codex-nginx-reload`；续期服务代理覆盖：`/etc/systemd/system/certbot-renew.service.d/50-mobile-codex-direct-network.conf`。
- Mac：当前工程 `Mobile Codex Relay.app`；共享配置继续使用 `~/Library/Application Support/Mobile Codex Relay/config.json`。
- 应用回退时先停止新 Mac App，把本次 Broker drop-in 和环境文件移动到上述备份目录，`systemctl daemon-reload` 后重启 Broker，确认 cwd 回到 `/opt/mobile-codex-broker`，再启动原 Mac App。保留有效证书及续期配置。此回退路径已准备，未对正常生产链路演练回退。

后续同类维护复用 [公网连接维护与回退](../../ops/remote-connection-repair.md)。本次没有提交、推送、创建分支或 PR。
