# A2 设计与改动边界

- 手机工作区按已应用的连接身份挂载；设置输入是草稿，保存/选档案才替换工作区。缓存与草稿按连接隔离。旧工作区卸载即中止浏览器请求，原生请求返回后核对取消状态。
- 订阅共用可恢复 SSE 生命周期：每次重连取新短令牌；指数退避、心跳截止、前后台与 online 恢复；401 停止自动重试。保留轮询降级。
- JSONL 以 UTF-8 完整换行的字节位置推进；长记录有界扩窗；generation/reset 修复截断或轮换。后续历史分页复用同一窗口读取器。
- app-server 初始化使用一个共享 Promise，在初始化完成后才发布客户端；断链失效，停止期间禁止发布旧客户端。
- 热更新版本及 canonicalPath 统一校验，禁止安装覆盖 active/previous；所有删除受根目录边界限制。
- Desktop 来源始终发到 Desktop，不因错误静默转到 Relay；请求携带 clientMessageId，服务端有界去重并校验相同 ID 的请求内容。
- 更新已公告的运行时依赖，构建工具移到 devDependencies，逐项记录实际公告与版本。

修改范围：mobile connection/chat/app、relay store/codex/server、Android HotUpdate、包清单及隔离测试。保留现有入口，不部署、不触发真实 Desktop 输入或模型任务。
