# Intelligent Phone Normalization

## Overview
Due to varied international client formats, the `Paste Lead` feature previously captured phone numbers in inconsistent states (e.g., local numbers missing country dialing codes, or international numbers starting with a `00` prefix instead of the WhatsApp-mandated `+`). This variability caused routing issues and broke WhatsApp message delivery since Evolution/WhatsApp require strictly formatted E.164 numbers.

To natively resolve this, we implemented an intelligent pipeline combining LLM context extraction and Google's industry-standard `libphonenumber-js` parsing library.

## Architecture

The normalization pipeline involves three layers:

### 1. LLM Context Extraction (`LeadParsingSchema`)
The initial generic `phone` parsing step in `app/(main)/admin/conversations/actions.ts` (`parseLeadFromText`) now provides explicit instructions to predict the country context context:
- The structure prompts the LLM to output an ISO 3166-1 alpha-2 `countryCode` (e.g., `IL`, `CY`, `DE`) deduced by examining language, location hints, or textual context in the pasted lead message.
- If it's impossible to deduce, the LLM safely sets this to `null`.

### 2. Standardization Utility (`lib/utils/phone.ts`)
The `normalizeInternationalPhone(phoneRaw, inferredCountry)` handler takes the parsed lead and executes fixed rules:
- **`00` translation:** Many users input `00` as the International Direct Dialing code. The utility inherently converts leading `00` characters into a `+` to universally bind to E.164 constraints.
- **Context injection:** The function injects the LLM's `inferredCountry` into `parsePhoneNumberFromString()`. If `null`, it falls back to the system default country (`CY`).

### 3. Rigorous Validation (`createParsedLead`)
Before a parsed lead searches the database or generates a new `Contact` entry, its phone property pushes through the standardizer.
- If the normalized E.164 parsing succeeds against `libphonenumber-js` rules (meaning it conforms to actual global carrier constraints), the cleaned number is written to state.
- If validation completely fails (for example, typing a local number `525499` without adequate country clues), the pipeline defaults back safely to a `null` output mapping or keeps the original strings to avoid corrupting records.

## Reusability
The core `lib/utils/phone.ts` function is strictly decoupled from the Paste Lead implementation, enabling identical offline validation across manual contact creation, Google Contact webhooks, or API imports in the future.
