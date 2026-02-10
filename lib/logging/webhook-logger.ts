import fs from 'fs';
import path from 'path';

const LOG_DIR = process.env.WEBHOOK_LOG_DIR || '/tmp/evolution-logs';

/**
 * Log Evolution API webhook payloads to files for debugging.
 * Enable by setting ENABLE_WEBHOOK_LOGGING=true in .env
 * 
 * Files are saved as: {timestamp}_{eventType}.json
 * Example: 2026-02-09T19-30-00-000Z_MESSAGES_UPSERT.json
 */
export function logWebhookPayload(eventType: string, payload: any) {
    if (process.env.ENABLE_WEBHOOK_LOGGING !== 'true') return;

    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safeEventType = eventType.replace(/[^a-zA-Z0-9_-]/g, '_');
        const filename = `${timestamp}_${safeEventType}.json`;
        const filepath = path.join(LOG_DIR, filename);

        fs.mkdirSync(LOG_DIR, { recursive: true });
        fs.writeFileSync(filepath, JSON.stringify(payload, null, 2));

        console.log(`[Webhook Logger] Saved payload to ${filepath}`);
    } catch (err) {
        console.error('[Webhook Logger] Failed to write log:', err);
    }
}

/**
 * Cleanup old log files (files older than specified days)
 * Call this periodically or manually to prevent disk fill.
 */
export function cleanupOldLogs(maxAgeDays: number = 7) {
    if (!fs.existsSync(LOG_DIR)) return;

    const now = Date.now();
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

    try {
        const files = fs.readdirSync(LOG_DIR);
        let deleted = 0;

        for (const file of files) {
            const filepath = path.join(LOG_DIR, file);
            const stat = fs.statSync(filepath);

            if (now - stat.mtimeMs > maxAgeMs) {
                fs.unlinkSync(filepath);
                deleted++;
            }
        }

        if (deleted > 0) {
            console.log(`[Webhook Logger] Cleaned up ${deleted} old log files`);
        }
    } catch (err) {
        console.error('[Webhook Logger] Cleanup failed:', err);
    }
}
