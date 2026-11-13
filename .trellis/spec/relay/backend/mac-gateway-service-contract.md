# 原生网关macOS后台托管契约

## 1. 范围与触发

P2/C的可选LaunchAgent，只托管原生单网关，不启动Agent模型或恢复会话。用户明确调用service install才写登录项/加载job；普通插件安装、help、status、pair和start不能隐式注册。源码/隔离检查不接触真实LaunchAgents或launchd注册，真实登录、异常恢复与睡眠唤醒单列验收。

## 2. 入口与签名

- `gateway/macService.ts`：`MacGatewayService({home?,platform?,uid?,nodePath?,run?})`。默认普通macOS当前用户，测试注入临时HOME、UID和合成LaunchctlRunner；runner接收argv数组，返回`{code,stdout,stderr}`。
- `registered(configFile)`：普通start只检查自有文件，非macOS/root返回false，不创建文件/运行launchctl；另一配置不自动认领。
- `status(configFile)`：只读`{installed,loaded,label,restartOnFailure}`，明确区分注册和运行健康。
- `install(configFile,config,entryFile)`、`start(configFile)`、`uninstall(configFile)`：用户级注册/加载/卸载。CLI的`service install|status|uninstall --config <file>`调用相应接口；普通start识别已注册服务，普通stop保留原instance绑定HTTP。
- `runGatewayCli(args,entryFile,{macService?})`支持隔离注入；生产主入口不注入，不能通过CLI指定launchctl路径。

## 3. 文件与执行契约

每用户label固定为`local.mobile-codex.gateway`，只操作`gui/<uid>`，不使用sudo。程序复制到`~/Library/Application Support/Mobile Codex Gateway/service/gateway-<sha256>.mjs`，receipt为同目录registration.json，plist位于`~/Library/LaunchAgents/<label>.plist`。receipt严格为`{version:1,label,configFile,nodePath,workspace,bundleSha256}`，路径绝对/无XML控制字符，SHA为64位hex。plist/receipt权限0600，service目录0700；read拒绝符号链接/非普通文件、非私有权限、64KiB以上元数据和4MiB以上bundle。固定程序需hash匹配；entryFile要求构建包的gateway.mjs，单文件可在插件目录消失后运行。

plist argv精确为`[node绝对路径,固定bundle,"daemon","--config",配置绝对路径]`，不含Token，不通过shell执行。WorkingDirectory为安装时workspace，只显式设置HOME与最小PATH；标准输出/错误丢弃，不创建无限日志。RunAtLoad=true、KeepAlive={SuccessfulExit:false}、ThrottleInterval=15、LimitLoadToSessionType=Aqua。正常daemon停止退出0，下一次start使用kickstart（无-k）；job未加载则bootstrap，不改已运行其他进程。

操作使用私有operation.lock目录串行，原子create-if-absent写receipt/plist。安装时先拒绝已有旧`local.mobile-codex.relay.plist`、未知同label job及已运行普通网关。显式launchctl使用绝对/bin/launchctl、8秒截止、256KiB输出上限、C locale；仅print退出113且含Could not find service可判未加载，其他失败/超时为unknown。安装激活失败保留精确注册；卸载只在确认job移除后删除自己的receipt/plist，不删配置、设备、附件或固定程序。遗留operation.lock不自动抢占；先核实无进行中操作再人工恢复。

## 4. 校验与错误矩阵

均为`GATEWAY_`前缀稳定码，不返回系统stderr或文件原文。

| 场景 | 错误/行为 |
| --- | --- |
| 非macOS、root、无用户UID | SERVICE_UNSUPPORTED；无系统写入 |
| 旧Relay登录项/已运行普通网关 | LEGACY_AUTOSTART_PRESENT / SERVICE_GATEWAY_RUNNING；先显式安排迁移 |
| 已安装/另一配置/记录不一致 | SERVICE_ALREADY_INSTALLED / SERVICE_CONFIG_MISMATCH / SERVICE_CONFLICT |
| 权限、SHA、文件类型不符 | SERVICE_FILES_INVALID，不接管/卸载 |
| 并发操作或遗留锁 | SERVICE_BUSY |
| print不能确定状态/launchctl超时 | SERVICE_STATUS_UNKNOWN / SERVICE_REQUEST_UNKNOWN，不视作不存在 |
| 非独立bundle/Node丢失 | SERVICE_BUNDLE_REQUIRED / SERVICE_RUNTIME_MISSING |
| 激活失败/激活后HTTP未就绪 | SERVICE_ACTIVATION_FAILED / SERVICE_NOT_READY，保留记录，不回退detached |
| 卸载未确认 | SERVICE_STOP_UNCONFIRMED，保留文件 |

service status/uninstall不依赖gateway.json可解析，所以配置损坏时仍可按receipt管理自有job。Node路径变化或升级固定程序需显式卸载后重装；插件升级不会隐式替换后台代码。loaded=true不代表本地HTTP或Tunnel在线，普通status继续核验后两者。

## 5. 正常、基线与失败路径

正常：同配置普通stop → 用户显式service install → 固定bundle/bootstrap → 本地HTTP就绪 → 普通stop退出0 → 普通start走kickstart → 显式service uninstall。

基线：无注册时start保留原detached行为；非macOS普通start仍可用。已有旧App登录项时安装明确失败，旧项和原网关保持。

失败：bootstrap未知时保留记录，service status核验后显式start或uninstall；拒绝直接改为第二个detached进程。卸载只删除已核对内容的自有文件，保留凭证。

## 6. 验证

`corepack pnpm test:managed-gateway`构建Relay+独立插件，运行managedGateway及macGatewayService两组。后者覆盖临时HOME/权限/原子并发、XML转义/实际plutil解析、旧登录项/未知label/其他配置/文件改动拒绝、状态未知/激活失败/卸载失败、Node丢失/损坏配置仍可卸载、固定程序在插件删除后运行、真实合成网关正常退出0、普通start使用注入的kickstart与停止/卸载。所有launchctl注册/移除均由合成runner应答，不将这些断言称作真实launchd恢复验收。

## 7. 错误与正确做法

- 错误：KeepAlive=true让用户正常stop后立刻复活；正确：SuccessfulExit=false，验证daemon正常退出0，再使用start唤起。
- 错误：指向会被更新清理的插件缓存或把Token放进argv；正确：固定hash程序，配置仍只读原0600文件。
- 错误：所有print非0都当作未安装；正确：仅接受实测的missing-service响应，unknown不继续接管。
- 错误：真实HOME下运行默认服务测试；正确：临时HOME+注入执行器，plutil只解析临时文件。
