import { NextResponse } from "next/server";

import { getRuntimeBuildId } from "@/lib/runtime/build-id";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
    const buildId = await getRuntimeBuildId();

    return NextResponse.json(
        {
            buildId,
            checkedAt: new Date().toISOString(),
        },
        {
            headers: {
                "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
                Pragma: "no-cache",
                Expires: "0",
            },
        }
    );
}
