const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    
    // Instead of depending on search page, go direct
    const url = 'https://www.bazaraki.com/adv/6186406_office-for-rent/'; // an ID from previous logs
    console.log('Navigating to:', url);
    
    // We need to handle potential 404s if it was deleted, but let's try
    const response = await page.goto(url);
    if (!response.ok()) {
        console.log('Failed to load. Status:', response.status());
        await browser.close();
        return;
    }

    // Attempt to dismiss cookie consent or wait for images
    await page.waitForTimeout(2000); 

    const extracted = await page.locator('.announcement__images-item.js-image-show-full, .gallery img, .announcement-media img, .swiper-slide img, .swiper-wrapper img, .announcement-gallery img, .photos-slider img, .ad-card-image img').evaluateAll(
        (els) => els.map(el => {
            return {
                src: el.getAttribute('src'),
                dataFull: el.getAttribute('data-full'),
                dataSrc: el.getAttribute('data-src'),
                dataLazy: el.getAttribute('data-lazy'),
                className: el.className,
                tagName: el.tagName
            };
        })
    );
    
    console.log('Extracted details:', JSON.stringify(extracted, null, 2));
    
    const thumbExtracted = await page.locator('.announcement__thumbnails-item.js-select-image, .announcement__thumbnails-wrapper img').evaluateAll(
        (els) => els.map(el => {
            return {
                src: el.getAttribute('src'),
                dataFull: el.getAttribute('data-full'),
                dataSrc: el.getAttribute('data-src'),
                className: el.className,
            };
        })
    );
    console.log('Thumbnail details:', JSON.stringify(thumbExtracted, null, 2));
    
    await browser.close();
})();
