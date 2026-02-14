# Phase 0: Infrastructure Foundation

**Duration**: Week 1  
**Priority**: 🔴 Critical — All subsequent phases depend on this  
**Dependencies**: None (this IS the foundation)  
**Last Updated**: February 14, 2026 — Added Tool Search Tool + Programmatic Tool Calling (SOTA Nov 2025)

---

## Objective

Build the six shared infrastructure layers that all specialist agents will rely on:

1. **Semantic Memory** (pgvector) — Long-term recall of unstructured insights
2. **MCP Server** (Model Context Protocol) — Standardized tool registry
3. **Tool Search Tool** — On-demand tool discovery without context bloat
4. **Programmatic Tool Calling** — Code-based multi-tool orchestration
5. **Observability** (Tracing & Metrics) — Debug and monitor multi-agent calls
6. **Multi-Model Router** — Cost-optimize by routing to the right LLM per task

---

## 1. Semantic Memory (pgvector)

### Problem

The current agent stores structured data (budget, district, bedrooms) in the `Contact` model. But real estate deals are full of **unstructured insights** that don't fit into fields:

- *"Client hates open-plan kitchens"*
- *"Owner is desperate to sell before March"*
- *"Lead mentioned they're relocating from London for schools"*

These insights are currently **lost** after the conversation scrolls past the context window.

### Solution: Vector Embeddings in PostgreSQL

We will use the `pgvector` extension to store text embeddings alongside our existing data. No external vector database needed.

### Implementation Steps

#### Step 1: Enable pgvector Extension

```sql
-- Migration: Add pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;
```

Prisma does not natively support `vector` columns. We'll use a **raw SQL migration** alongside a Prisma model.

#### Step 2: Create the `Insight` Model

```prisma
// prisma/schema.prisma
model Insight {
  id              String   @id @default(cuid())
  contactId       String
  contact         Contact  @relation(fields: [contactId], references: [id], onDelete: Cascade)
  conversationId  String?
  conversation    Conversation? @relation(fields: [conversationId], references: [id])
  dealId          String?

  // Content
  text            String   // The raw insight text
  category        String   // "preference", "objection", "timeline", "motivation", "relationship"
  importance      Int      @default(5) // 1-10 scale
  source          String   // "agent_extracted", "user_noted", "system_inferred"

  // Metadata
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  expiresAt       DateTime? // Some insights are time-bound

  @@index([contactId])
  @@index([conversationId])
  @@map("insights")
}
```

Then add the vector column via raw migration:

```sql
-- Migration: Add embedding column
ALTER TABLE insights ADD COLUMN embedding vector(768);
CREATE INDEX ON insights USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

#### Step 3: Create Memory Service (`lib/ai/memory.ts`)

```typescript
// lib/ai/memory.ts

import { db } from "@/lib/db";
import { generateEmbedding } from "./embeddings";

interface InsightInput {
  contactId: string;
  conversationId?: string;
  dealId?: string;
  text: string;
  category: "preference" | "objection" | "timeline" | "motivation" | "relationship";
  importance?: number;
  source?: string;
}

/**
 * Store a new insight with its vector embedding.
 * Called by agent skills when they discover something noteworthy.
 */
export async function storeInsight(input: InsightInput): Promise<void> {
  const embedding = await generateEmbedding(input.text);

  // Create the record
  const insight = await db.insight.create({
    data: {
      contactId: input.contactId,
      conversationId: input.conversationId,
      dealId: input.dealId,
      text: input.text,
      category: input.category,
      importance: input.importance ?? 5,
      source: input.source ?? "agent_extracted",
    },
  });

  // Store the embedding via raw SQL (Prisma doesn't support vector type)
  await db.$executeRaw`
    UPDATE insights SET embedding = ${embedding}::vector
    WHERE id = ${insight.id}
  `;
}

/**
 * Retrieve the most relevant insights for a given query.
 * Used to inject context into agent prompts.
 * 
 * @param contactId - Scope to a specific contact
 * @param query - Natural language query (e.g., "What does this client prefer?")
 * @param limit - Max results (default: 5)
 * @returns Array of relevant insights ranked by similarity
 */
export async function retrieveContext(
  contactId: string,
  query: string,
  limit: number = 5
): Promise<{ text: string; category: string; importance: number; similarity: number }[]> {
  const queryEmbedding = await generateEmbedding(query);

  const results = await db.$queryRaw`
    SELECT
      text,
      category,
      importance,
      1 - (embedding <=> ${queryEmbedding}::vector) AS similarity
    FROM insights
    WHERE "contactId" = ${contactId}
      AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY embedding <=> ${queryEmbedding}::vector
    LIMIT ${limit}
  `;

  return results as any[];
}

