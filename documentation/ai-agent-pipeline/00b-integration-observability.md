# Phase 0.5 & 0.6: Integration & Observability

**Duration**: Week 1.5
**Status**: ✅ Complete
**Last Updated**: February 14, 2026

---

## Overview

After building the standalone infrastructure layers (Memory, MCP, PTC) in Phase 0, we focused on **Integration** (wiring them into the main agent loop) and **Observability** (visualizing the agent's internal state).

This document details:
1.  **Integration**: How `lib/ai/agent.ts` weaves together Memory, Tools, and Models.
2.  **Observability Logic**: The hierarchical tracing backend.
3.  **Trace Dashboard**: The frontend UI for debugging agent thoughts and actions.

---

## 1. System Integration (Phase 0.5)

The core agent loop (`lib/ai/agent.ts`) was refactored to use the new infrastructure instead of hardcoded logic.

### Key Workflows

#### A. Multi-Model Routing
Instead of using a single model for everything, the agent now selects the optimal model per task:
- **Router**: `lib/ai/model-router.ts`
- **Logic**:
    - **Flash/Mini**: Used for Intent Classification, Tool Search, and simple responses.
    - **Pro/Sonnet**: Used for specific task execution (Searcher, Coordinator).
    - **Thinking/Opus**: Used for complex planning and heavy reasoning.

#### B. Dynamic Context Injection
Context is no longer static. It is dynamically assembled:
1.  **Profile**: Loads `Contact` and `Deal` data.
2.  **Memory**: Calls `retrieveContext(contactId, query)` to fetch top-k semantic insights (pgvector).
3.  **Tools**:
    - **Always Loaded**: Critical tools (`update_requirements`) injected immediately.
    - **Deferred**: Specialized tools (`generate_contract`) discovered via `tool_search`.

#### C. Tool Execution Pipeline
Tools are executed via the standardized **MCP Adapter**:
1.  **Discovery**: Agent selects a tool (or `tool_search` to find one).
2.  **Routing**: `lib/ai/mcp/adapter.ts` converts the model's call to an MCP request.
3.  **Execution**:
    - **Standard**: Single tool call executed by `McpServer`.
    - **Programmatic (PTC)**: Complex multi-step logic executed in the **Node.js Sandbox** (`lib/ai/ptc/sandbox.ts`).

---

## 2. Trace Dashboard (Phase 0.6)

To debug this complex multi-agent system, we built a specialized **Observability Dashboard** embedded in the Admin UI.

### Features

#### 1. Hierarchical Trace Tree
Visualizes the execution flow as a "Span Waterfall":
- **Root Span**: The top-level agent command.
- **Child Spans**:
    - **Thoughts**: Reasoning steps and internal monologue.
    - **Tools**: External actions (database, API).
    - **Planning**: Decomposition of tasks.
- **Visualization**: Shows parent-child relationships and relative timing/latency.

#### 2. Memory Inspector
A dedicated panel showing:
- **Stored Insights**: New memories created during the specific execution (e.g., "Client prefers sea view").
- **Available Context**: The specific insights that were retrieved and injected into the prompt.

#### 3. Performance Metrics
Real-time visibility into:
- **Latency**: Total time vs. individual span time.
- **Cost**: Estimated cost based on model pricing + usage metadata.
    - Uses prompt/completion counts plus extended Gemini usage fields when available (thinking/tool-use counters).
    - If a trace has no persisted cost, UI renders `N/A` instead of `$0.00000`.
- **Model Badge**: Which model was used for this specific step (e.g., `gemini-1.5-pro`).

### Backend Architecture

- **Data Model**: `AgentExecution` table extended with `traceId`, `spanId`, `parentSpanId`.
- **Querying**: `getTraceTree(traceId)` server action reconstructs the flat database rows into a recursive `TraceNode` tree.
- **Frontend**: `TraceNodeRenderer` component handles the recursive visual rendering.
- **Paste Lead Trace Path**: `Analyze Lead Text` traces now persist `cost` on `AgentExecution` and include a dedicated "Usage & cost estimate" thought step before import enrichment.

---

## 3. Verification & Metrics

### Automated Checks
- **Build**: `npm run build` passes with strict type safety on new trace components.
- **Runtime**: `scripts/verify-integration.ts` confirms standard tool registry size (6 core tools) and successful module loading.

### Performance Gains (Projected)
- **Token Usage**: ~70% reduction in context window usage via **Tool Search**.
- **Latency**: ~40% reduction in multi-step tasks via **Programmatic Tool Calling**.

---

## Next Steps

With the Foundation, Integration, and Observability layers complete, we proceed to **Phase 1: Knowledge Base**, where we will enable the agent to answer questions from valid documentation sources.
