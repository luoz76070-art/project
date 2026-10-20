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
- 不暂存、提交、推送、建分支或 PR。Trellis 的自动提交已关闭，模板中的 commit 步骤需等待用户明确指令。
- 保留工作区既有修改；结构迁移保留启动、构建和打包入口。
- `apps/mobile` 是 React/Capacitor 前端；`apps/relay` 是 Fastify 服务与 Broker/Tunnel；不把两种运行时的代码混入共享大包。
- 优化顺序以 `docs/audits/2026-10-20/README.md` 为准。UI 参考 Codex 手机版，实施前建立真实参考基线。
- 单元/隔离测试不得读取真实 Codex 会话、提交模型任务或自动部署；真实控制验收单独记录。
