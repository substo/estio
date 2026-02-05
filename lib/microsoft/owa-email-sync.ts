import { Page } from 'puppeteer';
import db from '@/lib/db';
import { outlookPuppeteerService } from './outlook-puppeteer';

interface OWAEmail {
    id: string;
    subject: string;
    sender: string;
    senderEmail: string;
    preview: string;
    date: Date;
    isRead: boolean;
    hasAttachments: boolean;
}

/**
 * Sync emails from Outlook Web Access using Puppeteer
 * This intercepts OWA's internal API calls for reliable data extraction
 */
export async function syncEmailsFromOWA(userId: string, folderId: 'inbox' | 'sentitems' | 'search' = 'inbox', searchQuery?: string) {
    console.log(`[OWA Email Sync] Starting sync for user ${userId}, folder/mode ${folderId}`);

    // Load or refresh session
    let { valid, page } = await outlookPuppeteerService.loadSession(userId);

    if (!valid) {
        console.log('[OWA Email Sync] Session invalid, attempting refresh...');
        const refreshResult = await outlookPuppeteerService.refreshSession(userId);
        if (!refreshResult.success || !refreshResult.page) {
            throw new Error('Session expired and could not be refreshed. Please reconnect.');
        }
        // Use the page directly from refreshSession - it's already on OWA
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

        // Listen for OWA API responses
        p.on('response', async (response) => {
            const url = response.url();
            const contentType = response.headers()['content-type'] || '';

            // Debug: Log interesting JSON traffic to help identify the correct API
            if (contentType.includes('application/json') &&
                (url.includes('outlook.live.com') || url.includes('outlook.office.com')) &&
                !url.includes('log') && !url.includes('telemetry')) {

                // console.log(`[OWA Email Sync Debug] API Response detected: ${url}`);
            }

            // OWA uses various API endpoints for mail
            // Enhanced to catch more potential endpoints (FindItem, GetItem, Search)
            if (url.includes('/owa/') && (
                url.includes('action=FindItem') ||
                url.includes('action=GetItem') ||
                url.includes('service.svc')
            )) {
                try {
                    const data = await response.json();

                    // Strategy 1: FindItem Response (standard)
                    if (data?.Body?.ResponseMessages?.Items) {
                        extractFromFindItemResponse(data);
                    }
                    // Strategy 2: Search Response (if different)
                    else if (data?.Body?.EnumerateSuggestions) {
                        // Sometimes search comes differently
                    }
                } catch (e) {
                    // Not all responses are JSON
                }
            }
        });

        // Extracted logic for handling API response
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
                            date: new Date(msg.DateTimeReceived || msg.DateTimeCreated),
                            isRead: msg.IsRead || false,
                            hasAttachments: msg.HasAttachments || false
                        });
                    }
                }
            }
        }
    };

    // Helper to check and restore session
    const ensureOWASession = async () => {
        let attempts = 0;
        const maxAttempts = 3;
        let onOWA = false;

        while (attempts < maxAttempts && !onOWA) {
            // Check if page is closed or invalid
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
            const isMarketingPage = currentUrl.includes('microsoft.com') && !currentUrl.includes('outlook.live.com');

            // Detect Auth/Login Page (e.g. login.microsoftonline.com with email input)
            // Use try-catch for selector check to avoid race conditions if page closes
            let hasEmailInput = false;
            try {
                hasEmailInput = (await page.$('input[name="loginfmt"]')) !== null;
            } catch (e) { }

            const isAuthPage = currentUrl.includes('login.microsoftonline.com') || currentUrl.includes('oauth') || hasEmailInput;

            if (isAuthPage) {
                console.log(`[OWA Email Sync] Detected Auth/Login Page. URL: ${currentUrl}`);
                console.log('[OWA Email Sync] Session appears invalid. Attempting to refresh session IN-PLACE...');

                // Trigger full re-login flow using EXISTING PAGE
                const refreshResult = await outlookPuppeteerService.refreshSession(userId, page);

                if (refreshResult.success && refreshResult.page) {
                    console.log('[OWA Email Sync] Session refreshed successfully. Page is ready to use.');
                    // Page is already on OWA after login - use it directly
                    page = refreshResult.page;
                    await setupPageListeners(page);
                    // Continue loop to verify we're on OWA
                    attempts++;
                    continue;
                } else {
                    console.error('[OWA Email Sync] Failed to refresh session (invalid credentials or MFA).');
                    // Break loop to fall through to error
                    break;
                }
            }

            if (isMarketingPage) {
                console.log(`[OWA Email Sync] Detected Marketing Page Redirect (Attempt ${attempts + 1}/${maxAttempts}). URL: ${currentUrl}`);

                const signInSelectors = [
                    '#c-shellmenu_custom_outline_signin_bhvr100_right',
                    'a[data-m*="Sign in"]',
                    'a[href*="deeplink"]',
                    'a[href*="outlook"]',
                    '.c-uhf-nav-link'
                ];

                let clicked = false;
                for (const selector of signInSelectors) {
                    const btn = await page.$(selector);
                    if (btn) {
                        const text = await page.evaluate(el => el.textContent, btn);
                        if (text?.toLowerCase().includes('sign in') || selector.includes('signin')) {
                            console.log(`[OWA Email Sync] Clicking Sign In button: ${selector} ("${text}")`);

                            // CRITICAL: Remove target="_blank" to force open in SAME TAB
                            await page.evaluate(el => el.removeAttribute('target'), btn);

                            await btn.click();
                            clicked = true;
                            // Wait for nav
                            await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }).catch(() => { });
                            break;
                        }
                    }
                }

                if (!clicked) {
                    console.warn('[OWA Email Sync] Could not find a recognizable Sign In button on marketing page.');
                }
            } else {
                // STRICT OWA CHECK
                const isOutlookDomain = currentUrl.includes('outlook.live.com') || currentUrl.includes('outlook.office.com') || currentUrl.includes('/mail/');
                // Check for main app elements - OWA uses role="main", "application", "tree", "grid"
                const owaElement = await page.$('#app [role="tree"], #app [role="grid"], div[data-app-section="Mail"], [role="main"], [role="application"], #app');

                if (isOutlookDomain && owaElement) {
                    console.log(`[OWA Email Sync] Confirmed OWA loaded successfully${attempts > 0 ? ' after refresh' : ''}.`);
                    onOWA = true;
                } else {
                    console.log(`[OWA Email Sync] Not on Marketing page, but strict OWA check failed. URL: ${currentUrl}`);
                    // Only refresh if we haven't maxed out
                    if (attempts < maxAttempts - 1) {
                        console.log('[OWA Email Sync] Refreshing page...');
                        await page.reload({ waitUntil: 'domcontentloaded' });
                        await new Promise(r => setTimeout(r, 5000));
                    }
                }
            }
            attempts++;
            if (!onOWA && attempts < maxAttempts) {
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        if (!onOWA) {
            console.error('[OWA Email Sync] Failed to reach OWA Inbox after multiple attempts. Aborting sync.');
        }
    };

    // Helper to determine active base URL (Live vs Office)
    const getBaseUrl = () => {
        if (!page) return 'https://outlook.live.com/mail/0';
        const url = page.url();
        if (url.includes('outlook.office.com') || url.includes('outlook.office365.com')) {
            return 'https://outlook.office.com/mail/0';
        }
        return 'https://outlook.live.com/mail/0';
    };

    try {
        // Initial Listener Setup
        await setupPageListeners(page);

        const baseUrl = getBaseUrl();

        // Navigate based on mode
        if (folderId === 'search' && searchQuery) {
            const targetUrl = `${baseUrl}/inbox`;

            // Only navigate if not already there
            if (!page.url().includes('/inbox')) {
                // Use domcontentloaded as networkidle0 is unreliable on OWA SPA
                await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                // Give it a moment to stabilize
                await new Promise(r => setTimeout(r, 2000));
            }

            // Check Session
            await ensureOWASession();

            // Dismiss potential popups/banners (e.g. "Forwarding Email... Turn off")
            await dismissBanners(page);

            // Perform Search
            console.log(`[OWA Email Sync] Performing search for: ${searchQuery}`);
            try {
                const searchButton = await page.$('button[aria-label="Search"]');
                const isInputVisible = await page.$('#topSearchInput');

                if (isInputVisible) {
                    await isInputVisible.click();
                } else if (searchButton) {
                    await searchButton.click();
                    await new Promise(r => setTimeout(r, 1000));
                }

                const searchInputSelectors = [
                    '#topSearchInput',
                    'input[aria-label="Search"]',
                    'input[placeholder="Search"]',
                    '[role="search"] input'
                ];

                let searchInputFound = false;
                for (const selector of searchInputSelectors) {
                    try {
                        const input = await page.waitForSelector(selector, { timeout: 3000 });
                        if (input) {
                            await input.click({ count: 3 }); // Select all text
                            await page.keyboard.press('Backspace'); // Clear it
                            await new Promise(r => setTimeout(r, 500));

                            await page.type(selector, searchQuery, { delay: 50 }); // Type slower
                            await new Promise(r => setTimeout(r, 500));
                            await page.keyboard.press('Enter');

                            searchInputFound = true;
                            console.log(`[OWA Email Sync] Search triggered using selector: ${selector}`);
                            break;
                        }
                    } catch (e) { }
                }

                if (!searchInputFound) {
                    console.log('[OWA Email Sync] Could not find search input, trying generic keyboard interaction...');
                    await page.keyboard.type(searchQuery);
                    await page.keyboard.press('Enter');
                }

                // Wait for results
                await new Promise(r => setTimeout(r, 3000)); // Grace period
            } catch (e) {
                console.error('[OWA Email Sync] Search failed:', e);
            }

        } else {
            // Standard Folder Navigation
            const suffix = folderId === 'sentitems' ? 'sentitems' : 'inbox';
            const folderUrl = `${baseUrl}/${suffix}`;

            if (!page.url().includes(`/${suffix}`)) {
                await page.goto(folderUrl, { waitUntil: 'networkidle0', timeout: 30000 });
            }

            // Check Session
            await ensureOWASession();
            await dismissBanners(page);
        }

        // Wait for emails to load (listbox is the email list container)
        await page.waitForSelector('[role="listbox"]', { timeout: 10000 }).catch(() => { });

        // If API interception didn't catch emails, fall back to DOM scraping
        if (emails.length === 0) {
            console.log('[OWA Email Sync] API interception did not capture emails, trying DOM scraping...');
            const scrapedEmails = await scrapeEmailsFromDOM(page, searchQuery);
            emails.push(...scrapedEmails);

            // Detailed Debugging
            if (emails.length === 0) {
                const title = await page.title();
                const url = await page.url();
                const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500).replace(/\n/g, ' '));
                console.log(`[OWA Email Sync Debug] Found 0 emails. Current State: Title="${title}", URL="${url}"`);
                console.log(`[OWA Email Sync Debug] Body Preview: ${bodyText}`);

                // Take a screenshot for debugging
                try {
                    const screenshotPath = `owa_sync_debug_${Date.now()}.png`;
                    await page.screenshot({ path: screenshotPath });
                    console.log(`[OWA Email Sync Debug] Saved screenshot to ${screenshotPath}`);
                } catch (e) {
                    console.error('[OWA Email Sync Debug] Failed to save screenshot:', e);
                }
            } else {
                console.log(`[OWA Email Sync Debug] Successfully scraped ${emails.length} emails.`);
            }
        }

        console.log(`[OWA Email Sync] Found ${emails.length} emails`);

        // Process found emails
        for (const email of emails) {
            console.log(`[OWA Email Sync Debug] Processing Email:
  Sender: "${email.sender}"
  Subject: "${email.subject}"
  Date Raw: "${email.date}"
  Sender Email: "${email.senderEmail}"`);

            await processOWAEmail(userId, email, folderId);
        }

        return emails.length;

    } finally {
        // Close page first
        await page.close();

        // Update Sync State (Last Synced At)
        if (emails.length > 0 || folderId === 'inbox') {
            try {
                await db.outlookSyncState.upsert({
                    where: { userId },
                    create: {
                        userId,
                        emailAddress: 'puppeteer-session', // Placeholder or fetch real email if available
                        lastSyncedAt: new Date()
                    },
                    update: {
                        lastSyncedAt: new Date()
                    }
                });
            } catch (e) {
                console.error('[OWA Email Sync] Failed to update sync state:', e);
            }
        }
    }

    /**
     * Fallback: Scrape emails from OWA DOM
     */
    async function scrapeEmailsFromDOM(page: Page, searchQuery?: string): Promise<OWAEmail[]> {
        const emails: OWAEmail[] = [];
        const scrapedMap = new Map<string, boolean>();

        // Extract email from search query if possible
        let targetEmail = '';
        if (searchQuery && searchQuery.includes('@')) {
            // Include = sign for mailgun-style forwarding addresses like info=domain.com@mg.domain.com
            const match = searchQuery.match(/([a-zA-Z0-9._=+-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/);
            if (match) targetEmail = match[0];
        }

        // Helper to scrape currently visible items
        const scrapeVisible = async (): Promise<any[]> => {
            return await page.evaluate((defaultEmail) => {
                const items: any[] = [];
                // SELECTOR REFERENCE (Updated from User HTML Dump):
                // Container: div[role="listbox"]
                // Item: div[role="option"]
                // Sender Name: span[title="..."] inside div.JBWmn or .fui-Avatar[aria-label]
                // Subject: span.TtcXM (text or title)
                // Preview: span.FqgPc
                // Date: span._rWRU[title="Sun 01/02/2026 14:46"] -> Exact timestamp!

                const rows = document.querySelectorAll('div[role="option"]');

                rows.forEach((row: any) => {
                    const id = row.getAttribute('data-convid') || row.id || Math.random().toString(36);
                    const ariaLabel = row.getAttribute('aria-label') || '';

                    // --- STRATEGY 1: Specific Selectors (Best Accuracy) ---
                    let sender = '';
                    let subject = '';
                    let preview = '';
                    let dateStr = '';
                    let senderEmail = defaultEmail || '';

                    // 1. Sender
                    const senderEl = row.querySelector('div.JBWmn span') || row.querySelector('.fui-Avatar');
                    sender = senderEl?.getAttribute('title') || senderEl?.getAttribute('aria-label') || '';

                    // 2. Subject
                    const subjectEl = row.querySelector('span.TtcXM');
                    subject = subjectEl?.innerText?.trim() || subjectEl?.getAttribute('title') || '';

                    // 3. Preview
                    const previewEl = row.querySelector('span.FqgPc');
                    preview = previewEl?.innerText?.trim() || '';

                    // 4. Date (Critical: The title attribute has the full date!)
                    // value example: "Sun 01/02/2026 14:46"
                    const dateEl = row.querySelector('span._rWRU');
                    dateStr = dateEl?.getAttribute('title') || dateEl?.innerText?.trim() || '';

                    // 5. Sender Email extraction
                    // Try to extract from title="Name <email>" if present in other elements
                    if (!senderEmail || !senderEmail.includes('@')) {
                        const emailInTitle = row.querySelector('[title*="@"]');
                        if (emailInTitle) {
                            const title = emailInTitle.getAttribute('title') || '';
                            const match = title.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/);
                            if (match) senderEmail = match[1];
                        }
                    }

                    // Fallback: If specific selectors fail (class names change), parse aria-label
                    if (!sender && ariaLabel) {
                        const fromMatch = ariaLabel.match(/From\s+([^,]+),/i);
                        if (fromMatch) sender = fromMatch[1].trim();
                    }
                    if (!subject && ariaLabel) {
                        const subMatch = ariaLabel.match(/Subject\s+([^,]+),/i);
                        if (subMatch) subject = subMatch[1].trim();
                    }

                    // Final fallback values
                    if (!sender) sender = 'Unknown';
                    if (!subject) subject = '(No Subject)';

                    items.push({
                        id,
                        subject,
                        sender,
                        senderEmail,
                        preview: preview.substring(0, 200),
                        date: dateStr, // Pass the raw title string, e.g., "Sun 01/02/2026 14:46"
                        isRead: !ariaLabel.includes('Unread'),
                        hasAttachments: !!row.querySelector('i[data-icon-name="Attach"]')
                    });
                });
                return items;
            }, targetEmail);
        };

        let scrollAttempts = 0;
        const maxScrolls = 5;

        while (scrollAttempts < maxScrolls) {
            const visibleItems = await scrapeVisible();
            let newItemsCount = 0;

            for (const item of visibleItems) {
                if (!scrapedMap.has(item.id)) {
                    scrapedMap.set(item.id, true);
                    // Use improved date parser
                    emails.push({
                        ...item,
                        date: parseSafeDate(item.date)
                    });
                    newItemsCount++;
                }
            }

            console.log(`[OWA Email Sync Debug] Scroll ${scrollAttempts}: Found ${visibleItems.length} visible, ${newItemsCount} new.`);

            if (newItemsCount === 0 && scrollAttempts > 0) {
                console.log('[OWA Email Sync] No new items found after scroll. Stopping.');
                break;
            }

            // Perform Scroll
            // Selector from HTML: class="customScrollBar"
            const scrollable = await page.$('.customScrollBar') || await page.$('div[role="listbox"]');
            if (scrollable) {
                await page.evaluate(el => {
                    el.scrollTop += el.clientHeight;
                }, scrollable);
                await new Promise(r => setTimeout(r, 1500));
            } else {
                console.log('[OWA Email Sync] Could not find scrollable container. Stopping.');
                break;
            }

            scrollAttempts++;
        }

        console.log(`[OWA Email Sync Debug] Successfully scraped ${emails.length} emails (unique).`);
        return emails;
    }

    /**
     * Process and save a single OWA email
     */
    async function processOWAEmail(userId: string, email: OWAEmail, folderId: string) {
        try {
            // Find or create conversation based on sender email
            const conversationId = await findOrCreateConversation(userId, email.senderEmail || email.sender);

            if (!conversationId) {
                console.log(`[OWA Email Sync] Skipping email - no conversation for ${email.senderEmail}`);
                return;
            }

            // Sanitize Date
            let emailDate = parseSafeDate(email.date);
            if (isNaN(emailDate.getTime())) {
                console.log(`[OWA Email Sync] Invalid date detected: "${email.date}". Defaulting to now.`);
                emailDate = new Date();
            }

            // Check if we already have this email (by subject + date combo)
            const existing = await db.message.findFirst({
                where: {
                    conversationId,
                    subject: email.subject,
                    createdAt: {
                        gte: new Date(emailDate.getTime() - 60000), // +/- 1 min
                        lte: new Date(emailDate.getTime() + 60000)
                    }
                }
            });

            if (existing) {
                return; // Skip duplicate
            }

            // Create message
            await db.message.create({
                data: {
                    conversationId,
                    direction: folderId === 'inbox' ? 'inbound' : 'outbound',
                    type: 'EMAIL',
                    status: 'delivered',
                    body: email.preview,
                    subject: email.subject,
                    emailFrom: email.senderEmail || email.sender,
                    createdAt: emailDate
                }
            });

            console.log(`[OWA Email Sync] Saved email: ${email.subject}`);

            // --- GHL SYNC ---
            // Push to GHL if connected
            try {
                // Fetch full conversation to get contactId and locationId
                const conversation = await db.conversation.findUnique({ where: { id: conversationId } });

                if (conversation) {
                    // We need the contact's ID to sync to GHL
                    const contact = await db.contact.findUnique({ where: { id: conversation.contactId } });
                    const location = await db.location.findUnique({ where: { id: conversation.locationId } });

                    if (contact && location?.ghlAccessToken && location?.ghlLocationId) {
                        const { createInboundMessage } = await import('@/lib/ghl/conversations');
                        const { ensureRemoteContact } = await import('@/lib/crm/contact-sync');

                        // Ensure GHL Contact exists
                        let ghlContactId = contact.ghlContactId;
                        if (!ghlContactId) {
                            ghlContactId = await ensureRemoteContact(contact.id, location.ghlLocationId, location.ghlAccessToken);
                        }

                        if (ghlContactId) {
                            await createInboundMessage(location.ghlAccessToken, {
                                type: 'Email',
                                contactId: ghlContactId,
                                direction: folderId === 'inbox' ? 'inbound' : 'outbound',
                                status: 'delivered',
                                subject: email.subject,
                                html: email.preview, // OWA scraper currently only gets preview text, not full body HTML
                                emailFrom: email.senderEmail || undefined,
                                dateAdded: emailDate.getTime(),
                            });
                            console.log(`[OWA Email Sync] Synced message to GHL for contact ${contact.email}`);
                        }
                    }
                }
            } catch (ghlError) {
                console.error('[OWA Email Sync] Failed to sync to GHL:', ghlError);
            }

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
    async function findOrCreateConversation(userId: string, emailInput: string): Promise<string | null> {
        // Extract clean email address from potentially formatted input
        const email = extractEmail(emailInput);
        if (!email) {
            console.log(`[OWA Email Sync] Could not extract email from: ${emailInput}`);
            return null;
        }

        // Normalize email to lowercase
        const normalizedEmail = email.toLowerCase().trim();

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
                        equals: normalizedEmail,
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
                        email: normalizedEmail
                    }
                });

                if (!contact) {
                    contact = await tx.contact.create({
                        data: {
                            locationId,
                            email: normalizedEmail,
                            name: normalizedEmail.split('@')[0], // Use email prefix as name
                            status: 'New',
                            contactType: 'Lead'
                        }
                    });
                }
            }

            // Find existing conversation for this contact - use atomic upsert like Gmail
            // This requires the unique constraint [locationId, contactId] on conversations table
            let conversation;
            try {
                conversation = await tx.conversation.upsert({
                    where: {
                        locationId_contactId: {
                            locationId,
                            contactId: contact.id
                        }
                    },
                    create: {
                        contactId: contact.id,
                        locationId,
                        ghlConversationId: `owa_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                        status: 'open',
                        lastMessageType: 'TYPE_EMAIL'
                    },
                    update: {} // No update needed - just return existing
                });
            } catch (err) {
                // Fallback to findFirst if upsert fails (edge case)
                console.log('[OWA Email Sync] Upsert failed, falling back to find:', err);
                conversation = await tx.conversation.findFirst({
                    where: { contactId: contact.id, locationId }
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