# Smart Deployment & Backup Prompt

**Usage**: Paste this file reference `@[documentation/prompt-smart-deploy.md]` into the chat when you are helping the user deploy.

## Instructions for the AI Agent

When the user invokes this prompt, follow this workflow:

### 1. Context Analysis
-   **Check Git Status**: Run `git status` to see pending changes.
-   **Analyze Conversation**: Review the recent conversation history to understand *why* these changes were made (e.g., "Fixed 404 error", "Restored corrupted files", "Added WhatsApp feature").
-   **Identify Scope**: Determine which components are affected (e.g., `admin`, `api`, `ui`).

### 2. Generate Commit Message (Conventional Commits)
Construct a semantic commit message in the format:
`<type>(<scope>): <description>`

-   **Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `revert`.
-   **Example**: `fix(admin): restore corrupted contact-form and block-editor components`

### 3. Execution (The "Smart" Backup)
-   **Stage**: `git add .`
-   **Commit**: `git commit -m "YOUR_GENERATED_MESSAGE"`
-   **Push**: `git push origin YOUR_CURRENT_BRANCH`

### 4. Deployment (Optional)
If the user's request implies deployment (or if unsure, ask):
-   Run `./deploy-direct.sh --quick` (or appropriate flag).
-   *Note*: The script's internal `backup.sh` check will see a clean directory and skip the "dumb" prompt, making this seamless.

## Goal
Replace generic "Auto-save" messages with high-quality, descriptive history that documents *what* we built together.
