# Smart Deployment & Backup Prompt

**Usage:** Paste `@[documentation/prompt-smart-deploy.md]` when the user asks for commit + deploy.

## Instructions for the AI Agent

When invoked, execute this workflow end-to-end.

## 1. Analyze Scope

- Run `git status --short`.
- Review recent chat context to understand intent.
- Inspect the actual changed files before writing the commit message.

## 2. Create a Conventional Commit Message

Format:

```text
<type>(<scope>): <description>
```

Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `chore`, `revert`

Prefer scope from changed area (`conversations`, `deploy`, `contacts`, `ai`, etc).

## 3. Commit and Push

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
3. Deploy status (success/fail)
4. Health check outcomes
5. Any follow-up risk or required manual step

## Goal

Produce a clean commit history and a verified production deploy without leaving validation incomplete.
