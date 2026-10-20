# 🚀 零基础启动指南 — Library Manage

> 这份文档的目标是：**让从未接触过编程的人也能跑起来这个系统**。
> 你不需要懂代码、不需要懂 Docker、不需要懂数据库。照着步骤一步步复制粘贴就行。

---

## 📚 在开始之前，先了解这个系统由什么组成

```
┌─────────────────────────────────────────────────────┐
│                                                      │
│   你的浏览器（看到的网页界面）                          │
│         ↓                                            │
│   ┌─────────────────────────────────┐                │
│   │  前端（用户看得见的页面）           │                │
│   │  登录页、图书列表、申请借阅……      │                │
│   │  技术：Next.js（React 框架）       │                │
│   └─────────────┬───────────────────┘                │
│                 ↓                                    │
│   ┌─────────────────────────────────┐                │
│   │  后端（处理业务逻辑的"大脑"）       │                │
│   │  登录验证、借书记录、排队……       │                │
│   │  技术：Next.js Server Actions     │                │
│   └─────────────┬───────────────────┘                │
│                 ↓                                    │
│   ┌─────────────────────────────────┐                │
│   │  数据库（所有数据存在这里）         │                │
│   │  用户信息、图书信息、借阅记录       │                │
│   │  技术：SQLite（一个文件）          │                │
│   └─────────────────────────────────┘                │
│                                                      │
└─────────────────────────────────────────────────────┘
```

**简单理解**：
- **前端**：你看到的网页（按钮、文字、表格）
- **后端**：处理"用户点按钮后要做什么"（比如点"借书"就把数据存起来）
- **数据库**：所有数据都存在这里（就像一个 Excel 文件）

---

## 🎯 三种启动方式（选一种即可）

| 方式 | 适合人群 | 需要安装 | 难度 |
|---|---|---|---|
| ⭐ **方式 1：Docker 一键启动**（推荐） | 完全不懂技术的同学 | Docker Desktop | ⭐ |
| 方式 2：直接下载预构建镜像 | 会用 Docker | Docker Desktop | ⭐⭐ |
| 方式 3：从源代码启动 | 会装 Node.js 的同学 | Node.js + pnpm | ⭐⭐⭐ |

> 👉 **不知道选哪个？选方式 1。**

---

## 🐳 方式 1：Docker 一键启动（最推荐）

### 第 1 步：安装 Docker Desktop

#### Windows 用户
1. 打开 https://www.docker.com/products/docker-desktop/
2. 点击 **"Download for Windows"**
3. 下载完成后双击安装包，一路点 **Next** / **OK**
4. 安装完成后**重启电脑**
5. 重启后在任务栏右下角看到 🐳 图标 = 安装成功

#### macOS 用户
1. 打开 https://www.docker.com/products/docker-desktop/
2. 选择 **Apple Silicon** 或 **Intel Chip**（不知道选哪个？点左上角  → 关于本机 → 看芯片）
3. 下载 .dmg 文件，双击安装
4. 在启动台找到 Docker 并打开
5. 顶部菜单栏看到 🐳 图标 = 安装成功

#### Linux 用户（Ubuntu/Debian）
打开终端，依次执行：
```bash
# 安装 Docker
sudo apt update
sudo apt install -y docker.io

# 启动 Docker 服务
sudo systemctl enable --now docker

# 让当前用户能直接用 docker（免输 sudo）
sudo usermod -aG docker $USER
newgrp docker

# 验证
docker --version
```

### 第 2 步：下载项目代码

打开终端（macOS / Linux）或 PowerShell（Windows）：

```bash
cd ~/Desktop
git clone https://github.com/luoz76070-art/project.git library-manage
cd library-manage
```

> 💡 **没有 git？** 访问 https://github.com/luoz76070-art/project，点击绿色 **"Code" → "Download ZIP"**，解压到桌面。

### 第 3 步：进入 library-manage 子目录

```bash
cd library-manage
```

### 第 4 步：启动！

#### 🍎 macOS / 🐧 Linux
```bash
bash scripts/docker-setup.sh
```

#### 🪟 Windows PowerShell
```powershell
# Windows 没有 bash，请先安装 WSL 或 Git Bash
# 推荐用 Git Bash：https://git-scm.com/download/win
bash scripts/docker-setup.sh
```

你会看到类似输出：

```
[setup] 检查 Docker 与 docker compose...
[ok] Docker: Docker version 24.0.7
[setup] 创建 .env 文件（从模板）...
[setup] 构建镜像（首次约 2-5 分钟）...
[setup] 启动服务...
[ok] 部署完成 🎉
```

