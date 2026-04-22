# sub2api-v1

这是一个基于 [`Wei-Shaw/sub2api`](https://github.com/Wei-Shaw/sub2api) 整理出的可直接落地版本，包含：

- 上游 `Sub2API` 完整源码
- 这台云服务器上实际跑通的 `docker-compose` 配置
- 容器运行期代理支持
- `Nginx` 反代示例
- 官方 `Codex` 走 `/v1` 的桥接配置
- 管理后台前端热修脚本

目标不是做二次开发演示，而是让别人把这个目录拉下来后，改几个配置就能启动并接入自己的号池。

## 1. 仓库来源

- 上游项目：[`Wei-Shaw/sub2api`](https://github.com/Wei-Shaw/sub2api)
- 上游原始说明：[`UPSTREAM_README.md`](./UPSTREAM_README.md)

这个目录保留了上游源码，同时把当前服务器真正用到的部署覆盖层整理到了：

- `deploy/`：推荐直接使用的 compose 与环境变量模板
- `examples/nginx/`：`Nginx` 反代与 Codex 桥接示例
- `examples/codex/`：官方 `Codex CLI` 配置示例
- `patches/`：从线上提取的前端热修脚本

## 2. 这套方案解决什么问题

这套部署结构的目标是把多个上游订阅账号统一收敛到一个域名入口，对下游暴露成一个稳定的 API 网关。

实际链路是：

```text
普通 OpenAI 客户端 / Codex CLI
              |
              v
      https://www.example.com
              |
              v
            Nginx
              |
              v
   Sub2API (127.0.0.1:18080)
              |
              v
   OpenAI OAuth / Gemini / 其他上游账号池
```

推荐的域名拆分方式：

- 博客或主页：`https://example.com`
- 号池/API 网关：`https://www.example.com`

这样静态站和 API 网关不会互相污染。

## 3. 目录结构

```text
sub2api-v1/
├── backend/                      # 上游后端源码
├── frontend/                     # 上游前端源码
├── deploy/                       # 推荐直接使用的部署目录
│   ├── .env.example
│   ├── docker-compose.local.yml
│   ├── docker-compose.yml
│   └── config.example.yaml
├── examples/
│   ├── codex/config.toml.example
│   └── nginx/
│       ├── http-snippet.conf.example
│       └── sub2api-www.conf.example
├── patches/                      # 线上用过的前端运行时热修
└── UPSTREAM_README.md            # 上游原 README
```

## 4. 服务器要求

- Linux 服务器
- Docker Compose v2 或 Podman + podman-compose
- 域名和 HTTPS 证书
- 可访问 PostgreSQL / Redis
- 如果服务器不能稳定直连 `auth.openai.com` / `chatgpt.com` / GitHub，需要准备代理

实测环境：

- Alibaba Cloud Linux 3
- Podman + podman-compose
- Nginx
- PostgreSQL 18
- Redis 8

## 5. 快速部署

### 5.1 克隆后进入部署目录

```bash
git clone https://github.com/luoz76070-art/project.git
cd project/sub2api-v1/deploy
```

### 5.2 配置环境变量

```bash
cp .env.example .env
```

至少修改这些项：

```env
SERVER_PORT=18080
RUN_MODE=simple

POSTGRES_PASSWORD=change_this_secure_password
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change_this_admin_password
JWT_SECRET=replace_with_a_random_64_hex_string
TOTP_ENCRYPTION_KEY=replace_with_another_random_64_hex_string
```

如果服务器需要代理访问上游，再补这几项：

```env
UPDATE_PROXY_URL=http://host.containers.internal:7890
SUB2API_HTTP_PROXY=http://host.containers.internal:7890
SUB2API_HTTPS_PROXY=http://host.containers.internal:7890
SUB2API_NO_PROXY=127.0.0.1,localhost,postgres,redis
```

说明：

- `UPDATE_PROXY_URL`：给在线更新、价格数据拉取用
- `SUB2API_HTTP_PROXY / SUB2API_HTTPS_PROXY`：给容器里的 OAuth 与上游 API 请求用
- 如果是 `Podman`，`host.containers.internal` 通常能直接访问宿主机
- 如果不行，可以用 `socat` 把宿主机 `127.0.0.1:7890` 转发到容器网桥地址

### 5.3 启动服务

Docker:

```bash
docker compose -f docker-compose.local.yml up -d
```

Podman:

```bash
podman-compose -f docker-compose.local.yml up -d
```

### 5.4 健康检查

```bash
curl -sS http://127.0.0.1:18080/health
```

期望返回：

```json
{"status":"ok"}
```

首次启动还应确认三个容器都起来了：

```bash
docker ps
```

或：

```bash
podman ps
```

## 6. Nginx 反代

### 6.1 先开 `underscores_in_headers`

官方 `Codex` 会发带下划线的头，例如 `session_id`。Nginx 默认会丢掉它们，结果多账号粘性会话会失效。

把 [`examples/nginx/http-snippet.conf.example`](./examples/nginx/http-snippet.conf.example) 里的内容放进 `nginx.conf` 的 `http {}` 块：

```nginx
underscores_in_headers on;
```

### 6.2 站点配置

参考 [`examples/nginx/sub2api-www.conf.example`](./examples/nginx/sub2api-www.conf.example)。

这个示例做了三件事：

- `www.example.com` 的 `80` 自动跳 `443`
- `443` 反代到 `127.0.0.1:18080`
- 对官方 `Codex` 客户端做桥接

### 6.3 为什么要做 Codex 桥接

官方 `Codex CLI` 不是普通 OpenAI 兼容客户端。它发出来的 `Authorization` 往往是自己的 OpenAI 登录态，不是你 `Sub2API` 平台生成的 relay API Key。

所以这套桥接做的是：

1. 识别 `User-Agent` / `originator` 里带 `codex_` 的请求
2. 清掉原始 `Authorization`
3. 改成内部专用 `x-api-key`
4. 让请求进入你指定的 `Sub2API` 组

在示例里，这个桥接 key 对应：

```nginx
~*codex_ "__SUB2API_INTERNAL_KEY__";
```

你需要在 `Sub2API` 后台自己创建一把内部专用 key，然后替换成真实值。

推荐做法：

- 名称：`codex-bridge-internal`
- 绑定组：`openai-default`
- 用途：只给 `Nginx` 内部桥接使用，不要分发给用户

## 7. 接入 OpenAI OAuth 账号池

### 7.1 后台地址

如果 `Nginx` 配好了，后台入口就是：

```text
https://www.example.com
```

### 7.2 添加 OpenAI 账号

进入后台账号页后，添加方式选择 `OpenAI OAuth`。

常见流程：

1. 生成授权链接
2. 浏览器打开链接并完成 OpenAI 登录
3. 授权完成后跳到 `http://localhost:1455/auth/callback?...`
4. 浏览器显示“无法访问 / localhost 拒绝连接”是正常的
5. 复制地址栏完整 URL
6. 回到后台把完整回调 URL 粘进去

重点：

- `localhost:1455` 拒绝访问本身不是失败
- 真正需要的是把那条完整回调 URL 回填到系统里

### 7.3 账号分组

建议把给 Codex 用的 OpenAI OAuth 账号统一放进：

- `openai-default`

这样：

- 官方 `Codex CLI` 通过 `Nginx` 内部桥接 key 进入这组
- 普通 OpenAI 兼容客户端也能通过你发出的平台 API Key 使用这组

## 8. 普通 OpenAI 兼容客户端怎么接

这类客户端不要直接走根路径，统一走：

```text
Base URL: https://www.example.com/v1
API Key: 你在 Sub2API 后台创建的用户 API Key
Model: gpt-5.4
```

例如：

- Chatbox
- Cherry Studio
- LobeChat
- Open WebUI
- NextChat

调用示例：

```bash
curl https://www.example.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_SUB2API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"gpt-5.4",
    "messages":[{"role":"user","content":"Reply with exactly OK"}],
    "stream":false
  }'
```

## 9. 官方 Codex CLI 怎么接

官方 `Codex CLI` 这条链路推荐直接走：

- `https://www.example.com/v1`
- `wire_api = "responses"`

参考文件：

- [`examples/codex/config.toml.example`](./examples/codex/config.toml.example)

内容如下：

```toml
disable_response_storage = true
model = "gpt-5.4"
model_provider = "sub2api_v1"
model_reasoning_effort = "medium"
service_tier = "fast"

[model_providers.sub2api_v1]
name = "sub2api-v1"
base_url = "https://www.example.com/v1"
wire_api = "responses"
requires_openai_auth = true
```

关键点：

- `base_url` 只写到 `/v1`
- 不要手动再拼 `/responses`
- 这套配置依赖你已经 `codex login`
- 这里不需要填写 `Sub2API` 用户 API Key，因为走的是官方 `Codex` 登录态 + `Nginx` 桥接

验证命令：

```bash
codex exec --skip-git-repo-check --ephemeral \
  -c model_provider=\"sub2api_v1\" \
  -c 'model_providers.sub2api_v1={name=\"sub2api-v1\",base_url=\"https://www.example.com/v1\",wire_api=\"responses\",requires_openai_auth=true}' \
  -m gpt-5.4 \
  'Reply with exactly OK'
```

## 10. 这台服务器上额外做过的前端修复

`patches/` 目录收录了从线上提取的运行时热修，主要用于两类问题：

- OpenAI OAuth 授权页参数传错，导致 `redirect_uri` 被错误设置
- OpenAI 额度条显示“已用比例”而不是“剩余比例”

这些脚本不是必须的，但如果你复现出了同类问题，可以直接拿来对 `data/public/assets/` 下的构建产物做热修。

具体说明见：

- [`patches/README.md`](./patches/README.md)

## 11. 常见问题

### 11.1 `localhost 拒绝访问`

出现在 OpenAI OAuth 授权收尾阶段时，通常是正常现象。

你要做的是：

- 复制完整的 `http://localhost:1455/auth/callback?...` URL
- 粘回后台完成兑换

### 11.2 `Codex reconnecting`

优先检查这几项：

1. `base_url` 是否写成了 `https://www.example.com/v1`
2. `Nginx` 是否启用了 `underscores_in_headers on;`
3. `Nginx` 桥接 key 是否已经替换成真实的内部 API Key
4. `Sub2API` 对应组里是否真的有可用 OpenAI OAuth 账号
5. 服务器容器是否能访问 `auth.openai.com` / `chatgpt.com`

### 11.3 `/v1/chat/completions` 返回 502

一般不是下游客户端问题，而是上游访问失败。重点排查：

- 容器里代理是否生效
- `SUB2API_HTTP_PROXY / SUB2API_HTTPS_PROXY` 是否正确
- 服务器本身是否能访问 OpenAI
- 账号本身是否失效

### 11.4 登录后台后页面空白

优先清缓存，再确认前端构建是否和当前后端版本匹配。

必要时可以参考 `patches/` 里的热修方式。

## 12. 推荐的上线顺序

1. 先把 `deploy/.env` 配好
2. 启动 `Sub2API + PostgreSQL + Redis`
3. 本机确认 `/health` 返回 `ok`
4. 配 `Nginx`
5. 在后台创建内部桥接 key
6. 添加 OpenAI OAuth 账号到 `openai-default`
7. 先用普通 `/v1/chat/completions` 测试
8. 再用 `Codex CLI` 测 `/v1/responses`

## 13. 安全建议

- 不要把 `ADMIN_PASSWORD`、`JWT_SECRET`、`TOTP_ENCRYPTION_KEY` 提交进仓库
- 不要把真实内部桥接 key 写死进公开配置
- 不要提交运行时目录：
  - `data/`
  - `postgres_data/`
  - `redis_data/`
- 如果是公网部署，建议：
  - 只暴露 `443`
  - `18080` 仅本机监听或安全组不放行
  - 后台最好再加额外访问控制

## 14. 本仓库和上游的差异

这份整理版相对于上游仓库，额外做了这些适配：

- 保留完整上游源码，便于后续跟进版本
- 补充了运行时代理变量到 `docker-compose`
- 把默认自用部署端口和运行模式整理为更适合号池自用的模板
- 增加了 `Nginx` + Codex 桥接示例
- 增加了官方 `Codex CLI` 的 `/v1` 配置示例
- 收录了线上用过的前端热修脚本
- 移除了上游源码中会触发 GitHub Push Protection 的内置 Google OAuth 凭据，改为环境变量注入

如果你只想看上游原文档，直接看：

- [`UPSTREAM_README.md`](./UPSTREAM_README.md)
