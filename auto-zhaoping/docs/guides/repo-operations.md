# 仓库日常操作手册

这份文档放在 `docs/guides/repo-operations.md`，用于说明这个仓库平时怎么查看、怎么测试、怎么跑三阶段流水线。

## 1. 仓库里主要看什么

- `README.md`：仓库导航入口。
- `docs/README.md`：文档总索引。
- `packages/tencent-docs-recruiting-extractor/README.md`：阶段一提取说明。
- `packages/local-recruiting-results/README.md`：阶段二结果生成说明。
- `packages/tencent-docs-writeback/README.md`：阶段三回写说明。
- `docs/architecture/project-architecture-analysis.md`：完整架构分析。

## 2. 日常最常用的命令

### 跑测试

```bash
npm test
```

### 分阶段跑测试

```bash
npm run test:extractor
npm run test:local-results
npm run test:writeback
```

### 生成本地结果

```bash
npm run generate:local-results
```

### 执行腾讯文档回写

```bash
npm run writeback:tencent-docs
```

## 3. 结果通常放在哪里

- 阶段一结果：`packages/tencent-docs-recruiting-extractor/output/<run-id>/`
- 阶段二结果：`results/local-recruiting/latest/`
- 阶段三结果：`results/tencent-docs-writeback/runs/<run-id>/`

## 4. 平时怎么排查

1. 先看 `git status`，确认有没有未提交改动。
2. 再看对应包的 README，确认输入输出位置。
3. 再跑对应包的测试。
4. 如果是结果异常，优先看 `summary.json`、`run-summary.json`、`report.json`。

## 5. 常见场景

### 场景 A：我只想确认仓库是不是正常

```bash
npm test
```

### 场景 B：我只想重算本地结果

```bash
npm run generate:local-results
```

### 场景 C：我只想把最新结果写回腾讯文档

```bash
npm run writeback:tencent-docs
```

## 6. 这个仓库的操作顺序建议

1. 先读根 `README.md`。
2. 再读 `docs/README.md`。
3. 再读对应 package 的 README。
4. 最后根据任务执行测试或流水线命令。

## 7. 最短记忆法

- 根 README：先看仓库怎么组织。
- `docs/README.md`：再看文档入口。
- package README：最后看具体怎么跑。

如果你想把这个仓库用得稳，先把这份手册当成日常操作入口。
