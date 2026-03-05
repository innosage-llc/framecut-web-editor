# IDENTITY.md - Repository Identity

## Repository
- **Name**: framecut-web-editor
- **Org**: innosage-llc
- **GitHub**: https://github.com/innosage-llc/framecut-web-editor
- **Default Branch**: `master`

## Stack
- React + TypeScript + Vite
- Node.js (npm)

## Agent Config
- **Base Branch**: `master`
- **Gate Command**: `./scripts/gatekeeper.sh`
- **Merge Strategy**: squash
- **Trust Tier — High Paths**: `src/auth`, `infra`, `.github/workflows`
