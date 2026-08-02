import { Prisma, PrismaClient } from "@prisma/client";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  INCLUDED_MODELS,
  LOCATION_BACKUP_FORMAT,
  LOCATION_BACKUP_VERSION,
  archiveExclusions,
  buildImportOrder,
  buildModelMetadata,
  createIdMaps,
  remapEmbeddedIds,
  schemaFingerprint,
  type ArchiveRow,
  type LocationBackupArchive,
  type ModelMeta,
} from "./policy";
import { writeArchive } from "./archive";

type DynamicClient = PrismaClient | Prisma.TransactionClient;
type SelectedRows = Map<string, Map<string, ArchiveRow>>;

const CHUNK_SIZE = 500;
const MAX_ARCHIVE_ROWS = 500_000;
const included = new Set<string>(INCLUDED_MODELS);
const EMBEDDED_ID_FIELDS = new Set([
  "conversationIds",
  "propertyIds",
  "viewingIds",
  "selectedMediaIds",
  "sourceId",
  "propertiesInterested",
  "propertiesInspected",
  "propertiesEmailed",
  "propertiesMatched",
]);
const RESET_FIELDS: Record<string, string[]> = {
  Contact: [
    "ghlCompanyId",
    "ghlPropertyObjectId",
    "ghlOppId",
    "legacyCrmOwnerId",
    "legacyCrmOwnerLabel",
    "googleContactId",
    "lastGoogleSync",
    "googleContactUpdatedAt",
    "outlookContactId",
    "lastOutlookSync",
    "outlookContactUpdatedAt",
    "lid",
    "whatsappLastInboundAt",
    "whatsappCustomerServiceExpiresAt",
  ],
  Company: ["legacyCrmOwnerId", "legacyCrmOwnerLabel"],
  Viewing: ["calendarEventId"],
  Message: ["emailThreadId"],
  PropertyFeed: ["lastSyncAt"],
};

export type RestorePlan = {
  sourceLocationId: string;
  targetLocationId: string;
  archiveRows: number;
  targetRowsToReplace: number;
  archiveCounts: Record<string, number>;
  targetCounts: Record<string, number>;
  warnings: string[];
};

function delegate(client: DynamicClient, model: ModelMeta): any {
  const value = (client as any)[model.delegate];
  if (!value) throw new Error(`Prisma delegate is unavailable for ${model.name}`);
  return value;
}

function chunks<T>(values: T[], size = CHUNK_SIZE): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function rowCount(selected: SelectedRows): number {
  return [...selected.values()].reduce((sum, rows) => sum + rows.size, 0);
}

function counts(selected: SelectedRows): Record<string, number> {
  return Object.fromEntries([...selected.entries()].filter(([, rows]) => rows.size).map(([name, rows]) => [name, rows.size]));
}

async function addRows(
  client: DynamicClient,
  selected: SelectedRows,
  model: ModelMeta,
  where: Record<string, unknown>,
): Promise<number> {
  const rows = (await delegate(client, model).findMany({ where })) as ArchiveRow[];
  const bucket = selected.get(model.name) ?? new Map<string, ArchiveRow>();
  let added = 0;
  for (const row of rows) {
    const id = String(row[model.idField]);
    if (!bucket.has(id)) {
      bucket.set(id, row);
      added += 1;
    }
  }
  selected.set(model.name, bucket);
  return added;
}

export async function selectLocationRows(
  client: DynamicClient,
  locationId: string,
  modelNames: readonly string[] = INCLUDED_MODELS,
): Promise<SelectedRows> {
  const metadata = buildModelMetadata();
  const selected: SelectedRows = new Map();
  const selectedModels = new Set(modelNames);

  // Seed every included model with an explicit locationId, including legacy
  // tables whose locationId is intentionally not backed by a Prisma relation.
  for (const modelName of modelNames) {
    const model = metadata.get(modelName);
    if (!model?.scalarFields.some((field) => field.name === "locationId")) continue;
    await addRows(client, selected, model, { locationId });
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const childName of modelNames) {
      const child = metadata.get(childName);
      if (!child) continue;
      for (const relation of child.relations) {
        if (!selectedModels.has(relation.parentModel) || relation.parentModel === child.name) continue;
        const parentRows = selected.get(relation.parentModel);
        if (!parentRows?.size) continue;
        const parent = metadata.get(relation.parentModel)!;
        const values = [...parentRows.values()].map((row) => row[relation.toField ?? parent.idField]);
        for (const valueChunk of chunks(values)) {
          if (await addRows(client, selected, child, { [relation.fromField]: { in: valueChunk } })) changed = true;
        }
      }
    }
    if (rowCount(selected) > MAX_ARCHIVE_ROWS) {
      throw new Error(`Location export exceeds the safety limit of ${MAX_ARCHIVE_ROWS.toLocaleString()} rows`);
    }
  }
  return selected;
}

