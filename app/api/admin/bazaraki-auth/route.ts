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

                sendEvent({ status: 'navigating', message: 'Navigating directly to Bazaraki WhatsApp login...' });
                
                // Navigate directly to the WhatsApp login URL, bypassing the AngularJS form entirely.
                // The form requires AngularJS model binding for the consent checkbox which is impossible
                // to reliably trigger from Playwright. The direct URL works without consent.
                const encodedPhone = encodeURIComponent(phone);
                await page.goto(`https://www.bazaraki.com/profile/login/whatsapp/?phone_number=${encodedPhone}`, { 
                    waitUntil: 'domcontentloaded',
                    timeout: 15000 
                });

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

                // Poll for verification completion. Bazaraki may NOT redirect after WhatsApp verification.
                // It might show a success message on the same page, or set cookies via AJAX.
                // We check multiple signals every 3 seconds for up to 90 seconds.
                const startTime = Date.now();
                const TIMEOUT = 90000;
                const POLL_INTERVAL = 3000;
                let verified = false;
                
                // Capture baseline cookies BEFORE polling, so we can detect NEW cookies
                const baselineCookies = await context.cookies('https://www.bazaraki.com');
                const baselineCookieNames = new Set(baselineCookies.map(c => c.name));
                console.log(`[Bazaraki Auth] Baseline cookies: ${[...baselineCookieNames].join(', ')}`);
                
                while (Date.now() - startTime < TIMEOUT) {
                    await page.waitForTimeout(POLL_INTERVAL);
                    
                    // Signal 1: URL changed away from the login page
                    const currentUrl = page.url();
                    if (!currentUrl.includes('/login/')) {
                        console.log(`[Bazaraki Auth Stream] URL changed to: ${currentUrl}`);
                        sendEvent({ status: 'detected', message: `Login redirect detected: ${currentUrl}` });
                        verified = true;
                        break;
                    }
                    
                    // Signal 2: The QR code image disappeared from the page (verification completed)
                    const qrStillVisible = await page.$('img[src^="data:image"]');
                    if (!qrStillVisible) {
                        console.log(`[Bazaraki Auth Stream] QR code disappeared from page`);
                        sendEvent({ status: 'detected', message: 'QR code disappeared — verification likely complete' });
                        verified = true;
                        break;
                    }
                    
                    // Signal 3: Check for NEW cookies that weren't present at baseline
                    const currentCookies = await context.cookies('https://www.bazaraki.com');
                    const newCookies = currentCookies.filter(c => !baselineCookieNames.has(c.name));
                    if (newCookies.length > 0) {
                        const newNames = newCookies.map(c => c.name).join(', ');
                        console.log(`[Bazaraki Auth Stream] New cookies detected: ${newNames}`);
                        sendEvent({ status: 'detected', message: `New session cookies detected: ${newNames}` });
                        verified = true;
                        break;
                    }
                    
                    // Signal 4: Success/completion text appeared on the page
                    const bodyText = await page.evaluate(() => document.body?.innerText?.toLowerCase() || '');
                    if (bodyText.includes('go back to the app') || bodyText.includes('verification process')) {
                        console.log(`[Bazaraki Auth Stream] Success text detected on page`);
                        sendEvent({ status: 'detected', message: 'Verification complete text detected on page' });
                        verified = true;
                        break;
                    }
                    
                    const elapsed = Math.round((Date.now() - startTime) / 1000);
                    sendEvent({ status: 'waiting', message: `Waiting for WhatsApp verification... (${elapsed}s)` });
                }
                
                if (!verified) {
                    const bodyHtml = await page.evaluate(() => document.body?.innerHTML?.substring(0, 2000) || 'empty');
                    sendEvent({ status: 'error', error: 'Timed out waiting for WhatsApp verification', debugHtml: bodyHtml });
                    throw new Error('Verification timeout');
                }

                // After detecting verification, navigate to the profile page to ensure
                // all cookies from the login session are properly set in the browser context.
                sendEvent({ status: 'saving', message: 'Verification detected! Loading profile to capture full session...' });
                
                try {
                    await page.goto('https://www.bazaraki.com/my/', { waitUntil: 'domcontentloaded', timeout: 15000 });
                } catch (e) {
                    // Even if this navigation fails, we still have the cookies from the login
                    console.log(`[Bazaraki Auth Stream] Profile navigation failed, proceeding with current cookies`);
                }
                
                console.log(`[Bazaraki Auth Stream] Capturing session state...`);
                sendEvent({ status: 'saving', message: 'Saving session cookies to database...' });

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

                sendEvent({ status: 'success', message: 'Successfully authenticated! Session cookies saved.' });
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
