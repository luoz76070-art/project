# 设计

## 边界

迁移只改变 Git 工作树的项目边界和文档/CI 路径。`apps/kelivo`、`apps/mobile`、`apps/relay` 的职责、包名、协议和运行逻辑保持不变。

## 迁移顺序

1. 使用现有外部快照作为回退点，并生成本轮清单。
2. 将无关项目移动到新的外部归档目录，保留目录内容和根仓库 Git bundle。
3. 将 Hermes 根级 workflow 单独移出 MobiCodex 工作树。
4. 逐文件把 `codex-to-phone` 的必要源码、配置、隐藏规则和历史资料提升到仓库根目录；遇到冲突先保留旧文件并报告。
5. 合并普通 MobiCodex CI，保留 `test:messages`；Release workflow 统一根目录路径。
6. 更新当前文档和脚本路径，历史审计记录保留原始事实。
7. 运行 Git、pnpm、Android 和 YAML/路径检查。

## 冲突处理

根 `README.md`、`SECURITY.md` 不覆盖：旧版本先保存到外部归档，再使用 MobiCodex 对应文件；根 `docs/`、`plugins/` 先保留用户已有内容，只有目标文件不存在时才补入。

## 回退

使用 `inventory/project-history.bundle` 恢复 Git 历史；使用 `working-tree-source/` 和 `moved-projects/` 恢复工作树文件。所有移动前均检查目标不存在，禁止覆盖。
