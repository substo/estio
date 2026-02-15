import db from "@/lib/db";
import { Offer, DealContext } from "@prisma/client";

/**
 * negotiation.ts
 * Tools for Phase 5: Negotiator Agent
 */

/**
 * Create a new offer for a deal.
 * Updates the deal's negotiation stage automatically.
 */
export async function createOffer(params: {
    dealId: string;
    type: "initial" | "counter" | "final";
    fromRole: "buyer" | "seller";
    amount: number;
    conditions?: string;
    reasoning?: string;
}): Promise<{ offer: Offer; deal: DealContext }> {
    // 1. Create the offer record
    const offer = await db.offer.create({
        data: {
            dealId: params.dealId,
            type: params.type,
            fromRole: params.fromRole,
            amount: params.amount,
            conditions: params.conditions,
            reasoning: params.reasoning,
            status: "pending",
        },
    });

    // 2. Update the deal stage
    // If it's an initial offer, move to "offer_made"
    // If it's a counter, move to "counter_offer"
    // If it's final, move to "final_offer"
    let newStage = "offer_made";
    if (params.type === "counter") newStage = "counter_offer";
    if (params.type === "final") newStage = "final_offer";

    const deal = await db.dealContext.update({
        where: { id: params.dealId },
        data: {
            negotiationStage: newStage,
            lastActivityAt: new Date(),
        },
    });

    return { offer, deal };
}

/**
 * Retrieve the full offer history for a deal to understand the negotiation flow.
 */
export async function getOfferHistory(dealId: string): Promise<Offer[]> {
    return await db.offer.findMany({
        where: { dealId },
        orderBy: { createdAt: "asc" },
    });
}

/**
 * Calculate estimated monthly mortgage payments.
 * Pure utility function, no DB side effects.
 */
export async function calculateMortgage(params: {
    propertyPrice: number;
    downPaymentPercent: number;
    interestRate: number;
    termYears: number;
}): Promise<{ monthlyPayment: number; totalCost: number; principal: number }> {
    const principal = params.propertyPrice * (1 - params.downPaymentPercent / 100);
    const r = params.interestRate / 100 / 12; // Monthly interest rate
    const n = params.termYears * 12; // Total number of payments

    // Formula: M = P [ i(1 + i)^n ] / [ (1 + i)^n – 1 ]
    let monthly = 0;
    if (r === 0) {
        monthly = principal / n;
    } else {
        monthly = (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    }

    return {
        monthlyPayment: Math.round(monthly),
        totalCost: Math.round(monthly * n),
        principal: Math.round(principal),
    };
}

/**
 * Compare the target property's price against similar properties in the database.
 * Useful for justifying offers.
 */
export async function priceComparison(params: {
    district: string;
    propertyType?: string;
    bedrooms?: number;
}): Promise<{ average: number; median: number; count: number; min: number; max: number }> {
    // Build filter
    const where: any = {
        location: { name: { contains: params.district, mode: "insensitive" } },
        purchasePrice: { gt: 0 }, // Using purchasePrice per schema line 243
        // status: "ACTIVE", // Assuming we only want active listings
    };

    if (params.propertyType) {
        where.type = { contains: params.propertyType, mode: "insensitive" };
    }

    if (params.bedrooms) {
        where.bedrooms = params.bedrooms;
    }

    // Using standard fields for filtering

    const properties = await db.property.findMany({
        where,
        select: { purchasePrice: true },
    });

    const prices = properties.map(p => p.purchasePrice!).sort((a, b) => a - b);

    if (prices.length === 0) {
        return { average: 0, median: 0, count: 0, min: 0, max: 0 };
    }

    const sum = prices.reduce((a, b) => a + b, 0);
    const avg = Math.round(sum / prices.length);
    const median = prices[Math.floor(prices.length / 2)];

    return {
        average: avg,
        median: median,
        count: prices.length,
        min: prices[0],
        max: prices[prices.length - 1],
    };
}
