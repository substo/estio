import { Tool, SchemaType } from "@google/generative-ai";
import db from "@/lib/db";
import { Prisma } from "@prisma/client";

// Define the Function Declarations for Gemini
export const AGENT_TOOLS: Tool[] = [
    {
        functionDeclarations: [
            {
                name: "searchProperties",
                description: "Search for properties in the database based on criteria like price, location, bedrooms, etc.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        query: {
                            type: SchemaType.STRING,
                            description: "Free text search query (e.g., '3 bed villa in Paphos under 500k')"
                        },
                        minPrice: { type: SchemaType.NUMBER },
                        maxPrice: { type: SchemaType.NUMBER },
                        bedrooms: { type: SchemaType.NUMBER },
                        location: { type: SchemaType.STRING }
                    },
                    required: ["query"]
                }
            },
            {
                name: "getMarketStats",
                description: "Get average price statistics for a specific area.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        location: { type: SchemaType.STRING },
                        type: { type: SchemaType.STRING }
                    },
                    required: ["location"]
                }
            }
        ]
    }
];

// Implementation of the tools
export const TOOL_IMPLEMENTATIONS = {
    searchProperties: async (args: any, locationId: string) => {
        console.log("Agent executing: searchProperties", args);

        const where: Prisma.PropertyWhereInput = {
            locationId,
            status: 'ACTIVE'
        };

        if (args.minPrice || args.maxPrice) {
            where.price = {};
            if (args.minPrice) where.price.gte = args.minPrice;
            if (args.maxPrice) where.price.lte = args.maxPrice;
        }

        if (args.bedrooms) {
            where.bedrooms = { gte: args.bedrooms };
        }

        if (args.location) {
            where.OR = [
                { addressLine1: { contains: args.location, mode: 'insensitive' } },
                { city: { contains: args.location, mode: 'insensitive' } },
                { district: { contains: args.location, mode: 'insensitive' } } // Assuming district exists or mapping to city
            ] as any;
        }

        // Basic full text search fallback
        if (!args.location && !args.minPrice && !args.maxPrice && args.query) {
            where.OR = [
                { title: { contains: args.query, mode: 'insensitive' } },
                { description: { contains: args.query, mode: 'insensitive' } }
            ];
        }

        const properties = await db.property.findMany({
            where,
            take: 5,
            select: {
                id: true,
                title: true,
                price: true,
                bedrooms: true,
                city: true,
                reference: true
            }
        });

        return {
            count: properties.length,
            results: properties
        };
    },

    getMarketStats: async (args: any) => {
        // Mock implementation for now - normally would aggregate DB
        return {
            area: args.location,
            averagePrice: 450000,
            trend: "up +5% YoY",
            demand: "High"
        };
    }
};
