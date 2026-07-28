# 🐬 MySQL 集成详细文档

> 本文档详细记录 library-manage 系统如何连接到外部 MySQL 数据库 `luozhe-mysql`。
> 适用版本：v2.2+

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
│  主机 10.175.221.6                                      │
│                                                         │
│  ┌──────────────────────────────────────┐               │
│  │  MySQL 服务（系统级）                   │               │
│  │  - 主机名: worker01                    │               │
│  │  - 监听: 127.0.0.1:3306                │               │
│  │  - 数据: /var/lib/mysql/                │               │
│  │  - 数据库: library-data                  │               │
│  │  - 字符集: utf8mb4                      │               │
│  └─────────────┬─────────────────────────┘               │
│                │                                          │
│                │ TCP 3306 (loopback)                       │
│                ↓                                          │
│  ┌──────────────────────────────────────┐               │
│  │  Docker 容器: library-manage           │               │
│  │  - network_mode: host                   │               │
│  │  - DATABASE_URL=mysql://...             │               │
│  └──────────────────────────────────────┘               │
└────────────────────────────────────────────────────────┘
```

---

## 2. MySQL 服务信息

### 2.1 服务基本信息

| 项目 | 值 |
|---|---|
| 版本 | MySQL 8.0.46-0ubuntu0.22.04.3 |
| 操作系统 | Linux (Ubuntu 22.04) |
| 主机名 | worker01 |
| 架构 | aarch64 (ARM64) |
| 数据目录 | /var/lib/mysql/ |
| 端口 | 3306 |
| 绑定地址 | 127.0.0.1 (`bind-address: *`) |
| Socket | /var/run/mysqld/mysqld.sock |
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

| 用户 | 主机 | 用途 |
|---|---|---|
| `root@localhost` | localhost | 管理员账户（仅本地连接） |
| `appuser@%` | 任意 | 应用账户（library-manage 可选） |
| `debian-sys-maint@localhost` | localhost | 系统维护 |
| `mysql.infoschema@localhost` | localhost | 系统账户 |
| `mysql.session@localhost` | localhost | 系统账户 |
| `mysql.sys@localhost` | localhost | 系统账户 |

---

## 3. 连接详情

### 3.1 library-manage 使用的连接

```bash
DATABASE_URL="mysql://root:MyRoot@2024@127.0.0.1:3306/library-data"
```

### 3.2 URL 各部分说明

```
mysql://root:MyRoot@2024@127.0.0.1:3306/library-data
│      │    │            │             │    │
│      │    │            │             │    └─ 数据库名
│      │    │            │             └─ 端口（默认 3306）
│      │    │            └─ 主机（127.0.0.1 = 沙箱自己）
│      │    └─ 密码（示例，请替换为你的实际密码）
│      └─ 用户名
└─ 协议（mysql = 走 mysql 协议）
```

### 3.3 为什么用 `network_mode: host`？

MySQL 监听 `127.0.0.1:3306`（只接受本地连接）。Docker 容器默认在独立的网络命名空间中，访问不到宿主机的 127.0.0.1。

**解决方案**：
- 方案 A：`network_mode: host`（采用此方案）→ 容器共享宿主网络
- 方案 B：MySQL 改为监听 `0.0.0.0` → 容器可通过宿主 IP 连接
- 方案 C：使用 `host.docker.internal`（新版 Docker 支持，需 Docker 20.10+）

### 3.4 Prisma 怎么用这个 URL？

Prisma 内部用 `mysql2` Node 驱动。`DATABASE_URL` 在以下时机被读取：

| 时机 | 行为 |
|---|---|
| `prisma generate` | 生成 client（编译时） |
| `prisma db push` | 创建表结构（一次性） |
| `prisma migrate dev` | 开发模式迁移 |
| 应用运行时 | 所有 DB 查询（持续） |

**注意**：URL 不能有引号或多余空格，否则 Prisma 会解析失败。

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

### 6.3 MySQL 监听地址的妥协方案

如果不想 host network，可以改 MySQL 监听 `0.0.0.0`：

```ini
# /etc/mysql/mysql.conf.d/mysqld.cnf
bind-address = 0.0.0.0
```

```bash
sudo systemctl restart mysql
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
# 用 Node.js 模拟 mysqldump
node scripts/dump-mysql.js
# 输出：/mnt/luozhe/mysql/luozhe-mysql/dump-all-databases.sql
```

包含内容：
- CREATE DATABASE / CREATE TABLE 语句
- 所有 INSERT 数据
- SET FOREIGN_KEY_CHECKS=0/1 控制外键

### 7.3 从零恢复（验证任务 2）

```bash
# 1. 创建新数据库
mysql -e "CREATE DATABASE library_data"

