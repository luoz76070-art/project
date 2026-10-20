# 手机工作状态修复

日期：2026-10-20。用户确认会话记录已同步，本轮仅修复手机看不到 Codex 工作过程的问题。

## 已实现

- 进入已经运行的会话即恢复运行状态，显示“正在思考”“Codex 正在工作”“正在输出”。
- 工具操作期间没有新正文，工作提示仍可见；空正文会话也能展示状态。
- task_complete/task_completed、turn_aborted、task_failed/turn_failed 等显式终态停止提示；普通助手段落不代表完成，没有助手正文也不阻止结束。
- 基线/增量使用同一状态解析；仅新增可选 turnStatus/activity 字段。保持原消息读取、历史分页、列表和发送目标。
- 沿用原 JSONL→SSE→Broker 推送，服务端 500 ms 检查日志增量；未添加会话列表轮询或新依赖。不展示隐藏推理原文与工具参数。

当前桌面 IPC socket 不存在，因此正文需等 Desktop 写入日志后同步。这次实现真实工作阶段提示与已落盘正文增量，不保证逐 token 输出。初始生命周期恢复扫描上限 8 MiB；超过预算且无标记时不凭空判定运行状态。

## 构建与验证

- 新包：`dist-apk/mobile-codex-1.2.1-live-status-debug.apk`，versionCode **17**，**4,020,874 bytes**。
- SHA-256：`8984487649f0c0a1fa0bd0b787b798fed1aa88f87ab6929af090eae9459afce1`。
- 与本地 APK 16 的 applicationId 和签名证书一致，versionCode 递增，支持覆盖安装并保留应用数据；手机实际安装仍待验收。
- APK 内 3 个 Web 资源逐字节等于最终 Vite 输出；JS 289.95 kB / gzip 92.27 kB，CSS 36.46 kB / gzip 7.40 kB。
- 后端 **43/43**：包含纯状态解析、长工具日志后打开、HTTP 基线到 JSONL SSE 的思考/工作/输出/完成回归；使用合成日志与临时目录，不访问真实会话或发送模型任务。
- 客户端 **16/16**、消息回归、两端 typecheck、Relay/Vite build、Capacitor sync、Android assembleDebug 均通过。仓库没有独立 lint 命令；保留已有 Gradle 配置/弃用警告。
- 浏览器：390 px 检查思考→工作→输出→完成；B 档案空正文运行中首次进入可见状态，完成后移除状态；重载可恢复状态，草稿未发送。360/430 px 无整页横向溢出，补充深色主题检查。
- 合成画面：`output/ui-status/2026-10-20/`。机器可读结果：`work-status-evidence.json`。

## 运行环境

通过现有 Mac Relay App 的 Stop/Start 切换本次 Relay dist；保留配置与凭证，没有再次部署 Broker、发布 APK 或注册自启。

真实只读检查：本地与公网连接/会话接口均 HTTP 200，当前正在执行的会话均返回 `turnStatus=inProgress`、`activity=working`。记录仅含状态、计数与耗时，不保存会话正文或凭证；未提交模型任务或 Desktop 输入。

## 手机验收

1. 覆盖安装 APK 17，设置中核对 `v1.2.1-live-status`，保留原公网 Endpoint 与凭证。若启用了旧热更新且仍显示旧版本，可在版本与更新中清除热更新以使用安装包资源，勿卸载或清除应用数据。
2. 手机切到移动网络，打开正在工作的同一会话；检查工具无正文阶段仍显示工作提示，正文到达时同步，真实结束后停止提示。
3. 会话运行期间后台/返回、短暂断网/恢复，检查状态恢复、草稿保留且不重复发送。

以上手机、系统键盘、移动网络及真实模型完整生命周期尚未实测。任务保留平台验收待办。
