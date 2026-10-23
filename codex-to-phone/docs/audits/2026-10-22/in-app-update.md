# App 内 APK 下载与覆盖安装链路

日期：2026-10-22；用户要求“把这个更新链路补齐，执行”。沿用10-20-agent-gateway当前任务和独立preview发布授权，整体任务仍in_progress。

后续结果：APK25已发布，用户确认24→25 App内升级成功且原连接保留；本页记录的11项lint阻断已修复，完整lint为0错误/5警告。最新结果及仍待真机验证的分支见[兼容性与真机验收](android-compat.md)。下文保留APK24交付时的历史证据与previous23状态。

## 用户可见结果

APK24在“设置 → 版本与更新”支持检查更新、点击“下载并安装”、App内进度、下载与包校验、系统授权及安装确认。APK不再依赖浏览器下载；只有浏览器环境/缺少插件的旧原生包保留明确下载引导。

首次安装来源未获允许时，打开本应用的Android“安装未知应用”设置；获准返回后重新核验并继续调系统安装器，拒绝不会循环弹窗。系统安装取消后保留“继续安装”，复用已下载的包；页面重载、连接切换可从原生状态恢复，进程重启恢复ready但不自动弹安装器。不会把打开安装器写成安装成功。

下载/校验中禁用重复下载与热更新，失败可手动重试。App进程仍存活时后台下载可继续，回前台接续；进程被系统清除后半包移除并提示重试，不承诺后台常驻或断点续传。

## APK24独立预览

