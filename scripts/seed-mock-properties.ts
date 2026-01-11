
import { PrismaClient, PropertyStatus, ListingGoal, PublicationStatus } from '@prisma/client';

const url = process.env.DATABASE_URL || '';
const newUrl = url.includes('?') ? `${url}&pgbouncer=true` : `${url}?pgbouncer=true`;

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: newUrl,
        },
    },
});


interface MockProperty {
    title: string;
    description: string;
    price: number;
    bedrooms: number;
    bathrooms: number;
    areaSqm: number;
    plotAreaSqm: number;
    type: string;
    category: string;
    status: PropertyStatus;
    goal: ListingGoal;
    publicationStatus: PublicationStatus;
    addressLine1: string;
    city: string;
    propertyLocation: string;
    propertyArea?: string; // Optional
    floor?: number; // Optional
    features: string[];
    condition?: string; // Optional
    agentRef?: string; // Optional
    internalNotes?: string;
    agentUrl?: string;
    projectName?: string;
    unitNumber?: string;
    developerName?: string;
    managementCompany?: string;
    keyHolder?: string;
    occupancyStatus?: string;
    viewingContact?: string;
    viewingNotes?: string;
    viewingDirections?: string;
    lawyer?: string;
    loanDetails?: string;
    purchasePrice?: number;
    lowestOffer?: number;
    landSurveyValue?: number;
    estimatedValue?: number;
}

