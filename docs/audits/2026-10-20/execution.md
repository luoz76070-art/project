# 首批优化执行记录

日期：2026-10-20。范围：用户要求先用 Trellis 整理全项目布局，然后开始执行优化计划。本记录区分修复前审核结果与本轮源码变更。

## 已完成

| 工作包 | 源码结果 | 验证 |
| --- | --- | --- |
| 工程布局 | Trellis 包规范、优化任务树、关闭自动 Git；前端按功能拆分；后端按职责迁移；Node/SEA 共享服务工厂；保留原启动和打包入口 | 121 个前端顶层函数体逐一比对不变；消息合并模块内容不变；类型检查、构建、消息回归和脚本路径检查通过 |
| F01 公网流 | start/chunk/end 转发；base64 保持响应字节；不等待整个 SSE 结束 | 首块在 1 秒内可读；含心跳流超过测试截止预算仍保持；普通 JSON/二进制正常 |
| F02 SSE/CORS | Fastify stream reply 统一 CORS 与关闭清理，两类 SSE 共用生命周期 | Desktop/turn 两条流的 Origin、错误 token 和监听器释放通过合成服务检查 |
| F03 传输恢复 | 双端 ping/pong、握手截止、抖动退避；断链在途请求清理，连接代次隔离 | 明确断链 700 ms 内返回 503；双端失活检测、Broker 重启与 Tunnel 恢复通过；发送请求未被重放 |
| F19 传输部分 | 取消透传、逐块 ACK、并发/缓冲边界 | 手机取消到本地 fetch；慢端不阻塞独立请求；32 在途后新请求返回 503；期限到达释放本地工作 |
| F25 入口部分 | 去掉 server/serverExe 重复路由；构建前清理旧生成模块 | CommonJS 打包可完成；仍存在 import.meta 编译警告，Windows 路径通过平台分支避免执行 macOS 资源定位，Windows 实机未测 |

本次也校正了移动后 macOS helper 的资源相对路径，已验证 status 返回的 helper 路径正确；未执行辅助功能输入。

## 检查汇总

- `corepack pnpm typecheck`：通过。
- `corepack pnpm test:messages`：通过。
- `corepack pnpm test:codex-executable`：通过，仅探测可执行文件。
- `corepack pnpm test:transport`：14/14 通过，约 5 秒；使用随机端口与合成服务。
- `corepack pnpm build`：通过；Relay 构建会先清理本包 dist，避免旧路径掩盖遗漏。
- 前端构建：JS 275.66 → 275.68 kB；gzip 87.92 → 87.63 kB；CSS 保持 29.35 kB / gzip 6.18 kB。本轮未增加依赖。体积变化不代表 APK、内存或功耗测量。
- 浏览器空配置/鉴权失败状态：桌面视图及 360/390/430 CSS px 正常呈现，页面 scrollWidth 等于视口宽度，无控制台 error。未连接真实会话，不代表已验收聊天、发送、键盘或前后台恢复。
- 源码与文档差异检查、Trellis context 校验与模块路径检查见任务归档记录。

## 未完成与下一批

A2 继续修 F04/F05 手机订阅恢复与档案隔离、F06/F07 JSONL 边界、F08 更新路径、F09 初始化、F11 依赖、F21 发送语义。F19 的设备级限额/上传与 F25 的后续状态编排整理仍待推进。性能、常驻/配对与 Codex 手机版 UI 保留独立任务，不把本轮结果扩大为全计划验收通过。

尚未执行真实模型 turn、Desktop 发送、Android 真机、Mac 睡眠唤醒、Windows 实机、线上压力或 24 h 测试。没有暂存、提交、推送或部署。升级运行环境时应先更新 Broker 再更新 Tunnel；只更新一侧仍可兼容普通旧响应，不保证 SSE 贯通。

源码导览见 [工程布局](../../project-layout.md)，任务进度见 `.trellis/tasks/` 与 `.trellis/workspace/rorance/`。

## A2 续执行（2026-10-20）

