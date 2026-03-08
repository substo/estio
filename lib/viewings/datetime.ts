const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/;
const ISO_WITH_TIMEZONE_PATTERN = /(Z|[+-]\d{2}:?\d{2})$/i;

export type ViewingDateTimeParseSource =
    | "local_with_timezone"
    | "iso_with_offset"
    | "naive_with_agent_timezone";

export type ViewingDateTimeValidationErrorCode =
    | "MISSING_DATETIME"
    | "MISSING_TIMEZONE"
    | "INVALID_TIMEZONE"
    | "INVALID_LOCAL_DATETIME"
    | "INVALID_ABSOLUTE_DATETIME"
    | "DST_INVALID_LOCAL_TIME"
    | "DST_AMBIGUOUS_LOCAL_TIME";

export class ViewingDateTimeValidationError extends Error {
    readonly code: ViewingDateTimeValidationErrorCode;
    readonly details: Record<string, unknown>;

    constructor(
        code: ViewingDateTimeValidationErrorCode,
        message: string,
        details: Record<string, unknown> = {}
    ) {
        super(message);
        this.name = "ViewingDateTimeValidationError";
        this.code = code;
        this.details = details;
    }
}

type LocalDateTimeParts = {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
};

export type ParsedViewingDateTime = {
    utcDate: Date;
    scheduledTimeZone: string;
    scheduledLocal: string;
    source: ViewingDateTimeParseSource;
};

const zonedDateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>();

function pad2(value: number): string {
    return String(value).padStart(2, "0");
}

function trimToNull(value: unknown): string | null {
    const trimmed = String(value || "").trim();
    return trimmed ? trimmed : null;
}

function getZonedDateTimeFormatter(timeZone: string): Intl.DateTimeFormat {
    const cached = zonedDateTimeFormatterCache.get(timeZone);
    if (cached) return cached;

    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
    });

    zonedDateTimeFormatterCache.set(timeZone, formatter);
    return formatter;
}

function parseLocalDateTimeParts(rawInput: string): LocalDateTimeParts {
    const value = String(rawInput || "").trim();
    const match = value.match(LOCAL_DATE_TIME_PATTERN);
    if (!match) {
        throw new ViewingDateTimeValidationError(
            "INVALID_LOCAL_DATETIME",
            `Invalid local datetime format: ${value}`,
            { local: value }
        );
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6] || "0");

    const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    const isValid =
        parsed.getUTCFullYear() === year &&
        parsed.getUTCMonth() + 1 === month &&
        parsed.getUTCDate() === day &&
        parsed.getUTCHours() === hour &&
        parsed.getUTCMinutes() === minute &&
        parsed.getUTCSeconds() === second;

    if (!isValid) {
        throw new ViewingDateTimeValidationError(
            "INVALID_LOCAL_DATETIME",
            `Invalid local datetime value: ${value}`,
            { local: value }
        );
    }

    return { year, month, day, hour, minute, second };
}

function formatLocalDateTimeParts(parts: LocalDateTimeParts, includeSeconds: boolean = false): string {
    const base = `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}`;
    if (!includeSeconds) return base;
    return `${base}:${pad2(parts.second)}`;
}

function getZonedDateTimeParts(date: Date, timeZone: string): LocalDateTimeParts {
    const formatter = getZonedDateTimeFormatter(timeZone);
    const parts = formatter.formatToParts(date);

    const year = Number(parts.find((part) => part.type === "year")?.value);
    const month = Number(parts.find((part) => part.type === "month")?.value);
    const day = Number(parts.find((part) => part.type === "day")?.value);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    const second = Number(parts.find((part) => part.type === "second")?.value);

    if (
        !Number.isFinite(year) ||
        !Number.isFinite(month) ||
        !Number.isFinite(day) ||
        !Number.isFinite(hour) ||
        !Number.isFinite(minute) ||
        !Number.isFinite(second)
    ) {
        throw new Error(`Failed to extract zoned datetime parts for ${timeZone}`);
    }

    return { year, month, day, hour, minute, second };
}

