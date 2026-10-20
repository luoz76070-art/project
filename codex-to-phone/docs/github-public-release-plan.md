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
node --test apps/relay/tests/correctness.test.mjs apps/relay/tests/performance.test.mjs apps/relay/tests/transport.test.mjs apps/relay/tests/availability.test.mjs
node --test scripts/test-mobile-connection.mjs scripts/test-mobile-profiles.mjs scripts/test-release-publication.mjs
corepack pnpm test:messages
corepack pnpm test:hot-update
```

上述回归使用合成数据、随机端口或临时目录。`smoke`、`appserver:*`、`live-control:*` 和 `desktop-control:*` 等人工集成入口可能读取真实会话或提交任务，不属于默认发布隔离检查；真实控制验收单独记录。

版本的功能说明与检查边界写入 `CHANGELOG.md`。只暂存本项目路径；在包含多个项目的 Git 仓库中，不使用不带路径的 `git add -A`。推送前检查远端变化，不强制覆盖远端其他项目。源码发布后先固定版本提交，再备份源码、当前构建产物和必要的本地配置，最后开始下一阶段开发。真实配置与签名材料只进入权限为 0700/0600 的本地备份，不上传公开仓库。

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
