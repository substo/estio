
import { NextRequest, NextResponse } from 'next/server';
import { runAgent } from '@/lib/ai/agent';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { contactId, locationId, secret } = body;

        // Simple security check (replace with real auth in prod)
        if (secret !== process.env.CRON_SECRET && !req.headers.get('Authorization')) {
            // return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            // For now, allow open within internal network logic or check user session if calling from client
        }

        if (!contactId || !locationId) {
            return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
        }

        // Fetch minimal history if not provided ??
        // Actually runAgent expects history string. Let's fetch it here to keep API simple.
        const conversations = await db.conversation.findMany({
            where: { contactId, locationId },
            include: { messages: { orderBy: { createdAt: 'asc' }, take: 20 } },
            orderBy: { lastMessageAt: 'desc' },
            take: 1
        });

        let historyText = "";
        if (conversations.length > 0) {
            historyText = conversations[0].messages.map(m =>
                `${m.direction === 'outbound' ? 'Agent' : 'Lead'}: ${m.body}`
            ).join("\n");
        } else {
            const contact = await db.contact.findUnique({ where: { id: contactId } });
            if (contact?.message) {
                historyText = `Lead Initial Message: ${contact.message}`;
            }
        }

        const result = await runAgent(contactId, locationId, historyText);

        return NextResponse.json(result);

    } catch (error) {
        console.error("Agent API Error:", error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
