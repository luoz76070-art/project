# 🐬 MySQL 集成详细文档

> 本文档详细记录 library-manage 系统如何连接到外部 MySQL 数据库 `luozhe-mysql`（Docker 容器）。
> 适用版本：v2.2+
>
> **最后更新**：修正了"系统级服务"等错误描述，新增"创建新用户 + 建表"完整流程（§12）、"如何定位 MySQL 实际位置"（§13）。

---

## 1. 概述

library-manage 系统从 v2.2 版本起，数据存储从 SQLite 迁移到外部 MySQL 数据库。这样做的好处：
- ✅ 多用户并发访问（SQLite 串行写入有限制）
- ✅ 数据集中管理（数据库独立于应用容器）
- ✅ 备份/恢复简单（标准 MySQL 工具链）
- ✅ 未来可横向扩展（MySQL 主从、读写分离）

### 1.1 架构图

```
┌────────────────────────────────────────────────────────┐
│  物理主机 worker01                                      │
│                                                         │
│  ┌──────────────────────────────────────┐               │
│  │  DinD 沙箱（= 我现在所在的环境）          │               │
│  │  - 沙箱本身也是 Docker 容器              │               │
│  │  - 沙箱的 docker 只看到自己启动的容器   │               │
│  │  - 容器: library-manage               │               │
│  │    └─ network_mode: host              │               │
│  │    └─ DATABASE_URL=mysql://...         │               │
│  └──────────────────────────────────────┘               │
│              │ TCP 3306                                 │
│              ↓ (跨容器网络路由)                          │
│  ┌──────────────────────────────────────┐               │
│  │  Docker 容器: luozhe-mysql            │               │
│  │  - MySQL 8.0.46                       │               │
│  │  - bind_address: 0.0.0.0 (所有接口)   │               │
│  │  - 容器内 datadir: /var/lib/mysql/    │               │
│  │  - 容器内 socket: /var/run/mysqld/... │               │
│  │  - 数据库: library-data (本项目)     │               │
│  │  - 字符集: utf8mb4                    │               │
│  └──────────────────────────────────────┘               │
└────────────────────────────────────────────────────────┘
```

**关键点**：
- MySQL **不是**装在系统里的服务（没有 `mysqld` systemd 单元）
- MySQL **是** worker01 主机上的一个 Docker 容器，名为 `luozhe-mysql`
- 沙箱（DinD）和应用容器（library-manage）通过 Docker 跨容器网络访问 luozhe-mysql
- 沙箱的 docker daemon 看不到 luozhe-mysql（DinD 限制），但能通过网络连上

> ⚠️ **重要更正**：本节第一版（v2.2 初次发布）错误地描述为"系统级服务"。感谢用户实际验证指出！详见 §13。

---

## 2. luozhe-mysql 容器信息

### 2.1 MySQL 基本信息

| 项目 | 值 |
|---|---|
| 容器名 | `luozhe-mysql` |
| MySQL 版本 | 8.0.46-0ubuntu0.22.04.3 |
| 操作系统 | Linux (Ubuntu 22.04) |
| 主机名（`@@hostname`） | `worker01`（与 DinD 沙箱同名） |
| 架构 | aarch64 (ARM64) |
| 容器内 datadir | `/var/lib/mysql/` |
| 监听端口 | 3306 |
| 绑定地址（`@@bind_address`） | `*`（即 `0.0.0.0`，所有接口） |
| 容器内 socket | `/var/run/mysqld/mysqld.sock` |
| 默认字符集 | utf8mb4 |
| 默认排序 | utf8mb4_0900_ai_ci |
| 存储引擎 | InnoDB |
| 最大连接 | 151 |
| SQL Mode | STRICT_TRANS_TABLES, NO_ZERO_DATE 等 |

### 2.2 数据库列表

| 数据库 | 用途 |
|---|---|
| `information_schema` | 系统元数据（自动） |
| `mysql` | 用户/权限表（系统） |
| `performance_schema` | 性能监控（系统） |
| `sys` | 诊断视图（系统） |
| `library-data` | **library-manage 项目数据库** |
| `shop` | 另一个项目（共享同一 MySQL 实例） |

### 2.3 用户账户

| 用户 | 主机 | 用途 | 认证插件 |
|---|---|---|---|
| `root@localhost` | localhost | 管理员账户（仅本地连接） | `mysql_native_password` |
| `appuser@%` | 任意 | 应用账户（library-manage 可选） | `caching_sha2_password` |
| `appuser@localhost` | localhost | 应用账户（同上冗余配置） | `caching_sha2_password` |
| `debian-sys-maint@localhost` | localhost | 系统维护 | `caching_sha2_password` |
| `mysql.infoschema@localhost` | localhost | 系统账户 | `caching_sha2_password` |
| `mysql.session@localhost` | localhost | 系统账户 | `caching_sha2_password` |
| `mysql.sys@localhost` | localhost | 系统账户 | `caching_sha2_password` |

