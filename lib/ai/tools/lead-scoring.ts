
import db from "@/lib/db";
import { storeInsight } from "@/lib/ai/memory";

export async function updateLeadScore(
    contactId: string,
    score: number,
    reason: string
): Promise<{ success: boolean; previousScore: number; newScore: number }> {
    const contact = await db.contact.findUnique({ where: { id: contactId } });
    const previousScore = contact?.leadScore ?? 0;

    await db.contact.update({
        where: { id: contactId },
        data: {
            leadScore: score,
            // Also update qualification stage based on score
            qualificationStage:
                score >= 80 ? "highly_qualified" :
                    score >= 60 ? "qualified" :
                        score >= 30 ? "basic" :
                            "unqualified",
        },
    });

    // Log the scoring event
    await storeInsight({
        contactId,
        text: `Lead score updated: ${previousScore} → ${score}. Reason: ${reason}`,
        category: "timeline", // "timeline" is a valid category in InsightInput, though "other" or "meta" might be better if allowed. Using "timeline" as it relates to process progress or maybe we should expand categories.
        // Actually, design doc says: category: "timeline". We should stick to allowed categories in memory.ts: "preference" | "objection" | "timeline" | "motivation" | "relationship"
        // "timeline" seems most appropriate for stage progression.
        importance: 7,
        source: "agent_extracted",
    });

    return { success: true, previousScore, newScore: score };
}
