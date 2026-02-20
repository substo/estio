export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        try {
            const { initWhatsAppLidResolveWorker } = await import('@/lib/queue/whatsapp-lid-resolve');
            await initWhatsAppLidResolveWorker();
            // const { initGhlSyncWorker } = await import('@/lib/queue/ghl-sync');
            // initGhlSyncWorker();
        } catch (err) {
            console.error('Failed to initialize queue workers:', err);
        }
    }
}