### 第 5 步：打开浏览器

浏览器访问：**http://localhost:3000**

看到登录页 = 启动成功 🎉

---

## 🔐 第 6 步：登录使用

### 演示账号

| 角色 | 用户名 | 密码 |
|---|---|---|
| 👑 管理员（功能最多） | `admin` | `admin1234` |
| 👨‍🎓 学生 | `student1` | `pass1234` |
| 👨‍🎓 学生 | `student2` | `pass1234` |
| 👨‍🎓 学生 | `student3` | `pass1234` |
| 👨‍🎓 学生 | `student4` | `pass1234` |
| 👨‍🎓 学生 | `student5` | `pass1234` |

### 推荐体验路径

```
1. 用 student1 登录     → 看学生界面（图书列表、申请借阅）
2. 退出，用 admin 登录  → 看管理员界面（数据看板、审批、补货、AI 助理）
3. 在数据看板看统计图表 → 这是 v2.0 的可视化看板
4. 打开 AI 助理         → 测试对话（演示模式，接入 AI 见下方）
```

---

## 🎁 方式 2：直接下载预构建镜像

适合：**已经装好 Docker 但不想 build 镜像**的用户。

### 第 1 步：安装 Docker（同方式 1 第 1 步）

### 第 2 步：下载镜像文件（约 285 MB）

打开 https://github.com/luoz76070-art/project/releases/tag/v2.1
点击 **library-manage.tar.gz** 下载到任意目录

### 第 3 步：加载镜像

打开终端，cd 到下载目录：

```bash
# 加载镜像到 Docker
docker load -i library-manage.tar.gz

# 看到这条说明成功：
# Loaded image: library-manage:latest
```

### 第 4 步：启动容器

```bash
docker run -d \
  --name library-manage \
  -p 3000:3000 \
  -v library-data:/app/data \
  --restart unless-stopped \
  library-manage:latest
```

### 第 5 步：打开浏览器

**http://localhost:3000** ← 看到登录页就成功了

---

## 🛠 方式 3：从源代码启动（开发者用）

适合：**想修改代码**的同学。需要先装 Node.js。

### 第 1 步：安装 Node.js

访问 https://nodejs.org/ ，下载并安装 **LTS 版本**（推荐 20.x）

安装后在终端验证：
```bash
node --version    # 应显示 v20.x.x
npm --version     # 应显示 10.x.x
```

### 第 2 步：下载项目代码

```bash
cd ~/Desktop
git clone https://github.com/luoz76070-art/project.git library-manage
cd library-manage/library-manage
```

### 第 3 步：安装依赖

```bash
npm install
```

> ⏱️ 首次约 1-3 分钟，请耐心等待。

### 第 4 步：初始化数据库

```bash
npm run db:push      # 创建数据表
npm run db:seed      # 写入演示数据
```

### 第 5 步：启动开发服务器

```bash
npm run dev
```

看到：
```
✓ Ready in 2.5s
```
= 启动成功

### 第 6 步：打开浏览器

**http://localhost:3000**

---

## 🧰 常用管理命令

### 查看服务状态

```bash
docker ps | grep library-manage
```

### 查看运行日志

```bash
docker logs -f library-manage
```

按 `Ctrl+C` 退出日志查看（容器继续运行）。

### 停止服务

```bash
docker stop library-manage
```

### 重新启动

```bash
docker start library-manage
```

### 重启（先停再开）

```bash
docker restart library-manage
```

### 完全卸载（删除容器和数据）

```bash
docker stop library-manage
docker rm library-manage
docker volume rm library-data    # ⚠️ 会删除所有数据库内容！
```

---

## 🆘 遇到问题？看这里

### 问题 1：Docker Desktop 没启动

**症状**：执行 `docker ps` 报错 `Cannot connect to the Docker daemon`

**解决**：
- Windows / macOS：找到 🐳 图标并启动 Docker Desktop
- Linux：`sudo systemctl start docker`

---

### 问题 2：3000 端口被占用

**症状**：启动报错 `bind: address already in use`

**解决**：

```bash
# macOS / Linux：找出占用进程
lsof -i :3000
kill -9 <PID>

# Windows PowerShell
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

或者换端口启动：
```bash
docker run -d --name library-manage -p 3001:3000 \
  -v library-data:/app/data library-manage:latest