/**
 * Retrieve ALL insights for a contact (for full context injection).
 */
export async function getContactInsights(contactId: string) {
  return db.insight.findMany({
    where: { contactId },
    orderBy: { importance: "desc" },
    take: 20,
  });
}
```

#### Step 4: Create Embedding Service (`lib/ai/embeddings.ts`)

```typescript
// lib/ai/embeddings.ts

import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

/**
 * Generate a 768-dimensional embedding for a text string.
 * Uses Google's text-embedding-005 model.
 * 
 * Cost: ~$0.00001 per embedding (negligible)
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const model = genAI.getGenerativeModel({ model: "text-embedding-005" });
  
  const result = await model.embedContent(text);
  return result.embedding.values;
}

/**
 * Batch embed multiple texts (more efficient for bulk operations).
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const model = genAI.getGenerativeModel({ model: "text-embedding-005" });
  
  const results = await Promise.all(
    texts.map(text => model.embedContent(text))
  );
  
  return results.map(r => r.embedding.values);
}
```

### Verification

- [ ] `pgvector` extension enabled in PostgreSQL
- [ ] `Insight` model created and migrated
- [ ] `storeInsight()` stores text + embedding
- [ ] `retrieveContext()` returns ranked results by cosine similarity
- [ ] Test: Store "Client loves sea views" → Query "What does the client like?" → Returns the insight

---

## 2. MCP Server (Model Context Protocol)

### Problem

Currently, all tools are hardcoded in `lib/ai/tools.ts` and injected wholesale into every prompt. This wastes context window tokens and makes tool management rigid.

### Solution: MCP-Based Tool Registry

Implement Anthropic's **Model Context Protocol** — the emerging industry standard for tool/resource interfaces. MCP is to AI tools what REST is to web APIs: a universal, model-agnostic protocol.

### Key Concepts

| MCP Concept | Our Mapping |
|:------------|:------------|
| **Server** | Our API that exposes tools, resources, and prompts |
| **Tool** | An action the agent can invoke (e.g., `search_properties`) |
| **Resource** | Read-only data the agent can access (e.g., property details, contact info) |
| **Prompt** | A reusable prompt template (e.g., "Qualify this lead") |

### Implementation Steps

#### Step 1: Install MCP SDK

```bash
npm install @modelcontextprotocol/sdk
```

#### Step 2: Create MCP Tool Registry (`lib/ai/mcp/server.ts`)

```typescript
// lib/ai/mcp/server.ts

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function createEstioMcpServer() {
  const server = new McpServer({
    name: "Estio Real Estate Agent",
    version: "1.0.0",
  });

  // ── TOOLS ─────────────────────────────────────────
  
  server.tool(
    "search_properties",
    "Search for properties matching the given criteria. Returns a list of matching properties with key details.",
    {
      district: z.string().optional().describe("Property district/area"),
      maxPrice: z.number().optional().describe("Maximum price in EUR"),
      minPrice: z.number().optional().describe("Minimum price in EUR"),
      bedrooms: z.number().optional().describe("Number of bedrooms"),
      propertyType: z.string().optional().describe("Type: Apartment, Villa, House, etc."),
      dealType: z.enum(["sale", "rent"]).optional().describe("Sale or Rent"),
    },
    async (params) => {
      // Implementation calls existing searchProperties logic
      const results = await searchProperties(params);
      return { content: [{ type: "text", text: JSON.stringify(results) }] };
    }
  );

  server.tool(
    "update_requirements",
    "Update the contact's property requirements and preferences.",
    {
      contactId: z.string().describe("Contact ID"),
      district: z.string().optional(),
      maxPrice: z.string().optional(),
      minPrice: z.string().optional(),
      bedrooms: z.string().optional(),
      status: z.string().optional(),
      notes: z.string().optional(),
    },
    async (params) => {
      const result = await updateContactRequirements(params);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    "store_insight",
    "Store a noteworthy insight about the client for long-term memory.",
    {
      contactId: z.string(),
      text: z.string().describe("The insight to remember"),
      category: z.enum(["preference", "objection", "timeline", "motivation", "relationship"]),
      importance: z.number().min(1).max(10).optional(),
    },
    async (params) => {
      await storeInsight(params);
      return { content: [{ type: "text", text: "Insight stored successfully." }] };
    }
  );

  // ── RESOURCES ────────────────────────────────────
  
  server.resource(
    "contact://{contactId}",
    "Full contact profile including requirements, properties, and insights",
    async (uri) => {
      const contactId = uri.pathname.split("/").pop()!;
      const contact = await getFullContactProfile(contactId);
      return { contents: [{ uri: uri.href, text: JSON.stringify(contact), mimeType: "application/json" }] };
    }
  );

  server.resource(
    "deal://{dealId}",
    "Full deal context including all parties, timeline, and current stage",
    async (uri) => {
      const dealId = uri.pathname.split("/").pop()!;
      const deal = await getFullDealContext(dealId);
      return { contents: [{ uri: uri.href, text: JSON.stringify(deal), mimeType: "application/json" }] };
    }
  );

  return server;
}
```

#### Step 3: Create Tool Adapter for Non-MCP Models

Since not all models support MCP natively, create an adapter:

```typescript
// lib/ai/mcp/adapter.ts

/**
 * Convert MCP tool definitions to Gemini/OpenAI function calling format.
 * This ensures we can use MCP as our single source of truth
 * regardless of which model we're calling.
 */
