import { parsePhoneNumberFromString, CountryCode } from 'libphonenumber-js';

// Define the fallback country if one is not provided.
const FALLBACK_COUNTRY_CODE: CountryCode = 'CY';

/**
 * Normalizes an international phone number (fixing 00 prefixes) and formats to E.164.
 * Optionally uses an inferred country code or a global fallback to predict local numbers.
 * 
 * @param phoneRaw The raw phone number string from input
 * @param inferredCountry ISO 3166-1 alpha-2 country code (e.g., 'IL', 'CY', 'DE')
 * @returns { original: string, formatted: string | null, isValid: boolean, country: string | null }
 */
export function normalizeInternationalPhone(
    phoneRaw: string | null | undefined,
    inferredCountry?: string | null
): { original: string; formatted: string | null; isValid: boolean; country: string | null } {
    const original = String(phoneRaw || '').trim();
    if (!original) {
        return { original, formatted: null, isValid: false, country: null };
    }

    // 1. Manually replace "00" with "+" to align with generic E.164 parsing.
    // e.g. "00972525499968" -> "+972525499968"
    let processingStr = original;
    if (processingStr.startsWith('00')) {
        processingStr = '+' + processingStr.slice(2);
    }

    // 2. Parse using libphonenumber-js
    const countryContext = (inferredCountry?.toUpperCase() as CountryCode) || FALLBACK_COUNTRY_CODE;
    
    try {
        const phoneNumber = parsePhoneNumberFromString(processingStr, countryContext);
        
        // Ensure parsing succeeded and validates correctly against carrier data
        if (phoneNumber && phoneNumber.isValid()) {
            return {
                original,
                formatted: phoneNumber.format('E.164'),
                isValid: true,
                country: phoneNumber.country || null
            };
        }
    } catch (e) {
        // Suppress parsing errors and fallback to invalid state
    }

    return {
        original,
        formatted: null,
        isValid: false,
        country: null
    };
}
