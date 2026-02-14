import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as tools from "../tools";
import { storeInsight } from "../memory";
import { searchTools, initToolSearchIndex } from "./tool-search";
import db from "@/lib/db";
import { registerToolInRegistry } from "./registry";

/**
 * Creates and configures the Estio MCP Server.
 * 
 * Defines all available tools and resources for the AI agent.
 * This is the single source of truth for tool definitions.
 */
/**
 * Creates and configures the Estio MCP Server.
 * 
 * Defines all available tools and resources for the AI agent.
 * This is the single source of truth for tool definitions.
 */
export const server = new McpServer({
    name: "Estio Real Estate Agent",
    version: "1.0.0",
});

// Helper to register tools both in MCP and our internal registry
function registerTool(name: string, description: string, schema: any, handler: any) {
    registerToolInRegistry(name, description, schema, handler);
    server.tool(name, description, schema, handler);
}

// ── TOOLS ─────────────────────────────────────────

registerTool(
    "tool_search",
    "Search for available tools that can help with a specific task. Use this when you need a capability that isn't in your current tool set.",
    {
        query: z.string().describe("Natural language description of what you need to do"),
        maxResults: z.number().optional().default(3)
    },
    async (params: any) => {
        const results = await searchTools(params.query, params.maxResults);
        return {
            content: [{
                type: "text",
                text: JSON.stringify(results.map(t => ({
                    name: t.name,
                    description: t.description,
                    parameters: t.schema
                })))
            }]
        };
    }
);

registerTool(
    "search_properties",
    "Search for properties matching the given criteria. Returns a list of matching properties with key details.",
    {
        locationId: z.string().describe("The location ID (e.g. substo_estio)"), // Added required context param
        district: z.string().optional().describe("Property district/area (e.g. 'Paphos', 'Limassol')"),
        maxPrice: z.number().optional().describe("Maximum price in EUR"),
        minPrice: z.number().optional().describe("Minimum price in EUR"),
        bedrooms: z.number().optional().describe("Number of bedrooms"),
        // propertyType: z.string().optional().describe("Type: Apartment, Villa, House, etc."), // Not yet in searchProperties impl
        dealType: z.enum(["sale", "rent"]).optional().describe("Sale or Rent"),
    },
    async (params: any) => {
        const { locationId, dealType, ...query } = params;
        const mappedQuery: any = { ...query };
        if (dealType) mappedQuery.status = dealType;

        // Implementation calls existing searchProperties logic
        const results = await tools.searchProperties(locationId, mappedQuery);
        return { content: [{ type: "text", text: JSON.stringify(results) }] };
    }
);

registerTool(
    "update_requirements",
    "Update the contact's property requirements and preferences.",
    {
        contactId: z.string().describe("Contact ID"),
        locationId: z.string().describe("Location ID"),
        district: z.string().optional(),
        maxPrice: z.string().optional(),
        minPrice: z.string().optional(),
        bedrooms: z.string().optional(),
        status: z.string().optional(),
        notes: z.string().optional(),
    },
    async (params: any) => {
        const { contactId, locationId, ...reqs } = params;
        const result = await tools.updateContactRequirements(contactId, locationId, reqs);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
);

registerTool(
    "store_insight",
    "Store a noteworthy insight about the client for long-term memory.",
    {
        contactId: z.string(),
        text: z.string().describe("The insight to remember"),
        category: z.enum(["preference", "objection", "timeline", "motivation", "relationship"]),
        importance: z.number().min(1).max(10).optional(),
    },
    async (params: any) => {
        await storeInsight(params);
        return { content: [{ type: "text", text: "Insight stored successfully." }] };
    }
);

registerTool(
    "create_viewing",
    "Schedule a property viewing.",
    {
        contactId: z.string(),
        propertyId: z.string(),
        date: z.string().describe("ISO date string for viewing time"),
        notes: z.string().optional()
    },
    async (params: any) => {
        const result = await tools.createViewing(params.contactId, params.propertyId, params.date, params.notes);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
);

registerTool(
    "log_activity",
    "Log a general activity or note to the contact's history.",
    {
        contactId: z.string(),
        message: z.string()
    },
    async (params: any) => {
        await tools.appendLog(params.contactId, params.message);
        return { content: [{ type: "text", text: "Activity logged." }] };
    }
);


// ── RESOURCES ────────────────────────────────────

server.resource(
    "contact://{contactId}",
    "Full contact profile including requirements, properties, and insights",
    async (uri) => {
        // Need to parse parameters from uri template if SDK supports it, or manual matching
        // SDK `resource` callback receives the actual URI.
        // We'll simplisticly parse the end of the path.
        const contactId = uri.pathname.split("/").pop();
        if (!contactId) throw new Error("Invalid contact URI");

        const contact = await db.contact.findUnique({
            where: { id: contactId },
            include: {
                insights: true,
                propertyRoles: { include: { property: true } }
            }
        });

        return { contents: [{ uri: uri.href, text: JSON.stringify(contact), mimeType: "application/json" }] };
    }
);

server.resource(
    "deal://{dealId}",
    "Full deal context including all parties, timeline, and current stage",
    async (uri) => {
        const dealId = uri.pathname.split("/").pop();
        if (!dealId) throw new Error("Invalid deal URI");

        const deal = await db.dealContext.findUnique({
            where: { id: dealId },
            include: { location: true }
        });

        return { contents: [{ uri: uri.href, text: JSON.stringify(deal), mimeType: "application/json" }] };
    }
);

// Initialize the search index asynchronously
// Note: In a real server context, we might await this or treat it as side-effect startup
// For now, we'll kick it off.
initToolSearchIndex(server).catch(e => console.error("Failed to init tool search index", e));
