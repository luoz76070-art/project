# 文档索引

本文档用于汇总当前仓库中已检入且有持续参考价值的说明文档，方便从根目录 README 跳转。

## 根入口

- [`../README.md`](../README.md)：仓库导航、阶段说明、常用命令。

## 业务包文档

- [`../packages/tencent-docs-recruiting-extractor/README.md`](../packages/tencent-docs-recruiting-extractor/README.md)：源表提取包说明、最小运行文件集、手工冒烟检查。
- [`../packages/local-recruiting-results/README.md`](../packages/local-recruiting-results/README.md)：本地结果生成包说明。
- [`../packages/tencent-docs-writeback/README.md`](../packages/tencent-docs-writeback/README.md)：目标表回写包说明与运行行为说明。

## 基线与参考

- [`../vendor/tencent-docs-extractor-baseline/BASELINE.md`](../vendor/tencent-docs-extractor-baseline/BASELINE.md)：原始提取器基线快照说明。

## 指南

- [`guides/branch-and-commit-flow.md`](guides/branch-and-commit-flow.md)：本地改动、提交、推送和 PR 的完整流程说明。
- [`guides/git-basics.md`](guides/git-basics.md)：Git 分支、提交、回滚、远端和 PR 的入门说明。
- [`guides/github-pr-workflow.md`](guides/github-pr-workflow.md)：GitHub PR、分支和 `main` 的入门说明。
- [`guides/repo-operations.md`](guides/repo-operations.md)：这个仓库的日常操作手册。

## Superpowers 文档

### 日志

- [`superpowers/logs/2026-04-09-project-cleanup-log.md`](superpowers/logs/2026-04-09-project-cleanup-log.md)：项目瘦身与整理日志。

### 计划

- [`superpowers/plans/2026-03-24-recruiting-extractor-phase1.md`](superpowers/plans/2026-03-24-recruiting-extractor-phase1.md)：腾讯文档提取阶段计划。
- [`superpowers/plans/2026-03-31-tencent-docs-writeback-phase3.md`](superpowers/plans/2026-03-31-tencent-docs-writeback-phase3.md)：腾讯文档回写阶段计划。

### 设计

- [`superpowers/specs/2026-03-24-local-results-phase2-design.md`](superpowers/specs/2026-03-24-local-results-phase2-design.md)：本地结果阶段设计说明。
- [`superpowers/specs/2026-03-31-tencent-docs-writeback-phase3-design.md`](superpowers/specs/2026-03-31-tencent-docs-writeback-phase3-design.md)：回写阶段设计说明。

## 当前索引边界

- 仅索引当前工作树中已经存在的文档文件。
- `results/` 运行产物说明尚未形成独立文档；当前只能从各包 README 中了解相关路径约定。