> 当前应用实际使用 `root@localhost`（密码 `MyRoot@2024`），这是为了简化部署。**生产环境应创建专用用户**（见 §12）。

---

## 3. 连接详情

### 3.1 当前应用使用的连接

```bash
DATABASE_URL="mysql://root:MyRoot@2024@127.0.0.1:3306/library-data"
```

### 3.2 URL 各部分说明

```
mysql://root:MyRoot@2024@127.0.0.1:3306/library-data
│      │    │            │             │    │
│      │    │            │             │    └─ 数据库名（横线在反引号包裹时是合法的）
│      │    │            │             └─ 端口（默认 3306）
│      │    │            └─ 主机（127.0.0.1 = 沙箱视角的 localhost）
│      │    └─ 密码（生产环境务必替换为强随机密码）
│      └─ 用户名
└─ 协议（mysql = 走 mysql 协议）
```

### 3.3 为什么用 `127.0.0.1` 能连到 luozhe-mysql？

luozhe-mysql 容器虽然在其他 namespace，但通过 Docker 跨容器网络（bridge）路由后，沙箱能通过 `127.0.0.1:3306` 访问。详细定位方法见 §13。

**访问路径**：
```
应用容器 (127.0.0.1:3306)
   ↓
沙箱主机网络栈（network_mode: host 共享）
   ↓ Docker bridge 网络
luozhe-mysql 容器（监听 0.0.0.0:3306）
```

### 3.4 为什么用 `network_mode: host`？

应用容器默认在独立的网络 namespace 中，**看不到** 沙箱的 127.0.0.1。要让应用容器能直连宿主 3306，必须共享网络：

**解决方案对比**：
- 方案 A：`network_mode: host`（采用）→ 容器共享宿主网络
- 方案 B：MySQL 改为监听 `0.0.0.0` + 容器用宿主 IP `10.175.221.6` 连接
- 方案 C：使用 `host.docker.internal`（需 Docker 20.10+）

### 3.5 Prisma 怎么用这个 URL？

Prisma 内部用 `mysql2` Node 驱动。`DATABASE_URL` 在以下时机被读取：

| 时机 | 行为 |
|---|---|
| `prisma generate` | 生成 client（编译时） |
| `prisma db push` | 创建表结构（一次性） |
| `prisma migrate dev` | 开发模式迁移 |
| 应用运行时 | 所有 DB 查询（持续） |

**注意**：
- URL 不能有引号或多余空格
- `library-data` 包含横线 `-`，必须用反引号包裹（在 SQL 中）
- mysql2/promise 3.0+ 兼容 MySQL 8.0 的 `caching_sha2_password`

---

## 4. 数据库结构

### 4.1 表概览

| 表名 | 记录数（示例） | 用途 |
|---|---|---|
| `users` | 6 | 用户（管理员 + 学生） |
| `books` | 10 | 馆藏图书 |
| `borrows` | 1+ | 借阅记录（含历史） |
| `reservations` | 2 | 排队（库存为 0 时） |

### 4.2 users 表

```sql
CREATE TABLE `users` (
  `id` varchar(191) NOT NULL,
  `username` varchar(191) NOT NULL,
  `passwordHash` varchar(191) NOT NULL,  -- bcrypt 哈希（60 字符）
  `displayName` varchar(191) NOT NULL,
  `role` enum('STUDENT','ADMIN') NOT NULL DEFAULT 'STUDENT',
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_username_key` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 4.3 books 表