const MOCK_PROPERTIES: MockProperty[] = [
    // 1. Luxury Villa in Peyia (Sale, High Budget, Pool, Sea View)
    {
        title: 'Luxury Villa in Peyia',
        description: 'Stunning 3-bedroom villa with panoramic sea views, private pool, and landscaped garden.',
        price: 850000, // Luxury range
        bedrooms: 3,
        bathrooms: 3,
        areaSqm: 220,
        plotAreaSqm: 1000,
        type: 'Villa',
        category: 'Residential',
        status: PropertyStatus.ACTIVE,
        goal: ListingGoal.SALE,
        publicationStatus: PublicationStatus.PUBLISHED,
        addressLine1: 'Coral Bay Avenue',
        city: 'Peyia',
        propertyLocation: 'Paphos',
        propertyArea: 'Peyia',
        features: ['Sea View', 'Private Pool', 'Garden', 'Smart Home'],
        condition: 'Resale',
        agentRef: 'PEY-001',
    },
    // 2. Modern Apartment in Kato Paphos (Sale, Mid Budget, Near Sea)
    {
        title: 'Modern Apartment in Kato Paphos',
        description: 'Contemporary 2-bedroom apartment walking distance to harbor.',
        price: 285000, // Mid range
        bedrooms: 2,
        bathrooms: 2,
        areaSqm: 95,
        plotAreaSqm: 0,
        type: 'Apartment',
        category: 'Residential',
        status: PropertyStatus.ACTIVE,
        goal: ListingGoal.SALE,
        publicationStatus: PublicationStatus.PUBLISHED,
        addressLine1: 'Poseidonos Ave',
        city: 'Paphos',
        propertyLocation: 'Paphos',
        propertyArea: 'Kato Paphos',
        features: ['Walking Distance to Sea', 'Communal Pool', 'Elevator'],
        condition: 'New',
        agentRef: 'KATO-002',
    },
    // 3. Traditional Bungalow in Tala (Sale, Low Budget, Mountain View)
    {
        title: 'Traditional Bungalow in Tala',
        description: 'Charming stone-built bungalow with mountain views.',
        price: 195000, // Low range
        bedrooms: 2,
        bathrooms: 1,
        areaSqm: 110,
        plotAreaSqm: 400,
        type: 'Bungalow',
        category: 'Residential',
        status: PropertyStatus.ACTIVE,
        goal: ListingGoal.SALE,
        publicationStatus: PublicationStatus.PUBLISHED,
        addressLine1: 'Tala Square',
        city: 'Tala',
        propertyLocation: 'Paphos',
        propertyArea: 'Tala',
        features: ['Mountain View', 'Fireplace', 'Title Deeds'],
        condition: 'Resale',
        agentRef: 'TALA-003',
    },
    // 4. Large Family Home (5+ Bedrooms)
    {
        title: 'Massive Family Mansion',
        description: 'Expansive 6-bedroom estate with guest house.',
        price: 1500000, // Luxury
        bedrooms: 6,
        bathrooms: 5,
        areaSqm: 500,
        plotAreaSqm: 2500,
        type: 'Villa',
        category: 'Residential',
        status: PropertyStatus.ACTIVE,
        goal: ListingGoal.SALE,
        publicationStatus: PublicationStatus.PUBLISHED,
        addressLine1: 'Hilltop Road',
        city: 'Limassol',
        propertyLocation: 'Limassol',
        propertyArea: 'Agios Tychonas',
        features: ['Sea View', 'Private Pool', 'Gym', 'Sauna', 'Maids Room'],
        condition: 'Resale',
        agentRef: 'LIM-004',
    },
    // 5. Commercial Office (High Budget)
    {
        title: 'Premium Office Space',
        description: 'High-tech office floor in business district.',
        price: 2200000,
        bedrooms: 0,
        bathrooms: 4,
        areaSqm: 350,
        plotAreaSqm: 0,
        type: 'Office',
        category: 'Commercial',
        status: PropertyStatus.ACTIVE,
        goal: ListingGoal.SALE,
        publicationStatus: PublicationStatus.PUBLISHED,
        addressLine1: 'Makariou Avenue',
        city: 'Limassol',
        propertyLocation: 'Limassol',
        propertyArea: 'City Center',
        features: ['Server Room', 'Raised Floors', 'Security System'],
        condition: 'New',
        agentRef: 'COM-005',
    },
    // 6. Rental Apartment (Low Budget)
    {
        title: 'Budget Studio for Rent',
        description: 'Compact studio near university.',
        price: 550, // Rent Low
        bedrooms: 1,
        bathrooms: 1,
        areaSqm: 35,
        plotAreaSqm: 0,
        type: 'Apartment',
        category: 'Residential',
        status: PropertyStatus.ACTIVE,
        goal: ListingGoal.RENT,
        publicationStatus: PublicationStatus.PUBLISHED,
        addressLine1: 'Uni Street',
        city: 'Nicosia',
        propertyLocation: 'Nicosia',
        propertyArea: 'Engomi',
        features: ['Furnished', 'Near Amenities'],
        condition: 'Resale',
        agentRef: 'REN-006',
    },
    // 7. Rental Villa (High Budget)
    {
        title: 'Luxury Rental Villa',
        description: 'Executive 4-bedroom villa for long term rent.',
        price: 4500, // Rent Luxury
        bedrooms: 4,
        bathrooms: 4,
        areaSqm: 280,
        plotAreaSqm: 800,
        type: 'Villa',
        category: 'Residential',
        status: PropertyStatus.ACTIVE,
        goal: ListingGoal.RENT,
        publicationStatus: PublicationStatus.PUBLISHED,
        addressLine1: 'Sea Caves',
        city: 'Peyia',
        propertyLocation: 'Paphos',
        propertyArea: 'Sea Caves',
        features: ['Sea View', 'Private Pool', 'Fully Furnished'],
        condition: 'Resale',
        agentRef: 'REN-007',
    },
    // 8. Land Plot (Sale)
    {
        title: 'Residential Plot with Views',
        description: 'Building plot suitable for two villas.',
        price: 180000,
        bedrooms: 0,
        bathrooms: 0,
        areaSqm: 0,
        plotAreaSqm: 1200,
        type: 'Land',
        category: 'Land',
        status: PropertyStatus.ACTIVE,
        goal: ListingGoal.SALE,
        publicationStatus: PublicationStatus.PUBLISHED,
        addressLine1: 'Tremithousa Hill',
        city: 'Paphos',
        propertyLocation: 'Paphos',
        propertyArea: 'Tremithousa',
        features: ['Sea View', 'Water & Electricity'],
        condition: 'New',
        agentRef: 'LND-008',
    },
    // 9. Exact 5 Bedroom Villa (Testing 5+ logic boundary)
    {
        title: 'Spacious 5-Bed Family Home',
        description: 'Large family home with exactly 5 bedrooms.',
        price: 650000,
        bedrooms: 5,
        bathrooms: 4,
        areaSqm: 300,
        plotAreaSqm: 600,
        type: 'Villa',
        category: 'Residential',
        status: PropertyStatus.ACTIVE,
        goal: ListingGoal.SALE,
        publicationStatus: PublicationStatus.PUBLISHED,
        addressLine1: 'Konia Village',
        city: 'Paphos',
        propertyLocation: 'Paphos',
        propertyArea: 'Konia',
        features: ['Central Heating', 'Photovoltaic System'],
        condition: 'Resale',
        agentRef: 'KON-009',
    },
    // 10. Shop (Commercial)
    {
        title: 'High Street Retail Shop',
        description: 'Prime retail location with mezzanine.',
        price: 350000,
        bedrooms: 0,
        bathrooms: 1,
        areaSqm: 120,
        plotAreaSqm: 0,
        type: 'Shop',
        category: 'Commercial',
        status: PropertyStatus.ACTIVE,
        goal: ListingGoal.SALE,
        publicationStatus: PublicationStatus.PUBLISHED,
        addressLine1: 'Kings Avenue',
        city: 'Paphos',
        propertyLocation: 'Paphos',
        propertyArea: 'Kato Paphos',
        features: ['Showroom', 'Storage Room'],
        condition: 'Resale',
        agentRef: 'SHP-010',
    }
];

