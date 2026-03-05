#!/bin/bash

# scripts/agent-gate.sh
# Automated Agent CI workflow: sync with master, run local gatekeeper, trust-tier, auto-merge

set -euo pipefail

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║        🤖 Agent Gate CI Workflow                         ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

# ==========================================================
# STEP 1: Pre-flight Checks
# ==========================================================
echo -e "${YELLOW}📋 Step 1/5: Pre-flight Checks${NC}"

if ! command -v gh &> /dev/null; then
    echo -e "${RED}❌ Error: GitHub CLI (gh) is not installed.${NC}"
    exit 1
fi

if ! gh auth status &> /dev/null; then
    echo -e "${RED}❌ Error: Not authenticated with GitHub CLI.${NC}"
    exit 1
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo -e "   Current Branch: ${GREEN}${BRANCH}${NC}"

if [ "$BRANCH" = "master" ] || [ "$BRANCH" = "master" ]; then
    echo -e "${RED}❌ Error: Cannot run agent-gate on master/master branch.${NC}"
    exit 1
fi

PR_URL=$(gh pr view --json url -q .url 2>/dev/null || echo "")
PR_NUMBER=$(gh pr view --json number -q .number 2>/dev/null || echo "")
PR_STATE=$(gh pr view --json state -q .state 2>/dev/null || echo "")

if [ -z "$PR_URL" ]; then
    echo -e "${RED}❌ Error: No Pull Request found for branch '${BRANCH}'.${NC}"
    echo "Please create a PR first (e.g., gh pr create --fill)."
    exit 1
fi

echo -e "   PR Found: ${GREEN}#${PR_NUMBER}${NC} (${PR_STATE})"

if [ "$PR_STATE" = "MERGED" ]; then
    echo -e "${GREEN}✅ PR already merged. Nothing to do.${NC}"
    exit 0
fi

git fetch origin "$BRANCH" >/dev/null 2>&1
LOCAL_HASH=$(git rev-parse HEAD)
REMOTE_HASH=$(git rev-parse "origin/$BRANCH")

if [ "$LOCAL_HASH" != "$REMOTE_HASH" ]; then
    echo -e "${RED}❌ Error: Local branch is not synced with remote origin/${BRANCH}.${NC}"
    echo "   Please push your changes first."
    exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
    echo -e "${RED}❌ Error: Uncommitted changes detected.${NC}"
    exit 1
fi

# ==========================================================
# STEP 2: Sync with Main
# ==========================================================
echo -e "${YELLOW}🔄 Step 2/5: Syncing with master branch${NC}"
git fetch origin master >/dev/null 2>&1

BEHIND_COUNT=$(git rev-list --count HEAD..origin/master)
if [ "$BEHIND_COUNT" -gt 0 ]; then
    echo -e "   ${YELLOW}Behind master by ${BEHIND_COUNT} commits. Merging...${NC}"
    if git merge origin/master --no-edit; then
        echo -e "   ${GREEN}✅ Successfully merged master${NC}"
        git push origin HEAD
    else
        echo -e "${RED}❌ Error: Merge conflicts detected with master branch.${NC}"
        git merge --abort
        exit 1
    fi
else
    echo -e "   ${GREEN}Already up to date with master${NC}"
fi

# ==========================================================
# STEP 3: Run Local Gate
# ==========================================================
echo -e "${YELLOW}🧪 Step 3/5: Running Local Gatekeeper${NC}"
START_TIME=$(date +%s)

if [ ! -f "./scripts/gatekeeper.sh" ]; then
    echo -e "${RED}❌ Error: ./scripts/gatekeeper.sh not found.${NC}"
    exit 1
fi

chmod +x ./scripts/gatekeeper.sh

CI_PASSED=true
if ./scripts/gatekeeper.sh; then
    echo -e "   ${GREEN}✅ Gatekeeper passed${NC}"
else
    echo -e "   ${RED}❌ Gatekeeper failed${NC}"
    CI_PASSED=false
fi

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
DURATION_MIN=$((DURATION / 60))
DURATION_SEC=$((DURATION % 60))

# ==========================================================
# STEP 4: Post Results & Trust Tier
# ==========================================================
echo -e "${YELLOW}💬 Step 4/5: Posting results & Trust Tier${NC}"

if [ "$CI_PASSED" = true ]; then
    STATUS_ICON="✅"
    STATUS_TEXT="Passed"
else
    STATUS_ICON="❌"
    STATUS_TEXT="Failed"
fi

COMMENT_BODY="### ${STATUS_ICON} Local Gate ${STATUS_TEXT}
**Context**: Agent Gate Workflow
**Commit**: \`$(git rev-parse --short HEAD)\`
**Duration**: ${DURATION_MIN}m ${DURATION_SEC}s"

gh pr comment "$PR_URL" --body "$COMMENT_BODY" >/dev/null

if [ "$CI_PASSED" = false ]; then
    echo -e "${RED}❌ Gate failed. Agent loop will catch this and retry.${NC}"
    exit 1
fi

CHANGED_FILES=$(git diff --name-only origin/master...HEAD)

# Determine Trust Tier
if echo "$CHANGED_FILES" | grep -qE '^(src/auth|src/payment|src/payments|infra|\.github/workflows)/'; then
    TRUST="high"
elif echo "$CHANGED_FILES" | grep -qvE '^(docs/|.*\.md$|package\.json$)'; then
    # Has changes outside of docs, md files, and package.json
    TRUST="medium"
else
    # Only docs/md/package.json
    TRUST="low"
fi

echo -e "   Trust Tier assigned: ${BLUE}${TRUST}${NC}"

# Update PR labels
gh pr edit "$PR_URL" --remove-label "trust:low,trust:medium,trust:high" 2>/dev/null || true
gh pr edit "$PR_URL" --add-label "trust:${TRUST}" >/dev/null 2>&1 || echo "   ⚠️ Could not add label (create it in repo settings to silence this)"

# ==========================================================
# STEP 5: Merge PR
# ==========================================================
echo -e "${YELLOW}🔀 Step 5/5: Merging Pull Request${NC}"

if [ "$TRUST" = "high" ]; then
    echo -e "${YELLOW}⚠️ Trust Tier HIGH. Human review required. Stopping here.${NC}"
    exit 0
fi

if [ "$TRUST" = "medium" ]; then
    echo -e "${YELLOW}⏳ Trust Tier MEDIUM. Waiting 10s (simulating 10 min hold) before merge...${NC}"
    # In a full deployment, this is `sleep 600`. Shortened here for testing loops.
    sleep 10
fi

# Log to audit
TIMESTAMP=$(date "+%Y-%m-%d %H:%M:%S")
echo -e "- **${TIMESTAMP}**: Merged PR [#${PR_NUMBER}](${PR_URL}) (Trust: \`${TRUST}\`)" >> AUDIT.md

echo -e "   Merging PR #${PR_NUMBER} with squash..."
if gh pr merge "$PR_NUMBER" --squash; then
    echo -e "${GREEN}✅ PR merged successfully!${NC}"
    exit 0
else
    echo -e "${RED}❌ Failed to merge PR${NC}"
    exit 1
fi
