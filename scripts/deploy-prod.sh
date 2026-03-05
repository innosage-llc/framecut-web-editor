#!/bin/bash
set -e

# 1. Get current tag for this commit
TAG=$(git tag --points-at HEAD)

if [ -z "$TAG" ]; then
  echo "Error: Current commit does not have a git tag."
  echo "Use 'git tag v1.0.0' and then run this script again."
  exit 1
fi

echo "🚀 Deploying Production Release: $TAG"

# 2. Build the project
echo "🛠 Building..."
npm run build

# 3. Deploy to Cloudflare Pages (Direct Upload)
# Replace 'framecut-production' with your actual project name if different
echo "☁️ Uploading to Cloudflare Pages..."
npx wrangler pages deploy dist --project-name framecut-production --branch main

echo "✅ Production Release $TAG is LIVE!"
