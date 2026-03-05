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
echo "         --on-complete './scripts/gatekeeper.sh && git push origin HEAD && gh pr create --fill && ./scripts/agent-gate.sh'"
echo ""
echo -e "${YELLOW}⚠️  Agent invocation not yet wired. Complete Phase 2 to enable.${NC}"

echo -e "${YELLOW}🔀 Step 4/4: Gate + Merge${NC}"
echo "Once the agent finishes and pushes, run:"
echo "  gh pr create --fill"
echo "  ./scripts/agent-gate.sh"
