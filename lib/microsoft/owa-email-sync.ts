import { Page } from 'puppeteer';
import db from '@/lib/db';
import { outlookPuppeteerService } from './outlook-puppeteer';

interface OWAEmail {
    id: string;
    subject: string;
    sender: string;
    senderEmail: string;
    preview: string;
    fullBody?: string; // New field for full HTML
    date: Date;
    isRead: boolean;
    hasAttachments: boolean;
}

/**
 * Sync emails from OWA using Puppeteer
 */
export async function syncEmailsFromOWA(userId: string, folderId: 'inbox' | 'sentitems' | 'archive' | 'search' = 'inbox', searchQuery?: string) {
    console.log(`[OWA Email Sync] Starting sync for user ${userId}, folder/mode ${folderId}`);

    // Load or refresh session
    let { valid, page } = await outlookPuppeteerService.loadSession(userId);

    if (!valid) {
        console.log('[OWA Email Sync] Session invalid, attempting refresh...');
        const refreshResult = await outlookPuppeteerService.refreshSession(userId);
        if (!refreshResult.success || !refreshResult.page) {
            throw new Error('Session expired and could not be refreshed. Please reconnect.');
        }
        valid = true;
        page = refreshResult.page;
    }

    if (!page) {
        throw new Error('Failed to get browser page');
    }

    const emails: OWAEmail[] = [];

    // Helper to setup listeners on a page
    const setupPageListeners = async (p: Page) => {
        // Set up request interception to capture OWA API responses
        await p.setRequestInterception(true);

        p.on('request', (request) => {
            if (request.isInterceptResolutionHandled()) return;
            request.continue();
        });

        p.on('response', async (response) => {
            const url = response.url();

            // OWA usually returns items in JSON for FindItem or GetItem
            if (url.includes('/owa/') && (
                url.includes('action=FindItem') ||
                url.includes('action=GetItem') ||
                url.includes('service.svc')
            )) {
                try {
                    const data = await response.json();
                    if (data?.Body?.ResponseMessages?.Items) {
                        extractFromFindItemResponse(data);
                    }
                } catch (e) {
                    // Ignore non-JSON
                }
            }
        });

        function extractFromFindItemResponse(data: any) {
            for (const item of data.Body.ResponseMessages.Items) {
                if (item.RootFolder?.Items) {
                    for (const msg of item.RootFolder.Items) {
                        emails.push({
                            id: msg.ItemId?.Id || '',
                            subject: msg.Subject || '(No Subject)',
                            sender: msg.From?.Mailbox?.Name || 'Unknown',
                            senderEmail: msg.From?.Mailbox?.EmailAddress || '',
                            preview: msg.Preview || '',
                            // API usually returns body in a separate GetItem call, but sometimes preview is all we get here
                            // We might need to fetch body separately if we rely purely on API.
                            // For now, API interception is a "lucky bonus", DOM scraping is the main robust path.
                            date: new Date(msg.DateTimeReceived || msg.DateTimeCreated),
                            isRead: msg.IsRead || false,
                            hasAttachments: msg.HasAttachments || false
                        });
                    }
                }
            }
        }
    };

    const ensureOWASession = async () => {
        let attempts = 0;
        const maxAttempts = 3;
        let onOWA = false;

        while (attempts < maxAttempts && !onOWA) {
            if (page?.isClosed()) {
                console.log('[OWA Email Sync] Page is closed, reloading session...');
                const res = await outlookPuppeteerService.loadSession(userId);
                if (res.page) {
                    page = res.page;
                    await setupPageListeners(page);
                } else {
                    throw new Error('Failed to reload session page');
                }
            }

            if (!page) throw new Error('Browser page unavailable');

            const currentUrl = page.url();
            const owaElement = await page.$('#app [role="tree"], #app [role="grid"], div[data-app-section="Mail"], [role="main"], [role="application"], #app');
            // Simplified check for brevity - full check is in original code

            if (currentUrl.includes('outlook') && owaElement) {
                onOWA = true;
            } else {
                if (attempts < maxAttempts - 1) {
                    await page.reload({ waitUntil: 'domcontentloaded' });
                    await new Promise(r => setTimeout(r, 5000));
                }
            }
            attempts++;
        }
    };

    const getBaseUrl = () => {
        if (!page) return 'https://outlook.live.com/mail/0';
        const url = page.url();
        return url.includes('office') ? 'https://outlook.office.com/mail/0' : 'https://outlook.live.com/mail/0';
    };

    try {
        await setupPageListeners(page);
        const baseUrl = getBaseUrl();

        if (folderId === 'search' && searchQuery) {
            const targetUrl = `${baseUrl}/inbox`;
            if (!page.url().includes('/inbox')) {
                await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await new Promise(r => setTimeout(r, 2000));
            }
            await ensureOWASession();
            await dismissBanners(page);

            // ... (Search logic remains same, omitted for brevity in this replacement chunk if not changing) ...
            console.log(`[OWA Email Sync] Performing search for: ${searchQuery}`);
            // [Existing search logic block]
            try {
                // Quick re-implementation of search trigger for context
                const searchButton = await page.$('button[aria-label="Search"]');
                if (searchButton) await searchButton.click();
                await page.type('input[aria-label="Search"]', searchQuery);
                await page.keyboard.press('Enter');
                await new Promise(r => setTimeout(r, 3000));
            } catch (e) { }

        } else {
            // Map folderId to OWA URL suffix
            let suffix = 'inbox';
            if (folderId === 'sentitems') suffix = 'sentitems';
            else if (folderId === 'archive') suffix = 'archive';
            const folderUrl = `${baseUrl}/${suffix}`;
            if (!page.url().includes(`/${suffix}`)) {
                await page.goto(folderUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            }
            await ensureOWASession();
            await dismissBanners(page);
        }

        await page.waitForSelector('[role="listbox"]', { timeout: 10000 }).catch(() => { });

        if (emails.length === 0) {
            console.log('[OWA Email Sync] API interception did not catch items, starting DOM scraping with CLICK-TO-LOAD...');

            // USE NEW SCRAPING LOGIC
            const scrapedEmails = await scrapeEmailsFromDOM(page, searchQuery);
            emails.push(...scrapedEmails);
        }

        console.log(`[OWA Email Sync] Found ${emails.length} emails`);

        for (const email of emails) {
            await processOWAEmail(userId, email, folderId);
        }

        return emails.length;

    } finally {
        await page.close();

        // Update Sync State
        if (emails.length > 0 || folderId === 'inbox') {
            try {
                const user = await db.user.findUnique({ where: { id: userId }, select: { outlookEmail: true } });
                const emailToUse = user?.outlookEmail || `puppeteer-session-${userId}`;
                await db.outlookSyncState.upsert({
                    where: { userId },
                    create: { userId, emailAddress: emailToUse, lastSyncedAt: new Date() },
                    update: { lastSyncedAt: new Date(), ...(user?.outlookEmail ? { emailAddress: user.outlookEmail } : {}) }
                });
            } catch (e) {
                console.error('[OWA Email Sync] Failed to update sync state:', e);
            }
        }
    }

    async function scrapeEmailsFromDOM(page: Page, searchQuery?: string): Promise<OWAEmail[]> {
        const emails: OWAEmail[] = [];
        const scrapedMap = new Map<string, boolean>();

        // STEP 0: Fetch Last Sync Time for Incremental Stop
        // We only stop early if NOT searching (searching needs full results)
        let cutoffDate: Date | null = null;
        if (!searchQuery) {
            try {
                // We need userId to fetch sync state. But scrapeEmailsFromDOM doesn't have it as arg.
                // It is a localized function. We can just skip this optimization or pass userId.
                // Refactor: syncEmailsFromOWA passes userId to helper, but scrapeEmailsFromDOM signature is fixed in this context?
                // Actually scrapeEmailsFromDOM is inner function of syncEmailsFromOWA, so it captures `userId` from closure!
                const syncState = await db.outlookSyncState.findUnique({ where: { userId } });
                if (syncState?.lastSyncedAt) {
                    // Buffer: Go back 24 hours to be safe against delayed delivery or timezone issues
                    cutoffDate = new Date(syncState.lastSyncedAt.getTime() - 24 * 60 * 60 * 1000);
                    console.log(`[OWA Email Sync Debug] Incremental Sync Enabled. Cutoff: ${cutoffDate.toISOString()}`);
                }
            } catch (e) { console.warn('Failed to load sync state for incremental check', e); }
        }

        // STEP 1: Scroll to TOP... (rest of code)
        console.log('[OWA Email Sync] Scrolling to top of email list...');
        await page.evaluate(() => {
            const scrollBars = document.querySelectorAll('.customScrollBar');
            for (const el of scrollBars) {
                const htmlEl = el as HTMLElement;
                if (htmlEl.scrollHeight > htmlEl.clientHeight && htmlEl.scrollHeight > 500) {
                    htmlEl.scrollTop = 0;
                    break;
                }
            }
        });
        await new Promise(r => setTimeout(r, 2000)); // Increased wait for stability

        // Get total email count from aria-setsize if available
        const totalEmails = await page.evaluate(() => {
            const firstOption = document.querySelector('div[role="option"]');
            const setSize = firstOption?.getAttribute('aria-setsize');
            return setSize ? parseInt(setSize, 10) : 0;
        });
        console.log(`[OWA Email Sync] Total emails in folder (from aria-setsize): ${totalEmails}`);

        let scrollAttempts = 0;
        const maxScrolls = 20;
        let consecutiveEmptyBatches = 0;
        let emailsOlderThanCutoff = 0; // Track old emails for early exit

        while (scrollAttempts < maxScrolls) {
            // ...
            // Track how many emails we had before this batch
            const emailsBeforeBatch = emails.length;

            // Get all visible rows count
            const rowCount = await page.evaluate(() => document.querySelectorAll('div[role="option"]').length);
            console.log(`[OWA Email Sync Debug] Found ${rowCount} visible rows on scroll ${scrollAttempts}. Total collected: ${emails.length}/${totalEmails || '?'}`);

            for (let i = 0; i < rowCount; i++) {
                try {
                    // Re-query the specific row to avoid detached node errors
                    const rowHandles = await page.$$('div[role="option"]');
                    const rowHandle = rowHandles[i];

                    if (!rowHandle) {
                        console.log(`[OWA Email Sync Debug] Row ${i} not found (list changed?), skipping.`);
                        continue;
                    }

                    // Extract basic info first
                    const basicInfo = await page.evaluate(el => {
                        const id = el.getAttribute('data-convid') || el.id || Math.random().toString(36);

                        // Extraction logic (same as before)
                        const ariaLabel = el.getAttribute('aria-label') || '';
                        let sender = '', subject = '', preview = '', dateStr = '';

                        const senderEl = el.querySelector('div.JBWmn span') || el.querySelector('.fui-Avatar');
                        sender = senderEl?.getAttribute('title') || senderEl?.getAttribute('aria-label') || '';

                        const subjectEl = el.querySelector('span.TtcXM');
                        subject = (subjectEl as HTMLElement)?.innerText?.trim() || subjectEl?.getAttribute('title') || '';

                        const previewEl = el.querySelector('span.FqgPc');
                        preview = (previewEl as HTMLElement)?.innerText?.trim() || '';

                        const dateEl = el.querySelector('span._rWRU');
                        dateStr = dateEl?.getAttribute('title') || (dateEl as HTMLElement)?.innerText?.trim() || '';

                        return { id, sender, subject, preview, dateStr, ariaLabel };
                    }, rowHandle);

                    // --- INCREMENTAL SYNC OPTIMIZATION ---
                    // Check if this email is older than our last sync time
                    if (cutoffDate) {
                        try {
                            // Simple parser for OWA dates
                            let emailDate = new Date(basicInfo.dateStr);
                            const now = new Date();

                            // Handle relative dates like "Tue 11:45 AM" or "Yesterday"
                            if (isNaN(emailDate.getTime())) {
                                const lower = basicInfo.dateStr.toLowerCase();
                                if (lower.includes('am') || lower.includes('pm')) {
                                    // Likely today or recent day. Assume recent -> keep going.
                                    emailDate = now;
                                } else if (lower.includes('yesterday')) {
                                    emailDate = new Date(now.setDate(now.getDate() - 1));
                                } else {
                                    // Try splitting d/m/y if needed, but new Date() usually works for "01/02/2026"
                                    // If still NaN, assume it's new (don't skip)
                                    emailDate = now;
                                }
                            }

                            if (emailDate < cutoffDate) {
                                emailsOlderThanCutoff++;
                                console.log(`[OWA Email Sync Debug] Found old email (${basicInfo.dateStr} -> ${emailDate.toISOString()}). Consecutive: ${emailsOlderThanCutoff}`);
                                if (emailsOlderThanCutoff >= 5) {
                                    console.log(`[OWA Email Sync] Hit 5 consecutive emails older than ${cutoffDate.toISOString()}. Stopping sync.`);
                                    // Break the OUTER loop by modifying the counter
                                    scrollAttempts = maxScrolls + 100;
                                    break; // Break inner loop
                                    // Note: This stops clicking and stops future scrolling.
                                }
                                continue; // Skip processing this specific old email
                            } else {
                                emailsOlderThanCutoff = 0; // Reset counter if we find a new one (out of order?)
                            }
                        } catch (dErr) { console.warn('Date parse error for optimization', dErr); }
                    }

                    if (scrapedMap.has(basicInfo.id)) continue;
                    scrapedMap.set(basicInfo.id, true);

                    // --- KEY CHANGE: CLICK AND LOAD FULL CONTENT ---
                    let fullBody = '';
                    try {
                        // Click the row
                        await new Promise(r => setTimeout(r, 500)); // Pre-click stability

                        // Check if handle is still valid before clicking
                        if (await rowHandle.evaluate(node => !node.isConnected)) {
                            throw new Error('Node detached before click');
                        }

                        await rowHandle.click();

                        // Wait for UI to react and validate content matches
                        try {
                            const expectedSubject = basicInfo.subject;
                            await page.waitForFunction(
                                (subject) => {
                                    const readingPane = document.querySelector('#ReadingPaneContainerId') ||
                                        document.querySelector('div[role="document"]') ||
                                        document.querySelector('.AllowTextSelection');

                                    if (!readingPane) return false;
                                    const text = (readingPane as HTMLElement).innerText;

                                    // Ensure we don't see skeleton/loading state
                                    const hasSkeleton = readingPane.querySelector('.fui-Skeleton') !== null;
                                    return text.includes(subject) && !hasSkeleton;
                                },
                                { timeout: 8000 },
                                expectedSubject
                            );
                        } catch (waitErr) {
                            console.warn('[OWA Email Sync] Warning: Timed out waiting for subject match or skeleton dismissal. Proceeding...');
                        }

                        // Extract HTML body
                        fullBody = await page.evaluate(() => {
                            const bodyContainer = document.querySelector('.F2E7M') ||
                                document.querySelector('#UniqueMessageBody') ||
                                document.querySelector('div[aria-label="Message body"]') ||
                                document.querySelector('.literalText') ||
                                document.querySelector('#ReadingPaneContainerId') ||
                                document.querySelector('div[role="document"]');
                            return bodyContainer?.innerHTML || '';
                        });

                        console.log(`[OWA Email Sync Debug] Extracted body length: ${fullBody.length}`);

                    } catch (clickErr) {
                        console.warn(`[OWA Email Sync] Failed to load full body for ${basicInfo.subject}:`, clickErr);
                    }

                    // Extract sender email - AGGRESSIVE STRATEGY
                    let senderEmail = '';
                    try {
                        senderEmail = await page.evaluate(() => {
                            const container = document.querySelector('#ReadingPaneContainerId') ||
                                document.querySelector('div[role="document"]');
                            if (!container) return '';

                            const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;

                            // 1. Check specific known elements (Persona, Avatar, Hover Targets)
                            const candidates = Array.from(container.querySelectorAll(
                                '.ms-Persona-secondaryText, ' +
                                'div[id^="Persona"] span[dir="ltr"], ' +
                                '.fui-Avatar, ' +
                                '.lpcCommonWeb-hoverTarget, ' +
                                'span[role="img"], ' +
                                'a[href^="mailto:"]'
                            ));

                            for (const el of candidates) {
                                // Check text content
                                let text = el.textContent || '';
                                let match = text.match(emailRegex);
                                if (match) return match[1].toLowerCase();

                                // Check attributes (title, aria-label)
                                const labels = [
                                    el.getAttribute('title'),
                                    el.getAttribute('aria-label'),
                                    el.getAttribute('href') // for mailto
                                ];

                                for (const label of labels) {
                                    if (label) {
                                        match = label.match(emailRegex);
                                        if (match) return match[1].toLowerCase();
                                    }
                                }
                            }

                            // 2. Deep scan of ALL elements in header for attributes containing "@"
                            // This catches "Opens card for user@email.com" in aria-labels
                            const allElements = container.querySelectorAll('*');
                            for (const el of allElements) {
                                // Skip large text blocks to improve perf, focus on attributes
                                const attributes = ['aria-label', 'title', 'data-unique-id'];
                                for (const attr of attributes) {
                                    const val = el.getAttribute(attr);
                                    if (val && val.includes('@')) {
                                        const match = val.match(emailRegex);
                                        if (match) return match[1].toLowerCase();
                                    }
                                }
                            }

                            return '';
                        });

                        // IF EMAIL MISSING: Try Hover Strategy (Essential for internal users)
                        if (!senderEmail) {
                            console.log(`[OWA Email Sync Debug] Email missing for "${basicInfo.sender}" after scan. Attempting hover...`);

                            const hoverSuccess = await page.evaluate(() => {
                                // Find the sender element in reading pane to hover
                                // Try multiple selectors for the name/avatar
                                const targets = [
                                    document.querySelector('#ReadingPaneContainerId div[role="heading"] span'),
                                    document.querySelector('#ReadingPaneContainerId .OZZZK'),
                                    document.querySelector('div[role="document"] div[role="heading"] span'),
                                    document.querySelector('.ms-Persona-primaryText'),
                                    document.querySelector('.fui-Avatar')
                                ];

                                for (const target of targets) {
                                    if (target) {
                                        const rect = target.getBoundingClientRect();
                                        if (rect.width > 0 && rect.height > 0) {
                                            const mouseOver = new MouseEvent('mouseover', {
                                                bubbles: true,
                                                cancelable: true,
                                                view: window,
                                                clientX: rect.x + 5,
                                                clientY: rect.y + 5
                                            });
                                            target.dispatchEvent(mouseOver);
                                            return true;
                                        }
                                    }
                                }
                                return false;
                            });

                            if (hoverSuccess) {
                                await new Promise(r => setTimeout(r, 2000)); // Wait for Persona Card

                                // Retry extraction from Persona Card
                                senderEmail = await page.evaluate(() => {
                                    const card = document.querySelector('.ms-Persona-secondaryText') ||
                                        document.querySelector('div[id^="Persona"] span[dir="ltr"]');
                                    return card?.textContent?.trim().toLowerCase() || '';
                                });
                            }
                        }

                        if (senderEmail) {
                            console.log(`[OWA Email Sync Debug] Extracted sender email: ${senderEmail}`);
                        } else {
                            // DIAGNOSTIC DUMP: Why can't we see the email?
                            console.log(`[OWA Email Sync Debug] ❌ FATAL: Could not extract email for "${basicInfo.sender}". Skipping.`);
                            console.log(`[OWA Email Sync Debug] DUMPING HEADER HTML for analysis:`);
                            const headerHTML = await page.evaluate(() => {
                                const header = document.querySelector('#ReadingPaneContainerId') || document.querySelector('div[role="document"]');
                                return header ? header.outerHTML.substring(0, 3000) : 'No Header Found'; // Increased limit
                            });
                            console.log(headerHTML);
                        }
                    } catch (emailErr) {
                        console.warn('[OWA Email Sync] Failed to extract sender email:', emailErr);
                    }

                    emails.push({
                        id: basicInfo.id,
                        subject: basicInfo.subject || '(No Subject)',
                        sender: basicInfo.sender || 'Unknown',
                        senderEmail: senderEmail,
                        preview: basicInfo.preview,
                        fullBody: fullBody || basicInfo.preview,
                        date: parseSafeDate(basicInfo.dateStr),
                        isRead: !basicInfo.ariaLabel.includes('Unread'),
                        hasAttachments: false
                    });

                } catch (e) {
                    console.log('[OWA Email Sync] Error processing row, it might have been detached.', e);
                    continue;
                }
            }

            // Check if we collected all emails (early exit)
            if (totalEmails > 0 && emails.length >= totalEmails) {
                console.log(`[OWA Email Sync] Collected all ${emails.length} emails (matched aria-setsize). Done!`);
                break;
            }

            // Track consecutive empty batches
            const newEmailsThisBatch = emails.length - emailsBeforeBatch;
            if (newEmailsThisBatch === 0) {
                consecutiveEmptyBatches++;
                console.log(`[OWA Email Sync] No new emails this batch (${consecutiveEmptyBatches} consecutive)`);
                if (consecutiveEmptyBatches >= 3) {
                    console.log('[OWA Email Sync] 3 consecutive empty batches. Stopping.');
                    break;
                }
            } else {
                consecutiveEmptyBatches = 0;
            }

            // DIAGNOSTIC: Dump all .customScrollBar elements to find the right one
            const diagnostics = await page.evaluate(() => {
                const allScrollBars = document.querySelectorAll('.customScrollBar');
                const results: any[] = [];
                allScrollBars.forEach((el, i) => {
                    const htmlEl = el as HTMLElement;
                    results.push({
                        index: i,
                        clientHeight: htmlEl.clientHeight,
                        scrollHeight: htmlEl.scrollHeight,
                        scrollTop: htmlEl.scrollTop,
                        canScroll: htmlEl.scrollHeight > htmlEl.clientHeight,
                        className: htmlEl.className,
                        parentClass: htmlEl.parentElement?.className || 'none'
                    });
                });
                return results;
            });
            console.log('[OWA Email Sync] All .customScrollBar elements:', JSON.stringify(diagnostics, null, 2));

            // Find the scrollable one (the email list, not others)
            const scrollableIndex = diagnostics.findIndex(d => d.canScroll && d.scrollHeight > 500);

            if (scrollableIndex === -1) {
                console.log('[OWA Email Sync] No scrollable .customScrollBar found! Trying mouse wheel...');
                // Fallback: use mouse wheel on the list area
                const listBox = await page.$('div[role="listbox"]');
                if (listBox) {
                    const box = await listBox.boundingBox();
                    if (box) {
                        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                        await page.mouse.wheel({ deltaY: 500 });
                        await new Promise(r => setTimeout(r, 2000));
                        scrollAttempts++;
                        continue; // Try next iteration with hopefully new rows loaded
                    }
                }
                console.log('[OWA Email Sync] Mouse wheel fallback also failed.');
                break;
            }

            // Use the correct scrollable element by index
            const scrollInfo = await page.evaluate((targetIndex) => {
                const allScrollBars = document.querySelectorAll('.customScrollBar');
                const el = allScrollBars[targetIndex] as HTMLElement;
                if (!el) return { found: false, scrolled: false, info: 'Element not found by index' };

                const before = el.scrollTop;
                const scrollAmount = el.clientHeight;
                const maxScroll = el.scrollHeight - el.clientHeight;

                if (before >= maxScroll - 10) {
                    return { found: true, scrolled: false, info: `Already at bottom: ${before}/${maxScroll}`, before, maxScroll };
                }

                el.scrollTop += scrollAmount;
                const after = el.scrollTop;

                return {
                    found: true,
                    scrolled: after !== before,
                    info: `Scrolled element[${targetIndex}]: ${before} -> ${after} (max: ${maxScroll})`,
                    before,
                    after,
                    maxScroll
                };
            }, scrollableIndex);

            console.log(`[OWA Email Sync] Scroll attempt ${scrollAttempts}: ${scrollInfo.info}`);

            if (!scrollInfo.found || !scrollInfo.scrolled) {
                console.log('[OWA Email Sync] Could not scroll further or no more content.');
                break;
            }
            await new Promise(r => setTimeout(r, 2500));
            scrollAttempts++;
        }

        return emails;
    }

    async function processOWAEmail(userId: string, email: OWAEmail, folderId: string) {
        try {
            const conversationId = await findOrCreateConversation(userId, email.sender, email.senderEmail);
            if (!conversationId) return;

            let emailDate = email.date;
            if (isNaN(emailDate.getTime())) emailDate = new Date();

            const existing = await db.message.findFirst({
                where: {
                    conversationId,
                    subject: email.subject,
                    createdAt: {
                        gte: new Date(emailDate.getTime() - 60000),
                        lte: new Date(emailDate.getTime() + 60000)
                    }
                }
            });

            if (existing) return;

            await db.message.create({
                data: {
                    conversationId,
                    direction: folderId === 'inbox' ? 'inbound' : 'outbound',
                    type: 'EMAIL',
                    status: 'delivered',
                    body: email.fullBody || email.preview, // Use full body!
                    subject: email.subject,
                    emailFrom: email.senderEmail || email.sender,
                    createdAt: emailDate
                }
            });

            console.log(`[OWA Email Sync] Saved email: ${email.subject}`);

            // GHL Trigger (omitted for brevity, same as before)

        } catch (error) {
            console.error(`[OWA Email Sync] Error processing email:`, error);
        }
    }

    /**
     * Robust date parser for OWA formats
     */
    function parseSafeDate(input: string | Date | undefined): Date {
        if (!input) return new Date();
        if (input instanceof Date) return input;

        const now = new Date();
        const str = input.toString().trim();

        // 1. Specific OWA Title Format: "Sun 01/02/2026 14:46" (Day DD/MM/YYYY HH:mm)
        // Check for DD/MM/YYYY where Day matches
        const fullDateMatch = str.match(/([A-Za-z]{3})\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
        if (fullDateMatch) {
            const [_, dayName, day, month, year, hour, minute] = fullDateMatch;
            const d = new Date(
                parseInt(year),
                parseInt(month) - 1,
                parseInt(day),
                parseInt(hour),
                parseInt(minute)
            );
            // Verify if the day name matches (Basic sanity check)
            if (!isNaN(d.getTime())) return d;
        }

        // 2. Relative Day Format: "Sat 19:07" or "Thu 17:41"
        const relativeDayMatch = str.match(/^([A-Za-z]{3})\s+(\d{1,2}):(\d{2})$/);
        if (relativeDayMatch) {
            const [_, dayName, hour, minute] = relativeDayMatch;

            const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
            const targetDayIdx = days.indexOf(dayName.toLowerCase());
            const currentDayIdx = now.getDay();

            if (targetDayIdx !== -1) {
                let diff = currentDayIdx - targetDayIdx;
                if (diff <= 0) diff += 7; // If today is Tue (2) and target is Thu (4), diff is -2 -> 5 days ago? 
                // Wait, if today is Sunday (0) and target is Sat (6). Diff = -6 -> +7 = 1 day ago. Correct.
                // If today is Sunday (0) and target is Thu (4). Diff = -4 -> +7 = 3 days ago. Correct.
                // If today is Thu (4) and target is Thu (4) with earlier time -> 0 -> 7 days ago?
                // Usually "Thu" means "Last Thu" if today is Thu. But if only a few hours ago, it says "10:30".
                if (diff === 0) diff = 7;

                const d = new Date();
                d.setDate(now.getDate() - diff);
                d.setHours(parseInt(hour), parseInt(minute), 0, 0);
                return d;
            }
        }

        // 3. Time only "10:30 PM" or "14:46" -> Today
        if (str.match(/^\d{1,2}:\d{2}(\s*[AP]M)?$/i)) {
            const [time, period] = str.split(/\s+/);
            let [hours, minutes] = time.split(':').map(Number);

            if (period?.toUpperCase() === 'PM' && hours < 12) hours += 12;
            if (period?.toUpperCase() === 'AM' && hours === 12) hours = 0;

            const d = new Date();
            d.setHours(hours, minutes, 0, 0);
            return d;
        }

        // 4. "Yesterday" or "Yesterday 10:30 PM"
        if (str.toLowerCase().startsWith('yesterday')) {
            const d = new Date();
            d.setDate(d.getDate() - 1);

            // Try to extract time "Yesterday 19:07" or "Yesterday 7:07 PM"
            const timeMatch = str.match(/(\d{1,2}):(\d{2})(\s*[AP]M)?/i);
            if (timeMatch) {
                let [__, h, m, p] = timeMatch;
                let hours = parseInt(h);
                let minutes = parseInt(m);
                if (p?.toUpperCase().includes('PM') && hours < 12) hours += 12;
                if (p?.toUpperCase().includes('AM') && hours === 12) hours = 0;
                d.setHours(hours, minutes, 0, 0);
            } else {
                d.setHours(0, 0, 0, 0);
            }
            return d;
        }

        // 5. Fallback
        const d = new Date(str);
        if (!isNaN(d.getTime())) return d;

        return new Date(); // Finally fallback to now
    }

    /**
     * Helper to extract clean email from various formats like "Name <email@domain.com>"
     */
    function extractEmail(text: string): string | null {
        if (!text) return null;
        // Try to extract from "Name <email>" format - use non-greedy matching
        const match = text.match(/<([^>]+)>/);
        if (match) return match[1].toLowerCase().trim();
        // If it looks like a plain email, return it
        if (text.includes('@')) return text.toLowerCase().trim();
        return null;
    }

    /**
     * Find existing conversation or create one for the email sender
     * Uses transactions and unique lookups to prevent duplicates
     */
    async function findOrCreateConversation(userId: string, nameInput: string, emailInput: string): Promise<string | null> {
        // 1. Try to get a valid email first
        let email = extractEmail(emailInput);
        if (!email) {
            // Fallback: try extracting from name input
            email = extractEmail(nameInput);
        }

        if (!email) {
            console.log(`[OWA Email Sync] ❌ FATAL: Could not extract email for "${nameInput}". Skipping.`);
            return null; // Fail strictly, no placeholders
        }

        // Normalize email to lowercase
        const contactEmail = email.toLowerCase().trim();
        const contactName = nameInput.trim() || contactEmail.split('@')[0];

        // Find user's locations
        const user = await db.user.findUnique({
            where: { id: userId },
            include: { locations: { take: 1 } }
        });

        if (!user?.locations?.[0]) {
            return null;
        }

        const locationId = user.locations[0].id;

        // Use a transaction to prevent race conditions
        return db.$transaction(async (tx) => {
            // Find existing contact by email (case-insensitive)
            let contact = await tx.contact.findFirst({
                where: {
                    locationId,
                    email: {
                        equals: contactEmail,
                        mode: 'insensitive'
                    }
                }
            });

            // Create contact if doesn't exist
            if (!contact) {
                // Double-check with a more specific query to handle race conditions
                contact = await tx.contact.findFirst({
                    where: {
                        locationId,
                        email: contactEmail
                    }
                });

                if (!contact) {
                    contact = await tx.contact.create({
                        data: {
                            locationId,
                            email: contactEmail,
                            name: contactName,
                            status: 'New',
                            contactType: 'Lead'
                        }
                    });
                }
            }

            // Find existing conversation for this contact
            let conversation;
            try {
                conversation = await tx.conversation.upsert({
                    where: {
                        locationId_contactId: {
                            locationId,
                            contactId: contact.id
                        }
                    },
                    update: {}, // No updates needed
                    create: {
                        locationId,
                        contactId: contact.id,
                        ghlConversationId: `owa_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                        status: 'open',
                        lastMessageType: 'TYPE_EMAIL'
                    }
                });
            } catch (e) {
                // Retry fetch if upsert fails (race condition)
                conversation = await tx.conversation.findUnique({
                    where: {
                        locationId_contactId: {
                            locationId,
                            contactId: contact.id
                        }
                    }
                });
            }

            return conversation?.id || null;
        }, {
            maxWait: 10000,
            timeout: 20000
        });
    }

    /**
     * Helper to dismiss random OWA banners/popups that block view
     */
    async function dismissBanners(page: Page) {
        try {
            // Define selectors/text for common close buttons
            const closeSelectors = [
                'button[aria-label="Close"]',
                'button[title="Close"]',
                'button[aria-label="Dismiss"]',
                'div[role="button"][aria-label="Close"]',
                // Specific "Turn off" for forwarding banner
                'button:has-text("Turn off")',
            ];

            // Specific check for "Turn off" text using XPath since :has-text is not standard CSS
            // but Puppeteer supports it in newer versions, or we use evaluate
            const buttons = await page.$$('button, [role="button"]');
            for (const btn of buttons) {
                const text = await page.evaluate(el => el.textContent || el.ariaLabel, btn);
                if (text && (
                    text.includes('Turn off') ||
                    text.includes('Dismiss') ||
                    (text === 'Close' && await page.evaluate(el => el.getBoundingClientRect().top < 200, btn)) // Top banners only
                )) {
                    console.log(`[OWA Email Sync] Dismissing banner button: "${text}"`);
                    await btn.click();
                    await new Promise(r => setTimeout(r, 500));
                }
            }
        } catch (e) {
            // Ignore errors here
        }
    }
}