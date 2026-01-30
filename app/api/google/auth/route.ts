
import { NextRequest, NextResponse } from 'next/server';
import { getGoogleAuthUrl } from '@/lib/google/auth';
import { auth } from '@clerk/nextjs/server';

export async function GET(req: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return new NextResponse('Unauthorized', { status: 401 });
        }

        const url = getGoogleAuthUrl(req.nextUrl.origin);

        return NextResponse.redirect(url);
    } catch (error) {
        console.error('Google Auth Error:', error);
        return new NextResponse('Internal Error', { status: 500 });
    }
}
