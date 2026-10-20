# luozhe-mysql 镜像重建与运维报告

> 完整记录 luozhe-mysql 单容器架构的构建、数据持久化、日常运维和镜像重建流程。
> **核心原则**：单容器 + 命名数据卷 + 镜像源码可重建。

---

## 1. 架构概览

```
┌──────────────────────────────────────────────────────────┐
│  Host (worker01)                                          │
│                                                           │
│  ┌──────────────┐     ┌──────────────────────────────┐  │
│  │ luozhe-mysql │ ←→  │ luozhe-mysql-data (卷)        │  │
│  │ (容器)        │     │ /var/lib/mysql               │  │
│  │ 3320→3306    │     │ 删除容器不影响                │  │
│  │ 33080→33060  │     └──────────────────────────────┘  │
│  └──────────────┘                                        │
│                                                           │
│  /mnt/luozhe/mysql/                                       │
│  ├── docker-image/         ← 源码（可重建镜像）          │
│  ├── luozhe-mysql-v3.0.tar.gz   ← 镜像 tar 包           │
│  └── luozhe-mysql-v3.0.tar.gz.sha256                    │
└──────────────────────────────────────────────────────────┘
```

**关键信息**：

| 项 | 值 |
| --- | --- |
| 容器名 | `luozhe-mysql` |
| 镜像 | `luozhe-mysql:stable`（兼容 `:v3.0` `:latest`）|
| 数据卷 | `luozhe-mysql-data` |
| 端口 | 3320:3306（MySQL）、33080:33060（X Protocol）|
| root 密码 | `Mysql123` |
| appuser | `AppUser2024`（无 `@`，URL 友好）|
| 业务库 | `library-data` |
| 模板库 | `library-data-template` |

---

## 2. 一次性构建（首次部署）

### 2.1 准备源码

源码在 `/mnt/luozhe/mysql/docker-image/`，结构：

```
docker-image/
├── Dockerfile                    # 镜像定义
├── build.sh                      # 单文件 build 脚本
├── README.md                     # 文档
├── conf.d/
│   └── custom.cnf                # MySQL 配置（bind-address=0.0.0.0）
├── init-scripts/
│   ├── 01-data.sql               # 业务库 dump
│   └── 02-users.sql              # 重建用户授权
├── scripts/
│   ├── add-library-tenant.sh
│   ├── list-library-tenant.sh
│   ├── remove-library-tenant.sh
│   └── backup-library-tenant.sh
└── root-my.cnf                   # 自动登录配置
```

### 2.2 构建镜像（4 种方法任选）

**方法 A：用 `manage.sh`（推荐）**

```bash
/home/circleci/project/manage.sh build
```

**方法 B：手动 build**

```bash
cd /mnt/luozhe/mysql/docker-image
docker build -t luozhe-mysql:stable .
docker tag luozhe-mysql:stable luozhe-mysql:v3.0
docker tag luozhe-mysql:stable luozhe-mysql:latest
```

**方法 C：从 tar 包加载**

```bash
docker load -i /mnt/luozhe/mysql/luozhe-mysql-v3.0.tar.gz
```

**方法 D：导出到 tar**

```bash
docker save luozhe-mysql:stable | gzip > /mnt/luozhe/mysql/luozhe-mysql-v3.0.tar.gz
sha256sum /mnt/luozhe/mysql/luozhe-mysql-v3.0.tar.gz > \
  /mnt/luozhe/mysql/luozhe-mysql-v3.0.tar.gz.sha256
```

### 2.3 创建数据卷

```bash
docker volume create luozhe-mysql-data
```

---

## 3. 启动容器

### 3.1 标准启动

```bash
docker run -d \
  --name luozhe-mysql \
  -p 3320:3306 \
  -p 33080:33060 \
  --shm-size=4g \
  -v luozhe-mysql-data:/var/lib/mysql \
  -v /mnt:/mnt \
  -e MYSQL_ROOT_PASSWORD=Mysql123 \
  -e TZ=UTC \
  --restart unless-stopped \
  luozhe-mysql:stable
```

