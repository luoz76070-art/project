# 🗄️ MySQL 数据库管理员手册

> 适用于 `luozhe-mysql` 容器的日常运维与多租户管理。
> 配套脚本：`/usr/local/bin/{add,list,remove,backup}-library-tenant.sh`

---

## 📌 0. 基础信息

| 项 | 值 |
| --- | --- |
| 容器名 | `luozhe-mysql` |
| MySQL 版本 | 8.0.46 |
| 监听端口 | `3306`（MySQL）、`33060`（X Protocol） |
| 监听地址 | `*:3306`（所有网卡） |
| 容器 IP（宿主视角） | `10.175.221.6`、`10.175.224.6` |
| 业务库 | `library-data` |
| 模板库 | `library-data-template`（只读，应用不直连） |
| 默认字符集 | `utf8mb4` / `utf8mb4_unicode_ci` |

### 0.1 用户清单

| 用户 | Host | 插件 | 权限 |
| --- | --- | --- | --- |
| `root` | `localhost` | `mysql_native_password` | 全局 |
| `appuser` | `localhost` | `caching_sha2_password` | `library-data`.* |
| `appuser` | `%` | `caching_sha2_password` | `library-data`.* |
| `lib_<tenant>` | `%` | `mysql_native_password` | `library_<tenant>`.* |

> ⚠️ 当前 root 密码通过 `/root/.my.cnf` 管理（不在命令行明文传）。

---

## 🔐 1. 管理员连接 MySQL

### 1.1 从容器内部（最常用）

```bash
docker exec -it luozhe-mysql mysql -uroot
```

或简写：

```bash
mysql -uroot   # 自动读 /root/.my.cnf
```

### 1.2 从同主机其他容器

```bash
# 用 appuser 连接业务库
mysql -h 10.175.221.6 -P 3306 -uappuser -p'AppUser@2024' library-data

# 用 tenant user 连接自己租户的库
mysql -h 10.175.221.6 -P 3306 -ulib_alice -p'<密码>' library_alice
```

### 1.3 root 远程访问（仅内网）

```sql
CREATE USER 'root'@'%' IDENTIFIED BY '<强密码>';
GRANT ALL ON *.* TO 'root'@'%' WITH GRANT OPTION;
FLUSH PRIVILEGES;
```

> 生产环境**强烈不推荐** root 远程。建议用 `appuser` 或 `lib_<tenant>`。

---

## 🏘️ 2. 多租户管理 ⭐

### 2.1 设计思路

每个租户（一个组织 / 个人）获得：

```
├── 数据库: library_<username>          ← 私有库，互不可见
├── MySQL 用户: lib_<username>@'%'     ← 仅限自己库权限
└── 应用容器: library-<username>        ← 独立 library-manage 实例
```

### 2.2 开通新租户

```bash
add-library-tenant.sh alice
```

输出示例：

```
╔════════════════════════════════════════════════════════════╗
║               租户 alice 创建成功 (4 张表)                 ║
╠════════════════════════════════════════════════════════════╣
║  DB_HOST=10.175.221.6                                     ║
║  DB_PORT=3306                                             ║
║  DB_NAME=library_alice                                    ║
║  DB_USER=lib_alice                                        ║
║  DB_PASS=UVk9RwtRd2XiyRFyw3yoP2wiAck57PoC                ║
╠════════════════════════════════════════════════════════════╣
║  DATABASE_URL="mysql://lib_alice:UVk9R...@10.175.221.6:3306/library_alice"
╚════════════════════════════════════════════════════════════╝
```

把 `DATABASE_URL` 给租户方，让其启动：

```bash
docker run -d \
  --name library-alice \
  -p 3000:3000 \
  -e DATABASE_URL="mysql://lib_alice:UVk9R...@10.175.221.6:3306/library_alice" \
  -e NEXTAUTH_SECRET="$(openssl rand -base64 32)" \
  -e AUTH_SECRET="$(openssl rand -base64 32)" \
  -e AUTH_TRUST_HOST=true \
  --restart unless-stopped \
  library-manage:latest
```

自定义密码：

```bash
add-library-tenant.sh bob --password 'MyP@ss123'
```

### 2.3 列出所有租户

```bash
list-library-tenant.sh
```

输出：

```
+--------------+--------+-------------+----------------+
| 租户库       | 表数   | MySQL用户   | 总行数(估)     |
+--------------+--------+-------------+----------------+
| library_alice|   4    | lib_alice   |             45 |
| library_bob  |   4    | lib_bob     |            120 |
+--------------+--------+-------------+----------------+
```

### 2.4 备份租户

```bash
backup-tenant.sh alice
# → /home/circleci/project/backups/library_alice_20260813_125233.sql

backup-tenant.sh alice /tmp/alice-backup.sql
```

### 2.5 删除租户

```bash
remove-library-tenant.sh alice
# 需输入 'yes' 确认
```

> ⚠️ 删除会**永久丢失**该租户的所有数据。先用 `backup-tenant.sh` 备份。

### 2.6 模板库说明

- 位于 `library-data-template`
- 包含 4 张空表：`users / books / borrows / reservations`
- 新租户从这里克隆结构
- 修改模板：用 root 在 `library-data-template` 库里 `CREATE/ALTER/DROP`，不影响已存在的租户
- 已授权：`root@localhost`（仅 root 可写）

---

## 🛠️ 3. 常用运维命令

### 3.1 服务管理

```bash
# 容器内手动启动（仅无 systemd 环境）
mysqld --user=mysql --daemonize

# 状态
ps -p $(cat /var/run/mysqld/mysqld.pid 2>/dev/null) 2>/dev/null
ss -lntp | grep 3306
```

### 3.2 数据库与表