export function mcpToolsToGeminiFunctions(mcpServer: McpServer) {
  const tools = mcpServer.getRegisteredTools();
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: zodToGeminiSchema(tool.inputSchema),
  }));
}
```

### Verification

- [ ] MCP server starts and registers all tools
- [ ] Tools callable via MCP protocol
- [ ] Adapter converts MCP tools to Gemini/OpenAI format
- [ ] Existing `runAgent()` function works with MCP tools

### References

- [MCP Specification](https://modelcontextprotocol.io/specification)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Anthropic MCP Announcement](https://www.anthropic.com/news/model-context-protocol)

---

## 3. Tool Search Tool (Deferred Tool Loading)

### Problem

Our MCP server registers all tools upfront. When the agent starts, every tool definition is injected into the context window — even tools like `generate_contract` or `send_docusign` that are only needed 1% of the time. This wastes tokens and degrades tool selection accuracy.

With 20+ tools across all skills, tool descriptions alone consume **~3,000 tokens per call**. Over thousands of daily invocations, this adds up to significant cost and latency.

### Solution: Anthropic Tool Search Tool (Nov 2025)

Mark rarely-used tools as `defer_loading: true`. Instead of injecting their schemas, inject a single **Tool Search Tool** that the agent can use to discover and load tools on-demand.

**Impact** (Anthropic internal testing):
- **85% reduction** in tool-related token usage
- **Improved accuracy** in tool selection (less noise = better choices)
- **Faster time-to-first-token** (smaller prompt = faster inference)

### Implementation Steps

#### Step 1: Categorize Tools by Frequency

```typescript
// lib/ai/mcp/tool-categories.ts

/**
 * Tools are split into two tiers:
 * - ALWAYS_LOADED: Used in >50% of agent calls. Always in context.
 * - DEFERRED: Used rarely. Discoverable via Tool Search.
 */
export const ALWAYS_LOADED_TOOLS = [
  "search_properties",      // Used in most conversations
  "update_requirements",    // Core qualification tool
  "store_insight",          // Memory — used every call
  "draft_reply",            // Always needed
  "log_activity",           // Always needed
  "retrieve_context",       // Memory retrieval — used every call
];

export const DEFERRED_TOOLS = [
  "generate_contract",      // Only in closing phase
  "send_docusign",          // Only in closing phase
  "schedule_viewing",       // Only in coordinator phase
  "check_calendar",         // Only in coordinator phase
  "send_offer",             // Only in negotiation phase
  "calculate_mortgage",     // Rarely used
  "analyze_market_trends",  // Rarely used
  "generate_property_report", // Rarely used
  "send_listing_alert",     // Only in auto-pilot
  "create_deal",            // Only at deal creation
];
```

#### Step 2: Create Tool Search Service

```typescript
// lib/ai/mcp/tool-search.ts

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { generateEmbedding } from "../embeddings";
import { DEFERRED_TOOLS } from "./tool-categories";

interface ToolMetadata {
  name: string;
  description: string;
  embedding: number[];
  schema: Record<string, any>;
}

// Pre-computed embeddings for all deferred tool descriptions
let toolIndex: ToolMetadata[] = [];

/**
 * Initialize the tool search index at server startup.
 * Embeds all deferred tool descriptions for semantic search.
 */
export async function initToolSearchIndex(server: McpServer) {
  const allTools = server.getRegisteredTools();
  const deferredTools = allTools.filter(t => DEFERRED_TOOLS.includes(t.name));

  toolIndex = await Promise.all(
    deferredTools.map(async (tool) => ({
      name: tool.name,
      description: tool.description,
      embedding: await generateEmbedding(tool.description),
      schema: tool.inputSchema,
    }))
  );

  console.log(`Tool Search Index: ${toolIndex.length} deferred tools indexed`);
}

