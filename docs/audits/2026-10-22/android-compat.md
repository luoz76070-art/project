# Android 兼容性修复与 APK25 真机验收

日期：2026-10-22。按用户“按照你的计划进行”继续10-20-agent-gateway任务。本轮完成Android lint修复、独立preview发布、App内升级和DeepSeek普通收发验收；网关整体任务仍in_progress。

## 实际结果

- 用户先确认已安装APK24 `1.3.3-in-app-update-preview`，随后按“设置 → 版本与更新 → 检查更新 → 下载并安装”操作，明确回复“App 内升级到25成功，原连接仍在”。这证明24→25的App内升级主流程与原连接保留通过。
- 用户在手机选择空闲DeepSeek原会话，手动发送仅要求回复、不调用工具的短消息，确认电脑同一会话收到一次、手机完整显示回复并结束；实际回复“同一会话收发成功，没有重复”。普通收发通过，不据此推断追加、中断或审批通过。
- 上述均为用户真机反馈。本机ADB没有设备，未通过ADB读取安装版本或录制系统安装过程；拒绝授权、取消后重试等真机分支仍单独待验。

## 修复内容

`HotUpdatePaths.deleteTree`用canonical File父链比较替换API26的toPath/Path.startsWith，保持minSdk23；禁止删除根、父目录和外部路径，同名前缀兄弟目录不被误判为内部。内部符号链接只删除链接，外部链接保持拒绝，不遍历目标。路径回归补父目录、兄弟目录、嵌套删除及内部链接；macOS临时目录根先canonicalize，避免/var与/private/var别名使夹具误判。

`HotUpdatePlugin`改读Content-Length响应头并解析long，替换API24的getContentLengthLong；缺省为未知长度，非法/负值拒绝，仍按实际流量执行32MiB上限和SHA校验。新增默认drawable/splash.xml，复用既有splashBackground；七个方向限定PNG和原启动主题保持。

UI测试fixture从appVersionCode生成“当前→下一版”，避免发布递增后合成更新入口失效。本次25→26仅为合成状态，APK26没有构建或发布；fixture不包含在生产APK中。

## APK25 独立预览与交付

