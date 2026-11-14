# 实施与验证

- 扫描 apps/kelivo 全树（含 Dart、ARB、Android、iOS、macOS、Windows、Linux、Web、assets），对开发文档/测试/依赖/内部标识分类；apps/mobile 与工作流只读扫描。
- 逐项替换显示文本及同步本地化。保留许可/版权/身份字段；检查窗口查找和致谢换行。
- 静态检查 ARB JSON、消息键集合、变更项占位符、tracked Dart 对应值/方法重复；plist/strings/XML 语法、保护字段及 git diff。
- Flutter/Dart 不可用，不执行 gen-l10n、format/analyze、Flutter 测试和 APK 构建；Dart 本地化按现有输出格式同步，发布前须在 Flutter 环境重生成并复核。
- apps/mobile 无修改：用户的 test:mobile/typecheck 条件未触发。
- 扫描前后清单和工作流交接见 scan.md，同时进入 PR 正文。
