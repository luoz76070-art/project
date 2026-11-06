# 执行顺序

## 2026-11-06 手机下载交付接续

用户要求把整合版下载到手机实际测试，继续下一步即准备可用的手机安装交付。复用最终code4及既有原子上传入口，使用独立`android/kelivo-preview`目录；先保存原正式、preview、previous与hot四份清单，提供对应源码、AGPL/原MIT许可和构建/安装说明，再发布APK并完整回下载校验大小、SHA与字节。仅新增静态下载文件，不切换旧更新通道、网关或真实任务，不进行Git写入。公网下载成功与用户真机安装/联动分别验收，59组账本保持实际状态。

已完成独立发布与公网完整校验：APK60,973,251字节/源码21,637,157字节，大小/SHA和全部字节均与本地一致；APK Range206、CORS与版本清单正确，旧四清单公网及远端保持。安装页须用明确`index.html`，目录404的首次失败保留；明确页面200且字节一致。对应源码含5,892个工作区文件和许可/构建说明，全部5,052个引入上游文件保留；未含私钥/本机配置/用户数据。详见`docs/audits/2026-11-06/kelivo-phone-download.md`及`output/audit/2026-11-06/kelivo-phone-download/publication-verification.json`。用户真机安装与真实联动仍待验，整体保持in_progress。

1. 盘点既有修改，固定Kelivo v1.3.4/4a7da9b6f5d77caccb9f8aaf656232a93ab14708；核对上游CI采用的Flutter3.47.6官方tag、Java/Android/NDK。
2. 在隔离目录准备工具链，保持上游业务源码不变复现release构建；记录命令、依赖、产物与阻塞。测量磁盘，避免清理用户缓存。
3. 根据基线建立最小Android宿主组合，验证Application/Engine/原生插件/资源/更新身份；通过后引入可追溯源码与正式构建入口。
4. 实现统一设计的AI/远控/设置独立导航与主题/返回/恢复，保留原业务入口。分别验证Mac离线、手机模型未配两种独立情形。
5. 实现可选交接契约、待确认卡、目标/附件和去重；用假服务验证确认/取消/迟到/重建，不提交真实任务。单独核查原Desktop新建能力。
6. 正式verify、相关Android编译/lint、可行的原生与浏览器验收，更新矩阵、文档和任务。实际不满足的项保持未完成。
7. 相关功能完整且验证通过时按项目流程精确保存本地检查点；不推送/发布/覆盖手机。保留其他任务已有修改。

检查点：上游基线 → 宿主编译 → 双独立入口 → 可选交接。每一阶段只基于实际证据推进，不能把F0视作F3。

## 2026-11-05 执行证据

- 上游固定归档 SHA256 为 `fade4d222f6f7f67e67b1a20d851b6ae9514b9167e260c96325e749424bf229d`，业务源码留在隔离副本。
- Flutter 3.44.9 是 pubspec 最低版本，但会将上游锁中的 intl、matcher、meta、test_api、vector_math 降级，且集成测试缺少 5 项 Flutter API；未将此适配副本作为最终构建基线。
- 已切换到上游另一个构建流程明确使用的 Flutter 3.47.6，固定官方 tag SHA `5fc346839b5d0eef006ed8404392afb4dfae428d`，Dart 3.13.5。
- 3.47.6 的 `flutter pub get --enforce-lockfile` 通过。隔离副本仅将 hosted URL 改为可访问镜像，归一化 URL 后锁文件逐字节等于原文件，版本及包 SHA256 全部保持。
- 3.47.6 的 `dart analyze --fatal-infos lib test integration_test` 通过：No issues found。
- Android 36、NDK 28.2.13676358、CMake 3.22.1 已安装，已有 SDK 及许可证保留；最初代理故障由用户修复后继续。
- 原远控 `corepack pnpm verify` 全部通过。ESLint 增加 `.tools/**` 排除，避免把隔离 SDK 和包缓存当成本项目源码检查。
- Release arm64 构建及上游单元测试正在执行，结果见 `output/audit/2026-11-05/kelivo-native/`，尚不能据此认定原生组合或双入口已通过。

## 恢复网络后的接续

