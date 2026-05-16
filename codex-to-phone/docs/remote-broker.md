# 远程 Broker 模式

## 目标

远程模式不依赖局域网、同一 Wi-Fi、手机热点或路由器端口转发。

链路：

```text
Android App
  Endpoint: https://broker.example.com/r/<relayId>
        |
        v
Public Broker
  HTTPS API + WSS tunnel
        ^
        |
Mac Relay App
  outbound WebSocket tunnel
  local Relay: http://127.0.0.1:8787
        |
        v
Codex Desktop
```

Mac 只需要能访问公网；Android 也只需要能访问公网。

## Broker 部署

在一台有公网域名或公网 IP 的服务器上运行：

```bash
corepack pnpm install
corepack pnpm --filter @mobile-codex/relay build
MOBILE_CODEX_BROKER_HOST=0.0.0.0 MOBILE_CODEX_BROKER_PORT=18888 \
  node apps/relay/dist/brokerServer.js
```

生产环境建议用 Nginx/Caddy/Cloudflare 将 HTTPS 域名反代到 `127.0.0.1:18888`，并确保 WebSocket upgrade 可用。

如果 Broker 挂在域名前缀下，例如 `https://zyzlz.xin/mobile-codex`，需要让反代去掉这个前缀：

```nginx
location = /mobile-codex {
    return 301 https://$host/mobile-codex/;
}

location ^~ /mobile-codex/ {
    proxy_pass http://127.0.0.1:18888/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_buffering off;
}
```

## Mac 配置

Mac Relay App 配置文件：

```text
~/Library/Application Support/Mobile Codex Relay/config.json
```

示例：

```json
{
  "port": 8787,
  "token": "mobile-codex-CHANGE-ME",
  "brokerUrl": "https://broker.example.com",
  "relayId": "my-mac",
  "relaySecret": "replace-with-long-random-secret"
}
```

保存后重新打开 `Mobile Codex Relay.app`。App 会启动：

- 本地 Relay：`http://127.0.0.1:8787`
- 远程隧道：Mac 主动连 `brokerUrl`

当前 `zyzlz.xin` 部署示例：

```json
{
  "port": 8787,
  "token": "mobile-codex-CHANGE-ME",
  "brokerUrl": "https://zyzlz.xin/mobile-codex",
  "relayId": "rorance-mac",
  "relaySecret": "replace-with-long-random-secret"
}
```

## Android 配置

安装：

```text
dist-apk/mobile-codex-mac-remote-debug.apk
```

Android App 设置里填写：

```text
Endpoint: https://broker.example.com/r/my-mac
Token: mobile-codex-CHANGE-ME
```

当前 `zyzlz.xin` 部署对应：

```text
Endpoint: https://zyzlz.xin/mobile-codex/r/rorance-mac
Token: mobile-codex-CHANGE-ME
```

这里的 Token 仍然是 Mac Relay 的 `token`，不是 `relaySecret`。`relaySecret` 只用于 Mac 和 Broker 建立隧道。

## 本地验证

本机模拟 Broker：

```bash
MOBILE_CODEX_BROKER_HOST=127.0.0.1 MOBILE_CODEX_BROKER_PORT=18888 \
  node apps/relay/dist/brokerServer.js
```

另开一个终端模拟 Mac 隧道：

```bash
MOBILE_CODEX_BROKER_URL=http://127.0.0.1:18888 \
MOBILE_CODEX_RELAY_ID=test-mac \
MOBILE_CODEX_RELAY_SECRET=test-secret \
MOBILE_CODEX_LOCAL_RELAY=http://127.0.0.1:8787 \
  node apps/relay/dist/remoteTunnelClient.js
```

验证：

```bash
curl http://127.0.0.1:18888/r/test-mac/health
```
