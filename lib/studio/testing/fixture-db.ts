import type { Prisma } from "@prisma/client";
import type { StudioDb } from "../db";
/** Adapts existing state-machine fixtures; SQL boundary tests assert Sql directly. */
export function fixtureDb(fixture: <T>(path: string, init?: RequestInit) => Promise<T>): StudioDb {
  const rows = async <T>(query: Prisma.Sql): Promise<T[]> => {
    const sql = query.sql;
    const table = sql.match(/from studio\.([a-z_]+)/)?.[1];
    if (!table) throw new Error("Fixture expected a Studio SELECT");
    const params = new URLSearchParams();
    params.set("select", sql.slice(7, sql.indexOf(" from ")));
    let index = 0;
    for (const match of sql.matchAll(/([a-z_]+)\s*(=|<=|>)\s*\?(?:::uuid|::timestamptz)?|\?/g)) {
      const value = query.values[index++];
      if (match[1]) params.set(match[1], `${match[2] === "=" ? "eq" : match[2] === "<=" ? "lte" : "gt"}.${value}`);
    }
    const limit = sql.match(/limit (\d+)/)?.[1]; if (limit) params.set("limit", limit);
    const order = sql.match(/order by (.*?) (?:limit|offset|$)/)?.[1]; if (order) params.set("order", order.replace(/ asc/g,".asc").replace(/ desc/g,".desc"));
    if (/offset \?/.test(sql)) params.set("offset", String(query.values.at(-1)));
    return fixture<T[]>(`${table}?${params}`);
  };
  return { rows, one: async <T>(query: Prisma.Sql) => (await rows<T>(query))[0] ?? null,
    call: <T>(name: string, args: Record<string, unknown> = {}) => fixture<T>(`rpc/${name}`, { method: "POST", body: JSON.stringify(args) }) };
}
