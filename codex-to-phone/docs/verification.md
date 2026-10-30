# 本地验证入口

所有命令在项目根目录运行。首次安装开发依赖使用 `corepack pnpm install --frozen-lockfile`。当前实测环境：macOS、Node 22.22.1、pnpm 10.20.0、Gradle 9.4.1、JDK17 runner、JDK25 compiler。新的 ESLint 开发依赖需 Node 20.19+、22.13+或24+的受支持分支；本项目本轮只验证了上述 Node22 环境。

## 命令

| 命令 | 范围 |
| --- | --- |
| `corepack pnpm verify` | lint → typecheck → 两端构建 → 独立插件构建 → 验证入口自测 → 手机 → 后端隔离回归 → 消息/可执行文件发现/更新/发布片段回归 |
| `corepack pnpm verify:android` | Android Java编译与完整lintDebug；不打包、安装或发布APK |
| `corepack pnpm verify:all` | 上述核心检查通过后，再执行Android检查 |
| `corepack pnpm verify --list` | 只列出核心步骤，不执行检查；可再加 `--android` |
| `corepack pnpm lint` | 明确配置的JS/TS规则，任何警告/错误使命令失败 |

`scripts/verify.mjs` 按序等待每步，首个失败立即非零退出，不继续后续步骤。后端测试从 `apps/relay/tests/*.test.mjs` 收集，以并发2和单测试30秒上限运行；该目录只能放隔离测试。2026-10-30集成验证中，并发4的两次全量运行都触发原生文件通知用例未及时更新；单独及并发2全量通过，因此恢复版本同步流程既有的并发2设置。该用例按可观察结果等待，截止3秒，仍远小于生产60秒扫描兜底；不跳过断言。构建会清理dist，不能同时启动另一套构建/测试。既有单项命令继续可用。

默认入口不包含 `probe:*`、`check-*-runtime.mjs`、真实会话控制、上传或部署。更新回归包含轻量Java检查，核心verify也需要可用JDK；完整Android检查另需SDK与Gradle。浏览器交互、Android安装/系统选择器、长时间网络恢复仍须单独验收。

## Android工具链

正式兼容脚本为 `scripts/android/lint-jdk.gradle`，由 `scripts/verify-android.mjs` 调用。lint runner必须为JDK17；JavaCompile fork到JDK21或更高。脚本读取 `java -version` 的stderr，检查版本和javac，缺工具明确失败，不降低lint规则。

| 环境变量 | 用途 |
| --- | --- |
| `MOBILE_CODEX_LINT_JAVA_HOME` | 明确指定JDK17；设置了无效路径时直接失败 |
| `MOBILE_CODEX_COMPILE_JAVA_HOME` | 明确指定JDK21+，必须包含javac |
| `ANDROID_HOME` / `ANDROID_SDK_ROOT` | SDK目录；macOS默认用户Library/Android/sdk |
| `MOBILE_CODEX_GRADLE` | Gradle可执行文件或路径；默认PATH中的gradle |

未指定JDK时，检查JAVA_HOME和Apple Silicon/Intel Homebrew的openjdk@17、openjdk@21、openjdk路径。其他安装布局通过上表显式指定。环境仅传给检查子进程，不修改全局Java或Gradle配置。当前入口以本机macOS工具链验收；不把这一结果外推为Windows/Linux已通过。

成功后解析 `apps/mobile/android/app/build/reports/lint-results-debug.xml`，输出Error/Fatal/Warning计数；有Error/Fatal仍判失败。Warning保留并报告，不添加baseline或关闭规则掩盖。

## lint边界

`eslint.config.mjs`启用debugger、重复else-if/duplicate case、unsafe finally、async Promise executor等明确正确性检查；React源码启用rules-of-hooks；`runtimeSync.ts`和`sync.ts`额外检查未使用变量。暂未全量启用exhaustive-deps、格式化及整个旧工程的unused规则；旧exhaustive-deps注释不代表该规则已执行。生成产物、Android资源、依赖与Trellis工具不纳入该JS/TS扫描。

`test:verification`覆盖真实lint规则拒绝、验证步骤顺序与失败停止、真实子进程非零传播、JDK角色校验、lint计数与缺失工具错误。增加新正式检查时同步更新入口和这组测试。
