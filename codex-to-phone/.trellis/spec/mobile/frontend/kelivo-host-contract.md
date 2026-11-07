# Kelivo Android 宿主契约

## 边界与身份

`apps/kelivo` 固定上游来源见 `integrations/kelivo/upstream.json` 与 `source-files.json`；根锁和 markstream 锁仅允许下载域名归一化，不升级版本或包 SHA。上游生成产物不作为正式接线的唯一源码。

Flutter 的 KelivoApplication 拥有唯一主引擎、AI业务和全局设置。`integrations/kelivo/remote-android` 直接引用原远控 Java/资源，保留六个插件；ProductHost 负责本地导航、外观及有界交接存储锁。远控是内部 Activity，不声明 Application/launcher，不调用手机模型。原 `apps/mobile` 和 `apps/relay` 启动/打包边界保留。

当前本地独立包：`com.mobilecodex.kelivo.preview`，`0.1.8-native-preview` / code10，minSdk24，arm64 AOT；独立通道交付见mobicodex-branding审计。Namespace 继续为上游值，不等于实际包名。Android OAuth scheme 为 `mobilecodex.kelivo.preview`，Manifest/Kotlin/Dart/测试须同时核对；其他平台不全局替换。备份 URI 仅增加精确包白名单。

显示品牌为 MobiCodex。普通/自适应/monochrome 图标及浅深启动资源使用用户选定图片，生成入口为 `tool/prepare_mobicodex_branding.dart` 与 `tool/mobicodex_*.yaml`。内部 package、OAuth、数据库、备份、工具 ID 保持兼容；上游来源/许可真实保留。内置技能只刷新精确匹配旧 SHA 且来源为 bundled 的文件，保留用户编辑、删除与设置。

## 导航与状态

Flutter `app.product_shell`：getTab、setTab、setAppearance、openRemote、openRemoteSettings、openAppUpdates，原生以 showTab 回到 AI/设置。AI和设置根保持挂载；迟到启动恢复不能覆盖用户已选择的入口。分享/文件/后台会话 Intent 交还原AI渠道，单一导航所有者复用既有MainActivity。

Web 仅 `VITE_KELIVO_HOST=android` 启用 ProductRemoteShell；先取得 ProductHost.getState 的 revision1/appearance/openSettings，再挂载 Codex/Agent。电脑设置请求优先于上次Agent选择；该请求只消费一次。外观由 Flutter SettingsProvider 拥有，远控主题控件跳回统一设置。

电脑页以同App的AI聊天页为视觉基准。primaryContainer仅为强调色，用户气泡、头像、输入框/轮廓、次要文字和导航由Flutter提供独立可选颜色；透明色先混到实际surface再输出六位hex。缺字段回退CSS浅深默认值。过程内容和助手正文开放式排列，保留原控制；不为模仿工具栏增加无实际能力的按钮。回归检查新旧快照及迟到事件不串色。

Android WebView的`prefers-color-scheme`可能与Flutter及系统明暗不一致；宿主模式按Flutter提供的`appearance.dark`及palette绘制。Flutter同时提供实际主题生成处的`palettes.light/dark`（包含动态/自定义配色）；mode=system时原生按当前Android配置选择，避免Flutter在电脑前台停止绘制后快照滞后。显式light/dark优先，原生不重写Flutter设置或重算调色算法。ProductHost监听原生appearance偏好及configuration/resume变化，发送`product-appearance-changed`窗口事件，Web在卸载时移除监听；迟到的启动快照不能覆盖更新。Android35+边缘布局需同时避让systemBars/displayCutout/IME，取合并insets的最大值；键盘收起后恢复系统栏，不重复叠加底部高度。

远控原生窗口底色与系统栏图标同样由Flutter appearance拥有，启动及偏好变化均更新；不能只同步Web正文留下旧窗口主题。Android24/25导航栏使用黑底保证旧系统图标可见；真实最低版本设备仍需实测。Android35+窗口底色承托透明系统栏，系统对比度遮罩关闭，与IME边距各有唯一所有者。

`.messages-viewport`中的`.empty-chat`须保持`flex: 0 0 auto`，空间不足时按内容高度滚动。仅`min-height:100%`仍可能被flex收缩，使居中的说明文字溢出自身盒子并被输入框裁切。Android150%字体横屏检查须测滚动前首元素及滚动后末行相对于消息视口的可达性，不能只确认草稿还在。

