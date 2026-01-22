import { puppeteerService } from './puppeteer-service';
import { Page } from 'puppeteer';
import fs from 'fs';
import path from 'path';

import { extractPropertyDataWithAI, AIPropertyData } from '@/app/(main)/admin/properties/import/ai-property-extraction';
import { DEFAULT_MODEL } from "@/lib/ai/pricing";

export async function scrapeNotionProperty(url: string, aiModel?: string): Promise<AIPropertyData> {
    // Use existing Puppeteer service instance
    console.log("Initializing Puppeteer Service...");
    await puppeteerService.init();
    console.log("Getting Page...");
    const page = await puppeteerService.getPage();

    if (!page) throw new Error("Puppeteer page could not be initialized");

    console.log(`Navigating to Notion page: ${url}`);

    try {
        // Set a large viewport to encourage loading more content
        await page.setViewport({ width: 1280, height: 2000 });

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Notion content loading can be slow and dynamic
        await page.waitForSelector('.notion-page-content', { timeout: 15000 }).catch(() => console.log("Notion content selector not found immediately"));

        // INTERACTION STEP: Expand everything!
        console.log("Expanding toggles...");
        await page.evaluate(async () => {
            // ... existing interaction logic ...
            const toggles = Array.from(document.querySelectorAll('.notion-toggle-block > div:first-child'));
            for (const toggle of toggles) {
                (toggle as HTMLElement).click();
            }
        });

        // Scroll to bottom to trigger lazy loading (Maps, Images)
        console.log("Scrolling to trigger lazy loading...");
        await page.evaluate(async () => {
            await new Promise<void>((resolve) => {
                let totalHeight = 0;
                const distance = 300; // Larger chunks
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if (totalHeight >= scrollHeight) {
                        clearInterval(timer);
                        // Scroll back to top to ensure header is visible if sticky
                        window.scrollTo(0, 0);
                        resolve();
                    }
                }, 200); // 200ms wait
            });
        });

        // Wait a bit for expansions to render images/maps
        await new Promise(r => setTimeout(r, 3000));

        // SCRAPE MAP URL & LAT/LONG (Before Screenshot/Navigation)
        console.log("Extracting Map Data...");
        try {
            await page.waitForFunction(() => document.querySelectorAll('iframe').length > 0, { timeout: 30000 });
        } catch (e) {
            console.log("Timeout waiting for iframes:", e);
        }

        const mapData = await page.evaluate(() => {
            // Find ALL iframes and check their src
            const iframes = Array.from(document.querySelectorAll('iframe'));
            console.log(`Found ${iframes.length} iframes`);

            const mapIframe = iframes.find(iframe => {
                const src = iframe.getAttribute('src') || "";
                return src.includes("google.com/maps") || src.includes("maps.google.com");
            });

            return mapIframe?.getAttribute('src') || "";
        });

        let mapUrl = mapData;
        let latitude: number | undefined;
        let longitude: number | undefined;

        if (mapUrl) {
            console.log("Found Map URL:", mapUrl);

            // Try to extract Lat/Long from URL
            const coords = extractCoordsFromUrl(mapUrl);
            if (coords) {
                latitude = coords.latitude;
                longitude = coords.longitude;
            }
            console.log(`Extracted Coords: ${latitude}, ${longitude}`);
        }
        if (mapData) {
            console.log("Found Map Iframe:", mapData);
        } else {
            console.log("No Map Iframe found.");
        }

        // TAKE SCREENSHOT (Visual Extraction Strategy)
        console.log("Taking full-page screenshot...");
        const screenshotBase64 = await page.screenshot({
            encoding: "base64",
            fullPage: true,
            type: "jpeg", // Use JPEG to save size if needed, but PNG is default
            quality: 80
        });

        // DEBUG: Save screenshot to file
        const debugPath = path.join(process.cwd(), 'public', 'debug-screenshot.jpg');
        console.log(`Saving debug screenshot to: ${debugPath}`);
        fs.writeFileSync(debugPath, Buffer.from(screenshotBase64, 'base64'));

        // CAPTURE MAIN CONTENT (Before potential navigation to Images sub-page)
        // We do this to ensure we have the property details (beds, price, etc.) 
        // even if we navigate away to a gallery page.
        const mainPageContent = await page.content();
        const mainPageTitle = await page.title();

        // NAVIGATE TO IMAGES (After screenshot)
        console.log("Navigating to Images view...");
        const navigatedToImages = await page.evaluate(async () => {
            // Strategy 1: Look for Anchors explicitly
            const allAnchors = Array.from(document.querySelectorAll('a'));
            const imageKeywords = ["images", "photos", "gallery", "pictures"];

            // Priority 1: Anchor with text matching keywords
            let targetAnchor = allAnchors.find(a => {
                const text = a.textContent?.trim().toLowerCase();
                return text && imageKeywords.some(k => text === k || text.includes(k)); // text match
            });

            // Priority 2: Anchor with href matching keywords (if Priority 1 failed)
            if (!targetAnchor) {
                targetAnchor = allAnchors.find(a => {
                    const href = a.getAttribute('href')?.toLowerCase();
                    // Check href but exclude the current page URL to avoid reloading
                    return href && imageKeywords.some(k => href.includes(k));
                });
            }

            if (targetAnchor) {
                console.log(`Found target anchor: Text='${targetAnchor.textContent}', Href='${targetAnchor.getAttribute('href')}'`);
                targetAnchor.click();
                return true;
            } else {
                // Strategy 2: Fallback to the old div-finding method just in case it's not an anchor (unlikely for "page" type)
                const allDivs = Array.from(document.querySelectorAll('div'));
                const imageLabel = allDivs.find(d => {
                    const text = d.textContent?.trim().toLowerCase();
                    return text === "images"; // Exact match only for fallback
                });

                if (imageLabel) {
                    console.log(`Found fallback div label: ${imageLabel.textContent}`);
                    imageLabel.click();
                    if (imageLabel.parentElement) imageLabel.parentElement.click();
                    return true;
                }

                console.log("Image navigation link/label not found.");
                return false;
            }
        });

        if (navigatedToImages) {
            console.log("Images link clicked. Waiting for load and scrolling...");
            // Initial wait for navigation
            await new Promise(r => setTimeout(r, 4000));

            // SCROLL THE NEW PAGE to trigger lazy loading of images
            await page.evaluate(async () => {
                await new Promise<void>((resolve) => {
                    // Notion often uses a specific container for scrolling
                    const scroller = document.querySelector('.notion-scroller') || document.querySelector('.notion-frame') || window;

                    let totalHeight = 0;
                    const distance = 400;
                    let attempts = 0;
                    const maxAttempts = 50; // Safety break

                    const timer = setInterval(() => {
                        attempts++;

                        // Use scrollHeight if available (element), else document.body.scrollHeight
                        const currentScrollHeight = (scroller instanceof Window) ? document.body.scrollHeight : scroller.scrollHeight;
                        const currentScrollTop = (scroller instanceof Window) ? window.scrollY : scroller.scrollTop;
                        const clientHeight = (scroller instanceof Window) ? window.innerHeight : scroller.clientHeight;

                        scroller.scrollBy(0, distance);
                        totalHeight += distance;

                        // Check if we hit bottom or run out of attempts
                        if ((currentScrollTop + clientHeight >= currentScrollHeight) || attempts > maxAttempts) {
                            clearInterval(timer);
                            // Scroll back to top
                            scroller.scrollTo(0, 0);
                            resolve();
                        }
                    }, 250); // Slower scroll to ensure load
                });
            });

            // Wait for hydration/loading of images after scroll
            await new Promise(r => setTimeout(r, 2500));
        }

        // EXTRACT IMAGES (Now we are on the Images page if navigated)
        console.log("Extracting gallery images...");
        const result = await page.evaluate(() => {
            const images: string[] = [];

            // 1. Get all <img> tags
            document.querySelectorAll('img').forEach(img => {
                if (img.src && !img.src.startsWith('data:') && img.width > 20) {
                    images.push(img.src);
                }
            });

            // 2. Get background images
            const allElements = document.querySelectorAll('div, span, a');
            allElements.forEach(el => {
                const style = window.getComputedStyle(el);
                const bg = style.backgroundImage;
                if (bg && bg.startsWith('url(')) {
                    const url = bg.slice(4, -1).replace(/["']/g, '');
                    if (url.startsWith('http')) {
                        images.push(url);
                    }
                }
            });

            const uniqueImages = Array.from(new Set(images));

            return {
                images: uniqueImages
            };
        });

        console.log(`Extracted ${result.images.length} images.`);

        // CALL AI API
        // CRITICAL: Use 'mainPageContent' and 'mainPageTitle' from the property page,
        // but use 'result.images' from the gallery page.
        console.log("Calling Gemini Vision API...");
        const aiResult = await extractPropertyDataWithAI(
            mainPageContent, // Use PRESERVED content
            undefined,
            aiModel,
            result.images, // Use NEW images
            mainPageTitle, // Use PRESERVED title
            "",
            "", // userHints (missing)
            {},
            screenshotBase64,
            mapData,
            latitude,
            longitude
        );

        if (!aiResult.success || !aiResult.data) {
            throw new Error(aiResult.error || "AI Extraction Failed");
        }

        return aiResult.data;

    } catch (error) {
        console.error("Scrape Error:", error);
        throw error;
    } finally {
        console.log("Closing Puppeteer Browser...");
        await puppeteerService.close();
    }
}