- 首次3.47.6构建因Google Maven TLS握手失败退出；降低并发重试继续产生下载等待，约9分钟后人工中断。该中断会话虽返回0，也不是构建通过。
- 隔离Gradle init脚本仅路由Google Maven到阿里云Google镜像，不改版本、不关闭TLS；AGP8.13.1 JAR的官方与镜像SHA1一致。现以相同Flutter Gradle参数和镜像继续构建，日志 `baseline-build-3.47.6-mirror.log`。
- 完整上游测试尚在运行，唯一已报告失败为macOS系统电源原生测试30秒超时；测试本身先调用xcrun swiftc。待全量结束后单独复跑，未修改上游测试或超时阈值。
- 回收了本轮3.44.9旧Android debug引擎缓存（四个目录及对应旧stamp）和已解压的Gradle8.14下载zip，保留当前release/profile/macOS引擎、用户既有缓存和项目文件。
- 新增 `integrations/kelivo/remote-android` library，引用原远控Java/资源而非复制业务；Activity继承原六插件入口，并恢复BridgeActivity改写的Application主题。尚未完成宿主接线与原生编译，不能计整合通过。
- 新增 `scripts/build-kelivo-remote.mjs`，独立产出Web资源并显式清空原APK/热更新地址。构建及定向ESLint通过，检查确认原个人更新源未进入新bundle；原dist与个人配置保持。

## 当前检查点：等待构建磁盘空间

- 上游完整测试27分42秒结束：11,431通过、3跳过、1超时（进程退出1）。唯一超时项单独复跑3秒通过，不能把首次全量改写为通过。
- 镜像构建已通过全部项目配置，按上游需要补齐Android31/34；PRoot校验及三个ABI的termux_pty CMake编译完成，进入compileFlutterBuildRelease。
- 磁盘降到不足1GiB，人工中断本轮wrapper，退出130；构建子进程已退出，本轮空闲Gradle daemon已停止。未得到APK，不再后台继续消耗空间。证据 `build-resource-stop.txt`。
- 测试结束后只移除本轮test_cache/unit_test_assets，保留可复用的原生构建/依赖缓存。用户尚未回复腾出至少10GB或提供其他构建磁盘的问题。
- 结束前核验5059上游文件：无缺失；仅锁文件下载域名及生成Gradle报告不同，业务源码未改。详见 `source-verification-after-tests.json`。
- 记录落盘 `docs/audits/2026-11-05/kelivo-native.md`。本轮没有Git写入、部署或设备安装；新library尚未组合编译，不提交未验证接入为完成检查点。

### 有空间后的第一步

先检查df、用户回答与是否有新修改，再在 `output/audit/2026-11-05/kelivo-native/baseline/android` 恢复构建。环境脚本是 `../../environment.sh`，镜像脚本 `../../google-maven-mirror.gradle`，保留既有日志并写新文件。命令参数：

```sh
source ../../environment.sh
export NO_PROXY="${NO_PROXY:+$NO_PROXY,}storage.flutter-io.cn,pub.flutter-io.cn,maven.aliyun.com"
./gradlew --init-script ../../google-maven-mirror.gradle \
  -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=7897 \
  -Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=7897 \
  '-Dhttp.nonProxyHosts=localhost|127.*|*.flutter-io.cn|maven.aliyun.com' \
  --max-workers=2 --console=plain --info \
  -Ptarget-platform=android-arm64 -Ptarget=lib/main.dart \
  -Pbase-application-name=android.app.Application \
  -Pdart-obfuscation=false -Ptrack-widget-creation=true -Ptree-shake-icons=true \
  assembleRelease
```

该阶段只做固定上游基线；成功后再接入library并验证单Application/Engine、插件、预览身份及更新所有权，之后推进双入口与交接，不重新询问是否开始。

## 2026-11-05 用户授权清理后的接续

- 用户明确授权“你帮我清一下空间”。执行前确认没有Go/Flutter/Gradle构建在运行；`go env GOCACHE`精确指向缓存目录。
- 使用`go clean -cache`清理6.2GiB Go编译缓存，并清理DeepSeek/OpenCode/MiMo三个已核实仅含更新ZIP/元数据的updater下载缓存约1.64GiB。保留模块源码、聊天/凭证、已装应用及本轮Android/Flutter依赖和编译缓存。
- 实测净释放8,441,356,288字节（7.86GiB）；可用从3,020,681,216增至11,462,037,504字节（10.67GiB）。详细记录`storage-cleanup.json`。达到空间目标后停止清理。
- 恢复原始上游release构建，追加新日志`baseline-build-3.47.6-resume.log`，不覆盖此前中断证据。

