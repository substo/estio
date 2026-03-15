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
                
                // consent checkbox - Bazaraki uses AngularJS with ng-model="data.confirm"
                // The native checkbox is hidden by CSS. We need to trigger Angular's click handler.
                const consentSelector = '#confirm';
                await page.waitForSelector(consentSelector, { state: 'attached', timeout: 5000 });
                
                // Click the label for the checkbox instead - this is the visible element that 
                // AngularJS actually listens to. If not, we fall back to triggering Angular's scope manually.
                const consentLabelSelector = 'label[for="confirm"]';
                const hasLabel = await page.$(consentLabelSelector);
                if (hasLabel) {
                    await page.click(consentLabelSelector, { force: true });
                } else {
                    // Fallback: trigger AngularJS scope directly
                    await page.evaluate(() => {
                        const el = document.querySelector('#confirm') as any;
                        if (el) {
                            const scope = (window as any).angular?.element(el).scope();
                            if (scope) {
                                scope.$apply(() => { scope.data.confirm = 1; });
                            } else {
                                // Last resort: click + dispatch
                                el.click();
                            }
                        }
                    });
                }
                
                // Small delay to let Angular digest
                await page.waitForTimeout(300);
                
                // Whatsapp button
                const whatsappBtnSelector = 'button.sign-in__button._whatsapp';
                await page.waitForSelector(whatsappBtnSelector, { timeout: 5000 });
                
                // Log button state before clicking
                const btnDisabled = await page.getAttribute(whatsappBtnSelector, 'disabled');
                console.log(`[Bazaraki Auth] WhatsApp button disabled state: ${btnDisabled}`);
                sendEvent({ status: 'clicking_whatsapp', message: `Clicking WhatsApp button (disabled=${btnDisabled})...` });
                
                await page.click(whatsappBtnSelector, { force: true });

                sendEvent({ status: 'waiting_qr', message: 'Clicked WhatsApp. Waiting for redirect or QR Code...' });

                // Wait for any navigation or new content after clicking WhatsApp
                // The URL should change to /login/whatsapp/?phone_number=...
                // Or the page might show an error or stay the same
                try {
                    await page.waitForURL('**/login/whatsapp/**', { timeout: 15000 });
                } catch (navError: any) {
                    // If the URL didn't change, capture current state for debugging
                    const currentUrl = page.url();
                    const bodyHtml = await page.evaluate(() => document.body?.innerHTML?.substring(0, 2000) || 'empty');
                    sendEvent({ 
                        status: 'error', 
                        error: `WhatsApp redirect didn't happen. Current URL: ${currentUrl}`,
                        debugHtml: bodyHtml
                    });
                    throw new Error(`WhatsApp redirect failed. URL stayed at: ${currentUrl}`);
                }

                sendEvent({ status: 'waiting_qr', message: 'On WhatsApp page, looking for QR code...' });

                // Look for QR code image - try multiple selectors
                const qrSelectors = [
                    'img[src^="data:image"]',
                    'img[alt="Scan me!"]', 
                    '.qr-code img',
                    'canvas',
                ];
                
                let qrCodeSrc: string | null = null;
                
                for (const sel of qrSelectors) {
                    try {
                        await page.waitForSelector(sel, { timeout: 10000 });
                        if (sel === 'canvas') {
                            // Extract canvas as data URL
                            qrCodeSrc = await page.evaluate((s) => {
                                const canvas = document.querySelector(s) as HTMLCanvasElement;
                                return canvas?.toDataURL('image/png') || null;
                            }, sel);
                        } else {
                            qrCodeSrc = await page.getAttribute(sel, 'src');
                        }
                        if (qrCodeSrc) break;
                    } catch (e) {
                        continue;
                    }
                }

                if (!qrCodeSrc) {
                    // No QR code found - stream the page HTML for debugging
                    const currentUrl = page.url();
                    const bodyHtml = await page.evaluate(() => document.body?.innerHTML?.substring(0, 2000) || 'empty');
                    sendEvent({ 
                        status: 'error', 
                        error: `QR code not found on page ${currentUrl}`,
                        debugHtml: bodyHtml
                    });
                    throw new Error(`QR code not found. URL: ${currentUrl}`);
                }

                sendEvent({ status: 'qr_ready', qrCode: qrCodeSrc, message: 'Please scan the QR code with your phone camera and tap Send in WhatsApp.' });
                console.log(`[Bazaraki Auth Stream] Emitted QR code. Waiting for user WhatsApp verification...`);

                // Wait for user to verify on their phone.
                // When verified, Bazaraki usually redirects to /profile/ or /my/ 
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
                // Stream the error details including DOM state back to the client
                let debugInfo = '';
                if (browser) {
                    try {
                        const pages = browser.contexts()[0]?.pages() || [];
                        if (pages.length > 0) {
                            const currentUrl = pages[0].url();
                            const html = await pages[0].content();
                            debugInfo = `\nURL: ${currentUrl}\nDOM: ${html.substring(0, 1500)}`;
                            console.error(`[Bazaraki Auth Error] URL: ${currentUrl}`);
                        }
                    } catch (e) {}
                }
                sendEvent({ status: 'error', error: (error.message || 'Unknown automation error') + debugInfo });
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