```bash
mysql -e "SHOW DATABASES;"
mysql library-data -e "SHOW TABLES;"
mysql library-data -e "DESC users;"
mysql library-data -e "SELECT * FROM books LIMIT 5;"
```

### 3.3 用户与权限

```bash
# 查看用户
mysql -e "SELECT User, Host, plugin FROM mysql.user;"

# 查看某用户权限
mysql -e "SHOW GRANTS FOR 'lib_alice'@'%';"

# 修改 appuser 密码
mysql -e "ALTER USER 'appuser'@'%' IDENTIFIED BY '新密码';"
mysql -e "FLUSH PRIVILEGES;"
```

### 3.4 备份与恢复

```bash
# 全量备份（除系统库）
mysqldump --all-databases --single-transaction --routines --triggers --events \
  > /home/circleci/project/backups/all_$(date +%F).sql

# 恢复单个库
mysql library-data < /home/circleci/project/backups/library_alice_20260813.sql

# 跨主机传输
scp backups/all_2026-08-13.sql root@other-host:/tmp/
```

---

## 🐛 4. 故障排查

### 4.1 常见报错速查

| 报错 | 原因 | 解决 |
| --- | --- | --- |
| `Access denied for user 'appuser'@'X.X.X.X'` | 密码错 / host 不匹配 / 插件不兼容 | 见 4.2 |
| `Plugin caching_sha2_password could not be loaded` | 客户端驱动太旧 | 升级驱动；或给用户换 `mysql_native_password` |
| `Connection refused at 10.175.221.6:3306` | mysqld 未启 / 防火墙 / 容器未运行 | `ss -lntp \| grep 3306` 检查监听 |
| `Table 'library-data.users' doesn't exist` | schema 未同步 | `prisma db push` |
| `OCI runtime exec failed: setns process` | `network_mode: host` 与 docker exec 冲突 | 改用 bridge 网络 |
| 容器重启后数据被清空 | `prisma/seed.ts` 非幂等 | 升级 library-manage v3.0+ |
| `Can't connect to local MySQL server through socket '/var/run/mysqld/mysqld.sock'` | mysqld 未启 | `mysqld --user=mysql --daemonize` |

### 4.2 密码错常见原因

**密码里有 `@`，被 URL 解析吞了！**

```bash
# 错误
DATABASE_URL="mysql://appuser:AppUser@2024@10.175.221.6:3306/library-data"
#                       ↑ URL parser 把 @ 当成 user 分隔符

# 正确（URL-encode @ 成 %40）
DATABASE_URL="mysql://appuser:AppUser%402024@10.175.221.6:3306/library-data"

# 更好（用无 @ 密码）
# 改密码：ALTER USER 'appuser'@'%' IDENTIFIED BY 'AppUser2024';
DATABASE_URL="mysql://appuser:AppUser2024@10.175.221.6:3306/library-data"
```

### 4.3 mysqld 启动失败排查

```bash
# 看错误日志
tail -30 /var/log/mysql/error.log
tail -30 /var/lib/mysql/worker01.err

# 数据目录权限
ls -la /var/lib/mysql/ | head

# 强制重启（跳过权限表，仅恢复用）
mysqld --user=mysql --daemonize --skip-grant-tables --skip-networking
```

### 4.4 重置 root 密码

```bash
# 1. 停 mysqld
mysqladmin -uroot shutdown   # 或 pkill mysqld

# 2. 跳过权限表启动
mysqld --user=mysql --daemonize --skip-grant-tables --skip-networking

# 3. 无密码登录
mysql -uroot

# 4. 重置密码
FLUSH PRIVILEGES;
ALTER USER 'root'@'localhost' IDENTIFIED BY 'NewPassword';

# 5. 重启（去掉 skip-grant-tables）
mysqladmin -uroot -p shutdown
mysqld --user=mysql --daemonize
```

---

## 🔒 5. 安全建议

### 5.1 必备

- [ ] 改掉默认 root 密码
- [ ] 把 appuser 的 `caching_sha2_password` 改为 `mysql_native_password`（若需兼容老驱动），或保持不变（更安全）
- [ ] 给 `appuser@%` 限定来源网段（生产）：
  ```sql
  DROP USER 'appuser'@'%';
  CREATE USER 'appuser'@'10.0.%' IDENTIFIED BY '...';
  GRANT ALL ON library-data.* TO 'appuser'@'10.0.%';
  ```
- [ ] 关闭 root 远程（生产）：
  ```sql
  DROP USER 'root'@'%';
  ```

### 5.2 推荐

- 启用 general_log 调试（性能影响 5-10%）
  ```sql
  SET GLOBAL general_log = ON;
  SET GLOBAL log_output = 'TABLE';
  -- 查看：SELECT * FROM mysql.general_log ORDER BY event_time DESC LIMIT 100;
  -- 关闭：SET GLOBAL general_log = OFF;
  ```
- 定期审计 `mysql.user` 表
- 备份文件加密传输（gpg / scp）
- 数据库密码走环境变量，不要硬编码

---

## 📂 6. 文件清单

| 路径 | 用途 |
| --- | --- |
| `/var/lib/mysql/` | 数据目录 |
| `/var/log/mysql/error.log` | 错误日志 |
| `/var/log/mysql/worker01.err` | 启动日志 |
| `/var/run/mysqld/mysqld.sock` | Unix Socket |
| `/root/.my.cnf` | root 自动登录配置（权限 600） |
| `/home/circleci/project/backups/` | 默认备份目录 |
| `/usr/local/bin/add-library-tenant.sh` | 创建租户 |
| `/usr/local/bin/list-library-tenant.sh` | 列出租户 |
| `/usr/local/bin/remove-library-tenant.sh` | 删除租户 |
| `/usr/local/bin/backup-library-tenant.sh` | 备份租户 |

---

**版本**：v3.0 · 2026-08-13