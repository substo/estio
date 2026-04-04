import type {
    EnhancementAggression,
    ImageEnhancementAnalysis,
    ImageEnhancementDetectedElement,
    ImageEnhancementSuggestedFix,
} from "@/lib/ai/property-image-enhancement-types";

const ENHANCEMENT_BASE_POLICY_PROMPT = `
Role: You are an Expert AI Image Enhancer and Photoshop Specialist focused on real-estate listing photos.
Objective: Transform flawed mobile photos into professional, photoreal, listing-ready images while preserving truthfulness of the property.

Core protocol:
- Fix framing (horizon tilt, awkward crop) and improve composition.
- Improve technical quality (noise, softness, exposure, white balance, color consistency).
- Remove distractions and clutter that reduce listing quality.
- Keep materials, architecture, and layout realistic.
- Never add misleading structural elements that change what the property is.
`.trim();

const AGGRESSION_GUIDANCE: Record<EnhancementAggression, string> = {
    conservative: "Conservative mode: minimal intervention. Preserve geometry, layout, and materials strictly. Only correct technical defects and obvious distractions.",
    balanced: "Balanced mode: moderate enhancement. Improve composition, lighting, and cleanup while preserving scene identity and property truthfulness.",
    aggressive: "Aggressive mode: stronger polish and cleanup allowed, but still photoreal and truthful to the property. Do not invent misleading property features.",
};

function toSingleLine(text: string): string {
    return String(text || "").replace(/\s+/g, " ").trim();
}

function normalizeComparisonText(text: string): string {
    return toSingleLine(text).toLowerCase();
}

export function getSelectedFixes(
    analysis: ImageEnhancementAnalysis,
    selectedFixIds: string[]
): ImageEnhancementSuggestedFix[] {
    const selectedSet = new Set((selectedFixIds || []).map((id) => String(id || "").trim()).filter(Boolean));
    return analysis.suggestedFixes.filter((fix) => selectedSet.has(fix.id));
}

export function getRemovedDetectedElements(
    analysis: ImageEnhancementAnalysis,
    removedDetectedElementIds: string[]
): ImageEnhancementDetectedElement[] {
    const removedSet = new Set((removedDetectedElementIds || []).map((id) => String(id || "").trim()).filter(Boolean));
    return analysis.detectedElements.filter((element) => removedSet.has(element.id));
}

export function resolveNeutralSceneContext(analysis: ImageEnhancementAnalysis): string {
    const rawContext = toSingleLine(analysis.sceneContext || "");
    const fallback = toSingleLine(analysis.sceneSummary || "")
        || "Property photo showing the true room layout, materials, and natural scene details.";

    if (!rawContext) {
        return fallback;
    }

    const haystack = normalizeComparisonText(rawContext);
    const fixSignals = analysis.suggestedFixes
        .flatMap((fix) => [fix.label, fix.promptInstruction])
        .map(normalizeComparisonText)
        .filter((signal) => signal.length >= 6);

    if (fixSignals.some((signal) => haystack.includes(signal))) {
        return fallback;
    }

    return rawContext;
}

function buildDetectedElementRemovalInstruction(element: ImageEnhancementDetectedElement): string {
    const label = toSingleLine(element.label || "the selected element");
    const category = toSingleLine(element.category || "area").toLowerCase();
    return `- Remove ${label} and reconstruct the surrounding ${category} naturally while preserving the property's real structure, layout, and materials.`;
}

export function buildAnalysisPrompt(input?: { priorPrompt?: string; userInstructions?: string }): string {
    const priorPrompt = String(input?.priorPrompt || "").trim();
    const userInstructions = String(input?.userInstructions || "").trim();
    return `
${ENHANCEMENT_BASE_POLICY_PROMPT}

Task:
1) Analyze the input property photo.
2) Identify scene elements and concrete listing-quality issues.
3) Propose practical fixes users can toggle on/off in UI chips.
4) Produce neutral scene context for the generation step.

Output strict JSON only:
{
  "sceneSummary": "string",
  "sceneContext": "string",
  "detectedElements": [
    {
      "id": "string",
      "label": "string",
      "category": "string",
      "severity": "low|medium|high",
      "confidence": 0.0,
      "rationale": "string",
      "bbox": { "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.2 }
    }
  ],
  "suggestedFixes": [
    {
      "id": "string",
      "label": "string",
      "description": "string",
      "impact": "low|medium|high",
      "defaultSelected": true,
      "promptInstruction": "short imperative instruction"
    }
  ],
  "actionLogDraft": ["string"]
}

Rules:
- Keep bbox optional and normalized to 0..1 when provided.
- Keep labels concise and UI-friendly.
- Focus on real-estate listing improvements (composition, cleanup, lighting, clarity, realism).
- Do not suggest changes that misrepresent property structure.
- "sceneContext" must stay neutral and descriptive. Do not embed optional fixes, removals, or edit instructions in it.
- Pay close attention to operator-reported issues. If the user asks to inspect or remove something specific, prefer returning a candidate fix or detected element rather than omitting it entirely, unless it is clearly absent.
${userInstructions ? `\nOperator instructions / suspected issues:\n${userInstructions}` : ""}
${priorPrompt ? `\nReference legacy enhancement instructions:\n${priorPrompt}` : ""}
`.trim();
}