function getTimeZoneOffsetMinutesAtInstant(instant: Date, timeZone: string): number {
    const zoned = getZonedDateTimeParts(instant, timeZone);
    const zonedAsUtc = Date.UTC(
        zoned.year,
        zoned.month - 1,
        zoned.day,
        zoned.hour,
        zoned.minute,
        zoned.second
    );
    return Math.round((zonedAsUtc - instant.getTime()) / 60000);
}

function isSameLocalDateTime(left: LocalDateTimeParts, right: LocalDateTimeParts): boolean {
    return (
        left.year === right.year &&
        left.month === right.month &&
        left.day === right.day &&
        left.hour === right.hour &&
        left.minute === right.minute &&
        left.second === right.second
    );
}

function findUtcCandidatesForLocalDateTime(local: LocalDateTimeParts, timeZone: string): number[] {
    const localAsUtcMs = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    const offsets = new Set<number>();

    // Capture offsets around the target day so DST transitions are covered.
    for (let deltaMinutes = -36 * 60; deltaMinutes <= 36 * 60; deltaMinutes += 30) {
        const probe = new Date(localAsUtcMs + deltaMinutes * 60_000);
        offsets.add(getTimeZoneOffsetMinutesAtInstant(probe, timeZone));
    }

    const candidates = new Set<number>();
    for (const offsetMinutes of offsets) {
        const utcMs = localAsUtcMs - offsetMinutes * 60_000;
        const actualLocal = getZonedDateTimeParts(new Date(utcMs), timeZone);
        if (isSameLocalDateTime(actualLocal, local)) {
            candidates.add(utcMs);
        }
    }

    return Array.from(candidates.values()).sort((a, b) => a - b);
}

export function isValidIanaTimeZone(rawTimeZone?: string | null): boolean {
    const value = trimToNull(rawTimeZone);
    if (!value) return false;

    try {
        new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
        return true;
    } catch {
        return false;
    }
}

export function normalizeIanaTimeZoneOrThrow(rawTimeZone?: string | null): string {
    const value = trimToNull(rawTimeZone);
    if (!value) {
        throw new ViewingDateTimeValidationError("MISSING_TIMEZONE", "Missing timezone for viewing scheduling.");
    }

    if (!isValidIanaTimeZone(value)) {
        throw new ViewingDateTimeValidationError("INVALID_TIMEZONE", `Invalid timezone: ${value}`, { timeZone: value });
    }

    return value;
}

function resolveUtcFromLocalOrThrow(localInput: string, timeZone: string): { utcDate: Date; scheduledLocal: string } {
    const local = parseLocalDateTimeParts(localInput);
    const candidates = findUtcCandidatesForLocalDateTime(local, timeZone);

    if (candidates.length === 0) {
        throw new ViewingDateTimeValidationError(
            "DST_INVALID_LOCAL_TIME",
            `Local time does not exist in timezone ${timeZone} due to DST transition.`,
            { local: formatLocalDateTimeParts(local, local.second !== 0), timeZone }
        );
    }

    if (candidates.length > 1) {
        throw new ViewingDateTimeValidationError(
            "DST_AMBIGUOUS_LOCAL_TIME",
            `Local time is ambiguous in timezone ${timeZone} due to DST transition.`,
            {
                local: formatLocalDateTimeParts(local, local.second !== 0),
                timeZone,
                utcCandidates: candidates.map((candidate) => new Date(candidate).toISOString()),
            }
        );
    }

    return {
        utcDate: new Date(candidates[0]),
        scheduledLocal: formatLocalDateTimeParts(local, local.second !== 0),
    };
}