async function main() {
    // 1. Get the specific Location by GHL ID
    const targetGhlLocationId = 'ys9qMNTlv0jA6QPxXpbP';
    const location = await prisma.location.findUnique({
        where: { ghlLocationId: targetGhlLocationId }
    });

    if (!location) {
        throw new Error(`No Location found with ghlLocationId: ${targetGhlLocationId}. Please ensure the location is synced.`);
    }
    console.log(`Seeding data for Location: ${location.name} (${location.id})`);

    // 2. Create Properties
    for (const prop of MOCK_PROPERTIES) {
        const created = await prisma.property.create({
            data: {
                locationId: location.id,
                title: prop.title,
                slug: `mock-${Date.now()}-${Math.random().toString(36).substring(7)}`,
                description: prop.description,
                price: prop.price,
                currency: 'EUR',
                status: prop.status,
                goal: prop.goal,
                publicationStatus: prop.publicationStatus,
                category: prop.category,
                type: prop.type,
                bedrooms: prop.bedrooms,
                bathrooms: prop.bathrooms,
                areaSqm: prop.areaSqm,
                plotAreaSqm: prop.plotAreaSqm,
                addressLine1: prop.addressLine1,
                city: prop.city,
                propertyLocation: prop.propertyLocation,
                floor: prop.floor,
                country: 'Cyprus',
                source: 'MOCK_SEED',
                features: prop.features,
                // New Fields
                internalNotes: prop.internalNotes,
                agentRef: prop.agentRef,
                agentUrl: prop.agentUrl,
                projectName: prop.projectName,
                unitNumber: prop.unitNumber,
                // developerName: prop.developerName, 
                managementCompany: prop.managementCompany,
                keyHolder: prop.keyHolder,
                occupancyStatus: prop.occupancyStatus,
                viewingContact: prop.viewingContact,
                viewingNotes: prop.viewingNotes,
                viewingDirections: prop.viewingDirections,
                lawyer: prop.lawyer,
                loanDetails: prop.loanDetails,
                purchasePrice: prop.purchasePrice,
                lowestOffer: prop.lowestOffer,
                landSurveyValue: prop.landSurveyValue,
                estimatedValue: prop.estimatedValue,

                media: {
                    create: [
                        {
                            url: 'https://placehold.co/600x400?text=Property+Image',
                            kind: 'IMAGE',
                            sortOrder: 0
                        }
                    ]
                }
            }
        });
        console.log(`Created: ${created.title}`);
    }
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
