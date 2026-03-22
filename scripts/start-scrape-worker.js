#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

function resolveInstrumentationPath() {
    const explicitPath = process.env.SCRAPE_WORKER_INSTRUMENTATION_PATH;
    const candidates = [];

    if (explicitPath) {
        candidates.push(path.resolve(process.cwd(), explicitPath));
    }

    candidates.push(
        path.resolve(process.cwd(), '.next/server/instrumentation.js'),
        path.resolve(process.cwd(), '.next/standalone/.next/server/instrumentation.js'),
    );

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    throw new Error(
        `Unable to locate built instrumentation bundle. Checked: ${candidates.join(', ')}`,
    );
}

async function main() {
    process.env.NODE_ENV = process.env.NODE_ENV || 'production';
    process.env.PROCESS_ROLE = 'scrape-worker';
    process.env.NEXT_RUNTIME = process.env.NEXT_RUNTIME || 'nodejs';

    const instrumentationPath = resolveInstrumentationPath();
    console.log(`[ScrapeWorkerBootstrap] Loading instrumentation from ${instrumentationPath}`);

    const instrumentationModule = await import(pathToFileURL(instrumentationPath).href);
    const register =
        (instrumentationModule && instrumentationModule.register) ||
        (instrumentationModule &&
            instrumentationModule.default &&
            instrumentationModule.default.register);

    if (typeof register !== 'function') {
        throw new Error('Instrumentation bundle does not export register()');
    }

    await register();
    console.log('[ScrapeWorkerBootstrap] Scrape worker runtime initialized.');

    process.on('SIGINT', () => {
        console.log('[ScrapeWorkerBootstrap] Received SIGINT.');
    });
    process.on('SIGTERM', () => {
        console.log('[ScrapeWorkerBootstrap] Received SIGTERM.');
    });

    // Keep process alive while BullMQ workers consume jobs.
    setInterval(() => {}, 60_000);
}

main().catch((error) => {
    console.error('[ScrapeWorkerBootstrap] Failed to start:', error);
    process.exit(1);
});
