# Kelivo 原生构建与宿主接入验证

日期：2026-11-05。状态：用户指定的构建与完整检查收尾已取证归档，见[本轮收尾报告](kelivo-native-closeout.md)。固定上游 release 与同包原生组合探针均构建成功；本轮组合构建再次成功且APK完全一致。Android原生测试原版及组合复核各305项通过，组合首次4项shadow异常保留待查。两包未签名、未安装；完整Android lint仍因58项原版相同报错未通过。产品接线留下一轮，双入口、交接或全量59组功能尚未验收；[下一轮计划](../../plans/2026-11-05-kelivo-native-next.md)待用户启动。

## 固定基线

- Kelivo v1.3.4，1.3.4+84，提交 `4a7da9b6f5d77caccb9f8aaf656232a93ab14708`。
- 上游归档20,472,448字节，SHA256 `fade4d222f6f7f67e67b1a20d851b6ae9514b9167e260c96325e749424bf229d`。
- Flutter3.47.6，提交 `5fc346839b5d0eef006ed8404392afb4dfae428d`，Dart3.13.5。采用上游CI明确使用的版本；声明最低版本3.44.9会改变五个锁定依赖并缺少集成测试需要的API，未采用该降级结果。
- Android36、NDK28.2.13676358、CMake3.22.1、Gradle wrapper8.14、AGP8.12.1、Kotlin2.2.20及JDK17构建器。原远控Java21目标继续保留，组合编译器沿用项目选择机制。
- 可追溯配置：[upstream.json](../../../integrations/kelivo/upstream.json)。5059个原始文件的SHA清单保存在忽略目录中的 `upstream-files.json`。

## 已验证与未验证

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 上游锁定依赖解析 | 通过；只替换hosted下载域名，归一化域名后锁文件逐字节相同，版本与包SHA256未变 | `pub-get-3.47.6-locked.log`、`lock-verification.txt` |
| 上游Dart完整分析 | `dart analyze --fatal-infos lib test integration_test` 通过，无问题 | `baseline-analyze-3.47.6.log` |
| 上游完整单元测试 | 27分42秒跑完：11,431通过、3跳过、1项macOS原生测试30秒超时，进程退出1；不改写为首次全量通过 | `baseline-tests-3.47.6.log` |
| 电源通知超时项单独复跑 | 3秒通过，未改测试及超时阈值；首次超时原因尚不能据此完全断言 | `baseline-power-test-retry.log` |
| 原远控正式验证 | `corepack pnpm verify` 通过 | `remote-verify.log` |
| 整合专用远控Web构建 | 通过；原更新地址未进入产物，原dist和个人环境文件保留 | `remote-host-web-build.log`、`output/kelivo/remote-web/remote-host.json` |
| 新脚本定向ESLint与语法检查 | 通过 | `build-kelivo-remote.mjs`及`eslint.config.mjs` |
| 上游release arm64构建 | 通过；正式release注册表生成后，Gradle4分30秒构建成功，产物60,595,659字节 | `baseline-build-3.47.6-release-configured.log`、`upstream-apk.json` |
| 新Android library与宿主组合 | 同包编译探针通过；1分40秒，60,875,815字节；单Application/launcher、六插件和Web资源核对通过。产品导航及运行验收未完成 | `combined-probe-release-2.log`、`combined-apk.json`、[接入说明](../../../integrations/kelivo/README.md) |
| 远控library完整Android lint | 单独运行通过：0 Error/Fatal、1 Warning（原启动图尺寸差异） | `remote-library-full-lint.log`、`combined-mobile-codex-remote-lint-release.xml` |
| 组合宿主完整Android lint | 未通过：58 Error、56 Warning；原版对照错误逐项相同，无新增错误 | `combined-probe-full-lint.log`、`upstream-full-lint-comparison.log`、`lint-baseline-comparison.json` |
| Android原生完整单元测试 | 独立JDK25下原版305/305通过、组合复核305/305通过；组合首次4项FileObserver shadow异常未定根因 | `closeout-upstream-native-tests.log`、`closeout-combined-native-tests-recheck.log`、[收尾报告](kelivo-native-closeout.md) |
| 双独立入口、统一导航/主题/恢复及可选交接 | 尚未实现和验收 | 当前task的PRD/design/implement |
| Android真机与供应商实测 | 未执行；adb未发现连接设备 | 不以Dart/浏览器测试代替 |

上表中日志名均相对 `output/audit/2026-11-05/kelivo-native/`，该目录被Git忽略，不能视作随源码发布的附件。

## 下载问题与环境适配