[首次安装或旧版浏览器覆盖安装APK25](https://zyzlz.xin/mobile-codex/releases/android/preview/mobile-codex-1.3.4-android-compat-preview-2e75c4a22519.apk)

| 字段 | 值 |
| --- | --- |
| 版本 | 1.3.4-android-compat-preview / versionCode25 |
| 大小 | 4,050,467字节，比24增加500字节 |
| SHA256 | `2e75c4a22519eff3d8f39fda6a7f5be1d321180d5082808f5a305d0dd42eea6c` |
| 签名证书SHA256 | `3ffb81f3524a590f469b80476951a22fbc6e441a470b9270079a8c1d452c4a38`，与24一致 |
| 本地APK | `dist-apk/mobile-codex-1.3.4-android-compat-preview-debug.apk` |
| 独立交付 | `output/delivery/2026-10-22/android-compat-preview/` |

复用既有原子发布脚本，preview latest25、previous逐字节保留24；正式Android18、hot 1.2.2-web.1清单hash保持。包内实际APK更新源为preview，配置沿用被忽略的mobile生产配置。未发布25热更新或晋升正式通道。APK23及更早缺少原生安装插件，仍需浏览器覆盖安装带插件版本一次；不要卸载或清数据。已装25检查显示最新正常。

## 验证与证据

| 检查 | 结果 |
| --- | --- |
| 完整Android lintDebug | 0 Error/Fatal、5 Warning；原11项阻断全部消除，未关闭规则/加baseline/提高minSdk |
| APK更新隔离回归 | 5/5，含Java下载/故障/身份39项断言 |
| 手机状态与连接 | 46/46 |
| 消息、热更新路径与单HTML回归 | 通过 |
| 原子发布隔离回归 | 4/4，不连接SSH |
| 两端typecheck、Vite、Capacitor sync、Android assembleDebug | 通过 |
| Relay、独立插件构建与全部后端 | 通过；后端321/321 |
| APK成品核对 | 14项通过，含身份/版本/minSdk23/同签名/默认资源/权限/双源及四个Web资源逐字节等于最终dist，无fixture或陈旧hash资源 |
| 公开发布核对 | 15项通过，完整下载/字节/SHA/大小/Content-Length/CORS及previous/正式/hot保持 |
| 合成浏览器实际操作 | 下载0%/50%、授权提示/继续安装、安装待确认与热更新互斥通过；没有把打开系统安装器显示成成功 |
| 页面重新打开恢复 | 展开设置和版本面板后，“继续安装”可见可用；下载计数仍1、安装调用由2增至3，复用缓存，无重新下载 |
| 窄屏与控制台 | 360/390/430px无整页横溢，更新按钮44px，合成native流程无warn/error |
| 真机24→25与DeepSeek普通收发 | 用户明确确认通过，范围见上节 |

5项lint警告为ManifestOrder、DataExtractionRules、UnusedResources（xml/config与splash）及IconDipSize。完整报告保留；本轮不扩大到资源重构或备份策略变更。

证据目录：`output/audit/2026-10-22/android-compat/`。checks.json及各命令log记录隔离回归；apk-verification.json、publication-check.json记录成品/公网；phone-acceptance.json记录用户反馈来源及边界。原成品核验报告中的deviceInstallationTested=false表示该自动核验没有操作设备，后续人工结果单独保存，不回写历史报告。

JDK25不能直接运行当前旧lint分析器；本轮使用JDK17 runner、JavaCompile fork到已有JDK25。可重跑配置保留在lint-jdk.gradle，命令为：

```sh
cd apps/mobile/android
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
ANDROID_HOME=/Users/rorance/Library/Android/sdk \
gradle -I /Users/rorance/workspace/project/codex-to-phone/output/audit/2026-10-22/android-compat/lint-jdk.gradle :app:lintDebug --no-daemon
```

## 短时运行与性能

显式只读集成检查与默认隔离测试分开。线上网关PID/instance/固定文件、配置与设备文件保持；Harness原PID68334/68372及bridge9876保持。网关本地/公网鉴权、401、Android预检及Desktop IPC正常；Codex近期69/全部126，DeepSeek12会话/3项目，后者随用户活动由前轮11自然增加。

公网两Agent各首次订阅和主动断开重连，使用手机同源解码器恢复：Codex120消息、DeepSeek27消息，ID唯一、增量有效且无seq gap。首快照分别2600/2726ms、1211/1067ms；这是约4秒窗口的短时样本。最终runtime-health.json通过329条断言，包含逐帧检查，不能称329个独立测试。检查器发送模型消息/答案/权限决定与重启服务均为0；用户随后手动联测另记。

初版Node fetch检查器取消SSE后未自行收尾，仅停止了两个自建检查进程，最终改用curl有界读取通过。保留原日志，不视为产品缺陷或产品修复。未重跑或切换线上网关，未重启Harness。

后端1万会话合成列表回归cold96ms、warm p95 7ms，warmDirectoryScans=0、fullHistoryReads=0。本机近期列表单次4ms、公网444ms；单次不是p95，合成列表也不代表手机渲染或长期资源占用。本轮未新增性能代码。

## 仍待验证

- Codex普通控制本轮未新增真机证据；此前异步选择卡显示/提交及保留已验收。DeepSeek追加、中断、实际允许/拒绝、原生问题/计划、两端先答和取消仍需可用原请求逐项验收。
- Android拒绝安装授权、取消后继续、断网重试、键盘、前后台/切网及电脑休眠恢复仍待真机结果；浏览器fixture和主动重连不能替代。
- 长期连接测试按用户安排继续暂缓。未启用LaunchAgent，其他Agent实际原会话和正式晋升尚未完成。

更新契约与质量规范已记录minSdk23、路径边界、lint工具链和fixture版本规则，复用既有原子发布/交付流程；无新技能或自动化。自建浏览器页已关闭、viewport已恢复、合成服务已停止。未暂存、提交、推送、建分支或PR。
