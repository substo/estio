
import puppeteer from 'puppeteer';

(async () => {
    try {
        console.log('Launching browser...');
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox']
        });
        console.log('Browser launched successfully!');
        console.log('Browser version:', await browser.version());
        await browser.close();
        console.log('Browser closed.');
    } catch (error) {
        console.error('FAILED to launch browser:', error);
    }
})();
