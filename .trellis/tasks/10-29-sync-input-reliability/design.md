# 设计与边界

1. 状态写入位于App的轮询/SSE回调。增加每个轮询生命周期的AbortController，并在SSE恢复时立即废止轮询；写入前及React updater内验证signal和请求捕获的运行态版本。同步版本只在内存中使用；同generation不接受倒退cursor，新generation的显式reset仍可更新基线。
2. runtime缓存把关键输入保存到独立的scope键，不参与正文24线程/120消息淘汰。先保存输入，再按总UTF-16存储字节预算保存可重建历史；配额不足可丢弃本scope正文后重试输入。旧缓存输入仅在新输入键不存在时迁移；空的新输入快照也是权威，防止已清空草稿复活。
3. 保存结果返回结构化状态。App独立展示持久化失败/降级提示，正常任务进度不能覆盖；下次成功保存可恢复。

预计文件：App.tsx（请求生命周期、提示）、types.ts（内存同步版本）、chat/sync.ts（纯写入守卫）、chat/runtime.ts（输入与正文缓存）、scripts/test-mobile-reliability.mjs（实际入口时序/容量回归）、现有输入回归驱动及package.json（验证接入）。必要文档/spec记录契约；不改Relay协议、不重构整个App、不调整提示词过滤。

自审：取消不是唯一保护，原生HTTP迟到结果仍校验；guard在updater内再次校验以覆盖React批处理；输入保存失败时不得覆盖可恢复旧输入；新输入快照成功才替换旧正文。保留已有未提交修改。