export async function resolveGoogleMapsLocation(query: string): Promise<{ mapUrl?: string, latitude?: number, longitude?: number, shortLink?: string }> {
    console.log(`Resolving Map Location for: ${query}...`);
    try {
        await puppeteerService.init();
        const page = await puppeteerService.getPage();
        if (!page) throw new Error("Puppeteer init failed");

        // Construct Search URL
        const searchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
        console.log(`Navigating to: ${searchUrl}`);

        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // NEW: Handle Consent specifically for Resolve Location
        await handleGoogleConsent(page);

        // Wait for redirect to settle (URL usually changes to /maps/place/...)
        // We can check if URL contains '@' which usually precedes coordinates
        try {
            await page.waitForFunction(() => window.location.href.includes('@'), { timeout: 10000 });
        } catch (e) {
            console.log("Wait for '@' in URL timed out, proceeding with current URL...");
        }

        const finalUrl = page.url();
        console.log(`Final Maps URL: ${finalUrl}`);

        // Extract Lat/Long from URL
        // Format: https://www.google.com/maps/place/.../@34.8732,32.3847,15z...
        const coordsMatch = finalUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (coordsMatch && coordsMatch.length >= 3) {
            const lat = parseFloat(coordsMatch[1]);
            const lng = parseFloat(coordsMatch[2]);
            console.log(`Resolved Coordinates: ${lat}, ${lng}`);

            // Extract Short Link while we are here
            let shortLink: string | undefined;
            try {
                // Click Share
                const shareClicked = await page.evaluate(async () => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const shareBtn = buttons.find(b => {
                        const text = b.textContent?.trim();
                        const label = b.getAttribute('aria-label');
                        return text === "Share" || label === "Share";
                    });
                    if (shareBtn) {
                        (shareBtn as HTMLElement).click();
                        return true;
                    }
                    return false;
                });

                if (shareClicked) {
                    // Wait for the modal input
                    try {
                        await page.waitForSelector('input.readonly', { timeout: 3000 });
                    } catch (e) {
                        await new Promise(r => setTimeout(r, 1000));
                    }

                    shortLink = await page.evaluate(() => {
                        const inputs = Array.from(document.querySelectorAll('input'));
                        const linkInput = inputs.find(i => i.value && i.value.includes('maps.app.goo.gl'));
                        return linkInput ? linkInput.value : undefined;
                    });

                    if (shortLink) console.log(`[MAP_RESOLVE] Extracted Short Link: ${shortLink}`);
                }
            } catch (e) {
                console.log("[MAP_RESOLVE] Failed to extract short link:", e);
            }

            return { mapUrl: finalUrl, latitude: lat, longitude: lng, shortLink };
        } else {
            console.log("Could not extract coordinates from URL");
            return { mapUrl: finalUrl };
        }

    } catch (error) {
        console.error("Map Resolution Error:", error);
        return {};
    } finally {
        await puppeteerService.close();
    }
}

