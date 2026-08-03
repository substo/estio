import { NextResponse } from "next/server";

export async function POST() {
    return NextResponse.json({
        success: false,
        error: "This legacy server-login check has been removed. Use the ChatGPT subscription (Codex) device sign-in page.",
    }, { status: 410 });
}
