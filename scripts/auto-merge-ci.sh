#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

./scripts/run-local-ci.sh "$@"
pr_number="$(gh pr view --json number -q .number 2>/dev/null || true)"
if [[ -z "$pr_number" ]]; then
  pr_number="$(gh pr list --state open --search "$(git rev-parse HEAD)" --json number -q '.[0].number')"
fi
pr_state="$(gh pr view "$pr_number" --json state -q .state)"
[[ "$pr_state" == "OPEN" ]] || { printf 'PR #%s is %s; nothing to merge.\n' "$pr_number" "$pr_state"; exit 0; }
created_at="$(gh pr view "$pr_number" --json createdAt -q .createdAt)"
age_seconds="$(python3 - "$created_at" <<'PY'
import datetime
import sys

created = datetime.datetime.fromisoformat(sys.argv[1].replace('Z', '+00:00'))
print(int((datetime.datetime.now(datetime.timezone.utc) - created).total_seconds()))
PY
)"
if (( age_seconds < 600 )); then
  printf 'PR #%s is %ss old; FrameCut requires a 10-minute human-review window before auto-merge.\n' "$pr_number" "$age_seconds" >&2
  exit 1
fi
review_decision="$(gh pr view "$pr_number" --json reviewDecision -q .reviewDecision)"
if [[ "$review_decision" == "CHANGES_REQUESTED" ]]; then
  printf 'PR #%s has requested changes and cannot be auto-merged.\n' "$pr_number" >&2
  exit 1
fi
gh pr merge "$pr_number" --squash --delete-branch
