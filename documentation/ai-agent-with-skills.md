
# Technical Reference: Implementing Progressive Disclosure Agent Skills

**Date:** October 26, 2023
**Topic:** Agentic Architecture / Context Management
**Repository:** [custom-agent-with-skills](https://github.com/coleam00/custom-agent-with-skills)
**Framework:** Pydantic AI (Adaptable to LangChain/CrewAI)

## 1. Executive Summary
This document outlines the architectural pattern for implementing **Agent Skills** using **Progressive Disclosure**. Unlike standard RAG or monolithic system prompts, this pattern allows an AI agent to possess unlimited capabilities without context window bloat.

**The Core Mechanism:**
1.  **Boot:** Agent loads ~100 tokens of metadata per skill (YAML front matter).
2.  **Runtime:** Agent identifies a need and "installs" the full skill instructions dynamically.
3.  **Execution:** Agent executes tasks, loading deep reference files only if specifically requested by the skill's logic.

---

## 2. The 3-Layer Architecture

The architecture strictly separates content to manage token costs and cognitive load.

### Layer 1: Discovery (The Hook)
*   **Source:** YAML Front Matter in `SKILL.md`.
*   **Content:** `name` (gerund format) and `description` (3rd person, specific triggers).
*   **Location:** Injected into the System Prompt at startup via the `@skill_agent.system_prompt` decorator.
*   **Cost:** Negligible (~50 tokens/skill).

### Layer 2: Instructions (The Logic)
*   **Source:** The Markdown body of `SKILL.md`.
*   **Content:** Step-by-step workflows, API schemas, "When to use" heuristics, and strict constraints.
*   **Location:** Loaded via `load_skill_tool`.
*   **Cost:** ~300-500 lines of context, incurred only *after* the agent decides to use the skill.

### Layer 3: References (The Deep Dive)
*   **Source:** Files in the `references/` subdirectory (e.g., `api_docs.md`, `templates.json`, `scripts/linter.py`).
*   **Content:** Heavy documentation, large schemas, or executable scripts.
*   **Location:** Loaded via `read_skill_file_tool`.
*   **Constraint:** **One level deep.** Avoid nested references (File A points to File B which points to File C) to prevent context fragmentation.

---

## 3. Directory Structure & Naming Conventions

The repo uses a strict structure to enable the `SkillLoader` to function automatically.

```text
root/
├── .env                  # LLM configs (OpenRouter/OpenAI/Ollama)
├── src/
│   ├── agent.py          # Main agent definition with Dynamic System Prompt
│   ├── tools.py          # The 3 progressive disclosure tools
│   └── ...
├── skills/               # The Skill Library
│   ├── weather/          # Skill Directory (snake_case)
│   │   ├── SKILL.md      # MUST be named SKILL.md (uppercase standard)
│   │   └── references/   # Supporting files
│   │       └── open_meteo_api.md
│   └── code_review/
│       ├── SKILL.md
│       └── scripts/      # Executable utilities
│           └── linter.py
└── tests/
    └── evals/            # YAML-based evaluation datasets
```

### Best Practices (from Anthropic Docs)
*   **Skill Names:** Use **gerunds** (verb + ing) to imply action.
    *   *Good:* `processing-pdfs`, `analyzing-spreadsheets`
    *   *Bad:* `pdf-tool`, `helper`, `excel`
*   **Descriptions:** Always write in the **third person**.
    *   *Good:* "Extracts text from PDF files..."
    *   *Bad:* "I can help you extract text..."

---

## 4. Implementation Details

### A. The Dynamic System Prompt
Instead of a static string, the system prompt is a function that executes at runtime.

**Mechanism:**
1.  `SkillLoader` scans `skills/**/SKILL.md`.
2.  Parses YAML front matter.
3.  Formats a block: `"- {skill.name}: {skill.description}"`.
4.  Injects this block into the base system prompt before the LLM inference begins.

### B. The Toolset (The Bridge)
The agent requires **three** specific tools to navigate the layers.

#### 1. `load_skill_tool(skill_name: str)`
*   **Role:** The "Install" button.
*   **Behavior:** Reads `skills/{skill_name}/SKILL.md`, strips the YAML front matter (to save tokens), and returns the Markdown body.
*   **Trigger:** Agent calls this when the user's request matches a description in the system prompt.

#### 2. `read_skill_file_tool(skill_name: str, file_path: str)`
*   **Role:** The "Reference" fetcher.
*   **Behavior:** specific validation (security check) to ensure `file_path` is within the skill's directory, then returns file content.
*   **Trigger:** The `SKILL.md` instructions explicitly tell the agent: *"For API details, call read_skill_file_tool with path 'references/api.md'"*.

#### 3. `list_skill_files_tool(skill_name: str)`
*   **Role:** The "Explorer".
*   **Behavior:** Lists all files in the `references/` or `scripts/` folder of a skill.
*   **Trigger:** Used when the agent needs to know what templates or scripts are available before reading them.

---

## 5. Evaluation & Reliability

Reliability is achieved through **Evaluation-Driven Development**. You cannot rely on manual testing for an agent with 20+ skills.

### The Eval Framework (`tests/evals/`)
The repo implements a custom runner using `pytest` or a simple python script (`run_evals.py`) that checks against a **Golden Dataset**.

**Dataset Structure (`skill_loading.yaml`):**
```yaml
- input: "Find me a chicken recipe"
  expected_skill: recipe_finder
  evaluators:
    - type: tool_called
      tool_name: load_skill_tool
      args: { skill_name: "recipe_finder" }

- input: "What is the weather in Tokyo?"
  expected_skill: weather
  evaluators:
    - type: tool_called
      tool_name: load_skill_tool
      args: { skill_name: "weather" }
```

**Running Evals:**
Use `uv` (a fast Python package manager recommended in the repo) to run tests:
```bash
uv run python -m tests.evals.run_evals --dataset skill_loading
```

### Observability (Logfire)
The code includes native integration with **Pydantic Logfire**.
*   **Setup:** `logfire.instrument_pydantic_ai()` in `agent.py`.
*   **Value:** Allows you to see exactly which metadata description triggered a skill load, and debug if an agent failed to "notice" a skill (usually due to a vague YAML description).

---

## 6. How to Build a New Skill (Workflow)

1.  **Create Directory:** `mkdir skills/my_new_skill`
2.  **Draft `SKILL.md`:**
    *   **YAML:** Define unique `name` and specific `description`.
    *   **Body:** Add "When to use" bullets.
    *   **Body:** Add "Instructions" (step-by-step).
3.  **Add References:** Create `references/guide.md` if the instruction text exceeds ~500 lines.
4.  **Add Evals:** Add a new entry to `tests/evals/new_skills.yaml` with sample user queries that *should* trigger this skill.
5.  **Run Evals:** Verify the agent picks it up.

## 7. Key Benefits of This Implementation
*   **Framework Agnostic:** While written in Pydantic AI, the *pattern* (YAML metadata injection -> Dynamic Tool Loading) works in LangChain, CrewAI, or raw OpenAI API calls.
*   **Model Agnostic:** The repo supports switching between `OpenRouter` (Claude), `OpenAI` (GPT-4), and `Ollama` (Local Llama 3) via `.env`, allowing you to test if cheaper models can handle the skill logic.
*   **Security:** Path traversal checks in `read_skill_file_tool` prevent the agent from reading sensitive system files outside the skills directory.