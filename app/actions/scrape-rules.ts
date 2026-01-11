"use server";

import db from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

export async function saveScrapeRule(
    domain: string,
    pattern: string,
    instructions: string,
    interactionSelector?: string
) {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "Unauthorized" };

    try {
        if (!domain || !pattern || !instructions) {
            throw new Error("Missing required fields (domain, pattern, instructions)");
        }

        await (db as any).scrapeRule.create({
            data: {
                domain,
                pattern,
                instructions,
                interactionSelector
            }
        });

        return { success: true };
    } catch (error: any) {
        console.error("Failed to save scrape rule:", error);
        return { success: false, error: error.message };
    }
}
