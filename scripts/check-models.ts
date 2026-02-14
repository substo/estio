
import db from "@/lib/db";

async function main() {
    console.log("🔍 Checking available models for configured API Key...");

    // 1. Resolve API Key
    let apiKey = process.env.GOOGLE_API_KEY;
    let source = "env";

    if (!apiKey) {
        const siteConfig = await db.siteConfig.findFirst({
            where: { googleAiApiKey: { not: null } }
        });
        if (siteConfig?.googleAiApiKey) {
            apiKey = siteConfig.googleAiApiKey.trim();
            source = `SiteConfig (Location: ${siteConfig.locationId})`;
        } else {
            console.error("❌ No API Key found.");
            process.exit(1);
        }
    }

    console.log(`✅ Using API Key from ${source}`);
    console.log(`🔑 Key Prefix: ${apiKey.substring(0, 8)}...`);

    // 2. Fetch Models
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    try {
        const response = await fetch(url);

        if (!response.ok) {
            console.error(`❌ API Request Failed: ${response.status} ${response.statusText}`);
            const text = await response.text();
            console.error("Response Body:", text);
            return;
        }

        const data = await response.json();

        if (!data.models) {
            console.error("❌ No 'models' property in response.", data);
            return;
        }

        console.log(`\n📋 Found ${data.models.length} models available to this key:`);

        // Filter for embedding models
        const embeddingModels = data.models.filter((m: any) =>
            m.name.includes("embedding") || m.supportedGenerationMethods?.includes("embedContent")
        );

        if (embeddingModels.length > 0) {
            console.log("\n✅ AVAILABLE EMBEDDING MODELS:");
            embeddingModels.forEach((m: any) => {
                console.log(`- ${m.name}`);
                console.log(`  Methods: ${m.supportedGenerationMethods?.join(", ")}`);
            });
        } else {
            console.warn("\n⚠️ NO EMBEDDING MODELS FOUND.");
        }

        console.log("\nℹ️ Other Models (Partial List):");
        data.models.slice(0, 5).forEach((m: any) => {
            if (!embeddingModels.includes(m)) {
                console.log(`- ${m.name} [${m.supportedGenerationMethods?.join(", ")}]`);
            }
        });

    } catch (error: any) {
        console.error("❌ Fetch Error:", error.message);
    }
}

main();
