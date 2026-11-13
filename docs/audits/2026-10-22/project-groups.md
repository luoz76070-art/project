# Codex近期范围与两Agent项目折叠

日期：2026-10-22。任务仍为`10-20-agent-gateway`。用户要求将近30天/查看更早优化扩展到Codex，并把Codex与DeepSeek会话按项目文件夹归类、在手机展开折叠。

## 已交付行为

- 两Agent默认近30×24小时，可“查看更早会话”并切回近期；旧会话有新活动、新建会话在列表下次刷新加入。
- Codex网关按索引updated_at和rollout mtime较新值，在搜索/分页前过滤；limit+1确定准确hasMore，内部桌面定位仍使用原全范围。手机保留当前选中、已知运行、未确认发送/中断及待处理卡片；单纯已读缓存不让古老会话常驻。
- 两Agent共用项目分组：完整cwd/directory区分项目，末级文件夹名展示，同名不同目录补充路径，空目录归未分类。默认展开，折叠状态按连接与Agent隔离，最多保存256个折叠标记；刷新/分页不重置，搜索临时展开。
- 列表前台每30秒及回前台读取摘要；Codex静默刷新不读取live turns/正文、不切换当前会话。隐藏抽屉停止列表刷新。折叠组不构造或挂载其会话行。
- 项目按钮至少44px。窄屏顶部区域支持整体滚动，左侧窄栏保留箭头、名称和计数；360/390/430px及150%字号无整页横向溢出。

30天限制减少手机传输/渲染及不必要正文读取，不代表底层只扫描近期文件。Codex冷盘点及session index仍访问全量元数据；DeepSeek官方全量摘要/15秒缓存沿用上一版。正文、控制、提问、审批协议及DeepSeek原插件未改。参考已保存官方移动界面基线，未声称官方具有相同项目折叠样式。

## 验证

| 检查 | 结果 |
| --- | --- |
| 全后端隔离测试 | 321/321 |
| 手机状态/连接测试 | 46/46 |
| 新Codex范围回归 | 3/3，边界、筛选先于分页/旧头读取、旧会话新活动、HTTP默认/全部/鉴权 |
| 新手机回归 | 分组/同名/空目录、保留条件、偏好隔离/恢复/有界 |
| 两端typecheck、Relay/Mobile/插件build | 通过 |
| 消息及热更新路径/懒加载隔离回归 | 通过 |
| 浏览器实际操作 | 近期130/全部160分页、DeepSeek75会话、同名目录、折叠/搜索/刷新恢复、范围切换通过 |
| 摘要自动刷新 | 33秒样本只增加1次threads请求，无新增正文/live turns请求 |
| 隐藏抽屉 | 33秒样本threads新增0次 |
| 新建/旧会话活跃 | 合成桌面新会话及旧150会话进入近期；较慢旧搜索未覆盖新搜索 |
| UI | 360/390/430px、浅深色、150%字号、顶部/左侧布局通过 |
| APK | versionCode23、与22同签名、4个Web资源逐字节等于dist，无额外旧资源 |

修复前3个后端范围回归失败，手机缺少偏好模块失败，证据保留。浏览器首次多项目fixture把非默认会话正文误返回列表，已修正fixture；APK重建时旧页面懒加载hash失效，最终构建后刷新复核通过。这些合成问题与产品修复分开记录。没有使用真实会话自动发模型任务。

## 实际固定网关

私有备份：`/Users/rorance/workspace/backups/codex-to-phone/2026-10-22-project-groups-20261022T023416Z`。本轮复用既有固定网关切换/独立预览授权。

运行入口：`~/Library/Application Support/Mobile Codex Gateway/releases/2026-10-22-project-groups-58fef1a52eaf/mobile-codex/lib/gateway.mjs`，bundle SHA256 `58fef1a52eaf5d9e09771ed417875dad36dcc1776b24a3d41b77d99e942d410e`。旧网关正常停止、2067ms自然退出后启动新版本；未重启Harness或热重载插件，未启用登录自启动。

本地与公网均为Codex近期69/全部126，其中57个超过30天，全部会话涉及16个项目路径；DeepSeek近期/全部均11个、3个项目。本机与公网鉴权、未认证401、Android OPTIONS、同实例与原生IPC健康通过。配置、设备状态、DeepSeek插件/profile逐文件hash与原Harness主/后端PID保持。证据仅保存计数和结果，无会话标题/正文/ID/凭证。

回退先检查当前instance/PID和固定程序，正常stop并等待自然退出/监听释放，再使用上一版固定网关start，保留现配置/设备/插件；不恢复旧scope配置或终止宿主。过程复用[连接修复运维](../../ops/remote-connection-repair.md)，本轮未做实际故障回退演练。

## APK23独立预览

[覆盖安装APK23](https://zyzlz.xin/mobile-codex/releases/android/preview/mobile-codex-1.3.2-project-groups-preview-f79ca9612bf2.apk)。版本`1.3.2-project-groups-preview`，versionCode23，4,039,114字节。与APK22/21同签名，保留连接数据，不要先卸载。

SHA256：`f79ca9612bf27c5d50bd2d3d7cecf425bb40c3649d07d0f4024f6feb792417be`。

仅独立preview latest切23，previous完整保留22；正式Android18及hot `1.2.2-web.1`清单hash保持，未发布23热更新。公网完整APK下载与本地字节、SHA、大小及CORS通过，普通正式检查更新不提供23。

交付目录：`output/delivery/2026-10-22/project-groups-preview/`，含APK23、固定网关6文件ZIP、清单/校验和及检查结果；`output/audit/2026-10-22/project-groups-*`保存隔离日志、合成截图和脱敏运行结果。无配置和凭证。

## 待用户验收

手机覆盖安装23、核对版本、两Agent项目展开/折叠与近期/更早；Android前后台、键盘及真实控制逐项验收。浏览器和只读健康不等于实际手机安装/发送/中断/审批通过。本轮无代发真实消息/答案或权限决定，长期测试仍暂缓，Git未暂存或提交，整体Agent网关任务仍in_progress。
