# USER.md - Human's Coding Preferences

## Style
- TypeScript strict mode — no `any` types.
- Prefer named exports over default exports.
- Keep components small and single-responsibility.
- Use Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`.

## Workflow
- Always run the Gate before opening a PR.
- Feature branches: `feat/<short-description>`, fix branches: `fix/<short-description>`.
- Keep PRs focused — one concern per PR.

## What I Care About
- Build must stay green at all times.
- Don't touch `master` directly — always go through a PR.
- Prefer surgical, minimal diffs over large rewrites.