- JSONL 完整字节游标、8 MiB 有界扩窗、generation/reset、稳定记录 ID；不再把任意助手文本当作结束事件。
- app-server 等待同一初始化 Promise，就绪后发布，断线失效并终止未完成状态；停止期间不会发布旧客户端。
- 已应用连接独立工作区；设置输入为草稿，保存或切档案才替换；缓存/草稿按连接隔离，旧工作区请求取消（原生 HTTP 不支持物理取消，返回后丢弃）。
- SSE 每次重连取新 token，带退避、45 秒心跳截止、前后台/online 恢复；401 停止自动重试。桌面流补传 JSONL delta，正常推送时暂停手机日志轮询。
- Desktop 发送不再静默退到 Relay；发送/引导附带 clientMessageId，服务端保留成功与不确定结果并去重。去重为单进程内 24 h、1000 条有界记录，重启/多实例持久去重尚未实现，不承诺跨重启 exactly-once。
- 热更新统一版本/canonicalPath 边界，拒绝覆盖 active/previous，确认后保留两份；Java 路径/符号链接/删除测试通过。完整原生安装仍待验收。
- Capacitor core/android/cli 7.6.9、Fastify 5.12.7、ws 8.22.0、Vite 7.3.7、React plugin 5.2.0；构建工具移至 devDependencies，更新兼容的传递依赖。`pnpm audit --prod --json` 当前所有级别为 0。
- 新增后端正确性 10/10、手机订阅/缓存 5/5、原生 Java 路径检查通过；原传输 14/14、消息回归、typecheck 和前端构建通过。
- 浏览器合成 A/B 使用相同 threadId：切到 B 无 A 草稿，切回 A 草稿恢复；强制关闭 SSE 后 1.8 秒观察到新 token/新订阅，B 请求计数保持不变；控制台无 error。未使用真实 Desktop 或模型。
- 当前 gzip JS 88.83 kB（首批 87.63 kB），新增状态恢复及版本更新带来约 1.2 kB；后续性能与 UI 完成后再测。

## A2/B/C/D 源码收尾（2026-10-20）

本轮源码和隔离检查完成，统一真机实测尚未执行。最新结果及操作步骤以 [交付与统一实测](delivery.md) 和 `optimized-evidence.json` 为准，上述首批数字保留历史，不作为当前版本数据。

- 索引/摘要缓存、历史分页/全量搜索、增量 patch/seq、状态回收、输入/上传/流有界、缓存首屏及写合并完成；热索引合成 p95 为 7 ms，69.36 秒稳定 SSE 无业务轮询。
- 串行输入、helper 独立目录与子进程终止、未知结果禁止重发；Mac 进程监督/唤醒检查、日志权限/轮转、自启入口完成，未注册自启。
- 一次配对、设备哈希持久化/撤销、鉴权前移、日志脱敏、原生 Keystore 迁移及 HTTPS 约束完成。发布脚本已共用原子上传/激活，回滚说明见交付文档。
- Codex 手机版真实画面基线及 UI 完成；360/390/430 浅深、150% 字号、缓存离线首屏、搜索/分页和历史新消息阅读位置通过合成浏览器检查。
- 后端 39/39、客户端/发布 15/15、消息和 Java 热更新路径测试、typecheck、两端生产构建、Swift 编译与完整 APK 构建通过；本次依赖审计 0 条公告。`readThreadWithCursor` 已保留完整历史语义，8 MiB 仅用于有界读窗，不能静默截断全历史。
- Android 升至 `1.2.0-optimization` / versionCode 16。Keystore 插件和 Capacitor 原生升级要求安装新版 APK；构建/工具安装脚本同步 JDK 21+，本机 JDK 25 构建成功。

没有部署、发布或实际发送。真机、Windows、睡眠恢复及 30 分钟/24 小时资源测量仍待办；上传仍 base64，幂等不跨重启，不宣称已经消除全部平台风险。

## 已授权的公网连接修复（2026-10-20）

上述“没有部署”描述源码收尾时状态。用户首次手机连接失败后明确授权线上修复，现已完成有效 TLS 证书签发/切换、续期 timer/hook 与 dry-run、新 Broker 独立发布目录部署，以及旧 Mac App 停止和当前优化 App 启动。公网鉴权 200、无 Token 401、Android Origin 预检 204，Broker 在线数 1，Mac 显示 Remote reachable。没有发布 APK 或执行真实发送。

根因、运行版本、验证边界与回退点见 [连接修复记录](connection-repair.md)。手机重试、真实控制、睡眠及长期运行验收继续保留待办。
