import { access, readFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";
import tls from "node:tls";
import path from "node:path";
import { parseArgs } from "node:util";
import { parseDeviceTunnelCanaryScopes } from "../../lib/device-tunnel/canary-control";
import {
    DEVICE_TUNNEL_TRUSTED_HOST_SUFFIXES_ENV,
    isDeviceTunnelAndroidTrustedHostname,
    parseDeviceTunnelGatewayHostSuffixes,
    validateTrustedDeviceTunnelGatewayUrl,
} from "../../lib/device-tunnel/gateway-url";
import { validateSessionAuthKmsKeyName } from "../../lib/whatsapp/session-auth-kms";
import { getSessionAuthObjectStoreConfig } from "../../lib/whatsapp/session-auth-object-store";

type Check = { code: string; ok: boolean; detail?: string };
async function main() {
const { values } = parseArgs({
    options: {
        database: { type: "boolean", default: false },
        network: { type: "boolean", default: false },
        "session-dir": { type: "string" },
    },
    strict: true,
});
const checks: Check[] = [];
function check(code: string, fn: () => void, detail?: string) {
    try { fn(); checks.push({ code, ok: true, ...(detail ? { detail } : {}) }); }
    catch (error: any) { checks.push({ code, ok: false, detail: String(error?.message || error).slice(0, 160) }); }
}

const nodeId = String(process.env.DEVICE_TUNNEL_GATEWAY_NODE_ID || "").trim();
check("stable_node_id", () => {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(nodeId)) throw new Error("stable node ID is missing or invalid");
});
check("trusted_node_url", () => {
    const trustedUrl = validateTrustedDeviceTunnelGatewayUrl({
        value: String(process.env.DEVICE_TUNNEL_PUBLIC_URL || ""),
        trustedHostSuffixes: parseDeviceTunnelGatewayHostSuffixes(process.env[DEVICE_TUNNEL_TRUSTED_HOST_SUFFIXES_ENV]),
        production: true,
    });
    if (!isDeviceTunnelAndroidTrustedHostname(new URL(trustedUrl).hostname)) {
        throw new Error("node hostname is outside the Android estio.co trust boundary");
    }
});
check("canary_scope_parse", () => { parseDeviceTunnelCanaryScopes(); });
check("kms_key_shape", () => { validateSessionAuthKmsKeyName(String(process.env.WHATSAPP_SESSION_AUTH_KMS_KEY_PATH || "")); });
check("r2_dedicated_configuration", () => { getSessionAuthObjectStoreConfig(); });
const rawSessionDir = String(values["session-dir"] || process.env.WHATSAPP_WEB_BRIDGE_SESSION_DIR || "").trim();
const sessionDir = rawSessionDir ? path.resolve(rawSessionDir) : "";
check("session_directory_safety", () => {
    if (!rawSessionDir || !path.isAbsolute(rawSessionDir) || sessionDir === "/" || sessionDir.split(path.sep).length < 4) {
        throw new Error("session directory must be a dedicated absolute path");
    }
    for (const releaseName of ["estio-app", "estio-app-blue", "estio-app-green", ".next"]) {
        if (sessionDir.split(path.sep).includes(releaseName)) throw new Error("session directory is inside a release path");
    }
});
const migrationPath = path.resolve("prisma/migrations/20260720120000_whatsapp_session_auth_placement/migration.sql");
check("migration_file", () => { if (!migrationPath.endsWith("migration.sql")) throw new Error("migration path is invalid"); });
await access(migrationPath).catch(() => checks.push({ code: "migration_file_access", ok: false, detail: "migration file is missing" }));
if (await readFile(migrationPath, "utf8").catch(() => "")) checks.push({ code: "migration_file_access", ok: true });

if (values.network) {
    try {
        const gatewayUrl = new URL(validateTrustedDeviceTunnelGatewayUrl({
            value: String(process.env.DEVICE_TUNNEL_PUBLIC_URL || ""),
            trustedHostSuffixes: parseDeviceTunnelGatewayHostSuffixes(process.env[DEVICE_TUNNEL_TRUSTED_HOST_SUFFIXES_ENV]),
            production: true,
        }));
        const addresses = await lookup(gatewayUrl.hostname, { all: true, verbatim: true });
        if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
            throw new Error("node DNS returned a non-public or invalid address");
        }
        await Promise.all(addresses.map(async ({ address, family }) => {
            await verifyTls(gatewayUrl.hostname, address, family);
            await verifyNoRedirect(gatewayUrl, address, family);
        }));
        checks.push({ code: "dns_tls_no_redirect", ok: true });
    } catch (error: any) {
        checks.push({ code: "dns_tls_no_redirect", ok: false, detail: String(error?.message || error).slice(0, 160) });
    }
}

