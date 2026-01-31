
import { NextResponse } from "next/server";
import db from "@/lib/db";

export async function GET() {
    try {
        const email = "martindowntowncyprus@gmail.com";
        const state = await db.gmailSyncState.findUnique({
            where: { emailAddress: email },
            include: { user: true }
        });

        // Also check if any messages exist for this email
        const messageCount = await db.message.count({
            where: {
                OR: [
                    { emailFrom: { contains: email } },
                    { emailTo: { contains: email } }
                ]
            }
        });

        return NextResponse.json({
            found: !!state,
            state: state,
            messageCount
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