export async function createLocationArchive(
  client: PrismaClient,
  locationId: string,
): Promise<LocationBackupArchive> {
  const location = await client.location.findUnique({ where: { id: locationId }, select: { id: true, name: true } });
  if (!location) throw new Error(`Source location ${locationId} does not exist`);
  const selected = await selectLocationRows(client, locationId);
  const tables = Object.fromEntries([...selected.entries()].filter(([, rows]) => rows.size).map(([name, rows]) => [name, [...rows.values()]]));
  return {
    format: LOCATION_BACKUP_FORMAT,
    version: LOCATION_BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    schemaFingerprint: schemaFingerprint(),
    source: { locationId: location.id, name: location.name },
    policy: { includedModels: [...INCLUDED_MODELS], exclusions: archiveExclusions() },
    tables,
    rowCounts: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length])),
  };
}

export async function exportLocationToFile(args: {
  client: PrismaClient;
  locationId: string;
  outputPath: string;
}): Promise<LocationBackupArchive> {
  const archive = await createLocationArchive(args.client, args.locationId);
  await mkdir(path.dirname(args.outputPath), { recursive: true });
  await writeArchive(args.outputPath, archive);
  return archive;
}

export async function planLocationRestore(args: {
  client: PrismaClient;
  archive: LocationBackupArchive;
  targetLocationId: string;
}): Promise<RestorePlan> {
  if (args.archive.source.locationId === args.targetLocationId) {
    throw new Error("Source and target locations must be different");
  }
  const target = await args.client.location.findUnique({ where: { id: args.targetLocationId }, select: { id: true } });
  if (!target) throw new Error(`Target location ${args.targetLocationId} does not exist`);
  if (args.archive.schemaFingerprint !== schemaFingerprint()) {
    throw new Error("Backup schema does not match this application build");
  }
  const targetRows = await selectLocationRows(args.client, args.targetLocationId);
  return {
    sourceLocationId: args.archive.source.locationId,
    targetLocationId: args.targetLocationId,
    archiveRows: Object.values(args.archive.rowCounts).reduce((sum, count) => sum + count, 0),
    targetRowsToReplace: rowCount(targetRows),
    archiveCounts: args.archive.rowCounts,
    targetCounts: counts(targetRows),
    warnings: [
      "The target Location record, users, roles, credentials, domains and integration state are preserved.",
      "Target business rows in the included model set are replaced transactionally.",
      "Database records do not download binary Storage, Cloudflare or object-store files.",
    ],
  };
}

function flattenIdMaps(idMaps: Map<string, Map<string, string>>): Map<string, string> {
  const result = new Map<string, string>();
  for (const modelMap of idMaps.values()) for (const [oldId, newId] of modelMap) result.set(oldId, newId);
  return result;
}

function restoredUniqueValue(value: unknown, targetLocationId: string): unknown {
  if (typeof value !== "string") return value;
  return `${value}--restored-${targetLocationId.slice(-8)}`;
}

