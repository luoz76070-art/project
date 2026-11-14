# 修改边界

基线已完成 Android label、主界面/通知/分享、ARB 品牌和持久化显示映射的大部分替换。本轮补桌面供应商名称、导出文件名、Apple 权限/分享/后台文案、Web 和桌面窗口名称；更新关于简介、产品仓库链接，复用现有上游行显示完整致谢，手机端允许换行。Windows 窗口查找跟随显示标题，但 mutex 不变。

四份 ARB 复用现有 aboutPageUpstreamSource/aboutPageAppDescription，无新增本地化接口。补齐 zh_Hans 46、zh_Hant 22 个基线缺键：简体来自 zh；繁体补译原本继承的图片上下文文案；同步 tracked Dart 内容。

保留真实备份目录 kelivo_backups、数据库、协议和工具 ID、应用 ID、Dart package、资源路径、Apple app group/URL scheme。Windows ProductName 被 path_provider 用于数据目录，属于持久化身份；只改 FileDescription 和窗口标题。macOS PRODUCT_NAME/可执行文件名也保留，仅设置显示用 CFBundleName/CFBundleDisplayName。历史数据/用户编辑名称和技术字段不做替换或迁移。

不改 .github/workflows；APK 生成名实际位于 scripts/verify-kelivo.mjs，和发布脚本/工作流一起列入交接，避免只改 Gradle 无效。apps/mobile 无可见旧品牌残留，不改 Web 工作台或安装依赖。