if (values.database) {
    const { default: db } = await import("../../lib/db");
    try {
        const rows = await (db as any).$queryRawUnsafe(`
            SELECT migration_name, finished_at, rolled_back_at
            FROM "_prisma_migrations"
            WHERE migration_name = '20260720120000_whatsapp_session_auth_placement'
        `);
        checks.push({
            code: "migration_database_state",
            ok: Array.isArray(rows) && rows.length <= 1 && !rows.some((row: any) => row.rolled_back_at),
            detail: rows.length === 0 ? "pending" : "applied",
        });
        const invalid = await (db as any).$queryRawUnsafe(`
            SELECT COUNT(*)::int AS count
            FROM "DeviceTunnelBinding" b
            JOIN "WhatsAppWebBridgeSession" s ON s."id" = b."sessionId"
            WHERE b."locationId" <> s."locationId"
        `);
        checks.push({ code: "binding_tenant_isolation", ok: Number(invalid?.[0]?.count || 0) === 0 });
    } catch (error: any) {
        checks.push({ code: "database_read_only_checks", ok: false, detail: String(error?.message || error).slice(0, 160) });
    } finally {
        await (db as any).$disconnect?.();
    }
}

const report = { ok: checks.every((item) => item.ok), mutationPerformed: false, checks };
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;
}

void main().catch((error) => {
    console.error(String(error?.message || error).slice(0, 200));
    process.exitCode = 1;
});

function isPublicAddress(address: string) {
    const family = isIP(address);
    if (family === 4) {
        const [a, b, c] = address.split(".").map(Number);
        return !(a === 0 || a === 10 || a === 127 || a >= 224
            || (a === 100 && b >= 64 && b <= 127)
            || (a === 169 && b === 254)
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && (b === 168 || (b === 0 && c === 2)))
            || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
            || (a === 203 && b === 0 && c === 113));
    }
    if (family === 6) {
        const value = address.toLowerCase();
        return value !== "::" && value !== "::1" && !value.startsWith("fc") && !value.startsWith("fd")
            && !/^fe[89ab]/.test(value) && !value.startsWith("2001:db8:");
    }
    return false;
}

function verifyTls(hostname: string, address: string, _family: number) {
    return new Promise<void>((resolve, reject) => {
        const socket = tls.connect({ host: address, port: 443, servername: hostname, rejectUnauthorized: true });
        const timer = setTimeout(() => socket.destroy(new Error("TLS readiness timed out")), 8_000);
        socket.once("secureConnect", () => { clearTimeout(timer); socket.end(); resolve(); });
        socket.once("error", (error) => { clearTimeout(timer); reject(error); });
    });
}

function verifyNoRedirect(url: URL, address: string, family: number) {
    return new Promise<void>((resolve, reject) => {
        const request = https.request({
            protocol: "https:", hostname: url.hostname, servername: url.hostname, port: 443,
            path: `${url.pathname}/health`, method: "GET", timeout: 8_000,
            lookup: (_hostname, _options, callback) => callback(null, address, family as 4 | 6),
        }, (response) => {
            response.resume();
            const status = Number(response.statusCode || 0);
            if (status >= 300 && status < 400) reject(new Error("node endpoint returned a redirect"));
            else if (![200, 401, 426].includes(status)) reject(new Error(`node endpoint readiness failed (${status})`));
            else resolve();
        });
        request.once("timeout", () => request.destroy(new Error("node endpoint readiness timed out")));
        request.once("error", reject);
        request.end();
    });
}
