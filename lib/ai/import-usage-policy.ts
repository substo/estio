import type { AiFundingScope, RecordAiUsageInput } from './usage-metering';
export type ImportUsage = { locationId: string; stage: string; provider: string; model: string; inputTokens?: number; outputTokens?: number; fundingScope?: AiFundingScope; executionMode?: 'interactive' | 'background' };
export function propertyImportUsage(input: ImportUsage): RecordAiUsageInput {
    if (!input.locationId) throw new Error('A Location is required for paid import usage');
    const known = [input.inputTokens, input.outputTokens].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0);
    return { locationId: input.locationId, resourceType: 'property_import', featureArea: 'property_import', action: input.stage.toLowerCase(), provider: input.provider, model: input.model,
        inputTokens: known ? input.inputTokens : 0, outputTokens: known ? input.outputTokens : 0,
        fundingScope: input.fundingScope, executionMode: input.executionMode,
        metadata: { costStatus: known ? 'estimated' : 'unavailable' } };
}
