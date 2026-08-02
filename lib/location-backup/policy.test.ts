import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  LOCATION_BACKUP_FORMAT,
  LOCATION_BACKUP_VERSION,
  buildImportOrder,
  buildModelMetadata,
  createIdMaps,
  remapEmbeddedIds,
  schemaFingerprint,
  type LocationBackupArchive,
} from "./policy";
import { readArchive, validateArchive, writeArchive } from "./archive";
import { prepareImportRow, selectLocationRows } from "./service";

test("dependency order places core parents before their children", () => {
  const order = buildImportOrder(["ViewingSession", "Property", "MessageAttachment", "Message", "Conversation", "Contact"]);
  assert.ok(order.indexOf("Contact") < order.indexOf("Conversation"));
  assert.ok(order.indexOf("Conversation") < order.indexOf("Message"));
  assert.ok(order.indexOf("Message") < order.indexOf("MessageAttachment"));
  // ViewingSession has two separate relations to Property; the graph must
  // count that as one parent-child dependency.
  assert.ok(order.indexOf("Property") < order.indexOf("ViewingSession"));
});

test("required unique foreign keys are remapped without being rewritten as external IDs", () => {
  const metadata = buildModelMetadata();
  const model = metadata.get("ViewingSessionSummary")!;
  const row = { id: "old-summary", sessionId: "old-session", status: "completed", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const idMaps = createIdMaps({ ViewingSessionSummary: [row], ViewingSession: [{ id: "old-session" }] }, metadata);
  const prepared = prepareImportRow({
    model,
    row,
    targetLocationId: "target-location",
    idMaps,
    allIds: new Map(),
    insertedModels: new Set(["ViewingSession"]),
  });
  assert.equal(prepared.data.sessionId, idMaps.get("ViewingSession")?.get("old-session"));
});

test("import remaps IDs and location while stripping nullable external unique IDs", () => {
  const metadata = buildModelMetadata();
  const model = metadata.get("Property")!;
  const row = {
    id: "old-property",
    locationId: "old-location",
    title: "Villa",
    slug: "villa",
    reference: "REF-1",
    status: "ACTIVE",
    features: [],
    source: "IDX",
    goal: "SALE",
    publicationStatus: "PUBLISHED",
    sortOrder: 0,
    ghlPropertyObjectId: "external-1",
  };
  const idMaps = createIdMaps({ Property: [row] }, metadata);
  const prepared = prepareImportRow({
    model,
    row,
    targetLocationId: "target-location",
    idMaps,
    allIds: new Map(),
    insertedModels: new Set(),
  });
  assert.notEqual(prepared.data.id, row.id);
  assert.equal(prepared.data.locationId, "target-location");
  assert.equal(prepared.data.reference, null);
  assert.equal(prepared.data.ghlPropertyObjectId, null);
  assert.match(String(prepared.data.slug), /^villa--restored-/);
});

test("embedded ID arrays are remapped", () => {
  const mapping = new Map([["old-1", "new-1"]]);
  assert.deepEqual(remapEmbeddedIds(["old-1", "untouched"], mapping), ["new-1", "untouched"]);
});

test("non-unique provider state is reset while internal string IDs are remapped", () => {
  const metadata = buildModelMetadata();
  const model = metadata.get("Contact")!;
  const row = {
    id: "old-contact",
    locationId: "old-location",
    status: "active",
    propertiesInterested: ["old-property"],
    googleContactId: "google-123",
    ghlCompanyId: "ghl-company-123",
  };
  const idMaps = createIdMaps({ Contact: [row] }, metadata);
  const prepared = prepareImportRow({
    model,
    row,
    targetLocationId: "target-location",
    idMaps,
    allIds: new Map([["old-property", "new-property"]]),
    insertedModels: new Set(),
  });
  assert.deepEqual(prepared.data.propertiesInterested, ["new-property"]);
  assert.equal(prepared.data.googleContactId, null);
  assert.equal(prepared.data.ghlCompanyId, null);
});

test("archive validator rejects incompatible payloads", () => {
  assert.throws(() => validateArchive({ format: "other", version: 1 }), /Unsupported backup format/);
  const archive: LocationBackupArchive = {
    format: LOCATION_BACKUP_FORMAT,
    version: LOCATION_BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    schemaFingerprint: schemaFingerprint(),
    source: { locationId: "source", name: null },
    policy: { includedModels: [], exclusions: [] },
    tables: {},
    rowCounts: {},
  };
  assert.doesNotThrow(() => validateArchive(archive));
});

test("compressed archive round-trips without losing manifest data", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "estio-location-backup-"));
  const filePath = path.join(directory, "backup.location-backup.json.gz");
  const archive = {
    format: LOCATION_BACKUP_FORMAT,
    version: LOCATION_BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    schemaFingerprint: schemaFingerprint(),
    source: { locationId: "source", name: "Source" },
    policy: { includedModels: ["Contact"], exclusions: [] },
    tables: { Contact: [{ id: "contact-1", locationId: "source" }] },
    rowCounts: { Contact: 1 },
  };
  try {
    await writeArchive(filePath, archive);
    assert.deepEqual(await readArchive(filePath), archive);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("location selection follows durable child relations without crossing tenants", async () => {
  const metadata = buildModelMetadata();
  const modelByDelegate = new Map([...metadata.values()].map((model) => [model.delegate, model.name]));
  const rows: Record<string, Array<Record<string, unknown>>> = {
    Contact: [
      { id: "contact-1", locationId: "location-1" },
      { id: "contact-2", locationId: "location-2" },
    ],
    Conversation: [
      { id: "conversation-1", locationId: "location-1", contactId: "contact-1" },
      { id: "conversation-2", locationId: "location-2", contactId: "contact-2" },
    ],
    Message: [
      { id: "message-1", conversationId: "conversation-1" },
      { id: "message-2", conversationId: "conversation-2" },
    ],
    MessageAttachment: [
      { id: "attachment-1", messageId: "message-1" },
      { id: "attachment-2", messageId: "message-2" },
    ],
  };
  const client = new Proxy({}, {
    get(_target, property) {
      const modelName = modelByDelegate.get(String(property));
      if (!modelName) return undefined;
      return {
        findMany: async ({ where }: { where: Record<string, any> }) =>
          (rows[modelName] ?? []).filter((row) => Object.entries(where).every(([field, condition]) => {
            if (condition && typeof condition === "object" && "in" in condition) return condition.in.includes(row[field]);
            return row[field] === condition;
          })),
      };
    },
  });
  const selected = await selectLocationRows(client as any, "location-1");
  assert.deepEqual([...selected.get("Contact")!.keys()], ["contact-1"]);
  assert.deepEqual([...selected.get("Conversation")!.keys()], ["conversation-1"]);
  assert.deepEqual([...selected.get("Message")!.keys()], ["message-1"]);
  assert.deepEqual([...selected.get("MessageAttachment")!.keys()], ["attachment-1"]);
});
