# 远程 Broker 部署

远程模式不依赖同一 Wi-Fi、公网家庭 IP、手机热点或路由器端口转发。

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
        |
        v
Codex Desktop
```

## 1. 准备凭证

为每台 Mac 生成独立的 Relay Secret：

```bash
openssl rand -hex 32
```

Broker 使用 JSON 对象配置允许连接的 Relay：

```bash
export MOBILE_CODEX_BROKER_RELAYS='{"my-mac":"replace-with-at-least-24-random-characters"}'
```

生产环境不要启用 `MOBILE_CODEX_BROKER_ALLOW_DYNAMIC_RELAYS=true`。该开关只用于本机开发。

## 2. 启动 Broker

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @mobile-codex/relay build

export MOBILE_CODEX_BROKER_HOST=127.0.0.1
export MOBILE_CODEX_BROKER_PORT=18888
export MOBILE_CODEX_BROKER_RELAYS='{"my-mac":"replace-with-at-least-24-random-characters"}'

corepack pnpm --filter @mobile-codex/relay broker:start
```

建议使用 systemd、Supervisor 或容器编排保持 Broker 常驻。

## 3. 配置反向代理

Nginx 示例：

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 443 ssl http2;
    server_name broker.example.com;

    location / {
        proxy_pass http://127.0.0.1:18888;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }
}
```

Broker 如果部署在 `/mobile-codex/` 前缀下，反向代理需要在转发时去掉该前缀：

```nginx
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

## 4. 配置 Mac Relay

配置文件：

```text
~/Library/Application Support/Mobile Codex Relay/config.json
```

示例：

```json
{
  "port": 8787,
  "token": "replace-with-a-separate-phone-access-token",
  "brokerUrl": "https://broker.example.com",
  "relayId": "my-mac",
  "relaySecret": "replace-with-at-least-24-random-characters"
}
```

`token` 用于 Android 访问 Relay。`relaySecret` 只用于 Mac 和 Broker 建立隧道，两者必须使用不同的随机值。

重新打开 `Mobile Codex Relay.app` 后，App 会自动启动本地 Relay 和公网隧道。

## 5. 配置 Android

```text
Endpoint: https://broker.example.com/r/my-mac
Token: replace-with-a-separate-phone-access-token
```

## 6. 验证

```bash
curl https://broker.example.com/health
curl -H 'Authorization: Bearer replace-with-a-separate-phone-access-token' \
  https://broker.example.com/r/my-mac/api/threads?limit=1
```

健康检查只返回连接数量，不公开 Relay ID。

## 7. 本机开发模式

```bash
MOBILE_CODEX_BROKER_HOST=127.0.0.1 \
MOBILE_CODEX_BROKER_PORT=18888 \
MOBILE_CODEX_BROKER_ALLOW_DYNAMIC_RELAYS=true \
  node apps/relay/dist/brokerServer.js
```

另开一个终端：

```bash
MOBILE_CODEX_BROKER_URL=http://127.0.0.1:18888 \
MOBILE_CODEX_RELAY_ID=test-mac \
MOBILE_CODEX_RELAY_SECRET=local-development-secret-only \
MOBILE_CODEX_LOCAL_RELAY=http://127.0.0.1:8787 \
  node apps/relay/dist/remoteTunnelClient.js
```

动态 Relay 模式不适合公网部署。
