# 优化交付与统一实测

日期：2026-10-20。A–D 的本轮源码实施与隔离验证已完成，等待用户统一真机实测。本文记录交付状态；原审核 README 和 evidence.json 保留修复前基线。完整机器可读结果见 optimized-evidence.json。

## 手机更新恢复补充

当前安装包为 **1.2.2-update-restore / versionCode 18**，已恢复原更新源并通过公网通道发布，包含下面 APK 17 的工作状态修复和 APK 16 的前序优化。APK 16/17 由于构建缺源需先从手机浏览器覆盖安装一次；带源旧版可在 App 内检查并下载新版。签名、资源、SHA、大小、CORS 和浏览器更新检查均通过，真机安装仍待验收。下载与证据见 [手机更新恢复](update-restore.md)。下文“未发布手机包”仅指当时的历史交付状态。

## 工作状态修复补充

用户已确认会话记录同步，当时仅修复工作状态。该阶段包为 `dist-apk/mobile-codex-1.2.1-live-status-debug.apk`（versionCode 17），已构建并切换本机 Relay，本地/公网只读状态验证通过。后端 43/43、客户端 16/16；详见 [工作状态修复](work-status.md)。以下保留 APK 16 的前序优化记录；当前安装包请使用上文 APK 18。该阶段未发布手机包。

## 前序本地交付

- Android：`dist-apk/mobile-codex-1.2.0-optimization-debug.apk`，versionCode **16**。包内资源已逐字节核对为最终 Vite 构建。
- Mac：根目录 `Mobile Codex Relay.app` 和 `Mobile Codex Input.app`，已构建、签名；后续按用户授权启动当前 Relay，公网健康检查通过。
- 前端：JS **288.97 kB / gzip 92.43 kB**，CSS **36.46 kB / gzip 7.38 kB**。相比审核基线 gzip JS 增加约 4.51 kB，包含配对、恢复、分页、Markdown 和新界面；没有增加 UI/状态/Markdown 库。
- APK 原生依赖和 Keystore 插件已变更，首次升级必须安装 APK 16，不能只向旧 APK 推送 HTML。浏览器仍使用 localStorage，凭证加密只覆盖 Android 原生端。

源码收尾时没有部署；后续按用户授权完成 Broker/Mac 切换及证书修复，见 [连接修复记录](connection-repair.md)。没有暂存、提交、推送、创建分支、发布 APK 或注册登录项。构建的 Mac App 依赖本机工程路径与 Node，不能作为独立便携安装包分发。

## 实现结果

| 范围 | 结果 |
| --- | --- |
| 工程 | Mobile 按功能分层；Relay 按 server/transport/store/desktop/codex 分层，Node/SEA 共用工厂；保持原入口 |
| 实时与恢复 | Broker 流式块转发、ACK/取消/背压；心跳与连接代次隔离；手机重取流凭证并恢复；正常推送时停止业务轮询 |
| 数据正确性 | JSONL 完整 UTF-8 字节边界、长行、轮换 generation/reset、稳定消息 ID；全历史 API 保留完整语义；发送不静默转移到 Relay |
| 性能 | 目录增量索引和低频对账、根目录替换检测、摘要与文件头缓存、patch/seq 与删除、完成态有界回收；缓存写合并 |
| 手机工作区 | 缓存首屏恢复选中线程/消息/草稿，连接作用域隔离；长历史分页、阅读位置保持；线程分页与全量搜索 |
| 接入 | 5 分钟一次性配对、独立设备凭证、哈希持久化与立即撤销；Android Keystore AES/GCM；公网 HTTPS |
| Mac 与维护 | 串行输入事务、独立请求文件、未知结果不重发；进程监督/退避/唤醒探测；日志权限/轮转；自启脚本；原子发布 |
| UI | 真实官方手机版画面基线；单色浅深主题、用户气泡/助手正文、代码块、两行输入栏、抽屉与简化设置；大字号标题截断与触控范围修正 |

## 已执行验证

