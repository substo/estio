# Agentic Engineering Skills

This note distills the transcript into a practical Codex workflow and records the local skills installed for future use.

## Core Idea

Agentic engineering is not vibe coding. The human stays in charge of product intent, architecture, scope, and judgment; the agent does the mechanical implementation work inside tight context and feedback loops.

The winning pattern from the transcript is:

1. Keep the task small and reviewable.
2. Give the agent exact source context instead of vague docs when APIs matter.
3. Build the minimal working feature first.
4. Run a structure cleanup pass after the feature works.
5. Run review/test loops until the diff is clean.
6. Launch earlier than feels comfortable.

## How To Use This In Practice

Think of these skills as modes Codex should switch into depending on the job.

### New Feature

Use this when adding something new:

```text
Use agentic-engineering-workflow. Build this as a small reviewable feature: <feature>.
If external APIs/packages are involved, use source-code-context.
After it works, use code-structure-cleanup.
```

This means: plan the smallest useful version, build it, test it, then clean up duplicated AI-generated code around the feature.

### Bug Fix

Use this when something is broken:

```text
Use agentic-engineering-workflow to fix this bug: <bug>.
Search existing code first. Keep the fix small.
After the fix works, use code-structure-cleanup only around the touched files.
```

This means: fix the real bug without rewriting half the app, then tidy only the nearby mess.

### Existing AI Spaghetti Code

Use this when past AI-generated implementation is messy:

```text
Use code-structure and code-structure-cleanup to inspect this area: <folder/feature>.
Find duplicated logic, messy service boundaries, repeated API calls, and bad AI-generated structure.
Propose small cleanup chunks before editing.
```

Clean the current codebase one area at a time, not the whole app at once.

Example:

```text
Clean up the WhatsApp integration using code-structure-cleanup.
Focus on repeated message sending, webhook parsing, and status update logic.
Do not change behavior.
```

### Review Or PR Feedback

Use this after there is review feedback, a PR, or failing checks:

```text
Use grep-loop-review-workflow on this PR feedback and keep fixing until tests pass.
```

This means: read the diff, read the feedback, fix only real issues, run checks, and repeat until clean or blocked by a human decision.

## Simple Rule

- `agentic-engineering-workflow` = build or fix properly.
- `source-code-context` = stop guessing external APIs.
- `code-structure` = decide what belongs in services versus app logic.
- `code-structure-cleanup` = clean AI spaghetti after it works.
- `grep-loop-review-workflow` = repeatedly fix review/test feedback until clean.

## Installed Skills

These skills were installed into `~/.codex/skills`:

| Skill | Use When | Do Not Use When |
|---|---|---|
| `agentic-engineering-workflow` | Starting a feature, MVP, internal tool, or substantial AI-assisted coding task that needs an end-to-end workflow. | The request is a tiny direct edit or simple one-command answer. |
| `source-code-context` | Integrating an SDK, package, framework, or API where the agent might guess function names or stale behavior. | The existing project code already gives enough context and no external API uncertainty exists. |
| `code-structure` | Deciding whether repeated operational logic belongs in shared service modules versus route/action/component code. | Logic is genuinely one-off and extracting it would add ceremony. |
| `code-structure-cleanup` | After a feature works, especially when AI added duplicated parsing, validation, provider calls, or helper functions. | Before the behavior works, or when it would turn into a broad redesign. |
| `grep-loop-review-workflow` | A small PR has review feedback, failing checks, or AI/human comments that can be fixed and re-reviewed in a loop. | The PR is huge, feedback is vague, or a product decision is needed. |

## Default Skill Order

For normal feature work:

1. Use `agentic-engineering-workflow` to keep the scope small and define the end state.
2. Use `source-code-context` if the feature depends on an external library or unclear API.
3. Implement the minimal working version.
4. Use `code-structure-cleanup` and, when architecture choices are involved, `code-structure`.
5. Use `grep-loop-review-workflow` once there is a reviewable diff or PR feedback.

## Prompt Pattern

```md
Use the agentic engineering workflow for this task.

Goal:
<one clear outcome>

Rules:
- Keep the change small and reviewable.
- Search existing code before adding new abstractions.
- If an external package/framework is involved, use source-code context before guessing APIs.
- Build the minimal working version first.
- After it works, run a code-structure cleanup pass.
- Run relevant tests/typechecks.
- Stop and ask only if a product/security decision is genuinely needed.
```

## Source Context Pattern

When using fast-moving libraries, add their source under a stable reference path such as:

```text
reference/repos/github.com/company/project
open-source/repos/github.com/company/project
```

Then prompt Codex to search that folder before coding. This keeps context precise without stuffing the whole repo into the conversation.

## Service Layer Rule

Keep product meaning in routes, actions, jobs, or UI flows. Move repeated mechanics into services.

Examples of mechanics:

- sending email or WhatsApp messages,
- calling an external API,
- parsing and normalizing payloads,
- validating webhooks,
- running sandbox/build commands,
- streaming an AI response.

The service should use explicit inputs and structured outputs. It should not secretly own auth, tenant policy, domain state transitions, or user-facing product decisions.

## Review Loop Rule

Review loops work only when the diff is small and the end state is objective. Good stop conditions are:

- tests pass,
- typecheck passes,
- reviewer comments are resolved,
- no unrelated rewrites were made.

If the diff is thousands of lines or the reviewer is asking product questions, split the work or get human direction before looping.

## Security Defaults

- Do not install packages younger than 14 days unless explicitly approved.
- Prefer official package sources and current repo code over blog posts.
- Use 2FA through an authenticator app, not SMS.
- Use a password manager.
- When a dependency breach trends, ask Codex to inspect the local project for affected packages and versions.
