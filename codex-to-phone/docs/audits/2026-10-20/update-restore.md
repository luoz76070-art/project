# 手机直接更新恢复

> 公开源码说明使用示例域名；实际部署地址及原始操作记录仅保留在本地。

日期：2026-10-20。修复版 **1.2.2-update-restore / versionCode 18** 已通过原服务器更新通道发布，包含前序连接、界面与工作状态优化。手机真机覆盖安装、原生热更新切换和数据保留仍待用户验收。

## 原因

更新功能代码仍在“设置 → 版本与更新”，但构建 APK 16、17 时漏带了 `VITE_MOBILE_CODEX_UPDATE_MANIFEST_URL` 与 `VITE_MOBILE_CODEX_HOT_MANIFEST_URL`。APK 15 带有两个原更新地址；公网 APK 清单一直停在 15，热更新目录不存在、清单为 404。

原先只靠构建会话临时 export，未保存 Vite 本地生产配置，导致具名交付包静默禁用更新。此次将现用双通道地址保存到被 Git 忽略的 `apps/mobile/.env.production.local`，并在 APK 入口增加校验：具名包缺少任一更新源时立即失败，仅 `mac-local` 允许双通道都空。通用源码未加入个人域名默认值。

## 手机安装

- 带更新源的旧版本：设置 → 版本与更新 → 检查更新 → 下载新版，再按 Android 系统提示安装。
- APK 16/17 缺少更新源，服务端无法补回已编译的地址。需先用手机浏览器下载以下修复 APK 并覆盖安装一次，之后即可在 App 内继续检查更新。
- 不要卸载或清除 App 数据。新包与原生产包具有相同 `com.mobilecodex.app` 包名和签名，版本号递增，具备覆盖安装条件；实际设备上的数据保留仍需验收。
- 安装后显示 `v1.2.2-update-restore`，检查更新不应再提示“当前构建未配置在线更新地址”。Android 仍需要用户确认安装；首次侧载可能需要允许该下载来源安装应用。

```text
https://downloads.example.com/mobile-codex/releases/android/mobile-codex-1.2.2-update-restore-ee73b7f6fa70.apk
```

## 发布与检查

复用 `publish-android-update.sh`、`publish-hot-update.sh` 和共用原子上传脚本，只修改 Nginx 既有 `/mobile-codex/releases/` 下的静态资源。实际根目录经 `nginx -T` 核实为 `/var/www`；没有切换或重启 Broker/Relay。

| 产物 | 结果 |
| --- | --- |
| APK 18 | 4,020,908 bytes；SHA-256 `ee73b7f6fa708be339933ad2ebb12c0dce408851009478c1175ed39e54ab2561` |
| HTML `1.2.2-web.1` | 327,073 bytes；SHA-256 `e691793544311196adcce62700c8e59c5d4024845c41743a7940070df37db717`；仅原生 18 兼容 |
| 签名 | APK 15 与 18 均为 SHA-256 `3ffb81f3524a590f469b80476951a22fbc6e441a470b9270079a8c1d452c4a38` |
| 包内资源 | 两个原更新源均存在；Vite dist 文件逐字节匹配 APK 的 web assets |
| 公网 | 两个 latest.json 与对应完整资源均 HTTP 200；HTTPS 校验、SHA、大小、本地字节一致性和 Android Origin 的 CORS 通过 |
| 回退点 | Android `previous.json` 完整保留原 versionCode 15 清单；旧 APK 文件保留。首次发布 hot 清单，没有旧 hot 指针 |
| 隔离验证 | 更新源与原子发布 4/4、客户端 16/16、消息回归、移动端 typecheck、Vite/Android 构建、Shell 语法均通过 |
| 浏览器 | 合成连接、390px 设置页，展开更新入口并点击“检查更新”后读到正式新清单，显示当前已是最新；未读取真实会话或发送输入 |

证据：`output/audit/2026-10-20/update-restore-artifacts.json`、`update-restore-publication.json`、`android-before-update-restore.json`、`update-settings-390.png`。本地 APK 位于 `dist-apk/mobile-codex-1.2.2-update-restore-debug.apk`，热更新位于 `dist-hot/mobile-codex-1.2.2-web.1.html`。

回退只按 [原子发布回退流程](delivery.md#发布与回滚) 切清单，不删除产物或更改生产服务。已安装 APK 无法靠恢复旧清单降级，应以更高 versionCode 发布修复，避免卸载丢失数据。本次未演练生产回滚，未提交、推送、建分支或 PR。

本轮复用现有发布流程，补充本地生产配置、打包校验与前端规范；没有新增技能或自动化。
