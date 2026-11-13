# 实施与验证

1. 基线44e9e01（含S1/V2），锁定依赖安装完成，分支codex/v3-refine-guard。
2. 新增纯校验模块，接入现有VoiceInput；扩展已有生产组件驱动，测试实际警告/采用/编辑接线。
3. 数字、技术串、否定及保守归一化单元矩阵；更新语音契约。
4. 全量test:voice、test:mobile、typecheck、lint及手机构建；自审后提交、推送并开PR。结果完成后补录。

## 最终结果

- `corepack pnpm test:voice`：129/129通过。
- `corepack pnpm test:mobile`：275/275通过。
- `corepack pnpm typecheck`：Relay与Mobile均通过。
- `corepack pnpm lint`：全仓通过（max-warnings=0）。
- `corepack pnpm --filter @mobile-codex/mobile build`与`lgit diff --check`：通过。
- 纯函数矩阵验证数字/版本/百分比/日期时间、常见中文等价、技术串/全半角/大小写/空白、否定删除与数量减少、常见同义及被动否定；补了路径紧接禁止语不能吞掉否定，以及2万字输入的回归。
- 生产组件驱动验证推荐原文但不阻止采用整理稿、无遗漏UI保持、编辑时重新校验、5条上限/总数、关闭和切会话清理。
- 自审确认不修改草稿采用权限、请求/恢复协议、录音生命周期、S1或工作流，不增加依赖、网络请求或持久化。
- 已知边界：词法规则保守提示，无法保证复杂数字和语义等价的完整识别；32字符以上数值令牌保守跳过。合成hooks/单元测试不代替真实浏览器和Android，本轮未做浏览器/真机验收或部署。
