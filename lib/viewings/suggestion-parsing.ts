const WEEKDAY_TO_INDEX: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
};

function pad2(value: number): string {
    return String(value).padStart(2, "0");
}

function parseIsoDateParts(isoDate: string): { year: number; month: number; day: number } | null {
    const match = String(isoDate || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
        parsed.getUTCFullYear() !== year ||
        parsed.getUTCMonth() + 1 !== month ||
        parsed.getUTCDate() !== day
    ) {
        return null;
    }

    return { year, month, day };
}

export function normalizeIanaTimeZone(rawTimeZone?: string | null): string {
    const trimmed = String(rawTimeZone || "").trim();
    if (!trimmed) return "UTC";

    try {
        new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).format(new Date());
        return trimmed;
    } catch {
        return "UTC";
    }
}

export function formatIsoDateInTimeZone(date: Date, rawTimeZone?: string | null): string {
    const timeZone = normalizeIanaTimeZone(rawTimeZone);
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });

    const parts = formatter.formatToParts(date);
    const year = Number(parts.find((part) => part.type === "year")?.value);
    const month = Number(parts.find((part) => part.type === "month")?.value);
    const day = Number(parts.find((part) => part.type === "day")?.value);

    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
        return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
    }

    return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function shiftIsoDate(isoDate: string, dayOffset: number): string | null {
    const parts = parseIsoDateParts(isoDate);
    if (!parts) return null;

    const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + dayOffset));
    return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

function getWeekdayIndexInTimeZone(date: Date, rawTimeZone?: string | null): number {
    const timeZone = normalizeIanaTimeZone(rawTimeZone);
    const weekdayLabel = new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "long",
    })
        .format(date)
        .toLowerCase();

    return WEEKDAY_TO_INDEX[weekdayLabel] ?? date.getUTCDay();
}

export function normalizeViewingDate(rawDate?: string | null): string | null {
    const value = String(rawDate || "").trim();
    if (!value) return null;

    const isoMatch = value.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (isoMatch?.[1] && parseIsoDateParts(isoMatch[1])) {
        return isoMatch[1];
    }

    return null;
}

export function extractClockTimeFromText(text: string): string | null {
    const raw = String(text || "");
    const amPmMatch = raw.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
    if (amPmMatch) {
        let hour = Number(amPmMatch[1]);
        const minute = Number(amPmMatch[2] || "0");
        const meridiem = amPmMatch[3].toLowerCase();

        if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
        if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;

        if (meridiem === "am") {
            if (hour === 12) hour = 0;
        } else if (hour !== 12) {
            hour += 12;
        }

        return `${pad2(hour)}:${pad2(minute)}`;
    }

    const twentyFourHourMatch = raw.match(/\b(\d{1,2}):(\d{2})\b/);
    if (twentyFourHourMatch) {
        const hour = Number(twentyFourHourMatch[1]);
        const minute = Number(twentyFourHourMatch[2]);
        if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
        if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
        return `${pad2(hour)}:${pad2(minute)}`;
    }

    return null;
}

export function normalizeViewingTime(rawTime?: string | null): string | null {
    const value = String(rawTime || "").trim();
    if (!value) return null;

    const exactMatch = value.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if (exactMatch) {
        return `${pad2(Number(exactMatch[1]))}:${exactMatch[2]}`;
    }

    return extractClockTimeFromText(value);
}

export function resolveRelativeViewingDateFromText(args: {
    text: string;
    anchorDate: Date;
    timeZone?: string | null;
}): string | null {
    const lower = String(args.text || "").toLowerCase();
    const anchorIsoDate = formatIsoDateInTimeZone(args.anchorDate, args.timeZone);

    if (/\btomorrow\b/.test(lower)) {
        return shiftIsoDate(anchorIsoDate, 1);
    }

    if (/\btoday\b/.test(lower)) {
        return anchorIsoDate;
    }

    let bestMatch: { index: number; weekday: number } | null = null;
    for (const [weekdayName, weekdayIndex] of Object.entries(WEEKDAY_TO_INDEX)) {
        const index = lower.lastIndexOf(weekdayName);
        if (index >= 0 && (!bestMatch || index > bestMatch.index)) {
            bestMatch = { index, weekday: weekdayIndex };
        }
    }

    if (!bestMatch) return null;

    const anchorWeekday = getWeekdayIndexInTimeZone(args.anchorDate, args.timeZone);
    const delta = (bestMatch.weekday - anchorWeekday + 7) % 7;
    const dayOffset = delta === 0 ? 7 : delta;
    return shiftIsoDate(anchorIsoDate, dayOffset);
}

export function extractPropertyRefsFromText(text: string): string[] {
    const refs = new Set<string>();
    const refRegex = /\b(?:ref(?:erence)?[.:#\s-]*)?([A-Z]{1,4}\d{2,6}|[A-Z]{2,6}-\d{2,6})\b/gi;
    let match: RegExpExecArray | null;

    while ((match = refRegex.exec(String(text || ""))) !== null) {
        refs.add(match[1].toUpperCase());
    }

    return Array.from(refs);
}

export function extractPropertySlugsFromUrls(text: string): string[] {
    const slugs = new Set<string>();
    const urlRegex = /https?:\/\/[^\s]+/gi;
    const matches = String(text || "").match(urlRegex) || [];

    for (const rawUrl of matches) {
        try {
            const parsed = new URL(rawUrl);
            const parts = parsed.pathname.split("/").filter(Boolean);
            if (parts.length === 0) continue;
            const last = parts[parts.length - 1];
            if (last) slugs.add(last.toLowerCase());
        } catch {
            // Ignore malformed URLs.
        }
    }

    return Array.from(slugs);
}

export function extractPropertySlugCandidatesFromText(text: string): string[] {
    const matches = String(text || "").toLowerCase().match(/\b[a-z0-9]+(?:-[a-z0-9]+)+\b/g) || [];
    const unique = new Set<string>();

    for (const match of matches) {
        // Keep realistic slug-like tokens and avoid numeric time fragments.
        if (!/[a-z]/.test(match)) continue;
        if (match.length < 5) continue;
        unique.add(match);
    }

    return Array.from(unique);
}
