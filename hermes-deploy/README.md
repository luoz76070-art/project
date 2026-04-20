# 博客搭建说明

这个项目是一套 `Hugo + PaperMod` 的个人博客，现在采用的推荐部署方式是：

- 本地或 CI 构建静态文件到 `public/`
- 用 `rsync` 把构建结果上传到服务器的 `releases/<release_id>/`
- 由服务器上的 `current` 符号链接切换线上版本
- `Nginx` 只负责服务 `current/` 下的静态文件

这样保留了 Hugo 静态站的简单和稳定，同时把部署从“手工上传目录”升级成了更稳的“原子发布 + 可回滚”。

## 目录说明

- `hugo.yaml`: Hugo 主配置
- `content/posts/`: 博客文章
- `themes/PaperMod/`: PaperMod 主题
- `bin/hugo`: 本地开发可选的 Hugo 二进制，占位保留但默认不提交到 git
- `assets/css/extended/custom.css`: 自定义样式
- `scripts/build.sh`: 生产构建脚本
- `scripts/preview.sh`: 本地预览脚本
- `scripts/deploy_to_aliyun.sh`: 原子发布脚本
- `scripts/rollback_release.sh`: 回滚脚本
- `deploy/nginx/blog.conf.example`: Nginx 配置示例
- `deploy/github-actions/deploy.yml.example`: GitHub Actions 自动发布工作流模板

## 先改这几个地方

在 `hugo.yaml` 里把下面内容改成你自己的：

- `baseURL`
- `title`
- `author`
- `socialIcons`

Nginx 示例文件里也要把域名和证书路径改成你自己的：

- `server_name`
- `ssl_certificate`
- `ssl_certificate_key`

当前项目里已经按你的线上信息预填好了：

- 域名：`zyzlz.xin`
- 服务器 IP：`8.153.100.129`

## 本地预览

```bash
./scripts/preview.sh
```

打开 <http://localhost:1313> 即可预览。

## 生产构建

```bash
./scripts/build.sh
```

这个脚本默认会带上：

- `--environment production`
- `--cacheDir ./.tmp/hugo_cache`
- `--gc`
- `--minify`
- `--cleanDestinationDir`

构建结果会出现在 `public/`。

## 服务器目录结构

推荐把服务器目录整理成下面这样：

```text
/var/www/blog/
├── current -> /var/www/blog/releases/20260417093015
└── releases/
    ├── 20260417090001/
    ├── 20260417093015/
    └── ...
```

Nginx 的 `root` 应指向 `/var/www/blog/current`。

## Alibaba Cloud Linux 3 服务器落地记录

下面这部分是已经在你的线上机器上实际完成过的一套服务器侧配置，可直接作为操作指南和运维文档复用。

### 服务器环境

- 系统：`Alibaba Cloud Linux 3.2104 LTS 64-bit`
- 域名：`zyzlz.xin`
- 站点根目录：`/var/www/blog/current`
- 发布目录：`/var/www/blog/releases/<release_id>/`
- 当前软链接：`/var/www/blog/current -> /var/www/blog/releases/initial-placeholder`
- Web 服务：`nginx`
- 进程管理：`systemd`
- 站点类型：纯静态 Hugo，不在服务器上运行 Hugo

### 本次实际完成的服务器操作

1. 检查服务器基线状态：
   - 确认系统版本、`dnf` 可用性
   - 检查 `nginx`、`git`、`rsync` 是否安装
   - 检查 `80/443` 监听状态
   - 检查 `firewalld` 和 SELinux 状态
   - 检查现有 `nginx` 站点配置是否冲突
2. 补齐缺失软件：
   - 安装了 `rsync`
3. 创建发布目录结构：
   - `/var/www/blog/releases`
   - `/var/www/blog/releases/initial-placeholder`
   - `/etc/nginx/ssl/zyzlz.xin`
4. 创建占位首页并初始化当前版本：
   - 把占位 `index.html` 放到 `initial-placeholder`
   - 让 `/var/www/blog/current` 指向该占位版本
5. 部署已有证书到 Nginx 使用路径：
   - 源文件：
     - `/root/boke-certs/24495418_zyzlz.xin_nginx/zyzlz.xin.pem`
     - `/root/boke-certs/24495418_zyzlz.xin_nginx/zyzlz.xin.key`
   - 目标文件：
     - `/etc/nginx/ssl/zyzlz.xin/fullchain.pem`
     - `/etc/nginx/ssl/zyzlz.xin/privkey.pem`
6. 切换站点配置：
   - 使用 `/etc/nginx/conf.d/zyzlz.xin.conf`
   - `80` 自动跳转到 `https`
   - `root` 指向 `/var/www/blog/current`
   - 路由规则使用：
     - `try_files $uri $uri/ $uri/index.html =404;`
   - 为 `css/js/svg/woff` 等静态资源设置长缓存
   - 为图片设置较短缓存
7. 防火墙处理：
   - `firewalld` 中已放行 `http` 和 `https`
   - 阿里云安全组仍需同步放行 `80/443`
8. 切回 systemd 管理的 Nginx：
   - 发现旧站点是“手工启动的 Nginx 进程”
   - 处理后改为 `systemctl` 管理，便于后续维护

### 当前线上 Nginx 站点行为

- `http://zyzlz.xin` 会 `301` 跳转到 `https://zyzlz.xin`
- `https://zyzlz.xin` 直接服务 `/var/www/blog/current` 下的静态文件
- 证书覆盖域名：
  - `zyzlz.xin`
  - `www.zyzlz.xin`

