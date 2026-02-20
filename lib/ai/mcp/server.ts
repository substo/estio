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

function resolveAgentUserId(rawValue: any, context?: ToolHandlerContext): string | undefined {
    const fromContext = context?.agentUserId as string | undefined;
    if (typeof rawValue !== "string") return rawValue || fromContext;

    const normalized = rawValue.trim().toLowerCase();
    const placeholders = new Set([
        "current_user",
        "current-agent",
        "current_agent",
        "agent",
        "agent_id",
        "assigned_agent",
    ]);

    if (placeholders.has(normalized)) return fromContext;
    return rawValue || fromContext;
}

function normalizeDateWindow(
    rawStart: string,
    rawEnd: string,
    context?: ToolHandlerContext
): { startDate: Date; endDate: Date; normalizedToFutureYear: boolean } {
    const startDate = new Date(rawStart);
    const endDate = new Date(rawEnd);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        throw new Error("Invalid date format. Use ISO date strings.");
    }

    const now = new Date();
    const latestUserMessage = typeof context?.latestUserMessage === "string" ? context.latestUserMessage : "";
    const hasExplicitYear = /\b20\d{2}\b/.test(latestUserMessage);
    let normalizedToFutureYear = false;

    if (endDate < now) {
        if (hasExplicitYear) {
            throw new Error("Requested viewing dates are in the past. Ask the lead to confirm the year.");
        }

        while (endDate < now) {
            startDate.setFullYear(startDate.getFullYear() + 1);
            endDate.setFullYear(endDate.getFullYear() + 1);
            normalizedToFutureYear = true;
        }
    }

    return { startDate, endDate, normalizedToFutureYear };
}

function normalizeInsightImportance(raw: any): number | undefined {
    if (raw === null || raw === undefined || raw === "") return undefined;
    if (typeof raw === "number" && Number.isFinite(raw)) {
        return Math.max(1, Math.min(10, Math.round(raw)));
    }
    if (typeof raw === "string") {
        const normalized = raw.trim().toLowerCase();
        if (!normalized) return undefined;

        const asNumber = Number(normalized);
        if (Number.isFinite(asNumber)) {
            return Math.max(1, Math.min(10, Math.round(asNumber)));
        }

        if (normalized === "low") return 3;
        if (normalized === "medium") return 5;
        if (normalized === "high") return 8;
        if (normalized === "critical") return 10;
    }
    return undefined;
}

function normalizeInsightCategory(raw: any): "preference" | "objection" | "timeline" | "motivation" | "relationship" {
    const allowed = new Set(["preference", "objection", "timeline", "motivation", "relationship"]);
    const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (allowed.has(value)) return value as "preference" | "objection" | "timeline" | "motivation" | "relationship";

    if (value === "preferences") return "preference";
    if (value === "qualification" || value === "qualifications") return "motivation";
    if (value === "financial") return "motivation";
    if (value === "timing") return "timeline";
    if (value === "trust") return "relationship";

    return "preference";
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
        q: z.string().optional().describe("General search text (title/reference/slug)"),
        reference: z.string().optional().describe("Property reference like DT3762"),
        district: z.string().optional().describe("Property district/area (e.g. 'Paphos', 'Limassol')"),
        maxPrice: z.number().optional().describe("Maximum price in EUR"),
        minPrice: z.number().optional().describe("Minimum price in EUR"),
        bedrooms: z.number().optional().describe("Number of bedrooms"),
        propertyType: z.string().optional().describe("Type: Apartment, Villa, House, etc."),
        dealType: z.enum(["sale", "rent"]).optional().describe("Sale or Rent"),
    },
    async (params: any, context?: ToolHandlerContext) => {
        const locationId = params.locationId || context?.locationId;
        if (!locationId) {
            throw new Error("locationId is required for search_properties.");
        }
        const { locationId: _ignoredLocationId, dealType, ...query } = params;
        const mappedQuery: any = { ...query };
        if (dealType) mappedQuery.status = dealType;

        // Implementation calls existing searchProperties logic
        const results = await tools.searchProperties(locationId, mappedQuery);
        return { content: [{ type: "text", text: JSON.stringify(results) }] };
    }
);

