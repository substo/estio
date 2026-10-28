import "server-only";
import { getStudioAccess } from "./access";
import { studioRest } from "./rest";
import { createScheduleHistoryReader } from "./schedule-history-reader";

const reader = createScheduleHistoryReader({ authorize: getStudioAccess, read: studioRest });
export const getStudioScheduleHistory = reader.schedule;
export const getStudioScheduleRun = reader.run;
export const getStudioScheduleImportSnapshot = reader.snapshot;
