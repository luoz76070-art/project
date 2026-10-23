# 输入区点击修复与Codex运行中排队

日期：2026-10-23（Asia/Shanghai）。APK28 `1.3.7-composer-queue-preview`及配套固定网关已发布；preview28/previous27，正式18/hot保持。手机可在“设置 → 版本与更新 → 检查更新 → 下载并安装”覆盖升级。

## 用户可见变化

- Codex与Agent麦克风改为发送旁44×44px独立按钮；语音弹层只在点击麦克风后挂载。最新消息按footer实际高度置于输入区上方，不再使用固定bottom与语音入口叠放。
- Codex原生任务运行中可选“引导当前任务”或“排队，结束后执行”，默认排队；两者分别使用steer与网关FIFO。待发可展开全文/取消，不提前插入已执行气泡。
- 手机离开会话仍持有网关订阅，当前任务正常完成且权威空闲后依次以原会话start执行；中断/失败暂停待发，可取消后重新编辑。每线程最多8条，活动总数最多32条。
- 断线等待、不重放未知提交；私有队列保存于工作区`.mobile-codex/desktop-queue.json`，重启sending恢复为uncertain，权威客户端消息ID确认才解锁。撤销取消未发，不能抹除未知屏障；新增回归覆盖这一重启边界。

## 实现与限制

当前桌面提取产物app-initial-90eb42395b7d.js中的`thread-follower-set-queued-follow-ups-state` v1调用acceptFromFollower，整批替换队列，未找到安全append/初始读取契约。因此本轮采用独立网关队列，不修改桌面原生队列，也不出现在桌面原生待发列表；不承诺与电脑待发的全局顺序。既有宿主start无原子expectedTurnId条件，发送前两次本地校验仍不能消除宿主竞态。

普通queue HTTP确认仅表示网关保存；派发仍复用DesktopNativeControl的epoch/turn/owner与未知结果保护。幂等墓碑有界且保留24小时，不提供无限期exactly-once。存储不可用则停止派发；不能用新ID绕过同线程未知屏障。队列状态只通过实时control.queue显示，不把旧控制能力存到手机缓存。

## 隔离与浏览器验证

- 完整后端352/352，队列与原生控制38/38，独立插件/后台网关30/30；手机53/53，消息合并、两端typecheck/build、插件构建、APK更新5/5通过。单元/HTTP/socket均使用合成数据、临时目录，不读取真实会话、不提交模型任务。
- 覆盖FIFO、guard、同会话start、手机unfollow仍等待、取消/幂等/鉴权、断线与未知、重启持久化、设备撤销、容量/坏存储及默认HTTP工厂接线。手机覆盖queue匹配ID清理pending且保留新草稿/任务生命周期、近期列表保留待发会话。
- 实际浏览器合成检查：返回最新不打开语音且保留草稿；麦克风正确开关弹层；上传合成文件、移除附件、停止、排队/引导与取消分别走对应handler。排队计数变化而不触发native steer，选择引导后才触发steer。Agent的麦克风与发送也独立命中。
- 360/390/430px下检查最新/输入/选择器/取消及顶栏按钮中心与四边中点，均命中自身，无横向溢出或矩形重叠；390px/150%字号下待发、多行草稿与最新按钮中心命中通过。浅深主题检查通过，控制台无warn/error。截图、layout JSON和日志保存在`output/audit/2026-10-23/composer-queue/`，不是Android真机证据。
- Android完整lint 0错误/8项既有警告；APK4,063,253字节，SHA256 `c3b6aa6c802db513d7e88d10bf904cf7097c71ed6a3bcdc2bb33b21a9b13f875`。与27同签名，4个dist资源逐字节一致，录音/安装权限、语音插件、preview源及本轮代码已核验。

## 运行切换与发布

新固定入口：`/Users/rorance/Library/Application Support/Mobile Codex Gateway/releases/2026-10-23-composer-queue-a4037a224ad8/mobile-codex/lib/gateway.mjs`，SHA256 `a4037a224ad8cbefc305904fc0ac9f6c287850a2f26cf647b6de73ef95c0d1db`。旧PID1505在stop后131ms自然退出，再启动PID5585，instanceId `6059871a-d946-4282-9958-9ad07edadefb`，Tunnel connected；未重载Harness桥接，未启用自启动，不能以一次退出成功宣称长期残留已根治。

84项本地/公网健康、17项两Agent首帧/重连及队列能力检查通过；配置、设备、语音凭证与Harness profile/插件哈希、原Harness PID68334/68372保持。真实环境只读取会话/能力，没有发送任务或决定审批。公网完整下载逐字节/SHA/大小/CORS/Content-Length、preview28/previous27及正式/hot保持共15项通过。

私有备份：`/Users/rorance/workspace/backups/codex-to-phone/2026-10-23-composer-queue-20261022T192751Z`。回退先核对配置/设备/Key后续变化，按当前instance正常停止并确认PID和端口均释放，再启动原固定程序；不能覆盖后来填写的Key或设备。此次prepare/switch绑定本轮state，不直接重复运行。复用既有原子发布脚本/SSH配置，不需要聊天提供登录信息。

交付目录：`output/delivery/2026-10-23/composer-queue-preview/`。APK28手机安装、真实触摸/键盘/后台及Codex排队自动续发仍待用户设备验收；真实供应商/录音效果未测试，旧DeepSeek追加sleep联测继续暂停。未暂存/提交/推送/建分支或PR，任务继续in_progress。
