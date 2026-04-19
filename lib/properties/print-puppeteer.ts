import puppeteer from 'puppeteer';

export async function generatePdfViaPuppeteer(url: string, requestCookies: { name: string; value: string }[]) {
    // Launch an isolated browser for the print job
    const browser = await puppeteer.launch({
        headless: true, // Native headless
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-features=IsolateOrigins,site-per-process'
        ],
    });

    try {
        const page = await browser.newPage();

        // Pass authentication cookies down to the headless browser
        const baseUrl = new URL(url).origin;
        const puppeteerCookies = requestCookies.map(c => ({
            name: c.name,
            value: c.value,
            url: baseUrl, // Bind to the root domain so it authorizes all backend requests
        }));
        
        if (puppeteerCookies.length > 0) {
            await page.setCookie(...puppeteerCookies);
        }

        // Navigate to the target preview URL
        await page.goto(url, { 
            waitUntil: 'networkidle0', 
            timeout: 30000 
        });

        // Generate the PDF
        const pdfBytes = await page.pdf({
            printBackground: true,
            preferCSSPageSize: true, // Will inherit strictly from @page { size: A4 }
            format: 'A4', // Fallback
            margin: {
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
            }
        });

        return pdfBytes;
    } finally {
        await browser.close();
    }
}
