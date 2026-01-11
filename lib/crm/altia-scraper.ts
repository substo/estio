
import { puppeteerService } from './puppeteer-service';
import { AIPropertyData } from '@/app/(main)/admin/properties/import/ai-property-extraction';

export async function scrapeAltiaProperty(url: string, aiModel?: string): Promise<AIPropertyData> {
    console.log("Initializing Puppeteer Service for Altia...");
    await puppeteerService.init();
    const page = await puppeteerService.getPage();

    if (!page) throw new Error("Puppeteer page could not be initialized");

    console.log(`Navigating to Altia page: ${url}`);

    try {
        await page.setViewport({ width: 1400, height: 2000 });
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Accept Cookies if present
        try {
            const acceptBtn = await page.waitForSelector('#cookie-accept', { timeout: 3000 }); // Hypothetical ID, will try generic text search if this fails
            if (acceptBtn) await acceptBtn.click();
        } catch (e) {
            // Try text match for cookie button
            await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const accept = buttons.find(b => b.innerText.toLowerCase().includes('accept') || b.innerText.toLowerCase().includes('agree'));
                if (accept) accept.click();
            });
        }

        // Scroll to load all content
        await page.evaluate(async () => {
            await new Promise<void>((resolve) => {
                let totalHeight = 0;
                const distance = 300;
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if (totalHeight >= scrollHeight) {
                        clearInterval(timer);
                        window.scrollTo(0, 0);
                        resolve();
                    }
                }, 100);
            });
        });

        // Wait a moment for dynamic content
        await new Promise(r => setTimeout(r, 2000));

        // SCRAPE DATA
        const extractedData = await page.evaluate(() => {
            // Helper to get basic data
            function extractBasicData() {
                const getText = (selector: string) => document.querySelector(selector)?.textContent?.trim() || "";

                const title = document.querySelector('h1')?.textContent?.trim() || "";
                const priceRaw = document.querySelector('.listing-price')?.textContent?.trim() || "";
                const price = parseInt(priceRaw.replace(/[^0-9]/g, '')) || 0;
                const referenceNumber = document.querySelector('.listing-code__text')?.textContent?.replace('#', '').trim() || "";

                let propertyLocation = "";
                let propertyArea = "";
                const locEl = document.querySelector('.listing-location');
                if (locEl) {
                    const parts = locEl.textContent?.split(',').map(s => s.trim()) || [];
                    if (parts.length > 0) propertyArea = parts[0];
                    if (parts.length > 1) propertyLocation = parts[1];
                }

                let bedrooms = 0;
                let bathrooms = 0;
                let coveredAreaSqm = 0;
                let plotAreaSqm = 0;
                let buildYear = 0;

                const attributes = Array.from(document.querySelectorAll('.attribute__label'));
                attributes.forEach(labelEl => {
                    const label = labelEl.textContent?.toLowerCase().trim() || "";
                    const valueEl = labelEl.nextElementSibling;
                    const valueText = valueEl?.textContent?.trim() || "";
                    const valueNum = parseInt(valueText.replace(/[^0-9]/g, '')) || 0;

                    if (label.includes('bedroom')) bedrooms = valueNum;
                    else if (label.includes('bathroom') || label.includes('toilet') || label.includes('wc')) {
                        if (valueNum > bathrooms) bathrooms = valueNum;
                    }
                    else if (label.includes('total building size') || label.includes('covered area')) coveredAreaSqm = valueNum;
                    else if (label.includes('plot size') || label.includes('land size')) plotAreaSqm = valueNum;
                    else if (label.includes('year of construction')) buildYear = valueNum;
                });

                const description = document.querySelector('.listing-info.description, .listing-description')?.innerHTML || "";

                return {
                    title, price, referenceNumber, propertyLocation, propertyArea,
                    bedrooms, bathrooms, coveredAreaSqm, plotAreaSqm, buildYear, description
                };
            }

            // Images - Click "View all media" first
            try {
                const viewMediaBtn = document.querySelector('.control--photo-gallery-btn');
                if (viewMediaBtn) {
                    (viewMediaBtn as HTMLElement).click();
                    return { ...extractBasicData(), uniqueImages: [], galleryClicked: true };
                }
            } catch (e) {
                console.log("Could not click media button", e);
            }

            // Fallback unique images if no gallery
            const imageUrls = Array.from(document.querySelectorAll('img')).map(img => img.src)
                .filter(src => (src.includes('altia') || src.includes('cloudfront')) && !src.includes('logo') && !src.includes('icon') && src.length > 50);

            return {
                ...extractBasicData(),
                uniqueImages: Array.from(new Set(imageUrls)),
                galleryClicked: false
            };
        });

        // If gallery was clicked, wait for it to open and extract images
        let finalImages: string[] = extractedData.uniqueImages || [];
        if (extractedData.galleryClicked) {
            console.log("Gallery button clicked, waiting for gallery to load...");
            // Initial wait for animation
            await new Promise(r => setTimeout(r, 2000));

            // Wait for panel or thumbnails
            try {
                await page.waitForSelector('.q-carousel__thumbnail', { timeout: 10000 });
            } catch (e) {
                console.log("Carousel/Thumbnail selector timeout");
            }

            // Extract images from thumbnails (which seem to include all photos)
            // and fallback to q-tab-panel images if needed
            const galleryImages = await page.evaluate(() => {
                const results: string[] = [];

                // Strategy A: Thumbnails
                // The thumbnails usually list all available images in the current tab (Photographs)
                const thumbs = Array.from(document.querySelectorAll('.q-carousel__thumbnail'));
                thumbs.forEach(img => {
                    const src = (img as HTMLImageElement).src;
                    if (src && (src.includes('altia') || src.includes('cloudfront')) && src.length > 50) {
                        results.push(src);
                    }
                });

                // Strategy B: Main View (Fallback or Addition)
                const mainImgs = Array.from(document.querySelectorAll('.q-tab-panel img'));
                mainImgs.forEach(img => {
                    const el = img as HTMLImageElement;
                    if (el.srcset) {
                        const parts = el.srcset.split(',');
                        const last = parts[parts.length - 1];
                        if (last) {
                            const [url] = last.trim().split(' ');
                            if (url) results.push(url);
                        }
                    } else if (el.src) {
                        results.push(el.src);
                    }
                });

                return Array.from(new Set(results));
            });

            if (galleryImages.length > 0) {
                console.log(`Extracted ${galleryImages.length} images from gallery.`);
                finalImages = galleryImages;
            }
        }

        // Map Resolution (Try to find map iframe)
        const mapData = await page.evaluate(() => {
            const iframes = Array.from(document.querySelectorAll('iframe'));
            const mapIframe = iframes.find(iframe => {
                const src = iframe.getAttribute('src') || "";
                return src.includes("google.com/maps") || src.includes("maps.google.com");
            });
            return mapIframe?.getAttribute('src') || "";
        });

        // Return formatted AIPropertyData
        return {
            title: extractedData.title,
            description: extractedData.description,
            price: extractedData.price,

            bedrooms: extractedData.bedrooms,
            bathrooms: extractedData.bathrooms,
            coveredAreaSqm: extractedData.coveredAreaSqm,
            plotAreaSqm: extractedData.plotAreaSqm,
            buildYear: extractedData.buildYear,

            addressLine1: "",
            city: extractedData.propertyLocation,
            propertyLocation: extractedData.propertyLocation,
            propertyArea: extractedData.propertyArea,

            images: finalImages,
            mapUrl: mapData,

            // Defaults/Flags
            status: "ACTIVE",
            publicationStatus: "DRAFT",
            type: "detached_villa",
            category: "house",
            goal: "SALE",
            features: [],
            agentRef: extractedData.referenceNumber,

            rawExtracted: extractedData
        };

    } catch (error) {
        console.error("Altia Scrape Error:", error);
        throw error;
    } finally {
        await puppeteerService.close();
    }
}