## 2026-11-05 构建与原生组合检查点

- 空间恢复后的直接Gradle构建暴露release注册表与dev依赖不一致：flutter_native_splash/integration_test缺类。不能删注册条目或改依赖绕过；Flutter3.47.6源码显示`--no-pub`也跳过平台注册表生成。`flutter build apk --release --config-only --target-platform android-arm64`（保留默认pub步骤）生成正确release注册表后，锁文件归一化仍逐字节相同。仅加`--no-pub --config-only`没有再生成，失败尝试日志保留。
- 上游`assembleRelease`最终4分30秒成功，1275项任务；产物60,595,659字节，SHA256 `edc264b97d6e7309bccda755d9001067d349ff7a3c30890eac5f0e420e759c76`。日志`baseline-build-3.47.6-release-configured.log`，产物已单独保存为`upstream-release-arm64-unsigned.apk`，避免被组合构建覆盖。
- 新增`integrations/kelivo/android-probe.gradle`，仅构建期include Capacitor及远控library，采用独立预览ID和版本1，不改上游业务源码。首轮init还作用于Flutter included build、因缺主构建参数失败；现仅应用于主构建，实际重跑通过。
- 组合`:app:assembleRelease`1分40秒成功，1167项任务；JDK17 runner、JDK25 fork compiler保留原远控Java21。产物60,875,815字节，SHA256 `81c363ac9f2ce277214a2834c4f6d94fa95757c03f7f695343d759f377954d3c`，保存为`combined-native-probe-arm64-unsigned.apk`；日志`combined-probe-release-2.log`。
- 已核对独立ID、唯一KelivoApplication、唯一原主launcher、内部远控Activity、六个原远控插件保留、原生CapacitorHttp启用、5个远控Web文件与构建目录逐字节相同、Flutter引擎和AOT存在。仅arm64有libapp.so，其他ABI的原PRoot库不能冒充其他ABI可运行。两包apksigner确认未签名，未安装。
- 这仍是编译探针，产品导航/全局设置、主题与草稿/阅读位置恢复、上游更新/OAuth隔离尚未实现，不计双独立功能通过。当前正在追加`:app:lintRelease :mobile-codex-remote:lintRelease`完整检查，不以release vital替代全量lint。
- 再核对5059个上游文件无缺失，仍仅锁下载域名和生成Gradle报告不同，业务源码未改。`git diff --check`通过。

### 完整Android lint结果及接续位置

- 组合完整lint6分46秒失败：宿主58 Error、56 Warning；远控library单独完整lint2秒通过，0 Error/Fatal、1 Warning（原启动图片IconDipSize）。不能把成功assemble或release vital写成完整Android检查通过。
- 去掉组合init、同环境复跑未接远控的原版`:app:lintRelease`15秒失败，同为58 Error、56 Warning。按id/severity/message/file/line五字段组成多重集合，58条错误完全一致，无新增或消失；详见`lint-baseline-comparison.json`，两份原始XML/文本已分别保存。
- 原版报错：NewApi54、MissingSuperCall1、MissingClass1、GestureBackNavigation1、WrongConstant1；全部指向固定Kelivo源码/资源。lint报错不直接等同已证明的运行缺陷，须逐项判断实际调用保护、desugaring及APK类是否存在。
- 接续：保留原始5059文件基线与两个未签名产物，先对原版lint逐项定位并形成可追溯整合补丁，再在独立宿主中接线统一导航/设置和身份。不得通过删除功能、升minSdk规避原支持范围、关闭lint或直接接受58条为已通过。
- 产品接线仍要隔离Kelivo更新源和Android/Dart OAuth scheme，并补齐新包备份URI白名单；随后实现同级AI/远控入口、全局主题和各自状态恢复，补可选交接及合成验证。原Desktop新建与59组完整功能继续保持未验收。
- 本轮没有UI改动，未重复已有浏览器/原远控全量verify；相关检查为实际原生构建、完整lint、包内核对、上游源码/锁比较和diff空白检查。未提交模型任务、部署、安装手机或Git写入。