### 3.2 端口说明

| 宿主机 | 容器内 | 用途 |
| --- | --- | --- |
| 3320 | 3306 | MySQL 协议 |
| 33080 | 33060 | X Protocol |

> **3306/3307/3308/3309 被占用时**，用 3320+33080。如果还冲突，改环境变量 `MYSQL_PORT`/`XPROTO_PORT` 重新 build。

### 3.3 用 `manage.sh` 启动

```bash
manage.sh start
```

---

## 4. 日常运维

### 4.1 `manage.sh` 命令速查

```bash
manage.sh status     # 看容器/镜像/卷状态
manage.sh start      # 启动容器
manage.sh stop       # 停止容器
manage.sh restart    # 重启容器
manage.sh recreate   # 删容器重建（数据卷保留）
manage.sh backup     # 备份数据 → SQL
manage.sh restore <file>   # 从 SQL 恢复
manage.sh logs       # 看容器日志
manage.sh shell      # 进容器交互
manage.sh build      # 重新构建镜像
manage.sh export     # 导出镜像到 tar.gz
manage.sh clean      # ⚠️ 删容器+卷（数据全丢）
```

### 4.2 关键流程

**数据持久化原则**：永远**先备份，再 recreate**。

```bash
# 标准 recreate 流程
manage.sh backup                          # 1. 备份
manage.sh recreate                        # 2. 删容器重建（数据卷保留）
docker exec luozhe-mysql mysql -uroot -p'Mysql123' \
  -e "SELECT COUNT(*) FROM library-data.users;"   # 3. 验证数据
```

**验证容器完整性**：

```bash
docker exec luozhe-mysql mysqladmin ping -uroot -p'Mysql123'
docker exec luozhe-mysql mysql -uroot -p'Mysql123' \
  -e "SHOW DATABASES;"
docker exec luozhe-mysql mysql -uroot -p'Mysql123' library-data \
  -e "SELECT 'users' AS t, COUNT(*) AS n FROM users UNION ALL \
      SELECT 'books', COUNT(*) FROM books;"
```

**外部连接**：

```bash
mysql -h 127.0.0.1 -P 3320 -uappuser -p'AppUser2024' library-data
```

**租户管理**：

```bash
docker exec luozhe-mysql list-library-tenant.sh
docker exec luozhe-mysql add-library-tenant.sh alice
docker exec luozhe-mysql backup-library-tenant.sh alice
docker exec luozhe-mysql remove-library-tenant.sh alice
```

---

## 5. 镜像重建（改完源码后）

### 5.1 流程

```bash
# 1. 修改源码
vim /mnt/luozhe/mysql/docker-image/Dockerfile
vim /mnt/luozhe/mysql/docker-image/scripts/add-library-tenant.sh
# ...

# 2. 重新构建
manage.sh build
# 或：cd /mnt/luozhe/mysql/docker-image && docker build -t luozhe-mysql:stable .

# 3. 重启容器（用新镜像）
manage.sh recreate
```

### 5.2 Dockerfile 关键点

```dockerfile
FROM mysql:8.0
COPY conf.d/custom.cnf /etc/mysql/conf.d/custom.cnf
COPY scripts/ /usr/local/bin/
COPY root-my.cnf /root/.my.cnf
RUN chmod 600 /root/.my.cnf && chown root:root /root/.my.cnf
COPY init-scripts/ /docker-entrypoint-initdb.d/
USER mysql
EXPOSE 3306 33060
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["mysqld"]
```

> ⚠️ `USER mysql` 会让 `$HOME=/var/lib/mysql`，所以管理脚本要用 `~/.my.cnf` 而非 `/root/.my.cnf`。

### 5.3 重要修复记录

