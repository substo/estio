
import db from "@/lib/db";
import { hybridPropertySearch } from "@/lib/ai/search/hybrid-search";
import { findSimilarProperties } from "@/lib/ai/search/recommendations";
import { updatePropertyEmbedding } from "@/lib/ai/search/property-embeddings";

async function main() {
    console.log("🔍 Verifying Searcher-Recommender System...");

    // 0. Resolve API Key and set to ENV for downstream tools
    if (!process.env.GOOGLE_API_KEY) {
        const siteConfig = await db.siteConfig.findFirst({
            where: { googleAiApiKey: { not: null } }
        });
        if (siteConfig?.googleAiApiKey) {
            process.env.GOOGLE_API_KEY = siteConfig.googleAiApiKey;
            console.log("✅ Loaded API Key from SiteConfig into process.env");
        } else {
            console.warn("⚠️ No API Key found. Search will likely fail.");
        }
    }

    // 1. Check for Active Properties
    const property = await db.property.findFirst({
        where: { status: "ACTIVE" }
    });

    if (!property) {
        console.log("⚠️ No active properties found. Cannot verify search.");
        return;
    }

    console.log(`\n📋 Using Reference Property: ${property.title} (${property.id})`);

    // 2. Ensure Embedding Exists (Trigger update)
    console.log("🔄 Updating embedding for reference property...");
    await updatePropertyEmbedding(property.id);
    console.log("✅ Embedding updated.");

    // 3. Test Hybrid Search (Semantic)
    const query = "modern property with nice view";
    console.log(`\n🔎 Testing Hybrid Search with query: "${query}"`);

    const searchResults = await hybridPropertySearch({
        locationId: property.locationId,
        naturalLanguageQuery: query,
        limit: 3
    });

    console.log(`Found ${searchResults.length} results:`);
    searchResults.forEach((r, i) => {
        console.log(`   ${i + 1}. ${r.property.title} (Score: ${r.score.toFixed(4)})`);
        console.log(`      Reasons: ${r.matchReasons.join(", ")}`);
        if (r.semanticSimilarity) console.log(`      Similarity: ${r.semanticSimilarity.toFixed(4)}`);
    });

    // 4. Test Similar Properties
    console.log(`\n👯 Testing "Similar Properties" for: ${property.title}`);
    const similar = await findSimilarProperties(property.id, 3);

    console.log(`Found ${similar.length} similar properties:`);
    similar.forEach((r, i) => {
        console.log(`   ${i + 1}. ${r.property.title} (Similarity: ${r.similarity.toFixed(4)})`);
    });

    console.log("\n✅ Verification Complete!");
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await db.$disconnect();
    });
