# 本地结果集阶段二设计文档

## 一、项目概述

本文档定义 `zhaoping` 项目的阶段二能力：在不接入腾讯文档写回的前提下，基于阶段一提取层已经生成的提取结果目录，构建一个独立的本地结果生成器。

该生成器只消费阶段一的标准输出，不重新访问腾讯文档页面，不依赖 Playwright 登录态，也不承担目标文档同步职责。它的任务是把提取结果转换成可直接消费的本地结果集，并保留必要历史以支持“今天新增”和“最近 7 天新增”的结果生成。

本阶段输出聚焦于本地结果文件，而不是最终发布介质。这样可以把“提取层”“结果层”“写回层”继续保持解耦。

## 二、项目目标

- 基于阶段一提取结果目录生成本地结果集
- 产出三个核心 CSV：
  - `main-current.csv`
  - `today-new.csv`
  - `recent-7d-new.csv`
- 产出一个汇总元数据文件：`summary.json`
- 支持两种输入方式：
  - 显式指定提取结果目录
  - 自动选择最新提取结果目录
- 同时支持两种结果保存方式：
  - `latest/` 保存最近一次成功结果
  - `archive/<snapshot-date>/` 保存历史归档
- 在失败时保护上一次成功结果，不污染 `latest/`

## 三、已确认约束

- 阶段二只消费阶段一提取层已经生成的结果目录
- 输入目录必须完整，至少包含：
  - `recruiting.csv`
  - `run-summary.json`
- 阶段二不直接读取腾讯文档，不重新执行提取流程
- 本阶段只生成本地结果集，不实现腾讯文档写回
- 输出形式必须包含：
  - 两个新增结果 CSV（今天新增、近 7 天新增）
  - 一个主表 CSV
  - 一个汇总 JSON
- 输出目录策略为：
  - `latest/` + `archive/`
- 新增结果必须遵守之前确认的业务规则：
  - `today-new.csv` 与 `recent-7d-new.csv` 只保留当前仍存在于主表中的记录
- 历史不足允许降级运行，但输入不完整或计算异常应硬失败

## 四、范围定义

### 4.1 在范围内

- 读取阶段一提取结果目录
- 识别当前输入目录对应的 `snapshot_date`
- 生成当前主表 `main-current.csv`
- 生成当天新增 `today-new.csv`
- 生成最近 7 天新增汇总 `recent-7d-new.csv`
- 生成 `summary.json`
- 管理 `latest/` 和 `archive/` 结果目录
- 为失败、降级运行和历史覆盖情况生成明确元数据

### 4.2 不在范围内

- 写回腾讯文档
- 执行新的腾讯文档提取
- 自动修复提取输入数据
- 自动回补历史快照
- 统计图表、BI 分析或长期趋势分析

## 五、总体架构

阶段二本地结果生成器由四个职责单元组成：

1. `输入解析层`
2. `历史加载与比对层`
3. `结果投影视图层`
4. `结果发布层`

依赖方向固定为：

- 阶段一提取结果目录 -> 输入解析层
- 输入解析层 -> 历史加载与比对层
- 历史加载与比对层 -> 结果投影视图层
- 结果投影视图层 -> 结果发布层

阶段二不应反向依赖阶段一内部脚本实现，只应依赖其目录产物契约。

## 六、推荐方案

本阶段采用 `结果生成器模式`。

### 6.1 方案特征

- 阶段二作为独立命令运行
- 输入是一个阶段一提取结果目录，或自动识别出的最新提取结果目录
- 输出是标准本地结果集目录
- 不直接承担目标文档写回

### 6.2 选择原因

- 最符合当前项目强调的低耦合目标
- 使阶段一提取层继续保持纯净，只负责“提取 + 标准化 CSV”
- 使阶段二只专注于“消费提取结果并生成本地结果集”
- 为后续单独建设写回层保留清晰边界

## 七、目录结构与产物定义

### 7.0 结果根目录规则

阶段二结果的权威输出根目录固定为：

- `results/local-recruiting/`

在本阶段 spec 中，该路径不通过 CLI 参数覆盖，也不通过配置文件重定义。

所有本 spec 中出现的固定相对路径，都统一以仓库根目录作为解析基准，而不是以 package 工作目录或进程当前工作目录作为基准。