| 修复 | 文件 | 原因 |
| --- | --- | --- |
| `~/` 替代 `/root/` | 4 个 management scripts | 镜像以 `mysql` 用户运行 |
| 多 tag 同时导出 | Dockerfile | 避免引用失效 |
| 容器内 mysql 安装 base | `FROM mysql:8.0` | 用官方镜像，体积更小 |

---

## 6. 故障排查

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| `Can't connect to MySQL server on 3306` | 容器没启 / 端口被占 | `docker ps` 看端口 |
| `Access denied for user 'appuser'@'%'` | 密码错（含 `@`） | 用 `AppUser2024`（无 `@`），URL 用 `%40` 转义 |
| `OCI runtime exec failed: setns` | `network_mode: host` 冲突 | 用 bridge + `-p` 映射 |
| `Plugin caching_sha2_password could not be loaded` | 驱动太旧 | 镜像已用 `mysql_native_password`，无需处理 |
| 容器 recreate 后数据丢 | 没用数据卷 | 用 `-v luozhe-mysql-data:/var/lib/mysql` |
| `invalid reference format` | 宿主机 daemon 没镜像 | `docker load -i *.tar.gz` |
| `/root/.my.cnf 不存在` | 镜像以 `mysql` 运行 | 脚本改用 `~/.my.cnf` |

---

## 7. 数据迁移（从旧架构到新架构）

如果当前是旧架构（无数据卷的容器）：

```bash
# 1. 导出数据
docker exec <旧容器> mysqldump \
  -uroot -p'Mysql123' --single-transaction --routines \
  --databases library-data library-data-template \
  > migration.sql

# 2. 停旧容器
docker stop <旧容器>
docker rm <旧容器>

# 3. 启动新容器（带数据卷）
manage.sh start

# 4. 导入数据
docker exec -i luozhe-mysql mysql -uroot -p'Mysql123' < migration.sql

# 5. 验证
docker exec luozhe-mysql mysql -uroot -p'Mysql123' library-data \
  -e "SELECT COUNT(*) AS users FROM users;"
```

---

## 8. 版本历史

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| v3.0 | 2026-08-13 | 单容器架构 + 命名卷持久化 + 多 tag 镜像 |

---

## 9. 文件清单

```
/home/circleci/project/
├── manage.sh                                # 一键管理脚本（核心）
├── backups/                                 # 备份目录
│   └── luozhe-mysql_YYYYMMDD_HHMMSS.sql
└── P1_REPORT.md                             # 早期报告

/mnt/luozhe/mysql/
├── docker-image/                            # 源码（重建用）
├── luozhe-mysql-v3.0.tar.gz                 # 镜像 tar 包（224 MB）
├── luozhe-mysql-v3.0.tar.gz.sha256          # 校验文件
└── luozhe-mysql-v3.0-source.tar.gz          # 源码压缩备份
```

---

## 10. 验证清单（每次重建后跑）

```bash
# 1. 镜像存在
docker images luozhe-mysql

# 2. 容器启动
manage.sh start

# 3. MySQL 健康
docker exec luozhe-mysql mysqladmin ping -uroot -p'Mysql123'

# 4. 业务数据完整
docker exec luozhe-mysql mysql -uroot -p'Mysql123' library-data \
  -e "SELECT 'users' AS t, COUNT(*) AS n FROM users
      UNION ALL SELECT 'books', COUNT(*) FROM books
      UNION ALL SELECT 'borrows', COUNT(*) FROM borrows
      UNION ALL SELECT 'reservations', COUNT(*) FROM reservations;"

# 5. 用户授权
docker exec luozhe-mysql mysql -uroot -p'Mysql123' \
  -e "SHOW GRANTS FOR 'appuser'@'%';"

# 6. 管理脚本
docker exec luozhe-mysql list-library-tenant.sh

# 7. 外部连接
mysql -h 127.0.0.1 -P 3320 -uappuser -p'AppUser2024' library-data \
  -e "SELECT '✅' AS t;"
```

全部通过 = 重建成功。