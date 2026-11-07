import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const MIGRATION_GUARD_TEST = "scripts/test-credential-migrations-db.sh"; // builds a throwaway schema with the old columns

/**
 * Credentials live in encrypted settings secrets (documentation/credentials.md). This contract keeps code from
 * reading or writing the legacy credential columns again.
 *
 * - RETIRED: no code names the column at all (the one-time move script may, through raw SQL).
 * - TRANSITION: awaiting a copy before its drop; only the listed fallback/cleanup files may name it.
 */
const root = process.cwd();

const RETIRED_USER_COLUMNS = [
    "googleAccessToken",
    "googleRefreshToken",
    "googleSyncToken",
    "outlookAccessToken",
    "outlookRefreshToken",
    "outlookPasswordEncrypted",
    "outlookSessionCookies",
    "whatsappWebhookSecret",
];

// Nothing is in transition any more; add entries here only for a column awaiting a copy.
const TRANSITION_COLUMNS: Record<string, string[]> = {};

function filesNaming(name: string): string[] {
    const out = execFileSync("git", ["grep", "-l", "--untracked", "-w", name, "--", "app", "lib", "scripts", "components"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).toString();
    return out.split("\n").filter(Boolean);
}

function safeFilesNaming(name: string): string[] {
    try { return filesNaming(name); } catch { return []; } // git grep exits 1 when nothing matches
}

const isThisTest = (file: string) => /\.test\.ts$/.test(file); // tests may name columns in assertions

test("retired Google/Outlook token columns are never named in code", () => {
    for (const column of RETIRED_USER_COLUMNS) {
        const hits = safeFilesNaming(column).filter(file => file !== MIGRATION_GUARD_TEST && !isThisTest(file));
        assert.deepEqual(hits, [], `${column} is still referenced`);
    }
});

test("transition columns are only named by their fallback/cleanup code and the move script", () => {
    for (const [column, allowed] of Object.entries(TRANSITION_COLUMNS)) {
        const hits = safeFilesNaming(column).filter(file => file !== MIGRATION_GUARD_TEST && !isThisTest(file) && !allowed.includes(file));
        assert.deepEqual(hits, [], `${column} is referenced outside ${allowed.join(", ")}`);
    }
});

test("no Prisma query selects or filters User.crmUsername / User.crmPassword", () => {
    // These names survive as form fields and function parameters; only Prisma-shaped use of the columns is banned.
    const prismaShaped = /\bcrm(?:Username|Password):\s*(?:true\b|\{\s*not\b)|\b(?:user|dbUser|privateUser|context\.user)\??\.crm(?:Username|Password)\b/;
    for (const column of ["crmUsername", "crmPassword"]) {
        for (const file of safeFilesNaming(column)) {
            if (file === MIGRATION_GUARD_TEST || isThisTest(file)) continue;
            const source = readFileSync(`${root}/${file}`, "utf8");
            assert.doesNotMatch(source, prismaShaped, `${file} uses a ${column} column`);
        }
    }
});

test("every Old CRM credential reader goes through lib/crm/credentials.ts", () => {
    for (const file of [
        "lib/crm/old-crm-import.ts",
        "lib/crm/crm-pusher.ts",
        "lib/crm/crm-lead-puller.ts",
        "lib/crm/old-crm-property-pull-service.ts",
        "lib/crm/import-workflow.ts",
        "app/(main)/admin/properties/import/actions.ts",
        "app/(main)/admin/settings/crm/actions.ts",
        "lib/ai/property-evidence-resolver/service.ts",
    ]) {
        assert.match(readFileSync(`${root}/${file}`, "utf8"), /from ["']@\/lib\/crm\/credentials["']|from ["']\.\/credentials["']/, file);
    }
});

test("the Prisma schema no longer declares the retired columns", () => {
    const schema = readFileSync(`${root}/prisma/schema.prisma`, "utf8");
    const userModel = schema.slice(schema.indexOf("model User {"), schema.indexOf("\n}", schema.indexOf("model User {")));
    const locationModel = schema.slice(schema.indexOf("model Location {"), schema.indexOf("\n}", schema.indexOf("model Location {")));
    for (const column of [...RETIRED_USER_COLUMNS, "crmUsername", "crmPassword"]) {
        assert.doesNotMatch(userModel, new RegExp(`^\\s+${column}\\s`, "m"), column);
        assert.doesNotMatch(locationModel, new RegExp(`^\\s+${column}\\s`, "m"), column);
    }
});