因此阶段二只在以下固定位置管理结果：

- `results/local-recruiting/latest/`
- `results/local-recruiting/archive/<snapshot-date>/`
- `results/local-recruiting/failed/<run-id>/`

### 7.1 结果根目录

阶段二使用一个独立结果根目录，用于保存本地结果集。

目录中包含两条主线：

- `latest/`
- `archive/<snapshot-date>/`

### 7.2 归档目录

`archive/<snapshot-date>/` 保存某一次结果生成的完整归档，至少包含：

- `main-current.csv`
- `today-new.csv`
- `recent-7d-new.csv`
- `summary.json`

### 7.3 最新目录

`latest/` 始终保存最近一次成功生成的结果，文件名与归档目录保持一致。

这样后续任何消费者只读取 `latest/` 即可，不必理解归档结构。

### 7.4 文件语义

- `main-current.csv`：今天输入快照中的当前全量记录
- `today-new.csv`：今天新增且当前仍存在于主表中的记录
- `recent-7d-new.csv`：最近 7 天新增且当前仍存在于主表中的记录汇总
- `summary.json`：本次结果的输入、规模、历史覆盖、降级状态、失败原因等元数据

### 7.4.1 输出 CSV schema 规则

三个 CSV 的列契约固定如下：

- `main-current.csv`
  - 列顺序固定继承自输入 `recruiting.csv`
  - 不追加阶段二派生列

- `today-new.csv`
  - 先完整保留输入 `recruiting.csv` 的全部列，顺序不变
  - 在最后追加一列：`new_date`

- `recent-7d-new.csv`
  - 先完整保留输入 `recruiting.csv` 的全部列，顺序不变
  - 在最后追加一列：`new_date`

其中：

- `new_date` 表示该记录本次被认定为“新增事件”的日期
- `today-new.csv` 中所有行的 `new_date` 都等于当前运行的 `snapshot_date`
- `recent-7d-new.csv` 中的 `new_date` 可分布在最近 7 天窗口内

### 7.5 失败运行目录

为了保证失败元数据可定位，同时不污染成功结果，阶段二额外定义一类失败运行目录：

- `failed/<run-id>/summary.json`

其中：

- `run-id` 与本次执行实例绑定，不要求等于 `snapshot_date`
- 失败运行目录只保存失败元数据，不写入 `main-current.csv`、`today-new.csv`、`recent-7d-new.csv`
- `latest/` 永远不指向失败运行目录
- `archive/<snapshot-date>/` 只用于成功归档

## 八、输入边界与处理流程

### 8.1 输入方式

阶段二必须支持两种入口：

- 显式指定某个提取结果目录
- 自动识别最新提取结果目录

### 8.1.1 自动识别最新提取结果目录规则

当用户未显式指定输入目录时，阶段二按以下固定规则自动选择“最新提取结果目录”：

1. 只在阶段一提取器的标准输出根目录下查找候选目录
2. 标准输出根目录默认固定为：
   - `packages/tencent-docs-recruiting-extractor/output/`
3. 候选目录必须同时满足：
   - 是输出根目录下的直接子目录
   - 目录内存在 `recruiting.csv`
   - 目录内存在 `run-summary.json`
4. 对每个候选目录，读取其 `recruiting.csv` 并按本 spec 的 `snapshot_date` 识别规则提取唯一 `snapshot_date`
5. 以 `snapshot_date` 最大者作为“最新提取结果目录”
6. 如果多个候选目录的 `snapshot_date` 相同，则以目录名按字典序降序选择最大的一个
7. 如果没有任何合法候选目录，则本次运行直接失败

文件系统 `mtime`、目录创建时间、`run-summary.json` 时间字段都不得作为“最新目录”的权威选择依据。

该输出根目录同样以仓库根目录为解析基准。

### 8.2 输入契约

每个输入目录必须至少包含：

- `recruiting.csv`
- `run-summary.json`

如果任一文件缺失，则本次运行应视为输入不完整并直接失败。

### 8.2.0 输入最小 schema

阶段二对 `recruiting.csv` 的最小输入 schema 固定要求如下：

