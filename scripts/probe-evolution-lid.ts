/**
 * Diagnostic: Probe Evolution API for LID resolution data
 * Usage: npx tsx scripts/probe-evolution-lid.ts
 */
import axios from 'axios';

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
const EVOLUTION_GLOBAL_API_KEY = process.env.EVOLUTION_GLOBAL_API_KEY!;
const INSTANCE = 'cmingx6b10008rdycg7hwesyn';
const TEST_LID = '155731873509555@lid';
const headers = { apikey: EVOLUTION_GLOBAL_API_KEY };

async function tryEndpoint(name: string, fn: () => Promise<any>) {
    try {
        const result = await fn();
        const data = result.data;
        const preview = JSON.stringify(data, null, 2).slice(0, 2000);
        console.log(`\n=== ${name} ===`);
        console.log(`Status: ${result.status}`);
        console.log(`Data (preview): ${preview}`);
        return data;
    } catch (e: any) {
        console.log(`\n=== ${name} === FAILED: ${e.response?.status || e.message}`);
        if (e.response?.data) console.log(`  Detail: ${JSON.stringify(e.response.data).slice(0, 200)}`);
        return null;
    }
}

async function main() {
    console.log(`Using: ${EVOLUTION_API_URL}, Instance: ${INSTANCE}\n`);

    // 1. findContacts with LID filter
    await tryEndpoint('POST /chat/findContacts (filter by LID)', () =>
        axios.post(`${EVOLUTION_API_URL}/chat/findContacts/${INSTANCE}`,
            { where: { remoteJid: TEST_LID } }, { headers })
    );

    // 2. findContacts - all non-group
    await tryEndpoint('POST /chat/findContacts (non-group filter)', () =>
        axios.post(`${EVOLUTION_API_URL}/chat/findContacts/${INSTANCE}`,
            { where: { remoteJid: { contains: '@s.whatsapp.net' } } }, { headers })
    );

    // 3. Try /contact/find endpoint (might exist in some Evolution versions)
    await tryEndpoint('POST /contact/find', () =>
        axios.post(`${EVOLUTION_API_URL}/contact/find/${INSTANCE}`, {}, { headers })
    );

    // 4. findChats with LID filter  
    await tryEndpoint('POST /chat/findChats (filter by LID)', () =>
        axios.post(`${EVOLUTION_API_URL}/chat/findChats/${INSTANCE}`,
            { where: { remoteJid: TEST_LID } }, { headers })
    );

    // 5. findMessages for the LID chat (check if messages have phone info)
    await tryEndpoint('POST /chat/findMessages (LID chat, limit 3)', () =>
        axios.post(`${EVOLUTION_API_URL}/chat/findMessages/${INSTANCE}`,
            { where: { key: { remoteJid: TEST_LID } }, limit: 3 }, { headers })
    );

    // 6. Try fetching a specific contact by remoteJid
    await tryEndpoint('POST /chat/findContacts (specific LID)', () =>
        axios.post(`${EVOLUTION_API_URL}/chat/findContacts/${INSTANCE}`,
            { where: { remoteJid: { equals: TEST_LID } } }, { headers })
    );

    // 7. Try sendMessage response (just log what send returns — dry run)
    // We use a dummy to see response structure
    console.log('\n=== sendMessage response structure ===');
    console.log('(Skipped - would send real message. Check response.data from sendMessage in production.)');
}

main().catch(console.error);