/**
 * Search for relevant tools based on a natural language query.
 * Returns the top-K tools that match the query semantically.
 */
export async function searchTools(
  query: string,
  maxResults: number = 3
): Promise<ToolMetadata[]> {
  const queryEmbedding = await generateEmbedding(query);

  // Compute cosine similarity against all deferred tools
  const scored = toolIndex.map(tool => ({
    ...tool,
    similarity: cosineSimilarity(queryEmbedding, tool.embedding),
  }));

  // Return top matches above threshold
  return scored
    .filter(t => t.similarity > 0.3)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, maxResults);
}

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, ai, i) => sum + ai * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
  const magB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
  return dot / (magA * magB);
}
```

#### Step 3: Register the Tool Search Tool in MCP

```typescript
// Add to lib/ai/mcp/server.ts

import { searchTools } from "./tool-search";

// Register the meta-tool that discovers other tools
server.tool(
  "tool_search",
  "Search for available tools that can help with a specific task. " +
  "Use this when you need a capability that isn't in your current tool set. " +
  "Returns tool names, descriptions, and schemas for the most relevant tools.",
  {
    query: z.string().describe(
      "Natural language description of what you need to do, " +
      "e.g. 'generate a PDF contract' or 'check calendar availability'"
    ),
    maxResults: z.number().optional().default(3),
  },
  async (params) => {
    const results = await searchTools(params.query, params.maxResults);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(
          results.map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.schema,
          })),
          null,
          2
        ),
      }],
    };
  }
);
```

#### Step 4: Update the Adapter to Support Deferred Loading

```typescript
// Update lib/ai/mcp/adapter.ts

import { ALWAYS_LOADED_TOOLS } from "./tool-categories";

/**
 * Convert MCP tools to Gemini/OpenAI format,
 * but ONLY include always-loaded tools + the tool_search meta-tool.
 * Deferred tools are discovered at runtime via tool_search.
 */
export function mcpToolsToGeminiFunctions(
  mcpServer: McpServer,
  options?: { includeDeferred?: boolean }
) {
  const tools = mcpServer.getRegisteredTools();

  const filtered = options?.includeDeferred
    ? tools
    : tools.filter(t =>
        ALWAYS_LOADED_TOOLS.includes(t.name) || t.name === "tool_search"
      );

  return filtered.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: zodToGeminiSchema(tool.inputSchema),
  }));
}
```

### Token Savings Estimate

| Scenario | Tools in Context | Tokens Used | Cost Impact |
|:---------|:----------------|:------------|:------------|
| **Before** (all tools) | 20 tools | ~3,000 tokens | Baseline |
| **After** (always + search) | 7 tools + 1 meta-tool | ~600 tokens | **-80%** |
| **After + discovered** | 7 + 2 discovered | ~900 tokens | **-70%** |

### Verification

- [ ] Only always-loaded tools appear in the initial prompt
- [ ] `tool_search` returns relevant deferred tools
- [ ] Agent can discover and use a deferred tool (e.g., `generate_contract`)
- [ ] Token usage per call drops by ~70-80%
- [ ] Tool selection accuracy improves (fewer irrelevant tools in context)

---

## 4. Programmatic Tool Calling (PTC)

### Problem

In a typical agent loop, each tool call is a separate LLM inference round-trip:

```
User: "Find apartments in Paphos under €200k near the beach"

Round 1: LLM → calls search_properties({district: "Paphos", maxPrice: 200000})
          ← Returns 50 properties (paste ALL 50 into context)
Round 2: LLM → calls retrieve_context(contactId, "beach preferences")
          ← Returns 5 insights (paste into context)
Round 3: LLM → reasons over 50 properties + 5 insights
          ← Drafts response
```

This means **50 properties × ~200 tokens each = 10,000 tokens** wasted on raw data that the LLM needs to filter down to 3-5 relevant results.

### Solution: Anthropic Programmatic Tool Calling (Nov 2025)

Instead of N individual tool calls, the agent writes a **code block** that orchestrates multiple tools, processes data, and returns only the refined result.

**Impact** (Anthropic benchmarks):
- **37% reduction** in token usage on multi-step tasks
- **50-75% fewer inference round-trips** (1 code execution vs. 3-5 tool calls)
- **More reliable** data processing (code handles filtering, not natural language)

### How It Works

```
User: "Find apartments in Paphos under €200k near the beach"

