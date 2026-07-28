# 🗄️ MySQL 数据库部署与运维指南

> 本文档汇总 `luozhe-mysql` 容器的部署、连接、跨容器访问、备份、运维等命令，跟 `DOCKER.md` 配套使用。

## 📌 一、环境信息

| 项目 | 值 |
| --- | --- |
| 容器名 | `luozhe-mysql` |
| MySQL 版本 | `8.0.46` |
| 监听端口 | `3306`（所有网卡）、`33060`（X Protocol） |
| root 密码 | `MyRoot@2024` |
| 业务库 | `library-data`（utf8mb4） |
| 业务用户 | `appuser` / `AppUser@2024` |

## 🔍 网络信息查询

```bash
# 查看 luozhe-mysql 所在的所有网络及 IP
docker inspect luozhe-mysql --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} => {{$v.IPAddress}}{{"\n"}}{{end}}'

# 示例输出：
#   bridge   => 172.17.0.2
#   app-net  => 172.24.0.1

# 只看 IP
docker inspect luozhe-mysql --format '{{.NetworkSettings.IPAddress}}'

# 看 MySQL 是否真的监听 0.0.0.0
docker exec luozhe-mysql ss -lntp | grep 3306
# 期望：*:3306 或 0.0.0.0:3306
```

## 🔌 从其他容器连接 MySQL

### 1. 临时客户端测试（最快）

```bash
# 把容器 IP 替换为你查到的实际值
docker run -it --rm \
  --network bridge \
  mysql:8.0 \
  sh -c "mysql -h 172.17.0.2 -P 3306 -uappuser -p'AppUser@2024' `library-data` -e 'SHOW TABLES;'"
```

期望输出：

```
Tables_in_library-data
orders
products
```

### 2. 业务容器启动（环境变量方式）

```bash
docker run -d \
  --network bridge \
  --name my-app \
  -e DB_HOST=172.17.0.2 \
  -e DB_PORT=3306 \
  -e DB_USER=appuser \
  -e DB_PASS='AppUser@2024' \
  -e DB_NAME='library-data' \
  my-app:latest
```

### 3. docker-compose 写法（推荐生产用）

```yaml
version: '3.8'
services:
  my-app:
    image: my-app:latest
    environment:
      DB_HOST: luozhe-mysql        # 同一自定义网络下可用容器名
      DB_PORT: 3306
      DB_USER: appuser
      DB_PASS: 'AppUser@2024'
      DB_NAME: 'library-data'
    networks:
      - app-net

networks:
  app-net:
    driver: bridge
```

> ⚠️ 用容器名当 host 要求在同一**用户自定义网络**；默认 `bridge` 网络必须用 IP。

## 🧪 连通性排错（按顺序）

```bash
# ① 容器在跑吗
docker ps | grep luozhe-mysql

# ② 它在哪个网络、IP 是多少
docker inspect luozhe-mysql --format '{{json .NetworkSettings.Networks}}'

# ③ 从目标网络能否 ping 通
docker run -it --rm --network bridge alpine ping -c 3 172.17.0.2

# ④ 端口通吗
docker run -it --rm --network bridge alpine nc -zv 172.17.0.2 3306

# ⑤ MySQL 是否监听 0.0.0.0（不是只听 127.0.0.1）
docker exec luozhe-mysql ss -lntp | grep 3306
```

如果 ⑤ 显示 `127.0.0.1:3306`，MySQL 没对外监听：

```bash
docker exec luozhe-mysql sed -i 's/^bind-address.*/bind-address = 0.0.0.0/' /etc/mysql/mysql.conf.d/mysqld.cnf
docker exec luozhe-mysql mysqladmin -uroot -p'MyRoot@2024' shutdown
docker start luozhe-mysql
```

## 🛠️ 运维常用命令

```bash
# 进入 MySQL 交互式命令行
docker exec -it luozhe-mysql mysql -uroot -p'MyRoot@2024'

# 查看所有数据库
docker exec luozhe-mysql mysql -uroot -p'MyRoot@2024' -e "SHOW DATABASES;"

# 查看所有用户
docker exec luozhe-mysql mysql -uroot -p'MyRoot@2024' -e "SELECT User, Host FROM mysql.user;"

# 备份整个 library-data 库
docker exec luozhe-mysql mysqldump -uroot -p'MyRoot@2024' `library-data` > library-data_$(date +%F).sql

# 恢复
cat library-data_2026-07-28.sql | docker exec -i luozhe-mysql mysql -uroot -p'MyRoot@2024' shop

# 查看错误日志（排错最先看）
docker exec luozhe-mysql tail -50 /var/log/mysql/error.log

# 查看实时日志
docker exec luozhe-mysql tail -f /var/log/mysql/error.log
```

## 👥 用户与权限管理

```bash
# 创建新用户（任意 IP 可连）
docker exec luozhe-mysql mysql -uroot -p'MyRoot@2024' -e "
CREATE USER 'appuser2'@'%' IDENTIFIED BY 'NewPass@2024';
GRANT ALL PRIVILEGES ON `library-data`.* TO 'appuser2'@'%';
FLUSH PRIVILEGES;"

# 修改密码
docker exec luozhe-mysql mysql -uroot -p'MyRoot@2024' -e "
ALTER USER 'appuser'@'localhost' IDENTIFIED BY 'NewPass@2024';"

# 限网段访问（生产推荐）
docker exec luozhe-mysql mysql -uroot -p'MyRoot@2024' -e "
CREATE USER 'appuser'@'10.0.%' IDENTIFIED BY 'AppUser@2024';
GRANT ALL ON `library-data`.* TO 'appuser'@'10.0.%';
FLUSH PRIVILEGES;"

# 删除用户
docker exec luozhe-mysql mysql -uroot -p'MyRoot@2024' -e "DROP USER 'appuser'@'localhost';"
```

## 🐛 故障排查

| 问题 | 排查 / 解决 |
| --- | --- |
| 容器连不上 | `docker ps \| grep luozhe-mysql` 看是否在跑 |
| MySQL 监听 127.0.0.1 | 改 `bind-address = 0.0.0.0` 重启 |
| 应用报 Access denied | 检查用户名/密码，host 是否匹配（如 `@'%'` vs `@'localhost'`） |
| 磁盘满 | `docker exec luozhe-mysql df -h`，清理 `/var/log/mysql/` |
| 忘记 root 密码 | 重启容器加 `--skip-grant-tables` 重置 |
| 容器重启后数据丢 | 检查数据是否落卷，没用 `-v` 就会丢 |

## 📐 与本项目的集成

本项目默认使用 SQLite（见 `DOCKER.md`）。如需切换到 MySQL：

```yaml
# docker-compose.yml 里加一个 mysql 服务
services:
  library-mysql:
    image: mysql:8.0
    container_name: luozhe-mysql
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: 'MyRoot@2024'
      MYSQL_DATABASE: library-data
      MYSQL_USER: appuser
      MYSQL_PASSWORD: 'AppUser@2024'
    volumes:
      - mysql-data:/var/lib/mysql
    networks:
      - app-net
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1", "-u", "root", "-pMyRoot@2024"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  mysql-data:
```

然后把应用的环境变量从 SQLite 切到 MySQL：

```env
DATABASE_URL="mysql://appuser:AppUser@2024@library-mysql:3306/library-data"
```