| 检查 | 结果与边界 |
| --- | --- |
| 两端 typecheck、Relay/Vite build | 通过；仓库没有独立 lint 命令 |
| 后端隔离回归 | **39/39**：correctness 12、performance 6、transport 14、availability 7；合成会话、随机端口与临时目录 |
| 客户端与发布 | **15/15**：订阅/patch/缓存/工作区 9、profiles 4、原子发布 2；不连接 SSH |
| 消息与热更新 | `test:messages`、`test:hot-update` 通过，后者运行真实 Java 路径/符号链接/删除边界测试 |
| Android | Capacitor sync、完整 `assembleDebug` 和项目 `android:apk:mac` 入口通过；JDK 25、Gradle 9.4.1；保留 Gradle 旧 API 警告，未在手机安装 |
| Mac | 两个 Swift typecheck 与两个 .app 构建通过；保留 Input 的旧激活 API 弃用警告；不触发真实辅助功能输入 |
| 依赖 | 本次 pnpm 全量和 prod 审计报告均为 0 条公告；不代表未来公告或所有安全性质 |
| 合成索引 | 10,000 会话，最终合跑冷读 **88 ms**、热读 p95 **7 ms**，热目录扫描/全历史读取/文件头 open 均为 0；本机合成数据，不代表线上延迟 |
| 空闲请求 | 浏览器健康 SSE **69.36 秒**，仅 1 次 `/api/connection`，没有线程 delta/列表业务轮询；不含 SSE 心跳帧，不代表功耗测量 |
| 浏览器 | 360/390/430 px 浅深主题；无整页横向溢出；A/B 相同 threadId 草稿隔离；断流取新 token 恢复；145 条分页顺序；搜索首屏外会话 144 |
| 缓存与阅读 | API 全部返回 503 时重载仍显示缓存会话/正文/草稿；30 条旧历史中滚动至 3062.5 px，收到新推送后仍为 3062.5 px；返回最新可用 |
| 大字号 | 360 px、根字号 150% 合成检查，标题与按钮不重叠，输入栏在视口内；不能替代 Android 系统字体/键盘验收 |

画面在 `output/audit/2026-10-20/optimized/`；参考在 `output/ui-reference/2026-10-20/`。截图只含合成数据。断网测试中的 503 是刻意注入，正常连接浏览器未发现控制台 error。

## 用户统一实测顺序

1. 保留现有环境，安装本地 APK 16，重新打开新版 Mac Relay App；若系统要求辅助功能授权，对新版 Input helper 授权。该版本直接启动 helper executable，其权限归属和真实发送需要这次确认。
2. Mac `Pair phone` 会复制 `{endpoint, code, expiresAt}`。手机设置中粘贴到“配对信息”，点击“配对连接”。配对码只用一次，5 分钟过期；手工 Endpoint/管理员 Token 保留为恢复入口。
3. 确认线程列表、搜索、旧历史、附件与草稿，向一个可用于验收的 Desktop 线程发送一条明确的测试消息，检查只提交一次且桌面/手机对象一致。分别检查完成、失败、打断及明确支持的 Relay 审批；不把 Relay 审批视为 Desktop 原窗口审批。
4. 在输出中切 Wi-Fi/移动网络、断网后恢复、后台停留后回前台，确认正文与草稿保留、推送恢复且没有重复提交。锁屏及系统字体放大时检查输入栏和键盘。
5. Mac 保持在线时退出一个受监督子进程并观察恢复，再做睡眠/唤醒。深度睡眠、关机或离线期间不保证即时控制。自启仅在用户决定启用后执行 `bash scripts/mac-autostart.sh install '/绝对路径/Mobile Codex Relay.app'`；卸载用 `uninstall`。
6. 使用管理员凭证查看/撤销测试手机，确认旧手机 API 和已建立的 SSE 立即失效。手机凭证只可查看/撤销自身，不能管理其他设备。
7. 最后安排 30 分钟持续输出与 24 小时在线观察：记录恢复耗时、RSS、CPU、手机电量和异常日志。Windows 单列平台验收，不以 Mac 编译结果替代。

未执行以上真实模型/控制/安装、网络切换、睡眠唤醒、Windows 与长时间测试，因此父任务及相关子任务仍保留平台验收待办。

## 发布与回滚

执行发布命令会访问配置的远端主机；APK/HTML 发布脚本本轮仅做本地隔离检查，没有执行手机包发布。已授权的 Broker 部署单独记录在 [连接修复记录](connection-repair.md)。先升级 Broker，再升级 Tunnel/Relay，最后安装新 APK。旧组合保留普通响应兼容，SSE 贯通需要两侧更新。

APK/HTML 发布共用 `scripts/upload-release-atomically.sh`：临时上传、远端 SHA/大小复核、发布锁、带 hash 的不可变产物文件名，最后原子切换 `latest.json`，同时保留 `previous.json`。

发布端回退应在同一目录、持有 `.publish-lock` 时，把 `previous.json` 复制到新的临时文件，检查 JSON、所指产物 SHA/大小和原生兼容范围后，原子 `mv` 成 `latest.json`；不要覆盖产物文件，也不要在发布过程中清理引用的版本。此操作只回退分发指针，不会卸载已安装版本。热更新在 App 设置中可回退；Android 通常拒绝低 versionCode 覆盖，应以更高 versionCode 重发旧版功能，避免为降级卸载丢失数据。生产回滚演练仍待执行。

## 仍保留的实现限制

- 幂等去重是单进程内 24 小时/1000 条有界记录，不保证跨重启或多实例 exactly-once。
- 上传仍是 base64 JSON；已限制设备/全局并发并校验内容，尚未实现流式上传。不能将 HTTP/SSE 分块转发描述成文件流式上传。
- 配对/设备/上传均有固定边界，当前单 Relay 不引入数据库、Redis 或多 Broker。
- 原生凭证加密、Mac 监督及权限等已编译并有适用的隔离检查，实际平台行为仍以真机记录为准。
