# Project Architecture Analysis

## 1. Five-Layer Repo Structure

The current repo reads as five practical layers:

1. **Root orchestration layer**
   - `package.json` defines the workspace set and cross-package scripts.
   - `README.md` is the repo entry point and phase navigator.
2. **Formal package layer**
   - `packages/` contains the three executable npm workspaces.
3. **Vendor baseline layer**
   - `vendor/tencent-docs-extractor-baseline/` holds the read-only reference snapshot.
4. **Results layer**
   - `results/` is the runtime artifact namespace used by package contracts.
   - It is currently documented but not physically present in this worktree.
5. **Docs layer**
   - `docs/` contains the navigation index plus historical plans, specs, and logs.
   - `docs/architecture/` is the right home for repo-level architecture notes like this one.

## 2. Three Formal Packages

The only formal workspaces are the three entries under `packages/*`:

- `@zhaoping/tencent-docs-recruiting-extractor`
  - Reads Tencent Docs source data.
  - Emits `output/<run-id>/recruiting.csv` and `run-summary.json`.
  - Does not own results aggregation or writeback.
- `@zhaoping/local-recruiting-results`
  - Consumes extractor output.
  - Produces `results/local-recruiting/latest/`, `archive/`, and `failed/` artifacts.
  - Does not re-open Tencent Docs or perform target writes.
- `@zhaoping/tencent-docs-writeback`
  - Consumes `results/local-recruiting/latest/main-current.csv` and `summary.json`.
  - Writes back to the Tencent Docs target table and records audit output.
  - Does not recompute extraction or local result diffs.

## 3. Vendor Baseline Role

`vendor/tencent-docs-extractor-baseline/` is a read-only snapshot of the original extractor lineage.

- It exists as a reference baseline, not as an active workspace.
- It preserves browser automation and extraction patterns for comparison and audit.
- It should stay isolated from the formal package lifecycle and runtime result flow.

## 4. Results Layer Classification

`results/` is the repository's artifact layer, not a source layer.

- It contains generated data, run reports, and state files.
- It serves both operational consumption and audit retention.
- It should be treated as contract output, not editable product code.

Current documented result boundaries are:

- extractor output: `packages/tencent-docs-recruiting-extractor/output/<run-id>/`
- local results: `results/local-recruiting/{latest,archive,failed}/`
- writeback audit: `results/tencent-docs-writeback/{runs,state.json}`

## 5. Docs, Index, Log, Plan, Spec Roles

`docs/` is the durable documentation layer.

- `docs/README.md` is the repo-level document index.
- `docs/superpowers/README.md` is the sub-index for historical design material.
- `docs/superpowers/logs/` records execution history and cleanup decisions.
- `docs/superpowers/plans/` captures implementation intent and task boundaries.
- `docs/superpowers/specs/` captures design contracts and phase definitions.

These files are keepers, not cleanup noise.

## 6. Service-Ready Module Boundaries

The current file layout is compatible with a service-ready split, and the existing package boundaries suggest a low-friction path if future frontend/backend integration is needed.

- **Frontend boundary**
  - Show extractor summaries from `run-summary.json`.
  - Show local result views from `summary.json` and the CSVs in `results/local-recruiting/latest/`.
  - Show writeback status from `results/tencent-docs-writeback/runs/<run-id>/report.json`.
- **Backend boundary**
  - Orchestrate the three packages as separate jobs.
  - Keep each package behind its current file contract instead of exposing internals.
  - Preserve the package-to-package dependency direction already documented in the READMEs.

The current practical boundary is file-based I/O. That is the observed integration style today, and it is the safest seam to preserve until an API or job system is introduced.

## 7. Data Contract and Persistence Reservations

The current system is file-first and should stay that way until a persistence design is explicitly introduced.

- Use the existing CSV and JSON outputs as the working contracts for the three packages.
- Do not pre-map files to database tables or API payloads without a concrete persistence requirement.
- Treat these fields as candidate persistence keys only: `record_id`, `snapshot_date`, `source_url`, `extracted_at`, `run_id`, and the writeback report/state metadata.
- Keep `summary.json`, `run-summary.json`, and `report.json` as the current audit trail for future integrations.

These reservations are placeholders for future database keys, upsert rules, and cross-service schema decisions, not a claim that the schemas are already fixed.