# 然后访问 http://localhost:3001
```

---

### 问题 3：忘记密码

**解决**：数据库是 SQLite 单文件，在项目目录的 `data/library.db`。
最简单的方法：删除数据库重启，数据会重置为演示数据。

```bash
docker stop library-manage
docker rm library-manage
docker volume rm library-data
bash scripts/docker-setup.sh   # 重新启动会自动恢复演示数据
```

---

### 问题 4：浏览器打开是空白页

**解决**：
1. 检查 Docker 容器是否在运行：`docker ps | grep library-manage`
2. 查看日志：`docker logs library-manage | tail -20`
3. 等待 30 秒（首次启动会执行数据库初始化）

---

### 问题 5：Windows 上 Git Bash 报错找不到脚本

**症状**：`bash: scripts/docker-setup.sh: No such file or directory`

**解决**：确认你在 `library-manage/library-manage` 目录下（有 `Dockerfile` 和 `docker-compose.yml` 的那个）。

---

### 问题 6：拉取 GitHub 慢/失败

**症状**：`git clone` 超时或失败

**解决**：从 https://github.com/luoz76070-art/project/releases/tag/v2.1 下载 `Source code (zip)`，解压即可。

---

### 问题 7：AI 助理功能想用真模型

**当前状态**：AI 助理是 mock 演示模式。

**启用真实模型**：编辑 `.env` 文件，填入：
```env
AI_PROVIDER_API_KEY="你的-key"
AI_PROVIDER_BASE_URL="https://api.MiniMax.com/v1"
AI_MODEL="MiniMax-M2"
```

然后重启容器：`docker restart library-manage`

---

## 🎓 系统说明（给想了解原理的人）

### 数据存在哪？

所有数据存在一个 SQLite 文件里，路径：
- Docker 部署：`library-data` 命名卷（Docker 自动管理）
- 源码部署：`./data/library.db`

### 我修改了代码会怎样？

**Docker 方式**：
1. 修改代码后 `docker compose up -d --build`
2. Docker 会重新构建镜像并重启容器

**源码方式**：
1. 修改代码后 Next.js 自动热更新（dev 模式）
2. 无需手动重启

### 升级到新版本

```bash
# 1. 停止旧版本
docker stop library-manage

# 2. 删除旧容器（保留数据卷）
docker rm library-manage

# 3. 加载新镜像
docker load -i library-manage-v2.2.tar.gz   # 假设新版本文件名

# 4. 启动
docker run -d --name library-manage \
  -p 3000:3000 -v library-data:/app/data \
  --restart unless-stopped library-manage:latest
```

数据卷 `library-data` 不会丢失，所有数据保留。

---

## 📊 系统架构图

```
┌────────────────────────────────────────────────┐
│  浏览器 (Chrome / Safari / Firefox)              │
│         ↓ HTTP 请求                              │
│  http://localhost:3000                          │
└─────────────┬──────────────────────────────────┘
              ↓
┌────────────────────────────────────────────────┐
│  Docker 容器 (library-manage)                   │
│  ┌──────────────────────────────────────────┐  │
│  │  Node.js 20 (Alpine Linux)                │  │
│  │  ┌────────────────────────────────────┐  │  │
│  │  │  Next.js 应用                       │  │  │
│  │  │  ┌────────────┐  ┌──────────────┐  │  │  │
│  │  │  │   前端     │  │    后端      │  │  │  │
│  │  │  │  React/TS  │  │  Server      │  │  │  │
│  │  │  │  页面组件  │  │  Actions     │  │  │  │
│  │  │  └────────────┘  └──────┬───────┘  │  │  │
│  │  └───────────────────────│──────────┘  │  │
│  │                          ↓              │  │
│  │                  ┌──────────────┐       │  │
│  │                  │  Prisma ORM  │       │  │
│  │                  └──────┬───────┘       │  │
│  └─────────────────────────│───────────────┘  │
│                            ↓                  │
│  ┌─────────────────────────│───────────────┐  │
│  │  数据库 SQLite（单个文件）              │  │
│  │  /app/data/library.db                  │  │
│  └────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘
```

---

## 📞 还有问题？

- 📖 看完整文档：`README.md`
- 🐳 Docker 部署详解：`docs/DOCKER.md`
- 📦 镜像加载：`docs/IMAGE.md`
- 🐛 提 Issue：https://github.com/luoz76070-art/project/issues

---

## ✨ 一句话总结

> 装 Docker → 下载代码 → 跑 `bash scripts/docker-setup.sh` → 浏览器开 http://localhost:3000 → 用 `admin / admin1234` 登录

**就这四步，搞定。** 🎉