import "server-only";
import { getStudioAccess } from "./access";
import { studioDb } from "./studio-db";
import { createScheduleHistoryReader } from "./schedule-history-reader";

const reader = createScheduleHistoryReader({ authorize: getStudioAccess, db: studioDb });
export const getStudioScheduleHistory = reader.schedule;
export const getStudioScheduleRun = reader.run;
export const getStudioScheduleImportSnapshot = reader.snapshot;