首次3.47.6 release构建失败于 `dynamic_color` 的AGP8.13.1依赖下载，随后Kotlin插件报错属于尚待下载成功后复核的级联错误，未据此改插件版本。代理恢复后，降低并发重试仍长期处于下载等待；约9分钟后人工中断，Flutter处理SIGINT返回0不代表APK构建成功。

随后使用仅本次构建生效的 `google-maven-mirror.gradle`，将Google Maven地址路由到阿里云Google镜像，保留Maven Central及所有依赖版本。AGP8.13.1 JAR的官方和镜像SHA1均为 `82c6f91119e69ca2068c9a0b549930bfe60385b5`；Gradle日志还记录了镜像资源与现有缓存校验值匹配后的复用。保持TLS验证。镜像脚本最初有一处Groovy闭包取值错误，已改为显式repository参数；该失败另存 `baseline-build-mirror-init-error.log`。

最终构建日志 `baseline-build-3.47.6-mirror.log`。直接调用wrapper所用参数来自Flutter3.47.6的 `packages/flutter_tools/lib/src/android/gradle.dart`：release任务、arm64目标、lib/main.dart、标准Application基类、未混淆Dart、控件跟踪及图标裁剪。未跳过源码编译、测试或依赖检查来宣称通过。

本次已通过全部项目配置；旧插件额外需要Android31/34，Gradle使用已有许可证自动补齐。PRoot库恢复校验通过，arm64-v8a、armeabi-v7a、x86_64的termux_pty CMake编译均完成（上游本身指定三个CMake ABI）。进入 `compileFlutterBuildRelease` 后，可用空间不足1GiB，主动中断本轮wrapper，退出130；其编译子进程已退出，随后停止本轮空闲daemon。没有源码编译失败的最终结论，也没有APK成功结论。

## 已写接入代码的范围

`integrations/kelivo/remote-android` 只增加Android library与内部Activity，直接引用原远控Java及资源。Activity继承原入口，保留六插件注册和热更新启动逻辑；在Capacitor创建前保存Application主题，创建后恢复。library不声明第二个Application或启动器。

`scripts/build-kelivo-remote.mjs` 独立构建远控Web资源，显式覆盖个人环境中的APK/热更新URL为空，并写入整合预览标记；library拒绝直接打包无标记的原远控dist。Kelivo自身更新入口的最终所有权尚须宿主接线，当前不能安装或发布一个仍沿用上游更新源的整合预览。

这些代码尚不能证明真实设备上的生命周期、主题与状态恢复，也没有把静态按钮计作两个独立功能。

## 存储与剩余步骤

初始可用空间约15GiB；首次工具链、多个原生插件的Gradle缓存及SDK已将空间压至不足1GiB，中断后约765MiB。只回收本轮旧Flutter Android debug缓存、已解压的Gradle下载zip，以及已结束测试的test_cache/unit_test_assets；Flutter自行移除了测试临时目录。保留本轮可复用的依赖/编译缓存及用户其他文件。已请求用户腾出至少10GB或提供其他构建磁盘，等待该外部条件后继续；没有后台构建继续写盘。

结束前再次对比5059个上游文件：无缺失，仅pubspec.lock的下载域名和生成的Gradle问题报告不同，业务源码保持原样；详见 `source-verification-after-tests.json`。未提交、推送、打标签、部署或安装手机。

后续按原目标推进：完成上游构建和测试结果归档 → 组合宿主编译与更新身份隔离 → 统一双入口/主题/状态恢复 → 可选交接及合成服务验证。完整59组矩阵和原Desktop新建能力仍是独立验收项，不由源码存在或编译成功推定完成。

## 用户授权的空间清理

用户明确要求代为清理。构建停止期间，核实Go缓存位置与无运行中的Go构建，执行`go clean -cache`；另移除DeepSeek、OpenCode、MiMo三个桌面应用缓存中的已下载更新包与对应下载元数据，不涉及应用安装、用户数据和凭证。本轮Android/Flutter依赖、工具链及编译缓存保留。

可用空间由3,020,681,216字节（2.81GiB）增至11,462,037,504字节（10.67GiB），净释放8,441,356,288字节（7.86GiB）。记录`storage-cleanup.json`含逐路径清理方法与前后容量。达到目标即停止清理，并恢复原始上游release构建，日志`baseline-build-3.47.6-resume.log`。上文等待空间为前一检查点记录。

## 清理后构建与同包编译证据