- `record_id`
- `snapshot_date`
- `company_name`
- `job_title_raw`
- `location_raw`
- `deadline_raw`
- `updated_at_raw`
- `official_notice_text`
- `apply_text`
- `remark_raw`
- `official_notice_url`
- `apply_url`
- `job_keywords`
- `major_keywords`
- `location_tokens`
- `degree_level`
- `is_closed`
- `is_expired`
- `deadline_date`
- `updated_date`
- `source_url`
- `extracted_at`

其余阶段一 contract 字段若存在，应原样保留；若上述最小 schema 任一缺失，则本次运行硬失败。

### 8.2.1 snapshot_date 识别规则

`snapshot_date` 的唯一权威来源固定为当前输入目录中的 `recruiting.csv` 内容。

识别方式如下：

1. 读取 `recruiting.csv`
2. 读取其中 `snapshot_date` 列
3. 校验所有数据行的 `snapshot_date` 必须一致
4. 若一致，则该值作为本次阶段二运行的 `snapshot_date`
5. 若缺少 `snapshot_date` 列、该列为空、或存在多值冲突，则本次运行直接失败

`run-summary.json`、输入目录名、文件时间戳都不得作为 `snapshot_date` 的权威来源，只能作为调试辅助信息写入失败元数据。

### 8.3 处理流程

处理流程如下：

1. 识别输入目录与 `snapshot_date`
2. 校验输入目录完整性
3. 读取当前 `recruiting.csv`
4. 生成当前主表结果 `main-current.csv`
5. 加载历史归档或历史结果元数据
6. 基于 `record_id` 计算：
   - 当天新增
   - 最近 7 天新增汇总
7. 生成 `summary.json`
8. 成功后发布到：
   - `archive/<snapshot-date>/`
   - `latest/`

### 8.4 输入隔离原则

阶段二不应：

- 回头读取腾讯文档
- 重新执行浏览器提取
- 读取阶段一的内部临时逻辑

它只应依赖“阶段一成功产出的目录契约”。

## 九、新增判定与结果规则

### 9.1 主表规则

`main-current.csv` 等于当前输入目录中的全量记录。

### 9.2 今日新增规则

若某个 `record_id` 存在于今天输入，但不存在于前一有效历史快照中，则其属于今日新增候选。

`today-new.csv` 最终只保留同时满足以下条件的记录：

- 今天首次新增
- 当前仍存在于 `main-current.csv`

### 9.3 最近 7 天新增规则

`recent-7d-new.csv` 汇总最近 7 天内首次新增的记录，但最终仍只保留当前仍存在于主表中的记录。

### 9.3.1 最近 7 天首次新增的权威算法

为避免歧义，`recent-7d-new.csv` 的判定算法固定如下：

1. 以当前 `snapshot_date` 为终点，构造一个最近 7 个自然日窗口
2. 在该窗口内，按日期升序遍历所有可用成功快照
3. 为了保证窗口左边界可判定，允许额外加载一个“窗口起点之前最近的前一有效快照”，该快照只作为 diff baseline 使用，不属于 7 天窗口结果集本身
4. 对每个快照中的每个 `record_id`，检查其在“前一有效快照”中是否不存在
5. 若不存在，则该快照日期记为该 `record_id` 的一次“新增事件日期”
6. 对于同一个 `record_id`，在当前 7 日窗口内只保留最早的一次新增事件日期，记为 `new_date`
7. 窗口扫描结束后，只保留当前 `main-current.csv` 中仍存在的 `record_id`
8. 最终输出这些记录，并带上对应的 `new_date`

这意味着：

- 不是“相对 7 天窗口起点新增”
- 而是“在最近 7 天窗口内，第一次被观察到从不存在到存在的日期”

如果连“窗口起点之前最近的前一有效快照”也不存在，则窗口中最早一个可用快照不能被可靠判定为新增来源；此时该日按历史不足处理，而不是默认与空集比较。

### 9.3.2 记录消失后重现规则

如果同一个 `record_id` 在窗口内出现“消失后重现”，则：

- 只要它在某一天相对于前一有效快照重新从“不存在”变成“存在”，该日期就构成一次新的新增事件
- 但在当前 7 天窗口输出时，仍只保留该窗口内最早的一次新增事件日期作为 `new_date`

因此 `recent-7d-new.csv` 对每个当前仍存在的 `record_id` 最多只输出一行。

