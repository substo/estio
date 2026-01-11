
import sys
import json
import asyncio
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode

async def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No URL provided"}))
        return

    url = sys.argv[1]
    interaction_selector = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] != "null" else None
    
    # Configure Browser
    browser_config = BrowserConfig(
        headless=False, # Visible for debugging
        verbose=True
    )

    # Build JS Commands List
    js_commands = []

    # 1. Cookie Consent (Blocker Removal)
    # Try to click "Accept", "Agree", or specific classes like .cky-btn-accept
    cookie_js = """
    try {
        const consentSelectors = [
            '.cky-btn-accept', // Altia specific
            '#onetrust-accept-btn-handler',
            '.cookie-accept',
            'button[id*="cookie"][id*="accept"]', 
            'button[class*="cookie"][class*="accept"]'
        ];
        
        for (const sel of consentSelectors) {
            const btn = document.querySelector(sel);
            if (btn) {
                console.log("[Auto-Gallery] Found Cookie Consent Button by selector:", sel);
                btn.click();
                await new Promise(r => setTimeout(r, 1000)); // Wait for banner to go away
                break;
            }
        }
    } catch(e) { console.log("Cookie consent check error (non-fatal)", e); }
    """
    js_commands.append(cookie_js)

    # 2. Main Interaction Logic
    if interaction_selector:
         # --- Explicit User Selector ---
         # (Previous logic for specific selector)
         click_js = f"""
         try {{
             const selector = "{interaction_selector}";
             let el = document.querySelector(selector);
             if (!el) {{
                 // Try text fallback
                 const xpath = "//*[contains(text(), '" + selector + "')]";
                 const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                 el = result.singleNodeValue;
             }}
             if(el) {{
                 el.scrollIntoView({{block: "center"}});
                 await new Promise(r => setTimeout(r, 500));
                 el.click();
                 console.log('Clicked user selector:', selector);
             }}
         }} catch(e) {{ console.error(e); }}
         """
         js_commands.append(click_js)
    else:
        # --- Default "Smart Auto-Gallery" Heuristic ---
        heuristic_js = """
        try {
            console.log("Running Smart Auto-Gallery Heuristics (Polling Mode)...");
            
            // Helper: Poll for element
            async function waitForElement(xpathOrSelector, isXpath=false, timeout=5000) {
                const startTime = Date.now();
                while (Date.now() - startTime < timeout) {
                    let el = null;
                    if (isXpath) {
                        const result = document.evaluate(xpathOrSelector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                        el = result.singleNodeValue;
                    } else {
                        el = document.querySelector(xpathOrSelector);
                    }
                    if (el && el.offsetParent !== null) return el; // Must optionally be visible
                    await new Promise(r => setTimeout(r, 200));
                }
                return null;
            }

            let el = null;
            
            // Priority 1: Text Buttons (Gallery, Photos, etc.)
            const textTargets = ['View Gallery', 'View Photos', 'See all photos', 'Show all photos', 'Phots', 'Images', 'View all media'];
            const xpathText = textTargets.map(t => `//button[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${t.toLowerCase()}')]`).join(' | ');
            
            el = await waitForElement(xpathText, true, 3000);
            if (el) console.log("[Auto-Gallery] Found Text Button:", el.innerText);

            // Priority 1b: Specific Class (Altia)
            if (!el) {
                el = await waitForElement('.control--photo-gallery-btn', false, 2000);
                if (el) console.log("[Auto-Gallery] Found Specific Class: .control--photo-gallery-btn");
            }

            // Priority 2: Alt Text
            if (!el) {
                const altTargets = ['listing image', 'main property image', 'gallery-trigger'];
                const xpathAlt = altTargets.map(t => `//img[contains(translate(@alt, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${t.toLowerCase()}')]`).join(' | ');
                el = await waitForElement(xpathAlt, true, 2000);
                if (el) console.log("[Auto-Gallery] Found Image Alt:", el.getAttribute('alt'));
            }

            if (el) {
                console.log("[Auto-Gallery] CLICKING TARGET:", el);
                el.scrollIntoView({block: "center"});
                await new Promise(r => setTimeout(r, 500));
                el.click();
                await new Promise(r => setTimeout(r, 3000)); // Wait for gallery
            } else {
                console.log("[Auto-Gallery] No target found.");
            }

        } catch(e) { console.log("Heuristic Error", e); }
        """
        js_commands.append(heuristic_js)

    # 3. Scroll Down
    js_commands.append("window.scrollTo(0, document.body.scrollHeight);")

    # Configure Run
    run_config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        word_count_threshold=10,
        js_code=js_commands,
        magic=True 
    )

    async with AsyncWebCrawler(config=browser_config) as crawler:
        result = await crawler.arun(url=url, config=run_config)
        
        output = {
            "success": True,
            "markdown": result.markdown,
            "html": result.html, 
            "metadata": result.metadata,
            "media": result.media if hasattr(result, 'media') else {}
        }
        
        print(json.dumps(output))

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
