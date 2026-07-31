
import db from "@/lib/db";
import { scrapeNotionProperty, resolveGoogleMapsLocation, scrapeAddressFromMaps, convertMapUrl, getShortMapLink } from "@/lib/crm/notion-scraper";
import { scrapePropertyWithCrawl4AI } from "@/lib/crm/crawl4ai-service";
import { deleteImage, uploadToCloudflare, getImageDeliveryUrl } from "@/lib/cloudflareImages";
import { extractPropertyDataWithAI } from '@/app/(main)/admin/properties/import/ai-property-extraction';
import { PROPERTY_LOCATIONS } from "@/lib/properties/locations";
import { RENTAL_PERIODS } from "@/lib/properties/constants";
import { requireAuthenticatedLocationContext } from "@/lib/properties/active-location-access";
import {
    resolveOwnedPropertyImageSource,
    validateSubmittedPropertyMedia,
} from "@/lib/properties/property-media-access";
import {
    createPropertyAfterImportMediaValidation,
    createUrlImportMediaIngestion,
} from "@/lib/properties/url-import-media";
import type { SubmittedPropertyMedia } from "@/lib/properties/property-media-ownership-policy";
import { downloadSafeRemoteImage } from "@/lib/properties/safe-remote-image.server";

function logUrlImportCleanupFailure(imageId: string, error: unknown) {
    console.error("[Property URL Import] Failed to clean up newly uploaded image", {
        imageId,
        error: error instanceof Error ? error.message : "Unknown cleanup error",
    });
}

const ingestUrlImportMedia = createUrlImportMediaIngestion({
    resolveOwnedImage: resolveOwnedPropertyImageSource,
    downloadExternalImage: downloadSafeRemoteImage,
    uploadExternalImage: (blob, metadata) => uploadToCloudflare(blob, { metadata }),
    getDeliveryUrl: (imageId) => getImageDeliveryUrl(imageId, "public"),
    deleteUploadedImage: deleteImage,
    logCleanupFailure: logUrlImportCleanupFailure,
});

async function getImportContext() {
    const access = await requireAuthenticatedLocationContext();
    const [dbUser, siteConfig] = await Promise.all([
        db.user.findUnique({
            where: { clerkId: access.clerkUserId },
            select: { firstName: true, lastName: true, crmUsername: true, crmPassword: true },
        }),
        db.siteConfig.findUnique({ where: { locationId: access.locationId } }),
    ]);

    return { access, dbUser, siteConfig };
}

async function requireLocationImageIds(imageIds: string[], locationId: string) {
    const uniqueIds = Array.from(new Set(imageIds.filter(Boolean)));
    return Promise.all(uniqueIds.map(async (imageId) => (
        await resolveOwnedPropertyImageSource({ locationId, cloudflareImageId: imageId })
    ).cloudflareImageId));
}

function normalizeLocation(district: string | undefined, area: string | undefined) {
    if (!district && !area) return { district: "", area: "" };

    let normalizedDistrict = district || "";
    let normalizedArea = area || "";

    // 1. Global Area Search (Priority: High)
    // If we have a specific area, it strongly implies the district.
    // We search ALL districts for this area.
    if (area) {
        for (const d of PROPERTY_LOCATIONS) {
            const areaMatch = d.locations.find(l =>
                l.label.toLowerCase() === area.trim().toLowerCase() ||
                l.key.toLowerCase() === area.trim().toLowerCase()
            );

            if (areaMatch) {
                return {
                    district: d.district_key, // Enforce the correct district
                    area: areaMatch.key
                };
            }
        }
    }

    // 2. Fallback: Normalize District if no area matched globally
    // This handles cases where Area is empty or unknown (e.g. "Unknown Village"), but District is valid.
    const districtMatch = PROPERTY_LOCATIONS.find(d =>
        d.district_label.toLowerCase() === district?.trim().toLowerCase() ||
        d.district_key.toLowerCase() === district?.trim().toLowerCase()
    );

    if (districtMatch) {
        normalizedDistrict = districtMatch.district_key;
    }

    return { district: normalizedDistrict, area: normalizedArea };
}

