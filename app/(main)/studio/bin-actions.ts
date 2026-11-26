"use server";
import { revalidatePath } from "next/cache";
import { readBinKind } from "@/lib/studio/bin-policy";
import { StudioCommandError } from "@/lib/studio/command-error";

type Result = { ok: true } | { ok: false; error: string };

type Action = "moveToBin" | "restoreFromBin";

async function run(locationId: string, kind: unknown, id: string, action: Action, missing: string): Promise<Result> {
  const k = readBinKind(kind);
  if (!k) return { ok: false, error: "Invalid item." };
  try {
    if (!await (await import("@/lib/studio/bin"))[action](locationId, k, id)) return { ok: false, error: missing };
  } catch (error) {
    return { ok: false, error: error instanceof StudioCommandError ? error.message : "Studio could not do that. Try again." };
  }
  revalidatePath("/studio", "layout");
  return { ok: true };
}

export const binItemAction = (locationId: string, kind: string, id: string) => run(locationId, kind, id, "moveToBin", "That item is already gone or in the bin.");
export const restoreItemAction = (locationId: string, kind: string, id: string) => run(locationId, kind, id, "restoreFromBin", "That item is no longer in the bin.");
