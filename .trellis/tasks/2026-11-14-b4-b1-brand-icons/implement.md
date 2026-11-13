# 实施和验证

1. B4源文件、矢量和同尺寸品牌PNG/启动PNG，原生本机渲染入口。
2. B1启动名/roundIcon/Kotlin、旧资源清理、白色M通知。
3. xmllint检查全部Kelivo Android XML；全仓旧名引用分类、资源引用闭合检查，PNG尺寸/透明度与源文件一致性核验；实际查看四层预览。
4. 两提交、功能分支推送、中文PR。无Flutter、不构建APK、不声称真机缓存已验。

B4：五份源文件逐字节一致；25份Android XML通过xmllint；品牌PNG和启动PNG尺寸保持；已查看背景渐变、前景透明图和圆角整图。Swift/AppKit渲染成功，qlmanage沙箱初始化失败，未绕过。B1及最终验证继续。


## 最终验证

- `xmllint --nonet --noout`：全仓66份XML通过（包括第三方示例）；五份SVG与授权目录原件逐字节一致。
- 10张新launcher PNG：普通/圆形均为48/72/96/144/192，符合五种密度；29张既有品牌/启动PNG保持原尺寸。
- Manifest的icon/roundIcon、两处Kotlin和两个adaptive-icon三层引用均指向存在的新资源；无旧宿主launcher文件、色值或app_icon_dark，相关生成配置无旧图片引用。
- 全仓旧资源引用扫描保存在`/tmp/b4-preview/old-resource-references.txt`：剩余3处独立apps/mobile及3处第三方example Manifest，均不引用Kelivo宿主资源，遵循任务边界保持不动。历史文档和生成器删除名单不是运行时引用。
- 实际VectorDrawable投影预览：背景全不透明；前景与单色透明像素均249912/262144，边界一致；前景实体颜色为F5F1EA和F59E0B；单色实体纯黑，通知实体纯白，边缘透明，已查看原图/圆形/棋盘透明度预览。
- `/tmp/b4-preview/adaptive-background.png`、`adaptive-foreground.png`、`adaptive-monochrome.png`、`notification.png`以及image-checks.json均不提交。PNG由Swift/AppKit渲染；qlmanage因沙箱初始化失败不可用，未提权或绕过。
- B1重新运行同一生成器后，B4已提交PNG逐字节保持（无额外二进制差异）。`lgit diff --check`通过。未修改AGPL/版权、applicationId/包名、界面文字或workflow。
- 无Flutter/Dart，未运行APK编译、Dart分析/格式器或真机。Android资源编译、荣耀覆盖安装后的桌面/多任务/通知/主题图标及打开再返回行为由Claude发布后验收；静态解析不能证明系统缓存已刷新。
