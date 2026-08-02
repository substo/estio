import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";

export const LOCATION_BACKUP_FORMAT = "estio-location-backup" as const;
export const LOCATION_BACKUP_VERSION = 1 as const;

// Deliberately limited to durable, tenant-owned business records. Integration
// credentials, domains, users/roles, queues, sync cursors, analytics and audit
// records remain owned by the destination Location.
export const INCLUDED_MODELS = [
  "LeadSource",
  "ContentPage",
  "BlogPost",
  "Property",
  "PropertyPrintDraft",
  "PropertyTranslation",
  "PropertyMedia",
  "PropertyImagePromptProfile",
  "Contact",
  "ContactLanguage",
  "Company",
  "ContactPropertyRole",
  "CompanyPropertyRole",
  "ContactCompanyRole",
  "SwipeSession",
  "PropertySwipe",
  "Project",
  "ProspectLead",
  "Viewing",
  "ViewingSession",
  "ViewingSessionMessage",
  "ViewingSessionInsight",
  "ViewingSessionSummary",
  "ViewingSessionEvent",
  "ViewingSessionUsage",
  "PropertyFeed",
  "ContactHistory",
  "DealContext",
  "DealConversationLink",
  "Offer",
  "DealDocument",
  "Conversation",
  "ContactTask",
  "ConversationParticipant",
  "Message",
  "MessageAttachment",
  "MessageTranscript",
  "MessageTranscriptExtraction",
  "MessageTranslationCache",
  "ContactPropertyMatchProfile",
  "ContactPropertyInteraction",
  "PropertyMatchCampaign",
  "PropertyMatchCandidate",
  "Insight",
  "PlaybookEntry",
  "AgentEvent",
  "ScrapedListing",
] as const;

export type IncludedModel = (typeof INCLUDED_MODELS)[number];
export type ArchiveRow = Record<string, unknown>;

export type LocationBackupArchive = {
  format: typeof LOCATION_BACKUP_FORMAT;
  version: typeof LOCATION_BACKUP_VERSION;
  createdAt: string;
  schemaFingerprint: string;
  source: { locationId: string; name: string | null };
  policy: {
    includedModels: string[];
    exclusions: string[];
  };
  tables: Record<string, ArchiveRow[]>;
  rowCounts: Record<string, number>;
};

export type ModelMeta = {
  name: string;
  delegate: string;
  idField: string;
  scalarFields: Array<{
    name: string;
    type: string;
    isRequired: boolean;
    isUnique: boolean;
    isId: boolean;
  }>;
  relations: Array<{
    parentModel: string;
    fromField: string;
    toField: string;
    isRequired: boolean;
  }>;
};

const dmmfModels = Prisma.dmmf.datamodel.models;

export function buildModelMetadata(): Map<string, ModelMeta> {
  const result = new Map<string, ModelMeta>();
  for (const model of dmmfModels) {
    const idField = model.fields.find((field) => field.isId && field.kind === "scalar");
    if (!idField) continue;
    result.set(model.name, {
      name: model.name,
      delegate: model.name[0].toLowerCase() + model.name.slice(1),
      idField: idField.name,
      scalarFields: model.fields
        .filter((field) => field.kind === "scalar" || field.kind === "enum")
        .map((field) => ({
          name: field.name,
          type: field.type,
          isRequired: field.isRequired,
          isUnique: field.isUnique,
          isId: field.isId,
        })),
      relations: model.fields
        .filter(
          (field) =>
            field.kind === "object" &&
            field.relationFromFields?.length === 1 &&
            field.relationToFields?.length === 1,
        )
        .map((field) => ({
          parentModel: field.type,
          fromField: field.relationFromFields![0],
          toField: field.relationToFields![0],
          isRequired: field.isRequired,
        })),
    });
  }
  return result;
}

export function schemaFingerprint(metadata = buildModelMetadata()): string {
  const shape = [...metadata.values()]
    .filter((model) => INCLUDED_MODELS.includes(model.name as IncludedModel))
    .map((model) => ({
      name: model.name,
      idField: model.idField,
      fields: model.scalarFields.map((field) => [field.name, field.type, field.isRequired]),
      relations: model.relations.map((relation) => [
        relation.parentModel,
        relation.fromField,
        relation.toField,
      ]),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return createHash("sha256").update(JSON.stringify(shape)).digest("hex");
}

export function buildImportOrder(
  modelNames: string[],
  metadata = buildModelMetadata(),
): string[] {
  const selected = new Set(modelNames);
  const incoming = new Map(modelNames.map((name) => [name, 0]));
  const children = new Map<string, Set<string>>();
  const edges = new Set<string>();

  for (const childName of modelNames) {
    const child = metadata.get(childName);
    for (const relation of child?.relations ?? []) {
      if (!selected.has(relation.parentModel) || relation.parentModel === childName) continue;
      const edge = `${relation.parentModel}\u0000${childName}`;
      if (edges.has(edge)) continue;
      edges.add(edge);
      children.set(relation.parentModel, (children.get(relation.parentModel) ?? new Set()).add(childName));
      incoming.set(childName, (incoming.get(childName) ?? 0) + 1);
    }
  }

  const ready = modelNames.filter((name) => incoming.get(name) === 0).sort();
  const ordered: string[] = [];
  while (ready.length) {
    const parent = ready.shift()!;
    ordered.push(parent);
    for (const child of children.get(parent) ?? []) {
      const next = (incoming.get(child) ?? 0) - 1;
      incoming.set(child, next);
      if (next === 0) ready.push(child);
    }
    ready.sort();
  }

  // Nullable relation cycles are inserted with those fields temporarily null.
  for (const name of [...modelNames].sort()) {
    if (!ordered.includes(name)) ordered.push(name);
  }
  return ordered;
}

export function createIdMaps(
  tables: Record<string, ArchiveRow[]>,
  metadata = buildModelMetadata(),
): Map<string, Map<string, string>> {
  const result = new Map<string, Map<string, string>>();
  for (const [modelName, rows] of Object.entries(tables)) {
    const idField = metadata.get(modelName)?.idField;
    if (!idField) continue;
    const modelMap = new Map<string, string>();
    for (const row of rows) modelMap.set(String(row[idField]), randomUUID());
    result.set(modelName, modelMap);
  }
  return result;
}

export function remapEmbeddedIds(value: unknown, allIds: Map<string, string>): unknown {
  if (typeof value === "string") return allIds.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => remapEmbeddedIds(item, allIds));
  return value;
}

export function archiveExclusions(): string[] {
  return [
    "Location identity and integration credentials",
    "users, memberships, roles and authentication identities",
    "site configuration, domains and secrets",
    "provider sync state, OAuth state and external provider identifiers",
    "outboxes, scheduled work, notifications and runtime locks",
    "analytics, audit records and AI runtime/usage records",
    "binary Storage, Cloudflare and object-store assets (database URLs remain in business rows)",
  ];
}
