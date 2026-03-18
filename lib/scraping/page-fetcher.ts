import { Browser, Page } from 'playwright';
import { chromium } from 'playwright-extra';
// @ts-ignore
import stealthPlugin from 'puppeteer-extra-plugin-stealth';

// Add the stealth plugin to playwright-extra
chromium.use(stealthPlugin());

export interface FetchOptions {
  url: string;
  waitForSelector?: string;
  timeout?: number;
  jsEnabled?: boolean;
  username?: string;
  password?: string;
  sessionState?: any;
}

export class PageFetcher {
  private browser: Browser | null = null;
  private page: Page | null = null;

  async init(options: { jsEnabled?: boolean, sessionState?: any } = {}) {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true, // Run in headless mode for server environments
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
        ],
      }) as unknown as Browser;
    }

    if (!this.page) {
      let storageState: any = undefined;
      let legacyCookies: any = undefined;

      if (options.sessionState) {
          if (Array.isArray(options.sessionState)) {
              legacyCookies = options.sessionState;
          } else {
              storageState = options.sessionState;
          }
      }

      const context = await this.browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        javaScriptEnabled: options.jsEnabled !== false, // Default true
        storageState: storageState,
      });

      // Simple stealth modifications
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
        });
      });

      if (legacyCookies) {
          console.log(`[PageFetcher] Injecting ${legacyCookies.length} session cookies into context.`);
          await context.addCookies(legacyCookies);
      } else if (storageState) {
          console.log(`[PageFetcher] Initialized context with storageState (Cookies: ${storageState.cookies?.length || 0})`);
      }

      this.page = await context.newPage();
      
      // Route interception for performance
      await this.page.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
            route.abort(); // Block heavy assets to speed up scraping
        } else {
            route.continue();
        }
      });
    }
  }

  async fetchContent(options: FetchOptions): Promise<string> {
    await this.init({ jsEnabled: options.jsEnabled, sessionState: options.sessionState });

    if (!this.page) {
      throw new Error('Page not initialized');
    }

    console.log(`[PageFetcher] Navigating to ${options.url}`);

    await this.page.goto(options.url, {
      waitUntil: 'domcontentloaded', // Fast fail if network idle too long
      timeout: options.timeout || 30000,
    });

    // Simple Authentication handling if credentials provided
    if (options.username && options.password) {
      // This is highly site-specific. Needs to be injected via extractor strategy ideally.
      // E.g., for standard HTTTP basic auth:
      // await this.page.context().setHTTPCredentials({ username, password });
      console.log(`[PageFetcher] Credentials provided for ${options.url}, but auto-login depends on platform.`);
    }

    if (options.waitForSelector) {
      console.log(`[PageFetcher] Waiting for selector: ${options.waitForSelector}`);
      await this.page.waitForSelector(options.waitForSelector, {
        timeout: 10000,
      });
    }

    // A bit of human-like delay to ensure dynamic content settles
    await this.page.waitForTimeout(1000 + Math.random() * 2000);

    const content = await this.page.content();
    console.log(`[PageFetcher] Content retrieved. Length: ${content.length}, Title match: ${content.match(/<title[^>]*>(.*?)<\/title>/)?.[1] || 'N/A'}`);
    return content;
  }
  
  // Custom execution for complex interactions, hands the page context to a callback
  async executeOnPage<T>(options: FetchOptions, callback: (page: Page) => Promise<T>): Promise<T> {
    await this.init({ jsEnabled: options.jsEnabled, sessionState: options.sessionState });
    
    if (!this.page) throw new Error('Page not initialized');
    
    await this.page.goto(options.url, {
        waitUntil: 'domcontentloaded',
        timeout: options.timeout || 30000,
    });
    
    return await callback(this.page);
  }

  async close() {
    if (this.page) {
      await this.page.close();
      this.page = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
