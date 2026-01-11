
import { NextResponse } from 'next/server';
import { GenericXmlParser } from '@/lib/feed/parsers/generic-xml-parser';
import { FeedMappingConfig } from '@/lib/feed/ai-mapper';

export async function POST(req: Request) {
    try {
        const { url, mappingConfig } = await req.json();

        if (!url || !mappingConfig) {
            return NextResponse.json({ error: 'URL and mappingConfig are required' }, { status: 400 });
        }

        // Fetch XML
        const response = await fetch(url);
        if (!response.ok) {
            return NextResponse.json({ error: 'Failed to fetch XML' }, { status: 400 });
        }
        const text = await response.text();

        // Parse with specific config
        const parser = new GenericXmlParser(mappingConfig as FeedMappingConfig);
        const items = await parser.parse(text);

        // Return first 5 items as preview
        return NextResponse.json({ success: true, items: items.slice(0, 5) });

    } catch (error: any) {
        console.error('Preview error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