### 9.4 当前仍有效规则

本阶段中“仍有效”的定义固定为：

- 当前输入快照中仍存在该 `record_id`

如果记录从当前主表中消失，则：

- 不应出现在 `today-new.csv`
- 不应出现在 `recent-7d-new.csv`

## 十、失败处理与结果一致性

### 10.1 总体原则

失败必须是显式的、可定位的、不可悄悄污染结果的。

### 10.2 硬失败场景

以下情况应直接终止本次生成：

- 缺少 `recruiting.csv`
- 缺少 `run-summary.json`
- CSV 表头不符合阶段一契约
- 运行时发生解析异常
- 结果目录不可写

处理方式：

- 终止本次生成
- 不更新 `latest/`
- 在 `failed/<run-id>/summary.json` 写失败版 `summary.json`

如果失败发生在 `snapshot_date` 成功识别之前，则失败元数据中的 `snapshot_date` 固定写为 `null`。

### 10.3 可降级运行场景

以下情况允许生成降级结果：

- 第一次运行，没有昨天快照
- 历史覆盖不足 7 天
- 某些历史归档缺失，但不影响当前输入完整性，且仍能构建当前可用比较窗口

处理方式：

- 正常生成 `main-current.csv`
- 对新增结果生成当前可计算范围内的结果
- 在 `summary.json` 中标记：
  - `diff_status = insufficient_history`
  - 实际历史覆盖范围

### 10.3.1 降级输出矩阵

为避免实现歧义，降级输出行为固定如下：

- 场景 A：没有任何前一有效快照
  - `main-current.csv`：正常生成
  - `today-new.csv`：生成空文件，仅保留表头
  - `recent-7d-new.csv`：生成空文件，仅保留表头
  - `summary.json.diff_status = insufficient_history`
  - `summary.json.history_window_available = 0`

- 场景 B：存在前一有效快照，但 7 天窗口历史不完整
  - `main-current.csv`：正常生成
  - `today-new.csv`：基于最近前一有效快照正常生成
  - `recent-7d-new.csv`：基于当前可用历史范围生成部分结果
  - `summary.json.diff_status = insufficient_history`
  - `summary.json.history_window_available` 写可用窗口天数

- 场景 C：历史归档部分损坏，但仍能定位前一有效快照
  - `main-current.csv`：正常生成
  - `today-new.csv`：正常生成
  - `recent-7d-new.csv`：跳过损坏历史后按剩余可用窗口生成
  - `summary.json.history_candidates_skipped` 记录被跳过项

- 场景 D：连前一有效快照都无法确定
  - 等同于场景 A

### 10.4 latest 保护原则

`latest/` 只在本次运行完整成功后才更新。

如果本次运行失败，则保留上一次成功结果不变。

### 10.5 历史加载权威规则

阶段二历史比较的唯一权威来源固定为：

- `archive/<snapshot-date>/summary.json` 标记为成功的历史归档
- 与之同目录下的 `main-current.csv`

历史加载规则固定如下：

1. 扫描 `archive/` 下所有日期目录
2. 只纳入同时满足以下条件的目录作为候选历史：
   - 目录名是合法 `YYYY-MM-DD`
   - 存在 `summary.json`
   - `summary.json.status = success`
   - 存在 `main-current.csv`
3. 按 `snapshot_date` 倒序排序候选历史
4. 对于 `today-new.csv`，选择当前 `snapshot_date` 之前最近的一个成功历史作为“前一有效快照”
5. 对于 `recent-7d-new.csv`，选择当前 `snapshot_date` 之前最多 7 个自然日窗口内可用的成功历史
6. 对于损坏归档、缺文件归档、状态非成功归档，统一跳过并在本次 `summary.json` 中记录跳过原因

只有当前输入目录以外的所有可用历史都无法支撑最小比较时，才进入“历史不足”降级，而不是硬失败。

### 10.6 同日重跑归档规则

当同一个 `snapshot_date` 发生第二次及以上成功运行时，归档策略固定为：

- 目标归档目录仍然是同一个 `archive/<snapshot-date>/`
- 新结果以原子替换方式覆盖旧归档内容
- `latest/` 同样以新结果覆盖旧结果
- `summary.json` 中必须记录当前成功运行对应的 `input_dir` 与 `run_id`

