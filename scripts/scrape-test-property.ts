
import { PrismaClient, PropertyStatus, ListingGoal, PublicationStatus } from '@prisma/client';
import * as cheerio from 'cheerio';
import axios from 'axios';

const url = process.env.DATABASE_URL || '';
const newUrl = url.includes('?') ? `${url}&pgbouncer=true` : `${url}?pgbouncer=true`;

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: newUrl,
        },
    },
});

// URL to scrape
const TARGET_URL = 'https://www.downtowncyprus.com/properties/detached-villa-for-sale-in-asprogia-paphos-ref-dt1363';

async function main() {
    console.log(`Fetching ${TARGET_URL}...`);
    const response = await axios.get(TARGET_URL);
    const html = response.data;
    const $ = cheerio.load(html);

    // 1. Get a Location to attach to
    const location = await prisma.location.findFirst();
    if (!location) {
        throw new Error('No Location found in database. Please create one first.');
    }
    console.log(`Using Location: ${location.id} (${location.name})`);

    // 2. Extract Data
    const title = $('h1').first().text().trim() || 'Scraped Property';

    // Price extraction
    // Looking for € followed by digits
    const priceMatch = html.match(/€\s*([\d,]+)/);
    let price = 0;
    if (priceMatch) {
        price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
    }

    const description = $('.description').text().trim() || $('div[class*="description"]').text().trim() || 'No description found';

    // Extract details
    const textContent = $('body').text();
    const bedroomsMatch = textContent.match(/(\d+)\s*Bedrooms?/i);
    const bathroomsMatch = textContent.match(/(\d+)\s*Bathrooms?/i);
    const coveredMatch = textContent.match(/(\d+)\s*m²\s*Covered/i);
    const plotMatch = textContent.match(/(\d+)\s*m²\s*Plot/i);

    const bedrooms = bedroomsMatch ? parseInt(bedroomsMatch[1], 10) : null;
    const bathrooms = bathroomsMatch ? parseInt(bathroomsMatch[1], 10) : null;
    const areaSqm = coveredMatch ? parseInt(coveredMatch[1], 10) : null;
    const plotAreaSqm = plotMatch ? parseInt(plotMatch[1], 10) : null;

    // Images
    const images: string[] = [];
    $('img').each((_, el) => {
        const src = $(el).attr('src');
        if (src && src.includes('properties') && !src.includes('thumb')) {
            if (src.startsWith('http')) {
                images.push(src);
            } else {
                images.push(`https://www.downtowncyprus.com${src}`);
            }
        }
    });
    const uniqueImages = Array.from(new Set(images)).slice(0, 5);

    console.log('Extracted Data:', {
        title,
        price,
        bedrooms,
        bathrooms,
        areaSqm,
        plotAreaSqm,
        imageCount: uniqueImages.length
    });

    // 3. Insert into DB
    const property = await prisma.property.create({
        data: {
            locationId: location.id,
            title: title,
            slug: `scraped-${Date.now()}`,
            description: description.substring(0, 500) + '...',
            status: PropertyStatus.ACTIVE,
            goal: ListingGoal.SALE,
            publicationStatus: PublicationStatus.PUBLISHED,
            category: 'house',
            type: 'detached_villa',
            price: price,
            currency: 'EUR',
            bedrooms: bedrooms,
            bathrooms: bathrooms,
            areaSqm: areaSqm,
            plotAreaSqm: plotAreaSqm,
            source: 'SCRAPED_TEST',
            addressLine1: 'Asprogia',
            city: 'Paphos',
            country: 'Cyprus',
            media: {
                create: uniqueImages.map((url, index) => ({
                    url: url as string,
                    kind: 'IMAGE',
                    sortOrder: index
                }))
            }
        },
    });

    console.log(`Created Property: ${property.id} - ${property.title}`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