```sql
CREATE TABLE `books` (
  `id` varchar(191) NOT NULL,
  `title` varchar(191) NOT NULL,
  `author` varchar(191) NOT NULL,
  `isbn` varchar(191) DEFAULT NULL,
  `category` varchar(191) DEFAULT NULL,
  `description` text,
  `coverUrl` varchar(191) DEFAULT NULL,
  `totalCopies` int NOT NULL DEFAULT '1',
  `availableCopies` int NOT NULL DEFAULT '1',
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `books_isbn_key` (`isbn`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 4.4 borrows 表（含 enum）

```sql
CREATE TABLE `borrows` (
  `id` varchar(191) NOT NULL,
  `userId` varchar(191) NOT NULL,
  `bookId` varchar(191) NOT NULL,
  `status` enum('PENDING','APPROVED','BORROWED','RETURNED','OVERDUE','REJECTED') 
         NOT NULL DEFAULT 'PENDING',
  `requestedDays` int NOT NULL DEFAULT '30',
  `requestedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `approvedAt` datetime(3) DEFAULT NULL,
  `borrowedAt` datetime(3) DEFAULT NULL,
  `dueAt` datetime(3) DEFAULT NULL,
  `returnedAt` datetime(3) DEFAULT NULL,
  `rejectReason` varchar(191) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `borrows_userId_status_idx` (`userId`, `status`),
  KEY `borrows_bookId_status_idx` (`bookId`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 4.5 reservations 表

```sql
CREATE TABLE `reservations` (
  `id` varchar(191) NOT NULL,
  `userId` varchar(191) NOT NULL,
  `bookId` varchar(191) NOT NULL,
  `queuePosition` int NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `fulfilledAt` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `reservations_bookId_queuePosition_key` (`bookId`, `queuePosition`),
  KEY `reservations_bookId_createdAt_idx` (`bookId`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

## 5. 连接流程详解

### 5.1 应用启动时的连接流程

```
┌──────────────────────────────────────────────────────────────┐
│ 1. 容器启动                                                     │
│    ↓                                                           │
│ 2. CMD 启动 entrypoint.sh                                       │
│    ↓                                                           │
│ 3. 执行 db push（prisma db push --accept-data-loss）              │
│    - 读取 schema.prisma                                          │
│    - 用 DATABASE_URL 连接 MySQL                                  │
│    - 检查现有表结构                                                │
│    - 如有差异：调整；如无：跳过                                   │
│    ↓                                                           │
│ 4. 执行 seed.ts                                                  │
│    - 用 DATABASE_URL 连接 MySQL                                  │
│    - 删除现有数据                                                │
│    - 重新写入 6 用户 + 10 图书 + 借阅 + 排队                    │
│    ↓                                                           │
│ 5. exec node server.js（启动 Next.js）                          │
│    - 读取 DATABASE_URL                                            │
│    - PrismaClient 初始化（TCP 连接 127.0.0.1:3306）               │
│    - lazy connect（首次查询才真正连接）                          │
└──────────────────────────────────────────────────────────────┘
```

### 5.2 Prisma Client 初始化（懒加载）

```ts
// src/lib/db.ts
import { PrismaClient } from "@prisma/client";

export const db = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
});

// 第一次实际查询时才连接 MySQL
// 例如 await db.user.findMany() 会触发连接
```

### 5.3 连接复用

Prisma Client 内部维护连接池（默认 10 个连接）。每次查询复用池中连接，避免频繁建立 TCP。

### 5.4 连接超时与重试

- 连接超时：默认 10s
- 查询超时：默认 30s
- 死锁重试：Prisma 自动重试 5 次（可在 schema 配置）

---

## 6. Docker 网络配置详解

### 6.1 docker-compose.yml 关键片段

```yaml
services:
  library-manage:
    network_mode: host     # ← 关键！
    environment:
      DATABASE_URL: "mysql://root:MyRoot@2024@127.0.0.1:3306/library-data"
```

`network_mode: host` 的影响：
- ❌ 失去 Docker 网络隔离
- ✅ 可访问宿主机所有端口（包括 127.0.0.1）
- ⚠️ 端口冲突需注意（library-manage 用 3000）

### 6.2 替代方案：使用 `extra_hosts`

如果不想用 host network，可以用 Docker 自带的 `host.docker.internal`：

```yaml
services:
  library-manage:
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      DATABASE_URL: "mysql://root:MyRoot@2024@host.docker.internal:3306/library-data"
```

要求 Docker 20.10+。

### 6.3 让 luozhe-mysql 监听所有接口

如果不想 host network，可以让 luozhe-mysql 监听 `0.0.0.0`：

```bash
# 进入 luozhe-mysql 容器
docker exec -it luozhe-mysql bash

# 修改 MySQL 配置
vi /etc/mysql/mysql.conf.d/mysqld.cnf
# 改 bind-address = 0.0.0.0

# 重启 MySQL
docker restart luozhe-mysql
```

然后容器可通过 `10.175.221.6:3306` 连接（不再需要 host network）。

⚠️ **安全注意**：监听 0.0.0.0 意味着任何能访问宿主网络的人都能连 MySQL。生产环境务必配置防火墙或仅监听内网 IP。

---

## 7. 数据迁移过程

### 7.1 从 SQLite 迁移到 MySQL（v2.1 → v2.2）

详细步骤见 SPEC.md §18。简要流程：

```bash
# 1. 导出 SQLite 数据为 JSON
node scripts/export-sqlite.js
# 输出：/mnt/luozhe/mysql/backups/sqlite-export.json

# 2. 推送到 MySQL（创建表）
DATABASE_URL="mysql://..." pnpm exec prisma db push

# 3. 导入数据
node scripts/migrate-to-mysql.js
# 输出：写入 6 users + 10 books + ...

# 4. 验证
node scripts/verify-mysql.js
```

### 7.2 MySQL 数据备份（任务 2 产出）

```bash
# 进入 luozhe-mysql 容器跑 mysqldump
docker exec luozhe-mysql sh -c \
  'mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" \
   --single-transaction --routines --triggers --events \
   --add-drop-database --complete-insert \
   library-data' > /mnt/luozhe/mysql/luozhe-mysql/dump.sql
# 输出：/mnt/luozhe/mysql/luozhe-mysql/dump-all-databases.sql
```

包含内容：
- CREATE DATABASE / CREATE TABLE 语句
- 所有 INSERT 数据
- SET FOREIGN_KEY_CHECKS=0/1 控制外键

### 7.3 从零恢复（验证任务 2）

```bash
# 1. 创建新数据库
docker exec luozhe-mysql mysql -uroot -p"$MYSQL_ROOT_PASSWORD" \
  -e "CREATE DATABASE \`library-data\`"

# 2. 导入 dump
docker exec -i luozhe-mysql mysql -uroot -p"$MYSQL_ROOT_PASSWORD" library-data \
  < /mnt/luozhe/mysql/luozhe-mysql/dump-all-databases.sql

# 3. 验证
docker exec luozhe-mysql mysql -uroot -p"$MYSQL_ROOT_PASSWORD" \
  -e "SELECT COUNT(*) FROM \`library-data\`.users"
# 预期：6
```

---

## 8. 故障排查

### 8.1 应用无法连接 MySQL

| 错误 | 原因 | 解决 |
|---|---|---|
| `ECONNREFUSED 127.0.0.1:3306` | luozhe-mysql 容器没启动 | `docker start luozhe-mysql` |
| `EHOSTUNREACH` | 容器无法访问宿主网络 | 用 `network_mode: host` |
| `ER_ACCESS_DENIED` | 用户名密码错 | 检查 DATABASE_URL |
| `ER_BAD_DB_ERROR` | 数据库不存在 | 用 root 创建：`CREATE DATABASE \`library-data\`` |

### 8.2 表已存在但 schema 不匹配

prisma db push 会询问：
- 是否删除现有数据
- 是否生成迁移

推荐流程：
```bash
# 1. 备份
docker exec luozhe-mysql mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" \
  library-data > backup.sql

# 2. 推 schema（接受数据丢失警告）
DATABASE_URL="..." pnpm exec prisma db push --accept-data-loss

# 3. 重新导入备份（如果上一步删了数据）
docker exec -i luozhe-mysql mysql -uroot -p"$MYSQL_ROOT_PASSWORD" library-data < backup.sql
```

### 8.3 字符集问题

如果中文字符乱码，确保：
1. 数据库 `utf8mb4` / `utf8mb4_unicode_ci`
2. 表 `utf8mb4`
3. 连接 `charset=utf8mb4`

Prisma 默认使用 utf8mb4，无需额外配置。

### 8.4 连接数耗尽

默认 151 个最大连接。library-manage 默认池大小 10。
如多个实例或频繁查询导致连接耗尽：

```sql
SHOW STATUS LIKE 'Threads_connected';
SHOW VARIABLES LIKE 'max_connections';
```

临时调大：进入 luozhe-mysql 容器编辑配置：

```bash
docker exec -it luozhe-mysql bash
vi /etc/mysql/mysql.conf.d/mysqld.cnf
# 加 max_connections = 300
exit
docker restart luozhe-mysql
```

---

## 9. 监控与维护

### 9.1 常用 SQL 查询

```sql
-- 所有用户
SELECT id, username, role, isActive FROM `library-data`.users;

-- 在借图书
SELECT b.title, u.displayName, br.status, br.dueAt 
FROM `library-data`.borrows br 
JOIN `library-data`.users u ON br.userId = u.id 
JOIN `library-data`.books b ON br.bookId = b.id 
WHERE br.status IN ('APPROVED', 'BORROWED');

-- 排队
SELECT b.title, u.displayName, r.queuePosition 
FROM `library-data`.reservations r 
JOIN `library-data`.users u ON r.userId = u.id 
JOIN `library-data`.books b ON r.bookId = b.id 
WHERE r.fulfilledAt IS NULL 
ORDER BY b.id, r.queuePosition;

-- 热门 TOP 10
SELECT b.title, COUNT(*) AS borrow_count
FROM `library-data`.borrows br
JOIN `library-data`.books b ON br.bookId = b.id
GROUP BY b.id
ORDER BY borrow_count DESC
LIMIT 10;
```

### 9.2 性能监控

```sql
-- 慢查询
SHOW VARIABLES LIKE 'slow_query_log';
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 1;

-- 当前连接
SHOW PROCESSLIST;

-- 表大小
SELECT 
  TABLE_NAME,
  ROUND(DATA_LENGTH/1024/1024, 2) AS data_mb,
  ROUND(INDEX_LENGTH/1024/1024, 2) AS index_mb
FROM information_schema.tables 
WHERE TABLE_SCHEMA = 'library-data';
```

---

## 10. 备份与恢复（生产级）

### 10.1 定期备份脚本

```bash
#!/bin/bash
# /usr/local/bin/backup-library-data.sh
# 在 worker01 主机上运行（需 docker 命令权限）

BACKUP_DIR=/mnt/luozhe/mysql/backups
TS=$(date +%Y%m%d_%H%M%S)
MYSQL_PWD="MyRoot@2024"  # 或从环境变量/密钥管理工具读取

# 在 luozhe-mysql 容器内执行 mysqldump
docker exec luozhe-mysql mysqldump \
  -u root -p"${MYSQL_PWD}" \
  --single-transaction --routines --triggers --events \
  library-data | gzip > "$BACKUP_DIR/library-data-$TS.sql.gz"

# 保留最近 30 天备份
find "$BACKUP_DIR" -name "library-data-*.sql.gz" -mtime +30 -delete

echo "Backup completed: $BACKUP_DIR/library-data-$TS.sql.gz"
```

加入 cron（每天凌晨 2 点）：
```cron
0 2 * * * /usr/local/bin/backup-library-data.sh
```

### 10.2 恢复

```bash
# 1. 停止应用（避免恢复时数据冲突）
docker stop library-manage

# 2. 恢复数据库
gunzip library-data-20260728.sql.gz
docker exec -i luozhe-mysql mysql -u root -p"${MYSQL_PWD}" \
  -e "CREATE DATABASE IF NOT EXISTS \`library-data\`"
docker exec -i luozhe-mysql mysql -u root -p"${MYSQL_PWD}" library-data \
  < library-data-20260728.sql

# 3. 重启应用
docker start library-manage
```

---

## 11. 总结

| 阶段 | 内容 | 关键命令 |
|---|---|---|
| 验证连接 | 测试 luozhe-mysql 可达 | `mysql -h 127.0.0.1 -u root -p` |
| 创建数据库 | 创建 library-data | `CREATE DATABASE \`library-data\`` |
| 创建用户 + 授权 | 最小权限原则 | 见 §12 |
| 配置 Prisma | 改 schema.prisma + DATABASE_URL | 编辑 schema + .env |
| 推 schema | 创建表 | `prisma db push` |
| 导入数据 | 从 JSON / mysqldump | 见 §7 |
| 验证 | 数据 + 登录测试 | `curl /login` |

完整数据库连接细节在 §5。故障排查在 §8。备份策略在 §10。新用户+建表流程在 §12。

---

## 12. 从零接入 MySQL：创建新用户 + 建表完整流程

> 本节是面向**新建一个全新环境**的完整流程。如果 luozhe-mysql 容器已存在且能连上，可以直接跳到 12.5。

### 12.1 前置条件

```bash
# 1. luozhe-mysql 容器已运行
docker ps | grep luozhe-mysql
# 预期：luozhe-mysql   mysql:8.0   Up X minutes   0.0.0.0:3306->3306/tcp

# 2. 网络可达（沙箱内验证）
nc -zv 127.0.0.1 3306
# 预期：Connection to 127.0.0.1 3306 port [tcp/mysql] succeeded!

# 3. 知道 root 密码（本例 MyRoot@2024；生产环境用密钥管理）
```

### 12.2 用 root 连接 luozhe-mysql

```bash
# 方式 A：mysql 客户端（如果有）
docker exec -it luozhe-mysql mysql -u root -p
# 输入密码：MyRoot@2024

# 方式 B：Node.js mysql2（更通用，沙箱推荐）
node -e "
  const m = require('mysql2/promise');
  m.createConnection({host:'127.0.0.1',port:3306,user:'root',password:'MyRoot@2024'})
    .then(c => c.query('SELECT VERSION() AS v'))
    .then(([r]) => { console.log('MySQL:', r[0].v); c.end(); })
    .catch(e => console.error('FAIL:', e.message));
"
```

预期输出：
```
MySQL: 8.0.46-0ubuntu0.22.04.3
```

### 12.3 创建专用应用用户 `libapp`（推荐）

> ⚠️ **不要在生产环境直接用 root**。最小权限原则：应用只给必需的库 + 权限。

```sql
-- 1. 创建用户（caching_sha2_password 是 MySQL 8.0 默认）
CREATE USER 'libapp'@'%' IDENTIFIED BY 'StrongPassword123!';
--    主机 '%' 表示任意 IP 可连。生产环境应限制为 'libapp'@'10.175.%' 或具体 IP

-- 2. 授权：只给 library-data 库 + DML + DDL 权限
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON `library-data`.* TO 'libapp'@'%';
--    没有 DROP/TRUNCATE/CREATE USER 等高级权限，应用无法误删数据

-- 3. 刷新权限
FLUSH PRIVILEGES;

-- 4. 验证
SHOW GRANTS FOR 'libapp'@'%';
```

预期输出：
```
GRANTS FOR libapp@%
GRANT USAGE ON *.* TO `libapp`@`%`
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, REFERENCES, INDEX, ALTER ON `library-data`.* TO `libapp`@`%`
```

### 12.4 用新用户连接测试

```bash
# Node.js 测试
node -e "
  const m = require('mysql2/promise');
  m.createConnection({
    host:'127.0.0.1',port:3306,
    user:'libapp',password:'StrongPassword123!',
    database:'library-data'
  })
  .then(c => c.query('SELECT CURRENT_USER() AS u, DATABASE() AS db'))
  .then(([r]) => { console.log('连接成功:', r[0]); c.end(); })
  .catch(e => console.error('FAIL:', e.message));
"
```

预期：
```
连接成功: { u: 'libapp@%', db: 'library-data' }
```

### 12.5 创建数据库（如果还没有）

```sql
-- 用 root 创建
CREATE DATABASE IF NOT EXISTS `library-data` 
  CHARACTER SET utf8mb4 
  COLLATE utf8mb4_unicode_ci;
```

### 12.6 创建表（两种方式）

#### 方式 A：Prisma db push（推荐，与项目集成）

```bash
# 在项目目录中，指向新用户
cd /path/to/library-manage

# 设置 DATABASE_URL（用新建的 libapp）
export DATABASE_URL="mysql://libapp:StrongPassword123!@127.0.0.1:3306/library-data"

# 生成 Prisma client
pnpm exec prisma generate

# 创建表（不会影响其他表）
pnpm exec prisma db push --accept-data-loss
```

预期：
```
✔ Generated Prisma Client
🚀  Your database is now in sync with your Prisma schema.
```

#### 方式 B：手写 SQL

```bash
docker exec -i luozhe-mysql mysql -u libapp -p"StrongPassword123!" library-data <<'SQL'
CREATE TABLE IF NOT EXISTS users (
  id varchar(191) NOT NULL,
  username varchar(191) NOT NULL,
  passwordHash varchar(191) NOT NULL,
  displayName varchar(191) NOT NULL,
  role enum('STUDENT','ADMIN') NOT NULL DEFAULT 'STUDENT',
  isActive tinyint(1) NOT NULL DEFAULT '1',
  createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt datetime(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY users_username_key (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SQL
```

### 12.7 端到端验证

```bash
# 1. libapp 连接，查看表
docker exec luozhe-mysql mysql -u libapp -p"StrongPassword123!" library-data \
  -e "SHOW TABLES;"
# 预期：books / borrows / reservations / users（4 张表）

# 2. 写一条数据
node -e "
  const m = require('mysql2/promise');
  (async () => {
    const c = await m.createConnection({host:'127.0.0.1',port:3306,user:'libapp',password:'StrongPassword123!',database:'library-data'});
    await c.query('INSERT INTO users (id, username, passwordHash, displayName) VALUES (?, ?, ?, ?)',
      ['test-id-001', 'test_user', 'fake-hash', '测试用户']);
    const [rows] = await c.query('SELECT * FROM users WHERE username = ?', ['test_user']);
    console.log('插入成功:', rows[0]);
    await c.query('DELETE FROM users WHERE username = ?', ['test_user']);
    await c.end();
  })();
"
# 预期：插入成功，打印用户信息，测试数据被删除
```

### 12.8 应用使用新用户（生产环境推荐）

修改项目 `.env`：

```bash
# 从用 root 改为 libapp
DATABASE_URL="mysql://libapp:StrongPassword123!@127.0.0.1:3306/library-data"
```

> ⚠️ **生产环境务必替换密码**！用 `openssl rand -base64 32` 生成强随机密码。
> 
> 不要把生产密码 commit 到 Git！建议用 Docker secrets / Vault / 环境变量注入。

### 12.9 沙箱内实测结果

以下流程已在 luozhe-mysql 沙箱内**实测通过**（用临时 `libapp_test@%` + `test_libapp_verify` 库，不影响生产数据）：

```
✅ 1. 用 root 连接（MySQL 8.0.46-0ubuntu0.22.04.3）
✅ 2. CREATE DATABASE test_libapp_verify
✅ 3. CREATE USER 'libapp_test'@'%' IDENTIFIED BY 'TestPassword123!'
✅ 4. GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
✅ 5. FLUSH PRIVILEGES
✅ 6. SHOW GRANTS 验证权限
✅ 7. libapp_test 连接成功（caching_sha2_password）
✅ 8. CREATE TABLE test_books（InnoDB + utf8mb4）
✅ 9. INSERT 2 行数据
✅ 10. 越权访问其他库被拒绝
✅ 11. 清理：DROP DATABASE + DROP USER（luozhe-mysql 状态完全不变）
```

### 12.10 完整代码示例

完整的"创建用户 + 授权 + 建表"自动化脚本（用 Node.js）：

```js
// scripts/create-app-user.js
const mysql = require('mysql2/promise');

async function main() {
  const root = await mysql.createConnection({
    host: '127.0.0.1', port: 3306, user: 'root', password: 'MyRoot@2024'
  });

  const APP_USER = 'libapp';
  const APP_PASS = 'StrongPassword123!';
  const APP_DB = 'library-data';

  // 1. 创建数据库
  await root.query(
    `CREATE DATABASE IF NOT EXISTS \`${APP_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  console.log('✅ 数据库已存在');

  // 2. 创建/更新用户
  await root.query(`DROP USER IF EXISTS '${APP_USER}'@'%'`);
  await root.query(`CREATE USER '${APP_USER}'@'%' IDENTIFIED BY '${APP_PASS}'`);
  console.log('✅ 用户已创建');

  // 3. 授权
  await root.query(`
    GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
    ON \`${APP_DB}\`.* TO '${APP_USER}'@'%'
  `);
  await root.query('FLUSH PRIVILEGES');
  console.log('✅ 权限已授予');

  // 4. 验证
  const [grants] = await root.query(`SHOW GRANTS FOR '${APP_USER}'@'%'`);
  grants.forEach(g => console.log('  ', Object.values(g)[0]));

  await root.end();
  console.log(`\n🎉 完成！\n新 DATABASE_URL: mysql://${APP_USER}:${APP_PASS}@127.0.0.1:3306/${APP_DB}`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
```

---

## 13. 如何定位 MySQL 实际位置

> 这一节专门写给"为什么 MySQL 不在沙箱里却能连"困惑的读者。

### 13.1 DinD 沙箱的盲区

library-manage 沙箱是 **Docker-in-Docker** 容器。它的特点：

- 沙箱本身是 worker01 上的 Docker 容器
- 沙箱内**有自己的** docker daemon
- 这个 daemon **只管理沙箱内启动的容器**（如 library-manage）
- **看不到** worker01 上的其他容器（如 luozhe-mysql）

```bash
# 沙箱内执行 docker ps
docker ps
# 输出：只有 library-manage（沙箱启动的那个）
```

看不到 luozhe-mysql 是**正常的**，不代表 luozhe-mysql 不存在。

### 13.2 用 MySQL 服务信息反向定位

```bash
# 连接 MySQL 后查变量
node -e "
  const m = require('mysql2/promise');
  m.createConnection({host:'127.0.0.1',port:3306,user:'root',password:'MyRoot@2024'})
    .then(async c => {
      const [v] = await c.query(\`
        SELECT
          @@hostname AS hostname,
          @@version_compile_machine AS machine,
          @@version_compile_os AS os,
          @@basedir AS basedir,
          @@datadir AS datadir,
          @@socket AS socket,
          @@port AS port,
          @@bind_address AS bind_addr
      \`);
      console.log(v[0]);
      c.end();
    });
"
```

luozhe-mysql 输出示例：
```js
{
  hostname: 'worker01',           // ← 与沙箱同名
  machine: 'aarch64',
  os: 'Linux',
  basedir: '/usr/',
  datadir: '/var/lib/mysql/',
  socket: '/var/run/mysqld/mysqld.sock',
  port: 3306,
  bind_addr: '*'
}
```

**线索解读**：
- `hostname = worker01` 且与沙箱 hostname 相同 → 同一台物理机
- `datadir` 是 MySQL 容器**内部**的路径，**不是**宿主机路径

### 13.3 进程与文件系统排查

```bash
# 1. 沙箱里看不到 mysqld 进程
ps aux | grep mysqld
# 输出：空（mySQL 在其他 PID namespace）

# 2. /var/lib/mysql 不存在
ls /var/lib/mysql/
# 输出：No such file or directory

# 3. socket 不存在
ls /var/run/mysqld/
# 输出：No such file or directory

# 4. 但 3306 在监听
ss -tlnp | grep 3306
# 输出：:::3306 LISTEN（但无 PID 信息，socket 在其他 namespace）
```

**结论**：MySQL 在沙箱外的另一个 PID namespace（Docker 容器）。

### 13.4 网络特征确认

```bash
# 测试多个源地址能否连 3306
for ip in 127.0.0.1 10.175.221.6 10.175.224.6; do
  nc -zv $ip 3306 2>&1 | head -1
done
# 预期：全部能连（luozhe-mysql 监听 0.0.0.0）

# 关键验证：在 MySQL 端看连接的源地址
docker exec luozhe-mysql mysql -uroot -p"$MYSQL_PWD" \
  -e "SELECT USER, HOST, DB FROM information_schema.processlist WHERE USER != 'event_scheduler' LIMIT 10"
# 关键看 HOST 列：通常都是 localhost（因 bind_addr=*，所有连接显示为 loopback）
```

### 13.5 跨容器通信验证（最可靠）

**双向读写测试**（强烈推荐）：

```bash
# 1. 在沙箱内 host 写一条数据
node -e "
  const m = require('mysql2/promise');
  (async () => {
    const c = await m.createConnection({host:'127.0.0.1',port:3306,user:'root',password:'MyRoot@2024'});
    await c.query('CREATE TABLE IF NOT EXISTS \`library-data\`._test_conn (id VARCHAR(64) PRIMARY KEY, marker VARCHAR(255))');
    await c.query('INSERT INTO \`library-data\`._test_conn VALUES (\"host-test\", \"from-host\") ON DUPLICATE KEY UPDATE marker=VALUES(marker)');
    c.end();
  })();
"

# 2. 在应用容器内读这条数据
docker run --rm --network host -v /home/circleci/project/library-manage/scripts:/app/scripts:ro \
  --entrypoint="" library-manage:latest node -e "
    const m = require('mysql2/promise');
    m.createConnection({host:'127.0.0.1',port:3306,user:'root',password:'MyRoot@2024',database:'library-data'})
      .then(async c => {
        const [r] = await c.query('SELECT * FROM _test_conn WHERE id = ?', ['host-test']);
        console.log('应用容器读到 host 数据:', r[0]);
        await c.query('INSERT INTO _test_conn VALUES (\"app-test\", \"from-app\") ON DUPLICATE KEY UPDATE marker=VALUES(marker)');
        c.end();
      });
  "

# 3. 沙箱内再读，确认应用写入成功
node -e "
  const m = require('mysql2/promise');
  m.createConnection({host:'127.0.0.1',port:3306,user:'root',password:'MyRoot@2024'})
    .then(async c => {
      const [r] = await c.query('SELECT * FROM \`library-data\`._test_conn ORDER BY id');
      console.log('host 视角：', r);
      await c.query('DROP TABLE \`library-data\`._test_conn');
      c.end();
    });
"
```

预期：
```
应用容器读到 host 数据: { id: 'host-test', marker: 'from-host' }
host 视角: [
  { id: 'app-test', marker: 'from-app' },
  { id: 'host-test', marker: 'from-host' }
]
```

**两边都能读写 → 确认是同一个 MySQL 实例**。

### 13.6 100% 确证（如有 worker01 主机访问权限）

在 worker01 主机上执行：

```bash
# 列出所有容器
docker ps -a --format "table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"
# 找 MySQL 容器，看 NAMES 是不是 "luozhe-mysql"

# 查看 luozhe-mysql 详细信息
docker inspect luozhe-mysql | grep -E "(Name|Hostname|NetworkSettings|IPAddress)"
```

### 13.7 常见误解澄清

| 误解 | 真相 |
|---|---|
| "MySQL 是装在系统里的服务（systemd）" | ❌ MySQL 在 luozhe-mysql Docker 容器里 |
| "沙箱的 docker ps 应该能看到 luozhe-mysql" | ❌ DinD 沙箱的 docker 看不到外部容器 |
| "datadir /var/lib/mysql/ 应该在沙箱可见" | ❌ 这是容器内路径，外部访问不到 |
| "MySQL 只能在 127.0.0.1 访问" | ⚠️ 容器内监听 0.0.0.0，但因为 network namespace 隔离，应用容器需要 host network 才能连 |
| "host network 是不安全的" | ⚠️ 是的，但折衷方案是改 MySQL 监听地址 + 配置防火墙 |

---

**文档维护**：当你发现 MySQL 实际位置变更（如容器重启、迁移到新主机），请更新 §2.1 和 §13。

**问题反馈**：在 GitHub Issues 提 [Question] 标签，附上 `docker ps` 输出和 `@@hostname` 信息。
