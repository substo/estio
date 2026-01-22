export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        try {
            // const { initGhlSyncWorker } = await import('@/lib/queue/ghl-sync');
            // initGhlSyncWorker();
        } catch (err) {
            console.error('Failed to initialize GHL Sync Worker:', err);
        }
    }
}