也就是说：

- `archive/<snapshot-date>/` 表示该日期下最近一次成功生成的权威结果
- 不要求在阶段二保留同一 `snapshot_date` 的多次成功版本

## 十一、失败修复流程

### 11.1 输入缺失

如果缺少 `recruiting.csv` 或 `run-summary.json`：

- 回到阶段一重新执行提取
- 生成新的完整输入目录
- 再重跑阶段二

### 11.2 输入契约错误

如果 CSV 表头不符合契约，或关键字段结构损坏：

- 优先修复阶段一提取器或 CSV 契约生成逻辑
- 不在阶段二增加脏兼容

### 11.3 历史不足

如果历史不足：

- 允许降级运行
- 明确标记历史不足
- 后续运行会自然补齐

### 11.4 历史归档损坏

如果历史归档目录损坏：

- 跳过损坏归档并给出告警
- 若仅影响部分 7 天窗口覆盖，则本次结果降级
- 若连“前一有效快照”都无法确定，则 `today-new.csv` 与 `recent-7d-new.csv` 进入历史不足状态，但 `main-current.csv` 仍可生成
- 不自动篡改历史归档内容

### 11.5 环境与写盘失败

如果失败来自目录权限、磁盘写入、路径不可用：

- 修复环境后重跑
- 不进行部分覆盖

### 11.6 失败元数据

每次失败都应生成失败版 `summary.json`，至少包含：

- `status = failed`
- `failure_stage`
- `failure_reason`
- `input_dir`
- `snapshot_date`
- `suggested_action`

其中 `snapshot_date` 字段规则固定为：

- 如果本次运行已成功从 `recruiting.csv` 中识别出唯一 `snapshot_date`，则写入该值
- 如果失败发生在 `snapshot_date` 识别之前，或因 `snapshot_date` 识别失败而终止，则写入 `null`
- 此时允许额外写入调试字段，如 `input_dir_basename`，但不得使用目录名或文件时间去伪造 `snapshot_date`

失败元数据的写入位置固定为：

- `failed/<run-id>/summary.json`

## 十二、summary.json 设计

`summary.json` 至少应包含：

- `status`
- `run_id`
- `input_dir`
- `snapshot_date`
- `source_run_summary_path`
- `main_row_count`
- `today_new_count`
- `recent_7d_new_count`
- `history_window_requested = 7`
- `history_window_available`
- `diff_status`
- `archive_dir`
- `latest_updated`
- `history_candidates_checked`
- `history_candidates_skipped`
- `failure_stage`（失败时）
- `failure_reason`（失败时）
- `suggested_action`（失败时）

## 十三、测试与验收设计

### 13.1 单元测试

至少覆盖以下逻辑：

- 快照日期识别
- 输入目录选择：指定目录 / 自动选最新目录
- 今日新增判定
- 当前仍有效过滤
- 最近 7 天汇总逻辑
- 输入缺失、契约错误、历史不足、结果不更新 `latest/`

### 13.2 集成测试

使用多组小型 fixture 目录模拟真实提取输出，完整验证：

- `main-current.csv`
- `today-new.csv`
- `recent-7d-new.csv`
- `summary.json`
- `latest/` 更新规则
- `archive/` 归档规则

### 13.3 验收标准

实现完成后至少满足：

- 能处理显式指定的提取结果目录
- 能自动选择最新提取结果目录
- 能生成三个 CSV 和一个 `summary.json`
- 能同时维护 `latest/` 与 `archive/`
- 历史不足时能降级运行并明确标记
- 硬失败时不污染 `latest/`
- 失败时能给出明确修复建议

## 十四、后续实施顺序

推荐按以下顺序进入实现：

1. 定义阶段二输入目录定位与校验逻辑
2. 定义阶段二结果根目录与发布规则
3. 生成 `main-current.csv`
4. 实现历史加载与新增判定
5. 生成 `today-new.csv` 和 `recent-7d-new.csv`
6. 生成 `summary.json`
7. 补齐失败处理、降级逻辑与测试

这个顺序的目标是先把最小可用结果生成链路跑通，再把失败处理和历史窗口规则补齐，而不是一开始就把所有状态逻辑缠在一起。
