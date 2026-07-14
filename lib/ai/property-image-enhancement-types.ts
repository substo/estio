export const ENHANCEMENT_AGGRESSION_LEVELS = [
    "conservative",
    "balanced",
    "aggressive",
] as const;

export type EnhancementAggression = typeof ENHANCEMENT_AGGRESSION_LEVELS[number];

export const ENHANCEMENT_MODES = [
    "polish",
    "precision_remove",
] as const;

export type EnhancementMode = typeof ENHANCEMENT_MODES[number];

export const IMAGE_TRANSFORM_ASPECT_RATIOS = [
    "original",
    "1:1",
    "4:3",
    "3:2",
    "16:9",
    "9:16",
    "2:3",
    "custom",
] as const;

export type ImageTransformAspectRatio = typeof IMAGE_TRANSFORM_ASPECT_RATIOS[number];

export const IMAGE_TRANSFORM_ASPECT_RATIO_STRATEGIES = [
    "expand",
    "crop",
] as const;

export type ImageTransformAspectRatioStrategy = typeof IMAGE_TRANSFORM_ASPECT_RATIO_STRATEGIES[number];

export const IMAGE_UPSCALE_FACTORS = [
    "off",
    "2x",
    "3x",
    "4x",
] as const;

export type ImageUpscaleFactor = typeof IMAGE_UPSCALE_FACTORS[number];

export const IMAGE_TRANSFORM_QUALITIES = [
    "standard",
    "high",
] as const;

export type ImageTransformQuality = typeof IMAGE_TRANSFORM_QUALITIES[number];

export interface ImageOutputIntent {
    aspectRatio?: ImageTransformAspectRatio;
    customAspectRatio?: string;
    aspectRatioStrategy?: ImageTransformAspectRatioStrategy;
    upscaleFactor?: ImageUpscaleFactor;
    quality?: ImageTransformQuality;
}

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
    sceneContext: string;
    suggestedRoomType?: PropertyImageRoomType;
    roomTypeCandidates?: PropertyImageRoomType[];
    detectedElements: ImageEnhancementDetectedElement[];
    suggestedFixes: ImageEnhancementSuggestedFix[];
    actionLogDraft: string[];
}

export interface ImageEnhancementAnalysisRequest {
    locationId: string;
    propertyId: string;
    cloudflareImageId?: string;
    sourceUrl?: string;
    analysisModel?: string;
    priorPrompt?: string;
    userInstructions?: string;
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
    removedDetectedElementIds: string[];
    aggression: EnhancementAggression;
    generationModel?: string;
    priorPrompt?: string;
    userInstructions?: string;
    outputIntent?: ImageOutputIntent;
}

export interface ImageEnhancementGenerateResponse {
    success: true;
    generatedImageId: string;
    generatedImageUrl: string;
    actionLog: string[];
    finalPrompt: string;
    reusablePrompt: string;
    model: string;
}

export interface ImageEnhancementGeneratedResult {
    mode: EnhancementMode;
    generatedImageId: string;
    generatedImageUrl: string;
    actionLog: string[];
    model: string;
    finalPrompt?: string;
    reusablePrompt?: string;
    maskCoverage?: number;
    outputIntent?: ImageOutputIntent;
}

export interface PropertyImageRoomType {
    key: string;
    label: string;
    confidence?: number;
}

export interface PropertyImagePromptProfile {
    roomTypeKey: string;
    roomTypeLabel: string;
    promptContext: string;
    analysisData?: ImageEnhancementAnalysis;
    updatedAt?: string;
    updatedById?: string | null;
}

export interface PropertyImagePromptProfileUpsert {
    roomTypeKey: string;
    roomTypeLabel: string;
    promptContext: string;
    analysisData?: ImageEnhancementAnalysis;
}

export interface ImageEnhancementRoomTypePredictRequest {
    locationId: string;
    propertyId: string;
    cloudflareImageId?: string;
    sourceUrl?: string;
    analysisModel?: string;
}

export interface ImageEnhancementRoomTypePredictResponse {
    success: true;
    suggestedRoomType: PropertyImageRoomType;
    candidates: PropertyImageRoomType[];
    model: string;
}

export interface ImagePrecisionRemoveRequest {
    locationId: string;
    propertyId: string;
    cloudflareImageId?: string;
    sourceUrl?: string;
    maskMode?: "user_provided" | "background" | "foreground" | "semantic";
    maskPngBase64?: string;
    editorWidth?: number;
    editorHeight?: number;
    semanticMaskClassIds?: number[];
    guidance?: string;
    generationModel?: string;
    outputIntent?: ImageOutputIntent;
}

export interface ImagePrecisionRemoveResponse {
    success: true;
    generatedImageId: string;
    generatedImageUrl: string;
    actionLog: string[];
    model: string;
    maskCoverage?: number;
}
