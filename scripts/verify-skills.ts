
import { SkillLoader } from '../lib/ai/skills/loader';
import { loadSkillTool } from '../lib/ai/skills/tools';

async function main() {
    console.log("--- 1. Testing Registry Scan ---");
    const registry = SkillLoader.getRegistry();
    console.log("Registry:", JSON.stringify(registry, null, 2));

    if (registry.length === 0) {
        console.error("FAILED: No skills found in registry.");
        process.exit(1);
    }
    console.log("✅ Registry Scan Passed\n");

    console.log("--- 2. Testing Skill Load (lead_qualification) ---");
    const skillName = "lead_qualification";
    const skill = SkillLoader.loadSkill(skillName);

    if (!skill) {
        console.error(`FAILED: Could not load skill ${skillName}`);
        process.exit(1);
    }

    if (!skill.instructions.includes("Update Database")) {
        console.error("FAILED: Instructions do not contain expected content.");
        process.exit(1);
    }
    console.log("✅ Skill Load Passed");
    console.log("Instructions Preview:", skill.instructions.substring(0, 50) + "...\n");

    console.log("--- 3. Testing Tool Helper (loadSkillTool) ---");
    const toolRes = await loadSkillTool(skillName);
    if (!toolRes.success || toolRes.skillName !== skillName) {
        console.error("FAILED: Tool helper returned error or wrong name.");
        process.exit(1);
    }
    console.log("✅ Tool Helper Passed");

    console.log("\n🎉 ALL TESTS PASSED");
}

main().catch(console.error);
