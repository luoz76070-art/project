# Kelivo 整合预览：App 内更新

日期：2026-11-06。用户要求“继续下一轮，同时希望能直接在 App 里面进行更新，和 codex-to-phone 一样”。本轮将旧整合包关闭更新源的限制改为独立整合 APK 通道，继承上轮电脑页对齐 AI 的视觉调整。整体整合任务继续 in_progress，59组整组仍0/59。

## 用户可见结果

统一设置增加“应用更新”，电脑设置中的更新入口进入同一页。打开此页不要求配对电脑、不挂载 Workspace/Agent，不调用手机模型或电脑任务。页面以 Flutter 提供的 Kelivo 浅深语义配色呈现当前版本、检查结果、版本说明、下载进度和重试/继续安装。

APK 下载及安装复用原 ApkUpdatePlugin、useApkUpdate、ApkUpdateProgress 与清单解析；大小/SHA256、真实包名、递增版本和同签名校验继续生效，安装由 Android 系统确认。下载/校验和安装器待确认阶段阻止切换，授权拒绝、取消安装或刷新后可继续，继续安装不重下。调起安装器不显示“升级成功”。整合热更新尚未接通。

code4/5 未内置此整合更新入口，需要先手动覆盖安装 code6 一次，无需卸载；后续发布新版后可在“设置 → 应用更新”检查、下载并安装。不能给旧 code4 凭空开启原生功能，也不能用当前“已是最新”替代真实升级验收。

## 成品与通道

- 包名 `com.mobilecodex.kelivo.preview`，`0.1.4-native-preview` / code6，minSdk24，arm64。
- APK `output/kelivo/mobile-codex-kelivo-0.1.4-preview-arm64.apk`，60,975,239 字节，SHA256 `26c1fd78cca21cbecdb84fcbae54c930da0f601080683475f484ff527817a0fa`。
- 证书SHA256 `3ffb81f3524a590f469b80476951a22fbc6e441a470b9270079a8c1d452c4a38`，与code4/5一致，仍为预览Debug证书。
- 独立下载页：[手机安装与源码](https://zyzlz.xin/mobile-codex/releases/android/kelivo-preview/index.html)。首次覆盖后使用应用内入口。
- APK清单固定 `https://zyzlz.xin/mobile-codex/releases/android/kelivo-preview/latest.json`，构建与Gradle从 `integrations/kelivo/update-channel.json` 核对同一地址，覆盖原独立远控环境变量；热更新地址仍为空。
- Flutter上游更新请求继续阻断。原独立远控正式/preview/previous/hot四清单保持，独立通道的previous保留code4；不改Nginx、网关、真实会话、凭证或Git。

## 本地与隔离验证

- `corepack pnpm verify`：完整通过，入口8、手机155、后端403、其他检查通过；APK更新6项和原生下载39断言通过。未修改后端。
- Flutter产品/交接/菜单定向19项通过；涉及文件Dart分析无问题。本轮未重跑Flutter/markstream全量。
- 正式 `node scripts/verify-kelivo.mjs --preview --repeat-tests` 构建2分49秒成功；原生340/340，完整lint宿主0错误/56警告、远控0错误/1警告。
- 浏览器五场景：360/390/430px、浅深、150%窄屏与横屏。更新页不挂载电脑业务，按钮至少44px且中心/四边命中，无横向溢出。503/坏清单重试、下载进度、防误离开、授权拒绝、安装取消、刷新恢复、继续不重下、下载失败手动重试、无新版本禁用及硬件返回回设置均通过；无电脑API请求。全部为合成bridge，不能当系统安装已验。
- 包内5个Web文件与最终dist逐字节一致；实际DEX包含六原插件和ProductHost、安装权限与FileProvider、唯一Application/launcher、内部远控Activity、OAuth及arm64 AOT核验通过。包内JS实际包含整合更新源，原独立preview/hot源不在该包内，产品包无fixture/测试runner。
- Android36独立模拟器从实际code4 `adb install -r` 覆盖到code6；回拉已安装APK的SHA与交付包相同，未清数据。实际Flutter设置进入应用更新、Android硬件返回全局设置2项通过；显式结束进程后的原AI/电脑双草稿恢复另通过。系统安装授权/从App下载新版本后覆盖安装没有在此模拟器轮执行，手机真机待验。

原始证据 `output/audit/2026-11-06/kelivo-update/`；浏览器图与脚本 `output/playwright/kelivo-update/`。首次Flutter定向命令写错菜单测试路径，首次runner构建漏JDK角色环境，首次源码打包漏argparse导入；失败日志均保留，修正后各入口通过，不隐藏早期失败。未因这些命令错误改变产品实现。

## 对应源码与复用

源码归档 `mobile-codex-kelivo-0.1.4-preview-source.tar.gz`，21,647,968 字节，SHA256 `4516ff75972bfd35d17880ff27116d6e9d64f1905416fa949904fa26da09a873`；5897个源码文件、共5902项，5052个固定引入来源全部包含。含本轮修改、锁、本地依赖、构建说明、AGPL、原MIT和第三方归属。归档逐项回读一致；扫描无未审核凭证模式，仅13处固定原始上游合成Key精确放行。扫描不等于普适的无秘密证明。

复用原原子发布/安装引擎，将前轮一次性对应源码流程收敛到 `scripts/package-kelivo-source.py`，不再依赖历史output内的来源修改列表。没有新增自动化、通用skill或Git操作。构建入口、版本对齐、独立源和源码交付用法已写入 `integrations/kelivo/README.md`。文稿清理继续搁置。

## 公网交付检查点

APK、源码与静态安装页已按独立目录上传；最终HTTPS全量回下载、Range、CORS、previous及原四通道字节核验由 `verify-publication.py` 落盘，最终结果以 `publication-verification.json` 为准。手机真机视觉、系统授权/安装、其余真实联动、原Desktop新建与59组完整对照仍未完成。

最终公网核验 `publication-verification.json` 为 passed：安装页/清单200，APK 60,975,239字节与源码21,647,968字节完整回下载大小/SHA/全部字节一致，APK Range206、CORS正确，独立previous保留code4，原四清单SHA与JSON内容前后完全一致。所有5897个当前源码文件与已发布归档精确SHA保持一致。Android模拟器与本轮专用浏览器测试已关闭；用户原56407预览服务保持，下载页作为交付页保留。没有Git写入、网关变更或真实任务。
