import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('--- Starting Corrupted Listings Cleanup ---');

    // Find all ScrapedListings that have the corrupted whatsappPhone '+12405132365'
    const corruptedPhone = '+12405132365';
    
    const corruptedListings = await prisma.scrapedListing.findMany({
        where: {
            whatsappPhone: corruptedPhone
        },
        include: {
            prospectLead: true
        }
    });

    console.log(`Found ${corruptedListings.length} corrupted listings with whatsappPhone = ${corruptedPhone}.`);

    if (corruptedListings.length === 0) {
        console.log('Nothing to clean up.');
        return;
    }

    let unlinkedCount = 0;

    for (const listing of corruptedListings) {
        // Unconditionally unlink the listing from the corrupted whatsappPhone
        console.log(`Fixing Listing [ID: ${listing.id}] - Title: "${listing.title}"`);
        console.log(`   - Removing erroneous whatsappPhone: ${listing.whatsappPhone}`);
        console.log(`   - Unlinking from ProspectLead [ID: ${listing.prospectLeadId}] (${listing.prospectLead?.name || 'Unknown'})`);

        await prisma.scrapedListing.update({
            where: { id: listing.id },
            data: {
                whatsappPhone: null,
                prospectLeadId: null, // Unlink it
                status: 'NEW' // Reset status
            }
        });
        
        unlinkedCount++;
    }

    console.log(`\n--- Cleanup Complete ---`);
    console.log(`Successfully unlinked ${unlinkedCount} listings.`);
    console.log(`These listings will now appear in the 'Untriaged / New' tab of the Prospecting UI.`);
    console.log(`You can click 'Scrape Listing' on them to correctly extract and generate the real seller profiles.`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
