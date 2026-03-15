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
                // Bypass Playwright's visibility checks entirely by using DOM evaluation
                await page.evaluate((sel) => {
                    const el = document.querySelector(sel) as HTMLInputElement;
                    if (el) {
                        el.checked = true;
                        // Dispatch an event just in case angular/react is listening
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }, consentSelector);
                
                // Whatsapp button
                const whatsappBtnSelector = 'button.sign-in__button._whatsapp';
                await page.waitForSelector(whatsappBtnSelector, { timeout: 5000 });
                await page.click(whatsappBtnSelector, { force: true });

                sendEvent({ status: 'waiting_qr', message: 'Waiting for Bazaraki to generate QR Code...' });

                // Wait for the URL to change to the whatsapp login page
                await page.waitForURL('**/login/whatsapp/**', { timeout: 15000 });

                // The QR code might not have the alt="Scan me!" attribute. 
                // Let's look for any base64 image or a specific class. Usually it's an img with a base64 src inside the main container.
                // We'll wait for any image that looks like a data URI or resides in the typical QR container.
                const qrImageSelector = 'img[src^="data:image"]';
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
                // We wait up to 90 seconds. To avoid catching the /login/whatsapp/ redirect, we ensure it doesn't match login.
                await page.waitForURL((url) => {
                    const href = url.href.toLowerCase();
                    return href.includes('/profile/') && !href.includes('/login/');
                }, { timeout: 90000 });

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
                if (browser) {
                    try {
                        // Attempt to grab the HTML payload to see what went wrong
                        const pages = browser.contexts()[0]?.pages() || [];
                        if (pages.length > 0) {
                            const html = await pages[0].content();
                            console.error(`[Bazaraki Auth Error] DOM Dump:`, html.substring(0, 3000));
                        }
                    } catch (e) {}
                }
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
