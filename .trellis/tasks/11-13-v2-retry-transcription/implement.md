# 实施与验证

1. 已核对 main 66ccc62、干净工作区并安装锁定依赖，建立 codex/v2-retry-transcription。
2. 实现内存录音生命周期、同步重转锁、失败按钮和恢复取消分类。
3. 补生产组件行为及 Relay 路由测试；同步语音契约并自审全量差异。
4. 跑 test:voice、test:mobile、typecheck；定向 lint 与手机 build。通过后提交、推送并开指定 PR。

验证结果待执行后记录；不读取真实会话/凭证，不调用真实供应商，不部署。

## 完成记录（2026-11-13）

- `corepack pnpm test:voice`：48/48；含生产Relay路由502缓存失败、新ID成功，供应商计数2次/同一音频。
- `corepack pnpm test:mobile`：187/187；含生产VoiceInput事件/effect与V1协调器串联的6组V2回归。
- `corepack pnpm typecheck`：Relay和Mobile均通过。
- `corepack pnpm --filter @mobile-codex/mobile build`：通过。
- 定向 ESLint（VoiceInput、recovery、手机/Relay语音测试及组件驱动）：0错误/0警告；`lgit diff --check`通过。
- 自审：只增加当前session内存引用；首次await前同步锁；每次submit生成新ID；成功先释放再整理；切连接/会话清状态，上传中卸载仍detach保留V1元数据；持久化schema和Relay生产代码未变。
- 边界：合成hooks/供应商测试不能代替真实React DOM、Android麦克风及真机前后台验收。本轮未运行浏览器/Android真机或付费供应商；进程被杀后录音不会保留，仍可按V1查询已提交结果。