export type ImportStatus =
    | { type: 'status'; step: 'INIT'; message: string }
    | { type: 'status'; step: 'SCRAPING'; message: string }
    | { type: 'status'; step: 'AI_ANALYSIS'; message: string }
    | { type: 'status'; step: 'MAP_RESOLUTION'; message: string }
    | { type: 'status'; step: 'IMAGE_PROCESSING'; message: string }
    | { type: 'status'; step: 'SAVING'; message: string }
    | { type: 'result'; data: any; propertyId: string; warnings?: string[] }
    | { type: 'error'; message: string; code?: string };

async function getCrmCredentials(context: Awaited<ReturnType<typeof getImportContext>>) {
    const { access, dbUser } = context;
    const crmUrl = access.location.crmUrl;

    if (!crmUrl || !dbUser?.crmUsername || !dbUser?.crmPassword) {
        return null;
    }

    return {
        url: crmUrl,
        username: dbUser.crmUsername,
        password: dbUser.crmPassword
    };
}

import { DEFAULT_MODEL } from "@/lib/ai/pricing";

export async function* runImportWorkflow(notionUrl: string, aiModel: string = DEFAULT_MODEL, clerkId: string, userHints?: string, maxImages: number = 50): AsyncGenerator<ImportStatus> {
    try {
        yield { type: 'status', step: 'INIT', message: 'Checking permissions and credentials...' };

        const context = await getImportContext();
        // Kept in the public signature for compatibility; never trusted for access.
        void clerkId;
        const creds = await getCrmCredentials(context);
        if (!creds) {
            yield { type: 'error', message: "Missing CRM Credentials. Please configure them in Settings.", code: "MISSING_CREDENTIALS" };
            return;
        }

        // 1. Scrape Notion (New AI Enhanced)
        yield { type: 'status', step: 'SCRAPING', message: `Connecting to Notion page...` };

        // We can't easily stream "within" scrapeNotionProperty unless we refactor it too, 
        // but for now we'll just wait for it.
        yield { type: 'status', step: 'SCRAPING', message: `Scraping content and capturing screenshots...` };

        let notionData;
        try {
            // Fetch API Key for AI services
            const apiKey = context.siteConfig?.googleAiApiKey;

            if (notionUrl.includes("notion.site")) {
                notionData = await scrapeNotionProperty(notionUrl, aiModel);
            } else {
                if (!apiKey) throw new Error("No AI API Key found for Crawl4AI scraping.");

                // 1a. Fetch persistent rules for this domain
                let effectiveHints = userHints || "";
                let appliedRuleTexts: string[] = [];
                let interactionSelector: string | null = null;

                try {
                    const urlObj = new URL(notionUrl);
                    const domain = urlObj.hostname;
                    const rules = await (db as any).scrapeRule.findMany({
                        where: {
                            domain: { contains: domain, mode: 'insensitive' }, // Loose match
                            isActive: true
                        }
                    });

                    if (rules.length > 0) {
                        const ruleWithSelector = rules.find((r: any) => r.interactionSelector);
                        if (ruleWithSelector) {
                            interactionSelector = ruleWithSelector.interactionSelector;
                        }

                        appliedRuleTexts = rules.map((r: any) => r.instructions);
                        const ruleHints = rules.map((r: any) => `[SAVED RULE] ${r.instructions}`).join("\n");
                        effectiveHints = effectiveHints ? `${effectiveHints}\n\n${ruleHints}` : ruleHints;
                        yield { type: 'status', step: 'SCRAPING', message: `Applied ${rules.length} saved rule(s) for ${domain}.` };
                    }
                } catch (err) {
                    console.error("Failed to fetch scrape rules:", err);
                }

                // Use Crawl4AI for Altia and all other generic sites
                yield { type: 'status', step: 'SCRAPING', message: `Crawling site with Crawl4AI (Python)...` };
                notionData = await scrapePropertyWithCrawl4AI(notionUrl, apiKey, aiModel, effectiveHints, interactionSelector);

                if (appliedRuleTexts.length > 0) {
                    notionData.appliedRules = appliedRuleTexts;
                }
            }
        } catch (e: any) {
            yield { type: 'error', message: `Scraping failed: ${e.message} ` };
            return;
        }

        yield { type: 'status', step: 'AI_ANALYSIS', message: 'AI Extraction complete. Verifying data...' };

        // 1b. Fallback: If Map Missing, Resolve via Google Maps Search
        // 1b. REMOVED Fallback Search
        // We only want to use map data if explicitly found on the page (iframe, URL, or coordinates).
        // No guessing via search.

        // 1c. Enhanced Address Scraping (If Map URL known but Address missing)

        // 1c. Enhanced Address Scraping (If Map URL known but Address missing)
        if (notionData.mapUrl && (!notionData.addressLine1 || !notionData.city)) {
            yield { type: 'status', step: 'MAP_RESOLUTION', message: 'Map URL found, but Address details missing. Scraping Maps for address...' };

            try {
                // Must fetch API key again or pass it down?
                // We fetched user and config in ai-property-extraction but we are in workflow now.
                // Re-fetch config for API Key.
                const apiKey = context.siteConfig?.googleAiApiKey;

                if (apiKey) {
                    const { scrapeAddressFromMaps } = await import("@/lib/crm/notion-scraper");
                    const mapAddress = await scrapeAddressFromMaps(notionData.mapUrl, apiKey, aiModel);

                    if (mapAddress.addressLine1 || mapAddress.city) {
                        // Merge results
                        notionData.addressLine1 = mapAddress.addressLine1 || notionData.addressLine1;
                        notionData.city = mapAddress.city || notionData.city;
                        notionData.postalCode = mapAddress.postalCode || notionData.postalCode;
                        if (!notionData.country) notionData.country = mapAddress.country || "Cyprus";

                        // Cache short link if moved here
                        if (mapAddress.shortLink) {
                            notionData.shortMapLink = mapAddress.shortLink;
                        }

                        yield { type: 'status', step: 'MAP_RESOLUTION', message: 'Address resolved from Google Maps!' };
                    } else {
                        yield { type: 'status', step: 'MAP_RESOLUTION', message: 'Could not extract address from Maps screenshot.' };
                    }
                }
            } catch (e) {
                console.error("Map Address Scrape Failed:", e);
                yield { type: 'status', step: 'MAP_RESOLUTION', message: 'Map address scraping failed (non-critical).' };
            }
        }

        // 2. Create Draft Property in DB
        yield { type: 'status', step: 'SAVING', message: 'Preparing database record...' };


        // 1d. Normalize Location & Area
        // AI often returns "Paphos" (Label) instead of "paphos" (Key), causing dropdowns to fail.
        const { district: normDist, area: normArea } = normalizeLocation(notionData.propertyLocation, notionData.propertyArea);
        if (normDist !== notionData.propertyLocation || normArea !== notionData.propertyArea) {
            console.log(`[Import] Normalized Location: ${notionData.propertyLocation} -> ${normDist}, ${notionData.propertyArea} -> ${normArea}`);
            notionData.propertyLocation = normDist;
            notionData.propertyArea = normArea;
            yield { type: 'status', step: 'AI_ANALYSIS', message: 'Location data normalized to system keys.' };
        }

        const locationId = context.access.locationId;
        // 2. Upload Images to Cloudflare (Persistence)
        const imageCount = notionData.images?.length || 0;
        yield { type: 'status', step: 'IMAGE_PROCESSING', message: `Processing ${imageCount} images for permanent storage...` };

        const ingestion = await ingestUrlImportMedia({
            locationId,
            dbUserId: context.access.dbUserId,
            images: Array.isArray(notionData.images) ? notionData.images : [],
            maxImages,
        });
        const validImages = ingestion.mediaItems;
        if (ingestion.warnings.length > 0) {
            console.warn(`[Import] Skipped ${ingestion.warnings.length} unauthorized or failed image(s).`);
            yield {
                type: 'status',
                step: 'IMAGE_PROCESSING',
                message: `Skipped ${ingestion.warnings.length} image(s) that could not be authorized or imported.`,
            };
        }

        // Update notionData with Cloudflare URLs
        // Note: notionData.images is technically string[] in type definition usually, 
        // but we are about to use it for DB creation. 
        // We'll keep notionData.images as just URLs for the result object to match generic type,
        // but use validImages for the DB creation.
        notionData.images = validImages.map(img => img.url);
        notionData.importWarnings = ingestion.warnings;

        // 3. Create Draft Property in DB
        yield { type: 'status', step: 'SAVING', message: 'Saving property to database...' };

        const draftProperty = await createDraftProperty(
            notionData,
            context.dbUser,
            locationId,
            validImages,
            notionUrl,
            ingestion.newlyUploadedImageIds,
        );

        yield { type: 'status', step: 'SAVING', message: 'Done! Property draft created.' };
        yield { type: 'result', data: notionData, propertyId: draftProperty.id, warnings: ingestion.warnings };

    } catch (error: any) {
        yield { type: 'error', message: error.message || "Unknown error occurred" };
    }
}

