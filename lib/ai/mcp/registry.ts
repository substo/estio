
export interface ToolHandlerContext {
    apiKey?: string;
    [key: string]: any;
}

/**
 * Global registry for MCP tools.
 * 
 * Extracted from server.ts to avoid circular dependencies:
 * server -> tool-search -> server
 * server -> adapter -> server
 */
export const toolRegistry: {
    name: string;
    description: string;
    inputSchema: any;
    handler: (params: any, context?: ToolHandlerContext) => Promise<any>
}[] = [];

export function registerToolInRegistry(
    name: string,
    description: string,
    schema: any,
    handler: (params: any, context?: ToolHandlerContext) => Promise<any>
) {
    toolRegistry.push({ name, description, inputSchema: schema, handler });
}