Flutter3.47.6的直接Gradle release构建不会自行重生成Flutter注册表。先前测试/依赖准备留下的注册表含两个dev插件，release编译出现缺类；`--no-pub --config-only`同样跳过注册表生成。使用`flutter build apk --release --config-only --target-platform android-arm64`并保留默认pub步骤，再核对锁文件版本与SHA保持后，构建通过。未手改注册表、删功能或换依赖。相关失败与配置日志保留，最终成功日志为`baseline-build-3.47.6-release-configured.log`。

| 产物 | 字节 | SHA256 | 身份 |
| --- | ---: | --- | --- |
| `upstream-release-arm64-unsigned.apk` | 60,595,659 | `edc264b97d6e7309bccda755d9001067d349ff7a3c30890eac5f0e420e759c76` | `com.psyche.kelivo` / 84 / 1.3.4 |
| `combined-native-probe-arm64-unsigned.apk` | 60,875,815 | `81c363ac9f2ce277214a2834c4f6d94fa95757c03f7f695343d759f377954d3c` | `com.mobilecodex.kelivo.preview` / 1 / 0.1.0-native-probe-preview |

两包均保存在本审计忽略目录，apksigner确认未签名。组合包低于现有128MiB更新下载上限；Flutter AOT仅arm64，PRoot三ABI库不代表三ABI Flutter包。未发布或安装。

组合init脚本`integrations/kelivo/android-probe.gradle`仅在主构建中include两个library，并设置独立探针身份。首轮因脚本也作用于Flutter included build失败，修复作用域后实际构建通过；保留失败日志`combined-probe-release.log`及成功日志`combined-probe-release-2.log`。继续复用JDK17 runner、JDK25 fork compiler，原远控Java21目标不降级。

已检查APK：唯一KelivoApplication、唯一原主launcher、内部RemoteControlActivity、六个原远控插件均保留、原生CapacitorHttp启用；5个Web文件逐字节等于隔离构建输出，原生Flutter引擎/AOT及原AI资源存在。`combined-apk.json`和`combined-merged-manifest.xml`记录结果。5059个上游文件核对仍无缺失，业务源码未改，详情`source-verification-after-probe.json`。

**编译探针不等于可安装预览或完整整合。** 产品级导航、设置、主题/状态恢复、上游更新源与OAuth/备份包身份仍须适配；AI/远控独立使用、可选交接、原Desktop新建及59组完整功能仍未验收。完整Android lint结果如下，不以release vital检查替代全量lint。

## 完整Android lint与原版对照

组合命令`:app:lintRelease :mobile-codex-remote:lintRelease`6分46秒结束并退出1。宿主报告58 Error、56 Warning。远控library单独运行`:mobile-codex-remote:lintRelease`2秒成功，0 Error/Fatal、1 Warning；唯一警告为原远控启动图片各密度dip尺寸不一致，不涉及新增Java代码。

随后去掉组合init脚本，在同一工具链下对未接入远控的Kelivo原版运行`:app:lintRelease`，15秒退出1，同样58 Error、56 Warning。按id、severity、message、file、line五字段组成多重集合比较，58条错误完全相同，无新增或消失。证据`lint-baseline-comparison.json`；原始报告分别保存为`combined-app-lint-release.xml`、`upstream-app-lint-release.xml`及同名文本，日志`combined-probe-full-lint.log`和`upstream-full-lint-comparison.log`。

| 错误类型 | 条数 | 位置或内容 |
| --- | ---: | --- |
| NewApi | 54 | 原工作区文件/进程API与原主题资源的minSdk24兼容性报错 |
| MissingSuperCall | 1 | MirrorConnection.closeConnection |
| MissingClass | 1 | 原Manifest的UCropActivity |
| GestureBackNavigation | 1 | 原MainActivity.onBackPressed |
| WrongConstant | 1 | WorkspaceDirectoryAccess的URI权限flags |

这些是未修改上游的lint报错，尚未逐条判定真实运行影响。后续须核对实际API保护、desugaring及APK类存在，再在可追溯的整合补丁中处理；不能将报告直接视为58个已证实缺陷，也不能关规则、抬minSdk或删功能后声称一比一保持。当前仅可确认两个APK编译和包内核对通过、远控library完整lint通过，**宿主完整检查未通过，整合产品未交付**。

检查结束后，已停止本轮创建且空闲的Gradle daemon（PID41923），无运行中的Gradle wrapper。保留可复用构建缓存；最终可用5,296,795,648字节（4.93GiB，约5.3GB）。清理时曾达到10.67GiB，随后构建/完整检查新增缓存消耗约5.74GiB；不把清理后峰值当作当前可用容量。资源记录`resource-after-checks.json`。
