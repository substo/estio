# Smart Deployment & Backup Prompt

**Usage:** Paste `@[documentation/prompt-smart-deploy.md]` when the user asks for commit + deploy.

## Instructions for the AI Agent

When invoked, execute this workflow end-to-end.

## 1. Analyze Scope

- Run `git status --short`.
- Review recent chat context to understand intent.
- Inspect the actual changed files before writing the commit message.
- If documentation files changed, make sure they reflect the final implemented behavior and not just the original plan.
- Identify any local-only/untracked files in the repo root (credential JSON, debug dumps, temp exports).
- Before deploy, make sure those local-only files are ignored or moved out of the repo so `scripts/backup.sh` does not block deployment.

## 2. Create a Conventional Commit Message

Format:

```text
<type>(<scope>): <description>
```

Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `chore`, `revert`

Prefer scope from changed area (`conversations`, `deploy`, `contacts`, `ai`, etc).

## 3. Commit and Push

- Before commit, run the relevant verification commands for the changed area and summarize the results in the final report.
- Stage intended files.
- Commit with generated message.
- Push to current branch.

Standard commands:

```bash
git add .
git commit -m "<message>"
git push origin <current-branch>
```

## 4. Deploy (Default Path)

Use `deploy-local-build.sh` unless the user explicitly asks otherwise.

```bash
./deploy-local-build.sh
```

Notes:

- Uses local build artifacts and uploads to idle blue/green slot.
- Default behavior skips Evolution container restart.
- Runtime cutover is health-checked before Caddy switch.
- If deploy stops because the workspace is dirty, do not blindly deploy local-only files. Clean that state first, then rerun deploy.
- If the repo uses a large TypeScript graph, prefer `NODE_OPTIONS='--max-old-space-size=8192' npx tsc --noEmit` for type validation before deploy.

## 4.1. Verification Baseline Before Deploy

Run the smallest set of non-interactive checks that match the changed surface. For viewing-session/live-copilot work, the default baseline is:

```bash
npx prisma generate
npm run test:viewings:sessions
NODE_OPTIONS='--max-old-space-size=8192' npx tsc --noEmit
```

If linting is requested, only run a non-interactive lint command. If `next lint` opens interactive setup, report that clearly instead of guessing.

## 5. Validate Production After Deploy

Run and report key results:

```bash
ssh root@138.199.214.117 "curl -sSI https://estio.co/"
ssh root@138.199.214.117 "curl -sSI https://estio.co/admin/conversations"
ssh root@138.199.214.117 "curl -sSI https://downtowncyprus.site/"
ssh root@138.199.214.117 "pm2 list"
```

If deploy fails or health checks fail:

- Inspect PM2 logs for active slot(s)
- Identify root cause
- Apply fix and redeploy

## 6. Final Report Format

Always include:

1. Commit hash and commit message
2. Branch pushed
3. Verification commands run and whether they passed
4. Deploy status (success/fail)
5. Health check outcomes
6. Any follow-up risk or required manual step

## Goal

Produce a clean commit history and a verified production deploy without leaving validation incomplete.
