const BAZARAKI_ORIGIN = 'https://www.bazaraki.com';
const ABSOLUTE_URL_SCHEME = /^[a-z][a-z\d+.-]*:/i;

function normalizeAbsoluteUrl(url: string): string {
    try {
        const parsed = new URL(url);
        parsed.hash = '';
        return parsed.toString();
    } catch {
        return url.trim();
    }
}

export function normalizeUrlForPlatform(
    url: string,
    platform?: string | null,
): string {
    const trimmed = String(url || '').trim();
    if (!trimmed) return '';

    if (platform !== 'bazaraki') {
        return normalizeAbsoluteUrl(trimmed);
    }

    if (trimmed.startsWith('//')) {
        return normalizeAbsoluteUrl(`https:${trimmed}`);
    }

    if (ABSOLUTE_URL_SCHEME.test(trimmed)) {
        return normalizeAbsoluteUrl(trimmed);
    }

    const path = trimmed.startsWith('/') ? trimmed : `/${trimmed.replace(/^\/+/, '')}`;
    return normalizeAbsoluteUrl(`${BAZARAKI_ORIGIN}${path}`);
}

export function normalizeTargetUrls(
    urls: string[] | null | undefined,
    platform?: string | null,
): string[] {
    const seen = new Set<string>();
    const normalized: string[] = [];

    for (const raw of urls || []) {
        const next = normalizeUrlForPlatform(raw, platform);
        if (!next || seen.has(next)) continue;
        seen.add(next);
        normalized.push(next);
    }

    return normalized;
}

export function buildCrawlVisitKey(url: string): string {
    const trimmed = String(url || '').trim();
    if (!trimmed) return '';

    try {
        const parsed = new URL(trimmed);
        parsed.hash = '';
        parsed.hostname = parsed.hostname.toLowerCase();
        if (parsed.pathname.length > 1) {
            parsed.pathname = parsed.pathname.replace(/\/+$/, '');
        }

        const entries = Array.from(parsed.searchParams.entries())
            .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
                if (leftKey === rightKey) return leftValue.localeCompare(rightValue);
                return leftKey.localeCompare(rightKey);
            });

        parsed.search = '';
        for (const [key, value] of entries) {
            parsed.searchParams.append(key, value);
        }

        return parsed.toString();
    } catch {
        return trimmed.toLowerCase();
    }
}