export function formatDateTimeLocalInTimeZone(dateInput: Date | string, rawTimeZone: string, includeSeconds: boolean = false): string {
    const timeZone = normalizeIanaTimeZoneOrThrow(rawTimeZone);
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (Number.isNaN(date.getTime())) {
        throw new ViewingDateTimeValidationError("INVALID_ABSOLUTE_DATETIME", `Invalid datetime value: ${String(dateInput)}`);
    }

    const local = getZonedDateTimeParts(date, timeZone);
    return formatLocalDateTimeParts(local, includeSeconds);
}

export function getTimeZoneShortLabel(dateInput: Date | string, rawTimeZone: string, locale: string = "en-US"): string {
    const timeZone = normalizeIanaTimeZoneOrThrow(rawTimeZone);
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (Number.isNaN(date.getTime())) return timeZone;

    const parts = new Intl.DateTimeFormat(locale, {
        timeZone,
        timeZoneName: "short",
    }).formatToParts(date);

    return parts.find((part) => part.type === "timeZoneName")?.value || timeZone;
}

export function formatViewingDateTimeWithTimeZoneLabel(
    dateInput: Date | string,
    rawTimeZone: string,
    locale: string = "en-US"
): string {
    const timeZone = normalizeIanaTimeZoneOrThrow(rawTimeZone);
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (Number.isNaN(date.getTime())) {
        throw new ViewingDateTimeValidationError("INVALID_ABSOLUTE_DATETIME", `Invalid datetime value: ${String(dateInput)}`);
    }

    const dateText = new Intl.DateTimeFormat(locale, {
        timeZone,
        dateStyle: "medium",
        timeStyle: "short",
    }).format(date);
    const shortLabel = getTimeZoneShortLabel(date, timeZone, locale);

    return `${dateText} ${shortLabel} (${timeZone})`;
}

export function parseViewingDateTimeInput(input: {
    scheduledLocal?: string | null;
    scheduledTimeZone?: string | null;
    scheduledAtIso?: string | null;
    agentTimeZone?: string | null;
}): ParsedViewingDateTime {
    const scheduledLocal = trimToNull(input.scheduledLocal);
    const scheduledAtIso = trimToNull(input.scheduledAtIso);
    const effectiveTimeZoneInput = trimToNull(input.scheduledTimeZone) || trimToNull(input.agentTimeZone);

    if (!scheduledLocal && !scheduledAtIso) {
        throw new ViewingDateTimeValidationError("MISSING_DATETIME", "Missing viewing datetime input.");
    }

    const scheduledTimeZone = normalizeIanaTimeZoneOrThrow(effectiveTimeZoneInput);

    if (scheduledLocal) {
        const resolved = resolveUtcFromLocalOrThrow(scheduledLocal, scheduledTimeZone);
        return {
            utcDate: resolved.utcDate,
            scheduledTimeZone,
            scheduledLocal: resolved.scheduledLocal,
            source: "local_with_timezone",
        };
    }

    if (!scheduledAtIso) {
        throw new ViewingDateTimeValidationError("MISSING_DATETIME", "Missing viewing datetime input.");
    }

    if (ISO_WITH_TIMEZONE_PATTERN.test(scheduledAtIso)) {
        const parsed = new Date(scheduledAtIso);
        if (Number.isNaN(parsed.getTime())) {
            throw new ViewingDateTimeValidationError(
                "INVALID_ABSOLUTE_DATETIME",
                `Invalid ISO datetime: ${scheduledAtIso}`,
                { value: scheduledAtIso }
            );
        }

        return {
            utcDate: parsed,
            scheduledTimeZone,
            scheduledLocal: formatDateTimeLocalInTimeZone(parsed, scheduledTimeZone),
            source: "iso_with_offset",
        };
    }

    const resolved = resolveUtcFromLocalOrThrow(scheduledAtIso, scheduledTimeZone);
    return {
        utcDate: resolved.utcDate,
        scheduledTimeZone,
        scheduledLocal: resolved.scheduledLocal,
        source: "naive_with_agent_timezone",
    };
}
