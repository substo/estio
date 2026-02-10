import puppeteer, { Browser, Page, Cookie } from 'puppeteer';
import db from '@/lib/db';
import { encryptCookies, decryptCookies, encryptPassword, decryptPassword } from '@/lib/crypto/password-encryption';
import { addDays, isAfter } from 'date-fns';

// OWA URLs
const OWA_PERSONAL_URL = 'https://outlook.live.com/mail';
const OWA_WORK_URL = 'https://outlook.office.com/mail';
const LOGIN_URL = 'https://login.microsoftonline.com';

// Session validity duration (7 days - Microsoft sessions last longer if "Stay signed in" is checked)
const SESSION_VALIDITY_DAYS = 7;

// All Microsoft auth domains that need cookies
const MICROSOFT_AUTH_DOMAINS = [
    'https://login.microsoftonline.com',
    'https://login.live.com',
    'https://outlook.live.com',
    'https://outlook.office.com',
    'https://outlook.office365.com',
    'https://account.microsoft.com',
    'https://m365.cloud.microsoft',
    'https://office.com',
    'https://www.office.com',
    'https://microsoft.com'
];

export class OutlookPuppeteerService {
    private browser: Browser | null = null;
    private idleTimeout: NodeJS.Timeout | null = null;
    private activePages: Set<Page> = new Set();

    // In-memory cache for recently validated sessions (avoids re-validation within 5 minutes)
    private sessionCache: Map<string, { page: Page; validatedAt: Date }> = new Map();
    private readonly SESSION_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

    // Auto-close browser after 5 minutes of inactivity
    private readonly IDLE_TIMEOUT_MS = 5 * 60 * 1000;

    /**
     * Initialize browser with stealth settings
     */
    async init() {
        this.resetIdleTimeout();

        if (this.browser && this.browser.isConnected()) {
            return;
        }

        console.log('[OutlookPuppeteer] Launching browser...');

        this.browser = await puppeteer.launch({
            // headless: true, // PRODUCTION
            headless: false, // DEBUGGING: Visible browser for development
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled', // Stealth
                '--disable-features=IsolateOrigins,site-per-process'
            ],
            defaultViewport: { width: 1280, height: 900 }
        });