export async function scrapeAddressFromMaps(mapUrl: string, apiKey: string, model: string = DEFAULT_MODEL): Promise<{ addressLine1?: string, city?: string, postalCode?: string, country?: string, shortLink?: string }> {
    // 1. Convert URL to Browser-Friendly Format
    const targetUrl = convertMapUrl(mapUrl);
    console.log(`[MAP_SCRAPE] Starting scraping for URL: ${targetUrl} (Original: ${mapUrl})`);

    try {
        await puppeteerService.init();
        const page = await puppeteerService.getPage();
        if (!page) throw new Error("Puppeteer init failed");

        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // Wait for potential side panel or main content
        try {
            await handleGoogleConsent(page);
            await page.waitForSelector('h1', { timeout: 5000 }); // Usually the place name
        } catch (e) {
            console.log("[MAP_SCRAPE] No H1 found or Consent handling issue, proceeding with screenshot anyway.");
        }

        // --- NEW: EXTRACT SHORT LINK (Optimized Single Pass) ---
        let shortLink: string | undefined;
        try {
            console.log("[MAP_SCRAPE] Attempting to extract Short Link...");
            const shareClicked = await page.evaluate(async () => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const shareBtn = buttons.find(b => {
                    const text = b.textContent?.trim();
                    const label = b.getAttribute('aria-label');
                    return text === "Share" || label === "Share";
                });
                if (shareBtn) {
                    (shareBtn as HTMLElement).click();
                    return true;
                }
                return false;
            });

            if (shareClicked) {
                try {
                    await page.waitForSelector('input.readonly', { timeout: 3000 });
                } catch (e) {
                    await new Promise(r => setTimeout(r, 1000));
                }

                shortLink = await page.evaluate(() => {
                    const inputs = Array.from(document.querySelectorAll('input'));
                    const linkInput = inputs.find(i => i.value && i.value.includes('maps.app.goo.gl'));
                    return linkInput ? linkInput.value : undefined;
                });

                if (shortLink) console.log(`[MAP_SCRAPE] Extracted Short Link: ${shortLink}`);
            }
        } catch (e) {
            console.log("[MAP_SCRAPE] Failed to extract short link (non-critical):", e);
        }

        // Take screenshot
        const screenshotBase64 = await page.screenshot({
            encoding: "base64",
            fullPage: false, // Just the viewport is enough for maps usually
            type: "jpeg",
            quality: 80
        });

        // Call Gemini Vision
        // Use the passed model (or default) to avoid 404s if a specific model works for the user.
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const prompt = `
        You are a Geolocation Data Extractor.
        TASK: Analyze this Google Maps screenshot to extract the precise location details.

        INSTRUCTIONS:
        1. Focus on the **Information Card/Sidebar** (usually on the left) containing the address text.
        2. If no sidebar is visible, look for the **Red Pin label** on the map.
        3. Infer the hierarchy:
           - addressLine1: Street Name + Number (or Building Name).
           - propertyArea: The local neighborhood or village.
           - city: The main town/municipality.

        OUTPUT JSON ONLY:
        {
          "addressLine1": "String or null",
          "city": "String or null",
          "propertyArea": "String or null",
          "postalCode": "String or null",
          "country": "String (Default: Cyprus)"
        }
        `;


        const response = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: prompt },
                        { inline_data: { mime_type: "image/jpeg", data: screenshotBase64 } }
                    ]
                }]
            })
        });

        if (!response.ok) {
            console.error("[MAP_SCRAPE] Gemini API Error:", await response.text());
            return {};
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!text) return {};

        // Parse JSON
        let clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
        const first = clean.indexOf("{");
        const last = clean.lastIndexOf("}");
        if (first !== -1 && last !== -1) clean = clean.substring(first, last + 1);

        return { ...JSON.parse(clean), shortLink };

    } catch (error) {
        console.error("[MAP_SCRAPE] Error:", error);
        return {};
    } finally {
        console.log("[MAP_SCRAPE] Closing Puppeteer Browser to prevent leaks...");
        await puppeteerService.close();
    }
}

