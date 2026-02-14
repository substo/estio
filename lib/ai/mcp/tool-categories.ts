
/**
 * Tools are split into two tiers:
 * - ALWAYS_LOADED: Used in >50% of agent calls. Always in context.
 * - DEFERRED: Used rarely. Discoverable via Tool Search.
 */
export const ALWAYS_LOADED_TOOLS = [
    "search_properties",      // Used in most conversations
    "update_requirements",    // Core qualification tool
    "store_insight",          // Memory — used every call
    "draft_reply",            // Always needed (note: this is often a system instruction, not a tool, but listing for completeness)
    "log_activity",           // Always needed
    "retrieve_context",       // Memory retrieval — used every call
    "create_viewing",         // Fairly common
    "semantic_search",        // Core searcher skill
    "recommend_similar",      // Core searcher skill
    // Phase 4: Coordinator tools
    "check_availability",     // Coordinator agent
    "propose_slots",          // Coordinator agent
    "confirm_viewing",        // Coordinator agent
    "request_feedback",       // Post-viewing follow-up
    "submit_feedback",        // Process feedback
];

export const DEFERRED_TOOLS = [
    "generate_contract",      // Only in closing phase
    "send_docusign",          // Only in closing phase
    "send_offer",             // Only in negotiation phase
    "calculate_mortgage",     // Rarely used
    "analyze_market_trends",  // Rarely used
    "generate_property_report", // Rarely used
    "send_listing_alert",     // Only in auto-pilot
    "create_deal",            // Only at deal creation
];

