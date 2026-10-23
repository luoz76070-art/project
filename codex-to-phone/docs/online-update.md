# Android 双通道更新

项目从 `1.1.14-update-channels` 开始支持两种自托管更新方式。当前已发布的 `1.2.2-update-restore` / versionCode18恢复了APK16/17构建遗漏的更新源，详见[恢复记录](audits/2026-10-20/update-restore.md)。手机入口为“设置 → 版本与更新”；原APK16/17需用手机浏览器覆盖安装一次修复包，保留原连接与会话，不要先卸载。

源码当前为 `1.3.9-process-collapse-preview` / versionCode30，同签名独立preview已发布并完成公开下载核验，配套固定网关及DeepSeek插件0.2.1已更新，详见[过程折叠完整交付及备用安装链接](audits/2026-10-23/process-collapse.md)。APK24起原生支持App内下载、进度、大小/SHA/应用身份/版本/签名校验、首次安装来源授权返回接续及系统覆盖安装确认；取消安装后可继续，失败可手动重试。**23及更早需要先浏览器覆盖安装带插件的新包一次，不要卸载**，原生插件和权限不能由HTML热更新添加。用户已确认24→25 App内升级成功且原连接保留；APK30安装、拒绝授权、取消后继续等真机分支尚待单独验收。

APK24起的现有预览包实际检查preview清单，当前preview latest30、previous29；正式Android latest仍18、hot仍1.2.2-web.1且hash保持。预览源已写入被忽略的mobile生产配置，后续具名构建会继续使用它；正式发版前须显式切回正式源并核对成品，不能根据版本名推断通道。现有24至29可在App内更新到30，装完30显示“已是最新”正常。26增加原生麦克风权限/录音插件，不能仅用HTML热更新启用；安装后在设置填写百炼和DeepSeek Key。APK30完整Android lint为0错误/5警告，保持minSdk23。本轮不单独推送HTML热更新。

