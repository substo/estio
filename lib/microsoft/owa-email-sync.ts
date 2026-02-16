import { Page } from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
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

    // Fetch user's Outlook email for direction detection
    const user = await db.user.findUnique({
        where: { id: userId },
        select: { outlookEmail: true }
    });
    const userEmail = user?.outlookEmail?.toLowerCase();
    console.log(`[OWA Email Sync] User email for direction check: ${userEmail || 'NOT SET'}`);

    let totalProcessed = 0;

    // Helper to setup listeners on a page
    const setupPageListeners = async (p: Page) => {
        // Set up request interception to capture OWA API responses
        await p.setRequestInterception(true);

        p.on('request', (request) => {
            if (request.isInterceptResolutionHandled()) return;
            request.continue();
        });

        // We only use API interception for "bonus" items, but main logic is DOM scraping
        // The DOM scraper is the source of truth for the sequential process.
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

            console.log(`[OWA Email Sync] Performing search for: ${searchQuery}`);
            try {
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

        console.log('[OWA Email Sync] Starting SEQUENTIAL processing...');
        totalProcessed = await processEmailsSequentially(page, searchQuery);

        console.log(`[OWA Email Sync] Processed ${totalProcessed} emails`);

        return totalProcessed;

    } finally {
        await page.close();

        // Update Sync State
        if (totalProcessed > 0 || folderId === 'inbox') {
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

    async function processEmailsSequentially(page: Page, searchQuery?: string): Promise<number> {
        const startTime = Date.now();
        const TIMEOUT_MS = 250 * 1000; // 4 minutes 10 seconds (leave buffer for cleanup before 5m limit)

        let count = 0;
        const processedMap = new Map<string, boolean>();

        // STEP 0: Fetch Last Sync Time for Incremental Stop
        let cutoffDate: Date | null = null;
        if (!searchQuery) {
            try {
                const syncState = await db.outlookSyncState.findUnique({ where: { userId } });
                if (syncState?.lastSyncedAt) {
                    cutoffDate = new Date(syncState.lastSyncedAt.getTime() - 24 * 60 * 60 * 1000);
                    console.log(`[OWA Email Sync Debug] Incremental Sync Enabled. Cutoff: ${cutoffDate.toISOString()}`);
                }
            } catch (e) { console.warn('Failed to load sync state for incremental check', e); }
        }

        // STEP 1: Scroll to TOP
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
        await new Promise(r => setTimeout(r, 2000));

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
        let emailsOlderThanCutoff = 0;

        while (scrollAttempts < maxScrolls) {
            // TIMEOUT CHECK
            if (Date.now() - startTime > TIMEOUT_MS) {
                console.log(`[OWA Email Sync] Time limit reached (${(Date.now() - startTime) / 1000}s). Stopping sync to ensure cleanup.`);
                break;
            }

            // Track count before batch
            const countBeforeBatch = count;

            // Get all visible rows count
            const rowCount = await page.evaluate(() => document.querySelectorAll('div[role="option"]').length);
            console.log(`[OWA Email Sync Debug] Found ${rowCount} visible rows on scroll ${scrollAttempts}. Total processed: ${count}/${totalEmails || '?'}`);

            for (let i = 0; i < rowCount; i++) {
                try {
                    // Re-query the specific row to avoid detached node errors
                    const rowHandles = await page.$$('div[role="option"]');
                    const rowHandle = rowHandles[i];

                    if (!rowHandle) {
                        continue;
                    }

                    // Extract basic info first
                    const basicInfo = await page.evaluate(el => {
                        const id = el.getAttribute('data-convid') || el.id || '';

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

                    if (!basicInfo.id) basicInfo.id = Math.random().toString(36);

                    if (processedMap.has(basicInfo.id)) continue;
                    processedMap.set(basicInfo.id, true);

                    // --- INCREMENTAL SYNC CHECK ---
                    const emailDate = parseSafeDate(basicInfo.dateStr);
                    if (cutoffDate) {
                        if (emailDate < cutoffDate) {
                            emailsOlderThanCutoff++;
                            console.log(`[OWA Email Sync Debug] Found old email (${basicInfo.dateStr} -> ${emailDate.toISOString()}). Consecutive: ${emailsOlderThanCutoff}`);
                            if (emailsOlderThanCutoff >= 5) {
                                console.log(`[OWA Email Sync] Hit 5 consecutive emails older than ${cutoffDate.toISOString()}. Stopping sync.`);
                                scrollAttempts = maxScrolls + 100; // Break outer loop
                                break; // Break inner loop
                            }
                            continue; // Skip processing this specific old email
                        } else {
                            emailsOlderThanCutoff = 0;
                        }
                    }

                    // --- REMOVED PROACTIVE EXISTENCE CHECK ---
                    // Per user request, we do NOT skip emails based on list info alone.
                    // We must click and load the full body to validly check duplication.
                    console.log(`[OWA Email Sync] Processing NEW email: "${basicInfo.subject}" (Sender: ${basicInfo.sender})...`);

                    // --- PROCESS NEW EMAIL ---
                    let fullBody = '';
                    try {
                        // Click the row
                        await new Promise(r => setTimeout(r, 500));

                        // Check if detached and refetch if needed
                        let isDetached = await rowHandle.evaluate(node => !node.isConnected);

                        if (isDetached) {
                            console.log(`[OWA Email Sync Debug] Row detached before click, attempting refetch for id="${basicInfo.id}"`);
                            // Try to find by data-convid again
                            const newHandle = await page.$(`div[role="option"][data-convid="${basicInfo.id}"]`);
                            if (newHandle) {
                                await newHandle.click();
                            } else {
                                throw new Error('Refetch failed, node detached permanently');
                            }
                        } else {
                            await rowHandle.click();
                        }

                        // Wait for UI to react
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
                            console.warn('[OWA Email Sync] Warning: Timed out waiting for subject match. Proceeding...');
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

                            // 1. Check known elements
                            const candidates = Array.from(container.querySelectorAll(
                                '.ms-Persona-secondaryText, div[id^="Persona"] span[dir="ltr"], .fui-Avatar, .lpcCommonWeb-hoverTarget, a[href^="mailto:"]'
                            ));

                            for (const el of candidates) {
                                let text = el.textContent || '';
                                let match = text.match(emailRegex);
                                if (match) return match[1].toLowerCase();
                                const labels = [el.getAttribute('title'), el.getAttribute('aria-label'), el.getAttribute('href')];
                                for (const label of labels) {
                                    if (label) {
                                        match = label.match(emailRegex);
                                        if (match) return match[1].toLowerCase();
                                    }
                                }
                            }

                            // 2. Scan attributes
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

                        // Hover Strategy if missing
                        if (!senderEmail) {
                            const hoverSuccess = await page.evaluate(() => {
                                const targets = [
                                    document.querySelector('#ReadingPaneContainerId div[role="heading"] span'),
                                    document.querySelector('.ms-Persona-primaryText'),
                                    document.querySelector('.fui-Avatar')
                                ];
                                for (const target of targets) {
                                    if (target) {
                                        const rect = target.getBoundingClientRect();
                                        if (rect.width > 0 && rect.height > 0) {
                                            const mouseOver = new MouseEvent('mouseover', {
                                                bubbles: true, cancelable: true, view: window, clientX: rect.x + 5, clientY: rect.y + 5
                                            });
                                            target.dispatchEvent(mouseOver);
                                            return true;
                                        }
                                    }
                                }
                                return false;
                            });

                            if (hoverSuccess) {
                                await new Promise(r => setTimeout(r, 2000));
                                senderEmail = await page.evaluate(() => {
                                    const card = document.querySelector('.ms-Persona-secondaryText') ||
                                        document.querySelector('div[id^="Persona"] span[dir="ltr"]');
                                    return card?.textContent?.trim().toLowerCase() || '';
                                });
                            }
                        }
                    } catch (emailErr) {
                        console.warn('[OWA Email Sync] Failed to extract sender email:', emailErr);
                    }

                    // --- LOGGING FOR DEBUGGING ---
                    try {
                        // Default to log directory in project root
                        const logDir = process.env.OUTLOOK_LOG_DIR || path.join(process.cwd(), 'logs', 'outlook');

                        // Ensure directory exists
                        if (!fs.existsSync(logDir)) {
                            fs.mkdirSync(logDir, { recursive: true });
                        }

                        const logData = {
                            timestamp: new Date().toISOString(),
                            step: 'Post-Click Analysis',
                            basicInfo, // List view data
                            extracted: {
                                senderEmail,
                                subject: basicInfo.subject, // Current subject
                                bodyPreview: fullBody ? fullBody.substring(0, 200) + '...' : '', // First 200 chars
                                fullBodyLength: fullBody ? fullBody.length : 0,
                                isDetached: await rowHandle.evaluate(node => !node.isConnected)
                            },
                            computed: {
                                emailDate,
                                direction: isUserOwnEmail(senderEmail, userEmail) ? 'outbound' : 'inbound'
                            }
                        };

                        const safeSubject = (basicInfo.subject || 'no_subject').replace(/[^a-z0-9]/gi, '_').substring(0, 50);
                        const filename = `${new Date().toISOString().replace(/:/g, '-')}_${safeSubject}.json`;
                        fs.writeFileSync(path.join(logDir, filename), JSON.stringify(logData, null, 2));

                    } catch (logErr) {
                        console.warn('[OWA Email Sync] Failed to write debug log:', logErr);
                    }

                    // Save Email
                    await processOWAEmail(userId, {
                        id: basicInfo.id,
                        subject: basicInfo.subject || '(No Subject)',
                        sender: basicInfo.sender || 'Unknown',
                        senderEmail: senderEmail,
                        preview: basicInfo.preview,
                        fullBody: fullBody || basicInfo.preview,
                        date: emailDate,
                        isRead: !basicInfo.ariaLabel.includes('Unread'),
                        hasAttachments: false
                    }, folderId, userEmail);

                    count++;

                } catch (e) {
                    console.log('[OWA Email Sync] Error processing row', e);
                    continue;
                }
            }

            // Check if we collected all (early exit)
            if (totalEmails > 0 && count >= totalEmails) {
                console.log(`[OWA Email Sync] Processed all ${count} emails. Done!`);
                break;
            }

            // Track consecutive empty batches
            const newEmailsThisBatch = count - countBeforeBatch;
            if (newEmailsThisBatch === 0) {
                consecutiveEmptyBatches++;
                if (consecutiveEmptyBatches >= 3) {
                    console.log('[OWA Email Sync] 3 consecutive empty batches. Stopping.');
                    break;
                }
            } else {
                consecutiveEmptyBatches = 0;
            }

            // Scroll Logic
            const diagnostics = await page.evaluate(() => {
                const allScrollBars = document.querySelectorAll('.customScrollBar');
                const results: any[] = [];
                allScrollBars.forEach((el, i) => {
                    const htmlEl = el as HTMLElement;
                    results.push({
                        index: i,
                        canScroll: htmlEl.scrollHeight > htmlEl.clientHeight,
                        scrollHeight: htmlEl.scrollHeight
                    });
                });
                return results;
            });

            const scrollableIndex = diagnostics.findIndex(d => d.canScroll && d.scrollHeight > 500);

            if (scrollableIndex === -1) {
                await page.mouse.wheel({ deltaY: 500 });
                await new Promise(r => setTimeout(r, 2000));
                scrollAttempts++;
                continue;
            }

            await page.evaluate((idx) => {
                const el = document.querySelectorAll('.customScrollBar')[idx] as HTMLElement;
                if (el) el.scrollTop += el.clientHeight;
            }, scrollableIndex);

            await new Promise(r => setTimeout(r, 2500));
            scrollAttempts++;
        }

        return count;
    }

    /**
     * Check if senderEmail matches the user's own Outlook email
     */
    function isUserOwnEmail(senderEmail: string | undefined, userEmail: string | undefined): boolean {
        if (!userEmail || !senderEmail) return false;
        return senderEmail.toLowerCase().trim() === userEmail.toLowerCase().trim();
    }

    async function processOWAEmail(userId: string, email: OWAEmail, folderId: string, userEmail: string | undefined) {
        try {
            const conversationId = await findOrCreateConversation(userId, email.sender, email.senderEmail);
            if (!conversationId) return;

            let emailDate = email.date;
            if (isNaN(emailDate.getTime())) emailDate = new Date();

            // Check for existing message with body comparison
            const candidates = await db.message.findMany({
                where: {
                    conversationId,
                    subject: email.subject,
                    createdAt: {
                        gte: new Date(emailDate.getTime() - 60000),
                        lte: new Date(emailDate.getTime() + 60000)
                    }
                }
            });

            // Strict duplication check: Subject + Date + Body must match
            // We compare normalized bodies to be safe against minor whitespace differences
            const normalize = (s: string) => s?.replace(/\s+/g, ' ').trim() || '';
            const newBody = normalize(email.fullBody || email.preview);

            const existing = candidates.find(msg => {
                const existingBody = normalize(msg.body || '');
                // 1. Exact/Normalized match
                if (existingBody === newBody) return true;
                // 2. Substring match (sometimes new scrape has extra wrappers)
                if (existingBody.includes(newBody) || newBody.includes(existingBody)) {
                    // Only if length is significant to avoid false positives on short bodies
                    if (existingBody.length > 50 && newBody.length > 50) return true;
                }
                return false;
            });

            if (existing) {
                console.log(`[OWA Email Sync] Skipping duplicate email (Body Match): "${email.subject}"`);
                return;
            }

            // Determine direction: sender-based with folder fallback
            const isOwnEmail = isUserOwnEmail(email.senderEmail, userEmail);
            // If we couldn't extract sender email, use folder as fallback
            const direction = email.senderEmail
                ? (isOwnEmail ? 'outbound' : 'inbound')
                : (folderId === 'inbox' ? 'inbound' : 'outbound');

            console.log(`[OWA Email Sync Debug] Sender: ${email.senderEmail || 'UNKNOWN'}, UserEmail: ${userEmail || 'NOT SET'} → Direction: ${direction}`);

            await db.message.create({
                data: {
                    conversationId,
                    direction,
                    type: 'EMAIL',
                    status: 'delivered',
                    body: email.fullBody || email.preview,
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

        // 1. Specific OWA Title Format: "Sun 01/02/2026 14:46"
        const fullDateMatch = str.match(/([A-Za-z]{3})\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
        if (fullDateMatch) {
            const [_, dayName, day, month, year, hour, minute] = fullDateMatch;
            const d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));
            if (!isNaN(d.getTime())) return d;
        }

        // 2. Relative Day Format: "Sat 19:07"
        const relativeDayMatch = str.match(/^([A-Za-z]{3})\s+(\d{1,2}):(\d{2})$/);
        if (relativeDayMatch) {
            const [_, dayName, hour, minute] = relativeDayMatch;
            const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
            const targetDayIdx = days.indexOf(dayName.toLowerCase());
            const currentDayIdx = now.getDay();

            if (targetDayIdx !== -1) {
                let diff = currentDayIdx - targetDayIdx;
                if (diff <= 0) diff += 7;
                if (diff === 0) diff = 7;

                const d = new Date();
                d.setDate(now.getDate() - diff); // Fix: use setDate properly
                d.setHours(parseInt(hour), parseInt(minute), 0, 0);
                return d;
            }
        }

        // 3. Time only "10:30 PM"
        if (str.match(/^\d{1,2}:\d{2}(\s*[AP]M)?$/i)) {
            const [time, period] = str.split(/\s+/);
            let [hours, minutes] = time.split(':').map(Number);
            if (period?.toUpperCase() === 'PM' && hours < 12) hours += 12;
            if (period?.toUpperCase() === 'AM' && hours === 12) hours = 0;
            const d = new Date();
            d.setHours(hours, minutes, 0, 0);
            return d;
        }

        // 4. "Yesterday"
        if (str.toLowerCase().startsWith('yesterday')) {
            const d = new Date();
            d.setDate(d.getDate() - 1);
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

        return new Date();
    }

    function extractEmail(text: string): string | null {
        if (!text) return null;
        const match = text.match(/<([^>]+)>/);
        if (match) return match[1].toLowerCase().trim();
        if (text.includes('@')) return text.toLowerCase().trim();
        return null;
    }

    async function findOrCreateConversation(userId: string, nameInput: string, emailInput: string, silent: boolean = false): Promise<string | null> {
        let email = extractEmail(emailInput);
        if (!email) {
            email = extractEmail(nameInput);
        }

        if (!email) {
            if (!silent) console.log(`[OWA Email Sync] ❌ FATAL: Could not extract email for "${nameInput}". Skipping.`);
            return null;
        }

        const contactEmail = email.toLowerCase().trim();
        const contactName = nameInput.trim() || contactEmail.split('@')[0];

        const user = await db.user.findUnique({
            where: { id: userId },
            include: { locations: { take: 1 } }
        });

        if (!user?.locations?.[0]) {
            return null;
        }

        const locationId = user.locations[0].id;

        return db.$transaction(async (tx) => {
            let contact = await tx.contact.findFirst({
                where: {
                    locationId,
                    email: { equals: contactEmail, mode: 'insensitive' }
                }
            });

            if (!contact) {
                contact = await tx.contact.findFirst({
                    where: { locationId, email: contactEmail }
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

            let conversation;
            try {
                conversation = await tx.conversation.upsert({
                    where: {
                        locationId_contactId: { locationId, contactId: contact.id }
                    },
                    update: {},
                    create: {
                        locationId,
                        contactId: contact.id,
                        ghlConversationId: `owa_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                        status: 'open',
                        lastMessageType: 'TYPE_EMAIL'
                    }
                });
            } catch (e) {
                conversation = await tx.conversation.findUnique({
                    where: {
                        locationId_contactId: { locationId, contactId: contact.id }
                    }
                });
            }

            return conversation?.id || null;
        }, { maxWait: 10000, timeout: 20000 });
    }

    async function dismissBanners(page: Page) {
        try {
            const buttons = await page.$$('button, [role="button"]');
            for (const btn of buttons) {
                const text = await page.evaluate(el => el.textContent || el.ariaLabel, btn);
                if (text && (
                    text.includes('Turn off') ||
                    text.includes('Dismiss') ||
                    (text === 'Close' && await page.evaluate(el => el.getBoundingClientRect().top < 200, btn))
                )) {
                    await btn.click();
                    await new Promise(r => setTimeout(r, 500));
                }
            }
        } catch (e) { }
    }
}