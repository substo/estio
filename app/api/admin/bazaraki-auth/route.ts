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
                // Use the FULL Chromium binary (not chromium_headless_shell) for proper
                // AngularJS rendering. The headless shell doesn't execute all JS properly.
                browser = await chromium.launch({ 
                    headless: true,
                    channel: 'chromium',
                });
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
                // The WhatsApp login page does NOT update after verification.
                // No URL change, no text change, nothing visible. Bazaraki's backend
                // sets the session cookies, but the page stays exactly the same.
                // Navigating to /my/ triggers Cloudflare bot protection.
                //
                // Strategy: We monitor the `sessionid` cookie value and any new cookies. 
                // Before login, it's an anonymous session. After successful WhatsApp
                // verification, Bazaraki's backend updates the `sessionid` and adds auth cookies.
                const startTime = Date.now();
                const TIMEOUT = 120000; // 2 minutes total
                const INITIAL_WAIT = 15000; // 15s before first check (user needs time to scan)
                const POLL_INTERVAL = 5000; // check every 5s after that
                let verified = false;
                
                const getCookies = async () => await context.cookies('https://www.bazaraki.com');
                const baselineCookies = await getCookies();
                const baselineSessionId = baselineCookies.find(c => c.name === 'sessionid')?.value || null;
                const baselineCookieNames = new Set(baselineCookies.map(c => c.name));
                
                console.log(`[Bazaraki Auth] Baseline sessionid: ${baselineSessionId}`);
                
                // Wait for user to scan QR and send WhatsApp message
                sendEvent({ status: 'waiting', message: 'Waiting for you to scan the QR code and send the WhatsApp message...' });
                await page.waitForTimeout(INITIAL_WAIT);
                
                while (Date.now() - startTime < TIMEOUT) {
                    const elapsed = Math.round((Date.now() - startTime) / 1000);
                    sendEvent({ status: 'checking', message: `Checking if login succeeded... (${elapsed}s)` });
                    
                    const currentCookies = await getCookies();
                    const currentSessionId = currentCookies.find(c => c.name === 'sessionid')?.value || null;
                    
                    // Filter out known tracker cookies that might appear mid-session randomly
                    const newCookies = currentCookies.filter(c => !baselineCookieNames.has(c.name));
                    const hasSignificantNewCookie = newCookies.some(c => 
                        !['_cfuvid', '_ga', '_ym_', '__cmp'].some(prefix => c.name.startsWith(prefix))
                    );
                    
                    if ((currentSessionId && currentSessionId !== baselineSessionId) || hasSignificantNewCookie) {
                        console.log(`[Bazaraki Auth] Login detected! sessionid changed to: ${currentSessionId}, or new cookies found`);
                        sendEvent({ status: 'detected', message: 'Login successful! Capturing session...' });
                        verified = true;
                        break;
                    }
                    
                    await page.waitForTimeout(POLL_INTERVAL);
                }
                
                if (!verified) {
                    sendEvent({ status: 'error', error: 'Timed out (2 min). Please try again — make sure to scan the QR and tap Send in WhatsApp before the timer runs out.' });
                    throw new Error('Verification timeout');
                }

                // We are authenticated. No need to navigate anywhere and risk Cloudflare.
                sendEvent({ status: 'saving', message: 'Session captured. Saving to database...' });
                
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
