import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as tools from "../tools";
import { updateLeadScore } from "../tools/lead-scoring";
import { retrieveRebuttal } from "../tools/rebuttal";
import { storeInsight } from "../memory";
import { searchTools, initToolSearchIndex } from "./tool-search";
import { hybridPropertySearch } from "../search/hybrid-search";
import { findSimilarProperties } from "../search/recommendations";
import db from "@/lib/db";
import { registerToolInRegistry, ToolHandlerContext } from "./registry";

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
function registerTool(
    name: string,
    description: string,
    schema: any,
    handler: (params: any, context?: ToolHandlerContext) => Promise<any>
) {
    registerToolInRegistry(name, description, schema, handler);
    // For external MCP clients, context will be undefined.
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
    "semantic_search",
    "Search for properties using natural language to find matches based on style, vibe, and description.",
    {
        locationId: z.string().describe("The location ID (e.g. substo_estio)"),
        query: z.string().describe("Natural language query (e.g. 'modern sea view villa with pool')"),
        minPrice: z.number().optional(),
        maxPrice: z.number().optional(),
        district: z.string().optional(),
    },
    async (params: any) => {
        const { query, ...filters } = params;
        const results = await hybridPropertySearch({
            ...filters,
            naturalLanguageQuery: query,
            limit: 5
        });
        return { content: [{ type: "text", text: JSON.stringify(results) }] };
    }
);

registerTool(
    "recommend_similar",
    "Find properties similar to a specific property based on visual/descriptive similarity.",
    {
        propertyId: z.string().describe("The ID of the property the client liked"),
        excludeIds: z.array(z.string()).optional().describe("IDs of properties to exclude (e.g. already seen)"),
    },
    async (params: any) => {
        const results = await findSimilarProperties(params.propertyId, 5, params.excludeIds);
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

// ── PHASE 4: COORDINATOR TOOLS ────────────────────

registerTool(
    "check_availability",
    "Check calendar availability for a user to find free time slots.",
    {
        userId: z.string().describe("User ID to check availability for"),
        startDate: z.string().describe("Start date (ISO string)"),
        endDate: z.string().describe("End date (ISO string)"),
        durationMinutes: z.number().optional().default(60).describe("Duration of each slot in minutes")
    },
    async (params: any) => {
        const { checkAvailability } = await import("../tools/calendar");
        const result = await checkAvailability(
            params.userId,
            new Date(params.startDate),
            new Date(params.endDate),
            params.durationMinutes
        );
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
);

registerTool(
    "propose_slots",
    "Propose 3 diverse time slots for a property viewing.",
    {
        agentUserId: z.string().describe("Agent user ID"),
        propertyId: z.string().describe("Property ID for the viewing"),
        daysAhead: z.number().optional().default(7).describe("How many days ahead to search")
    },
    async (params: any) => {
        const { proposeSlots } = await import("../tools/calendar");
        const result = await proposeSlots(params.agentUserId, params.propertyId, params.daysAhead);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
);

registerTool(
    "confirm_viewing",
    "Confirm a viewing and send calendar invitations to all parties.",
    {
        viewingId: z.string().describe("Viewing ID"),
        slotStart: z.string().describe("Selected slot start time (ISO string)"),
        slotEnd: z.string().describe("Selected slot end time (ISO string)"),
        attendees: z.array(z.object({
            email: z.string(),
            name: z.string(),
            role: z.enum(["agent", "lead", "owner"])
        })).describe("List of attendees to invite")
    },
    async (params: any) => {
        const { confirmViewing } = await import("../tools/calendar");
        const result = await confirmViewing({
            viewingId: params.viewingId,
            selectedSlot: {
                start: new Date(params.slotStart),
                end: new Date(params.slotEnd),
                available: true
            },
            attendees: params.attendees
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
);

registerTool(
    "request_feedback",
    "Check for viewings that need post-viewing follow-up.",
    {},
    async () => {
        const { checkPendingFollowUps } = await import("../tools/follow-up");
        const result = await checkPendingFollowUps();
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
);

registerTool(
    "submit_feedback",
    "Process feedback for a completed viewing and determine next steps.",
    {
        viewingId: z.string().describe("The ID of the viewing"),
        overallRating: z.number().min(1).max(5).describe("Rating from 1-5"),
        liked: z.array(z.string()).describe("List of things the lead liked"),
        disliked: z.array(z.string()).describe("List of things the lead disliked"),
        interestedInOffer: z.boolean().describe("Whether the lead wants to make an offer"),
        comments: z.string().describe("Any additional comments")
    },
    async (params: any) => {
        const { processViewingFeedback } = await import("../tools/follow-up");
        const result = await processViewingFeedback({
            viewingId: params.viewingId,
            overallRating: params.overallRating as 1 | 2 | 3 | 4 | 5,
            liked: params.liked,
            disliked: params.disliked,
            interestedInOffer: params.interestedInOffer,
            comments: params.comments
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
);

// ── OTHER TOOLS ───────────────────────────────────


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

registerTool(
    "update_lead_score",
    "Update the contact's lead score (1-100) and qualification stage.",
    {
        contactId: z.string(),
        score: z.number().min(0).max(100),
        reason: z.string().describe("Why the score changed")
    },
    async (params: any) => {
        const result = await updateLeadScore(params.contactId, params.score, params.reason);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
);

registerTool(
    "retrieve_rebuttal",
    "Retrieve data-backed rebuttals from the Sales Playbook for a given objection.",
    {
        objectionText: z.string().describe("The user's objection (e.g. 'Too expensive')"),
        category: z.enum(["PRICE", "LOCATION", "TIMING", "PROPERTY_SPECIFIC", "TRUST", "COMPETITOR"]).optional()
    },
    async (params: any, context?: ToolHandlerContext) => {
        const results = await retrieveRebuttal(params.objectionText, params.category, context?.apiKey);
        return { content: [{ type: "text", text: JSON.stringify(results) }] };
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