# 2. 执行 dump
mysql library_data < dump-all-databases.sql

# 3. 验证
mysql -e "SELECT COUNT(*) FROM library_data.users"
# 预期：6
```

---

## 8. 故障排查

### 8.1 应用无法连接 MySQL

| 错误 | 原因 | 解决 |
|---|---|---|
| `ECONNREFUSED 127.0.0.1:3306` | MySQL 没启动 | `sudo systemctl start mysql` |
| `EHOSTUNREACH` | 容器无法访问宿主网络 | 用 `network_mode: host` |
| `ER_ACCESS_DENIED` | 用户名密码错 | 检查 DATABASE_URL |
| `ER_BAD_DB_ERROR` | 数据库不存在 | `CREATE DATABASE library-data` |

### 8.2 表已存在但 schema 不匹配

prisma db push 会询问：
- 是否删除现有数据
- 是否生成迁移

推荐流程：
```bash
# 备份
mysqldump library-data > backup.sql

# 推 schema（接受数据丢失警告）
DATABASE_URL="..." pnpm exec prisma db push --accept-data-loss
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

临时调大：编辑 `/etc/mysql/mysql.conf.d/mysqld.cnf`：
```ini
max_connections = 300
```

---

## 9. 监控与维护

### 9.1 常用 SQL 查询

```sql
-- 所有用户
SELECT id, username, role, isActive FROM users;

-- 在借图书
SELECT b.title, u.displayName, br.status, br.dueAt 
FROM borrows br 
JOIN users u ON br.userId = u.id 
JOIN books b ON br.bookId = b.id 
WHERE br.status IN ('APPROVED', 'BORROWED');

-- 排队
SELECT b.title, u.displayName, r.queuePosition 
FROM reservations r 
JOIN users u ON r.userId = u.id 
JOIN books b ON r.bookId = b.id 
WHERE r.fulfilledAt IS NULL 
ORDER BY b.id, r.queuePosition;

-- 热门 TOP 10
SELECT b.title, COUNT(*) AS borrow_count
FROM borrows br
JOIN books b ON br.bookId = b.id
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

BACKUP_DIR=/mnt/luozhe/mysql/backups
TS=$(date +%Y%m%d_%H%M%S)

mysqldump -h 127.0.0.1 -u root -p"$MYSQL_PWD" \
  --single-transaction --routines --triggers --events \
  library-data | gzip > "$BACKUP_DIR/library-data-$TS.sql.gz"

# 保留最近 30 天备份
find "$BACKUP_DIR" -name "library-data-*.sql.gz" -mtime +30 -delete

echo "Backup completed: $BACKUP_DIR/library-data-$TS.sql.gz"
```

加入 cron：
```cron
0 2 * * * /usr/local/bin/backup-library-data.sh
```

### 10.2 恢复

```bash
# 解压
gunzip library-data-20260728.sql.gz

# 恢复
mysql -h 127.0.0.1 -u root -p"$MYSQL_PWD" library-data < library-data-20260728.sql
```

---

## 11. 总结

| 阶段 | 内容 | 关键命令 |
|---|---|---|
| 验证连接 | 测试 MySQL 可达 | `mysqladmin ping -h 127.0.0.1` |
| 创建数据库 | 创建 library-data | `CREATE DATABASE library-data` |
| 配置 Prisma | 改 schema.prisma + DATABASE_URL | 编辑 schema + .env |
| 推 schema | 创建表 | `prisma db push` |
| 导入数据 | 从 JSON / mysqldump | `node scripts/migrate-to-mysql.js` |
| 验证 | 数据 + 登录测试 | `mysql -e "SELECT ..."` + curl /login |

完整数据库连接细节在 §5。故障排查在 §8。备份策略在 §10。
