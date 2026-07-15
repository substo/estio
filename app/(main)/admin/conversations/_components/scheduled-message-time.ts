export function toDatetimeLocalValue(date: Date) {
    const pad = (value: number) => String(value).padStart(2, "0");
    return [
        date.getFullYear(),
        "-",
        pad(date.getMonth() + 1),
        "-",
        pad(date.getDate()),
        "T",
        pad(date.getHours()),
        ":",
        pad(date.getMinutes()),
    ].join("");
}

export function getBrowserTimeZone() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch {
        return null;
    }
}

export function formatDeviceScheduleClock(timeZone: string | null, now = new Date()) {
    try {
        return now.toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            ...(timeZone ? { timeZone } : {}),
        });
    } catch {
        return now.toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
        });
    }
}

export function parseDatetimeLocalValue(value: string) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!match) return null;
    const [, year, month, day, hour, minute] = match;
    const date = new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        0,
        0
    );
    if (!Number.isFinite(date.getTime())) return null;
    return date;
}

export function getDefaultScheduleLocalValue(nowMs = Date.now()) {
    const date = new Date(nowMs + 60 * 60 * 1000);
    date.setMinutes(Math.ceil(date.getMinutes() / 5) * 5, 0, 0);
    return toDatetimeLocalValue(date);
}

export function getScheduleDelayLocalValue(minutes: number, nowMs = Date.now()) {
    return toDatetimeLocalValue(new Date(nowMs + minutes * 60 * 1000));
}

export function getScheduleTimingWarning(localValue: string, nowMs = Date.now()) {
    const date = parseDatetimeLocalValue(localValue);
    if (!date) return null;
    const diffMs = date.getTime() - nowMs;
    if (diffMs <= 0) return "Choose a future date and time.";
    if (diffMs < 60 * 1000) return "This is scheduled in under a minute.";
    return null;
}

export function formatScheduledDate(value?: string | null, timeZone?: string | null) {
    if (!value) return "";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    const options: Intl.DateTimeFormatOptions = {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        ...(timeZone ? { timeZone } : {}),
    };
    try {
        return date.toLocaleString(undefined, options);
    } catch {
        return date.toLocaleString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    }
}

export function toScheduledLocalInput(value?: string | null) {
    const date = value ? new Date(value) : new Date(Date.now() + 60 * 60 * 1000);
    if (!Number.isFinite(date.getTime())) return "";
    return toDatetimeLocalValue(date);
}
