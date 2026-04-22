# Deploy Guide

这个目录是 `sub2api-v1` 的推荐部署入口。

如果你只是想把服务跑起来，不需要先看完整源码说明，直接按这份文档操作即可。

更完整的总览文档在：

- [../README.md](../README.md)

## 这份部署目录里有什么

| 文件 | 用途 |
| --- | --- |
| `.env.example` | 环境变量模板，复制成 `.env` 后修改 |
| `docker-compose.local.yml` | 推荐使用，数据目录落本地，方便迁移和备份 |
| `docker-compose.yml` | 命名卷版本，适合不关心目录迁移的场景 |
| `config.example.yaml` | 可选配置文件模板 |
| `docker-deploy.sh` | 上游提供的辅助脚本 |

## 推荐使用哪一个 compose

优先推荐：

- `docker-compose.local.yml`

原因：

- `data/`、`postgres_data/`、`redis_data/` 都在本地目录里
- 打包迁移更容易
- 更符合这个整理版“拉下来改配置即可复用”的目标

只有在你明确偏好 Docker 命名卷时，才考虑：

- `docker-compose.yml`

## 最短启动步骤

### 1. 进入当前目录

```bash
cd project/sub2api-v1/deploy
```

### 2. 复制环境变量模板

```bash
cp .env.example .env
```

### 3. 至少修改这些值

```env
SERVER_PORT=18080
RUN_MODE=simple

POSTGRES_PASSWORD=change_this_secure_password
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change_this_admin_password
JWT_SECRET=replace_with_a_random_64_hex_string
TOTP_ENCRYPTION_KEY=replace_with_another_random_64_hex_string
```

建议显式生成随机值：

```bash
openssl rand -hex 32
```

### 4. 如果服务器不能稳定直连上游，再补代理

```env
UPDATE_PROXY_URL=http://host.containers.internal:7890
SUB2API_HTTP_PROXY=http://host.containers.internal:7890
SUB2API_HTTPS_PROXY=http://host.containers.internal:7890
SUB2API_NO_PROXY=127.0.0.1,localhost,postgres,redis
```

说明：

- `UPDATE_PROXY_URL`
  给在线更新和价格数据拉取使用
- `SUB2API_HTTP_PROXY / SUB2API_HTTPS_PROXY`
  给容器里的 OAuth 与上游 API 请求使用
- `SUB2API_NO_PROXY`
  建议至少包含本地、PostgreSQL、Redis

### 5. 启动服务

Docker:

```bash
docker compose -f docker-compose.local.yml up -d
```

Podman:

```bash
podman-compose -f docker-compose.local.yml up -d
```

### 6. 健康检查

```bash
curl -sS http://127.0.0.1:18080/health
```

期望返回：

```json
{"status":"ok"}
```

## 运行后应该看到什么

至少应有三个容器：

- `sub2api`
- `sub2api-postgres`
- `sub2api-redis`

查看方式：

Docker:

```bash
docker ps
```

Podman:

```bash
podman ps
```

## 日志怎么查

Docker:

```bash
docker compose -f docker-compose.local.yml logs -f sub2api
```

Podman:

```bash
podman logs -f sub2api
```

如果后台无法登录、上游 OAuth 超时、或者 `/v1/chat/completions` 返回 `502`，先看这里，不要先怀疑前端。

## 目录版和命名卷版的区别

### `docker-compose.local.yml`

数据落到：

- `./data`
- `./postgres_data`
- `./redis_data`

优点：

- 目录可见
- 迁移方便
- 备份方便

### `docker-compose.yml`

数据走 Docker 命名卷。

优点：

- 更接近上游默认方式

缺点：

- 不如目录版直观
- 迁移时要额外处理卷

## 迁移方式

如果你用的是目录版，迁移最简单：

```bash
# 源机器
docker compose -f docker-compose.local.yml down
cd ..
tar czf sub2api-deploy.tar.gz deploy/

# 新机器
tar xzf sub2api-deploy.tar.gz
cd deploy
docker compose -f docker-compose.local.yml up -d
```

## 和代理相关的注意事项

如果你的上游是：

- OpenAI OAuth / ChatGPT / Codex
- Google OAuth / Gemini

