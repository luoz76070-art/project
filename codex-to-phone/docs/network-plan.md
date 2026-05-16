# 网络路线规划

更新时间：2026-05-12 17:10

## 当前已验证路线

当前本地路线已经打通：

```text
Android APK / 手机浏览器
  http://电脑局域网IP:8787
        |
        v
Windows Relay
  MOBILE_CODEX_HOST=0.0.0.0
  MOBILE_CODEX_PORT=8787
  Bearer Token
        |
        v
Codex app-server loopback
  ws://127.0.0.1:<随机端口>
        |
        v
C:\Users\<YOU>\.codex
```

手机端填写：

```text
Endpoint: http://电脑局域网IP:8787
Token: .env.local 或脚本里设置的 MOBILE_CODEX_TOKEN
```

当前电脑已验证过的局域网 IP 包括：

```text
192.168.6.43
```

实际使用时以 `start-relay.bat` 打印出来的 endpoint 为准。

## 本地运行原则

- Relay 监听 `0.0.0.0:8787`，方便同一局域网手机访问。
- Codex app-server 只监听 `127.0.0.1:<随机端口>`，不暴露给局域网。
- 手机只访问 Relay，不直接访问 Codex app-server。
- Relay 必须带 Bearer Token。
- 手机 APK 使用 Capacitor 原生 HTTP，避免 Android WebView 明文局域网 fetch 问题。

## 常见故障判断

### 手机浏览器打不开 `/health`

优先检查：

- `start-relay.bat` 窗口是否还开着。
- 手机和电脑是否在同一网络。
- 手机填的是不是 `http://电脑IP:8787`。
- Windows 防火墙是否允许 Node.js 入站。

### 手机浏览器能打开，但 APK 不通

优先检查：

- 是否安装的是最新 APK。
- APK 是否已经包含 Capacitor 原生 HTTP 配置。
- App 设置里的 Endpoint 是否和浏览器一致。

### `/health` 通，但 `/api/threads` 不通

优先检查：

- Token 是否正确。
- App 是否保存了旧 Token。

### `/api/threads` 通，但 `/api/live/health` 不通

优先检查：

- Codex 可执行文件是否能自动发现。
- Codex Desktop 或 Codex 安装是否升级导致路径变化。
- 查看 Relay 控制台错误。

## 未来外网访问路线，仅策划不实施

用户当前可提供：

- 电脑没有公网 IPv4。
- 电脑有公网 IPv6。
- 有自己的域名。
- 有阿里云公网 IPv4 服务器。

外网访问目标不是把 Codex app-server 直接暴露到公网，而是让手机安全访问 Windows Relay。Codex app-server 继续只监听 `127.0.0.1`。

### 路线 A：Tailscale，最低维护

适合先快速落地，不想折腾端口、证书、云服务器反代。

```text
Phone on Tailscale
  http://电脑Tailscale-IP:8787
        |
        v
Relay 只监听 Tailscale IP
        |
        v
Codex app-server loopback
```

实施前需要补：

- Relay 支持绑定指定 IP。
- 一键脚本显示 Tailscale IP。
- Token 强度提升。
- 可选设备白名单。
- 远程访问 smoke test。

### 最推荐路线：阿里云公网 IPv4 + 域名 HTTPS + FRP 反向隧道

结合当前条件，正式外网访问优先采用这条：

```text
Android APK
  https://codex.example.com
        |
        v
阿里云公网 IPv4 VPS
  Caddy 自动 HTTPS
  frps 反向隧道服务端
        |
        | 电脑主动连出，不要求家里有公网 IPv4
        v
家里 Windows 电脑
  frpc 反向隧道客户端
  Windows Relay 127.0.0.1:8787
        |
        v
Codex Desktop IPC + Codex app-server loopback
```

这是当前最合理路线，原因：

- 用户已有阿里云公网 IPv4 和域名，不需要再购买第三方服务。
- 家里电脑没有公网 IPv4也能用，因为 Windows 电脑主动连出到阿里云。
- 手机不需要装 VPN，APK 直接填 HTTPS 域名。
- 不暴露 Codex app-server，只把 Relay 放到 HTTPS 网关后面。
- FRP 是用户态进程，不需要改 Windows 网络栈，比先上 WireGuard 更不容易影响现有系统。
- 阿里云安全组可以只开放 `80/443` 和 FRP 控制端口，FRP 转出的 Relay 端口不对公网开放。

域名规划：

```text
codex.your-domain.com  A  阿里云服务器公网 IPv4
```

阿里云安全组建议：

```text
允许 TCP 80     Caddy 申请/续期证书，可选
允许 TCP 443    手机 HTTPS 访问
允许 TCP 7000   frpc 连接 frps
拒绝 TCP 18787  FRP remotePort，仅 VPS 本机 Caddy 访问
```

VPS 组件：

```text
Caddy:
  public 443 -> 127.0.0.1:18787

frps:
  bindPort = 7000
  auth token
  tls force
  allowPorts = 18787 only
```

Windows 电脑组件：

```text
Relay:
  MOBILE_CODEX_HOST=127.0.0.1
  MOBILE_CODEX_PORT=8787
  MOBILE_CODEX_TOKEN=<高强度随机 token>

frpc:
  serverAddr = 阿里云公网 IPv4
  serverPort = 7000
  localIP = 127.0.0.1
  localPort = 8787
  remotePort = 18787
```

手机端：

```text
Endpoint: https://codex.your-domain.com
Token:    MOBILE_CODEX_TOKEN
```

公网实施前必须先做的代码加固：

