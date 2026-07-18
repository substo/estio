import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
    const locations = await db.location.findMany({
        select: {
            id: true,
            name: true,
            domain: true,
            siteConfig: { select: { domain: true } },
        },
        orderBy: { name: "asc" },
    });
    const documents = await db.settingsDocument.findMany({
        where: { scopeType: "LOCATION", domain: "location.public_site" },
        select: { scopeId: true, payload: true },
    });
    let lifecycleTablePresent = true;
    let bindings: Array<{ locationId: string; hostname: string; role: string; status: string }> = [];
    try {
        bindings = await db.publicSiteDomain.findMany({
            where: { status: { not: "RELEASED" } },
            select: { locationId: true, hostname: true, role: true, status: true },
        });
    } catch (error: any) {
        if (error?.code !== "P2021") throw error;
        lifecycleTablePresent = false;
    }
    const documentByLocation = new Map(documents.map((item) => [item.scopeId, (item.payload as any)?.domain || null]));
    const report = locations.map((location) => {
        const locationBindings = bindings.filter((item) => item.locationId === location.id);
        const canonical = locationBindings.find((item) => item.role === "CANONICAL" && item.status === "ACTIVE")?.hostname || null;
        const values = [canonical, location.siteConfig?.domain || null, location.domain || null, documentByLocation.get(location.id) || null];
        const distinct = Array.from(new Set(values.map((value) => value || null)));
        return {
            locationId: location.id,
            name: location.name,
            canonical,
            siteConfig: location.siteConfig?.domain || null,
            location: location.domain || null,
            settingsDocument: documentByLocation.get(location.id) || null,
            bindings: locationBindings,
            consistent: distinct.length <= 1,
        };
    });
    console.log(JSON.stringify({
        generatedAt: new Date().toISOString(),
        lifecycleTablePresent,
        conflicts: report.filter((item) => !item.consistent),
        locations: report,
    }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => db.$disconnect());
