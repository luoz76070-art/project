# 第三方DeepSeek地址与助手重复显示修复

日期：2026-10-23（Asia/Shanghai）。沿既有语音预览交付继续优化；源码、隔离测试、运行切换与公网发布分别记录。

## 用户可见结果

APK27 `1.3.6-voice-url-preview` 已发布preview，previous逐字节保存26；正式18/hot保持。APK24及以后使用原preview源，可在“设置 → 版本与更新 → 检查更新 → 下载并安装”覆盖升级，原连接保留。

“设置 → 语音与提示词”新增DeepSeek API地址和模型名称。填写服务商的HTTPS Base URL（支持/v1、尾斜杠或完整/chat/completions）及其模型ID/Key。修改地址不会自动把保存的旧Key发送到新服务商；有旧Key时须同时填写新Key或先清除。Key只按配对设备保存于Mac私有文件，手机保存后清空输入框。第三方请求使用通用Chat Completions参数，官方thinking扩展仅用于官方地址。百炼仍按北京/新加坡地域选择官方接口。

同一助手回复跨历史与实时通道按原始sourceItemId合并；独立ID的同文回复保留。旧正文缓存首次重拉，草稿、待确认输入及配对保留；新缓存可离线恢复。保留phase，但未增加进度折叠或解决尚未确认的“计划文档”来源。旧DeepSeek追加测试继续暂停。

## 重复根因证据

用户截图02:52的回复，在原始rollout只有一个response_item，原始ID与Desktop agentMessage的id一致。历史时间为2026-10-22T18:52:19.963Z，原生投影缺少item时间、回退turn开始18:52:02.622Z，间隔17.341秒；两路展示ID为log-generation-offset与desktop-turn-item，旧规则只有1.5秒镜像窗口，且没有保留原始ID，因而合并后重复。

实现保留rollout/原生sourceItemId和phase，跨时间/来源合并；log展示ID不变以保持分页游标。旧native缓存可从ID恢复身份，相同log ID刷新补齐元数据。此次确认的是截图助手回复来源，不把此前02:06/02:07用户输入与“计划输出”都认定为同一根因。只读证据在`output/audit/2026-10-23/voice-endpoint-dedup/desktop-evidence.json`，不保存完整会话正文或凭证。

## 验证

- 后端337/337，手机52/52，消息合并回归、两端typecheck/构建、插件构建与APK更新5/5通过。回归使用合成数据/临时目录/注入fetch，不读取真实会话或调用付费API。
- 覆盖第三方地址归一化、旧配置、持久化/设备隔离、地址改动不转发旧Key、清除Key、模型名与官方扩展隔离、HTTP错误脱敏；消息覆盖17秒时间差、旧native缓存、同ID元数据补齐、流式到终稿、独立同文消息和草稿迁移。
- 实际浏览器fixture检查：地址/模型保存和重开保持、修改地址缺Key的409提示、成功后两Key框清空、助手重复气泡数量1；360/390/430px浅色及430px深色150%字号无横向溢出，三个操作按钮均44px。截图及ui-checks.json位于上述审计目录。合成界面不等于手机原生/真实供应商通过。
- Android完整lint0错误/8项既有警告。APK为4,061,989字节，SHA256 `b2736e29b4a9769e747d2a9ea5188861776cfa0eb32e09681671ccf8c335c067`；与26同签名，4个dist资源逐字节匹配，录音与安装权限、原生插件、preview源及两项修复代码已核对。
- 固定网关更新后84项健康、本地/公网鉴权与Android预检、两Agent首帧/重连14项通过。真实只读当前120消息中19条助手均携带sourceItemId及phase；未发送任务、回答卡片或决定权限。
- 公网最新清单27/previous26、完整下载大小/SHA/字节/CORS/Content-Length及正式/hot保持共15项通过。

## 运行与回退

新入口：`~/Library/Application Support/Mobile Codex Gateway/releases/2026-10-23-voice-url-62945b84d0f7/mobile-codex/lib/gateway.mjs`，SHA256 `62945b84d0f7a08307a6c9d7686279e5d5f7189310b6010eea248b5d815b1204`。旧95384在stop后2068ms自然退出，再启动新PID1505，instanceId `94f51225-5d75-470a-b490-42e12f27249b`，Tunnel connected。网关配置、设备、语音凭证和Harness profile/插件哈希保持，原Harness PID68334/68372保持；本次无需重载桥接，未启用自启动。单次成功不代表上轮关闭残留已根治。

私有备份：`/Users/rorance/workspace/backups/codex-to-phone/2026-10-23-voice-url-20261022T190432Z/`。操作脚本在审计目录，仅适用于本次state，不能不核对原instance就重复执行。回退须先核对配置后续变化，按当前instance正常stop，确认PID和端口均释放再启旧程序；不覆盖后来填写的模型Key或设备信息。复用既有publish-android-update脚本与SSH密钥，不需要聊天提供服务器登录信息。

交付目录：`output/delivery/2026-10-23/voice-url-preview/`。未提交代码。手机27安装、真实录音/模型可用性、整理效果/时延/费用仍须用户在手机填Key后验收，任务继续in_progress。