export async function* runPasteImportWorkflow(text: string, analysisImageIds: string[], galleryImageIds: string[], aiModel: string = DEFAULT_MODEL, clerkId: string, userHints?: string): AsyncGenerator<ImportStatus> {
    try {
        yield { type: 'status', step: 'INIT', message: 'Verifying credentials...' };

        const context = await getImportContext();
        // Kept in the public signature for compatibility; never trusted for access.
        void clerkId;
        const creds = await getCrmCredentials(context);
        if (!creds) {
            yield { type: 'error', message: "Missing CRM Credentials.", code: "MISSING_CREDENTIALS" };
            return;
        }

        // 1. AI Analysis (Use "Analysis" images only)
        yield { type: 'status', step: 'AI_ANALYSIS', message: 'Analyzing text and analysis documents with AI...' };

        const locationId = context.access.locationId;

        // Client-provided Cloudflare IDs must belong to the active location before
        // they can be analyzed or attached to the new property.
        const [authorizedAnalysisIds, authorizedGalleryIds] = await Promise.all([
            requireLocationImageIds(analysisImageIds, locationId),
            requireLocationImageIds(galleryImageIds, locationId),
        ]);
        const analysisUrls = authorizedAnalysisIds.map(id => getImageDeliveryUrl(id, "public"));

        const extractionResult = await extractPropertyDataWithAI(
            text, // htmlContent
            locationId,
            aiModel,
            analysisUrls,
            "Pasted Confirmation", // Page Title
            text, // Content Text (Critical)
            userHints || "", // User Hints
            {}, // extractedProperties
            undefined, // screenshotBase64
            undefined, // scrapedMapUrl
            undefined, // scrapedLat
            undefined  // scrapedLng
        );

        if (!extractionResult.success || !extractionResult.data) {
            throw new Error("AI Analysis failed: " + extractionResult.error);
        }

        const notionData = extractionResult.data;

        // 2. Normalization
        const { district: normDist, area: normArea } = normalizeLocation(notionData.propertyLocation, notionData.propertyArea);
        if (normDist !== notionData.propertyLocation || normArea !== notionData.propertyArea) {
            notionData.propertyLocation = normDist;
            notionData.propertyArea = normArea;
        }

        // 3. Create Draft (Use "Gallery" images only)
        yield { type: 'status', step: 'SAVING', message: 'Creating property draft...' };

        // Prepare gallery images for DB
        const galleryImages: SubmittedPropertyMedia[] = authorizedGalleryIds.map((id, index) => ({
            url: getImageDeliveryUrl(id, "public"),
            cloudflareImageId: id,
            kind: "IMAGE",
            sortOrder: index,
        }));

        // We assume "notionUrl" is just "Pasted Text" for source ref
        const draftProperty = await createDraftProperty(notionData, context.dbUser, locationId, galleryImages, "Manual Paste Import");

        yield { type: 'status', step: 'SAVING', message: 'Draft created successfully!' };
        yield { type: 'result', data: notionData, propertyId: draftProperty.id };

    } catch (error: any) {
        console.error("Paste Import Error:", error);
        yield { type: 'error', message: error.message || "Unknown error" };
    }
}

