<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

## 本项目约定

- 默认中文；先读 `docs/project-index.md`、相关 Trellis spec 与当前 task。
- 已明确要求执行的任务可在写好 PRD、design、implement 并自审后开始，不为模板中的流程门重复索要批准；产品范围有实质歧义时才澄清。
- Git采用用户2026-10-23确认的流程：独立功能/修复及相关检查完成后分步本地提交，完整版本验收后集中推送现有origin并打对应版本标签。仅咨询/分析不产生Git写入；预览版标签必须含preview，不能将待真机验收称为稳定版。具体操作见`docs/ops/version-sync.md`。
- 本项目是父仓库中的`codex-to-phone/`子目录，只暂存/提交本项目路径；有用户既有暂存项时保留并停止自动提交。推送前核对全部未推送提交范围，其他工程修改保持；不force、不自动merge/rebase、不改remote/上游，不自动建分支、仓库、PR或GitHub Release。Trellis自动提交继续关闭，提交由上述显式流程执行。
- 保留工作区既有修改；结构迁移保留启动、构建和打包入口。
- `apps/mobile` 是 React/Capacitor 前端；`apps/relay` 是 Fastify 服务与 Broker/Tunnel；不把两种运行时的代码混入共享大包。
- 优化顺序以 `docs/audits/2026-10-20/README.md` 为准。UI 参考 Codex 手机版，实施前建立真实参考基线。
- 单元/隔离测试不得读取真实 Codex 会话、提交模型任务或自动部署；真实控制验收单独记录。