上一项交付为 `1.3.2-project-groups-preview` / versionCode23，与22/21同签名，已发布独立预览并完整下载核对字节/SHA/大小/CORS。新版把近期范围扩展到Codex，并支持Codex/DeepSeek按项目分组、展开/折叠及偏好恢复，保留DeepSeek历史窗口；需通过[本轮交付中的APK23链接](audits/2026-10-22/project-groups.md#apk23独立预览)覆盖安装，保留数据。手机安装23仍待确认。用户前轮确认已安装21及能看到DeepSeek正文/完整权限卡。正式更新仍18，hot清单未改，普通正式检查更新不会提供23；预览previous保留22，23未单独发布HTML热更新。下方示例仍对应19的历史三类候选；**19的HTML仅兼容19，21的HTML仅兼容21，不能用于22/23/24或推送给18/20。** 预览20/21/22的历史说明分别见[409排查](audits/2026-10-21/phone-send-409.md)、[重复修复](audits/2026-10-21/deepseek-dedup.md)及[DeepSeek历史](audits/2026-10-22/deepseek-history.md)。

| 通道 | 适用改动 | 用户动作 | 回滚 |
| --- | --- | --- | --- |
| 热更新 | React UI、样式、文案、前端状态逻辑 | App 内点击“应用热更新” | App 内回退；启动失败时下次启动自动回滚 |
| APK 更新 | Android 原生代码、Capacitor 插件、权限、协议或不兼容数据结构 | App 内点击“下载并安装”，校验后由系统确认 | 以更高 versionCode 重新发布旧版功能；系统通常拒绝低版本覆盖安装 |

热更新不能绕过原生版本边界。Manifest 必须声明可兼容的 `minNativeVersionCode` 和 `maxNativeVersionCode`，App 会拒绝加载不兼容 bundle。
生产热更新地址必须使用 HTTPS；仅本机开发地址允许使用 `http://localhost`、`http://127.0.0.1` 或 `http://[::1]`。热更新下载不跟随重定向，发布服务器应直接返回最终文件。

## 构建时配置

将两个地址写入 `apps/mobile/.env.production.local`（被 Git 忽略），也支持同名环境变量覆盖。请替换示例域名；不要只复制根目录 `.env.example`，Vite 从 `apps/mobile` 加载生产配置。

```bash
cat > apps/mobile/.env.production.local <<'EOF'
VITE_MOBILE_CODEX_UPDATE_MANIFEST_URL=https://downloads.example.com/mobile-codex/android/preview/latest.json
VITE_MOBILE_CODEX_HOT_MANIFEST_URL=https://downloads.example.com/mobile-codex/hot/latest.json
EOF
corepack pnpm android:apk:mac -- 1.3.9-process-collapse-preview
```

具名 APK 构建前会检查双通道地址是否齐全、URL 是否有效以及是否使用 HTTPS；缺少任一地址即失败。仅 `corepack pnpm android:apk:mac -- mac-local` 允许两个地址都空，供离线开发使用。配置在构建时写入包内，不能通过服务器补回已安装旧包中缺失的地址。

交付候选前，在打包脚本所用JDK下进入`apps/mobile/android`执行`gradle :app:clean --no-daemon`，再运行上述具名构建。2026-10-21实测增量APK保留112900字节额外归档空间，清理app构建目录后恢复约4.04MB；此操作只清理生成文件，不更改应用数据、签名或生产安装。

## 小改动：发布热更新

热更新是包含全部JS/CSS的单文件HTML。构建单独使用Vite内联动态import和CSS，保留所有Agent页面与导入资源；不能仅内联普通dist主入口，否则懒加载页面会缺失。临时构建结束清理，普通APK/Web保留按需加载。热更新构建也要求两个更新源齐全。Android会先下载到应用私有目录，校验SHA-256后再原子切换；关键界面挂载后稳定5秒且未捕获error/unhandledrejection才调用markReady，无需等待外网在线；它不能证明所有交互可用。如果切换后崩溃且未确认成功，下次启动自动回退。

```bash
corepack pnpm android:hot-bundle -- 1.3.0-agent-gateway-preview-web.1
```

输出：

```text
dist-hot/mobile-codex-1.3.0-agent-gateway-preview-web.1.html
```

发布：

```bash
export MOBILE_CODEX_HOT_RELEASE_HOST=deploy@example.com
export MOBILE_CODEX_HOT_RELEASE_SSH_KEY=$HOME/.ssh/id_ed25519
export MOBILE_CODEX_HOT_RELEASE_DIR=/var/www/mobile-codex/releases/hot
export MOBILE_CODEX_HOT_RELEASE_BASE_URL=https://downloads.example.com/mobile-codex/hot

scripts/publish-hot-update.sh \
  dist-hot/mobile-codex-1.3.0-agent-gateway-preview-web.1.html \
  1.3.0-agent-gateway-preview-web.1 \
  19 \
  "UI and frontend behavior update"
```

默认只允许`versionCode=19`使用该候选热更新。当前前端还要求bundle的appVersionCode与原生版本相等，因此不要扩大范围或向16/17/18推送此HTML。未来扩大原生版本范围前，需要同时核验前端版本保护与原生能力，不能只改manifest。

## 大改动：发布 APK

1. 同步修改：

   - `apps/mobile/android/app/build.gradle`
   - `apps/mobile/src/app/config.ts`

2. 构建和发布：

   ```bash
   corepack pnpm android:apk:mac -- 1.3.0-agent-gateway-preview

   export MOBILE_CODEX_RELEASE_HOST=deploy@example.com
   export MOBILE_CODEX_RELEASE_SSH_KEY=$HOME/.ssh/id_ed25519
   export MOBILE_CODEX_RELEASE_DIR=/var/www/mobile-codex/releases/android
   export MOBILE_CODEX_RELEASE_BASE_URL=https://downloads.example.com/mobile-codex/android

   scripts/publish-android-update.sh \
     dist-apk/mobile-codex-1.3.0-agent-gateway-preview-debug.apk \
     1.3.0-agent-gateway-preview \
     19 \
     "Native update channels and Codex executable resolution"
   ```

APK 更新仍需要用户确认安装；侧载来源第一次更新时还需要允许“安装未知应用”。APK24起下载保存在应用私有cache/apk-updates中，不需要外部存储权限；进度通过原生事件显示，完成后通过FileProvider的content URI打开系统安装器。授权拒绝不循环弹窗，安装取消返回可继续；缓存每次重新校验。页面刷新、切连接和进程重启可恢复已下载包，但进程被杀时未完成的下载需重试，不提供后台常驻服务或断点续传。

清单size和sha256从24起为必填，APK上限128MiB，正式URL只允许HTTPS，loopback开发HTTP例外，不跟随重定向。拒绝其他applicationId、不同当前签名集合、非目标versionCode或降级包；不支持签名轮换。完整原生测试入口`corepack pnpm test:apk-update`只使用假数据。调用安装器不代表安装成功，实际升级由后续原生版本核对。

## 热更新 Manifest

```json
{
  "platform": "android",
  "channel": "hot",
  "version": "1.3.0-agent-gateway-preview-web.1",
  "htmlUrl": "https://downloads.example.com/mobile-codex/hot/mobile-codex-1.3.0-agent-gateway-preview-web.1.html",
  "sha256": "generated-sha256",
  "size": 1000000,
  "minNativeVersionCode": 19,
  "maxNativeVersionCode": 19,
  "notes": "UI update",
  "publishedAt": "2026-10-21T00:00:00Z"
}
```

`sha256` 必须是下载文件的 64 位十六进制 SHA-256（示例中的占位文字须替换为实际值）。热更新会在切换前完成完整下载、大小限制、HTML 标记和 SHA-256 校验；APK同样要求实际SHA和字节size。

## APK Manifest

```json
{
  "platform": "android",
  "versionName": "1.3.0-agent-gateway-preview",
  "versionCode": 19,
  "apkUrl": "https://downloads.example.com/mobile-codex/android/mobile-codex-1.3.0-agent-gateway-preview.apk",
  "size": 4000000,
  "sha256": "generated-sha256",
  "mandatory": false,
  "notes": "Native update",
  "publishedAt": "2026-10-21T00:00:00Z"
}
```

## 发布原子性与回退

两个发布入口共用 `scripts/upload-release-atomically.sh`，先上传临时文件，远端校验 SHA-256/大小、取得发布锁后再原子切换 `latest.json`，保留 `previous.json`。产物名带 hash，已存在的同名产物必须匹配 hash。发布端指针回退和已安装版本回滚是两种操作，步骤与限制见 [优化交付](audits/2026-10-20/delivery.md#发布与回滚)。2026-10-20 更新恢复已通过原通道发布 APK 18 与仅兼容原生 18 的 HTML；下载 SHA、大小和 CORS 验证见 [恢复记录](audits/2026-10-20/update-restore.md)。生产回滚演练与真机安装仍待验收。

## 2026-10-23 APK27预览

历史APK27为 `1.3.6-voice-url-preview`，该轮previous26，正式18/hot保持；支持第三方DeepSeek语音整理地址/模型与原始助手身份合并。完整发布、同签名核验和待验项见[专项记录](audits/2026-10-23/voice-url-dedup.md)。当前preview以文首APK30为准。
