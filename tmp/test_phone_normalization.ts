import { normalizeInternationalPhone } from '../lib/utils/phone';

const cases = [
    { num: '00972525499968', country: null, expected: '+972525499968' },
    { num: '525499968', country: 'IL', expected: '+972525499968' },
    { num: '525499968', country: null, expected: null }, // CY is fallback, it fails
    { num: '+35799378627', country: null, expected: '+35799378627' },
    { num: '4915112345678', country: 'DE', expected: '+4915112345678' },
    { num: '49 151 12345678', country: 'DE', expected: '+4915112345678' },
    { num: '15112345678', country: 'DE', expected: '+4915112345678' }
];

console.log("Running normalization tests...");
let allPassed = true;
for (const tc of cases) {
    const res = normalizeInternationalPhone(tc.num, tc.country);
    const passed = tc.expected === null ? !res.isValid : res.formatted === tc.expected;
    console.log(`Input: ${tc.num} [${tc.country || 'no context'}] -> ${res.formatted || 'null'} (Valid: ${res.isValid}) - ${passed ? 'PASS' : 'FAIL'}`);
    if (!passed) allPassed = false;
}

if (!allPassed) {
    console.error("Some tests failed.");
    process.exit(1);
} else {
    console.log("All tests passed.");
}
