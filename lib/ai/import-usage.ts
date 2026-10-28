import { securelyRecordAiUsage } from './usage-metering';
import { propertyImportUsage, type ImportUsage } from './import-usage-policy';
/** Records returned usage before parsing business JSON, including billed unusable results. */
export async function recordPropertyImportUsage(input: ImportUsage) {
    await securelyRecordAiUsage(propertyImportUsage(input));
}
