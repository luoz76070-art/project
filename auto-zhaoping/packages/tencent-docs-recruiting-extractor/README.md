# @zhaoping/tencent-docs-recruiting-extractor

负责从腾讯文档招聘源表读取原始岗位数据，标准化为仓库内部约定的 `recruiting.csv`，并输出本次抓取摘要。

## 包职责

- 连接腾讯文档招聘源表并执行一次性导出。
- 对导出结果做字段规范化、日期清洗和 `record_id` 生成。
- 为后续本地结果生成阶段提供稳定的 phase-one 文件边界。

## 输入

- 配置文件：`config/extractor.config.example.json` 的本地副本，至少需要真实 `sourceUrl`。
- 运行时目录：`output/`、`.browser-profile/`。
- 外部依赖：可访问的腾讯文档源表，以及本包依赖的 `playwright`、`xlsx`。

示例配置字段：

- `sourceUrl`
- `timezone`
- `outputDir`
- `userDataDir`

## 输出

- `output/<run-id>/recruiting.csv`
- `output/<run-id>/run-summary.json`
- 发生 `record_id` 冲突时额外写出 `output/<run-id>/record-id-collision.json`

当前固定 CSV 字段包括：

- `record_id`, `snapshot_date`, `company_name`, `batch`, `company_type`, `industry`
- `target_candidates`, `job_title_raw`, `job_status_raw`, `location_raw`, `updated_at_raw`, `deadline_raw`
- `official_notice_text`, `apply_text`, `remark_raw`, `official_notice_url`, `apply_url`
- `job_keywords`, `major_keywords`, `location_tokens`, `degree_level`, `is_closed`, `is_expired`
- `deadline_date`, `updated_date`, `source_url`, `extracted_at`

## 核心命令

- `npm --workspace @zhaoping/tencent-docs-recruiting-extractor run healthcheck -- --config packages/tencent-docs-recruiting-extractor/config/extractor.config.local.json`
- `npm --workspace @zhaoping/tencent-docs-recruiting-extractor run extract -- --config packages/tencent-docs-recruiting-extractor/config/extractor.config.local.json`
- `npm run test:extractor`

## 上下游关系

- 上游：腾讯文档招聘源表。
- 下游：`@zhaoping/local-recruiting-results` 读取 `output/<snapshot-or-run>/` 下的 `recruiting.csv` 和 `run-summary.json`。
- 横向关系：当前仓库内不直接负责结果发布或回写目标表。

## 当前状态

- 当前仓库中的 phase-one 正式工作区包之一。
- 包内保留了单次抓取、登录健康检查和测试脚本。
- README 中原有最小文件集说明仍然成立：正常提取主路径集中在 `scripts/extract-once.js`、`scripts/login-healthcheck.js`、`scripts/export-source.js`、`scripts/normalize-records.js` 及其 `scripts/lib/` 依赖。
- 当前实现以文件输出为主，不包含前端界面、服务 API 或数据库写入。

## 未来前后端/数据库接入预留

- 前端若接入，可直接消费 `run-summary.json` 作为最近一次抓取状态来源，再按需读取 `recruiting.csv` 做展示。
- 后端若接入，可把本包视为独立的源抓取阶段，继续沿用当前 CSV 和摘要 JSON 作为进程间契约。
- 数据库若接入，优先以 `record_id`、`snapshot_date`、`source_url` 等现有字段做入库键和追踪字段，避免破坏现有文件流水线。
