import { NextResponse } from 'next/server';
import { AiFeedMapper } from '@/lib/feed/ai-mapper';
import { GenericXmlParser } from '@/lib/feed/parsers/generic-xml-parser';
import db from '@/lib/db';

export async function POST(req: Request) {
    try {
        const { url, companyId } = await req.json();

        if (!url || !companyId) {
            return NextResponse.json({ error: 'URL and CompanyId are required' }, { status: 400 });
        }

        // Fetch API Key from Company -> Location -> SiteConfig
        const company = await db.company.findUnique({
            where: { id: companyId },
            include: { location: { include: { siteConfig: true } } }
        });

        const apiKey = company?.location?.siteConfig?.googleAiApiKey;
        // Cast to any to safely access potentially new field
        const modelName = (company?.location?.siteConfig as any)?.googleAiModel;

        if (!apiKey) {
            return NextResponse.json({ error: 'Google AI API Key not configured for this location' }, { status: 400 });
        }

        // Fetch a snippet of the XML
        const response = await fetch(url);
        if (!response.ok) {
            return NextResponse.json({ error: `Failed to fetch URL: ${response.statusText}` }, { status: 400 });
        }

        // Read text - limit to ~50KB to avoid excessive token usage
        // Note: text() reads everything, so we might need a stream reader if file is huge.
        // For simplicity, we read text and slice. 
        const text = await response.text();
        const snippet = text.slice(0, 50000);

        const mapping = await AiFeedMapper.analyzeFeedStructure(snippet, apiKey, modelName);

        // Discovery available paths for UI dropdowns
        const parser = new GenericXmlParser();
        // Use a larger snippet for discovery to avoid cutting CDATA in the first few items
        // And trim to the last closing tag to avoid partial tags
        let discoverySnippet = text.slice(0, 500000);
        const lastTagClose = discoverySnippet.lastIndexOf('>');
        if (lastTagClose > 0) {
            discoverySnippet = discoverySnippet.substring(0, lastTagClose + 1);
        }

        // If we still suspect open CDATA (count of CDATA open vs close), we could try to append ']]>'
        // But simply taking a larger chunk usually solves it for the first few items.

        const paths = parser.discoverPaths(discoverySnippet);

        return NextResponse.json({ success: true, mapping, snippet, paths }); // Send back small snippet for preview UI if needed

    } catch (error: any) {
        console.error('Analyze error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