        this.browser.on('disconnected', () => {
            console.log('[OutlookPuppeteer] Browser disconnected');
            this.browser = null;
            this.activePages.clear();
            this.sessionCache.clear(); // Clear cached sessions
            this.clearIdleTimeout();
        });
    }

    /**
     * Reset the idle timeout (call this when browser is used)
     */
    private resetIdleTimeout() {
        this.clearIdleTimeout();
        this.idleTimeout = setTimeout(() => {
            if (this.activePages.size === 0) {
                console.log('[OutlookPuppeteer] Closing browser due to inactivity');
                this.close();
            }
        }, this.IDLE_TIMEOUT_MS);
    }

    /**
     * Clear the idle timeout
     */
    private clearIdleTimeout() {
        if (this.idleTimeout) {
            clearTimeout(this.idleTimeout);
            this.idleTimeout = null;
        }
    }

    /**
     * Get or create a new page (tracked for cleanup)
     */
    async getPage(): Promise<Page> {
        await this.init();

        if (!this.browser) {
            throw new Error('[OutlookPuppeteer] Browser failed to initialize');
        }

        const page = await this.browser.newPage();
        this.activePages.add(page);

        // Track page close
        page.on('close', () => {
            this.activePages.delete(page);
            this.resetIdleTimeout();
        });

        // Set user agent to appear as regular browser
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );

        // Remove webdriver flag (anti-bot detection)
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });

        // Robustness: block permission prompts (notifications, etc) to prevent popups
        try {
            const context = this.browser.defaultBrowserContext();
            await context.overridePermissions('https://outlook.office.com', ['notifications']);
            await context.overridePermissions('https://outlook.live.com', ['notifications']);
        } catch (e) {
            // Context permission override might fail in some environments
        }

        return page;
    }

    /**
     * Safely close a page (best practice helper)
     */
    async closePage(page: Page) {
        try {
            if (page && !page.isClosed()) {
                await page.close();
            }
        } catch (e) {
            // Page may already be closed
        }
        this.activePages.delete(page);
    }

    /**
     * Login to Outlook Web Access
     * Returns success status and any error messages
     */
    async loginToOWA(
        email: string,
        password: string,
        existingPage?: Page
    ): Promise<{ success: boolean; error?: string; mfaRequired?: boolean; cookies?: Cookie[] }> {
        const page = existingPage || await this.getPage();

        try {
            console.log('[OutlookPuppeteer] Starting login flow...');

            // Navigate to fresh login page (always navigate when existingPage to ensure clean state)
            const needsNavigation = existingPage || !page.url().includes('login.microsoftonline.com');
            if (needsNavigation) {
                await page.goto('https://login.microsoftonline.com', {
                    waitUntil: 'domcontentloaded',
                    timeout: 60000
                });
            }

            // Wait for either email input OR "Pick an account" tile
            console.log('[OutlookPuppeteer] Waiting for Email Input or Account Tile...');
            try {
                await page.waitForFunction(() => {
                    return document.querySelector('input[type="email"]') ||
                        document.querySelector('.table-row') ||
                        document.querySelector('.tile-img');
                }, { timeout: 15000 });
            } catch (e) {
                console.log('[OutlookPuppeteer] Timeout waiting for initial login elements, checking page source...');
            }

            // Check if "Pick an account" tile exists
            const accountTile = await page.$('.table-row') || await page.$('.tile-img');
            const emailInput = await page.$('input[type="email"]');

            if (accountTile && !emailInput) {
                console.log('[OutlookPuppeteer] Detected "Pick an account" screen. Clicking account tile...');
                await accountTile.click();
                // Wait for password field or redirection
                await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => { });
            } else if (emailInput) {
                console.log('[OutlookPuppeteer] Detected Email Input. Typing email...');
                // Clear any existing content in email field first
                await page.evaluate(() => {
                    const input = document.querySelector('input[type="email"]') as HTMLInputElement;
                    if (input) input.value = '';
                });
                // Type email
                await page.type('input[type="email"]', email, { delay: 50 });
                // Click Next
                await page.click('input[type="submit"]');
                // Wait for navigation to password page
                await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => { });
            } else {
                console.warn('[OutlookPuppeteer] Neither Email Input nor Account Tile found. Trying to proceed blindly...');
            }

            // Wait for either password field OR error message
            await page.waitForFunction(() => {
                const passwordField = document.querySelector('input[type="password"]');
                const errorElement = document.querySelector('[id="usernameError"]');
                return passwordField || errorElement;
            }, { timeout: 15000 });

            // Check for error (e.g., account not found)
            const usernameError = await page.$('[id="usernameError"]');
            if (usernameError) {
                const errorText = await page.evaluate(el => el?.textContent, usernameError);
                return { success: false, error: errorText || 'Invalid email address' };
            }

            // Small delay for animation
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Type password
            const passwordField = await page.$('input[type="password"]');
            if (!passwordField) {
                // May have been redirected to org-specific login
                const currentUrl = page.url();
                if (!currentUrl.includes('login.microsoftonline.com')) {
                    return {
                        success: false,
                        error: 'Your organization uses a custom login page. This method may not work.'
                    };
                }
            }

            await page.type('input[type="password"]', password, { delay: 50 });

            // Click Sign In
            await page.click('input[type="submit"]');

            // Wait for response - could be:
            // 1. "Stay signed in?" prompt
            // 2. MFA challenge
            // 3. Error message
            // 4. Direct redirect to OWA
            await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => { });

            // Check for MFA
            const mfaIndicators = await page.$$('[id="idDiv_SAOTCS_Proofs"], [id="idDiv_SAOTCC_Description"]');
            if (mfaIndicators.length > 0) {
                console.log('[OutlookPuppeteer] MFA required');
                return {
                    success: false,
                    mfaRequired: true,
                    error: 'Multi-Factor Authentication is enabled on this account. Please use an account without MFA or disable it temporarily.'
                };
            }

            // Check for password error
            const passwordError = await page.$('[id="passwordError"]');
            if (passwordError) {
                const errorText = await page.evaluate(el => el?.textContent, passwordError);
                return { success: false, error: errorText || 'Incorrect password' };
            }

            // Check for "Stay signed in?" prompt
            const staySignedIn = await page.$('input[type="submit"][value="Yes"]') || await page.$('#idSIButton9');
            if (staySignedIn) {
                console.log('[OutlookPuppeteer] Handling "Stay signed in" prompt...');
                // Click "Don't show this again" if present
                const kmsiCheckbox = await page.$('#KmsiCheckboxField');
                if (kmsiCheckbox) {
                    await kmsiCheckbox.click();
                }

                await staySignedIn.click();
                await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => { });
            }

            // Verify we're logged in - check current location
            let currentUrl = page.url();
            console.log('[OutlookPuppeteer] Current URL post-login:', currentUrl);

            // -------------------------------------------------------------------------
            // CRITICAL: Capture cookies IMMEDIATELY after login
            // Even if the redirect to OWA times out, we want to save this session.
            // -------------------------------------------------------------------------
            const captureCookies = async () => {
                const allCookies: Cookie[] = [];
                const currentCookies = await page.cookies();
                allCookies.push(...currentCookies);
                for (const domain of MICROSOFT_AUTH_DOMAINS) {
                    try {
                        const domainCookies = await page.cookies(domain);
                        allCookies.push(...domainCookies);
                    } catch (e) { }
                }
                return Array.from(new Map(allCookies.map(c => [`${c.name}:${c.domain}`, c])).values());
            };

            let capturedCookies = await captureCookies();
            console.log(`[OutlookPuppeteer] Captured ${capturedCookies.length} cookies immediately after login.`);

            // Check if we're already on OWA (skip navigation if so)
            const isOnOWA = currentUrl.includes('outlook.live.com/mail') ||
                currentUrl.includes('outlook.office.com/mail') ||
                currentUrl.includes('outlook.office365.com/mail');

            try {
                if (isOnOWA) {
                    console.log('[OutlookPuppeteer] Already on OWA, no additional navigation needed.');
                } else if (currentUrl.includes('m365.cloud.microsoft') || currentUrl.includes('office.com') || currentUrl.includes('microsoft365.com')) {
                    // M365 / Office.com Landing Page (Business Account) - redirect to Work OWA
                    console.log('[OutlookPuppeteer] Detected M365/Office portal. Redirecting to Work OWA...');
                    await page.goto(OWA_WORK_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
                    currentUrl = page.url();
                } else if (!currentUrl.includes('login.') && !currentUrl.includes('signin')) {
                    // We're on some other Microsoft page, try Work OWA
                    console.log('[OutlookPuppeteer] On unknown page, navigating to Work OWA...');
                    await page.goto(OWA_WORK_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
                    currentUrl = page.url();
                }

                // Check if we're actually in OWA (not redirected back to login)
                if (currentUrl.includes('login.') || currentUrl.includes('signin')) {
                    // One last try: Check for "Pick an account" or "Signed in" intermediate screen
                    const signedInText = await page.$('div[data-bind*="unsafe_signedInText"]');
                    const tile = await page.$('.table-cell');

                    if (signedInText || tile) {
                        console.log('[OutlookPuppeteer] Detected "Signed In" / Account Tile screen. Clicking tile to proceed...');
                        const clickTarget = signedInText || tile;
                        if (clickTarget) {
                            await clickTarget.click();
                            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
                            currentUrl = page.url();
                        }
                    }

                    if (currentUrl.includes('login.') || currentUrl.includes('signin')) {
                        return { success: false, error: 'Login failed. Could not access Outlook.' };
                    }
                }
            } catch (navError: any) {
                console.warn('[OutlookPuppeteer] Navigation validation timed out, but login was likely successful.', navError);
                // If we have cookies, we can treat this as a success (partial)
                if (capturedCookies.length > 0) {
                    console.log('[OutlookPuppeteer] Returning captured cookies despite navigation timeout.');
                    return { success: true, cookies: capturedCookies };
                }
                throw navError;
            }

            // Success! Re-capture cookies just in case new ones were set during redirect
            capturedCookies = await captureCookies();
            console.log('[OutlookPuppeteer] Final cookie capture:', capturedCookies.length);

            return { success: true, cookies: capturedCookies };

        } catch (error: any) {
            console.error('[OutlookPuppeteer] Login error:', error);
            // Close browser on error to prevent hanging instances only if we created it
            if (!existingPage) {
                await this.closePage(page);
            }
            return { success: false, error: error.message || 'Login failed' };
        } finally {
            // If we created the page, we should close it.
            // If existingPage was passed, the caller manages it.
            if (!existingPage) {
                await this.closePage(page);
            }
        }
    }

    /**
     * Save credentials and session to database
     */
    async saveSession(userId: string, email: string, password: string, cookies: Cookie[]) {
        const encryptedPassword = encryptPassword(password);
        const encryptedCookies = encryptCookies(cookies);
        const sessionExpiry = addDays(new Date(), SESSION_VALIDITY_DAYS);

        await db.user.update({
            where: { id: userId },
            data: {
                outlookAuthMethod: 'puppeteer',
                outlookEmail: email,
                outlookPasswordEncrypted: encryptedPassword,
                outlookSessionCookies: encryptedCookies,
                outlookSessionExpiry: sessionExpiry,
                outlookSyncEnabled: true
            }
        });

        console.log(`[OutlookPuppeteer] Session saved for user ${userId}`);
    }

    /**
     * Load session cookies and restore session
     */
    async loadSession(userId: string, existingPage?: Page): Promise<{ valid: boolean; page?: Page }> {
        // Check in-memory cache first (skip re-validation if session was recently used)
        const cached = this.sessionCache.get(userId);
        if (cached && !cached.page.isClosed()) {
            const age = Date.now() - cached.validatedAt.getTime();
            if (age < this.SESSION_CACHE_TTL_MS) {
                console.log(`[OutlookPuppeteer] Using cached session (validated ${Math.round(age / 1000)}s ago)`);
                return { valid: true, page: cached.page };
            }
        }

        const user = await db.user.findUnique({
            where: { id: userId },
            select: {
                outlookSessionCookies: true,
                outlookSessionExpiry: true,
                outlookEmail: true
            }
        });

        if (!user?.outlookSessionCookies) {
            return { valid: false };
        }

        // Check if session expired
        if (user.outlookSessionExpiry && isAfter(new Date(), user.outlookSessionExpiry)) {
            console.log('[OutlookPuppeteer] Session expired');
            return { valid: false };
        }

        try {
            const cookies = decryptCookies(user.outlookSessionCookies);
            const page = existingPage || await this.getPage();

            // Check if existingPage is already on OWA - skip navigation if so
            const currentUrl = page.url();
            const isAlreadyOnOWA = currentUrl.includes('outlook.live.com/mail') ||
                currentUrl.includes('outlook.office.com/mail') ||
                currentUrl.includes('outlook.office365.com/mail');

            if (existingPage && isAlreadyOnOWA) {
                console.log('[OutlookPuppeteer] Page already on OWA, skipping navigation.');
                this.sessionCache.set(userId, { page, validatedAt: new Date() });
                return { valid: true, page };
            }

            // Set cookies on a blank page first (before any navigation)
            // This is critical - cookies must be set before navigation to the target domain
            await page.goto('about:blank');

            // Group cookies by domain and set them
            await page.setCookie(...cookies);

            // Determine which OWA to use based on email domain
            const isWorkEmail = user.outlookEmail && !user.outlookEmail.endsWith('@outlook.com') && !user.outlookEmail.endsWith('@hotmail.com') && !user.outlookEmail.endsWith('@live.com');
            const targetUrl = isWorkEmail ? OWA_WORK_URL : OWA_PERSONAL_URL;

            console.log(`[OutlookPuppeteer] Loading session to ${isWorkEmail ? 'Work' : 'Personal'} OWA...`);
            console.log(`[OutlookPuppeteer] Target URL: ${targetUrl}`);

            try {
                await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            } catch (e) {
                console.log('[OutlookPuppeteer] Navigation timeout/error (continuing):', e);
            }

            let postNavUrl = page.url();
            console.log(`[OutlookPuppeteer] Post-navigation URL: ${postNavUrl}`);

            // Handle Redirects (M365 Portal OR Marketing Page)
            // Fix: Ensure we don't flag outlook.office.com as the portal (since it contains office.com)
            const isMarketingPage = postNavUrl.includes('microsoft.com') && postNavUrl.includes('outlook') && !postNavUrl.includes('outlook.live.com');
            const isM365Portal = postNavUrl.includes('m365.cloud.microsoft') ||
                (postNavUrl.includes('office.com') && !postNavUrl.includes('outlook.office.com')) ||
                postNavUrl.includes('microsoft365.com');

            if (isM365Portal || isMarketingPage) {
                console.log(`[OutlookPuppeteer] Detected ${isM365Portal ? 'M365 Portal' : 'Marketing Page'}. Redirecting to Work OWA...`);
                // Check if we are actually stuck on a landing page or if it's loading
                // Sometimes M365 portal is just an intermediate step?
                await page.goto(OWA_WORK_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
                console.log(`[OutlookPuppeteer] After redirect fix URL: ${page.url()}`);
            }

            // Check if session is valid (not redirected to login)
            postNavUrl = page.url();
            if (postNavUrl.includes('login.') || postNavUrl.includes('signin')) {
                // Only close if we created it
                if (!existingPage) await page.close();
                return { valid: false };
            }

            // Session is valid - cache it
            this.sessionCache.set(userId, { page, validatedAt: new Date() });
            console.log('[OutlookPuppeteer] Session validated and cached');
            return { valid: true, page };

        } catch (error) {
            console.error('[OutlookPuppeteer] Error loading session:', error);
            return { valid: false };
        }
    }

    /**
     * Re-authenticate using stored credentials
     * Returns the authenticated page on success so caller can use it directly
     */
    async refreshSession(userId: string, existingPage?: Page): Promise<{ success: boolean; page?: Page }> {
        const user = await db.user.findUnique({
            where: { id: userId },
            select: {
                outlookEmail: true,
                outlookPasswordEncrypted: true
            }
        });

        if (!user?.outlookEmail || !user?.outlookPasswordEncrypted) {
            console.log('[OutlookPuppeteer] No stored credentials for refresh');
            return { success: false };
        }

        const password = decryptPassword(user.outlookPasswordEncrypted);
        const page = existingPage || await this.getPage();

        // Pass existingPage to loginToOWA
        const result = await this.loginToOWA(user.outlookEmail, password, page);

        if (result.success && result.cookies) {
            // Success! Update DB and cache the session
            await this.saveSession(userId, user.outlookEmail, password, result.cookies);
            this.sessionCache.set(userId, { page, validatedAt: new Date() });
            return { success: true, page };
        }

        return { success: false };
    }

    /**
     * Clear stored credentials and session
     */
    async disconnect(userId: string) {
        await db.user.update({
            where: { id: userId },
            data: {
                outlookAuthMethod: null,
                outlookEmail: null,
                outlookPasswordEncrypted: null,
                outlookSessionCookies: null,
                outlookSessionExpiry: null,
                outlookSyncEnabled: false,
                // Also clear OAuth tokens if any
                outlookAccessToken: null,
                outlookRefreshToken: null
            }
        });

        console.log(`[OutlookPuppeteer] Disconnected user ${userId}`);
    }

    /**
     * Close browser and cleanup all resources
     */
    async close() {
        this.clearIdleTimeout();

        // Close all tracked pages first
        for (const page of this.activePages) {
            try {
                if (!page.isClosed()) {
                    await page.close();
                }
            } catch (e) {
                // Ignore errors on close
            }
        }
        this.activePages.clear();

        // Close browser
        if (this.browser) {
            try {
                await this.browser.close();
            } catch (e) {
                console.log('[OutlookPuppeteer] Error closing browser:', e);
            }
            this.browser = null;
        }

        console.log('[OutlookPuppeteer] Browser closed and resources cleaned up');
    }
}

// Singleton instance
export const outlookPuppeteerService = new OutlookPuppeteerService();