export function convertMapUrl(url: string): string {
    if (!url.includes('/embed/')) return url;

    try {
        const urlObj = new URL(url);
        const q = urlObj.searchParams.get('q');
        const center = urlObj.searchParams.get('center');

        // Priority 1: Place Search (q)
        if (q) {
            return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
        }

        // Priority 2: Coordinate Search
        if (center) {
            return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(center)}`;
        }

        return url; // Fallback
    } catch (e) {
        return url;
    }
}

export async function getShortMapLink(url: string): Promise<string | null> {
    console.log(`[MAP_SHORT] Getting short link for: ${url}`);

    // Convert to searchable URL first if needed to ensure we load the right view
    // Embed URLs need to be converted to work with the Share button
    const validUrl = convertMapUrl(url);
    console.log(`[MAP_SHORT] Navigating to: ${validUrl}`);

    try {
        await puppeteerService.init();
        const page = await puppeteerService.getPage();

        await page.goto(validUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // 1. Consent Handling (Reuse logic)
        await handleGoogleConsent(page);

        // 2. Click Share
        // Wait for ANY button to ensure page is interactive
        try {
            await page.waitForSelector('button', { timeout: 10000 });
        } catch (e) {
            console.log("[MAP_SHORT] Timeout waiting for buttons, page might be blank or different.");
            return null;
        }

        const shareClicked = await page.evaluate(async () => {
            const buttons = Array.from(document.querySelectorAll('button'));
            // Look for "Share" text or aria-label
            const shareBtn = buttons.find(b => {
                const text = b.textContent?.trim();
                const label = b.getAttribute('aria-label');
                return text === "Share" || label === "Share";
            });

            if (shareBtn) {
                (shareBtn as HTMLElement).click();
                return true;
            }
            return false;
        });

        if (!shareClicked) {
            console.log("[MAP_SHORT] Share button not found.");
            return null;
        }

        // 3. Extract Link
        // Wait for the modal input
        try {
            await page.waitForSelector('input.readonly', { timeout: 5000 });
        } catch (e) {
            // Sometimes it's not .readonly or takes time
            await new Promise(r => setTimeout(r, 1000));
        }

        const shortLink = await page.evaluate(() => {
            const inputs = Array.from(document.querySelectorAll('input'));
            const linkInput = inputs.find(i => i.value && i.value.includes('maps.app.goo.gl'));
            return linkInput ? linkInput.value : null;
        });

        if (shortLink) {
            console.log(`[MAP_SHORT] Found: ${shortLink}`);
            return shortLink;
        } else {
            console.log("[MAP_SHORT] Link input not found in modal.");
            return null;
        }

    } catch (error) {
        console.error("[MAP_SHORT] Error:", error);
        return null;
    } finally {
        // We generally close the browser after these operations to be safe
        await puppeteerService.close();
    }
}

async function handleGoogleConsent(page: Page): Promise<void> {
    try {
        const consentUrl = page.url();
        if (consentUrl.includes("consent.google.com")) {
            console.log("[CONSENT] Google Consent Screen detected. Attempting to accept...");
            // Try to find the "Accept all" button.
            const buttons = await page.$$('button');
            for (const btn of buttons) {
                const text = await page.evaluate((el: any) => el.textContent, btn);
                if (text && (text.includes("Accept all") || text.includes("I agree") || text.includes("Accept"))) {
                    console.log(`[CONSENT] Clicking consent button: ${text}`);
                    await Promise.all([
                        // Ignore navigation timeout, sometimes it just updates in place
                        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch((e: any) => console.log("Consent navigation timeout ignored", e)),
                        btn.click()
                    ]);
                    break;
                }
            }
        }
    } catch (e: any) {
        // Non-critical, just log
        console.log("[CONSENT] Handler error (ignored):", e);
    }
}

export function extractCoordsFromUrl(url: string): { latitude: number, longitude: number } | null {
    try {
        const urlObj = new URL(url);
        const params = urlObj.searchParams;

        // Possible keys for coordinates
        const keys = ['q', 'query', 'center', 'll'];

        for (const key of keys) {
            const val = params.get(key);
            if (val) {
                // split by comma or whitespace (URL encoded space is +)
                // Google maps often uses "lat,lng" or "lat, lng"
                // Sometimes "lat lng"

                // Decode first to handle %2C or +
                const decoded = decodeURIComponent(val).replace(/\+/g, ' ');

                // Matches "number, number" allowing for spaces
                const parts = decoded.split(/[\s,]+/);

                // Filter empty strings
                const nums = parts.filter(p => p.trim() !== '').map(Number);

                // We need at least two numbers. 
                // Sometimes address is in q, e.g. "Main St, City", which results in NaNs.
                if (nums.length >= 2 && !isNaN(nums[0]) && !isNaN(nums[1])) {
                    return { latitude: nums[0], longitude: nums[1] };
                }
            }
        }

        // Regex fallback for @lat,lng syntax in path
        const atMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (atMatch) {
            return { latitude: parseFloat(atMatch[1]), longitude: parseFloat(atMatch[2]) };
        }

        return null;
    } catch (e) {
        return null;
    }
}
