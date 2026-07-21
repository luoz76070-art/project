# 测试与验收计划

更新时间：2026-05-12

## 基本原则

- 每一阶段都要有烟测。
- 任何“已完成”必须能被命令或真机操作复现。
- 本地可测先本地测，手机能测必须真机测。
- 测试结果追加到 `docs/smoke-tests.md`。
- 不以“看起来应该可以”作为完成标准。

## Relay 基础烟测

命令：

```powershell
pnpm --filter @mobile-codex/relay typecheck
pnpm --filter @mobile-codex/relay build
```

运行 Relay 后测试：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
Invoke-RestMethod -Headers @{ Authorization = "Bearer <token>" } http://127.0.0.1:8787/api/threads?limit=1
Invoke-RestMethod -Headers @{ Authorization = "Bearer <token>" } http://127.0.0.1:8787/api/live/health
```

通过标准：

- `/health` 返回 `ok=true`。
- `/api/threads` 返回线程数组。
- `/api/live/health` 返回 `ok=true` 和 `mode=app-server-ws`。
- Relay 不崩溃。

## App Server 协议烟测

命令：

```powershell
pnpm --filter @mobile-codex/relay appserver:smoke
pnpm --filter @mobile-codex/relay appserver:read-smoke
pnpm --filter @mobile-codex/relay appserver:turn-smoke
```

通过标准：

- 能列出线程。
- 能读取指定线程。
- 能启动一个测试 turn 并收到预期回复。

注意：

- `turn-smoke` 会创建测试线程，不能高频乱跑。

## Mobile 前端烟测

命令：

```powershell
pnpm --filter @mobile-codex/mobile typecheck
pnpm --filter @mobile-codex/mobile build
```

通过标准：

- TypeScript 无错误。
- Vite build 成功。
- 资源输出到 `apps/mobile/dist`。

## APK 构建验收

命令：

```powershell
.\scripts\build-debug-apk.ps1
.\.tools\android-sdk\build-tools\34.0.0\apksigner.bat verify --verbose .\dist-apk\mobile-codex-debug.apk
```

通过标准：

- APK 输出到 `dist-apk/mobile-codex-debug.apk`。
- v1/v2 签名验证为 true。
- APK 内置最新 JS/CSS 资源。
- Capacitor 配置符合当前网络方案。

## UI 验收

每次大改 UI 后必须检查：

- 竖屏 360px 宽度可用。
- 竖屏 430px 宽度可用。
- 横屏或平板宽度出现左右分屏。
- 文本不溢出按钮。
- 长路径不撑爆布局。
- 长工具输出可滚动或折叠。
- 打开线程自动滚到底部。
- 上拉历史不会被自动拉回底部。
- 白天主题可读。
- 黑夜主题可读。
- 设置面板能打开和关闭。

## 手机真机验收

操作流程：

1. 电脑启动 Relay。
2. 手机安装最新 APK。
3. 手机和电脑在同一网络或 Tailscale 网络。
4. 在设置中填 Endpoint 和 Token。
5. 执行连接测试。
6. 返回工作台。
7. 打开最近线程。
8. 确认自动定位最新消息。
9. 上拉查看历史。
10. 发送一条测试消息。
11. 确认收到 Codex 回复。
12. 刷新线程，确认消息仍在。

通过标准：

- 每一步都能完成。
- 失败时有明确错误。
- App 不白屏、不闪退。
- Relay 日志能对应看到请求。

## 回归测试记录格式

追加到 `docs/smoke-tests.md`：

```text
## YYYY-MM-DD 测试名称

命令/操作：
- ...

结果：
- ...

结论：
- 通过 / 未通过

遗留问题：
- ...
```

## 不通过定义

以下情况不能算完成：

- 只能浏览器访问，APK 不可用。
- 只能新建独立 CLI 会话，不能读取 Codex Desktop 历史线程。
- 只能看历史，不能继续发送。
- UI 首页仍以诊断为主。
- 手机端无法解释失败原因。
- 没有测试记录。
