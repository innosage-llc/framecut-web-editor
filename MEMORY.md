# MEMORY.md - Long-Term Agent Memory

## Setup Notes
- 2026-03-05: Agentic framework bootstrapped. `agent-gate.sh` and `gatekeeper.sh` installed.
- Base branch is `master` (not `main`). `agent-gate.sh` is parameterized via `BASE_BRANCH`.
- Trust labels (`trust:low`, `trust:medium`, `trust:high`) are auto-created by the gate script.
- `gh` CLI must be on PATH. Use `PATH="/opt/homebrew/bin:$PATH" ./scripts/agent-gate.sh` if needed.

## Learnings
- The gate script uses `set -euo pipefail`. All commands must succeed or the script exits.
- `git merge --no-commit --no-ff` is used as a dry-run conflict check in `post_hold_check`.
