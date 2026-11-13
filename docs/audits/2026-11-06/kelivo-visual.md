# 电脑页对齐 AI 对话页视觉

日期：2026-11-06。以用户最新附件的**图2 AI对话页**为基准，调整**图1电脑页**。本轮完成视觉修正及本地签名预览；完整产品任务继续进行。

## 改动

- Flutter `productPalette`按AI默认规则提供用户气泡、头像、输入框/边框、次要文字与导航的语义颜色，保留自定义/动态及浅深主题。透明颜色先叠加页面背景再传六位hex；细线使用semantic.hairline。Web不再把primaryContainer映射为所有消息表面，旧快照缺字段回退CSS默认值。
- 整合电脑页过程采用轻边框折叠条，展开内容与助手正文直接排在页面上；圆头像、普通字重身份、完整本地日期时间、复制图标和留白对齐AI页。轻输入框为22px圆角；导航去上分割线、选中胶囊使用Flutter导航颜色，图标/标签采用正文色。控件点击区域仍至少44px。
- 过程/发送/引导/排队/停止/附件/语音及连接保护保持原路径，没有添加无实际能力的AI按钮。独立预览递增为code5，同时修正Web原本仍显示code3的诊断版本；原独立远控版本/更新源保持。

## 验证

证据目录：`output/audit/2026-11-06/kelivo-visual/`。

- 根verify的lint、两端typecheck/生产build、插件build、入口8项、手机154项通过。后端首轮402/403，一项既有daemon退出超时；原测试单独复跑及原完整403项复跑均通过，未改后端。`verify-remaining.log`记录剩余消息/可执行文件/热更新/APK更新/发布隔离检查全部通过，首次失败仍在`verify.log`。
- Flutter产品/交接/消息菜单定向18项通过（`flutter-verified.log`），最终定向Dart分析无问题。最初颜色断言误覆盖透明度、一次指定不存在的测试路径，修正后复跑，原日志保留；未跑Flutter/markstream全量。
- 正式`node scripts/verify-kelivo.mjs --preview`通过，原生338项0失败/错误/跳过；宿主/远控完整lint均0 Error/Fatal，56/1 Warning。构建9分59秒，见`native-build.log`。
- 浏览器360/390/430宽、浅深、360宽150%字号、844×390横屏150%字号均无页面横向溢出；助手及过程正文透明、导航无上分割线。工具栏中心和四边中点内缩5px命中、高度≥44。过程展开/折叠和复制通过，见`visual-check.js`、`browser-check.log`和六张尺寸截图。首次断言误纳入小型生成状态提示，收窄到正文article后通过。
- 150%/多行输入下，上传/停止/语音/引导/排队命中通过；排队只增队列计数不调用引导，取消只撤销队列；引导、空闲发送及两次停止分别走原接口，原生提交计数4。合成上传、语音弹层打开关闭、最新消息及复制通过。见`controls-check.js/log`及`controls-150-multiline.png`。CLI残留文件选择器随后手动处理，合成附件总数因此为2；不算真实上传/录音验收。
- `inspect-apk.py`检查最终身份/签名、唯一Application/launcher、内部远控Activity、Provider/OAuth、arm64 AOT、六个原插件及ProductHost实际DEX定义、无测试runner，全部通过；包内5个Web文件与最终构建逐字节相同。自动发现插件清单为空是既有手动注册方式，未拿空数组代替插件核验。

`comparison.png`是隔离浏览器合成数据，**不是手机截图**。左图保存的code4资源、右图新资源使用相同过程样本；左图未选到可控线程，其排队提示/禁用停止不是本轮修复效果。

## 本地交付与边界

APK：`output/kelivo/mobile-codex-kelivo-0.1.3-preview-arm64.apk`；身份`com.mobilecodex.kelivo.preview`，`0.1.3-native-preview`/code5，minSdk24，arm64，60,965,067字节。

SHA256：`7cc14d0461b4b7da1c08a259efc514b844ba460c6f03aa04c04b226e19b779a8`。证书SHA256：`3ffb81f3524a590f469b80476951a22fbc6e441a470b9270079a8c1d452c4a38`，与code4一致。完整结果见`apk-inspection-final.json`。

本轮没有上传/更新公开下载页；公开code4及原四更新源/运行中网关保持。code4本地SHA仍为`e3fa92e2e0d0ef3ec29a5af1996f390ffa7683e0999734dcb211431cdbf92a06`。新包如发布必须提供新对应源码，不能沿用code4源码归档。

本机未连接真机，本轮未运行模拟器；手机视觉/键盘/真实控制仍待验。没有真实模型/电脑任务、网关重启/切换、Git写入或清理。总task保持in_progress；原Desktop新建、59组整组0/59及文稿清理搁置保持。
