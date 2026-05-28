import { currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { buildOldCrmManualPullFailure } from "@/lib/crm/old-crm-property-pull-service";
import { pullOldCrmPropertyForManualClient } from "@/lib/crm/manual-old-crm-property-pull";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const user = await currentUser();
        const result = await pullOldCrmPropertyForManualClient({
            oldPropertyId: String(body?.oldPropertyId || ""),
            clerkUserId: user?.id,
        });

        return NextResponse.json(result);
    } catch (error) {
        return NextResponse.json(buildOldCrmManualPullFailure(error));
    }
}
