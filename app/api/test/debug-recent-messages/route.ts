import { NextResponse } from "next/server";
import db from "@/lib/db";

export async function GET() {
    try {
        // Get messages from last 24 hours
        const oneDayAgo = new Date();
        oneDayAgo.setHours(oneDayAgo.getHours() - 24);

        const recentMessages = await db.message.findMany({
            where: { createdAt: { gt: oneDayAgo } },
            orderBy: { createdAt: 'desc' },
            take: 20,
            include: { conversation: true }
        });

        const report = recentMessages.map(m => ({
            msgId: m.id,
            msgCreated: m.createdAt,
            msgBody: m.body?.substring(0, 50),
            msgSource: m.source,
            msgType: m.type,
            convId: m.conversationId,
            convLastMsgAt: m.conversation.lastMessageAt,
            // Check if synced correctly
            timestampMismatch: m.createdAt.getTime() !== m.conversation.lastMessageAt.getTime()
        }));

        return NextResponse.json({ count: recentMessages.length, report });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