export function prepareImportRow(args: {
  model: ModelMeta;
  row: ArchiveRow;
  targetLocationId: string;
  idMaps: Map<string, Map<string, string>>;
  allIds: Map<string, string>;
  insertedModels: Set<string>;
}): { data: ArchiveRow; deferred: Record<string, unknown> } {
  const { model, row, targetLocationId, idMaps, allIds, insertedModels } = args;
  const data: ArchiveRow = {};
  const deferred: Record<string, unknown> = {};
  for (const field of model.scalarFields) {
    if (!(field.name in row)) continue;
    let value = row[field.name];
    if (field.type === "DateTime" && typeof value === "string") value = new Date(value);
    data[field.name] = value;
  }

  data[model.idField] = idMaps.get(model.name)?.get(String(row[model.idField]));
  if ("locationId" in data) data.locationId = targetLocationId;

  for (const relation of model.relations) {
    const oldValue = row[relation.fromField];
    if (oldValue == null) continue;
    if (relation.parentModel === "Location") {
      data[relation.fromField] = targetLocationId;
      continue;
    }
    const mapped = idMaps.get(relation.parentModel)?.get(String(oldValue));
    if (!mapped) continue; // Shared User/global dependency: preserve its existing ID.
    if (relation.parentModel === model.name || !insertedModels.has(relation.parentModel)) {
      if (relation.isRequired) {
        throw new Error(`Required cyclic dependency ${model.name}.${relation.fromField} -> ${relation.parentModel}`);
      }
      data[relation.fromField] = null;
      deferred[relation.fromField] = mapped;
    } else {
      data[relation.fromField] = mapped;
    }
  }

  // String/array references that are not represented as database foreign keys.
  for (const field of model.scalarFields) {
    if (
      (field.name.endsWith("Id") || field.name.endsWith("Ids") || EMBEDDED_ID_FIELDS.has(field.name)) &&
      field.name !== model.idField &&
      field.name !== "locationId"
    ) {
      data[field.name] = remapEmbeddedIds(data[field.name], allIds);
    }
  }

  // Nullable globally unique values generally represent external systems. They
  // must not collide with the still-live source location or trigger source sync.
  const relationFields = new Set(model.relations.map((relation) => relation.fromField));
  for (const field of model.scalarFields) {
    if (!field.isUnique || field.isId || field.name === "locationId" || relationFields.has(field.name)) continue;
    if (!field.isRequired) data[field.name] = null;
    else data[field.name] = restoredUniqueValue(data[field.name], targetLocationId);
  }
  if (model.name === "ScrapedListing" && data.externalId) {
    data.externalId = restoredUniqueValue(data.externalId, targetLocationId);
  }
  for (const fieldName of RESET_FIELDS[model.name] ?? []) {
    if (fieldName in data) data[fieldName] = null;
  }
  if (model.name === "PropertyFeed") data.isActive = false;
  return { data, deferred };
}

async function deleteSelectedRows(client: DynamicClient, selected: SelectedRows): Promise<void> {
  const metadata = buildModelMetadata();
  const order = buildImportOrder([...selected.keys()], metadata).reverse();
  for (const modelName of order) {
    const model = metadata.get(modelName);
    const ids = model ? [...(selected.get(modelName)?.keys() ?? [])] : [];
    if (!model || !ids.length) continue;
    for (const idChunk of chunks(ids)) await delegate(client, model).deleteMany({ where: { [model.idField]: { in: idChunk } } });
  }
}

export async function restoreLocation(args: {
  client: PrismaClient;
  archive: LocationBackupArchive;
  targetLocationId: string;
}): Promise<RestorePlan> {
  const plan = await planLocationRestore(args);
  const metadata = buildModelMetadata();
  const archiveModels = Object.keys(args.archive.tables).filter((name) => included.has(name));
  const order = buildImportOrder(archiveModels, metadata);
  const idMaps = createIdMaps(args.archive.tables, metadata);
  const allIds = flattenIdMaps(idMaps);

  await args.client.$transaction(async (tx) => {
    const targetRows = await selectLocationRows(tx, args.targetLocationId);
    await deleteSelectedRows(tx, targetRows);
    const insertedModels = new Set<string>();
    const deferredUpdates: Array<{ model: ModelMeta; id: string; data: ArchiveRow }> = [];

    for (const modelName of order) {
      const model = metadata.get(modelName);
      if (!model) throw new Error(`Model ${modelName} is not available in the current Prisma client`);
      const prepared = (args.archive.tables[modelName] ?? []).map((row) => {
        const result = prepareImportRow({ model, row, targetLocationId: args.targetLocationId, idMaps, allIds, insertedModels });
        if (Object.keys(result.deferred).length) {
          deferredUpdates.push({ model, id: String(result.data[model.idField]), data: result.deferred });
        }
        return result.data;
      });
      for (const dataChunk of chunks(prepared)) {
        if (dataChunk.length) await delegate(tx, model).createMany({ data: dataChunk });
      }
      insertedModels.add(modelName);
    }

    for (const update of deferredUpdates) {
      await delegate(tx, update.model).update({ where: { [update.model.idField]: update.id }, data: update.data });
    }
  }, { maxWait: 30_000, timeout: 30 * 60_000 });
  return plan;
}

export function createDatabaseClient(databaseUrl?: string): PrismaClient {
  const url = databaseUrl || process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DIRECT_URL or DATABASE_URL is required");
  return new PrismaClient({ datasources: { db: { url } } });
}
