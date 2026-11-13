# Kelivo 整合预览：手机下载安装交付

日期：2026-11-06。用户要求继续下一步，承接“应把App下载到手机验收”。本轮只交付最终code4的独立公网下载及对应源码，复用已验收APK，不重新构建或改变产品行为。真机与真实联动等待用户实际安装，整体任务仍进行中。

## 下载与安装

- [手机直接下载APK](https://zyzlz.xin/mobile-codex/releases/android/kelivo-preview/mobile-codex-0.1.2-native-preview-e3fa92e2e0d0.apk)
- [手机安装说明与对应源码](https://zyzlz.xin/mobile-codex/releases/android/kelivo-preview/index.html)
- [此APK对应源码归档](https://zyzlz.xin/mobile-codex/releases/android/kelivo-preview/source/mobile-codex-kelivo-0.1.2-preview-source.tar.gz)

手机浏览器下载后按Android提示允许当前浏览器安装应用，安装后打开“Mobile Codex Preview”。Android7.0/API24起，ARM64；包名`com.mobilecodex.kelivo.preview`，`0.1.2-native-preview`/code4，与原远控独立安装。模型服务/Key和电脑网关连接信息需要在新包分别配置；切换两个入口本身不提交模型或电脑任务。

APK为60,973,251字节，SHA256 `e3fa92e2e0d0ef3ec29a5af1996f390ffa7683e0999734dcb211431cdbf92a06`。使用本地Android Debug预览证书，证书SHA256 `3ffb81f3524a590f469b80476951a22fbc6e441a470b9270079a8c1d452c4a38`；版本与签名元数据见`output/kelivo/mobile-codex-kelivo-0.1.2-preview-arm64.apk.json`。预览未开通自动更新。

## 来源、许可与发布边界

使用`/var/www/mobile-codex/releases/android/kelivo-preview`独立目录。源码先通过既有`upload-release-atomically.sh`上传到其`source`子目录，APK用`publish-android-update.sh`显式指定当前版本与独立目录发布；静态安装页校验SHA后原子落盘。不修改Nginx、旧正式/preview/hot更新通道、网关或用户数据。没有Git写入或真实模型/电脑任务。

源码归档为21,637,157字节，SHA256 `e29965773bb5b75a8ddae7ff2a8cce904e1fbe6f987cdff17fa45b2a01816721`。包含5,892个工作区源码/依赖/资源/构建文件，连同说明、许可和SHA清单共5,897项；固定上游引入的5,052个文件全部包含，记录28个上游修改和16个新增路径。归档是当前整合版本的工作区快照，不以未包含这些修改的旧Git提交代替。

归档顶层保留AGPL全文及整合说明，原Codex To Phone的MIT许可另存`LICENSE.mobile-codex`，上游/依赖LICENSE和原生NOTICE保持原路径。源码包包含固定Flutter/Android/JDK/pnpm要求与实际构建入口，逐文件SHA和关联APK SHA在`SOURCE-MANIFEST.json`；不包含本机工具链、缓存、私钥、个人配置或用户数据。构建使用接收者自己的Debug签名，Web build ID也会变化，未承诺APK字节可复现。

归档文件白名单、路径/符号链接与凭证模式检查通过；13处Key模式匹配均为两个未修改上游测试中同一字母序列合成Key，逐处记录并审核，未放行其他匹配。此检查不是普适的无秘密证明。归档解包读取后，全部5,897项与准备内容逐字节一致。

归档发布后再次核对5,892个文件，只有`integrations/kelivo/README.md`增加公网下载说明；全部应用、原生、依赖、资源与构建源码保持归档中的精确SHA，见`source-current-comparison.json`。

## 验证

最终公网核验通过，`publication-verification.json`状态`passed`，日志`public-verification-final.log`：

- HTTPS完整回下载APK60,973,251字节、源码21,637,157字节，大小/SHA及全部字节分别与本地一致。
- APK清单200、版本/code/地址/大小/SHA/非强制更新字段一致，CORS为`*`；APK响应200、Content-Length正确、类型`application/octet-stream`。APK Range返回206，前1,024字节与本地相同。
- 明确`index.html`安装页返回200、HTML类型及全部3,234字节与本地一致，APK与源码链接正确。
- 原正式、preview、previous及hot四份公网清单的SHA和JSON内容前后完全一致；远端APK/源码SHA与本地一致，原四清单远端SHA也保持。
- 五份更新文档的本地链接与当前task的`in_progress`状态核对通过，`git diff --check -- .`通过。只有交付/文档变化，本轮未重跑产品构建或测试。

首次完整核验在APK与源码的完整字节/大小/SHA及APK Range检查通过后，访问安装页目录地址返回404；日志`public-verification.log`保留。现有静态服务不为该目录自动解析index，明确`index.html`地址返回200、3,234字节，已修正所有本轮安装页链接并从头保存核验检查点；没有因此修改Nginx或重新发布APK。

前轮Android36模拟器13项、原生338项、完整lint及其他隔离检查见[设备审计](kelivo-device.md)，本轮未重新运行产品测试。公网能下载不计作真机安装通过；手机/API24、系统能力、真实联动、原Desktop新建及[59组全部对照](kelivo-parity-evidence.md)继续待验，整组0/59。

## 接续与复用

先由用户在手机安装并核对AI/电脑独立入口、草稿、主题与键盘，再按[已启动设备计划](../../plans/2026-11-06-kelivo-device-parity.md)和用户指定目标验真实模型、电脑连接及主动交接。本轮不擅自选择或发送真实任务。

原始证据、发布日志、源码归档与一次性打包/回下载核验脚本位于`output/audit/2026-11-06/kelivo-phone-download/`。复用现有原子发布流程，补充独立预览下载与源码交付约束；没有新建定时任务或通用skill。文稿清理继续搁置。
