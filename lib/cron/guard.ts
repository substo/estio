import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const LOCK_DIR = '/tmp';
const STALE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

export class CronGuard {
    private jobName: string;
    private lockFile: string;

    constructor(jobName: string) {
        this.jobName = jobName;
        this.lockFile = path.join(LOCK_DIR, `estio-cron-${jobName}.lock`);
    }

    /**
     * Checks if system has enough resources to run this job.
     * @param minFreeMB Minimum free RAM in MB (default: 500)
     * @param maxLoad Maximum load average (default: 4.0)
     */
    async checkResources(minFreeMB = 500, maxLoad = 4.0): Promise<{ ok: boolean; reason?: string }> {
        const freeMemMB = os.freemem() / 1024 / 1024;
        const loadAvg = os.loadavg()[0]; // 1 minute load average

        if (freeMemMB < minFreeMB) {
            return { ok: false, reason: `Low memory: ${freeMemMB.toFixed(0)}MB free (min: ${minFreeMB}MB)` };
        }

        if (loadAvg > maxLoad) {
            return { ok: false, reason: `High load: ${loadAvg.toFixed(2)} (max: ${maxLoad})` };
        }

        return { ok: true };
    }

    /**
     * Attempts to acquire a lock for this job.
     * Returns true if lock acquired, false if already running.
     */
    async acquire(): Promise<boolean> {
        try {
            // Check if lock exists
            try {
                const stats = await fs.stat(this.lockFile);
                const now = Date.now();
                const mtime = stats.mtimeMs;

                if (now - mtime < STALE_TIMEOUT_MS) {
                    // Lock is fresh, job is running
                    return false;
                } else {
                    // Lock is stale, assume crash and cleanup
                    console.warn(`[CronGuard:${this.jobName}] Removing stale lock (age: ${((now - mtime) / 60000).toFixed(1)}m)`);
                    await fs.unlink(this.lockFile).catch(() => { });
                }
            } catch (err: any) {
                if (err.code !== 'ENOENT') throw err;
            }

            // Create lock file
            await fs.writeFile(this.lockFile, JSON.stringify({
                pid: process.pid,
                timestamp: Date.now()
            }));

            return true;
        } catch (error) {
            console.error(`[CronGuard:${this.jobName}] Error acquiring lock:`, error);
            return false;
        }
    }

    /**
     * Releases the lock.
     */
    async release(): Promise<void> {
        try {
            await fs.unlink(this.lockFile);
        } catch (error: any) {
            if (error.code !== 'ENOENT') {
                console.error(`[CronGuard:${this.jobName}] Error releasing lock:`, error);
            }
        }
    }
}
