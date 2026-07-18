import db from "../lib/db";
import { claimPublicSiteDomain, enqueuePublicSiteDomainJob } from "../lib/public-site-domains/service";
import { processPublicSiteDomainJob } from "../lib/public-site-domains/provisioning";

const LOCATION_ID = "cmingx6b10008rdycg7hwesyn";
const HOSTNAME = "downtowncyprus.substo.com";

async function main() {
    const apply = process.argv.includes("--apply");
    const location = await db.location.findUnique({ where: { id: LOCATION_ID }, select: { id: true, name: true } });
    if (!location) throw new Error("Downtown Cyprus location was not found.");
    console.log(JSON.stringify({ apply, location, hostname: HOSTNAME }, null, 2));
    if (!apply) return;

    const binding = await claimPublicSiteDomain({ locationId: LOCATION_ID, hostname: HOSTNAME });
    await db.publicSiteDomain.update({
        where: { id: binding.id },
        data: { status: "VERIFIED", verifiedAt: new Date(), provisioningError: null },
    });
    const job = await enqueuePublicSiteDomainJob({ locationId: LOCATION_ID, domainId: binding.id, operation: "PROVISION" });
    await processPublicSiteDomainJob(job.id);
    const restored = await db.publicSiteDomain.findUniqueOrThrow({ where: { id: binding.id } });
    console.log(JSON.stringify({ restored: true, domainId: restored.id, hostname: restored.hostname, status: restored.status }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => db.$disconnect());
