# Kelivo 原生构建检查收尾

日期：2026-11-05。用户本轮选择“先收尾原生构建与完整检查，产品接线下一轮做”。本轮完成构建复现、完整检查取证和问题分类；质量门仍未通过，未生成可安装整合预览。总任务保持进行中。

## 本轮结果

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| 组合 `:app:assembleRelease` | 再次成功，60,875,815字节；与清理前保存的APK逐字节相同 | `closeout-native-checks.log`，`closeout-apk-inspection.json` |
| 两份保存APK完整性 | ZIP校验通过，SHA256均与原记录一致；仍未签名 | `closeout-apk-inspection.json`，`closeout-package-identities.json` |
| 远控Web资源 | 包内5文件逐字节等于独立构建结果 | `closeout-apk-inspection.json` |
| 远控library完整lint | 0 Error/Fatal、1 Warning；本轮组合检查再次执行该任务 | `closeout-native-checks.log`，`closeout-remote-library-lint.xml` |
| 组合宿主完整lint | 58 Error、56 Warning；与未接入远控原版58条错误的五字段多重集合一致，无新增/消失 | `closeout-lint-comparison.json`及原始XML |
| 默认JDK17原生测试尝试 | 253个结果，251通过、2个类级错误；SDK36需要Java21，相关类未展开全部用例，不与305相加 | `closeout-native-tests-jdk17.json` |
| 独立JDK25组合原生测试首次全量 | 305项中301通过、4失败；同属WorkspaceDocumentsProviderTest的FileObserver shadow强制类型转换异常 | `closeout-native-tests-jdk25.json`及同名日志 |
| 独立JDK25上游原生测试 | 33组、305项全部通过，退出0 | `closeout-upstream-native-tests.json`及同名日志 |
| 独立JDK25组合原生测试复核 | 33组、305项全部通过，退出0，耗时约30秒；未改测试或业务代码 | `closeout-combined-native-tests-recheck.json`及同名日志 |
| 上游5059文件复核 | 无缺失；仅锁文件下载域名、生成的Gradle问题报告不同，业务源码未改 | `closeout-source-verification.json` |
| Android设备 | adb无连接设备；未安装、未运行真实模型或控制任务 | 本轮`adb devices -l`输出 |

表中证据均位于 `output/audit/2026-11-05/kelivo-native/`，属于本机忽略产物。组合构建/测试/lint首轮联合命令使用`--continue`收集全部结果，进程退出1；单个assemble成功不能改写联合检查的失败结果。新配置 `integrations/kelivo/android-test-jdk.gradle` 将测试JVM与Gradle/lint分开，实际使用JDK25、Gradle/lint仍用JDK17。

原有Dart分析、远控`corepack pnpm verify`、上游Flutter完整测试结果沿用[前次审计](kelivo-native.md)，本轮未重复。Flutter首次全量仍是11,431通过、3跳过、1超时，超时项单独复跑通过；不得把重试结果覆盖首次记录。

## 58条宿主lint错误分类

| 数量 | 类型与位置 | 核查结论和后续要求 |
| ---: | --- | --- |
| 46 | NewApi：EnvironmentDirectoryCleaner14、ProotShutdown4、RootfsCertificates12、RootfsExtractor5、RootfsInfo4、RootfsPatcher7 | 上游已开启desugar_jdk_libs:2.0.4，但两包DEX仍引用File.toPath、java.nio.file.Files等平台方法，未发现j$/nio兼容类；不能据“开启desugaring”推定Android24/25可用。后续适配必须保留符号链接不跟随、越界拒绝、原子替换及权限语义。 |
| 4 | NewApi：ExecRunner | APK保留Process.isAlive/waitFor平台引用；核查旧系统上的超时、取消与进程退出，不得仅提高minSdk绕过。 |
| 4 | NewApi：values及values-night的styles.xml | forceDarkAllowed及windowLayoutInDisplayCutoutMode位于通用资源；后续按系统版本提供资源并核对浅深主题及启动屏。静态报错尚不等于已证实启动崩溃。 |
| 1 | MissingClass：UCropActivity | **两份APK的DEX类定义均实际包含com.yalantis.ucrop.UCropActivity**；image_cropper固定依赖ucrop:2.2.11。当前lint诊断不等于包内缺类，后续核对lint依赖模型并验证裁剪入口；保留原声明及功能。 |
| 1 | MissingSuperCall：MirrorConnection.closeConnection | 当前先排空已接受操作，再结束composing并发布最终状态。不能直接在外层立即调用super导致提前收尾；后续补充排队、batch和重复关闭回归。 |
| 1 | GestureBackNavigation：MainActivity.onBackPressed | FlutterActivity子类先处理选择菜单再交给Flutter；须验证新返回手势、旧系统返回和选择菜单退出，不能直接套用ComponentActivity方案。 |
| 1 | WrongConstant：WorkspaceDirectoryAccess | 源码将返回flags与读/写授权常量按位与，并要求读权限；现有原生目录授权测试通过。后续核对lint常量推导与实际权限保留、撤销，尚不能认定为传入任意flags的运行缺陷。 |

以上为分类结论，未修改上游、未关闭lint规则或新增lint baseline；58条错误仍全部计入失败。56条Warning原始明细保留；远控library另有1条原启动图尺寸警告。

## 测试异常与交付边界

组合首次JDK25全量的4项失败均为 `ShadowFileObserver` 无法转换为 `SharedPathFileObserverShadow`。随后原版及组合全量均305/305通过；当前证据不能确定根因，也不能将其断言为已修复或已证实的产品回归。下一轮须保留首次日志并复核shadow隔离/执行顺序，避免只引用最后一次通过结果。

APK身份仍为 `com.psyche.kelivo / 1.3.4+84` 和 `com.mobilecodex.kelivo.preview / 0.1.0-native-probe-preview+1`，minSdk24、targetSdk36、Flutter AOT仅arm64。仍为未签名编译探针，尚无统一双入口、更新/OAuth/备份身份适配、主题/草稿/阅读位置恢复或真机验收。

本轮新增测试JDK配置和复现说明，保留原有产品及所有用户修改。后续目标和验收条件已落盘[下一轮计划](../../plans/2026-11-05-kelivo-native-next.md)；本轮结束后等待用户启动。