Round 1: LLM → emits a code block:
  ```python
  properties = search_properties(district="Paphos", max_price=200000)
  insights = retrieve_context(contact_id, "beach preferences")
  beach_prefs = [i["text"] for i in insights if "beach" in i["text"].lower()]
  
  # Score properties by proximity to coast
  scored = []
  for p in properties:
      score = 0
      if p.get("distanceToSea", 999) < 500: score += 10
      if p.get("seaView"): score += 5
      if any(pref in p["description"].lower() for pref in ["beach", "sea", "coast"]): score += 3
      scored.append({**p, "relevance": score})
  
  # Return only top 5
  result = sorted(scored, key=lambda x: -x["relevance"])[:5]
  return result
  ```

  ← Only 5 scored results enter context (not 50)
Round 2: LLM → drafts personalized response using 5 results
```

### Implementation Steps

#### Step 1: Create Code Sandbox (`lib/ai/ptc/sandbox.ts`)

```typescript
// lib/ai/ptc/sandbox.ts

import { createContext, runInContext } from "vm";

/**
 * Sandboxed JavaScript executor for Programmatic Tool Calling.
 * The LLM generates JS code that calls tool functions.
 * Code runs in an isolated VM context with only whitelisted tools.
 */
export async function executePTC(
  code: string,
  availableTools: Record<string, (...args: any[]) => Promise<any>>,
  options?: { timeoutMs?: number }
): Promise<{ result: any; toolCallLog: ToolCallLogEntry[] }> {
  const toolCallLog: ToolCallLogEntry[] = [];

  // Wrap each tool to log calls
  const wrappedTools: Record<string, Function> = {};
  for (const [name, fn] of Object.entries(availableTools)) {
    wrappedTools[name] = async (...args: any[]) => {
      const start = Date.now();
      const result = await fn(...args);
      toolCallLog.push({
        tool: name,
        args,
        resultSize: JSON.stringify(result).length,
        latencyMs: Date.now() - start,
      });
      return result;
    };
  }

  // Create sandboxed context
  const sandbox = {
    ...wrappedTools,
    console: { log: () => {} }, // Suppress console
    JSON,
    Math,
    Array,
    Object,
    Date,
    Promise,
    // No fs, no require, no process — safe
  };

  const context = createContext(sandbox);

  // Wrap code in an async IIFE
  const wrappedCode = `
    (async () => {
      ${code}
    })()
  `;

  try {
    const result = await runInContext(wrappedCode, context, {
      timeout: options?.timeoutMs ?? 10_000, // 10s max
    });
    return { result, toolCallLog };
  } catch (error) {
    throw new PTCExecutionError(
      `PTC execution failed: ${error.message}`,
      code,
      toolCallLog
    );
  }
}

interface ToolCallLogEntry {
  tool: string;
  args: any[];
  resultSize: number;
  latencyMs: number;
}

class PTCExecutionError extends Error {
  constructor(
    message: string,
    public code: string,
    public toolCallLog: ToolCallLogEntry[]
  ) {
    super(message);
    this.name = "PTCExecutionError";
  }
}
```

#### Step 2: Create PTC-Enabled Agent Executor

```typescript
// lib/ai/ptc/executor.ts

import { executePTC } from "./sandbox";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Enhanced agent executor that supports Programmatic Tool Calling.
 * When the LLM emits a ```tool_code block, we execute it in sandbox.
 * When it emits a regular tool_call, we handle it normally.
 */
export async function executeWithPTC(
  llmResponse: LLMResponse,
  mcpServer: McpServer,
  traceContext: TraceContext
): Promise<{ output: any; method: "ptc" | "standard" }> {
  // Check if LLM chose to use PTC (code block output)
  const codeBlock = extractCodeBlock(llmResponse);

  if (codeBlock) {
    // PTC mode: execute the code with tool functions injected
    const tools = buildToolFunctions(mcpServer);
    const { result, toolCallLog } = await executePTC(codeBlock, tools);

    // Log for observability
    await logPTCExecution(traceContext, {
      code: codeBlock,
      toolCalls: toolCallLog,
      resultSize: JSON.stringify(result).length,
    });

    return { output: result, method: "ptc" };
  }

  // Standard mode: handle individual tool calls
  return { output: await handleStandardToolCalls(llmResponse, mcpServer), method: "standard" };
}

/**
 * Build a map of tool-name → async-function from the MCP server.
 * These functions are injected into the PTC sandbox.
 */
function buildToolFunctions(
  mcpServer: McpServer
): Record<string, (...args: any[]) => Promise<any>> {
  const tools = mcpServer.getRegisteredTools();
  const fns: Record<string, Function> = {};

  for (const tool of tools) {
    fns[tool.name] = async (params: any) => {
      const result = await tool.handler(params);
      return JSON.parse(result.content[0].text);
    };
  }

  return fns as any;
}

function extractCodeBlock(response: LLMResponse): string | null {
  // Match ```tool_code or ```javascript blocks in the response
  const match = response.text?.match(/```(?:tool_code|javascript)\n([\s\S]*?)```/);
  return match ? match[1].trim() : null;
}
```

