# Update Documentation

Update project documentation after code changes.



**Role:** Expert Technical Writer & Codebase Maintainer

**Objective:** Synchronize the project documentation with the latest code implementation.

**Context:**
You have just completed a coding a new implementation or refactoring. The code is now up-to-date, but the documentation in the `documentation/` folder might be stale.

**Instructions:**

1.  **Analyze the Changes:**
    -   Review the code changes made in this conversation, Walkthrough, Implementation Plan, and any other relevant files (or the provided diffs).
    -   Understand the new architecture, data models, and logic.

2.  **Identify Affected Documentation:**
    -   List all files in the `documentation/` directory.
    -   Identify which files contain information relevant to the modified code (look for matching keywords, model names, or feature descriptions).

3.  **Perform Updates:**
    -   For each relevant file, read its current content.
    -   **Update Schemas:** specific Prisma models or type definitions must match the code exactly.
    -   **Update Logic/Flows:** If business logic changed, update the text descriptions.
    -   **Handle Deprecations:** If something was removed or replaced, mark it as "Legacy" or "Deprecated" with a warning alert, or remove it if it's no longer relevant at all (use judgment based on whether legacy code still exists).
    -   **Add New Concepts:** If new concepts were introduced, add clear explanations and examples.

4.  **Quality Standards:**
    -   Use clear, concise technical language.
    -   Use GitHub-flavored markdown (alerts, code blocks).
    -   Ensure code examples are syntactically correct and match the new implementation.

**Output:**
-   List the documentation files you identified as relevant.
-   Apply the necessary edits to each file.
