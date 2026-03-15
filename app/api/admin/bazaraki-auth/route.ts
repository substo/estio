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

                sendEvent({ status: 'navigating', message: 'Navigating to Bazaraki WhatsApp login...' });
                
                // Navigate directly to the WhatsApp login URL, bypassing the AngularJS form.
                const encodedPhone = encodeURIComponent(phone);
                await page.goto(`https://www.bazaraki.com/profile/login/whatsapp/?phone_number=${encodedPhone}`, { 
                    waitUntil: 'domcontentloaded',
                    timeout: 15000 
                });

                sendEvent({ status: 'waiting_qr', message: 'Looking for QR code...' });

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
                            qrCodeSrc = await page.evaluate((s) => {
                                const canvas = document.querySelector(s) as HTMLCanvasElement;
                                return canvas?.toDataURL('image/png') || null;
                            }, sel);
                        } else {
                            qrCodeSrc = await page.getAttribute(sel, 'src');
                        }
                        if (qrCodeSrc) {
                            console.log(`[Bazaraki Auth] QR found via selector: ${sel}`);
                            break;
                        }
                    } catch (e) {
                        continue;
                    }
                }

                if (!qrCodeSrc) {
                    const bodyHtml = await page.evaluate(() => document.body?.innerHTML?.substring(0, 2000) || 'empty');
                    sendEvent({ status: 'error', error: `QR code not found`, debugHtml: bodyHtml });
                    throw new Error(`QR code not found`);
                }

                sendEvent({ status: 'qr_ready', qrCode: qrCodeSrc, message: 'Scan the QR code, then tap Send in WhatsApp. Keep this page open.' });
                console.log(`[Bazaraki Auth Stream] QR code emitted. Waiting for verification...`);

                // === VERIFICATION DETECTION ===
                // After the user scans the QR and taps Send in WhatsApp, we need to detect
                // that verification completed. We poll every 3s for up to 2 minutes.
                // Only 2 reliable signals (no cookies/QR checks - those cause false positives):
                //   1. URL changed away from /login/ (redirect to profile)
                //   2. IPfication success text ("Please go back to the app/website")
                const startTime = Date.now();
                const TIMEOUT = 120000;
                const POLL_INTERVAL = 3000;
                let verified = false;
                
                while (Date.now() - startTime < TIMEOUT) {
                    await page.waitForTimeout(POLL_INTERVAL);
                    
                    const currentUrl = page.url();
                    
                    // Signal 1: URL changed away from login
                    if (!currentUrl.includes('/login/')) {
                        console.log(`[Bazaraki Auth] URL changed to: ${currentUrl}`);
                        sendEvent({ status: 'detected', message: `Redirect detected: ${currentUrl}` });
                        verified = true;
                        break;
                    }
                    
                    // Signal 2: IPfication success text
                    const bodyText = await page.evaluate(() => document.body?.innerText || '');
                    const bodyLower = bodyText.toLowerCase();
                    if (bodyLower.includes('please go back') || bodyLower.includes('complete the verification')) {
                        console.log(`[Bazaraki Auth] IPfication success text detected`);
                        sendEvent({ status: 'detected', message: 'WhatsApp verification confirmed!' });
                        verified = true;
                        break;
                    }
                    
                    const elapsed = Math.round((Date.now() - startTime) / 1000);
                    console.log(`[Bazaraki Auth Poll ${elapsed}s] Text: ${bodyText.substring(0, 150)}`);
                    sendEvent({ status: 'waiting', message: `Waiting for WhatsApp verification... (${elapsed}s)` });
                }
                
                if (!verified) {
                    const bodyHtml = await page.evaluate(() => document.body?.innerHTML?.substring(0, 2000) || 'empty');
                    sendEvent({ status: 'error', error: 'Timed out waiting for verification (2 min)', debugHtml: bodyHtml });
                    throw new Error('Verification timeout');
                }

                // Navigate to profile page to ensure cookies are fully loaded
                sendEvent({ status: 'saving', message: 'Verification detected! Capturing session...' });
                
                try {
                    await page.goto('https://www.bazaraki.com/my/', { waitUntil: 'domcontentloaded', timeout: 15000 });
                } catch (e) {
                    console.log(`[Bazaraki Auth] Profile nav failed, proceeding with current cookies`);
                }
                
                const sessionState = await context.storageState();
                console.log(`[Bazaraki Auth] Session captured. Cookies: ${sessionState.cookies.map(c => c.name).join(', ')}`);

                await db.scrapingCredential.update({
                    where: { id: credentialId },
                    data: {
                        sessionState: sessionState as any,
                        status: 'active',
                    }
                });

                sendEvent({ status: 'success', message: 'Successfully authenticated! Session saved.' });
            } catch (error: any) {
                console.error(`[Bazaraki Auth Error]`, error);
                let debugInfo = '';
                if (browser) {
                    try {
                        const pages = browser.contexts()[0]?.pages() || [];
                        if (pages.length > 0) {
                            const url = pages[0].url();
                            const body = await pages[0].evaluate(() => document.body?.innerHTML?.substring(0, 2000) || 'empty');
                            debugInfo = `\nURL: ${url}\nBody: ${body}`;
                        }
                    } catch (e) {}
                }
                sendEvent({ status: 'error', error: (error.message || 'Unknown error') + debugInfo });
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