#### Step 3: Update System Prompt for PTC

```typescript
// lib/ai/prompts/ptc-instructions.ts

export const PTC_SYSTEM_PROMPT = `
## Programmatic Tool Calling

When you need to call MULTIPLE tools and process their results, you can write
a code block instead of making individual tool calls. This is more efficient
and reduces token usage.

### When to use PTC:
- Searching then filtering/sorting results
- Combining data from multiple tools
- Processing large result sets before responding
- Any multi-step data pipeline

### How to use PTC:
Emit a code block with language "tool_code":

\`\`\`tool_code
const properties = await search_properties({ district: "Paphos", maxPrice: 200000 });
const filtered = properties.filter(p => p.bedrooms >= 2);
const sorted = filtered.sort((a, b) => a.price - b.price);
return sorted.slice(0, 5);
\`\`\`

### Available functions in PTC:
All registered tools are available as async functions.
You also have access to: JSON, Math, Array, Object, Date.

### Rules:
- Always \`return\` your final result — this is what enters the conversation.
- Keep code simple and readable.
- Do NOT use require(), import, or file system operations.
- Maximum execution time: 10 seconds.
`;
```

#### Step 4: Skill-Level PTC Configuration

```typescript
// lib/ai/ptc/config.ts

/**
 * Not all skills benefit from PTC. Enable it selectively.
 */
export const PTC_ENABLED_SKILLS: Record<string, boolean> = {
  searcher: true,        // Big result sets → filter in code
  coordinator: true,     // Multi-calendar checks → combine in code
  qualifier: false,      // Conversational — PTC adds no value
  negotiator: false,     // Needs full LLM reasoning, not code
  objection_handler: false,
  closer: true,          // Contract data assembly from multiple sources
};

/**
 * Check if a skill should use PTC.
 */
export function shouldUsePTC(skillName: string): boolean {
  return PTC_ENABLED_SKILLS[skillName] ?? false;
}
```

### Token Savings Estimate (Searcher Skill)

| Scenario | Inference Rounds | Tokens in Context | Latency |
|:---------|:----------------|:-----------------|:--------|
| **Before** (standard) | 3 rounds | ~12,000 tokens | ~4.5s |
| **After** (PTC) | 1 round + 1 code exec | ~4,500 tokens | ~2.0s |
| **Savings** | **-66% rounds** | **-62% tokens** | **-55% latency** |

### Verification

- [ ] LLM can emit `tool_code` blocks when multiple tools are needed
- [ ] Sandbox executes code with injected tool functions
- [ ] Sandbox timeout prevents infinite loops (10s max)
- [ ] Sandbox blocks dangerous operations (no `require`, `fs`, `process`)
- [ ] PTC-enabled skills (Searcher, Coordinator) use code-based orchestration
- [ ] PTC-disabled skills (Qualifier, Negotiator) use standard tool calls
- [ ] Token usage measurably lower for Searcher queries with PTC
- [ ] Tool call log captured for observability

---

## 5. Observability & Tracing

### Problem

When the agent makes a multi-step call (Plan → Qualify → Search → Draft), there's no way to trace:
- Which step failed?
- How long did each step take?
- How much did each step cost?
- What was the input/output at each stage?

### Solution: Correlation-ID-Based Tracing

Every agent invocation gets a unique `traceId`. Each sub-step gets a `spanId`. All are stored in the `AgentExecution` model.

### Implementation Steps

#### Step 1: Extend `AgentExecution` Model

```prisma
model AgentExecution {
  id              String   @id @default(cuid())
  conversationId  String
  conversation    Conversation @relation(fields: [conversationId], references: [id])

  // Trace
  traceId         String   @default(cuid()) // Groups all steps in one run
  spanId          String   @default(cuid()) // Individual step ID
  parentSpanId    String?  // For nested calls
  
  // Execution
  skillName       String?  // "qualifier", "searcher", etc.
  taskId          String?
  intent          String?  // Classified intent

  // AI Output
  model           String
  thoughtSummary  String?
  thoughtSteps    Json?
  toolCalls       Json?
  draftReply      String?

  // Metrics
  promptTokens    Int      @default(0)
  completionTokens Int     @default(0)
  cost            Float    @default(0)
  latencyMs       Int      @default(0) // Total execution time
  
  // Status
  status          String   @default("pending") // pending, running, success, error
  errorMessage    String?

  createdAt       DateTime @default(now())

  @@index([traceId])
  @@index([conversationId])
  @@index([createdAt])
  @@map("agent_executions")
}
```

#### Step 2: Create Tracing Service (`lib/ai/tracing.ts`)

```typescript
// lib/ai/tracing.ts

