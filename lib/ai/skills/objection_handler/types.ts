export const OBJECTION_CATEGORIES = {
    PRICE: {
        examples: ["Too expensive", "Over budget", "Can't afford it", "Not worth that much"],
        severity: "high",
        commonRebuttals: ["value_comparison", "financing_options", "price_per_sqm", "roi_analysis"],
    },
    LOCATION: {
        examples: ["Too far", "Don't like the area", "Not safe", "Too noisy"],
        severity: "medium",
        commonRebuttals: ["neighborhood_highlights", "upcoming_development", "alternative_areas"],
    },
    TIMING: {
        examples: ["Not ready yet", "Need more time", "Want to wait for prices to drop"],
        severity: "medium",
        commonRebuttals: ["market_trends", "opportunity_cost", "flexible_timeline"],
    },
    PROPERTY_SPECIFIC: {
        examples: ["Too small", "Needs renovation", "No garden", "Wrong floor"],
        severity: "low",
        commonRebuttals: ["alternative_properties", "renovation_potential", "priority_reframing"],
    },
    TRUST: {
        examples: ["Not sure about the agency", "Want to check other agencies", "Bad reviews"],
        severity: "high",
        commonRebuttals: ["testimonials", "track_record", "no_pressure_approach"],
    },
    COMPETITOR: {
        examples: ["Found cheaper options elsewhere", "Another agent offered me better"],
        severity: "high",
        commonRebuttals: ["unique_value", "total_cost_comparison", "service_differentiation"],
    },
};
