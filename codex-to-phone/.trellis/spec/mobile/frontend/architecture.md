# 前端模块与状态

- `src/main.tsx`：仅挂载 React 与引入全局样式。
- `src/app/`：App 编排、运行参数和类型。
- `src/features/chat/`：消息组件、附件、工具输出、消息合并及线程运行态缓存。
- `src/features/connection/`：HTTP 请求、连接档案与诊断；保留 CapacitorHttp 原生请求路径。
- `src/features/threads/`：线程与项目分组的展示模型。
- `src/features/updates/`：原生热更新插件适配。
- `src/shared/`：少量跨功能的格式、剪贴板与偏好工具。

组件可使用纯展示模型；HTTP 不依赖 React 组件。继续使用本地 React hooks，不为拆文件引入状态库。

## 已实施的状态契约

- Workspace key 由 profile ID、cacheNamespace 与规范化 Endpoint 组成。保存/切换档案才替换连接；卸载时取消请求、订阅和计时器。原生 HTTP 无法物理取消时，丢弃旧作用域结果。
- 基线读取结束后才建立订阅；seq/baseSeq 不连续时重建基线。正常 SSE 暂停业务轮询，降级/健康检查 single-flight；后台暂停，回前台重新检查。
- 桌面基线和 delta 均应用 turnStatus/activity；activity 增量不单独改写生命周期。显式完成/打断/失败必须停止工作提示，即使没有助手正文；空消息页也能显示运行状态。不把已有打字动画当作真实 token 流。
- `features/threads/cache.ts` 保存最多 120 条无凭证线程元数据，优先保留选中项；与按线程消息/草稿缓存一起同步恢复首屏，再后台刷新。缓存写入合并 700 ms，pagehide/隐藏/切作用域时 flush；不能为普通消息缓存丢弃草稿与未确认发送。
- 历史页只改变 historyBefore，不推进尾部 cursor。generation 变化才重置基线；浏览历史时保留滚动位置，切回线程不自动退出历史模式。
- Android 启动先完成 Keystore 凭证解锁/迁移，再挂载工作区；成功写入密文后才删除明文。失败保留原数据并显式报错，浏览器路径仍为 localStorage。