import { randomUUID } from "crypto";

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  startTime: number;
}

/**
 * Start a new trace (top-level agent invocation).
 */
export function startTrace(): TraceContext {
  return {
    traceId: randomUUID(),
    spanId: randomUUID(),
    startTime: Date.now(),
  };
}

/**
 * Create a child span (sub-step within a trace).
 */
export function startSpan(parent: TraceContext): TraceContext {
  return {
    traceId: parent.traceId,
    spanId: randomUUID(),
    parentSpanId: parent.spanId,
    startTime: Date.now(),
  };
}

/**
 * Record the completion of a span.
 */
export async function endSpan(
  context: TraceContext,
  data: {
    conversationId: string;
    skillName?: string;
    model: string;
    status: "success" | "error";
    thoughtSummary?: string;
    thoughtSteps?: any;
    toolCalls?: any;
    draftReply?: string;
    promptTokens?: number;
    completionTokens?: number;
    cost?: number;
    errorMessage?: string;
  }
) {
  const latencyMs = Date.now() - context.startTime;

  await db.agentExecution.create({
    data: {
      traceId: context.traceId,
      spanId: context.spanId,
      parentSpanId: context.parentSpanId,
      latencyMs,
      ...data,
    },
  });
}
```

#### Step 3: Create Trace Dashboard Query

```typescript
// lib/ai/tracing-queries.ts

/**
 * Get full trace tree for an agent run.
 * Returns parent + all child spans ordered by time.
 */
export async function getTrace(traceId: string) {
  const spans = await db.agentExecution.findMany({
    where: { traceId },
    orderBy: { createdAt: "asc" },
  });

  // Build tree structure
  const root = spans.find(s => !s.parentSpanId);
  const children = spans.filter(s => s.parentSpanId);

  return {
    ...root,
    children,
    totalLatencyMs: spans.reduce((sum, s) => sum + s.latencyMs, 0),
    totalCost: spans.reduce((sum, s) => sum + s.cost, 0),
    totalTokens: spans.reduce((sum, s) => sum + s.promptTokens + s.completionTokens, 0),
  };
}
```

### Verification

- [ ] Every agent call creates a trace with unique `traceId`
- [ ] Sub-steps (intent classification, skill execution, policy check) create child spans
- [ ] Trace dashboard shows complete execution tree
- [ ] Cost and latency metrics are accurate

---

## 6. Multi-Model Router

### Problem

Using the same model (e.g., Gemini Pro) for everything is wasteful:
- Intent classification ("Is this a question or an offer?") → **Cheap model** (Flash)
- Property search reasoning → **Mid-tier model** (Pro)
- Contract negotiation → **Top-tier model** (Opus)

### Solution: Intelligent Model Router

Route each request to the cheapest model that can handle its complexity.

### Implementation Steps

#### Step 1: Create Model Registry (`lib/ai/model-router.ts`)

```typescript
// lib/ai/model-router.ts

export type ModelTier = "flash" | "standard" | "premium";

interface ModelConfig {
  id: string;
  provider: "google" | "anthropic" | "openai";
  tier: ModelTier;
  costPer1kInput: number;  // USD
  costPer1kOutput: number; // USD
  maxTokens: number;
  supportsTools: boolean;
  supportsVision: boolean;
}

const MODELS: Record<string, ModelConfig> = {
  "gemini-2.5-flash": {
    id: "gemini-2.5-flash",
    provider: "google",
    tier: "flash",
    costPer1kInput: 0.000075,
    costPer1kOutput: 0.0003,
    maxTokens: 1_000_000,
    supportsTools: true,
    supportsVision: true,
  },
  "gemini-2.5-pro": {
    id: "gemini-2.5-pro",
    provider: "google",
    tier: "standard",
    costPer1kInput: 0.00125,
    costPer1kOutput: 0.005,
    maxTokens: 1_000_000,
    supportsTools: true,
    supportsVision: true,
  },
  "claude-opus-4.6": {
    id: "claude-opus-4.6",
    provider: "anthropic",
    tier: "premium",
    costPer1kInput: 0.015,
    costPer1kOutput: 0.075,
    maxTokens: 1_000_000,
    supportsTools: true,
    supportsVision: true,
  },
};

