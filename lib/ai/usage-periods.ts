/** Header spend uses UTC calendar periods, matching the Studio budget ledger. */
export function usagePeriodStarts(now: Date) {
    return {
        startOfMonth: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
        endOfMonth: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
        endOfToday: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)),
        startOfToday: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
    };
}
