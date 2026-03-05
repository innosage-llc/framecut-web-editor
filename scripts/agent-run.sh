#!/bin/bash

# scripts/agent-run.sh
# Phase 2: Agent Dispatch — Fetch issue → Launch Claude Code → PR → agent-gate
# STATUS: STUB — Full implementation coming in Phase 2.

set -euo pipefail

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║        🤖 Agent Run — Dispatch Layer                     ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

# ==========================================================
# HELPER: Sync pending local changes to remote, then re-run
# ==========================================================
# Called before invoking agent-gate.sh to guarantee the remote PR
# reflects exactly what is on disk. If any sync was needed, the
# script re-execs itself so the gate always starts from a clean slate.
sync_and_rerun() {
    local SYNCED=false

    # 1. Uncommitted local changes → auto-commit
    if [ -n "$(git status --porcelain)" ]; then
        echo -e "   ${YELLOW}📦 Uncommitted changes detected. Auto-committing...${NC}"
        git add -A
        git commit -m "chore(agent): sync pending local changes before gate"
        SYNCED=true
    fi

    # 2. Committed but not pushed → push now
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    # Check if remote tracking branch exists
    if git rev-parse --verify "origin/$CURRENT_BRANCH" >/dev/null 2>&1; then
        UNPUSHED=$(git rev-list --count "origin/$CURRENT_BRANCH"..HEAD 2>/dev/null || echo 0)
    else
        # No remote tracking branch yet — treat all commits as unpushed
        UNPUSHED=1
    fi

    if [ "$UNPUSHED" -gt 0 ]; then
        echo -e "   ${YELLOW}🚀 Pushing ${UNPUSHED} unpushed commit(s) to origin/$CURRENT_BRANCH...${NC}"
        git push -u origin "$CURRENT_BRANCH"
        SYNCED=true
    fi

    # 3. If anything was synced, re-exec this script so we start fresh
    if [ "$SYNCED" = true ]; then
        echo -e "   ${GREEN}✅ Remote PR is now up to date. Restarting script...${NC}"
        echo ""
        exec "$0" "$@"
    fi

    echo -e "   ${GREEN}✅ No pending changes — remote is in sync.${NC}"
}

# ==========================================================
# USAGE
# ==========================================================
# ./scripts/agent-run.sh <issue-number>
# ./scripts/agent-run.sh --fix-review <pr-url>      (called by agent-gate.sh)
# ./scripts/agent-run.sh --fix-conflict <pr-url>    (called by agent-gate.sh)

MODE="${1:-}"

if [ -z "$MODE" ]; then
    echo -e "${RED}Usage: $0 <issue-number>${NC}"
    echo -e "${RED}       $0 --fix-review <pr-url>${NC}"
    echo -e "${RED}       $0 --fix-conflict <pr-url>${NC}"
    exit 1
fi

# ==========================================================
# MODE: Fix Review Comments (called by agent-gate.sh post-hold)
# ==========================================================
if [ "$MODE" = "--fix-review" ]; then
    PR_URL="${2:-}"
    echo -e "${YELLOW}📝 Phase 2 TODO: Address review comments on $PR_URL${NC}"
    echo ""
    echo "Planned implementation:"
    echo "  1. Fetch all unresolved review comments via: gh pr view --json reviewThreads"
    echo "  2. Feed comments + diff to Claude Code as context"
    echo "  3. Claude Code applies fixes locally"
    echo "  4. Reply to each comment with: gh pr comment --body 'Fixed in <commit>'"
    echo "  5. Push changes, then re-call agent-gate.sh"
    exit 0
fi

# ==========================================================
# MODE: Fix Merge Conflicts (called by agent-gate.sh post-hold)
# ==========================================================
if [ "$MODE" = "--fix-conflict" ]; then
    PR_URL="${2:-}"
    echo -e "${YELLOW}⚠️  Phase 2 TODO: Resolve merge conflict on $PR_URL${NC}"
    echo ""
    echo "Planned implementation:"
    echo "  1. Run: git merge origin/\$BASE_BRANCH (let it conflict)"
    echo "  2. Feed conflicted files to Claude Code as context"
    echo "  3. Claude Code resolves conflicts using SOUL.md principles"
    echo "  4. Run gatekeeper.sh to verify the resolution is safe"
    echo "  5. Commit + push, then re-call agent-gate.sh"
    exit 0
fi

# ==========================================================
# MODE: Issue → Agent → PR → Merge (main dispatch flow)
# ==========================================================
ISSUE_NUMBER="$MODE"

echo -e "${YELLOW}📋 Step 1/4: Fetching Issue #${ISSUE_NUMBER}${NC}"
ISSUE_BODY=$(gh issue view "$ISSUE_NUMBER" --json title,body,labels -q '
  "# " + .title + "\n\n" + .body
' 2>/dev/null || echo "")

if [ -z "$ISSUE_BODY" ]; then
    echo -e "${RED}❌ Error: Could not fetch issue #${ISSUE_NUMBER}.${NC}"
    exit 1
fi
echo -e "   ${GREEN}✅ Issue fetched${NC}"

echo -e "${YELLOW}🌿 Step 2/4: Creating feature branch${NC}"
BRANCH_NAME="feat/issue-${ISSUE_NUMBER}"
git checkout -b "$BRANCH_NAME" 2>/dev/null || git checkout "$BRANCH_NAME"
echo -e "   ${GREEN}✅ Branch: $BRANCH_NAME${NC}"

echo -e "${YELLOW}🤖 Step 3/4: Launching Agent${NC}"
echo ""
echo "Phase 2 TODO: Invoke Claude Code CLI with context:"
echo ""
echo "  claude --context AGENTS.md --context SOUL.md --context MEMORY.md \\"
echo "         --task \"\$ISSUE_BODY\" \\"
echo "         --on-complete './scripts/gatekeeper.sh && ./scripts/agent-run.sh $ISSUE_NUMBER'"
echo ""
echo -e "${YELLOW}⚠️  Agent invocation not yet wired. Complete Phase 2 to enable.${NC}"

echo -e "${YELLOW}🔀 Step 4/4: Sync → PR → Gate + Merge${NC}"
# Sync any pending local changes before opening the PR and running the gate.
# This is the key hook: after the agent finishes working locally, calling
# this script again (as shown above in --on-complete) will auto-push
# and then trigger the gate.
sync_and_rerun "$@"

# Open PR if not already open
PR_EXISTS=$(gh pr view --json number -q .number 2>/dev/null || echo "")
if [ -z "$PR_EXISTS" ]; then
    echo -e "   ${YELLOW}📬 Opening PR...${NC}"
    gh pr create --fill
fi

echo -e "   ${GREEN}🚀 Running agent-gate.sh...${NC}"
./scripts/agent-gate.sh
