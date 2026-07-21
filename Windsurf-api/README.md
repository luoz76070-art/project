# Windsurf-api

`Windsurf-api` 是基于 `WindsurfAPI` 整理出的一个可独立部署版本，目标是把 `Windsurf / Codeium` 的模型能力暴露成 OpenAI 兼容接口，并补齐更适合实际运维的账号池、代理、后台和 API Key 管理能力。

## 来源信息

### 源项目 GitHub

- 项目名：`dwgx/WindsurfAPI`
- 地址：<https://github.com/dwgx/WindsurfAPI>

### 源文章

- 标题：`Windsurf开源反代工具｜超低成本爽用ClaudeOpus4.7MAX！`
- 地址：<https://mp.weixin.qq.com/s/6gHYOf0hCSNrqRI1vhoZMg>

说明：
- 由于版权限制，本仓库不收录该公众号文章全文。
- README 中保留原文标题、URL 与整理后的摘要；如需阅读全文，请访问原链接。

### 源文章摘要

- 文章核心是在 Linux 服务器上部署 `WindsurfAPI`，把 `Windsurf` 的能力封装成 OpenAI 风格的 `/v1/chat/completions` 与 `/v1/models`。
- 文章强调需要从 Windsurf Linux 安装包中提取 `language_server_linux_x64`，并将其放到服务器固定路径。
- 基本部署流程包括：准备 Node.js 运行环境、配置 `.env`、启动 Node 服务、接入 Windsurf 账号、通过 `/dashboard` 管理号池与代理。
- 对外使用方式则是让任何支持 OpenAI API 的客户端，直接把 Base URL 指向本服务的 `/v1`。

## 当前项目做了哪些修改和优化

相对源项目，这个版本已经合并了以下增强：

- 新增客户端 API Key 管理能力
  - 新增 `src/client-api-keys.js`
  - 后台可创建、停用、删除和统计客户端调用 Key
  - 记录 `requestCount` 与 `lastUsed`
- 后台新增 `API管理` 页面
  - 可直接从 Web 后台管理调用密钥
- 修复 Windsurf token 注册链路的代理传递
  - `token -> register_user -> api_key` 过程现在支持走 HTTP 代理
- 增强代理配置
  - 支持从环境变量继承全局代理
  - 支持全局代理和单账号代理持久化
- 修复语言服务进程的代理生效问题
  - 有代理的 `language_server_linux_x64` 现在启用 `--detect_proxy=true`
  - 避免了聊天请求因直连上游失败而出现 `deadline_exceeded`
- 清理提交内容
  - 本仓库不包含服务器上的 `.env`、账号池、运行日志、统计数据和已生成密钥
  - 只保留可复用代码和示例配置

## 项目原理

整体链路如下：

```text
客户端 / OpenAI SDK
        |
        v
Windsurf-api HTTP 服务
  - 校验客户端 API Key
  - 做模型访问控制
  - 从账号池里选择可用 Windsurf 账号
        |
        v
按代理分组的 Language Server 进程
  - 每组代理对应一个独立 LS
  - 避免不同出口 IP 和会话状态互相污染
        |
        v
Windsurf / Codeium 后端
        |
        v
返回 OpenAI 兼容响应
```

代码层面主要分成几块：

- `src/index.js`
  - 启动 HTTP 服务和后台
- `src/handlers/chat.js`
  - 处理 `/v1/chat/completions`
  - 根据模型选择 `legacy` 或 `cascade` 聊天流
- `src/auth.js`
  - 维护账号池、错误计数、能力探测和模型可用性
- `src/langserver.js`
  - 管理多 Language Server 实例
  - 按代理拆分进程
- `src/dashboard/api.js`
  - 提供后台接口
- `src/client-api-keys.js`
  - 管理外部客户端可用的 API Key

## 功能概览

- OpenAI 兼容接口
  - `/v1/chat/completions`
  - `/v1/models`
- 多账号池
  - 支持 token 或 api_key 入池
  - 自动故障切换
- 后台管理
  - 账号、代理、日志、统计、API Key
- 多代理出口
  - 适合直连不稳定或需要固定出口 IP 的场景
- 零第三方 npm 依赖
  - 主要使用 Node.js 内建模块

## 如何部署

### 1. 准备环境

- Node.js `>= 20`
- Windsurf 的 `language_server_linux_x64`
- 一台 Linux 服务器
- 至少一个 Windsurf 账号

### 2. 放置 Language Server

```bash
mkdir -p /opt/windsurf
cp language_server_linux_x64 /opt/windsurf/
chmod +x /opt/windsurf/language_server_linux_x64
mkdir -p /opt/windsurf/data/db
```

### 3. 配置环境变量

可参考项目里的 `.env.example`，最少需要准备：

```bash
PORT=3003
API_KEY=your_bootstrap_api_key
DEFAULT_MODEL=gpt-4o-mini
MAX_TOKENS=8192
LOG_LEVEL=info
LS_BINARY_PATH=/opt/windsurf/language_server_linux_x64
LS_PORT=42100
DASHBOARD_PASSWORD=your_dashboard_password
```

### 4. 启动

```bash
node src/index.js
```

或使用 PM2：

```bash
pm2 start src/index.js --name windsurf-api
pm2 save
```

## 如何使用

### 1. 登录后台

默认入口：

```text
http://你的服务器:3003/dashboard
```

可以在后台完成：

- 添加 Windsurf 账号
- 配置全局代理 / 单账号代理
- 查看日志和请求统计
- 创建外部客户端 API Key

### 2. 添加账号

推荐用 token：

```bash
curl -X POST http://127.0.0.1:3003/auth/login \
  -H "Content-Type: application/json" \
  -d '{"token":"your_windsurf_token"}'
```

也支持直接传 `api_key` 或批量入池。

### 3. 调用模型列表

```bash
curl http://127.0.0.1:3003/v1/models \
  -H "Authorization: Bearer your_client_api_key"
```

### 4. 调用聊天接口

```bash
curl http://127.0.0.1:3003/v1/chat/completions \
  -H "Authorization: Bearer your_client_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"gpt-4o-mini",
    "messages":[
      {"role":"user","content":"Reply with exactly OK"}
    ],
    "stream":false
  }'
```

### 5. 反代到域名

如果你希望走 HTTPS，可以把：

- `/dashboard`
- `/auth`
- `/health`
- `/v1`

通过 Nginx 反代到本地 `3003`。

## 目录说明

```text
Windsurf-api/
├── .env.example
├── docs/
├── src/
│   ├── auth.js
│   ├── client-api-keys.js
│   ├── client.js
│   ├── dashboard/
│   ├── langserver.js
│   └── ...
├── package.json
└── README.md
```

## 提交说明

为避免泄露敏感信息，以下内容不会进入仓库：

- `.env`
- `accounts.json`
- `proxy.json`
- `client-api-keys.json`
- `stats.json`
- `logs/`

如果你要在新服务器上使用，需要自行重新配置这些运行时文件。

## 兼容性说明

- 当前目录基于 `WindsurfAPI` 定制，保留了原始项目的核心结构
- 源项目 README 标注为 `MIT`，但请你在二次分发或商用前自行核对源仓库的最新许可证和使用声明
- 公众号文章原文未转载，仅保留引用与摘要
