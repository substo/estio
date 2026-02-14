
import { classifyIntent } from '../lib/ai/classifier';
import { analyzeSentiment } from '../lib/ai/sentiment';
import { validateAction } from '../lib/ai/policy';
import { orchestrate } from '../lib/ai/orchestrator';

async function runVerification() {
    console.log('--- Phase 1 Verification ---');

    if (!process.env.GOOGLE_API_KEY) {
        console.warn("⚠️  GOOGLE_API_KEY not found in env. LLM calls may fail if not in DB config.");
    }

    // 1. Test Classifier
    console.log('\nTesting Classifier...');
    try {
        const intent1 = await classifyIntent("Thanks for the info!");
        console.log(`"Thanks!" -> ${intent1.intent} (Risk: ${intent1.risk})`);

        const intent2 = await classifyIntent("I want to offer 450k");
        console.log(`"Offer 450k" -> ${intent2.intent} (Risk: ${intent2.risk})`);
    } catch (e) {
        console.error("Classifier failed:", e);
    }


    // 2. Test Sentiment
    console.log('\nTesting Sentiment...');
    try {
        const sent = await analyzeSentiment("I love this house, when can I see it?");
        console.log(`"I love this house..." -> ${sent.emotion}, Readiness: ${sent.buyerReadiness}`);
    } catch (e) {
        console.error("Sentiment failed:", e);
    }

    // 3. Test Policy
    console.log('\nTesting Policy...');
    const policyResult = await validateAction({
        intent: "PRICE_NEGOTIATION",
        risk: "high",
        actions: [],
        draftReply: "The owner's bottom price is 400k.",
        dealStage: "negotiation"
    });
    console.log(`Policy Check (Price Disclosure): ${policyResult.approved ? 'Approved' : 'Blocked'}`);
    if (!policyResult.approved) console.log(`Reason: ${policyResult.reason}`);

    // 4. Test Orchestrator (Mock DB calls would be needed for full run, but we can test basic wiring)
    // We'll skip full orchestrate() run in this script to avoid DB dependency issues in standalone script
    // unless we mock the DB or have a test DB environment. 
    // For now, we verified the components individually.

    console.log('\n--- Verification Complete ---');
}

runVerification().catch(console.error);
