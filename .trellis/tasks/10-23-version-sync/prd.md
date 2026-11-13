# 版本完成后集中同步GitHub

## Goal

落实用户确认的分步本地提交、完整版本验收后集中推送与版本标签流程；限定codex-to-phone子目录，建立APK30预览源码基线，保留其他工程修改。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
# 版本完成后集中同步GitHub

用户2026-10-23确认采用：独立功能/修复完成后分步本地提交，完整版本验收后集中推送GitHub并标记版本；开发跨度较长时另做本地备份。

## 范围

- 沿用现有origin/main，不新建仓库或分支；Git根目录为父目录project，本轮只提交codex-to-phone子目录。
- 将当前APK30源码积累建立为明确的预览基线；不将待真机验收的预览称为稳定正式版。
- 将约定写入项目AGENTS及可重复使用的操作文档，手机或电脑发起任务遵循相同工程流程。
- 凭证/运行文件/安装包继续忽略；不改产品运行代码、不重新部署、不发布额外GitHub Release。

## 验收

1. 核对空暂存区、原分支/上游、远端状态，保存当前差异和未跟踪源码备份。
2. 本项目源码检查、凭证扫描及Git差异检查通过；提交清单仅含本项目，其他工程工作区修改保留。
3. GitHub main包含本轮源码提交，带明确preview标签；核验远端OID等于本地目标提交。
4. 后续提交/版本验收/推送/长周期备份规则可由项目文档直接执行，现有构建与安装入口保持。
