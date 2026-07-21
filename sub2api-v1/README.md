# sub2api-v1

一个面向实际落地的 `Sub2API` 整理版目录。

它不是只保留上游源码的镜像仓库，而是把这台服务器上已经跑通过的关键要素一起整理进来了：

- 上游 `Sub2API` 完整源码
- 可直接启动的 `deploy/` 目录
- 容器运行期代理支持
- `Nginx` 反代示例
- 官方 `Codex CLI` 接入 `/v1` 的桥接方案
- 线上用过的前端热修脚本

目标很直接：

别人把这个目录拉下来后，不需要再从零拼装部署结构，只需要：

1. 改 `.env`
2. 启动容器
3. 配 `Nginx`
4. 在后台加上游账号
5. 给用户发接入地址

## 项目来源

- 上游项目：[`Wei-Shaw/sub2api`](https://github.com/Wei-Shaw/sub2api)

这个目录在保留上游源码的同时，额外整理了当前服务器真正使用过的部署覆盖层：

- `deploy/`
  推荐直接使用的部署目录，包含 compose 和环境变量模板
- `examples/nginx/`
  `Nginx` 反代和官方 `Codex` 桥接示例
- `examples/codex/`
  官方 `Codex CLI` 配置示例
- `patches/`
  从线上提取的前端运行时热修脚本

## 适用场景

这套结构适合下面这类部署目标：

- 把多个上游账号做成统一号池
- 对下游暴露一个稳定的 API 网关
- 让普通 OpenAI 兼容客户端通过 `/v1` 接入
- 让官方 `Codex CLI` 也能通过 `/v1/responses` 接入
- 用自己的域名统一承载后台和网关

推荐的域名拆分方式：

- 主站或博客：`https://example.com`
- 号池/API 网关：`https://www.example.com`

这样静态站和 API 网关不会互相污染。

## 当前目录结构

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
└── patches/                      # 线上用过的前端热修
```

## 先看这 5 个关键结论

1. 对普通 OpenAI 兼容客户端，统一走：
   `https://www.example.com/v1`

2. 对官方 `Codex CLI`，也统一走：
   `https://www.example.com/v1`
   然后 `wire_api = "responses"`

3. 官方 `Codex CLI` 不是普通 API Key 客户端。
   它通常需要 `Nginx` 内部桥接，把官方登录态请求转成你平台内部 key。

4. 这份仓库不包含任何真实密钥、账号、数据库或运行时数据。
   你必须自己配置 `.env` 和后台账号。

5. 上游源码里会触发 GitHub Push Protection 的内置 Google OAuth 凭据已经被移除。
   如果你要用对应的内置流，需要在运行环境里显式注入。

## 最短部署路径

### 1. 拉代码

```bash
git clone https://github.com/luoz76070-art/project.git
cd project/sub2api-v1/deploy
```

### 2. 复制环境变量模板

```bash
cp .env.example .env
```

### 3. 至少改这些值

```env
SERVER_PORT=18080
RUN_MODE=simple

POSTGRES_PASSWORD=change_this_secure_password
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change_this_admin_password
JWT_SECRET=replace_with_a_random_64_hex_string
TOTP_ENCRYPTION_KEY=replace_with_another_random_64_hex_string
```

### 4. 如果服务器不能稳定直连上游，再补代理

```env
UPDATE_PROXY_URL=http://host.containers.internal:7890
SUB2API_HTTP_PROXY=http://host.containers.internal:7890
SUB2API_HTTPS_PROXY=http://host.containers.internal:7890
SUB2API_NO_PROXY=127.0.0.1,localhost,postgres,redis
```

### 5. 启动服务

Docker:

```bash
docker compose -f docker-compose.local.yml up -d
```

Podman:

```bash
podman-compose -f docker-compose.local.yml up -d
```

### 6. 检查健康状态

```bash
curl -sS http://127.0.0.1:18080/health
```

期望返回：

```json
{"status":"ok"}
```

如果这一步不通，不要先去查域名，先把容器、PostgreSQL、Redis 和代理链路查通。

## 运行前提

- Linux 服务器
- Docker Compose v2 或 Podman + podman-compose
- `Nginx`
- 域名和 HTTPS 证书
- PostgreSQL
- Redis
- 如果服务器在中国内地且上游为 OpenAI / Google，一般还需要代理

实测环境：

- Alibaba Cloud Linux 3
- Podman + podman-compose
- Nginx
- PostgreSQL 18
- Redis 8

## 哪个 compose 应该用

推荐优先使用：

- `deploy/docker-compose.local.yml`

原因：

- 数据目录直接落本地，迁移方便
- 一眼就能看出哪些目录是运行时数据
- 更适合你把整个部署目录打包迁移到新机器

如果你不关心目录级迁移，也可以用：

- `deploy/docker-compose.yml`

## 核心配置项说明

下面这些是最常会改的值。

| 变量 | 用途 | 是否必须 |
| --- | --- | --- |
| `SERVER_PORT` | 宿主机暴露端口 | 是 |
| `RUN_MODE` | 建议自用场景用 `simple` | 是 |
| `POSTGRES_PASSWORD` | PostgreSQL 密码 | 是 |
| `ADMIN_EMAIL` | 后台管理员邮箱 | 是 |
| `ADMIN_PASSWORD` | 后台管理员密码 | 强烈建议显式设置 |
| `JWT_SECRET` | 登录签名密钥 | 是 |
| `TOTP_ENCRYPTION_KEY` | 2FA/TOTP 加密密钥 | 是 |
| `UPDATE_PROXY_URL` | 在线更新/价格拉取代理 | 按需 |
| `SUB2API_HTTP_PROXY` | 容器上游 HTTP 代理 | 按需 |
| `SUB2API_HTTPS_PROXY` | 容器上游 HTTPS 代理 | 按需 |
| `SUB2API_NO_PROXY` | 容器内代理白名单 | 建议设置 |

### 关于代理

如果服务器需要代理访问：

- `auth.openai.com`
- `chatgpt.com`
- `accounts.google.com`
- `oauth2.googleapis.com`
- GitHub

那就必须同时考虑两段：

1. 宿主机代理是否可用
2. 容器里是否能访问宿主机代理

推荐默认写法：

```env
SUB2API_HTTP_PROXY=http://host.containers.internal:7890
SUB2API_HTTPS_PROXY=http://host.containers.internal:7890
```

如果你用的是 `Podman`，这个地址通常可用。  
如果不可用，可以用 `socat` 做一层宿主机到容器网桥的端口转发。

## 启动后第一轮检查

建议按这个顺序检查，不要一开始就去碰域名或前端页面。

### 1. 看容器

Docker:

```bash
docker ps
```

Podman:

```bash
podman ps
```

至少应该看到：

- `sub2api`
- `sub2api-postgres`
- `sub2api-redis`

### 2. 看健康检查

```bash
curl -sS http://127.0.0.1:18080/health
```

### 3. 看日志

Docker:

```bash
docker compose -f docker-compose.local.yml logs -f sub2api
```

Podman:

```bash
podman logs -f sub2api
```

### 4. 再去看后台

这时再访问后台才有意义。

## Nginx 反代

### 第一步：启用 `underscores_in_headers`

官方 `Codex` 会发带下划线的头，例如：

- `session_id`

Nginx 默认会丢掉带下划线的头。对多账号粘性会话和 `responses` 链路来说，这是硬伤。

把 [examples/nginx/http-snippet.conf.example](./examples/nginx/http-snippet.conf.example) 里的内容放进 `nginx.conf` 的 `http {}` 块：

```nginx
underscores_in_headers on;
```

### 第二步：站点配置

参考：

- [examples/nginx/sub2api-www.conf.example](./examples/nginx/sub2api-www.conf.example)

它完成三件事：

1. `www.example.com:80` 自动跳 `443`
2. `443` 反代到 `127.0.0.1:18080`
3. 对官方 `Codex` 请求做桥接

### 为什么官方 Codex 需要桥接

官方 `Codex CLI` 不是普通 OpenAI 兼容客户端。

它发来的 `Authorization` 很可能是自己的 OpenAI 登录态，而不是你平台里给用户发的 `sk-...` relay key。  
所以如果你不做桥接：

- 请求会打进来
- 但 `Sub2API` 并不一定把它识别为你的平台 key
- 最终会表现成 `401`、`reconnecting` 或 `responses` 链路异常

### 桥接方案的本质

桥接不是“伪造用户 key”，而是：

1. 识别官方 `Codex` 请求
2. 清掉原始 `Authorization`
3. 注入一把你自己在平台里创建的“内部桥接 key”
4. 让这些请求统一进指定组

在示例里，对应这段：

```nginx
~*codex_ "__SUB2API_INTERNAL_KEY__";
```

这里的 `__SUB2API_INTERNAL_KEY__` 必须替换成你后台真实创建的内部 key。

### 推荐的桥接 key 创建方式

建议在后台创建一把专用 key：

- 名称：`codex-bridge-internal`
- 分组：`openai-default`
- 用途：只给 `Nginx` 内部桥接使用

不要把它发给用户，不要写进客户端文档。

## 后台初始化顺序

如果 `Nginx` 配好了，后台地址通常就是：

```text
https://www.example.com
```

第一次登录后台后，建议先确认这几件事：

1. 管理员可以登录
2. 账号页、分组页、API Key 页都能打开
3. 默认分组存在
4. `openai-default` 分组存在

如果你的目标是给 `Codex` 用，后面就让桥接 key 和 OpenAI OAuth 账号都收敛到 `openai-default`。

## 接入 OpenAI OAuth 账号池

### 添加账号的标准流程

进入账号页后，添加方式选择：

- `OpenAI OAuth`

典型流程是：

1. 生成授权链接
2. 浏览器打开链接
3. 登录 OpenAI 并授权
4. 授权完成后，浏览器跳到：
   `http://localhost:1455/auth/callback?...`
5. 浏览器提示“无法访问 localhost”或“拒绝访问”
6. 复制地址栏里的完整回调 URL
7. 把整条 URL 粘回后台

### 这里最容易误解的一点

`localhost:1455` 访问失败通常不是授权失败。  
这条链路本来就是“浏览器拿到 code 后手动复制 URL 回填”的模式。

真正需要的不是让 `localhost` 打开页面，而是：

- 把完整 `callback` URL 回填给系统

### 建议的账号分组

建议把给 `Codex` 用的 OpenAI OAuth 账号统一放进：

- `openai-default`

这样：

- 官方 `Codex CLI` 会通过 `Nginx` 内部桥接 key 进入这组
- 普通 OpenAI 兼容客户端也可以通过你平台发出的用户 key 使用这组

## 普通 OpenAI 兼容客户端怎么接

普通客户端不要直接走根路径。统一走：

```text
Base URL: https://www.example.com/v1
API Key: 你在 Sub2API 后台创建的用户 API Key
Model: gpt-5.4
```

适合这套接法的客户端：

- Chatbox
- Cherry Studio
- LobeChat
- Open WebUI
- NextChat
- 其他支持 OpenAI 兼容接口的客户端

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

## 官方 Codex CLI 怎么接

官方 `Codex CLI` 推荐统一走：

- `https://www.example.com/v1`
- `wire_api = "responses"`

示例配置在：

- [examples/codex/config.toml.example](./examples/codex/config.toml.example)

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
- 这套配置前提是你已经 `codex login`
- 这里不需要填平台 API Key
  因为走的是官方登录态 + `Nginx` 内部桥接

验证命令：

```bash
codex exec --skip-git-repo-check --ephemeral \
  -c model_provider=\"sub2api_v1\" \
  -c 'model_providers.sub2api_v1={name=\"sub2api-v1\",base_url=\"https://www.example.com/v1\",wire_api=\"responses\",requires_openai_auth=true}' \
  -m gpt-5.4 \
  'Reply with exactly OK'
```

## 推荐的上线验证顺序

不要一上来就直接用客户端测。建议按这个顺序：

1. 宿主机本机 `curl http://127.0.0.1:18080/health`
2. `Nginx -t`
3. `curl -I https://www.example.com`
4. 用普通 `/v1/chat/completions` 先测一条
5. 后台确认账号状态正常
6. 再用 `Codex CLI` 测 `/v1/responses`

最小验证命令：

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

如果普通客户端都不通，就先别查 `Codex`。

## `patches/` 目录是干什么的

`patches/` 里收录的是从线上提取出来的运行时热修，主要针对两类问题：

- OpenAI OAuth 授权页参数传错，导致 `redirect_uri` 异常
- OpenAI 额度条显示“已用比例”而不是“剩余比例”

这些脚本不是常规部署的必需品。  
它们更像是：

- 线上排障时的补丁工具
- 帮你复刻当前服务器修复经验的参考

具体说明见：

- [patches/README.md](./patches/README.md)

## 常见问题

### 1. `localhost` 拒绝访问

如果出现在 OpenAI OAuth 授权收尾阶段，通常是正常现象。

你要做的是：

- 复制完整的 `http://localhost:1455/auth/callback?...`
- 粘回后台完成兑换

### 2. `Codex reconnecting`

优先检查：

1. `base_url` 是否是 `https://www.example.com/v1`
2. `Nginx` 是否启用了 `underscores_in_headers on;`
3. `Nginx` 桥接 key 是否已经替换成真实内部 API Key
4. `openai-default` 里是否真的有可用 OpenAI OAuth 账号
5. 容器是否能访问 `auth.openai.com` 和 `chatgpt.com`

### 3. `/v1/chat/completions` 返回 502

一般不是客户端配置错，而是上游访问失败。重点排查：

- 容器代理是否生效
- `SUB2API_HTTP_PROXY / SUB2API_HTTPS_PROXY` 是否写对
- 服务器是否能访问 OpenAI
- 账号本身是否已失效

### 4. 后台页面空白

先清缓存，再确认前端构建和后端版本是否匹配。  
如果你复现的是这台服务器遇到过的那类问题，可以参考 `patches/`。

### 5. 普通客户端能用，Codex 不行

这通常说明：

- `/v1/chat/completions` 通了
- 但 `Codex` 的 `responses` 链路还没打通

这时优先查：

- `underscores_in_headers`
- 桥接 key
- `/v1/responses`
- `User-Agent/originator` 是否被 Nginx 正确识别

## 安全建议

- 不要把 `ADMIN_PASSWORD`、`JWT_SECRET`、`TOTP_ENCRYPTION_KEY` 提交进仓库
- 不要把真实内部桥接 key 写死进公开配置
- 不要提交运行时目录：
  - `data/`
  - `postgres_data/`
  - `redis_data/`
- 公网部署建议：
  - 只暴露 `443`
  - `18080` 仅本机监听或安全组不放行
  - 后台最好额外加访问控制

## 这个整理版和上游的差异

相对于上游仓库，这份整理版额外做了这些事：

- 保留完整上游源码，方便后续继续跟进版本
- 补了容器运行期代理变量到 compose
- 把默认自用部署端口和运行模式整理成更适合号池自用的模板
- 补了 `Nginx` + Codex 桥接示例
- 补了官方 `Codex CLI` 的 `/v1` 接入示例
- 收录了线上用过的前端热修脚本
- 移除了会触发 GitHub Push Protection 的内置 Google OAuth 凭据，改为环境变量注入

## 如果你只想看上游原文档

请直接查看上游仓库：

- https://github.com/Wei-Shaw/sub2api
