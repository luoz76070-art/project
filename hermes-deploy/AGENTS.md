## Codex Working Guidelines

## Repo Identity And Path Rules

- The canonical GitHub location for this project is `luoz76070-art/project`, under the subdirectory `hermes-deploy/`.
- Treat this codebase as the `hermes-deploy` subproject inside a monorepo, not as a standalone top-level GitHub repository.
- When updating CI, GitHub paths, or repo documentation, assume workflow files live at the monorepo root, while build and deploy commands for this project run from `hermes-deploy/`.
- When naming this project in docs or automation, prefer `Hugo-to-Nginx`.
- When enabling GitHub Actions, install the workflow into the monorepo root via `scripts/install_monorepo_workflow.sh` instead of creating workflow files inside this subproject.

These guidelines are adapted from the Karpathy-inspired coding rules and tuned for Codex-style repo work.

Use them whenever implementing, debugging, reviewing, or refactoring code in this repository.

They are meant to improve judgment, reduce unnecessary churn, and keep changes easy to verify.

### 1. Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs.

- State assumptions explicitly when requirements are ambiguous.
- If multiple interpretations are plausible, present them instead of choosing silently.
- If something is unclear enough to risk wasted work, pause and ask.
- If a simpler solution exists, prefer it and say so.

### 2. Simplicity First

Write the minimum code that solves the requested problem.

- No speculative features.
- No abstractions for one-off usage.
- No configurability that was not requested.
- No defensive complexity for implausible edge cases unless the context justifies it.
- If a solution feels bloated, simplify it before moving on.

Sanity check:

- Would a strong senior engineer call this overcomplicated?

If yes, rewrite it more simply.

### 3. Surgical Changes

Touch only what the task requires. Clean up only the mess your own change creates.

- Do not refactor adjacent code unless the task requires it.
- Do not rewrite comments, formatting, or naming outside the scope of the request.
- Match local patterns unless there is a strong reason not to.
- If you notice unrelated issues, mention them separately instead of folding them into the same change.

When your change leaves behind orphans:

- Remove imports, variables, functions, or branches made unused by your edit.
- Do not delete unrelated pre-existing dead code unless asked.

Every changed line should trace back to the user request.

### 4. Goal-Driven Execution

Turn requests into verifiable outcomes.

Prefer goals like:

- "Reproduce the bug, then make the reproduction pass."
- "Add validation and verify invalid cases fail correctly."
- "Refactor without changing behavior, then verify existing tests still pass."

For multi-step work, think in short loops:

1. Make one scoped change.
2. Verify it with the best available check.
3. Only then continue.

Weak goals like "make it work" create drift. Strong checks create leverage.

### 5. Codex-Specific Repo Behavior

- Prefer narrow diffs over broad cleanup.
- Prefer repo-local evidence over intuition.
- If tests or checks exist, use them to validate changes.
- If you cannot verify something, say so explicitly instead of implying certainty.
- Keep final explanations short, concrete, and tied to user-visible outcomes.

### Tradeoff

These guidelines intentionally bias toward caution over speed on non-trivial tasks.

For trivial fixes, use judgment and keep the process lightweight.
