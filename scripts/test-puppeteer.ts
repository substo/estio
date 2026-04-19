import puppeteer from 'puppeteer';

async function run() {
    console.log("Launching...");
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-features=IsolateOrigins,site-per-process'
        ],
    });
    console.log("Launched.");
    const page = await browser.newPage();
    console.log("New page.");
    await browser.close();
    console.log("Done.");
}
run().catch(console.error);
