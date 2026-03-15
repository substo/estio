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

    const { phone, credentialId } = await req.json();

    if (!phone || !credentialId) {
        return new NextResponse('Missing phone or credentialId', { status: 400 });
    }

    const encoder = new TextEncoder();
    
    const stream = new ReadableStream({
        async start(controller) {
            const sendEvent = (data: any) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            };

            console.log(`[Bazaraki Auth Stream] Starting remote auth for ${phone}`);
            sendEvent({ status: 'initializing', message: 'Launching headless browser...' });
            
            let browser;
            try {
                browser = await chromium.launch({ headless: true });
                const context = await browser.newContext({
                    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                });
                const page = await context.newPage();

                sendEvent({ status: 'navigating', message: 'Connecting to Bazaraki...' });
                await page.goto('https://www.bazaraki.com/profile/login/', { waitUntil: 'domcontentloaded' });
                
                // Wait for input and type
                sendEvent({ status: 'inputting', message: 'Entering phone number and consent...' });
                
                // Using the specific selector provided by the user
                const phoneInputSelector = '#main > div.wrap > div > form > div > div.sign-in__form.ng-scope > div.sign-in__form-col._phone > input';
                await page.waitForSelector(phoneInputSelector, { timeout: 10000 });
                await page.fill(phoneInputSelector, phone);
                
                // consent checkbox
                const consentSelector = '#confirm';
                // The actual input checkbox is visually hidden by CSS (custom label styling)
                await page.waitForSelector(consentSelector, { state: 'attached', timeout: 5000 });
                // Playwright click might be intercepted if it's visually hidden or covered by a label, so force or use evaluate
                await page.setChecked(consentSelector, true, { force: true });
                
                // Whatsapp button
                const whatsappBtnSelector = 'button.sign-in__button._whatsapp';
                await page.waitForSelector(whatsappBtnSelector, { timeout: 5000 });
                await page.click(whatsappBtnSelector, { force: true });

                sendEvent({ status: 'waiting_qr', message: 'Waiting for Bazaraki to generate QR Code...' });

                // Wait for the QR code image to appear
                const qrImageSelector = 'img[alt="Scan me!"]';
                await page.waitForSelector(qrImageSelector, { timeout: 15000 });
                
                // Wait a moment for the base64 src to be fully populated (just in case)
                await page.waitForTimeout(500); 
                
                const qrCodeSrc = await page.getAttribute(qrImageSelector, 'src');
                
                if (!qrCodeSrc) {
                    throw new Error('QR Code image found but src attribute was missing.');
                }

                sendEvent({ status: 'qr_ready', qrCode: qrCodeSrc, message: 'Please scan the QR code with your phone camera and tap Send in WhatsApp.' });
                console.log(`[Bazaraki Auth Stream] Emitted QR code. Waiting for user WhatsApp verification...`);

                // Wait for user to verify on their phone.
                // When verified, Bazaraki usually redirects to /profile/ or /my/ 
                // We wait up to 90 seconds for this navigation
                await page.waitForURL('**/profile/**', { timeout: 90000 });

                console.log(`[Bazaraki Auth Stream] Successfully navigated to profile page!`);
                sendEvent({ status: 'saving', message: 'Login detected! Saving session cookies...' });

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

                sendEvent({ status: 'success', message: 'Successfully authenticated!' });
            } catch (error: any) {
                console.error(`[Bazaraki Auth Error]`, error);
                sendEvent({ status: 'error', error: error.message || 'Unknown automation error' });
            } finally {
                if (browser) {
                    await browser.close();
                }
                controller.close();
            }
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}
