
import { NextRequest, NextResponse } from 'next/server';
import { syncContactToGoogle } from '@/lib/google/people';
import { auth } from '@clerk/nextjs/server';
import db from '@/lib/db';

export async function POST(req: NextRequest) {
    try {
        const { userId: clerkUserId } = await auth();
        if (!clerkUserId) {
            return new NextResponse('Unauthorized', { status: 401 });
        }

        // Find internal User
        const user = await db.user.findUnique({
            where: { clerkId: clerkUserId }
        });

        if (!user) return new NextResponse('User not found', { status: 404 });

        const body = await req.json();
        const { contactId } = body;

        if (!contactId) return new NextResponse('Missing contactId', { status: 400 });

        await syncContactToGoogle(user.id, contactId);

        return NextResponse.json({ success: true });

    } catch (error) {
        console.error('Manual Sync Error:', error);
        return new NextResponse('Internal Error', { status: 500 });
    }
}