async function createDraftProperty(
    notionData: any,
    dbUser: any,
    locationId: string,
    validImages: SubmittedPropertyMedia[],
    sourceUrl: string,
    newlyUploadedImageIds: string[] = [],
) {

    const noteTitle = `Imported from Source: ${sourceUrl}`;
    let richNote = `Imported from Source: ${sourceUrl}`;

    // ... (Rich Note Construction Logic reused from original) ...
    // To avoid massive duplication, we'll simplify rich note for now or duplicate logic. 
    // Duplicating for safety as we don't want to break original logic if we missed vars.

    // Re-calculating rich note vars based on notionData
    const firstName = dbUser?.firstName || "";
    const lastName = dbUser?.lastName || "";
    const creatorsName = `${firstName || ''} ${lastName || ''}`.trim() || "Unknown User";

    const fullAddress = [notionData.addressLine1, notionData.city, notionData.postalCode].filter(Boolean).join(", ");
    const keyInfo = notionData.viewingContact || "See Viewing Contact";
    const petsStatus = notionData.petsAllowed || (notionData.features?.find((f: string) => f.toLowerCase().includes("pet")) ? "Pets Allowed" : "Check Agreement");

    // Basic rich note reconstruction
    richNote = `Created by: ${creatorsName}
Location: ${fullAddress}
Import Source: ${sourceUrl}
Keys: ${keyInfo}
Pets: ${petsStatus}

${notionData.viewingNotes || ""}`;

    const slugBase = (notionData.title || "imported-property").toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    const slug = `${slugBase}-${Date.now()}`;

    return createPropertyAfterImportMediaValidation({
        locationId,
        mediaItems: validImages,
        validateSubmittedMedia: validateSubmittedPropertyMedia,
        newlyUploadedImageIds,
        deleteUploadedImage: deleteImage,
        logCleanupFailure: logUrlImportCleanupFailure,
        createProperty: (validatedImages) => db.property.create({
            data: {
                locationId: locationId,
            title: notionData.title || "Untitled Import",
            slug: slug,
            description: notionData.description || "",
            price: notionData.price,
            communalFees: notionData.communalFees,
            priceIncludesCommunalFees: notionData.priceIncludesCommunalFees || false,
            commission: notionData.commission,
            deposit: notionData.deposit,
            depositValue: notionData.depositValue,
            agreementNotes: notionData.agreementNotes,
            billsTransferable: notionData.billsTransferable || false,
            bedrooms: notionData.bedrooms,
            bathrooms: notionData.bathrooms,
            areaSqm: notionData.areaSqm || notionData.coveredAreaSqm,
            coveredAreaSqm: notionData.coveredAreaSqm,
            coveredVerandaSqm: notionData.coveredVerandaSqm,
            uncoveredVerandaSqm: notionData.uncoveredVerandaSqm,
            basementSqm: notionData.basementSqm,
            plotAreaSqm: notionData.plotAreaSqm,
            buildYear: notionData.buildYear,
            latitude: notionData.latitude,
            longitude: notionData.longitude,
            addressLine1: notionData.addressLine1,
            addressLine2: notionData.addressLine2,
            city: notionData.city,
            postalCode: notionData.postalCode,
            country: notionData.country || "Cyprus",
            propertyLocation: notionData.propertyLocation,
            propertyArea: notionData.propertyArea,
            viewingContact: notionData.viewingContact,
            viewingNotes: notionData.viewingNotes,
            status: "ACTIVE",
            publicationStatus: "DRAFT",
            type: notionData.type || "detached_villa",
            category: notionData.category || "house",
            goal: notionData.goal === "RENT" ? "RENT" : "SALE",
            rentalPeriod: notionData.rentalPeriod || (notionData.goal === "RENT" ? RENTAL_PERIODS[0] : null),
            features: notionData.features || [],
            agentRef: notionData.agentRef,
            agentUrl: sourceUrl,
            internalNotes: richNote,
            keyHolder: notionData.viewingContact,
            metaTitle: notionData.metaTitle,
            metaDescription: notionData.metaDescription,
            metaKeywords: notionData.metaKeywords,
                media: {
                    create: validatedImages.map((img, index) => ({
                        url: img.url,
                        kind: "IMAGE",
                        sortOrder: index,
                        cloudflareImageId: img.cloudflareImageId,
                    })),
                },
            },
        }),
    });
}
