# GitHub 发布检查表

## 源码范围

提交：

- `apps/mobile` Android 客户端源码。
- `apps/relay` Relay、Broker 和隧道源码。
- `scripts` 构建、Helper 和通用发布脚本。
- `generated-protocol` 项目运行需要的协议类型。
- `docs`、`README.md`、`SECURITY.md`、`LICENSE`。
- `pnpm-lock.yaml` 和 workspace 配置。

不提交：

- `.env.local`、`config.json` 和真实凭证。
- APK、EXE、`.app`、压缩包和签名文件。
- `node_modules`、`dist`、Android build 目录。
- 上传文件、日志、Playwright 临时文件和本地会话数据。
- 服务器 IP、个人域名、SSH 用户名、SSH 私钥路径。

## 发布前检查

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm build
corepack pnpm smoke
```

敏感信息复查：

```bash
rg -n --hidden \
  -g '!node_modules/**' \
  -g '!dist/**' \
  -g '!*.apk' \
  'BEGIN .*PRIVATE KEY|password|relaySecret|/Users/|root@' .
```

命中模板字段时逐条确认，不能只按关键词批量忽略。

## APK 发布

GitHub 源码仓库不直接跟踪 APK。需要分发 APK 时：

1. 从已审计的 commit 构建。
2. 使用独立签名和发布环境。
3. 将 APK 上传到 GitHub Release 或自托管下载目录。
4. 发布 `latest.json`。
5. 验证 APK 哈希、版本号和下载 URL。

## 回滚

- 保留上一版 APK 和 manifest。
- 更新失败时恢复上一版 `latest.json`。
- Broker 更新前保留服务配置和进程管理文件。
- 不把生产配置复制回源码仓库。