registerTool(
    "resolve_viewing_property_context",
    "Resolve which property the lead means and return viewing logistics (availability path, key access, occupancy, and rental/sale policies) before calendar scheduling.",
    {
        contactId: z.string().optional().describe("Contact ID (local or GHL)"),
        conversationId: z.string().optional().describe("Conversation ID for message context"),
        message: z.string().optional().describe("Latest lead message or text containing ref/url"),
        propertyReference: z.string().optional().describe("Explicit property reference if already known"),
        propertyUrl: z.string().optional().describe("Explicit property URL if already known")
    },
    async (params: any, context?: ToolHandlerContext) => {
        const result = await tools.resolveViewingPropertyContext({
            contactId: params.contactId || context?.contactId,
            conversationId: params.conversationId || context?.conversationId,
            locationId: context?.locationId,
            message: params.message || context?.latestUserMessage,
            propertyReference: params.propertyReference,
            propertyUrl: params.propertyUrl
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
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
    async (params: any, context?: ToolHandlerContext) => {
        const { query, ...filters } = params;
        const locationId = params.locationId || context?.locationId;
        if (!locationId) {
            throw new Error("locationId is required for semantic_search.");
        }

        try {
            const results = await hybridPropertySearch({
                ...filters,
                locationId,
                naturalLanguageQuery: query,
                limit: 5
            });
            return { content: [{ type: "text", text: JSON.stringify(results) }] };
        } catch (error: any) {
            const message = String(error?.message || "");
            const isEmbeddingUnavailable =
                message.includes('column "embedding" does not exist') ||
                message.includes("42703") ||
                message.toLowerCase().includes("vector");

            if (!isEmbeddingUnavailable) {
                throw error;
            }

            const fallback = await tools.searchProperties(locationId, {
                district: filters.district,
                minPrice: filters.minPrice,
                maxPrice: filters.maxPrice,
                q: query,
                reference: query
            });
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        fallback: true,
                        fallbackReason: "semantic_search_unavailable",
                        ...fallback
                    })
                }]
            };
        }
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
        category: z.string().describe("Insight category (preference, objection, timeline, motivation, relationship)"),
        importance: z.union([z.number().min(1).max(10), z.string()]).optional(),
    },
    async (params: any) => {
        await storeInsight({
            ...params,
            category: normalizeInsightCategory(params.category),
            importance: normalizeInsightImportance(params.importance)
        });
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
    async (params: any, context?: ToolHandlerContext) => {
        const { checkAvailability } = await import("../tools/calendar");
        const userId = resolveAgentUserId(params.userId, context);
        if (!userId) {
            throw new Error("Could not resolve a valid userId for check_availability.");
        }
        const { startDate, endDate, normalizedToFutureYear } = normalizeDateWindow(
            params.startDate,
            params.endDate,
            context
        );
        const result = await checkAvailability(
            userId,
            startDate,
            endDate,
            params.durationMinutes
        );
        const payload = normalizedToFutureYear
            ? { ...result, normalizedToFutureYear, normalizedStartDate: startDate.toISOString(), normalizedEndDate: endDate.toISOString() }
            : result;
        return { content: [{ type: "text", text: JSON.stringify(payload) }] };
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
    async (params: any, context?: ToolHandlerContext) => {
        const { proposeSlots } = await import("../tools/calendar");
        const agentUserId = resolveAgentUserId(params.agentUserId, context);
        if (!agentUserId) {
            throw new Error("Could not resolve a valid agentUserId for propose_slots.");
        }
        const result = await proposeSlots(agentUserId, params.propertyId, params.daysAhead);
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

// ── NEGOTIATION & CLOSING TOOLS (Phase 5) ─────────────────

registerTool(
    "create_offer",
    "Create a new offer for a deal.",
    {
        dealId: z.string().describe("Deal Context ID"),
        type: z.enum(["initial", "counter", "final"]).describe("Type of offer"),
        fromRole: z.enum(["buyer", "seller"]).describe("Who is making the offer"),
        amount: z.number().describe("Offer amount"),
        conditions: z.string().optional().describe("Conditions (e.g., subject to survey)"),
        reasoning: z.string().optional().describe("Justification for the offer")
    },
    async (params: any) => {
        const result = await tools.createOffer(params);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
);

registerTool(
    "get_offer_history",
    "Retrieve the full offer history for a deal.",
    {
        dealId: z.string().describe("Deal Context ID")
    },
    async (params: any) => {
        const result = await tools.getOfferHistory(params.dealId);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
);

registerTool(
    "calculate_mortgage",
    "Calculate estimated monthly mortgage payments.",
    {
        propertyPrice: z.number(),
        downPaymentPercent: z.number().default(20),
        interestRate: z.number().default(3.5),
        termYears: z.number().default(20)
    },
    async (params: any) => {
        const result = await tools.calculateMortgage(params);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
);

registerTool(
    "price_comparison",
    "Compare the target property's price against similar properties.",
    {
        district: z.string().describe("District name (e.g., 'Sea Caves')"),
        propertyType: z.string().optional().describe("Property type (e.g. 'Villa', 'Apartment')"),
        bedrooms: z.number().optional().describe("Number of bedrooms to approximate match")
    },
    async (params: any) => {
        const result = await tools.priceComparison(params);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
);

registerTool(
    "generate_contract",
    "Generate a legal contract PDF.",
    {
        dealId: z.string(),
        type: z.enum(["reservation", "sales_contract"]),
        buyer: z.object({
            name: z.string(),
            email: z.string(),
            address: z.string()
        }),
        seller: z.object({
            name: z.string(),
            email: z.string(),
            address: z.string()
        }),
        property: z.object({
            title: z.string(),
            address: z.string(),
            area: z.number()
        }),
        terms: z.object({
            agreedPrice: z.number(),
            depositAmount: z.number(),
            completionDate: z.string().describe("Date string"),
            conditions: z.array(z.string())
        })
    },
    async (params: any) => {
        const result = await tools.generateContract(params);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
);

registerTool(
    "send_for_signature",
    "Send a document for e-signature via GoHighLevel (Stub).",
    {
        documentId: z.string().describe("DealDocument ID"),
        fileUrl: z.string().describe("URL of the PDF"),
        signers: z.array(z.object({
            email: z.string(),
            name: z.string(),
            role: z.string(),
            order: z.number()
        }))
    },
    async (params: any) => {
        const result = await tools.sendForSignature(params);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
);

registerTool(
    "check_signature_status",
    "Check the status of an e-signature envelope.",
    {
        documentId: z.string()
    },
    async (params: any) => {
        const result = await tools.checkSignatureStatus(params.documentId);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
);

// ── OTHER TOOLS ───────────────────────────────────


registerTool(
    "log_activity",
    "Log a concise CRM summary for today's interaction with this contact. Write ONE short line summarizing: intent, property refs mentioned, key decisions/preferences revealed, and next actions. Example: 'Interested in DT3762 (2bed apt, Chlorakas). Budget ~€750/mo rent. Wants viewing this week.' This entry will be visible to agents on the contact's Details tab.",
    {
        contactId: z.string().describe("Contact ID"),
        message: z.string().describe("Concise one-line summary of today's interaction (no date prefix needed)")
    },
    async (params: any) => {
        const result = await tools.appendLog(params.contactId, params.message);
        const success = typeof result === "object" && (result as any).success === false ? false : true;
        return {
            content: [{ type: "text", text: success ? "Activity logged." : JSON.stringify(result) }]
        };
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
            include: {
                location: true,
                offers: true,
                documents: true
            }
        });

        return { contents: [{ uri: uri.href, text: JSON.stringify(deal), mimeType: "application/json" }] };
    }
);

// Initialize the search index asynchronously
// Note: In a real server context, we might await this or treat it as side-effect startup
// For now, we'll kick it off.
initToolSearchIndex(server).catch(e => console.error("Failed to init tool search index", e));