[手机首次覆盖安装APK24](https://zyzlz.xin/mobile-codex/releases/android/preview/mobile-codex-1.3.3-in-app-update-preview-0b00ec6f230d.apk)

版本`1.3.3-in-app-update-preview`，versionCode24，4,049,967字节，SHA256：`0b00ec6f230d8b2d1dc9d384ccdf33381f42a1d7b3e6df1f368ec4643989fad3`。

与APK23/22/21同签名。旧版21/22/23没有原生安装插件，必须用浏览器覆盖安装本包一次；**不要卸载，不要清除应用数据**。随后发布更高版本时，即可在App内检查、下载并发起系统覆盖安装。当前preview最新已是24，所以装完24后检查显示“已是最新”正常。

本地APK：`dist-apk/mobile-codex-1.3.3-in-app-update-preview-debug.apk`。独立交付目录：`output/delivery/2026-10-22/in-app-update-preview/`，含APK、latest、两份核验报告、lint问题清单、说明和SHA256SUMS。

新包实际APK源为`android/preview/latest.json`，已持久写入被忽略的mobile生产配置；hot地址保持。preview latest24、previous逐字节保留23。正式Android latest仍18，hot仍1.2.2-web.1，清单hash均保持；未发布24热更新。旧包仍指向正式源，无法靠修改preview让旧包自动发现24，首装使用上方链接。

## 实现与边界

新增Android ApkUpdatePlugin、ApkUpdateDownload、ApkUpdateIdentity；注册于MainActivity，声明REQUEST_INSTALL_PACKAGES，复用现有FileProvider。前端features/updates统一清单校验、状态订阅/恢复与进度面板，保留现有热更新入口。

清单及原生分别限制HTTPS/loopback开发HTTP、必填大小和SHA256、128MiB上限、禁止重定向；15秒连接、30秒单次读取超时、10分钟总时限。以实际流计数和SHA校验，不信任单一Content-Length。安装前校验applicationId、精确目标versionCode且高于当前版本、当前签名集合；不支持签名轮换。缓存继续安装重新核验，文件只在cache/apk-updates；半包/失败只清理自身文件，不接触连接、凭证和会话数据。

原生getStatus/downloadAndInstall/install及progress事件按revision同步；先订阅再取快照，拒绝迟到状态倒退，卸载清listener。包下载完成后保存专用偏好；文件缺失/版本已安装则废止缓存，安装器只获得content URI临时读权限。没有静默安装、系统权限自动放行、常驻服务或新增运行依赖。

## 验证

| 检查 | 结果 |
| --- | --- |
| 新APK更新隔离测试 | 5/5；内含纯Java39项下载/故障/缓存/身份断言 |
| 手机状态与连接回归 | 46/46 |
| 消息回归 | 通过 |
| 更新源与原子发布隔离测试 | 4/4，无SSH |
| 热更新路径/懒加载回归 | 通过，普通dist保持 |
| Mobile typecheck、Vite、Capacitor sync、Android assembleDebug | 通过 |
| APK核验 | 12项，版本/签名/权限/插件/Dex/双源/包内4个Web资源与最终dist逐字节一致；既有2个Cordova生成桩保持 |
| 公开发布核验 | 14项，完整下载、SHA/字节/大小/Content-Length、CORS与previous/正式/hot保持 |
| 浏览器实际操作 | 下载0/50%、失败重试、授权提示、继续安装、刷新/连接B恢复、安装待确认及热更新禁用通过 |
| 响应式 | 360/390/430px，浅深色、150%字号，无整页横溢，更新按钮至少44px |
| 浏览器控制台 | 正常合成native流程无error/warn |
| 真机 | ADB无设备；授权、系统安装器、覆盖保留数据仍待验 |

Android完整lint已通过JDK17 runner/JDK25编译的临时init配置实际运行，仍有**11项既有阻断、8项警告**：7项旧splash资源、3项旧HotUpdatePaths的API26调用、1项旧HotUpdatePlugin的API24调用；上述源文件未修改，新ApkUpdate文件0项问题。没有关闭lint规则或制造baseline。JDK25直接运行旧lint分析器不兼容，原始失败及最终报告均保留。首个直接Gradle尝试缺少ANDROID_HOME，补齐后才进入分析；这些工具入口问题与源码验收分开记录。

自审中避免了Capacitor getLong不转换JSON Integer的陷阱，并以本地SDK确认getContentLengthLong需要API24，新下载器改为兼容minSdk23的字符串长度解析。APK资源首次严格核对识别出既有Cordova空桩，随后单独与23逐字节对比，未当成陈旧hash资源。服务器APK使用合法的application/octet-stream，下载与安装依据字节/签名和显式安装MIME，不改服务器MIME。

浏览器全部为合成会话和合成Capacitor桥，不代表真实Android授权/安装。切换为普通浏览器模式时，原生fixture已移除的假token导致合成401，与产品无关；普通浏览器只读核对了新24源“已是最新”和浏览器下载标识，没有真实控制或写操作。

## 手机验收步骤

1. 浏览器下载并覆盖安装上方APK24，确认版本，不卸载。检查原Endpoint、凭证和会话仍在。
2. 后续preview更高版本发布后，在App点击“检查更新 → 下载并安装”，观察进度与校验，不应打开浏览器。
3. 首次允许本App安装未知应用，返回后确认系统安装；若拒绝授权，应能返回并手动继续。
4. 取消一次系统安装，回App点击“继续安装”，应不重新下载。断网/坏包应明确失败，并允许手动重试。
5. 覆盖后重新打开，核对实际版本、原连接和会话。Android键盘、前后台/切网和其他Agent真实控制继续按原记录分别验收。

## 回退与记录

预览指针可以按既有原子发布流程回退previous23，但已装24的Android通常拒绝降级；需要同签名、更高versionCode重新发布旧功能，不能通过卸载保数据。当前未做手机安装或回退演练。

复用并更新docs/online-update.md和原子发布脚本，新增可重复的test:apk-update与APK更新契约，不另建技能/自动化。没有操作Mac网关、Harness、Agent原任务、系统权限或登录自启动；无真实消息、答案或审批提交。未暂存/提交/推送/建分支或PR。

证据：`output/audit/2026-10-22/in-app-update/`；合成截图与布局数据：`output/audit/2026-10-22/in-app-update-ui/`。本轮浏览器tab已关闭、viewport已恢复，合成HTTP服务已停止。
