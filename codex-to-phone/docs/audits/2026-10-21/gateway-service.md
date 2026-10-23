# 原生网关可选macOS后台托管（2026-10-21）

原生插件网关此前只由CLI创建detached进程，退出后需手动start；旧mac-autostart.sh只启动Swift Relay App。本轮为原优化计划C“随时接入/进程监督”补齐可选用户级LaunchAgent入口，不在本轮注册实际登录项。

Mobile Codex插件版本升为0.2.0，提供`service install/status/uninstall`。普通start识别已注册服务后调用launchctl bootstrap/kickstart；普通stop仍是带管理员密钥和instanceId的HTTP停止，不使用PID或全局kill。默认start及插件安装保持普通后台方式，显式service install才复制固定程序和加载job。

固定程序保存在私有service目录，以SHA-256命名，并由receipt绑定原config路径、Node绝对路径及workspace。plist/receipt均0600，配置和设备文件继续读原位置；已删除插件缓存不影响这份固定代码。每用户固定label，旧Relay App登录项、未知同label或其他配置不会被接管；写入原子且通过操作锁串行。launchctl未知失败保留记录，不回退创建另一个detached网关。Node路径需要继续可执行；更换Node或升级固定程序时显式卸载后重装。

LaunchAgent采用RunAtLoad=true、KeepAlive={SuccessfulExit:false}和15秒ThrottleInterval：登录启动、异常退出恢复，正常stop退出0后保持停止。service status中的installed/loaded和普通status的running/tunnel分别表示注册、系统加载、本机网关及公网连接，不能互相替代。标准输出/错误不写持续文件，避免无限日志；诊断和迁移命令见[插件操作说明](../../../plugins/mobile-codex/README.md)。

本轮验证：

- `corepack pnpm test:managed-gateway`：26/26，其中原网关10项、新托管16项。所有launchctl注册/移除由合成runner应答，HOME/工作目录/Codex路径全部临时；测试最终清理。
- 原生网关实际在临时独立目录运行，插件源目录删除后固定程序仍能启动；原instance stop以及合成bootout的SIGTERM均使daemon正常退出0，再start走合成kickstart并取得新网关instance。没有真实Codex/model请求。
- 本机`/usr/bin/plutil`实际解析临时XML，精确核对argv、特殊字符路径、HOME/PATH及恢复策略。
- 冲突、私有权限、SHA/符号链接/元数据修改、并发安装、未知状态、激活/卸载失败、Node丢失及损坏config仍可卸载等路径通过；失败不覆盖原配置或清理未知服务。
- Relay类型/构建、独立插件构建、技能quick_validate、manifest版本/入口核对及git diff --check通过。初始Python缺PyYAML，随后仅在临时依赖目录运行原validator并清理，没有改用户Python。
- 无手机源码或接口DTO变更，未重打APK或重复UI检查；没有实际launchd登录/异常恢复/唤醒测试，不能以合成runner行为证明系统恢复已验收。

测试日志：`output/audit/2026-10-21/gateway-service-regression.tap`。仅对确定不存在的合成label执行过真实只读launchctl print，得到113及Could not find service，用来固定“未加载”识别；记录为`gateway-launchctl-missing-probe.json`。本机Apple手册摘录在`output/research/2026-10-21/{launchctl,launchd.plist}.man.txt`；参考Apple《Creating Launch Daemons and Agents》，行为以当前系统实测为准。

独立本地候选：

`output/delivery/2026-10-21/gateway-service-preview/mobile-codex-agent-plugins-gateway-service-0.2.0-preview.zip`

- 345,445字节，18文件，SHA-256 `6b651a1ad2a40a9406a7da7e767de42e5bec2d8bbf60564c3f57d3d71451fd3e`。
- 含Codex插件0.2.0、Claude/DeepSeek0.1.1及上一轮OpenCode游标修复；相对上一候选只有Codex README、skill、manifest和gateway bundle四文件变化。
- ZIP逐文件与构建核对，无测试fixture。网关bundle为1,167,432字节，相比上轮增加10,786字节；无新增运行依赖。
- 未发布、安装或切换运行网关。APK21、旧Mac App/权限与当前固定网关保持；详情见同目录manifest.json。

真实验收在用户明确启用后按顺序进行：停止普通网关 → 安装托管并核对本地/公网健康 → 正常stop后确认保持停止 → start恢复 → 专门安排自有网关崩溃恢复与重新登录 → 卸载并确认配置/设备保留。关机、深度休眠或离线不能即时控制；Android、用户原会话和长期测试仍分别待办，长期测试继续暂缓。整体目标及Trellis任务保持in_progress。
