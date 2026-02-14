
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { executePTC } from "./sandbox";
import { toolRegistry } from "../mcp/registry";

/**
 * Executes a task using Programmatic Tool Calling (PTC).
 * 
 * 1. Takes the LLM response (which may contain a ```javascript code block).
 * 2. Extracts the code block.
 * 3. Builds a map of executable tool functions from the MCP registry.
 * 4. Runs the code in the sandbox.
 * 5. Returns the result of the execution.
 */
export async function executeWithPTC(
    llmResponseText: string,
    mcpServer: McpServer, // We use the registry directly, but keep signature compatible
): Promise<{ success: boolean; result?: any; logs?: string[]; error?: string }> {

    const code = extractCodeBlock(llmResponseText);
    if (!code) {
        return { success: false, error: "No code block found in response" };
    }

    // Build executable tool map
    // We need to wrap MCP tools into async functions that the sandbox can call
    const tools: Record<string, (...args: any[]) => Promise<any>> = {};

    // Use the internal registry we exposed
    for (const tool of toolRegistry) {
        tools[tool.name] = async (args: any) => {
            console.log(`[PTC] Calling tool ${tool.name}`, args);
            const result = await tool.handler(args);
            return result;
        };
    }

    try {
        const { result, logs, toolCalls } = await executePTC(code, tools, { timeoutMs: 15000 });
        return { success: true, result, logs };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

/**
 * Extracts the content of the first ```javascript or ```typescript code block.
 * Fallback to ``` if no language specified.
 */
function extractCodeBlock(text: string): string | null {
    const codeBlockRegex = /```(?:javascript|js|typescript|ts)?\n([\s\S]*?)```/;
    const match = text.match(codeBlockRegex);
    return match ? match[1].trim() : null;
}