那容器通常需要能访问：

- `auth.openai.com`
- `chatgpt.com`
- `accounts.google.com`
- `oauth2.googleapis.com`

常见问题不是“宿主机有代理”，而是“容器访问不到宿主机代理”。

推荐先验证：

1. 宿主机代理端口是否真的在监听
2. `host.containers.internal` 是否能从容器访问
3. 容器里的环境变量是否已经注入

## 和 Nginx 的关系

这个目录只负责把 `Sub2API` 进程跑起来。

真正对外上线时，推荐的结构是：

```text
www.example.com -> Nginx -> 127.0.0.1:18080
```

对应示例配置不在这里，而在：

- `../examples/nginx/http-snippet.conf.example`
- `../examples/nginx/sub2api-www.conf.example`

如果你要接官方 `Codex CLI`，还必须注意：

- `underscores_in_headers on;`
- 官方 Codex 请求桥接到内部 key

## 和 Codex 的关系

### 普通 OpenAI 兼容客户端

统一走：

```text
Base URL: https://www.example.com/v1
API Key: 你在 Sub2API 后台创建的 key
Model: gpt-5.4
```

### 官方 `Codex CLI`

推荐走：

```text
https://www.example.com/v1
```

并用：

- `wire_api = "responses"`

示例配置文件在：

- `../examples/codex/config.toml.example`

注意：

- 不要手动把 `base_url` 写成 `/responses`
- 官方 `Codex CLI` 依赖后台内部桥接 key，不是普通用户 API Key 模式

## OpenAI OAuth 怎么添加

后台添加账号时选择：

- `OpenAI OAuth`

典型流程：

1. 生成授权链接
2. 浏览器登录并授权
3. 最终跳到 `http://localhost:1455/auth/callback?...`
4. 浏览器显示 localhost 拒绝访问是正常的
5. 复制整条回调 URL
6. 粘回后台完成兑换

重点：

- `localhost` 报错不等于授权失败
- 你真正需要的是那条完整 `callback URL`

## Google 相关环境变量说明

这个整理版已经移除了上游源码里内置的 Google OAuth 凭据，避免仓库推送被 GitHub Push Protection 拦截。

如果你要用对应能力，需要在运行环境里显式注入。

例如在 `.env` 里按需提供：

```env
# 自建 Gemini OAuth Client
GEMINI_OAUTH_CLIENT_ID=
GEMINI_OAUTH_CLIENT_SECRET=

# 内置 Gemini CLI OAuth（如果你自己掌握对应 id/secret）
GEMINI_CLI_OAUTH_CLIENT_ID=
GEMINI_CLI_OAUTH_CLIENT_SECRET=

# Antigravity 内置 OAuth（如果你自己掌握对应 id/secret）
ANTIGRAVITY_OAUTH_CLIENT_ID=
ANTIGRAVITY_OAUTH_CLIENT_SECRET=
```

如果你没有这些值，就不要开启对应内置流。

## 常见问题

### 1. `/health` 不通

优先检查：

- 容器是否启动
- `SERVER_PORT` 是否冲突
- PostgreSQL / Redis 是否健康

### 2. `/v1/chat/completions` 返回 `502`

优先检查：

- 容器代理是否生效
- 上游账号是否有效
- 宿主机是否真的能访问 OpenAI / Google

### 3. `Codex reconnecting`

优先检查：

- `Nginx` 是否启用了 `underscores_in_headers on;`
- 是否配置了官方 Codex 的内部桥接 key
- `base_url` 是否写成 `https://www.example.com/v1`

### 4. 后台白屏

优先清缓存。  
如果是构建产物本身问题，再看仓库里的：

- `../patches/`

## 这个目录不包含什么

不会包含：

- 真实 `.env`
- 真实后台密码
- 数据库数据
- Redis 数据
- OAuth 会话
- 运行时生成的 `data/`

也就是说：

- 这个目录是“可部署模板”
- 不是“当前线上实例快照”

## 推荐阅读顺序

如果你要从零部署，建议按这个顺序看：

1. 先看本文件
2. 再看 `../README.md`
3. 再看 `../examples/nginx/`
4. 最后按需看 `../patches/`
