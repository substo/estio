const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

function pad(value: number, width: number = 2) {
  return String(value).padStart(width, '0');
}

export function formatDateTimeLocalValue(input?: Date | string | null) {
  if (!input) return '';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '';

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function convertDateTimeLocalToIso(input?: string | null, offsetMinutes?: number | null) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  const localMatch = raw.match(LOCAL_DATE_TIME_PATTERN);
  if (!localMatch) {
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;

  const [
    ,
    year,
    month,
    day,
    hour,
    minute,
    second = '0',
    millisecond = '0',
  ] = localMatch;

  const effectiveOffsetMinutes = Number.isFinite(offsetMinutes)
    ? Number(offsetMinutes)
    : parsed.getTimezoneOffset();
  const utcMillis =
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      Number(millisecond.padEnd(3, '0'))
    ) +
    effectiveOffsetMinutes * 60_000;

  return new Date(utcMillis).toISOString();
}

export function isLocalDateTimeWithoutZone(input?: string | null) {
  return LOCAL_DATE_TIME_PATTERN.test(String(input || '').trim());
}
