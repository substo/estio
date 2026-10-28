import "server-only";
import db from "@/lib/db";
import { createStudioDb } from "./db";

/** Studio's database access for the app: the CRM database's Prisma client and pool. */
export const studioDb = createStudioDb(db);
