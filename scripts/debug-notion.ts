
import { scrapeNotionProperty } from '../lib/crm/notion-scraper';

const url = "https://ajamigroup.notion.site/AJAMI-COURT-II-MESOGI-APT-301-3-BED-2-BED-OFFICE-1-500-50-2a75198a3b2880e390dceeca776ec17f";

async function main() {
    try {
        console.log("Starting scraper debug...");
        await scrapeNotionProperty(url);
    } catch (error: any) {
        if (error.message && error.message.includes("DEBUG_STOP")) {
            console.log("Debug stop reached successfully.");
        } else {
            console.error("Error during scraping:", error);
        }
    }
}

main();
