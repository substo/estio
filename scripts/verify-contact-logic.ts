/**
 * Verification Script for Contact Logic
 * Run this with `npx ts-node scripts/verify-contact-logic.ts`
 */

function normalizePhone(phone: string | null | undefined) {
    if (!phone) return null;
    // Allow digits, +, *, #
    let cleaned = phone.replace(/[^\d+*#]/g, '').trim();
    // Handle 00 prefix -> +
    if (cleaned.startsWith('00')) cleaned = '+' + cleaned.substring(2);
    return cleaned;
}

const testCases = [
    { input: '+357 99 123 456', expected: '+35799123456' },
    { input: '00357 99 123456', expected: '+35799123456' },
    { input: '+357 99 123 ***', expected: '+35799123***' }, // Masked
    { input: '99-123-456', expected: '99123456' },
    { input: '+357 99 123 456 #101', expected: '+35799123456#101' }, // Extension support
];

console.log('--- Testing normalizePhone ---');
let passed = 0;
testCases.forEach(({ input, expected }) => {
    const result = normalizePhone(input);
    if (result === expected) {
        console.log(`✅ [PASS] "${input}" -> "${result}"`);
        passed++;
    } else {
        console.error(`❌ [FAIL] "${input}" -> "${result}" (Expected: "${expected}")`);
    }
});

console.log(`\nResult: ${passed}/${testCases.length} Passed`);
