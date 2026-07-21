# 项目瘦身与整理日志

## 范围

- 仓库：`zhaoping`
- 目标：架构分析、项目瘦身、目录职责澄清、服务化预留

## 分类规则

### 保留
- 正式业务包源码
- 必要测试
- 有效设计/计划/日志
- 业务结果与审计价值产物
- `docs/superpowers/` 中的历史 specs / plans / logs，已通过索引保留而非删除

### 整理
- README 体系
- docs 索引
- vendor 定位说明
- results 分类说明

### 删除
- 仅删除已确认的 `.DS_Store` 和其他临时噪音文件
- 不删除结果资产、文档日志或审计产物
- 成功运行后不再需要的调试噪音

## 执行记录

### 1. 初始扫描
- `git status --short` 当前显示工作树已存在 `M package-lock.json`，后续整理需避免误改该文件。
- 当前工作树中的主结构以 `packages/`、`vendor/`、`docs/` 为主；`results/` 作为运行产物层在主仓库中存在，但在本隔离工作树中尚未检出实体目录。
- 根工作区 `package.json` 将工作区范围定义为 `packages/*`，当前对应三个正式包：`packages/tencent-docs-recruiting-extractor/`、`packages/local-recruiting-results/`、`packages/tencent-docs-writeback/`。
- `npm --workspaces --silent exec -- pwd` 在本次环境中未返回额外路径输出，后续目录说明以当前工作区定义和实际包目录为准。

### 2. 删除清单
- 已检查当前工作树，未发现可安全删除的 `.DS_Store` 实体文件。
- 删除规则已收敛为只处理已确认的本地噪音，不影响 `docs/superpowers/logs/` 等结果资产路径。

### 3. 保留清单
- 保留三个正式业务包源码、测试、配置示例。
- 在主仓库层面保留 `results/` 中 latest/archive/run 级别的业务与审计产物，不把它们误当作纯临时文件清空。
- 保留 `docs/superpowers/` 中已有设计、计划、日志，并通过 `docs/superpowers/README.md` 建立索引澄清状态。
- 保留 `vendor/tencent-docs-extractor-baseline` 作为参考基线层。

### 4. 风险与未处理项
- 主仓库 `results/` 中历史内容不能粗暴删除，需逐类判断业务与审计价值。
- `vendor/` 中仍被正式包引用的代码不可误删。
- 需核查 `packages/tencent-docs-recruiting-extractor/.browser-profile/`、相关 `output/` 目录等路径是否仍被运行流程依赖。
- 所有整理动作完成后必须重新运行三个正式包的测试验证结构未破坏。

## 文档缺口

- 根目录 `README.md` 所需的导航入口与目录职责说明已在 Task 2 中补上，后续只需在更完整架构分析文档完成后再补充深度链接。
- `docs/README.md` 已在 Task 2 中建立为总索引，后续继续扩展索引覆盖范围。
- `docs/superpowers/README.md` 已补为子索引，后续新增的历史文档应继续挂到这里而不是删除归档。

## README 模板补充

- Task 3 已将三个正式包 README 统一为同一模板顺序：`包职责`、`输入`、`输出`、`核心命令`、`上下游关系`、`当前状态`、`未来前后端/数据库接入预留`。
- 模板要求仅记录当前仓库内已存在且已验证的输入输出边界，不提前承诺尚未落地的服务化、前端或数据库实现。

## Task 6 完成记录

- 新增 `docs/architecture/project-architecture-analysis.md`，作为仓库级架构分析入口。
- 这份架构分析整理了当前五层结构、三个正式包、vendor 基线、results 产物层、docs/superpowers 索引体系的职责边界。
- 该分析同时给出了面向未来前后端/数据库接入的 service-ready 预留说明，强调现阶段仍以文件契约为准，不改写现有结果语义。

## Task 7 完成记录

- 已运行三个正式包测试：`npm --workspace @zhaoping/tencent-docs-recruiting-extractor test`、`npm --workspace @zhaoping/local-recruiting-results test`、`npm --workspace @zhaoping/tencent-docs-writeback test`。
- 三个测试套件均通过，结果分别为 `22 passed / 0 failed`、`11 passed / 0 failed`、`24 passed / 0 failed`。
- 在这三个测试套件中未观察到回归，未修改任何代码，仅补充了最终验证记录。