检查结束后，已停止本轮创建且空闲的Gradle daemon（PID41923），无运行中的Gradle wrapper。保留可复用构建缓存；最终可用5,296,795,648字节（4.93GiB，约5.3GB）。清理时曾达到10.67GiB，随后构建/完整检查新增缓存消耗约5.74GiB；不把清理后峰值当作当前可用容量。资源记录`resource-after-checks.json`。

## 2026-11-05 清理后用户指定的构建检查收尾

- 用户选择先收尾原生构建与完整检查，产品接线下一轮做；文稿清理搁置。本轮开始可用约26GiB，已有两个APK完整保留。
- 联合执行`:app:assembleRelease :app:testReleaseUnitTest :app:lintRelease :mobile-codex-remote:lintRelease --continue`，日志`closeout-native-checks.log`。组合assemble再次成功，60,875,815字节及SHA256与原产物完全一致；联合进程退出1，不能写为完整检查成功。
- 完整lint仍为宿主58 Error/56 Warning、远控0 Error/Fatal/1 Warning；与原版错误五字段多重集合完全一致。已核对UCropActivity实际存在于两份DEX类定义；46项文件API、4项进程API、4项资源及其他4项逐类记录，未改上游、未关闭规则或提高minSdk。
- 补运行Android原生单元测试。默认JDK17的2个类级错误明确要求Java21，未完整展开SDK36用例。新增`integrations/kelivo/android-test-jdk.gradle`，只选测试JVM及完整异常输出，保持Gradle/lint17和JavaCompile原目标。
- 独立JDK25首次组合全量305项中301通过、4项WorkspaceDocumentsProviderTest的FileObserver shadow类型转换失败；保留原日志/XML。未改源码或测试，随后未接远控上游全量305/305通过、组合再次全量305/305通过。首次4项根因未定，不能据复跑称稳定性已修复。
- 两包ZIP、哈希/身份、未签名状态和5个远控Web文件一致性再次核对；5059个上游文件无缺失，仍仅锁下载域名及生成报告不同。adb无设备，未安装或提交真实任务。
- 结果落盘`docs/audits/2026-11-05/kelivo-native-closeout.md`；复现说明补原生测试JDK用法。`docs/plans/2026-11-05-kelivo-native-next.md`包含质量阻断、正式宿主、身份隔离、统一双入口及验收条件，待用户启动。本轮构建检查取证已收尾，整体任务与质量门仍未完成。

## 2026-11-05 用户启动后的产品接线与签名预览

- 用户“进行下一轮”已启动上一轮计划。固定Kelivo v1.3.4正式引入`apps/kelivo`，5052来源文件无缺失，26个来源文件有差异、新增10文件；原始SHA及精确差异在integrations和本轮audit中。根/markstream锁归一化与上游相同。
- 保留minSdk24处理NIO/进程API、输入连接关闭、授权位、版本资源、UCrop依赖和返回路径；FileObserver shadow改为类级配置。完整宿主/远控lint为0 Error/Fatal、56/1 Warning，318项原生测试两次强制完整复跑通过；早期失败继续保留。
- `com.mobilecodex.kelivo.preview`独立身份，Android OAuth、新包备份URI、Provider和更新源均隔离。Flutter拥有唯一主引擎与全局外观，AI／电脑／设置同级导航；电脑Activity直接复用原六插件及React业务，另加ProductHost。
- AI/设置根保留挂载；电脑按各自契约恢复草稿、已上传附件元数据、会话选择及有界阅读位置，未知发送保留clientMessageId锁且不自动重发。Agent退出前真实effect同步保存，失败阻止导航；当前草稿避免被有界缓存先淘汰。深历史分页与像素位置完整恢复仍未验收。
- 原远控`corepack pnpm verify`通过，手机132/后端403；随后第7项Agent真实effect回归与最终lint单独通过，构建入口回归8/8通过。Dart分析No issues found，定向51/51，markstream全量351/351。
- 首次Flutter全量11,432通过、3跳过、5失败继续保留；最终停止模拟器/Gradle后concurrency4全量35分17秒完成：11,437通过、3跳过、0失败，退出0。没有以定向通过替换首轮失败，也不承诺测试永久无偶发。
- 最终全量结束后运行正式`node scripts/verify-kelivo.mjs --preview`，Gradle阶段1分05秒成功。签名APK为60,964,391字节，SHA256 `0283ceac8a2029087035cd14fb47a9e6814e8535d5d8d75ce44d7d47cc5b4d0c`；版本`0.1.0-native-preview`/code2、arm64 AOT。最后Agent草稿修补已进入包。
- 最终包重新核对签名、包名/version/minSdk24、唯一Application/launcher、内部remote、全部Provider authority/OAuth、原六插件/ProductHost/UCrop的DEX类定义、CapacitorHttp及5个Web文件逐字节一致性。元数据/完整原始输出与检查脚本均在`output/audit/2026-11-05/kelivo-product/`，产物在`output/kelivo/`。
- 浏览器12组布局、Codex/Agent独立草稿、电脑设置直达及存储失败保护通过。Android36模拟器仅旧包安装/首帧有证据；Computer Use无法识别裸Qt窗口，最终包未做原生点击、跨Activity键盘/返回/回收或真实系统插件/手机验收。
- 记录落盘`docs/audits/2026-11-05/kelivo-product.md`；复用正式构建和宿主契约。模拟器、合成fixture、测试浏览器及本轮空闲Gradle已关闭。未提交真实模型/电脑任务、发布、部署或进行Git写入。
- 本轮预览收尾，整体任务保持`in_progress`。原生完整验收、可选“交给电脑”、原Desktop新建能力及59组完整对照按`docs/plans/2026-11-05-kelivo-product-acceptance.md`接续，文稿清理继续独立搁置。

