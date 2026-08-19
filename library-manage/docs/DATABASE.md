# 数据库配置

## 为什么 `.env.example` 不再包含 root 凭据

默认 `root` 凭据会带来 4 个真实问题：

| 问题 | 说明 |
|---|---|
| **数据互相污染** | 多人共用同一个数据库，学员 A 添加的书 / 用户，学员 B 立刻看到；学员 A 禁用某用户，学员 B 登录失败 |
| **Seed 冲突** | 同时跑 `pnpm db:seed` 时，`admin` 用户名重复报错 |
| **无法隔离调试** | 想"清空自己的数据重来"会影响别人 |
| **安全反模式** | 把 root 密码写进 `.env`、提交到仓库，是生产环境事故的常见来源 |

本项目要求**每个学员使用自己的 MySQL 账户和数据库**。

---

## 一、创建你的个人账户与数据库

在 MySQL 服务器上执行（每个学员独立执行一次）：

```sql
-- 1. 创建属于你的数据库（请把 <your_id> 换成你的学号或唯一标识）
CREATE DATABASE IF NOT EXISTS library_data_<your_id>
  DEFAULT CHARSET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- 2. 创建属于你的用户
CREATE USER 'lib_<your_id>'@'%' IDENTIFIED BY '<your_password>';

-- 3. 仅授予你这个数据库的全部权限（最小权限原则）
GRANT ALL PRIVILEGES ON library_data_<your_id>.*
  TO 'lib_<your_id>'@'%';

-- 4. 刷新权限
FLUSH PRIVILEGES;
```

示例（学号 `20260001`）：

```sql
CREATE DATABASE IF NOT EXISTS library_data_20260001
  DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'lib_20260001'@'%' IDENTIFIED BY 'MyP@ssw0rd';
GRANT ALL PRIVILEGES ON library_data_20260001.* TO 'lib_20260001'@'%';
FLUSH PRIVILEGES;
```

> **提示**：密码不要使用 `123456`、`password` 这种弱口令。本地开发至少 8 位混合字符。

---

## 二、修改 `.env`

```bash
# 在项目根目录
cp .env.example .env

# 编辑 .env，把 DATABASE_URL 改为：
DATABASE_URL="mysql://lib_<your_id>:<your_password>@127.0.0.1:3306/library_data_<your_id>"
```

示例：

```
DATABASE_URL="mysql://lib_20260001:MyP@ssw0rd@127.0.0.1:3306/library_data_20260001"
```

> 注意 `.env` 是本地配置，**不要提交到 Git**。`.gitignore` 已经把它排除。

---

## 三、使用 `start-library.sh` 启动

`start-library.sh` 通过环境变量覆盖数据库连接，避免改 `.env`：

```bash
DB_HOST=127.0.0.1 \
DB_USER=lib_20260001 \
DB_PASSWORD='MyP@ssw0rd' \
DB_NAME=library_data_20260001 \
LM_PORT=3000 \
./start-library.sh
```

脚本会自动 `pnpm install` → `prisma generate` → 创建数据库（如果不存在）→ `pnpm dev`。

---

## 四、验证

```bash
pnpm db:push    # 推送 schema 到你的数据库
pnpm db:seed    # 灌入种子数据（admin / student / 示例图书）
pnpm dev        # 启动开发服务
```

浏览器打开 `http://localhost:3000/login`，用以下账号登录：

| 角色 | 用户名 | 密码 |
|---|---|---|
| 管理员 | `admin` | `admin1234` |
| 学生 | `student1` ~ `student5` | `pass1234` |

成功登录 → 数据库配置完成。

---

## 五、故障排查

### 5.1 连接失败：`ECONNREFUSED 127.0.0.1:3306`

- MySQL 服务未启动：`sudo systemctl start mysql`（或 `docker start luozhe-mysql`）
- 端口被防火墙拦截

### 5.2 权限不足：`ER_ACCESS_DENIED_ERROR`

- 用户名 / 密码错误
- 重新执行 `GRANT ... TO ...` 并 `FLUSH PRIVILEGES`

### 5.3 数据库不存在：`ER_BAD_DB_ERROR`

- 没建数据库：执行 `CREATE DATABASE library_data_<your_id>`

### 5.4 中文 / emoji 乱码

- 数据库字符集必须是 `utf8mb4`，不是 `utf8`：
  ```sql
  ALTER DATABASE library_data_<your_id> DEFAULT CHARSET utf8mb4;
  ```

---

## 六、进阶思考（生产环境思路）

| 问题 | 思路 |
|---|---|
| 凭据放哪？ | 本地 `.env`（已 `.gitignore`），生产用 Vault / AWS Secrets Manager |
| 如何轮转？ | 凭据分两层：应用账户（仅 `library_data.*` 的 DML）vs 迁移账户（DDL） |
| 连接池？ | 生产建议加 PgBouncer / ProxySQL 中间件 |
| 审计？ | MySQL `general_log` 或审计插件 |

本作业不涉及，但理解这些有助于从"能跑"过渡到"能上生产"。