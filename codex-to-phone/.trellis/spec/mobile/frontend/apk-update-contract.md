# App 内 APK 更新契约

## Scope / Trigger

原生 APK24 起支持设置页“检查更新 → 下载并安装”。React 负责清单和展示，ApkUpdatePlugin 负责下载、包验证、授权与系统安装器；不绕过系统确认。原生能力不能用 HTML 热更新补到旧 APK。

## Signatures

- `ApkUpdate.getStatus(): Promise<ApkUpdateStatus>`
- `ApkUpdate.downloadAndInstall({url, sha256, size, versionCode}): Promise<ApkUpdateStatus>`：立即返回启动状态，后续通过事件通知；重复调用不并发启动。
- `ApkUpdate.install(): Promise<ApkUpdateStatus>`：复用已下载包，重新核验后继续。
- `ApkUpdate.addListener("progress", receive)`：先订阅再 getStatus；卸载清 listener，按 revision 丢弃迟到快照。
- 隔离验证：`corepack pnpm test:apk-update`；只使用合成 loopback HTTP/临时目录，不安装设备软件或读取会话。

## Contracts

清单的 `platform="android"`、versionName、正整数 versionCode、apkUrl、正整数 size 和 64 位十六进制 sha256 必须有效。APK上限128 MiB；HTTPS，开发只允许localhost/127.0.0.1/[::1] HTTP，拒绝userinfo、fragment和重定向。`versionCode`须高于已安装版本，包内版本须等于清单，应用ID和当前签名集合须一致；本实现不接受签名轮换。

状态：supported/revision/phase/receivedBytes/totalBytes/versionCode/versionName/nativeVersionCode/canInstall/error；phase 为 idle/downloading/verifying/ready/permission_required/awaiting_install/error。只有下载/校验/安装器待确认时阻止热更新；授权拒绝或安装取消返回后保留手动继续与检查更新。

仅写cache/apk-updates/download.part、update.apk及专用apk-update偏好。完整验证后保存描述；进程重启恢复ready但不自动弹安装器。继续安装每次重新校验SHA、大小及包身份。后台完成先保留ready，回前台接续用户已发起的更新；进程被杀后不承诺断点续传。安装或过期后的包清理只限本插件缓存。

API26+ 通过canRequestPackageInstalls检查，并打开ACTION_MANAGE_UNKNOWN_APP_SOURCES的本应用页面；返回允许则继续核验/安装，拒绝不循环弹窗。现有FileProvider的content URI和临时读授权交给ACTION_VIEW安装器；返回而原生版本未升级只能显示“尚未完成，可重试”。

`VITE_MOBILE_CODEX_UPDATE_MANIFEST_URL`决定APK通道，`VITE_MOBILE_CODEX_HOT_MANIFEST_URL`独立决定热更新；预览包应绑定preview清单，不能把版本名中的preview当作自动切源。地址持久放在被忽略的apps/mobile/.env.production.local；正式晋升另行授权和核验。

## Validation & Error Matrix

| 情况 | 结果 |
| --- | --- |
| 缺SHA/大小/版本、非HTTPS、公网HTTP | 清单或原生入口拒绝，不开始下载 |
| 302、非200、Content-Length不符、断流/超额 | 失败、移除半包、允许手动重试 |
| SHA、应用ID、版本、签名不一致 | 拒绝安装并移除本插件坏包 |
| 未授权 | 仅打开本应用的系统授权页，返回拒绝保留按钮 |
| 已授权/取消安装 | 重新验证后调系统安装器；取消后复用已下载包 |
| 页面刷新/连接切换 | 从原生状态恢复，不自动重下 |
| 进程退出时只有半包 | 下次启动移除半包并提示重试 |

## Good / Base / Bad Cases

- Good：24检查到同签名25，下载校验完成，已有安装权限则直接调系统安装确认。
- Base：首次授权返回继续；取消安装后点击继续不重下，离线也可重验缓存并安装。
- Bad：清单25但包内24、其他applicationId、不同签名、相同大小篡改缓存，均拒绝。

## Tests Required

原生minSdk23保持；热更新路径包含关系使用canonical File父链，不直接使用API26的File.toPath/Path。先确认目标严格位于根内，再按现有规则处理符号链接；根/父/外部及同名前缀兄弟目录拒绝，内部符号链接只删链接、不遍历目标。Java路径回归包含上述边界与嵌套删除，macOS临时根先canonicalize，不能用/var别名夹具误报生产路径逻辑。

APK和旧热更新下载均不能在API23直接调用getContentLengthLong；读取Content-Length字符串解析long，缺省允许未知长度，非法/负值拒绝，实际字节计数仍受各自上限约束。带方向限定的资源必须有默认版本，不能通过抑制lint或提高minSdk解决。

清单坏字段/URL与上限、流式完整与chunked、进度、重定向未访问目标、坏hash/超额/断流/HTTP错误/中断清理、缓存重验和包身份/版本/签名集合必须覆盖。浏览器合成bridge检查状态订阅顺序、迟到snapshot、按钮互斥/失败重试/刷新与连接切换，360/390/430px及150%字号；不得计作Android授权或系统覆盖安装验收。

fixture原生版本从src/app/config.ts读取，目标=当前+1，不固定写某个已发布versionCode；模拟目标不代表真实发布。页面刷新后先展开设置/版本面板再检查按钮可见与可用；隐藏面板中的isEnabled结果不能直接判产品失败。通过fixture计数确认继续安装不重复下载。

交付核对版本递增、旧签名一致、APK实际Web资源逐字节等于最终dist、安装权限/插件类存在、包内实际更新源与发布通道一致。公网发布核对完整下载/SHA/大小/CORS与previous；正式及hot未授权时保持。

## Wrong vs Correct

- 错：`PluginCall.getLong("size")`读取JSON普通整数；Capacitor7.6.9只接受Long，Integer返回默认值。对128MiB和int范围版本使用getInt，持久偏好仍使用putLong/getLong。
- 错：minSdk23直接调用URLConnection.getContentLengthLong（API24起）；改读Content-Length字符串并解析long，最终以实际流计数为准。
- 错：调起安装器就显示“更新成功”；正确：awaiting_install，只有后续实际原生版本才能确认升级。
- 错：预览发布后仍编译正式latest源；正确：构建前持久选择对应源，并从成品APK核对。
