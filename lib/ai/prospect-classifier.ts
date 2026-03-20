import { callLLMWithMetadata } from './llm';
import { getModelForTask } from './model-router';
import db from '@/lib/db';

export interface ClassificationInput {
    name?: string | null;
    description?: string | null;
    listingCount?: number | null;
    platformRegistered?: string | null;
    profileUrl?: string | null;
    contactChannels?: string[];
    sampleListingTitles?: string[];
}

export interface ClassificationResult {
    isAgency: boolean;
    confidenceScore: number;
    reasoning: string;
}

const CLASSIFICATION_PROMPT = `You are an expert real estate industry classifier for a CRM application in Cyprus.

Your task is to determine whether a property seller/landlord on a classifieds platform is:
- A **Real Estate Agency / Developer / Property Management Company** ("agency")
- A **Private Individual** seller or landlord ("private")

## Signals to Evaluate

**Strong Agency Indicators** (each significantly increases confidence):
- Name contains corporate identifiers: "Properties", "Real Estate", "Estates", "Developers", "Group", "Ltd", "LLC", "Realty", "Management", "Consultants"
- Name contains Greek corporate identifiers: "ΜΕΣΙΤΙΚΟ", "ΚΤΗΜΑΤΙΚΑ", "ΛΤΔ"
- Platform registration says "Company" (vs personal)
- Has a profile URL (agencies tend to have dedicated pages)
- Has 5+ active listings on the platform
- Description uses corporate language: "our team", "we offer", "our portfolio", "years of experience"

**Strong Private Indicators** (each significantly increases confidence):
- Name is a simple personal name (first + last, no corporate suffix)
- 1-3 listings only
- Listing descriptions are informal/personal language
- Registration text says "Private" or just a date without "Company"

**Ambiguous Cases** (moderate confidence):
- 3-5 listings could be either a small agency or an active private seller
- Generic names without clear corporate identifiers

## Output Format
Return a JSON object:
{
  "isAgency": true/false,
  "confidenceScore": 0-100,
  "reasoning": "Brief 1-2 sentence explanation"
}

Rules:
- confidenceScore >= 70 means you are fairly certain
- confidenceScore 40-69 means ambiguous, lean one way
- confidenceScore < 40 means very uncertain
- If almost no data is provided, return confidenceScore: 30 with isAgency: false (default to private)`;

/**
 * AI-based prospect classification that determines if a prospect is an agency or private individual.
 * Uses multi-signal analysis via Gemini Flash for cost efficiency.
 */
export async function classifyProspect(input: ClassificationInput): Promise<ClassificationResult> {
    const model = getModelForTask('prospect_classification');

    const signals: string[] = [];
    if (input.name) signals.push(`Name: "${input.name}"`);
    if (input.description) signals.push(`Description: "${input.description.substring(0, 500)}"`);
    if (input.listingCount !== null && input.listingCount !== undefined) signals.push(`Active listings on platform: ${input.listingCount}`);
    if (input.platformRegistered) signals.push(`Registration info: "${input.platformRegistered}"`);
    if (input.profileUrl) signals.push(`Has profile page: ${input.profileUrl}`);
    if (input.contactChannels && input.contactChannels.length > 0) signals.push(`Contact channels: ${input.contactChannels.join(', ')}`);
    if (input.sampleListingTitles && input.sampleListingTitles.length > 0) {
        signals.push(`Sample listing titles:\n${input.sampleListingTitles.slice(0, 5).map(t => `  - "${t}"`).join('\n')}`);
    }

    if (signals.length === 0) {
        return { isAgency: false, confidenceScore: 20, reasoning: 'No data available for classification.' };
    }

    const userContent = `Classify this seller:\n\n${signals.join('\n')}`;

    try {
        const aiResult = await callLLMWithMetadata(model, CLASSIFICATION_PROMPT, userContent, {
            jsonMode: true,
            temperature: 0.1,
        });

        if (aiResult.text) {
            const parsed = JSON.parse(aiResult.text);
            return {
                isAgency: parsed.isAgency === true,
                confidenceScore: Math.min(100, Math.max(0, parseInt(parsed.confidenceScore) || 50)),
                reasoning: parsed.reasoning || '',
            };
        }
    } catch (e: any) {
        console.warn(`[ProspectClassifier] AI classification failed: ${e.message}`);
    }

    // Fallback: default to private with low confidence
    return { isAgency: false, confidenceScore: 20, reasoning: 'Classification failed, defaulting to private.' };
}

/**
 * Classify and update a ProspectLead record in the database.
 * Respects manual overrides — skips AI if isAgencyManual is set.
 * Logs usage to AgentExecution for the enterprise AI ledger.
 */
export async function classifyAndUpdateProspect(
    prospectId: string,
    locationId: string,
    input: ClassificationInput,
): Promise<ClassificationResult> {
    // Check if there's a manual override — if so, skip AI entirely
    const prospect = await db.prospectLead.findUnique({
        where: { id: prospectId },
        select: { isAgencyManual: true },
    });

    if (prospect?.isAgencyManual !== null && prospect?.isAgencyManual !== undefined) {
        return {
            isAgency: prospect.isAgencyManual,
            confidenceScore: 100,
            reasoning: 'Manual override by user.',
        };
    }

    const model = getModelForTask('prospect_classification');
    const result = await classifyProspect(input);

    // Only auto-set isAgency if confidence is >= 70
    const shouldAutoSet = result.confidenceScore >= 70;

    await db.prospectLead.update({
        where: { id: prospectId },
        data: {
            isAgency: shouldAutoSet ? result.isAgency : false,
            agencyConfidence: result.confidenceScore,
            agencyReasoning: result.reasoning,
        },
    });

    // Log to enterprise AI usage ledger
    try {
        await db.agentExecution.create({
            data: {
                locationId,
                sourceType: 'scraper',
                sourceId: prospectId,
                taskTitle: 'Prospect Agency Classification',
                taskStatus: 'done',
                status: 'success',
                skillName: 'prospect_classifier',
                intent: 'classification',
                model,
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
                cost: 0,
            },
        });
    } catch (e) {
        // Non-critical — don't fail the classification
    }

    return result;
}
