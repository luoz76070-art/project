# MobiCodex 仓库边界迁移

## 目标

将父仓库 `project` 整理为以 MobiCodex 为主的仓库：把 `codex-to-phone` 的源码和构建入口提升到仓库根目录，将其他项目移到仓库外的可恢复归档位置，并修正 CI、文档和路径引用。

## 约束

- 保留用户当前修改和未跟踪的 MobiCodex 文档/插件/宣传项目。
- 不改变产品功能、协议、应用 ID、签名、真实会话、token、设备数据或部署环境。
- 不使用 `git reset`、`git clean`、`rm -rf`；不覆盖已有文件。
- 不提交、推送、建分支或创建 PR。
- 不把依赖、构建输出、日志、个人配置和设备数据加入 Git。

## 验收标准

1. Git 根目录保留 MobiCodex 的 `apps`、`docs`、`generated-protocol`、`integrations`、`plugins`、`scripts`、`releases`、Trellis 和构建入口。
2. 其他项目不再作为仓库根级项目参与 MobiCodex 工作树，并可从外部归档恢复。
3. 普通 CI 与 Android/Release workflow 使用仓库根目录，MobiCodex 重复 CI 已合并且保留独有检查。
4. README、项目文档、脚本和当前有效发布地址不再依赖错误的 `codex-to-phone/` 前缀。
5. `pnpm install --frozen-lockfile`、lint、typecheck、build、指定隔离测试和 Android 检查按环境完成或明确记录原因。
6. 未提交用户修改得到保留，且不产生提交、推送或 PR。
