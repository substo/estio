import { NextResponse } from "next/server";
import { upsertProperty } from "@/app/(main)/admin/properties/actions";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    try {
        const formData = await request.formData();
        const result = await upsertProperty(formData, { redirectOnCreate: false });
        const status = result?.success === false ? 400 : 200;
        return NextResponse.json(result, { status });
    } catch (error: any) {
        console.error("[Property Upsert API] Error:", error);
        return NextResponse.json(
            { success: false, error: error?.message || "Failed to save property" },
            { status: 500 }
        );
    }
}
