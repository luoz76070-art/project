# 实施和验证

1. B4源文件、矢量和同尺寸品牌PNG/启动PNG，原生本机渲染入口。
2. B1启动名/roundIcon/Kotlin、旧资源清理、白色M通知。
3. xmllint检查全部Kelivo Android XML；全仓旧名引用分类、资源引用闭合检查，PNG尺寸/透明度与源文件一致性核验；实际查看四层预览。
4. 两提交、功能分支推送、中文PR。无Flutter、不构建APK、不声称真机缓存已验。

B4：五份源文件逐字节一致；25份Android XML通过xmllint；品牌PNG和启动PNG尺寸保持；已查看背景渐变、前景透明图和圆角整图。Swift/AppKit渲染成功，qlmanage沙箱初始化失败，未绕过。B1及最终验证继续。
