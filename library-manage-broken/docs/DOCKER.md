# 🐳 Docker 部署指南

> 本项目为 AI 辅助自部署场景设计。任何人（包括 AI Agent）只需要安装 Docker，即可一键拉起完整系统。

## 🚀 一键部署

```bash
# 1. 克隆代码
git clone https://github.com/luoz76070-art/project.git
cd project/library-manage

# 2. 一键启动（约 2 分钟，含构建）
bash scripts/docker-setup.sh
```

启动成功后访问：**http://localhost:3000**

## 🔧 手动部署（精细控制）

```bash
# 1. 克隆
git clone https://github.com/luoz76070-art/project.git
cd project/library-manage

# 2. 准备环境变量
cp .env.example .env
# 编辑 .env，至少修改 NEXTAUTH_SECRET
sed -i "s|NEXTAUTH_SECRET=.*|NEXTAUTH_SECRET=$(openssl rand -base64 32)|" .env
sed -i "s|AUTH_SECRET=.*|AUTH_SECRET=$(openssl rand -base64 32)|" .env

# 3. 构建并启动
docker compose up -d --build

# 4. 查看状态
docker compose ps
docker compose logs -f
```

## 🌐 暴露公网（云端网关）

编辑 `docker-compose.yml`，取消 `cloudflared` 服务的注释：

```yaml
  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: library-manage-tunnel
    restart: unless-stopped
    command: tunnel --no-autoupdate --url http://library-manage:3000
    depends_on:
      library-manage:
        condition: service_healthy
    networks:
      - library-net
```

然后：

```bash
docker compose up -d cloudflared
docker compose logs -f cloudflared
# 看到类似 https://xxxx.trycloudflare.com 的 URL 即成功
```

## 📂 数据持久化

SQLite 数据库保存在 Docker 命名卷 `library-manage-data` 中：

```bash
# 查看卷
docker volume inspect library-manage-data

# 备份数据
docker run --rm -v library-manage-data:/data -v $(pwd):/backup \
    alpine tar czf /backup/library-backup-$(date +%Y%m%d).tar.gz /data

# 恢复数据
docker run --rm -v library-manage-data:/data -v $(pwd):/backup \
    alpine tar xzf /backup/library-backup-20260721.tar.gz -C /
```

## 🔄 修改源码后重新部署

```bash
# 重新构建镜像并重启
docker compose up -d --build

# 仅重启（不改代码）
docker compose restart library-manage
```

## 🛑 停止与清理

```bash
# 停止容器（保留数据卷）
docker compose down

# 停止 + 删除数据卷（⚠️ 数据丢失）
docker compose down -v

# 删除镜像
docker rmi library-manage:latest
```

## 🤖 AI Agent 部署提示词模板

如果你用 Claude / GPT / Gemini 等 AI 帮你部署，可以直接说：

```
请帮我在我的服务器上用 Docker 部署这个项目：
https://github.com/luoz76070-art/project/tree/main/library-manage

要求：
1. 使用 docker compose 一键启动
2. 暴露 3000 端口
3. 用 cloudflared 隧道暴露公网（无需账号的临时 URL 即可）
4. 数据持久化（重启不丢数据）
5. 完成后告诉我访问地址和登录账号
```

## 🐛 故障排查

| 问题 | 排查 |
|---|---|
| 容器启动失败 | `docker compose logs library-manage` |
| 端口占用 | 修改 `.env` 中 `PORT=3001` |
| 数据库丢失 | 检查 `library-manage-data` 卷是否存在 |
| 健康检查一直 unhealthy | 等待 30s，或 `docker compose logs` 查看错误 |
| 构建卡住 | 检查网络，国内用户可加 `registry.npm.taobao.org` 镜像 |

## 📐 架构

```
┌─────────────────────────────────┐
│   主机（你的服务器 / NAS）        │
│                                  │
│  ┌──────────────────────────┐   │
│  │  library-manage (容器)    │   │
│  │  Next.js standalone       │   │
│  │  端口 3000                │   │
│  │  SQLite → /app/data/...   │   │
│  └──────────┬───────────────┘   │
│             │                     │
│  ┌──────────▼───────────────┐   │
│  │  Volume: library-data    │   │
│  │  (SQLite 持久化)         │   │
│  └──────────────────────────┘   │
│                                  │
│  可选：                          │
│  ┌──────────────────────────┐   │
│  │  cloudflared (容器)       │   │
│  │  Quick Tunnel → 公网       │   │
│  └──────────────────────────┘   │
└─────────────────────────────────┘
```