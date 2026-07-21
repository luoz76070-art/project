# Image Studio 生图项目

这是一个从当前 `gpt2api` 生图能力中整理出来的独立子项目，重点保留用户侧生图 WebUI、后端生图 API、OpenAI 兼容入口、图片缓存访问和 Docker/Nginx 部署模板。仓库中不包含任何账号 JSON、账号池数据、真实 API Key、Token 或服务器密码。

## 功能范围

- 单页用户侧生图工作台：提示词输入、参考图上传、比例选择、分辨率选择、生成数量选择。
- 当前默认模型：`gpt-image-2`。
- 默认分辨率：`1K`，适合接入低分辨率 Web 生图通道。
- 支持图生图参考图，最多 5 张。
- 支持生成历史、预览大图、下载图片、清理失败记录。
- 后端提供 `/api/v1/gen/image`、`/api/v1/gen/tasks/:taskId`、`/api/v1/gen/history` 和 `/api/v1/gen/cached/*` 等接口。
- 前端已处理子路径部署：当站点部署在 `/gpt2api/` 下时，图片缓存地址会自动补齐应用前缀。

## 目录结构

```text
image-studio/
├── backend/                 # Go 后端：用户 API、OpenAI 兼容入口、生图调度、缓存文件访问
├── frontend/                # React + Vite 用户端生图 WebUI
│   ├── apps/user/           # 单页 Image Studio
│   └── packages/theme/      # 主题 token 与基础组件样式
├── deploy/
│   ├── docker-compose.yml   # 通用单机部署模板
│   ├── docker-compose.free-web.example.yml
│   ├── env/.env.example     # 环境变量样例
│   ├── mysql-init/          # 首次初始化迁移脚本
│   └── nginx/               # 用户端与 OpenAI 兼容入口 Nginx 配置
└── README.md
```

## 本地开发

前端：

```bash
cd image-studio/frontend
pnpm install
pnpm --filter @kleinai/user dev
```

后端需要 MySQL、Redis 和必要环境变量。可以从模板复制一份本地环境文件：

```bash
cd image-studio
cp deploy/env/.env.example deploy/env/.env.local
```

生产或可联网环境请务必替换：

- `KLEIN_MYSQL_ROOT_PASSWORD`
- `KLEIN_MYSQL_PASSWORD`
- `KLEIN_DB_DSN`
- `KLEIN_JWT_SECRET`
- `KLEIN_JWT_REFRESH_SECRET`
- `KLEIN_AES_KEY`
- `KLEIN_CORS_ORIGINS`

启动 Docker 部署栈：

```bash
cd image-studio/deploy
docker compose --env-file ./env/.env.local up -d --build
```

默认端口：

- 用户 Web：`17080`
- 用户 API：容器内 `17180`
- OpenAI 兼容入口：`17200`
- MySQL：`13306`
- Redis：`16379`

## 前端构建

```bash
cd image-studio/frontend
pnpm --filter @kleinai/user build
```

当前前端 `vite.config.ts` 的 `base` 默认为 `/gpt2api/`，适合部署到 `https://example.com/gpt2api/`。如果部署在根路径，可以改成 `/`，同时调整 `VITE_API_BASE_URL`。

## 接入上游生图通道

后端通过账号池和 provider 配置调用上游能力。推荐把真实配置放在环境变量或数据库里，不要写入仓库。

常用变量：

```bash
KLEIN_PROVIDER_GPT=real
KLEIN_GPT_BASE_URL=https://api.openai.com
KLEIN_STORAGE_ROOT=/app/storage/public
```

如果要接入本机或内网的 Free Web 低分辨率通道，可以参考：

```bash
KLEIN_GPT_BASE_URL=http://host.docker.internal:13000/free
```

实际账号、OAuth token、refresh token、session token、API Key 都应通过后台导入并加密入库，本项目不会也不应该提交这些文件。

## 安全说明

- 不提交 `.env.local`、`.env.production`、数据库文件、账号 JSON、Token、Cookie、API Key。
- `KLEIN_AES_KEY` 用于加密账号池凭证，生产环境必须使用强随机值，并和数据库备份分开保存。
- 公开页面默认只展示生图能力，不暴露账号池明细。
- 日志中不要打印明文账号凭证、完整邮箱、完整 API Key。
- 如果部署在反向代理子路径下，需要保证 `/api/v1/gen/cached/*` 图片缓存路由可被公网访问到。

## 关键实现文件

- 前端页面：`frontend/apps/user/src/pages/create/CreateStudioPage.tsx`
- 前端 API 客户端：`frontend/apps/user/src/lib/api.ts`
- 前端服务封装：`frontend/apps/user/src/lib/services.ts`
- 后端生图 handler：`backend/internal/handler/generation_handler.go`
- 后端生图 service：`backend/internal/service/generation_service.go`
- GPT provider：`backend/internal/provider/gpt/gpt.go`
- Nginx 用户入口：`deploy/nginx/user.conf`

## 当前状态

这份上传版本用于保存和复现当前生图项目的主要功能。它不包含云服务器现有数据，也不会自动带上账号池；部署后需要自行配置数据库、密钥和上游账号池。
