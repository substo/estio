
/**
 * Global registry for MCP tools.
 * 
 * Extracted from server.ts to avoid circular dependencies:
 * server -> tool-search -> server
 * server -> adapter -> server
 */
export const toolRegistry: { name: string; description: string; inputSchema: any; handler: any }[] = [];

export function registerToolInRegistry(name: string, description: string, schema: any, handler: any) {
    toolRegistry.push({ name, description, inputSchema: schema, handler });
}
