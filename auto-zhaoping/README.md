# zhaoping

`zhaoping` 是一个按 npm workspace 组织的招聘数据三阶段流水线仓库，用于完成腾讯文档源表提取、本地结果生成、以及目标表回写。

## 导航

- 根文档索引：[`docs/README.md`](docs/README.md)
- 提取阶段：[`packages/tencent-docs-recruiting-extractor/README.md`](packages/tencent-docs-recruiting-extractor/README.md)
- 本地结果阶段：[`packages/local-recruiting-results/README.md`](packages/local-recruiting-results/README.md)
- 回写阶段：[`packages/tencent-docs-writeback/README.md`](packages/tencent-docs-writeback/README.md)
- 基线快照说明：[`vendor/tencent-docs-extractor-baseline/BASELINE.md`](vendor/tencent-docs-extractor-baseline/BASELINE.md)
- 整理日志：[`docs/superpowers/logs/2026-04-09-project-cleanup-log.md`](docs/superpowers/logs/2026-04-09-project-cleanup-log.md)

## 仓库当前结构

### 业务主线

1. `@zhaoping/tencent-docs-recruiting-extractor`
   从腾讯文档源表提取招聘数据，并生成标准化 CSV 与运行摘要。
2. `@zhaoping/local-recruiting-results`
   读取提取结果，生成本地结果集与面向回写的最新快照。
3. `@zhaoping/tencent-docs-writeback`
   将 `results/local-recruiting/latest/main-current.csv` 回写到腾讯文档目标表，并保留审计产物。

### 支撑层

- `vendor/tencent-docs-extractor-baseline/`
  保留原始提取器的只读参考快照，用于对照与审计。
- `docs/superpowers/`
  当前已检入设计、计划和整理日志。

### 当前工作树状态说明

- 根工作区定义了 `packages/*` 三个正式包。
- 当前隔离工作树中未检出 `results/` 实体目录，但相关包文档和脚本仍以该路径作为运行产物位置。
- 根目录目前没有独立的架构说明文档，仓库入口以导航和索引为主。

## 快速开始

1. 在仓库根目录运行 `npm install`。
2. 运行 `npm run test:extractor` 检查提取阶段。
3. 运行 `npm run test:local-results` 检查本地结果阶段。
4. 运行 `npm run test:writeback` 检查回写阶段。

## 常用命令

- `npm test`
- `npm run test:extractor`
- `npm run test:local-results`
- `npm run test:writeback`
- `npm run generate:local-results`
- `npm run writeback:tencent-docs`

## 阅读顺序建议

1. 先看本文，确认仓库入口、目录职责和阶段边界。
2. 再看 [`docs/README.md`](docs/README.md)，进入设计、计划、日志索引。
3. 最后按实际操作路径阅读对应包的 README。

## 备注

- `node_modules/` 为安装产物，不属于文档索引范围。
- 若后续补齐 `results/` 分类说明或更完整的架构文档，应从 `docs/README.md` 继续扩展入口。
