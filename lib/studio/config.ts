/** Runtime Studio uses only the CRM Prisma connection. */
export function hasStudioDatabaseConfig(env: NodeJS.ProcessEnv = process.env): boolean {
  try { return ["postgres:", "postgresql:"].includes(new URL(env.DATABASE_URL ?? "").protocol); }
  catch { return false; }
}