- `/health` 公网模式改成只返回最小信息，详细路径信息挪到带 Token 的 `/api/health/full`。
- 默认 Token 禁止继续使用 `change-me`，改成 32 字节以上随机值。
- Relay 增加 public mode 开关：`MOBILE_CODEX_PUBLIC_MODE=1`。
- public mode 下限制 CORS，或只允许 Capacitor/本机调试来源。
- public mode 下增加请求体大小限制、401 计数和基础速率限制。
- 手机端连接档案保留“局域网”和“公网”两套 Endpoint，可一键切换。

施工阶段建议：

1. 先在代码里完成公网安全加固，但不改当前本地 Relay 默认体验。
2. 在阿里云准备 Caddy + frps，并写成独立部署文档。
3. 在 Windows 项目目录加入 frpc 配置模板和 `start-public-tunnel.bat`。
4. 先从阿里云本机 `curl http://127.0.0.1:18787/health` 验证隧道。
5. 再从手机流量访问 `https://codex.your-domain.com/health`。
6. 最后在 APK 中新增公网连接档案，实测 Desktop control health、线程读取、发送、SSE/轮询。

验收标准：

- 手机关闭 Wi-Fi，只用移动网络也能连接。
- `/api/desktop/control/health` 返回 `desktop-ipc-follower-control`。
- 能打开桌面线程并看到实时增量。
- 能向桌面线程发送消息。
- Relay 和 frpc 重启后自动恢复。
- 阿里云公网只能访问 HTTPS 域名，不能直接访问 FRP remotePort。

### 路线 B：阿里云公网 IPv4 + WireGuard + HTTPS，作为增强版

适合用户希望在外地直接使用域名访问，同时电脑没有公网 IPv4 的情况。

如果后续希望安全性更强，并且可以接受 Windows 安装 WireGuard 网络适配器，则升级为：

```text
Android APK
  https://codex.your-domain.com
        |
        v
阿里云 IPv4 VPS
  Caddy/Nginx HTTPS
  WireGuard server
        |
        v
家里 Windows 电脑主动连出
  WireGuard peer
        |
        v
Windows Relay 127.0.0.1/局域网端口
        |
        v
Codex app-server 127.0.0.1
```

这个方案不要求手机装 VPN，仍然由 VPS 的 HTTPS 入口反代到 WireGuard 内网里的 Windows Relay。优点是隧道层更标准，缺点是会改 Windows 网络层，施工风险比 FRP 高。

施工原则：

- 只暴露 Relay，不暴露 Codex app-server。
- 公网入口必须 HTTPS。
- Token 必须改为高强度随机值。
- Relay 需要增加账户配置、设备记忆、Token 轮换、远程连接状态。
- 阿里云端配置独立成脚本和文档，不自动改当前电脑系统。

建议后续优先级：

1. 先把 APK 本地局域网体验打磨稳定。
2. 加账户/连接配置记忆，支持多个 Endpoint 一键切换。
3. 做阿里云 FRP + HTTPS 的测试环境。
4. 再做公网安全加固和长期运行脚本。
5. 如果 FRP 长期稳定性或安全策略不满意，再升级 WireGuard。

### 路线 C：公网 IPv6 + DDNSGo + 域名 AAAA

适合用户已经用 DDNSGo 自动更新公网 IPv6 的情况。

```text
Android APK
  http://codex.your-domain.com:8787
        |
        v
DDNSGo
  自动把 codex.your-domain.com 的 AAAA 指向当前电脑公网 IPv6
        |
        v
家里电脑公网 IPv6 + Windows 防火墙
  Mobile Codex Relay 监听 [::]:8787
        |
        v
Windows Relay
```

已完成项目内支持：

- `scripts/start-relay.ps1 -Ipv6` 会让 Relay 监听 `::`。
- 新增 `start-relay-ipv6.bat`，双击即可用 IPv6 模式启动。
- 启动脚本会打印当前可用公网 IPv6 和手机端填写格式。
- 已本地实测：
  - Relay 监听 `::`。
  - `http://[::1]:8791/health` 返回 `ok=true`。

DDNSGo 对接步骤：

1. 在 DDNSGo 中给一个子域名配置 AAAA 记录，例如：

```text
codex.your-domain.com
```

2. DDNSGo 只更新公网 IPv6，不需要更新 A 记录。
3. 手机端 Endpoint 填：

```text
http://codex.your-domain.com:8787
```

4. Relay 用 IPv6 模式启动：

```text
start-relay-ipv6.bat
```

或：

```powershell
.\scripts\start-relay.ps1 -Ipv6
```

5. Windows 防火墙需要放行 Node.js 或 TCP `8787` 的 IPv6 入站。
6. 手机上关闭 Wi-Fi，只用移动网络访问：

```text
http://codex.your-domain.com:8787/health
```

7. 浏览器能打开 `/health` 后，再到 APK 里保存公网连接档案。

重要风险：

- 不同移动网络对 IPv6 支持不一致。
- 家用 IPv6 地址可能变化。
- 防火墙和 HTTPS 证书配置要更谨慎。
- 直接 HTTP 暴露到公网时，Bearer Token 必须换成高强度随机值，不能继续用开发默认 token。
- 如果要长期公网使用，建议第二阶段再加 Caddy HTTPS 或 Relay public mode 安全加固。

### 暂不做

- 公网端口转发。
- 裸露 Codex app-server。
- 弱口令长期使用。
- 自动修改路由器、防火墙或系统安全策略。

## 后续优化点

- 二维码配对 Endpoint + Token。
- Relay HTTPS 自签证书或 Tailscale Funnel 方案评估。
- Relay 设备会话管理。
- Token 轮换。
- 远程连接状态和延迟显示。
