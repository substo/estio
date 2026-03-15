import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { chromium, type BrowserContext } from 'playwright';
import db from '@/lib/db';

export const maxDuration = 120; // Allow Vercel to run up to 2 mins for WhatsApp approval
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const { userId } = await auth();
    if (!userId) return new NextResponse('Unauthorized', { status: 401 });

    const user = await db.user.findUnique({
        where: { clerkId: userId },
    });
    if (!user) {
        return new NextResponse('Unauthorized - User not found', { status: 401 });
    }

    try {
        const { phone, credentialId } = await req.json();

        if (!phone || !credentialId) {
            return new NextResponse('Missing phone or credentialId', { status: 400 });
        }

        console.log(`[Bazaraki Auth] Starting remote auth for ${phone}`);
        
        // Launch headless browser
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        });
        const page = await context.newPage();

        try {
            await page.goto('https://www.bazaraki.com/profile/login/', { waitUntil: 'domcontentloaded' });
            
            // Wait for input and type
            await page.waitForSelector('input[name="phone"]', { timeout: 10000 });
            await page.fill('input[name="phone"]', phone);
            
            // Wait a sec before clicking continue
            await page.waitForTimeout(1000);
            
            // Assuming the continue button is a standard submit or specific class (might need adjustment)
            const submitBtn = await page.getByRole('button', { name: /continue|login|sign in/i });
            if (await submitBtn.isVisible()) {
                await submitBtn.click();
            } else {
                 await page.keyboard.press('Enter');
            }

            console.log(`[Bazaraki Auth] Submitted phone. Waiting for WhatsApp verification...`);

            // Wait for user to verify on their phone.
            // When verified, Bazaraki usually redirects to /profile/ or /my/ 
            // We wait up to 90 seconds for this navigation
            await page.waitForURL('**/profile/**', { timeout: 90000 });

            console.log(`[Bazaraki Auth] Successfully navigated to profile page!`);

            // Extract session state
            const sessionState = await context.storageState();

            // Save to DB
            await db.scrapingCredential.update({
                where: { id: credentialId },
                data: {
                    sessionState: sessionState as any, // Prisma Json compatibility
                    status: 'active',
                }
            });

            await browser.close();
            return NextResponse.json({ success: true, message: 'Authenticated successfully' });

        } catch (automationError) {
            // If we timeout or fail, capture the HTML so we can debug the selectors
            const html = await page.content();
            console.error(`[Bazaraki Auth Error] HTML Dump:`, html.substring(0, 5000)); // Log first 5k chars to Vercel
            
            await browser.close();
            throw automationError;
        }

    } catch (e: any) {
        console.error('[Bazaraki Auth Route Error]', e);
        return NextResponse.json({ success: false, error: e.message || 'Unknown automation error' }, { status: 500 });
    }
}