export function buildGenerationPrompt(input: {
    analysis: ImageEnhancementAnalysis;
    selectedFixIds: string[];
    removedDetectedElementIds?: string[];
    aggression: EnhancementAggression;
    priorPrompt?: string;
    userInstructions?: string;
}): string {
    const selectedFixes = getSelectedFixes(input.analysis, input.selectedFixIds);
    const removedElements = getRemovedDetectedElements(input.analysis, input.removedDetectedElementIds || []);
    const selectedInstructions = selectedFixes.map((fix) => `- ${fix.promptInstruction}`);
    const selectedLabels = selectedFixes.map((fix) => fix.label);
    const removedLabels = removedElements.map((element) => element.label);
    const removalInstructions = removedElements.map(buildDetectedElementRemovalInstruction);
    const priorPrompt = String(input.priorPrompt || "").trim();
    const userInstructions = String(input.userInstructions || "").trim();
    const aggressionGuidance = AGGRESSION_GUIDANCE[input.aggression] || AGGRESSION_GUIDANCE.balanced;
    const neutralSceneContext = resolveNeutralSceneContext(input.analysis);

    return `
${ENHANCEMENT_BASE_POLICY_PROMPT}

Editing mode:
${aggressionGuidance}

Scene summary:
${input.analysis.sceneSummary}

Neutral scene context:
${neutralSceneContext}

Selected enhancement fixes:
${selectedInstructions.length > 0 ? selectedInstructions.join("\n") : "- Keep composition and only apply gentle technical polish."}

Detected elements to remove:
${removalInstructions.length > 0 ? removalInstructions.join("\n") : "- None selected."}

Manual operator instructions:
${userInstructions ? userInstructions : "None provided."}

Important guardrails:
- Preserve room layout, dimensions, architecture, and material truthfulness.
- Remove distractions only when they are non-essential clutter.
- Keep output photoreal and listing-ready.
- No fake staging objects unless naturally implied by scene.

Response requirements:
1) Return an edited image.
2) Include a short plain-text action log line list describing applied changes.
3) If a requested fix is not feasible from this image, mention it in action log.

Selected fix labels:
${selectedLabels.length > 0 ? selectedLabels.join(", ") : "None (technical polish only)"}

Detected element removal labels:
${removedLabels.length > 0 ? removedLabels.join(", ") : "None"}

${priorPrompt ? `Legacy prompt reference:\n${priorPrompt}` : ""}
`.trim();
}

export function buildReusablePromptContext(input: {
    analysis: ImageEnhancementAnalysis;
    selectedFixIds: string[];
    removedDetectedElementIds?: string[];
    aggression: EnhancementAggression;
    userInstructions?: string;
}): string {
    const selectedFixes = getSelectedFixes(input.analysis, input.selectedFixIds);
    const removedElements = getRemovedDetectedElements(input.analysis, input.removedDetectedElementIds || []);
    const selectedInstructions = selectedFixes.map((fix) => `- ${fix.promptInstruction}`);
    const removalInstructions = removedElements.map(buildDetectedElementRemovalInstruction);
    const userInstructions = String(input.userInstructions || "").trim();
    const aggressionGuidance = AGGRESSION_GUIDANCE[input.aggression] || AGGRESSION_GUIDANCE.balanced;
    const neutralSceneContext = resolveNeutralSceneContext(input.analysis);

    return `
Reusable enhancement context for similar property photos of the same scene:
- Keep edits consistent across adjacent shots of this room or exterior.
- ${aggressionGuidance}

Scene summary:
${input.analysis.sceneSummary}

Neutral scene context:
${neutralSceneContext}

Preferred fixes:
${selectedInstructions.length > 0 ? selectedInstructions.join("\n") : "- Gentle technical polish only."}

Preferred removals when present:
${removalInstructions.length > 0 ? removalInstructions.join("\n") : "- None."}

Operator notes:
${userInstructions || "None provided."}

Global guardrails:
- Preserve architecture, layout, materials, and room proportions.
- Keep the result photoreal and listing-ready.
- Avoid introducing staged or misleading property features.
`.trim();
}
