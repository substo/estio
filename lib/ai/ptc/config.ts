
/**
 * Configuration for Programmatic Tool Calling (PTC).
 * 
 * PTC is more expensive (requires smarter model) and complex,
 * so we only enable it for skills that benefit from multi-step logic.
 */

export const PTC_ENABLED_SKILLS = [
    "property_search",      // Complex filtering + sorting + formatting
    "viewing_management",   // Check calendar -> find slot -> book -> notify
    "deal_coordinator",     // Orchestrate checks across multiple records
    "market_analysis",      // Data fetching + synthesis
];

export function shouldUsePTC(skillName: string): boolean {
    // In Phase 0, we can default to false or selectively enable.
    // For testing, we might want to force it on via env var
    if (process.env.FORCE_ENABLE_PTC === "true") return true;

    return PTC_ENABLED_SKILLS.includes(skillName);
}
