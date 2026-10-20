# 优化总任务

用户要求先用 Trellis 重构全项目布局，再执行现有优化计划。目标是轻量、实时、随时可重新连接，UI 参考 Codex 手机版。

## 任务地图

layout → transport → correctness → performance/availability；mobile-ui 先建立参考基线，实施衔接连接状态与缓存。

完整问题、优先级与验收见 `docs/audits/2026-10-20/README.md`。保留现有技术栈、用户改动、启动/打包入口；不提交、推送、部署。每个子任务独立记录验证，通过后归档；总任务在全部子任务与真机验收完成前保持未完成。
