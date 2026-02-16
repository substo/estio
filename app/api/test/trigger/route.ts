import { NextResponse } from "next/server";
import { orchestrate } from "@/lib/ai/orchestrator";
import db from "@/lib/db";

export async function POST(req: Request) {
    try {
        const { conversationId, message } = await req.json();

        if (!conversationId || !message) {
            return NextResponse.json({ error: "Missing conversationId or message" }, { status: 400 });
        }

        const conversation = await db.conversation.findUnique({
            where: { id: conversationId },
            include: { contact: true }
        });

        if (!conversation) {
            return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
        }

        // Fetch conversation history for context
        const messages = await db.message.findMany({
            where: { conversationId },
            orderBy: { createdAt: "desc" },
            take: 10,
        });

        // Format history: "User: msg\nAgent: msg"
        // Note: older messages are at the end because of desc sort
        const conversationHistory = messages.reverse().map(m => {
            const role = m.direction === "outbound" ? "Agent" : "User";
            return `${role}: ${m.body || "[Media]"}`;
        }).join("\n");

        // Add current message to history? 
        // Usually orchestrator is called after message is saved.
        // For testing, we might want to simulate without saving, OR safe to save.
        // Let's NOT save the message to DB to keep it pure test, 
        // BUT the orchestrator might expect the message to be part of history if it re-fetches.
        // The orchestrator input has `conversationHistory` passed explicitly.

        // Note: The logic in `orchestrate` uses the passed history string.

        const result = await orchestrate({
            conversationId,
            contactId: conversation.contactId,
            message,
            conversationHistory: conversationHistory ? `${conversationHistory}\nUser: ${message}` : `User: ${message}`,
            dealStage: undefined
        });

        return NextResponse.json({
            success: true,
            result
        });

    } catch (error: any) {
        console.error("Trigger error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
