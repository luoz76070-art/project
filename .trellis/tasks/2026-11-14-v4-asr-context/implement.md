# 实施与验证

1. 完成官方匿名文档核验、模型适配及schema/幂等摘要。
2. 手机名称提取、默认开启的本地偏好、两入口接线、重转/关闭保护。
3. 隔离回归：模型请求形状、长度/条数/路径、设置与HTTP省略、重转参考快照、不持久化参考。
4. 运行 test:voice、test:mobile、typecheck、lint，完成差异自审后提交/推送/开PR。

## 检查结果

- `corepack pnpm test:voice`：139/139通过。
- `corepack pnpm test:mobile`：281/281通过。
- `corepack pnpm typecheck`：Relay和Mobile通过。
- `corepack pnpm lint`：通过，0警告。
- `corepack pnpm --filter @mobile-codex/mobile build`：通过。
- `lgit diff --check`：通过；修改仅涉及本任务语音链、测试与规范，无workflow改动。

初轮名称提取测试发现NFKC把中文逗号归一为ASCII逗号后，行号后的正文粘连导致漏提文件名，已修复分词边界并通过上述最终检查。自审核对两入口来源、设置→请求省略、模型参数隔离、摘要与GET恢复、正文预算。
UI使用生产组件合成hooks检查按钮状态，不代替浏览器视觉/Android真机。未运行真实供应商、读取用户配置或凭据、部署或真实会话操作。3.1长词按官方限制截断；未知模型/新加坡子空间省略参考，真实识别效果由Claude后续验证。
