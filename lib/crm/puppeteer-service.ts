import puppeteer, { Browser, Page } from 'puppeteer';

export class PuppeteerService {
    private browser: Browser | null = null;

    async init() {
        // FIX: Check if browser exists BUT is disconnected (closed manually)
        if (this.browser && !this.browser.isConnected()) {
            console.log("PuppeteerService: Browser instance found but disconnected. Resetting.");
            this.browser = null;
        }

        if (!this.browser) {
            console.log("PuppeteerService: Launching browser...");
            try {
                this.browser = await puppeteer.launch({
                    headless: false,
                    // Args to prevent crashes in some environments
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage', // Critical for server environments (docker/linux)
                        '--disable-features=IsolateOrigins,site-per-process'
                    ],
                    defaultViewport: { width: 1280, height: 900 }
                });

                // FIX: Listen for disconnection to clear variable immediately
                this.browser.on('disconnected', () => {
                    console.log("PuppeteerService: Browser disconnected/closed.");
                    this.browser = null;
                });

                console.log("PuppeteerService: Browser launched successfully.");
            } catch (e) {
                console.error("PuppeteerService: Failed to launch browser:", e);
                throw e;
            }
        } else {
            console.log("PuppeteerService: Browser already active.");
        }
    }

    async getPage(): Promise<Page> {
        await this.init();

        if (!this.browser) {
            throw new Error("PuppeteerService: Browser failed to initialize");
        }

        const pages = await this.browser.pages();
        const page = pages.length > 0 ? pages[0] : await this.browser.newPage();

        // Bring window to front so you see it on your Mac
        if (page) await page.bringToFront();

        return page;
    }

    async login(url: string, username: string, pass: string) {
        const page = await this.getPage();

        try {
            console.log(`Navigating to ${url}...`);
            // Increased timeout to 60s for slower connections
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

            // Check if already logged in
            if (!page.url().includes('login') && !page.url().includes('signin')) {
                const bodyText = await page.evaluate(() => document.body.innerText.toLowerCase());
                if (bodyText.includes('dashboard') || bodyText.includes('logout')) {
                    console.log('Already logged in based on page content.');
                    return;
                }
            }

            const userSelector = 'input[name="username"], input[name="email"], input[type="text"]';
            const passSelector = 'input[name="password"], input[type="password"]';

            await page.waitForSelector(userSelector, { timeout: 5000 }).catch(() => console.log("Login inputs not found immediately"));

            const userField = await page.$(userSelector);
            const passField = await page.$(passSelector);

            if (userField && passField) {
                await userField.type(username);
                await passField.type(pass);

                const submitSelector = 'button[type="submit"], input[type="submit"], button';
                const submitBtn = await page.$(submitSelector);

                if (submitBtn) {
                    await Promise.all([
                        page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(e => console.log("Navigation timeout ignored")),
                        submitBtn.click()
                    ]);
                } else {
                    // Fallback to form submit
                    const form = await page.$('form');
                    if (form) {
                        await Promise.all([
                            page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
                            form.evaluate((f: any) => f.submit())
                        ]);
                    }
                }
                console.log('Login submitted.');
            }
        } catch (e) {
            console.error("Login failed or timed out:", e);
            throw e;
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }
}

export const puppeteerService = new PuppeteerService();
