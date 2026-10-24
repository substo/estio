import { getClerkBrandKeys, getSubstoClerkConfigConflicts, hasClerkEncryptionKey } from "../../auth/clerk-runtime";
import { youtubeClientConfig } from "../../google/youtube-policy";
import { readStudioR2Config } from "../media-r2";
import { hasStudioSecretsKey } from "../secrets";
const refPattern = /^[a-z0-9]{10,40}$/;
function databaseTarget(raw: string | undefined): { projectRef: string | null; identity: string } | null {
 try {
  const url = new URL(raw ?? "");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.pathname || url.searchParams.get("sslmode") === "disable") return null;
  const direct = url.hostname.match(/^db\.([a-z0-9]{10,40})\.supabase\.co$/)?.[1];
  const pooled = url.hostname.endsWith(".pooler.supabase.com") ? decodeURIComponent(url.username).match(/^[a-zA-Z_][\w-]*\.([a-z0-9]{10,40})$/)?.[1] : null;
  const projectRef = direct || pooled || null;
  return { projectRef, identity: projectRef ? `supabase:${projectRef}:${url.pathname}` : `${url.hostname}:${url.port || "5432"}:${url.pathname}` };
 } catch { return null; }
}
export function buildStudioReleasePreflight(input: {
 env: NodeJS.ProcessEnv; projectRef: string; bucket: string; freeBytes: number;
 artifactBytes: number; backupSpoolBytes: number; mediaTempBytes: number;
 migrations: Array<{ name: string; sha256: string }>;
}) {
 const { env } = input;
 if (!refPattern.test(input.projectRef) || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(input.bucket) ||
  [input.freeBytes, input.artifactBytes, input.backupSpoolBytes, input.mediaTempBytes].some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error("invalid_preflight_input");
 const requiredFreeBytes = input.artifactBytes * 2 + input.backupSpoolBytes + input.mediaTempBytes + 1024 ** 3;
 if (!Number.isSafeInteger(requiredFreeBytes)) throw new Error("invalid_capacity_estimate");
 const checks: Array<{ name: string; ok: boolean }> = [];
 const check = (name: string, ok: unknown) => checks.push({ name, ok: Boolean(ok) });
 const studio = databaseTarget(env.STUDIO_DATABASE_URL), business = databaseTarget(env.DATABASE_URL);
 let apiTarget = false;
 try { const u = new URL(env.STUDIO_SUPABASE_URL ?? ""); apiTarget = u.origin === `https://${input.projectRef}.supabase.co` && u.pathname === "/" && !u.search && !u.hash && !u.username && !u.password; } catch {}
 check("pinned_studio_api_target", apiTarget && env.STUDIO_SUPABASE_SERVICE_ROLE_KEY?.trim());
 check("pinned_studio_database_target", studio?.projectRef === input.projectRef);
 check("business_database_separate", studio && business && studio.identity !== business.identity && studio.projectRef !== business.projectRef);
 check("dedicated_private_media_configuration", readStudioR2Config(env)?.bucket === input.bucket);
 check("studio_current_encryption_key", hasStudioSecretsKey(env));
 const estio = getClerkBrandKeys("estio", env), substo = getClerkBrandKeys("substo", env);
 check("distinct_clerk_key_values_present", estio && substo && estio.publishableKey !== substo.publishableKey && estio.secretKey !== substo.secretKey);
 check("substo_redirect_configuration", getSubstoClerkConfigConflicts(env).length === 0);
 check("clerk_encryption_configuration", hasClerkEncryptionKey(env));
 check("profile_webhook_values_present_and_distinct", env.ESTIO_CLERK_PROFILE_WEBHOOK_SECRET?.trim() && env.SUBSTO_CLERK_PROFILE_WEBHOOK_SECRET?.trim() &&
  env.ESTIO_CLERK_PROFILE_WEBHOOK_SECRET !== env.SUBSTO_CLERK_PROFILE_WEBHOOK_SECRET && env.ESTIO_CLERK_INSTANCE_ID?.trim() && env.SUBSTO_CLERK_INSTANCE_ID?.trim() && env.ESTIO_CLERK_INSTANCE_ID !== env.SUBSTO_CLERK_INSTANCE_ID);
 check("youtube_client_pair", youtubeClientConfig(env));
 check("cron_secret_present", env.CRON_SECRET?.trim());
 check("staging_backup_media_capacity", input.freeBytes >= requiredFreeBytes);
 check("migration_inventory", input.migrations.length >= 27 && input.migrations.every(m => /^\d{14}_[a-z0-9_]+\.sql$/.test(m.name) && /^[a-f0-9]{64}$/.test(m.sha256)) && new Set(input.migrations.map(m => m.name)).size === input.migrations.length);
 return { scope: "current-host-offline", configurationReady: checks.every(c => c.ok), releaseReady: false, checks,
  capacity: { freeBytes: input.freeBytes, requiredFreeBytes }, migrations: input.migrations,
  unverified: ["server_inventory_and_capacity_consumers", "dns_tls_caddy_and_clerk_realms", "live_database_identity_schema_grants", "media_privacy_cors_inventory_and_bytes",
   "offsite_backups_key_escrow_and_isolated_restore", "combined_web_worker_schema_rollback", "reviewed_import_and_cutover", "cross_brand_team_provider_browser_acceptance", "cron_installation_and_mac_off_processing", "authorized_deployment"] };
}
