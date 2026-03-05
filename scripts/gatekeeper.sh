#!/bin/bash
set -e

echo "🛡️ Starting Gatekeeper checks..."

echo "🏗️ Running Build..."
npm run build

echo "✅ Gate Passed! The changes are safe to commit."
