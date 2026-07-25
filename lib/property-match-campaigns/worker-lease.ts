import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const PROPERTY_MATCH_WORKER_LEASE_STALE_MS = 5 * 60 * 1000;
const PROPERTY_MATCH_WORKER_HEARTBEAT_MS = 30 * 1000;

function leasePath(campaignId: string) {
  const key = createHash("sha256").update(campaignId).digest("hex").slice(0, 24);
  return path.join(os.tmpdir(), `estio-property-match-${key}.lock`);
}

export async function acquirePropertyMatchCampaignWorkerLease(campaignId: string) {
  const lockPath = leasePath(campaignId);
  const owner = `${process.pid}:${randomUUID()}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, "wx");
      await handle.writeFile(JSON.stringify({ owner, acquiredAt: Date.now() }));
      await handle.close();
      const heartbeat = setInterval(() => {
        const now = new Date();
        void fs.utimes(lockPath, now, now).catch(() => undefined);
      }, PROPERTY_MATCH_WORKER_HEARTBEAT_MS);
      heartbeat.unref();

      return {
        acquired: true as const,
        async release() {
          clearInterval(heartbeat);
          try {
            const current = JSON.parse(await fs.readFile(lockPath, "utf8"));
            if (current?.owner === owner) await fs.unlink(lockPath);
          } catch (error: any) {
            if (error?.code !== "ENOENT") {
              console.warn("[property-match-campaigns] worker lease release failed", {
                campaignId,
                error: error?.message || error,
              });
            }
          }
        },
      };
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      const stat = await fs.stat(lockPath).catch(() => null);
      if (!stat || Date.now() - stat.mtimeMs <= PROPERTY_MATCH_WORKER_LEASE_STALE_MS) {
        return { acquired: false as const };
      }
      await fs.unlink(lockPath).catch(() => undefined);
    }
  }

  return { acquired: false as const };
}
