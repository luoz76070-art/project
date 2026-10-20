# 📦 Docker 镜像分发与加载指南

> 本文档说明如何获取预构建的 `library-manage` Docker 镜像，并在任意 Docker 环境中加载运行。
> 适合不想自己 build、需要离线/受限网络环境的用户。

---

## 📥 镜像获取

镜像已发布到 GitHub Releases：

👉 **https://github.com/luoz76070-art/project/releases**

下载最新的 `library-manage.tar.gz`（约 256 MB）。

### 通过浏览器下载

1. 打开 https://github.com/luoz76070-art/project/releases/latest
2. 在 Assets 区域点击 `library-manage.tar.gz`
3. 下载到本地任意目录

### 通过命令行下载

```bash
# Linux / macOS
wget https://github.com/luoz76070-art/project/releases/latest/download/library-manage.tar.gz

# macOS 也可用 curl
curl -L -o library-manage.tar.gz https://github.com/luoz76070-art/project/releases/latest/download/library-manage.tar.gz

# Windows (PowerShell)
Invoke-WebRequest -Uri "https://github.com/luoz76070-art/project/releases/latest/download/library-manage.tar.gz" -OutFile "library-manage.tar.gz"
```

---

## ✅ 完整性校验（推荐）

下载对应的 `.sha256` 文件，验证镜像未损坏：

```bash
# Linux / macOS
sha256sum -c library-manage.tar.gz.sha256

# Windows (PowerShell)
Get-FileHash -Algorithm SHA256 library-manage.tar.gz
# 然后比对 .sha256 文件中的值
```

预期 SHA256：`f3b63ac036ada73e32f2a67ee2244cca1ee784eb394e2e69b3912feaceecfba8`

---

## 🚀 加载镜像

```bash
# 加载镜像到本地 Docker
docker load -i library-manage.tar.gz
```

成功后会看到：

```
Loaded image: library-manage:latest
```

验证：

```bash
docker images | grep library-manage
# 预期输出：
# library-manage   latest    562577e076b0   ...   780MB
```

---

## 🎯 启动容器

### 方式 A：最简启动（推荐用于体验）

```bash
docker run -d \
  --name library-manage \
  -p 3000:3000 \
  -v library-data:/app/data \
  --restart unless-stopped \
  library-manage:latest
```

参数说明：
- `-d`：后台运行
- `--name library-manage`：容器命名（方便管理）
- `-p 3000:3000`：主机 3000 端口 → 容器 3000 端口
- `-v library-data:/app/data`：SQLite 数据持久化到命名卷
- `--restart unless-stopped`：开机自启（Docker daemon 重启后）

启动后等待 10-30 秒（首次启动会执行 Prisma db push），访问 **http://localhost:3000**。

### 方式 B：自定义环境变量

```bash
docker run -d \
  --name library-manage \
  -p 3000:3000 \
  -v library-data:/app/data \
  -e NEXTAUTH_SECRET="$(openssl rand -base64 32)" \
  -e AUTH_SECRET="$(openssl rand -base64 32)" \
  -e AUTH_TRUST_HOST=true \
  --restart unless-stopped \
  library-manage:latest
```

适合生产部署。`AUTH_TRUST_HOST=true` 用于反向代理场景。

### 方式 C：后台修改端口

```bash
docker run -d \
  --name library-manage \
  -p 8080:3000 \
  -v library-data:/app/data \
  library-manage:latest
```

主机 8080 端口访问，容器仍为 3000。

---

## 🌐 暴露公网

### 方案 1：Cloudflare Quick Tunnel（无需账号）

```bash
docker run -d \
  --name library-manage-tunnel \
  --network container:library-manage \
  cloudflare/cloudflared:latest \
  tunnel --no-autoupdate --url http://localhost:3000
```

查看分配的 URL：

```bash
docker logs -f library-manage-tunnel
```

会显示类似 `https://xxx.trycloudflare.com` 的 URL。

### 方案 2：自有域名 + Cloudflare Named Tunnel

需要：
1. 拥有自己的域名（如 `yourdomain.com`）
2. 在 Cloudflare 添加网站
3. 配置 Named Tunnel（参考 https://developers.cloudflare.com/cloudflare-one/connections/connect-apps）

---

## 📋 常用管理命令

```bash
# 查看容器状态
docker ps | grep library-manage

# 查看日志
docker logs library-manage
docker logs -f library-manage  # 持续跟踪

# 停止
docker stop library-manage

# 启动（已创建过）
docker start library-manage

# 重启
docker restart library-manage

# 删除容器（保留数据卷）
docker stop library-manage && docker rm library-manage

# 彻底清理（含数据）
docker stop library-manage && docker rm library-manage && docker volume rm library-data
```

---

## 💾 数据备份与恢复

### 备份

```bash
docker run --rm \
  -v library-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/library-data-$(date +%Y%m%d).tar.gz -C /data .
```

### 恢复

```bash
# 先停止容器
docker stop library-manage

# 删除旧卷
docker volume rm library-data

# 创建新卷并恢复数据
docker volume create library-data
docker run --rm \
  -v library-data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/library-data-20260721.tar.gz -C /data

# 重新启动
docker start library-manage
```

---

## 🔄 升级到新版本

```bash
# 1. 停止并删除旧容器（保留数据卷）
docker stop library-manage
docker rm library-manage

# 2. 加载新镜像
docker load -i library-manage.tar.gz

# 3. 启动（数据卷保持不变）
docker run -d \
  --name library-manage \
  -p 3000:3000 \
  -v library-data:/app/data \
  --restart unless-stopped \
  library-manage:latest
```

数据库、用户数据、配置全部保留。

---

## 🐛 故障排查

| 问题 | 解决方案 |
|---|---|
| `docker load` 报权限错误 | 加 `sudo` 或确保当前用户在 docker 组 |
| 容器启动后立即退出 | `docker logs library-manage` 查看错误 |
| 无法访问 `localhost:3000` | 等待 30 秒（首次启动慢）；检查 `docker ps` |
| 数据库错误 | 数据卷损坏：`docker volume rm library-data && 重启` |
| 端口被占用 | 改 `-p 3001:3000` 用其他端口 |

---

## 📞 获取帮助

- 📄 完整文档：[README.md](../README.md)
- 🐳 Docker 部署：[DOCKER.md](./DOCKER.md)
- 🐛 提交 Issue：https://github.com/luoz76070-art/project/issues
- 📋 SPEC：[SPEC.md](../SPEC.md)