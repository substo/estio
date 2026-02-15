
import { SkillLoader } from "../lib/ai/skills/loader";
import { calculateMortgage } from "../lib/ai/tools/negotiation";

async function verify() {
    console.log("🔍 Verifying Phase 5 Implementation...\n");

    // 1. Verify Skill Loading
    console.log("Checking Skills...");
    const registry = SkillLoader.getRegistry();

    const negotiator = registry.find(s => s.name === "negotiator");
    const closer = registry.find(s => s.name === "closer");

    if (negotiator) console.log("✅ Negotiator skill found");
    else console.error("❌ Negotiator skill MISSING");

    if (closer) console.log("✅ Closer skill found");
    else console.error("❌ Closer skill MISSING");

    // 2. Verify Deep Loading
    if (negotiator) {
        const loaded = SkillLoader.loadSkill("negotiator");
        if (loaded && loaded.tools && loaded.tools.includes("create_offer")) {
            console.log("✅ Negotiator loaded with tools");
        } else {
            console.error("❌ Negotiator failed to load or missing tools");
        }
    }

    // 3. Verify Tool Logic (Mortgage Calc - pure function)
    console.log("\nChecking Tools...");
    const mortgage = await calculateMortgage({
        propertyPrice: 300000,
        downPaymentPercent: 20, // 60k down, 240k principal
        interestRate: 3.5,
        termYears: 30
    });

    console.log(`Mortgage Calc (300k, 20%, 3.5%, 30y):`);
    console.log(`- Monthly: €${mortgage.monthlyPayment}`);
    console.log(`- Total Cost: €${mortgage.totalCost}`);

    // Expected: ~1078
    if (Math.abs(mortgage.monthlyPayment - 1078) < 5) {
        console.log("✅ Mortgage calculation is correct");
    } else {
        console.error(`❌ Mortgage calculation mismatch. Expected ~1078, got ${mortgage.monthlyPayment}`);
    }

    console.log("\nVerification Complete.");
}

verify().catch(console.error);
