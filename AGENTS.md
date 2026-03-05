# AGENTS.md - Operational Rules for Agents

## The Non-Negotiable "Gate"
Every task MUST pass the Gate before it is considered complete. No exceptions.
The Gate command for this repository is:
`npm run build` (via `scripts/gatekeeper.sh`)

## Atomic Agentic Committing
- One logical change per commit.
- Agents should commit early and often once the Gate passes.
- Use descriptive commit messages following Conventional Commits.

## Closing the Loop
1. **Identify**: Read the task/issue.
2. **Execute**: Modify the code.
3. **Verify (The Gate)**: Run `./scripts/gatekeeper.sh`. If it fails, fix and repeat until it passes.
4. **Commit/Push**: Create a feature branch and submit a PR via `gh pr create --fill`.
5. **Optimistic Merge (The 10-Minute Rule)**:
   - Once a PR is open and the Gate is green, call `./scripts/agent-gate.sh` to initiate the merge flow.
   - **Condition**: There must be NO pending code review comments or change requests.
   - **Action**: If 10 minutes pass with no feedback, the script will squash-merge automatically.
   - **Logging**: The gate script posts a PR comment and logs the completion in `AUDIT.md`.

## Trust Tiers
The Gate assigns trust tiers based on which files changed:
- `trust:low` — docs, markdown, config → immediate merge
- `trust:medium` — source code (non-critical) → 10-min hold, then merge
- `trust:high` — `src/auth`, `infra`, `.github/workflows` → **human review required**

## Workspace Structure
- `MEMORY.md`: Long-term curated memory.
- `ACTIVE_TASKS.md`: Orchestration of current work.
- `AUDIT.md`: Auto-generated merge audit trail.
- `scripts/gatekeeper.sh`: The local validation script (run this before every PR).
- `scripts/agent-gate.sh`: The full CI loop (sync → gate → label → merge).