Web离开前通过可取消的 `product-before-navigate` 保存当前scope草稿及选择；保存关键输入失败或上传中则阻止切换。硬件返回沿同一检查。返回Flutter可销毁WebView，不能依赖其常驻。Codex已上传附件只存可恢复元数据，不持久化失效blob URL；阅读位置按scope/会话有界64项。历史分页窗口恢复范围须单列验收。

Agent保存范围为连接scope、agent/session选择、草稿、阅读位置及待确认clientMessageId/原文。发送前先持久化身份；确认只清匹配项，结果未知时重开仍锁定，不自动重发。控制token、题目答案及审批能力不得新增持久化。

## 可选交接

Flutter `prepareHandoff` 仅传所选单条非流式消息正文，64KiB上限；不自动携带历史或原附件。Web确认卡使用独立有界缓存，编辑说明、选项目/已有Desktop会话及通过原上传路径添加文件。原Desktop新建接口缺口保持显式禁用，禁止以legacy/app-server替代。

原生SharedPreferences同步commit成功后才能沿原sendDesktopMessage发送：冻结scope/thread/message/clientMessageId，正文96KiB、记录128KiB。未知结果保持锁，重开不自动重发，只有精确匹配身份的回执才能确认；队列接收与Desktop接收分开，迟到队列确认不能降级已知Desktop确认。未提交草稿才允许取消。上传中或存储失败阻止确认和离开；连接变化需清空原附件后重新选择。

普通远控草稿独立保留。runtime及输入缓存白名单使用`pendingMessageSource: 'handoff'`标记交接，回执只清匹配pending，不清同文普通草稿/附件；结果未知时普通发送也不能复用交接ID。回归必须直接覆盖实际发送函数、SSE早到/HTTP失败、重开、队列恢复、同文草稿和目标/scope变更。

## 更新与验证

整合Android预览不得请求上游Kelivo更新；用户2026-11-06新增App内更新后，APK源改为`integrations/kelivo/update-channel.json`中的独立kelivo-preview/latest.json，热更新保持为空。构建覆盖独立远控环境变量，Gradle核对相同通道与宿主身份，Web显示宿主当前版本。统一设置通过openAppUpdates传递一次性openUpdates，Web初始化后直接挂载ProductUpdatesPage，不要求配对、也不挂载Workspace/Agent。电脑设置跳转同一页。更新页复用原ApkUpdatePlugin/useApkUpdate/清单校验，所有下载/包身份/签名/恢复契约遵循apk-update-contract；下载/校验/安装器待确认时阻止跨入口导航，硬件返回更新页后回全局设置。原独立远控仍使用自身版本和通道；不能把两套版本常量混为一套。

手动APK交付使用独立`android/kelivo-preview`静态目录，不将code4发布到原独立远控preview通道。发布前后保存并核对原正式、preview、previous及hot清单；发布后完整回下载核对本地大小/SHA/字节，下载可用与真机安装分别记录。随下载提供对应修改源码、固定依赖/构建说明、AGPL及原MIT/第三方归属；源码归档不得包含本机私钥/配置/用户数据或工具缓存，不能以未含整合修改的旧提交替代。code4/5无内置整合更新入口，需手动覆盖安装code6一次，之后可在App内检查并安装后续APK；不能声称旧code4能凭空开通。系统授权/安装由Android确认，浏览器替身不算真机升级。

正式原生入口 `node scripts/verify-kelivo.mjs --preview`：固定Flutter/锁核验、独立Web构建、release平台注册表生成、完整lint/原生测试、签名及实际包身份检查。Gradle/lint用17，编译/测试用21+；环境镜像仅构建期注入。不得关闭lint、全局baseline或提高minSdk规避检查。

执行根 `corepack pnpm verify`、Flutter定向/重大整合全量及markstream分析/全量；同一Flutter项目多套测试不得并行。浏览器fixture、Robolectric、模拟器启动、原生界面、真实模型/电脑任务分别记录。Android36最终code4离线13项已有局部验收，含导航/草稿/设置返回/重建、系统栏、前台系统明暗、显式主题、150%字体/IME/旋转/后台返回及横屏空白说明首尾可达；同版本开发覆盖后显式进程重启恢复另验，正式升级/真实低内存回收/手势仍待验。真实联动、完整原生行为及59组对照仍待验，不能凭源码保留或首帧宣称完成。instrumentation仅独立模拟器preview，必须同时核对report和INSTRUMENTATION_CODE、实际安装SHA；测试runner与fixture不得进入产品包。
