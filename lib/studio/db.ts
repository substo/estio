import { assertStudioMergeReady } from "./merge-gate";
import { Prisma, type PrismaClient } from "@prisma/client";

/**
 * Studio's database access. Studio lives in the CRM database (schema `studio`) and is
 * reached through the app's Prisma client and connection pool. Writes always go through
 * Studio's SQL functions, which hold the locking and invariant logic; reads select only
 * the columns a page shows. Every result is the row's JSON (`to_jsonb`), so timestamps
 * are ISO strings and bigints are numbers, exactly as Studio code has always read them.
 */

/** SQLSTATE codes are safe to classify; database message text stays on the server. */
export class StudioDbError extends Error {
  constructor(public readonly status: number, public readonly code?: string) {
    super(`Studio database request failed (${code ?? status}).`);
    this.name = "StudioDbError";
  }
}

export interface StudioDb {
  /** Calls `studio.<fn>` with named arguments: a set returns an array, a row an object, otherwise the value. */
  call<T>(fn: string, args?: Record<string, unknown>): Promise<T>;
  /** All rows of a read, in its order. */
  rows<T>(query: Prisma.Sql): Promise<T[]>;
  /** The first row of a read, or null. */
  one<T>(query: Prisma.Sql): Promise<T | null>;
}

type Returns = "set" | "row" | "scalar" | "void";
interface Signature { args: Array<{ name: string; type: string }>; required: number; returns: Returns }
interface CatalogRow { name: string; in_names: string[]; in_types: string[]; defaults: number; retset: boolean; rettype: string; typtype: string }

const identifier = /^[a-z_][a-z0-9_]{0,62}$/;

// PostgREST's HTTP mapping, kept for logs and callers that report a status.
function statusFor(code: string | undefined) {
  if (!code) return 503;
  if (["23505", "23503", "40001", "40P01"].includes(code)) return 409;
  if (code === "42501") return 403;
  if (["P0002", "42883", "42P01"].includes(code)) return 404;
  if (code.startsWith("22") || code.startsWith("23") || code === "P0001") return 400;
  return 500;
}

/** Prisma reports a raw query's SQLSTATE in `meta.code`; connection failures have none. */
export function toStudioDbError(error: unknown): StudioDbError {
  if (error instanceof StudioDbError) return error;
  const meta = (error as { meta?: { code?: unknown } })?.meta;
  const raw = typeof meta?.code === "string" ? meta.code : undefined;
  const code = raw && /^[0-9A-Z]{5}$/.test(raw) ? raw : undefined;
  return new StudioDbError(statusFor(code), code);
}

function returnsOf(row: CatalogRow): Returns {
  if (row.retset) return "set";
  if (row.rettype === "void") return "void";
  if (row.typtype === "c" || row.rettype === "record") return "row";
  return "scalar";
}

export function createStudioDb(client: PrismaClient): StudioDb {
  let catalog: Promise<Map<string, Signature[]>> | null = null;
  const signatures = () => catalog ??= client.$queryRaw<CatalogRow[]>`
    select p.proname as name,
      coalesce(array(select p.proargnames[i] from generate_subscripts(coalesce(p.proargmodes, array_fill('i'::"char", array[p.pronargs::int])), 1) i
        where (coalesce(p.proargmodes, array_fill('i'::"char", array[p.pronargs::int])))[i] in ('i','b','v') order by i), '{}') as in_names,
      coalesce(array(select format_type(t, null) from unnest(p.proargtypes::oid[]) with ordinality u(t, n) order by n), '{}') as in_types,
      p.pronargdefaults::int as defaults, p.proretset as retset, format_type(p.prorettype, null) as rettype, rt.typtype::text as typtype
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace join pg_type rt on rt.oid = p.prorettype
    where ns.nspname = 'studio' and p.prokind = 'f'`.then((rows) => {
      const map = new Map<string, Signature[]>();
      for (const row of rows) {
        const args = row.in_names.map((name, i) => ({ name, type: row.in_types[i] }));
        map.set(row.name, [...(map.get(row.name) ?? []), { args, required: args.length - row.defaults, returns: returnsOf(row) }]);
      }
      return map;
    }, (error) => { catalog = null; throw toStudioDbError(error); });

  async function signatureFor(fn: string, keys: string[]) {
    if (!identifier.test(fn) || keys.some((key) => !identifier.test(key))) throw new StudioDbError(400, "22023");
    const candidates = (await signatures()).get(fn) ?? [];
    // Like PostgREST: the overload whose parameters cover the given names and whose required ones are all given.
    const match = candidates.find((sig) => keys.every((key) => sig.args.some((arg) => arg.name === key))
      && sig.args.slice(0, sig.required).every((arg) => keys.includes(arg.name)));
    if (!match) throw new StudioDbError(404, "42883");
    return match;
  }

  const run = async <T>(query: Prisma.Sql): Promise<T> => {
    try {
      const [row] = await client.$queryRaw<Array<{ v: T }>>(query);
      return row?.v as T;
    } catch (error) { throw toStudioDbError(error); }
  };

  return {
    async call<T>(fn: string, args: Record<string, unknown> = {}) {
      assertStudioMergeReady();
      const given = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));
      const sig = await signatureFor(fn, Object.keys(given));
      const used = sig.args.filter((arg) => arg.name in given);
      const target = Prisma.raw(`studio.${fn}(${used.map((arg) => `${arg.name} => a.${arg.name}`).join(", ")})`);
      // Arguments arrive as one JSON value and are typed by json_to_record, as PostgREST does.
      const from = used.length
        ? Prisma.sql`from json_to_record(${JSON.stringify(given)}::json) as a(${Prisma.raw(used.map((arg) => `${arg.name} ${arg.type}`).join(", "))})`
        : Prisma.empty;
      if (sig.returns === "set") return run<T>(Prisma.sql`select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) as v ${from}${used.length ? Prisma.raw(",") : Prisma.raw("from")} lateral ${target} r`);
      if (sig.returns === "row") return run<T>(Prisma.sql`select to_jsonb(r) as v ${from}${used.length ? Prisma.raw(",") : Prisma.raw("from")} lateral ${target} r`);
      if (sig.returns === "void") { await run(Prisma.sql`select (${target})::text as v ${from}`); return undefined as T; }
      return run<T>(Prisma.sql`select to_jsonb(${target}) as v ${from}`);
    },
    rows<T>(query: Prisma.Sql) {
      assertStudioMergeReady();
      return run<T[]>(Prisma.sql`select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) as v from (${query}) q`);
    },
    async one<T>(query: Prisma.Sql) {
      assertStudioMergeReady();
      return (await run<T>(Prisma.sql`select to_jsonb(q) as v from (${query}) q limit 1`)) ?? null;
    },
  };
}
