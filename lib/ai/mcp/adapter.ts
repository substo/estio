
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { zodToGeminiSchema } from "./schema-utils";
import { ALWAYS_LOADED_TOOLS } from "./tool-categories";
import { toolRegistry } from "./registry";
import { z } from "zod";

/**
 * Convert MCP tool definitions to Gemini/OpenAI function calling format.
 * This ensures we can use MCP as our single source of truth
 * regardless of which model we're calling.
 */
export function mcpToolsToGeminiFunctions(
    mcpServer: McpServer,
    options?: { includeDeferred?: boolean }
) {
    const tools = toolRegistry;

    // Filter tools based on strategy
    const filtered = options?.includeDeferred
        ? tools
        : tools.filter(t =>
            // Always include core tools
            ALWAYS_LOADED_TOOLS.includes(t.name) ||
            // Always include the tool_search meta-tool if it exists
            t.name === "tool_search"
        );

    return filtered.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: zodToGeminiSchema(z.object(tool.inputSchema)),
    }));
}
