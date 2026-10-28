import { Prisma, type PrismaClient } from "@prisma/client";
/** Read-only target reconciliation. A mismatch never authorizes activation. */
export async function verifyStudioCopy(db: Pick<PrismaClient, "$queryRaw">, evidence: { tables: Array<{table:string;count:number;digest:string}>; foreign_keys:number; mapped_locations:number }) {
  if (evidence.tables?.length !== 53 || evidence.foreign_keys !== 89 || evidence.mapped_locations !== 2) throw Error("Unexpected copy inventory");
    const actualTables = await db.$queryRaw<Array<{ tablename: string }>>`select tablename from pg_tables where schemaname='studio' order by tablename`;
    const names = evidence.tables.map((t: { table: string }) => t.table).sort();
    if (JSON.stringify(actualTables.map(t => t.tablename)) !== JSON.stringify(names) || new Set(names).size !== 53) throw Error("Inventory changed");
    for (const t of evidence.tables) {
      if (!/^[a-z_]+$/.test(t.table) || !/^[a-f0-9]{32}$/.test(t.digest) || !Number.isSafeInteger(t.count)) throw Error("Invalid verification evidence");
      const [row] = await db.$queryRaw<Array<{ count: number; digest: string }>>(Prisma.sql`select count(*)::int as count, md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'')) as digest from ${Prisma.raw('studio.'+t.table)} t`);
      if (row.count !== t.count || row.digest !== t.digest) throw Error("Target differs from copied snapshot");
    }
}