## 2026-11-06 用户继续：交接、原生局部验收与code3

- [x] 交接边界落design，自审后实施Flutter单条正文菜单、原生同步冻结锁、React独立确认卡与原Desktop发送/排队；禁止legacy/app-server替代。
- [x] 覆盖确认/取消/双击、上传与存储失败、scope/目标绑定、迟到队列/HTTP回执、未知重开及同文普通草稿。实际App发送函数与主题effect纳入生产路径回归，交接18项通过。
- [x] 原生实测定位Android16键盘遮挡及WebView明暗源不一致，增加IME/systemBars合并insets、Flutter主题所有权与明确detail包络事件；原生测试脚本误定位/输入/动画问题与产品修复分开记录。
- [x] 最终`corepack pnpm verify`手机152/后端403、入口8通过；原生`--preview --repeat-tests`333/333，完整lint0 Error/Fatal、宿主56/远控1 Warning。Flutter定向17项及完整Dart分析通过；本轮未重跑上轮Flutter全量。
- [x] 最终code3为60,973,771字节，SHA256 `ec663ce1dc88776649535faf0e4c482fc00716e7ba7871e383e03e8ad6663e1d`；包内签名/身份/插件/5个Web文件通过，产品不含fixture或runner。Android36独立模拟器已安装SHA相同，并取得6项原生离线通过报告及截图/树；不提交真实任务。
- [x] 5052来源无缺失，28来源修改、15非忽略新增；59组分层证据账本建立，46组历史测试文件仅记部分，整组0/59。审计、规范、项目入口及接续计划同步。
- [ ] 真机/API24设备、系统回收/插件、真实模型及电脑接收、原Desktop新建与全功能逐项验收。

完整证据`docs/audits/2026-11-06/kelivo-handoff.md`，待启动接续`docs/plans/2026-11-06-kelivo-device-parity.md`。首次后端退出超时及各类早期失败日志保留，后续通过不改写历史。未发布、部署或Git写入；整体in_progress，文稿清理继续搁置。

## 2026-11-06 用户继续下一步：code4设备与本地检查点

