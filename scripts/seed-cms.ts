import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Seeding CMS content...');

    // 1. Find a location (Tenant)
    const location = await prisma.location.findFirst();
    if (!location) {
        console.error('No location found. Please run the app setup first.');
        return;
    }

    console.log(`Found Location: ${location.id} (${location.name})`);

    // 2. Create Content Page "About Us"
    const aboutPage = await prisma.contentPage.upsert({
        where: {
            locationId_slug: {
                locationId: location.id,
                slug: 'about-us'
            }
        },
        update: {},
        create: {
            locationId: location.id,
            title: 'About Our Agency',
            slug: 'about-us',
            published: true,
            content: `
        <h2>Welcome to ${location.name}</h2>
        <p>We are the premier real estate agency in the region.</p>
        <p>Our mission is to help you find your dream home.</p>
        <ul>
            <li>Integrity</li>
            <li>Professionalism</li>
            <li>Excellence</li>
        </ul>
      `
        }
    });
    console.log('Created Page:', aboutPage.slug);

    // 3. Create Blog Post
    const blogPost = await prisma.blogPost.upsert({
        where: {
            locationId_slug: {
                locationId: location.id,
                slug: 'market-update-december'
            }
        },
        update: {},
        create: {
            locationId: location.id,
            title: 'Market Update: December 2025',
            slug: 'market-update-december',
            authorName: 'John Doe',
            published: true,
            publishedAt: new Date(),
            excerpt: 'The market is hot! Read our latest analysis.',
            content: `
        <p>The real estate market in <strong>December 2025</strong> has shown remarkable resilience.</p>
        <h3>Key Trends</h3>
        <p>Prices depend on location, but generally we see an upward trend.</p>
        <blockquote>"Real estate cannot be lost or stolen, nor can it be carried away." - Franklin D. Roosevelt</blockquote>
      `
        }
    });
    console.log('Created Blog Post:', blogPost.slug);

    console.log('Seeding complete.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
