# AI Configuration & Integration

Estio leverages Google Gemini AI for key features like Property Import, Theme Design, and Agentic Conversations. These settings are centrally managed to allow fine-tuning of models and branding.

## AI Settings Page
**Location**: `/admin/settings/ai` (Access via **Settings** > **AI Configuration** card)

This page centralizes all AI-related configurations formerly located in general Site Settings.

### 1. API Configuration
*   **Google Gemini API Key**: The master key for all AI operations. Obtainable from Google AI Studio.
*   **Storage**: Securely stored in the `SiteConfig` table. Check code references in `lib/db`.

### 2. Model Selection
We support configuring specific models for different stages of the pipeline. The list of available models is **fetched dynamically** from Google's API, ensuring immediate access to new releases (like Gemini 3.0) without code changes.

*   **Default Model**: The fallback model for general tasks (e.g., Agentic drafts).
    *   *System Default*: `gemini-3-flash-preview` (Configured in `lib/ai/pricing.ts`).
*   **Autonomous Agent**: Used by the AI Coordinator's "Run Agent" feature for complex reasoning and tool use.
    *   *Default*: `gemini-2.5-pro` (Best reasoning, supports JSON mode).
    *   *Planner*: Uses **System Default** (e.g., Gemini 3 Flash) for fast plan generation.
*   **Stage 1: Extraction Model**: Used for heavy-duty text parsing, OCR, and structuring raw data from imports.
    *   *Recommended*: **System Default** (Good balance) or `gemini-2.5-pro` (Better reasoning).
*   **Stage 2: Design Engine**: Used for creative tasks, rewriting copy for "Premium" feel, and generating themes.
    *   *Recommended*: `gemini-2.5-pro` (Best for creative writing).

### 3. Brand Voice
The "System Instruction" injected into AI prompts to ensure generated content matches your agency's tone.

*   **Configuration**:
    *   **Manual Entry**: Type your own instructions (e.g., "Professional, Luxury, Concise").
    *   **AI Researcher**: Use the "Research from URL" feature to have the AI scrape your existing website and generate a voice profile for you.

## Dynamic Model Usage in Code

To ensure the configured settings are respected, we primarily use a **dynamic model list** and a standardized `DEFAULT_MODEL` constant.

### Library Functions
*   **`lib/ai/coordinator.ts`**: Fetches the model dynamically from `SiteConfig` or falls back to `DEFAULT_MODEL`.
*   **`lib/ai/agent.ts`**: The Autonomous Agent core. The Planner uses `DEFAULT_MODEL`.
*   **`lib/feed/ai-mapper.ts`**: `analyzeFeedStructure` accepts a `modelName` parameter (defaults to `DEFAULT_MODEL`).

### API Routes
*   **`app/api/import-stream/route.ts`**: Defaults to the user's configured `googleAiModel` or `DEFAULT_MODEL`.
    *   *Note*: The Property Import UI allows per-import overrides using the dynamic list.

## Related Documentation
*   [AI Autonomous Agent](ai-autonomous-agent.md): Full technical documentation of the Agent, tools, prompts, and **AI Thinking Display**.
*   [AI Agentic Conversations Hub](ai-agentic-conversations-hub.md): Original architecture and Deal Room concept.
*   [AI Property Import Prompts](ai-property-import-prompts.md): Details the specific prompts used in the extraction pipeline.