- [x] 系统栏底色/图标改由Flutter配色拥有；Android24/25导航黑底及Android35+透明栏分别处理，原IME inset所有权保留。
- [x] 设备复现电脑前台Flutter快照滞后，改为主题生成处提供实际light/dark palettes，原生system模式按配置选择，configuration/resume/偏好事件同步窗口和Web，显式主题优先。
- [x] 150%字体横屏视觉复核发现空白页flex收缩；仅增加`flex: 0 0 auto`。同一几何断言在旧SHA复现失败，最终SHA检查首/末均可滚动到。runner改用稳定坐标与主导航就绪；特定工具栏无障碍节点迟到的早期失败保留，未宣称根因修复。
- [x] 最终`--preview`与最新runner完整宿主lint通过，原生338项/0失败跳过、宿主/远控lint0 Error/Fatal、56/1 Warning；Flutter产品/菜单18项、Dart分析及备份/业务库/加密/快照/URI定向184项通过。本轮未重跑Flutter/markstream全量。
- [x] 收尾关闭模拟器及确认IDLE的本轮构建进程后，完整`corepack pnpm verify`手机152/后端403、入口8及其余步骤通过。首轮文件通知超时、定向复跑通过及最终完整通过分别保留，未改后端或超时，根因未定。
- [x] code4本地签名包60,973,251字节，SHA256 `e3fa92e2e0d0ef3ec29a5af1996f390ffa7683e0999734dcb211431cdbf92a06`；身份/签名/插件/5个Web文件及实际安装SHA一致，Android36离线13项passed/code-1，同版本开发覆盖后新进程双草稿恢复passed。旧code3、初版code4与配色阶段code4另存，不覆盖历史证据。
- [x] 来源5052无缺失、28来源修改/16非忽略新增，锁归一化仍等于固定上游；N2回写E08/E09/E12/G03局部设备证据，59组全为未完成。
- [x] 审计、规范、索引、计划、PRD与任务状态同步。本轮模拟器/空闲构建进程已关闭，可用9.63GiB；源码/缓存/证据保留，未操作在线网关、发布、真实任务或Git。
- [ ] 真机/API24、正式升级/系统回收/手势返回及完整系统插件、授权真实联动、原Desktop新建、59组全部适用子项继续按已启动计划推进。文稿清理独立搁置。

证据`docs/audits/2026-11-06/kelivo-device.md`与`output/audit/2026-11-06/kelivo-device/`。真实测试目标已异步询问、尚未答复，不重复索取确认或自行选择真实任务；总任务保持`in_progress`，不归档。
## 2026-11-06 手机截图视觉修正（本地完成，真机待验）

- 图号以用户最新附件为准：图2 AI为基准，调整图1电脑页。
- [x] Flutter语义颜色与Web轻量布局接线；保留全部既有控制。
- [x] 隔离浏览器浅深/窄屏/150%/过程/输入工具交互验证。
- [x] 新签名code5、相关回归与工程记录；真机效果待用户实际安装。

证据：`docs/audits/2026-11-06/kelivo-visual.md`。手机154/Flutter定向18/原生338、完整lint0错误、后端403复跑和其余检查通过。新APK60,965,067字节，SHA256 `7cc14d0461b4b7da1c08a259efc514b844ba460c6f03aa04c04b226e19b779a8`，包内5个Web文件及插件/身份核验通过；仅本地，公开下载仍code4。首次后端/断言/路径失败日志保留；未真机/模拟器、发布、真实任务或Git写入，总任务继续。


## 2026-11-06 App 内更新执行清单

- [x] 统一设置入口、一次性原生启动标识、独立更新页；电脑未配对仍可用。
- [x] 独立源构建/打包守卫；原通道隔离及同一原生插件复用。
- [x] 真实生产代码隔离回归、下载失败/恢复/迟到状态及浏览器窄屏大字号检查。
- [x] code6 正式签名构建、完整 lint/原生测试、成品资源/签名/更新源核验。
- [x] 对应源码与独立下载/更新清单、公网回下载和原四通道不变核验；手机安装单列。
- [x] 审计、task/spec/入口与会话记录。

App内更新本轮交付核验通过：见 `docs/audits/2026-11-06/kelivo-update.md`。公网APK/对应源码完整字节一致，原四通道不变，Android36升级及双草稿恢复通过；手机系统授权/安装与其余原始目标仍待验，整体任务继续。

## 2026-11-07 本轮执行清单

- [x] 默认紧凑动态过程摘要、按需展开及日志/代码字号；统一 Kelivo 渲染偏好。
- [x] 当前会话图片的鉴权、路径/MIME/大小校验与 Markdown 图像/大图/错误重试；隔离 API 与 UI 回归。
- [x] 真实浏览器窄屏、深色、大字号、连续执行与图片场景检查。
- [x] 递增 preview 版本，完整 verify、Flutter 定向分析/测试、Android lint/单元/签名构建与对应源码归档。
- [x] README、许可、发布目录 APK/校验信息；审查本项目既有改动及新增源码中的敏感配置，限定范围提交。
- [x] fetch 并核对全部未推送提交仅属本项目，正常推送 main 和 preview 标签，回下载核对 APK SHA；记录真实手机/在线网关边界。
