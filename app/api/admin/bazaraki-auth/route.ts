import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
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
                // Use playwright-extra with stealth plugin to bypass Cloudflare Turnstile bot detection
                chromium.use(stealth());
                
                // Use the FULL Chromium binary for proper AngularJS rendering.
                browser = await chromium.launch({ 
                    headless: true,
                    channel: 'chromium',
                });
                
                // Additional stealth settings for context
                const context = await browser.newContext({
                    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    viewport: { width: 1280, height: 800 },
                    locale: 'en-US',
                });
                const page = await context.newPage();

                sendEvent({ status: 'navigating', message: 'Navigating to Bazaraki WhatsApp login...' });
                
                // Navigate directly to the WhatsApp login URL, bypassing the AngularJS form.
                const encodedPhone = encodeURIComponent(phone);
                await page.goto(`https://www.bazaraki.com/profile/login/whatsapp/?phone_number=${encodedPhone}`, { 
                    waitUntil: 'domcontentloaded',
                    timeout: 15000 
                });

                // Dismiss cookie consent popup (ConsentManager / cmpwrapper)
                // This blocks AngularJS scripts from running, preventing QR code render.
                sendEvent({ status: 'consent', message: 'Accepting cookie consent...' });
                try {
                    // Method 1: Try ConsentManager JS API
                    await page.evaluate(() => {
                        // consentmanager.net API
                        if (typeof (window as any).__cmp === 'function') {
                            (window as any).__cmp('setConsent', 1);
                        }
                        // Alternative CMP APIs
                        if (typeof (window as any).cmpApi === 'object') {
                            (window as any).cmpApi.acceptAllConsent?.();
                        }
                    });
                    
                    // Method 2: Try clicking common accept buttons
                    const consentSelectors = [
                        '.cmpboxbtn.cmpboxbtnyes',           // ConsentManager yes button
                        '#cmpbntyestxt',                      // ConsentManager yes text button
                        'a.cmpboxbtnyes',                     // ConsentManager link button
                        'button:has-text("Accept")',          // Generic accept
                        'button:has-text("Accept all")',      // Generic accept all
                        '.cmpwrapper button',                 // Any button in cmpwrapper
                    ];
                    
                    for (const sel of consentSelectors) {
                        try {
                            const btn = await page.$(sel);
                            if (btn) {
                                await btn.click();
                                console.log(`[Bazaraki Auth] Clicked consent button: ${sel}`);
                                break;
                            }
                        } catch (e) { continue; }
                    }
                } catch (e) {
                    console.log(`[Bazaraki Auth] Cookie consent handling skipped`);
                }
                
                // Wait for AngularJS to bootstrap after consent is accepted
                await page.waitForTimeout(3000);

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
                            qrCodeSrc = await page.evaluate((s: string) => {
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
                // Now that we are using the stealth plugin, Cloudflare will not block the
                // redirect. After the user scans the QR and taps Send in WhatsApp, Bazaraki's
                // backend will successfully redirect the browser to the homepage/profile.
                const startTime = Date.now();
                const TIMEOUT = 120000; // 2 minutes total
                const POLL_INTERVAL = 3000;
                let verified = false;
                
                while (Date.now() - startTime < TIMEOUT) {
                    const elapsed = Math.round((Date.now() - startTime) / 1000);
                    sendEvent({ status: 'checking', message: `Waiting for WhatsApp verification... (${elapsed}s)` });
                    
                    const currentUrl = page.url();
                    
                    // If the URL changed away from the login page, the redirect succeeded!
                    if (!currentUrl.includes('/login/')) {
                        console.log(`[Bazaraki Auth] Redirect detected! URL: ${currentUrl}`);
                        sendEvent({ status: 'detected', message: 'WhatsApp verification confirmed! Capturing session...' });
                        verified = true;
                        break;
                    }
                    
                    await page.waitForTimeout(POLL_INTERVAL);
                }
                
                if (!verified) {
                    sendEvent({ status: 'error', error: 'Timed out (2 min). Please try again — make sure to scan the QR and tap Send in WhatsApp before the timer runs out.' });
                    throw new Error('Verification timeout');
                }

                // Navigate to the profile page explicitly to ensure all cookies are fully loaded
                // just in case it initially redirected to the bare homepage.
                sendEvent({ status: 'saving', message: 'Session authenticated. Finalizing profile...' });
                try {
                    await page.goto('https://www.bazaraki.com/my/', { waitUntil: 'domcontentloaded', timeout: 15000 });
                } catch (e) {
                    console.log(`[Bazaraki Auth] Profile nav failed, proceeding with current cookies`);
                }
                
                const sessionState = await context.storageState();
                console.log(`[Bazaraki Auth] Session captured. Cookies: ${sessionState.cookies.map((c: any) => c.name).join(', ')}`);

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
