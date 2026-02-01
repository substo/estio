import { NextRequest, NextResponse } from 'next/server';
import { getMicrosoftAuthUrl } from '@/lib/microsoft/auth';

export async function GET(req: NextRequest) {
    const baseUrl = process.env.APP_BASE_URL
        || process.env.NEXT_PUBLIC_APP_URL
        || req.nextUrl.origin;

    const url = getMicrosoftAuthUrl(baseUrl);
    return NextResponse.redirect(url);
}
