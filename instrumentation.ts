function resolveProcessRole(): 'web' | 'scrape-worker' | 'all' {
    const explicitRole = process.env.PROCESS_ROLE?.trim();
    if (explicitRole === 'web' || explicitRole === 'scrape-worker' || explicitRole === 'all') {
        return explicitRole;
    }
    return process.env.NODE_ENV === 'production' ? 'web' : 'all';
}

export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const processRole = resolveProcessRole();
        console.log(`[QueueBootstrap] Initializing workers for role=${processRole}`);

        if (processRole !== 'scrape-worker') {
            try {
                const { initWhatsAppLidResolveWorker } = await import('@/lib/queue/whatsapp-lid-resolve');
                await initWhatsAppLidResolveWorker();
            } catch (err) {
                console.error('[QueueBootstrap] Failed to initialize WhatsApp LID worker:', err);
            }
        }

        if (processRole === 'scrape-worker' || processRole === 'all') {
            try {
                const { initScrapingWorker } = await import('@/lib/queue/scraping-queue');
                await initScrapingWorker();
            } catch (err) {
                console.error('[QueueBootstrap] Failed to initialize scraping worker:', err);
            }
        } else {
            console.log('[QueueBootstrap] Scraping worker disabled for this process role');
        }
    }
}
