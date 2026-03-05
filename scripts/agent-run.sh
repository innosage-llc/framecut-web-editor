#!/bin/bash

# scripts/agent-run.sh
# Phase 2: Agent-Agnostic Workflow CLI
# Used by agents (or humans) to start issues and safely finish/merge them.

set -euo pipefail

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║        🤖 Agent Run — Workflow CLI                       ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

# ==========================================================
# HELPER: Sync pending local changes to remote, then re-run
# ==========================================================
sync_and_rerun() {
    local SYNCED=false

    if [ -n "$(git status --porcelain)" ]; then
        echo -e "   ${YELLOW}📦 Uncommitted changes detected. Auto-committing...${NC}"
        git add -A
        git commit -m "chore(agent): sync pending local changes before gate"
        SYNCED=true
    fi

    local CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    local UNPUSHED=1
    if git rev-parse --verify "origin/$CURRENT_BRANCH" >/dev/null 2>&1; then
        UNPUSHED=$(git rev-list --count "origin/$CURRENT_BRANCH"..HEAD 2>/dev/null || echo 0)
    fi

    if [ "$UNPUSHED" -gt 0 ]; then
        echo -e "   ${YELLOW}🚀 Pushing ${UNPUSHED} unpushed commit(s) to origin/$CURRENT_BRANCH...${NC}"
        git push -u origin "$CURRENT_BRANCH"
        SYNCED=true
    fi

    if [ "$SYNCED" = true ]; then
        echo -e "   ${GREEN}✅ Remote PR is now up to date. Restarting script...${NC}"
        echo ""
        exec "$0" "$@"
    fi
}

# ==========================================================
# USAGE
# ==========================================================
MODE="${1:-}"

if [ -z "$MODE" ]; then
    echo -e "${RED}Usage: $0 start <issue-number>   — Prepare workspace & fetch context${NC}"
    echo -e "${RED}       $0 finish                 — Sync, open PR, and run gate${NC}"
    echo -e "${RED}       $0 --fix-review <pr-url>  — (Called by agent-gate)${NC}"
    echo -e "${RED}       $0 --fix-conflict <pr-url>— (Called by agent-gate)${NC}"
    exit 1
fi

# ==========================================================
# MODE: START <issue-number>
# ==========================================================
if [ "$MODE" = "start" ]; then
    TASK_INPUT="${2:-}"
    if [ -z "$TASK_INPUT" ]; then
        echo -e "${RED}❌ Error: Please provide an issue number or a literal prompt.${NC}"
        echo -e "   Examples:"
        echo -e "     $0 start 42"
        echo -e "     $0 start 'address code review for PR 6'"
        exit 1
    fi

    if [[ "$TASK_INPUT" =~ ^[0-9]+$ ]]; then
        # It's an issue number
        echo -e "${YELLOW}📋 Fetching Issue #${TASK_INPUT}...${NC}"
        ISSUE_BODY=$(gh issue view "$TASK_INPUT" --json title,body,labels -q '
          "# " + .title + "\n\n" + .body
        ' 2>/dev/null || echo "")

        if [ -z "$ISSUE_BODY" ]; then
            echo -e "${RED}❌ Error: Could not fetch issue #${TASK_INPUT}.${NC}"
            exit 1
        fi
        echo -e "   ${GREEN}✅ Issue fetched${NC}"
        BRANCH_NAME="feat/issue-${TASK_INPUT}"
    else
        # It's a text prompt
        echo -e "${YELLOW}📋 Using provided prompt as context...${NC}"
        ISSUE_BODY="# Context\n\n$TASK_INPUT"
        # Generate a branch name by lowercasing, replacing non-alphanumeric with dashes, and trimming length
        SLUG=$(echo "$TASK_INPUT" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '-' | sed -e 's/-\{2,\}/-/g' -e 's/^-//' -e 's/-$//' | cut -c1-30)
        if [ -z "$SLUG" ]; then SLUG=$(date +%s); fi
        BRANCH_NAME="feat/task-${SLUG}"
    fi

    echo -e "${YELLOW}🌿 Creating feature branch: ${BRANCH_NAME}${NC}"
    git checkout -b "$BRANCH_NAME" 2>/dev/null || git checkout "$BRANCH_NAME"
    echo -e "   ${GREEN}✅ Branch ready${NC}"

    echo ""
    echo -e "${BLUE}=================== TASK CONTEXT ===================${NC}"
    echo -e "$ISSUE_BODY"
    echo -e "${BLUE}====================================================${NC}"
    echo ""
    echo -e "${GREEN}Work environment ready! You can now start coding.${NC}"
    echo -e "When you are done, run: ${YELLOW}./scripts/agent-run.sh finish${NC}"
    exit 0
fi

# ==========================================================
# MODE: FINISH
# ==========================================================
if [ "$MODE" = "finish" ]; then
    echo -e "${YELLOW}🔀 Preparing to finish task and merge...${NC}"

    # Sync local changes before opening the PR
    sync_and_rerun "$@"

    # Open PR if not already open
    PR_EXISTS=$(gh pr view --json number -q .number 2>/dev/null || echo "")
    if [ -z "$PR_EXISTS" ]; then
        echo -e "   ${YELLOW}📬 Opening PR...${NC}"
        gh pr create --fill
    else
        echo -e "   ${GREEN}✅ PR already open (#${PR_EXISTS})${NC}"
    fi

    echo -e "   ${GREEN}🚀 Handing off to agent-gate.sh...${NC}"
    echo ""
    exec ./scripts/agent-gate.sh
fi

# ==========================================================
# MODE: Fix Review Comments (called by agent-gate.sh post-hold)
# ==========================================================
if [ "$MODE" = "--fix-review" ]; then
    PR_URL="${2:-}"
    echo -e "${YELLOW}📝 TODO: Agent addresses review comments on $PR_URL${NC}"
    # This feature requires reading PR threads, making fixes, and pushing.
    # We will expand this in future tasks.
    echo "  (Stubbed behavior: Exiting for manual intervention)"
    exit 1
fi

# ==========================================================
# MODE: Fix Merge Conflicts (called by agent-gate.sh post-hold)
# ==========================================================
if [ "$MODE" = "--fix-conflict" ]; then
    PR_URL="${2:-}"
    echo -e "${YELLOW}⚠️  TODO: Agent resolves merge conflict on $PR_URL${NC}"
    # This feature requires calling git merge and instructing the agent to resolve files.
    # We will expand this in future tasks.
    echo "  (Stubbed behavior: Exiting for manual intervention)"
    exit 1
fi

echo -e "${RED}❌ Error: Unknown mode '$MODE'.${NC}"
exit 1
