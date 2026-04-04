export const ENHANCEMENT_AGGRESSION_LEVELS = [
    "conservative",
    "balanced",
    "aggressive",
] as const;

export type EnhancementAggression = typeof ENHANCEMENT_AGGRESSION_LEVELS[number];

export const ENHANCEMENT_MODEL_TIERS = [
    "nano_banana_2",
    "nano_banana_pro",
] as const;

export type EnhancementModelTier = typeof ENHANCEMENT_MODEL_TIERS[number];

export interface ImageEnhancementBoundingBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ImageEnhancementDetectedElement {
    id: string;
    label: string;
    category: string;
    severity: "low" | "medium" | "high";
    confidence: number;
    rationale?: string;
    bbox?: ImageEnhancementBoundingBox;
}

export interface ImageEnhancementSuggestedFix {
    id: string;
    label: string;
    description: string;
    impact: "low" | "medium" | "high";
    defaultSelected: boolean;
    promptInstruction: string;
}

export interface ImageEnhancementAnalysis {
    sceneSummary: string;
    detectedElements: ImageEnhancementDetectedElement[];
    suggestedFixes: ImageEnhancementSuggestedFix[];
    promptPolish: string;
    actionLogDraft: string[];
}

export interface ImageEnhancementAnalysisRequest {
    locationId: string;
    propertyId: string;
    cloudflareImageId?: string;
    sourceUrl?: string;
    modelTier?: EnhancementModelTier;
    priorPrompt?: string;
}

export interface ImageEnhancementAnalysisResponse {
    success: true;
    analysis: ImageEnhancementAnalysis;
    model: string;
}

export interface ImageEnhancementGenerateRequest {
    locationId: string;
    propertyId: string;
    cloudflareImageId?: string;
    sourceUrl?: string;
    analysis: ImageEnhancementAnalysis;
    selectedFixIds: string[];
    aggression: EnhancementAggression;
    modelTier?: EnhancementModelTier;
    priorPrompt?: string;
}

export interface ImageEnhancementGenerateResponse {
    success: true;
    generatedImageId: string;
    generatedImageUrl: string;
    actionLog: string[];
    finalPrompt: string;
    model: string;
}
