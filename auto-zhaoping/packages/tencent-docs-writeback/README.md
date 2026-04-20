# @zhaoping/tencent-docs-writeback

负责把本地最新招聘结果回写到腾讯文档目标表，并在写入前后保留审计材料与回读校验结果。

## 包职责

- 读取 `results/local-recruiting/latest/` 中的最新主结果。
- 打开腾讯文档目标表，维护保留备份 sheet，并执行清空后从 `A1` 重新粘贴。
- 回读目标表内容并与本地 CSV 做一致性校验。
- 为每次回写写出报告与前后对比文件。

## 输入

- 配置文件：`packages/tencent-docs-writeback/config/writeback.config.json`，来源于示例配置。
- 本地结果输入：`results/local-recruiting/latest/main-current.csv` 与 `results/local-recruiting/latest/summary.json`。
- 运行状态：`results/tencent-docs-writeback/state.json` 中记录保留备份 sheet 标识。

示例配置字段：

- `targetUrl`
- `backupSheetName`

## 输出

- `results/tencent-docs-writeback/runs/<run-id>/report.json`
- `results/tencent-docs-writeback/runs/<run-id>/before-target.csv`
- `results/tencent-docs-writeback/runs/<run-id>/after-target.csv`
- `results/tencent-docs-writeback/state.json`（在成功解析或创建保留备份 sheet 后写出）

## 核心命令

- `npm --workspace @zhaoping/tencent-docs-writeback run writeback`
- `npm run test:writeback`

## 上下游关系

- 上游：`@zhaoping/local-recruiting-results` 发布的 `results/local-recruiting/latest/`。
- 下游：腾讯文档目标表，以及 `results/tencent-docs-writeback/` 下的本地审计产物。
- 外部依赖：运行时通过仓库内 `vendor/tencent-docs-extractor-baseline` 的浏览器能力操作腾讯文档页面。

## 当前状态

- 当前仓库中的 phase-three 正式工作区包之一，定位为本地结果到腾讯文档目标表的回写阶段。
- 已实现备份 sheet 发现或创建、目标表回读比对、失败报告落盘。
- 当前执行入口默认读取仓库根下固定配置与固定 latest 输入目录，不提供前端或服务化入口。
- 当前仓库内也没有数据库写入逻辑；审计仍以 `report.json` 和前后 CSV 为主。

## 未来前后端/数据库接入预留

- 前端若接入，可直接展示 `report.json`、`before-target.csv`、`after-target.csv` 的差异和最近一次回写状态。
- 后端若接入，可复用当前输入输出边界，把回写动作封装为受控任务，而不是改写现有文件契约。
- 数据库若接入，可同步保存 run 级元数据、回写目标 URL、快照日期和校验结果，继续保留本地文件作为审计副本。
