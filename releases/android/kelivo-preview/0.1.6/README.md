# Mobile Codex 0.1.6 整合预览

日期：2026-11-07。Android **0.1.6-native-preview / code8**。

- [APK](mobile-codex-kelivo-0.1.6-preview-arm64.apk?raw=true)：60,977,711字节，Android 7.0+/API24，arm64 Flutter AOT。
- [对应源码](mobile-codex-kelivo-0.1.6-preview-source.tar.gz?raw=true)：21,689,287字节，5917个源码文件，5052个固定Kelivo来源全部保留。
- [SHA256SUMS](SHA256SUMS)、[APK元数据](mobile-codex-kelivo-0.1.6-preview-arm64.apk.json)、[源码元数据](source-package.json)。

APK SHA256：`17c6936f4058e6372c1e21d86aef569af7ce6ccaccf1a776e52220ee38465ed8`。
包名 `com.mobilecodex.kelivo.preview`，沿用code7预览证书：`3ffb81f3524a590f469b80476951a22fbc6e441a470b9270079a8c1d452c4a38`。

## 本次修正与安装

执行说明和记录直接显示，连续工具调用仍合并为动态摘要；仅命令与输出默认折叠，点击一次直接显示详情。消息顺序、15px正文/12px代码/约11px日志保持，隐藏工具卡片偏好不隐藏执行说明。终稿到达只收起工具区。

code6/7从「设置 → 应用更新 → 检查更新」下载，再按Android提示确认安装；也可手动下载本目录APK覆盖，无需卸载。code4/5需先手动覆盖一次。独立自托管源同步本版本，previous保留code7。启动安装器不代表已安装，code8新折叠效果待手机复测。

用户已真机确认code7图片/大图返回、字号、原连接/草稿/主题正常。本次沿用[0.1.5图片网关](../0.1.5/README.md)，本机已升级，无需再次部署。其他使用者若仍用旧网关，先按该说明升级以支持Codex项目内图片；其他Agent本机取图与完整59组仍未验收。

## 构建、许可与核验

根verify手机165/后端407/入口8通过；原生340项、完整lint0错误（宿主56/远控1既有警告）。APK签名及5个Web文件逐字节匹配。浏览器窄屏/深色/大字号、说明常显、20→40增量、终稿收起及图片/大图通过。本轮只改Web展示与版本，Flutter业务未改，未重跑Flutter全量。

源码附依赖锁、构建脚本、来源和每文件SHA、AGPL及原MIT/第三方声明，不含SDK/缓存、个人配置或签名私钥。正式构建入口 `node scripts/verify-kelivo.mjs --preview --repeat-tests`，环境见[构建说明](../../../../integrations/kelivo/README.md)。整合程序遵循[AGPL v3](../../../../apps/kelivo/LICENSE)，原远控源码保留[MIT](../../../../LICENSE)。

Git标签：`codex-to-phone-v0.1.6-native-preview`。检查与双通道交付回执见[本轮审计](../../../../docs/audits/2026-11-07/execution-notes.md)；该包为预览版，完整整合任务继续进行中。
