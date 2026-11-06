/** JSON command on stdin. Use the existing private worker env, never tokens on the command line.
 * An external-work report (externalCommand), or {"action":"story","id":"<Build record id>","story":{...}} to set the
 * readable story of any Build record.
 * --database uses the configured DATABASE_URL authority for an operator registration before route deployment.
 */
import { readFileSync } from "node:fs";
import { externalCommand, storyCommand } from "../lib/build/external";
async function main() {
  const raw = JSON.parse(readFileSync(0, "utf8"));
  const input = raw?.action === "story" ? storyCommand.parse(raw) : externalCommand.parse(raw);
  if (process.argv.includes("--database")) {
    // Existing operator database authority; no queue approval/lease is manufactured.
    const { PrismaClient } = await import("@prisma/client");
    const { setStory, trackExternal } = await import("../lib/build/external");
    const db = new PrismaClient();
    try {
      const result = await db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(741903211)`;
        return "action" in input ? setStory(tx, input.id, input.story, "worker") : trackExternal(tx, input);
      });
      console.log(JSON.stringify(result));
    } finally { await db.$disconnect(); }
    return;
  }
  const origin = new URL(process.env.BUILD_ORIGIN ?? "http://localhost:3000");
  if ((origin.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(origin.hostname)) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Invalid Build origin");
  const secret = process.env.BUILD_WORKER_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error("Worker credential required");
  const result = await fetch(new URL("/api/build/external", origin), { method: "POST", redirect: "error", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(30000) });
  if (!result.ok) throw new Error(`Tracking HTTP ${result.status}`);
  console.log(JSON.stringify(await result.json()));
}
main().catch(() => { console.error("External tracking failed; check command, revision, credentials and database/endpoint availability. No execution was queued."); process.exitCode = 1; });