### 建议保留的验证命令

```bash
nginx -t
systemctl enable --now nginx
systemctl reload nginx
readlink -f /var/www/blog/current
curl -I --resolve zyzlz.xin:80:127.0.0.1 http://zyzlz.xin
curl -I --resolve zyzlz.xin:443:127.0.0.1 https://zyzlz.xin
firewall-cmd --list-all
```

### 切换时遇到的技术问题

#### 1. `nginx -t` 成功，但 `systemctl reload nginx` 失败

如果你看到类似错误：

```text
bind() to 0.0.0.0:80 failed (98: Address already in use)
bind() to 0.0.0.0:443 failed (98: Address already in use)
```

这通常不是新配置有语法问题，而是服务器里已经有一套“手工启动的旧 Nginx”在占用 `80/443`。

处理思路：

```bash
ps -ef | grep nginx
kill -QUIT <old_nginx_master_pid>
systemctl start nginx
systemctl status nginx --no-pager
```

`QUIT` 是优雅退出，适合把旧实例平滑切换给 systemd 管理的实例。

#### 2. 服务器上直接 `curl zyzlz.xin` 结果不可靠

如果机器上跑了代理或 fake-IP DNS（例如 `mihomo`），域名在本机可能会被解析到 `198.18.0.x` 之类的虚拟地址，这时候：

- `curl -I http://zyzlz.xin`
- `curl -I https://zyzlz.xin`

不能可靠代表公网访问结果。

这种情况下，更稳妥的本机验证方式是：

```bash
curl -I --resolve zyzlz.xin:80:127.0.0.1 http://zyzlz.xin
curl -I --resolve zyzlz.xin:443:127.0.0.1 https://zyzlz.xin
```

它会跳过本机 DNS，直接验证当前 Nginx 是否正确服务了新站点。

### 服务器侧当前目标状态

完成初始化后，服务器应该满足下面这些条件：

- `/var/www/blog/current` 永远指向当前线上版本
- 每次发布都只新增一个 `releases/<release_id>/`
- `nginx` 只负责静态文件和 HTTPS
- 博客构建发生在本地或 CI，不发生在服务器
- 回滚时只需要切回 `current` 软链接

### 本地下一步发布命令

完成服务器初始化后，本地直接执行：

```bash
cd /Users/rorance/workspace/boke && ./scripts/deploy_to_aliyun.sh 8.153.100.129 /var/www/blog root
```

## 首次部署前准备

1. 确保服务器已安装 `nginx`
2. 确保本机已安装 `ssh` 和 `rsync`
3. 把 [deploy/nginx/blog.conf.example](deploy/nginx/blog.conf.example) 改成你的域名后放到服务器上
4. 让站点目录对部署用户可写，例如 `/var/www/blog`
5. 执行 `nginx -t && systemctl reload nginx`

## 手动发布

```bash
./scripts/deploy_to_aliyun.sh 8.153.100.129 /var/www/blog root
```

这个脚本会自动：

- 先执行本地构建
- 在服务器创建新的 `releases/<release_id>/`
- 用 `rsync` 上传 `public/`
- 把 `current` 原子切换到新版本
- 自动清理旧版本，默认保留最近 `5` 个

常用参数：

```bash
./scripts/deploy_to_aliyun.sh 8.153.100.129 /var/www/blog root --keep 7 --port 22
./scripts/deploy_to_aliyun.sh 8.153.100.129 /var/www/blog root --skip-build
```

## 回滚

回滚到上一个版本：

```bash
./scripts/rollback_release.sh 8.153.100.129 /var/www/blog root
```

回滚到指定版本：

```bash
./scripts/rollback_release.sh 8.153.100.129 /var/www/blog root --release 20260417093015
```

## 自动发布

仓库里已经放了一份 GitHub Actions 工作流模板：

- [deploy/github-actions/deploy.yml.example](deploy/github-actions/deploy.yml.example)

它会在 `main` 分支有新提交时自动：

- 安装 Hugo extended
- 构建站点
- 用仓库里的部署脚本发布到服务器

你需要在 GitHub 仓库里配置：

- `Secret`: `BLOG_DEPLOY_SSH_KEY`
- `Variable`: `BLOG_DEPLOY_HOST`
- `Variable`: `BLOG_DEPLOY_PATH`
- `Variable`: `BLOG_DEPLOY_USER`
- `Variable`: `BLOG_DEPLOY_PORT`
- `Variable`: `BLOG_RELEASES_TO_KEEP`

启用时，把它复制到仓库根目录的 `.github/workflows/deploy.yml` 即可生效。

如果你用的是 HTTPS 凭据推送 GitHub，而当前凭据没有 `workflow` scope，保留成模板形式会更省心；等你后面换成有对应权限的 token 或 SSH 推送，再启用它就行。

如果你已经把 `boke/` 初始化成独立仓库，推荐仓库根目录就直接放在当前目录：

```bash
cd /Users/rorance/workspace/boke
git init -b main
```

## 补充说明

- `public/` 仍然应该继续忽略，不建议提交生成产物
- 仓库里的 `bin/hugo` 是本地开发用的，但它超过 GitHub 单文件限制，默认不会提交；CI 会在 Linux runner 上单独安装 Hugo
- 相比原来的 `scp -r public/* ...`，现在这套流程不会残留旧文件，也更适合回滚
