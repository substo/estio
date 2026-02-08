import { NextResponse } from 'next/server';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const conversations = await db.conversation.findMany({
            include: {
                messages: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    select: { createdAt: true, body: true, type: true }
                }
            }
        });

        let updated = 0;
        const updates = [];

        for (const conv of conversations) {
            const realLastMsg = conv.messages[0];
            if (!realLastMsg) continue;

            const realDate = realLastMsg.createdAt;
            const storedDate = conv.lastMessageAt;

            // Check if difference is significant (> 2 seconds)
            const diff = Math.abs(realDate.getTime() - storedDate.getTime());

            // Also check if stored date is "Epoch" (1970) which we used for fallbacks
            const isEpoch = storedDate.getTime() === 0 || storedDate.getFullYear() === 1970;

            if (diff > 2000 || isEpoch) {
                updates.push({
                    id: conv.id,
                    old: storedDate,
                    new: realDate,
                    body: realLastMsg.body?.substring(0, 20)
                });

                await db.conversation.update({
                    where: { id: conv.id },
                    data: {
                        lastMessageAt: realDate,
                        lastMessageBody: realLastMsg.body || conv.lastMessageBody,
                        lastMessageType: realLastMsg.type || conv.lastMessageType
                    }
                });
                updated++;
            }
        }

        return NextResponse.json({
            success: true,
            totalScanned: conversations.length,
            updatedCount: updated,
            updates: updates
        });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
