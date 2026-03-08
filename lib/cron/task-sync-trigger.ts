const DEFAULT_TASK_SYNC_TIMEOUT_MS = 3500;

function resolveTaskSyncBaseUrl(): string {
  const baseUrl =
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    'http://localhost:3000';
  return baseUrl.replace(/\/+$/, '');
}

export async function triggerTaskSyncCronNow(meta?: {
  source?: string;
  viewingId?: string;
  timeoutMs?: number;
}): Promise<void> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.warn('[task_sync_trigger_skipped]', {
      reason: 'missing_cron_secret',
      source: meta?.source || 'unknown',
      viewingId: meta?.viewingId || null,
    });
    return;
  }

  const timeoutMs = Math.max(1000, Math.min(meta?.timeoutMs || DEFAULT_TASK_SYNC_TIMEOUT_MS, 10000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${resolveTaskSyncBaseUrl()}/api/cron/task-sync`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        'x-estio-trigger-source': meta?.source || 'manual',
      },
      cache: 'no-store',
      signal: controller.signal,
    });

    const bodyText = await response.text();
    if (!response.ok) {
      console.warn('[task_sync_trigger_failed]', {
        status: response.status,
        source: meta?.source || 'unknown',
        viewingId: meta?.viewingId || null,
        durationMs: Date.now() - startedAt,
        body: bodyText.slice(0, 500),
      });
      return;
    }

    console.info('[task_sync_triggered]', {
      source: meta?.source || 'unknown',
      viewingId: meta?.viewingId || null,
      durationMs: Date.now() - startedAt,
      response: bodyText.slice(0, 500),
    });
  } catch (error) {
    console.warn('[task_sync_trigger_error]', {
      source: meta?.source || 'unknown',
      viewingId: meta?.viewingId || null,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timer);
  }
}
