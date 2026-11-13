# 插件管理网关契约

## 1. 范围

P2为插件提供管理入口，一个Node进程复用Relay和Tunnel。插件加载/status不连接Codex或启动模型；不修改生产App、系统权限或用户Codex目录。managed模式仅native，不能声明真实同会话控制已验证。

## 2. 入口与签名

- `gateway/config.ts`：`initializeGateway(file,{workspace,codexHome,port?,importLegacy?})`、`readManagedConfig`、`parseManagedConfig`、`pairingEndpoint`。
- `startManagedGateway(config)` → `{app,snapshot,stop,done}`；端口bind成功后才startTunnel。失败须关闭自己的工厂实例。
- `runGatewayCli(args,entryFile)`：init/start/status/stop/pair/devices/revoke；daemon仅后台入口。所有结果JSON，错误稳定码，非零退出。
- 可选`service install/status/uninstall`及普通start对已注册服务的识别遵循[macOS后台托管契约](mac-gateway-service-contract.md)。默认不注册，用户明确启用后才使用固定bundle与LaunchAgent；正常stop保持停止。
- Codex根plugin.json的extensions.com.openai.requires_local_executor必须为true；该技能只能管理本机网关，不把远端执行环境当成原电脑。Codex捆绑CLI没有validate子命令，元数据/独立包检查与真实安装分开记录。
- `corepack pnpm build:plugin`：源码 `plugins/mobile-codex/` → `dist-plugin/mobile-codex/`，含独立ESM Node bundle、技能、manifest和许可证；另生成本地marketplace。

## 3. 文件、API与资源

配置严格为 `{version:1,port,token,managerKey,workspace,codexHome,desktopTransport:"native",tunnel?,publicEndpoint?}`。token/key至少32字符；workspace/codexHome绝对路径；端口1–65535。配置0600、目录0700，临时文件+link创建，不覆盖已有文件；错误不能带原文。导入旧配置需显式参数，workspace沿用旧工程，设备仍在workspace/.mobile-codex/devices.json。公网只接受TLS；URL禁止userinfo/query/hash；loopback允许HTTP/WS。

P3另支持可选opencode、claude及deepseek私有配置，分别遵循对应adapter契约；桥接密钥独立于手机token/managerKey，不能返回到状态/配对结果。DeepSeek密钥还须区别于Claude密钥。

固定127.0.0.1和配置端口是实例排他范围。CLI先认证查询 `/api/gateway`，未知服务占用时不spawn/不kill。并发start可能短暂spawn多个候选，但只有listen成功者才能连接Broker。后台进程不在插件cache中保存凭证；重启不保证写操作幂等。

- `GET /api/gateway`：管理员/有效设备，返回 `{gateway:{kind:"mobile-codex-gateway",version:1,instanceId,startedAt,desktopTransport:"native",sameDesktopThreadVerified:false,tunnel:{enabled,state},endpoint}}`；不含密钥、路径或会话数据。旧工厂没有该路由。
- `POST /api/gateway/stop`：管理员+loopback+header `x-mobile-codex-manager-key`；body严格 `{instanceId:UUID}`，匹配才202。延后停止，先取消Tunnel转发请求，再关闭HTTP和所有持有资源。禁止PID kill/全局pkill。
- HTTP关闭的`preClose`须销毁下游SSE并停止统一AgentGateway，取消全部适配器仍在等待info响应头、首帧或活动流的请求；不能推迟到`onClose`，否则等待`watchSession`的路由与HTTP排空形成循环等待。其余存储/Desktop/live资源仍由`onClose`释放，不另行重复停止Claude。
- stop的202只证明已接纳；端口空闲和`done`也不能单独证明daemon自然退出。更新时分别确认原实例PID退出、端口释放及新实例Tunnel连接；失败记录与恢复记录分别保存，不覆盖原始失败，不对生产进程强退或停止上游宿主。
- 管理CLI使用 `http.request({agent:false})`，每次新socket、1.5秒截止、响应上限64KiB、不跟随重定向、不重试写入。start/stop只有被动状态轮询，遇瞬时未知连接状态继续等待，绝不能将ECONNRESET当已退出。
- `startTunnel(config,{onState?,log?})`保留旧入口兼容；状态connecting/connected/reconnecting/stopped；managed关闭原始传输日志，仅输出稳定错误码。
- `pair`仅在配置了Tunnel且已连接时生成五分钟一次性JSON；复用原配对/撤销接口。手机仅用户点击后查询gateway/agents，404显示旧服务提示，切换连接废弃迟到结果，不自动probe或缓存能力。

## 4. 错误矩阵

| 条件 | 结果 |
| --- | --- |
| 配置不存在/已存在 | GATEWAY_NOT_INITIALIZED / GATEWAY_ALREADY_INITIALIZED |
| 配置格式/权限/URL错误 | GATEWAY_CONFIG_INVALID / CONFIG_PERMISSIONS / URL_INVALID（均带GATEWAY_前缀） |
| 未核验端口/旧或未知服务 | GATEWAY_PORT_UNVERIFIED / PORT_OCCUPIED，不启动 |
| 非管理员/缺少key/非本机停止 | HTTP403 gateway_manager_required |
| instance不一致 | HTTP409 gateway_instance_changed |
| 公网未配置/未连接 | GATEWAY_REMOTE_NOT_CONFIGURED / REMOTE_OFFLINE |
| 写入回包丢失/无法确认停止 | GATEWAY_REQUEST_UNCERTAIN / STOP_UNCONFIRMED，不重放 |

## 5. 正常与失败路径

正常：显式init → status(false) → start成功bind → Tunnel连接 → pair → 手机consume → devices/revoke → instance停止。基线：旧Relay仍占8787，start报占用，旧进程继续运行。异常：并发start仅一个Broker连接；stop旧instance不能影响新instance；未知状态持续至截止则失败。

## 6. 验证

`test:managed-gateway`构建Relay和插件，临时目录/随机端口验证配置权限与并发创建、显式迁移保留设备、TLS与脱敏、被动无会话访问、端口排他、精确stop权限、断线状态、未知/重定向/超限响应、独立目录下四CLI并发启动和配对/撤销/停止。插件manifest对官方schema验证、skill quick_validate另记证据；不得在测试中实际安装插件或启动真实Codex。

退出回归另覆盖默认DeepSeek适配器的info响应头等待、SSE首帧等待与活动流：stop不等待上游超时、并发stop复用同一Promise、释放上游连接但保留宿主监听、同端口可重新启动。复制独立bundle的daemon用例必须检查自然退出码0/无信号，不能仅断言端口释放；失败强退仅限测试自建child，不读取生产配置或连接真实Harness。实际固定网关的短时只读订阅/自然退出/重启另行记录。

## 7. 常见错误

- 错误：用fetch共享池检查刚停止的服务，将旧socket的ECONNRESET当已停止或未核验失败；正确：管理请求新socket，退出后仍可能短暂reset，stop只对被动状态等待，写操作不重放。
- 错误：无body的POST强加application/json，Fastify返回空JSON错误；正确：只有实际body时发送类型头；配对测试必须先校验token存在，不能让undefined回落管理员凭证造成假通过。
- 错误：只在monorepo里跑插件CLI；正确：复制到没有node_modules/源码的临时目录运行完整生命周期。