/**
 * Task-to-model mapping.
 * Each task type gets the cheapest model that can handle it.
 */
const TASK_MODEL_MAP: Record<string, ModelTier> = {
  "intent_classification": "flash",
  "sentiment_analysis": "flash",
  "lead_scoring": "flash",
  "property_search": "standard",
  "qualification": "standard",
  "draft_reply": "standard",
  "objection_handling": "standard",
  "negotiation": "premium",
  "contract_review": "premium",
  "complex_coordination": "premium",
};

/**
 * Get the appropriate model for a given task.
 */
export function getModelForTask(taskType: string): ModelConfig {
  const tier = TASK_MODEL_MAP[taskType] ?? "standard";
  const model = Object.values(MODELS).find(m => m.tier === tier);
  if (!model) throw new Error(`No model found for tier: ${tier}`);
  return model;
}

/**
 * Estimate cost for a given task.
 */
export function estimateCost(
  taskType: string,
  inputTokens: number,
  outputTokens: number
): number {
  const model = getModelForTask(taskType);
  return (
    (inputTokens / 1000) * model.costPer1kInput +
    (outputTokens / 1000) * model.costPer1kOutput
  );
}
```

#### Step 2: Integrate with Existing Agent

```typescript
// In lib/ai/agent.ts — modify the executor to use model router

import { getModelForTask } from "./model-router";

async function executeAgentTask(task: AgentTask, context: AgentContext) {
  const model = getModelForTask(task.type);
  
  // Use the appropriate model
  const genAI = getProviderClient(model.provider);
  const llm = genAI.getGenerativeModel({ model: model.id });
  
  // ... existing execution logic
}
```

### Verification

- [ ] Flash model used for intent classification (verify via tracing)
- [ ] Pro model used for property search and qualification
- [ ] Premium model available for negotiation tasks
- [ ] Cost savings measurable: expect 60-70% reduction vs. all-Pro

---

## Files Created / Modified

| Action | File | Purpose |
|:-------|:-----|:--------|
| **NEW** | `lib/ai/memory.ts` | Semantic memory service (store/retrieve insights) |
| **NEW** | `lib/ai/embeddings.ts` | Vector embedding generation |
| **NEW** | `lib/ai/mcp/server.ts` | MCP tool/resource server |
| **NEW** | `lib/ai/mcp/adapter.ts` | MCP → Gemini/OpenAI format adapter |
| **NEW** | `lib/ai/mcp/tool-categories.ts` | Always-loaded vs. deferred tool classification |
| **NEW** | `lib/ai/mcp/tool-search.ts` | Semantic tool discovery with embedding index |
| **NEW** | `lib/ai/ptc/sandbox.ts` | Sandboxed JS executor for programmatic tool calling |
| **NEW** | `lib/ai/ptc/executor.ts` | PTC-enabled agent executor |
| **NEW** | `lib/ai/ptc/config.ts` | Per-skill PTC enable/disable config |
| **NEW** | `lib/ai/prompts/ptc-instructions.ts` | PTC system prompt instructions |
| **NEW** | `lib/ai/tracing.ts` | Trace/span creation and recording |
| **NEW** | `lib/ai/tracing-queries.ts` | Trace dashboard queries |
| **NEW** | `lib/ai/model-router.ts` | Multi-model routing logic |
| **MODIFY** | `prisma/schema.prisma` | Add `Insight` model, extend `AgentExecution` |
| **MODIFY** | `lib/ai/agent.ts` | Integrate model router, tracing, and PTC |

---

## References

- [pgvector Documentation](https://github.com/pgvector/pgvector)
- [MCP Specification](https://modelcontextprotocol.io/specification)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Google text-embedding-005](https://ai.google.dev/gemini-api/docs/models/gemini#text-embedding)
- [OpenTelemetry for AI](https://opentelemetry.io/) — Reference for tracing patterns
- [Anthropic Claude Opus 4.6 Release Notes](https://www.anthropic.com/news/claude-opus-4-6)
- [Anthropic Advanced Tool Use: Tool Search Tool & Programmatic Tool Calling](https://www.anthropic.com/news/advanced-tool-use) — Nov 2025
- [Node.js VM Module](https://nodejs.org/api/vm.html) — Sandboxed code execution for PTC
