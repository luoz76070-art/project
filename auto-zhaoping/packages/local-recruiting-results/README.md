# @zhaoping/local-recruiting-results

负责把 phase-one 提取结果整理为仓库内可消费的本地招聘结果目录，并生成当前快照、今日新增、近 7 日新增与摘要文件。

## 包职责

- 读取 `@zhaoping/tencent-docs-recruiting-extractor` 的最新有效输出。
- 结合历史归档生成 `main-current.csv`、`today-new.csv`、`recent-7d-new.csv`。
- 维护 `results/local-recruiting/` 下的 `latest/`、`archive/`、`failed/` 三类结果目录。

## 输入

- 默认输入目录：`packages/tencent-docs-recruiting-extractor/output/<snapshot-or-run>/` 中最新且包含 `recruiting.csv`、`run-summary.json` 的目录。
- 历史数据：`results/local-recruiting/archive/<snapshot-date>/` 下既有成功归档。
- 可选命令参数：`--input-dir <path>`，用于指定明确输入目录。

## 输出

- `results/local-recruiting/latest/main-current.csv`
- `results/local-recruiting/latest/today-new.csv`
- `results/local-recruiting/latest/recent-7d-new.csv`
- `results/local-recruiting/latest/summary.json`
- `results/local-recruiting/archive/<snapshot-date>/...` 同步写出同名文件
- 失败时写出 `results/local-recruiting/failed/<run-id>/summary.json`

## 核心命令

- `npm --workspace @zhaoping/local-recruiting-results run generate`
- `npm --workspace @zhaoping/local-recruiting-results run generate -- --input-dir packages/tencent-docs-recruiting-extractor/output/<dir>`
- `npm run test:local-results`

## 上下游关系

- 上游：`@zhaoping/tencent-docs-recruiting-extractor` 的 `recruiting.csv` 和 `run-summary.json`。
- 下游：`@zhaoping/tencent-docs-writeback` 默认读取 `results/local-recruiting/latest/main-current.csv` 与 `summary.json`。
- 结果层：`results/local-recruiting/` 同时承担本地审计和后续消费边界。

## 当前状态

- 当前仓库中的 phase-two 正式工作区包之一。
- 已实现 latest/archive 原子替换发布和失败落盘。
- 近 7 日差分状态会根据历史窗口完整度标记 `complete` 或 `insufficient_history`；当前设计仍以文件目录为唯一发布介质。
- 当前仓库内没有直接前端页面、HTTP 服务或数据库读写逻辑依赖本包。

## 未来前后端/数据库接入预留

- 前端若接入，可优先读取 `results/local-recruiting/latest/summary.json` 和三份 CSV 作为页面数据源。
- 后端若接入，可把 `latest/` 作为稳定消费入口，把 `archive/` 作为补数与追溯入口。
- 数据库若接入，可按 `snapshot_date` 管理批次，按 `record_id` 管理岗位去重，延续当前文件层差分语义。
