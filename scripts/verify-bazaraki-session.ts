import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';

const prisma = new PrismaClient();

async function run() {
    console.log('Fetching active Bazaraki credential...');
    const credential = await prisma.scrapingCredential.findFirst({
        where: { 
            status: 'active',
            connection: {
                platform: 'bazaraki'
            }
        },
        orderBy: { updatedAt: 'desc' }
    });

    if (!credential || !credential.sessionState) {
        console.error('No active Bazaraki credential with session state found.');
        process.exit(1);
    }

    console.log(`Found credential. Launching browser...`);

    // Write sessionState to a temporary file for Playwright
    const statePath = '/tmp/bazaraki_state.json';
    fs.writeFileSync(statePath, JSON.stringify(credential.sessionState));

    chromium.use(stealthPlugin());
    
    const browser = await chromium.launch({ 
        headless: true,
        channel: 'chromium'
    });
    
    console.log('Navigating to settings with context...');
    const context = await browser.newContext({
        storageState: statePath,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    
    const page = await context.newPage();
    
    try {
        await page.goto('https://www.bazaraki.com/profile/settings/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        console.log('Page loaded. Checking for sign-in header...');
        
        // Wait for the user menu to appear indicating a logged-in state
        await page.waitForSelector('.js-user-menu-header', { timeout: 10000 });
        
        const headerText = await page.evaluate(() => {
            const el = document.querySelector('.js-user-menu-header');
            return el ? el.textContent?.trim().replace(/\s+/g, ' ') : 'Not found';
        });
        
        console.log(`Header text shows: ${headerText}`);
        
        await page.screenshot({ path: '/tmp/bazaraki_settings_verified.png' });
        console.log('Saved screenshot to /tmp/bazaraki_settings_verified.png');
        
    } catch (error) {
        console.error('Failed or timed out:', error);
        await page.screenshot({ path: '/tmp/bazaraki_settings_error.png' });
    } finally {
        await browser.close();
        await prisma.$disconnect();
        fs.unlinkSync(statePath);
    }
}

run().catch(console.error);
