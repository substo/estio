import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const saveSource = readFileSync(
  new URL("./save-property-record.ts", import.meta.url),
  "utf8",
);
const actionSource = readFileSync(
  new URL("../../app/(main)/admin/properties/actions.ts", import.meta.url),
  "utf8",
);
const mediaActionSource = readFileSync(
  new URL("../../app/(main)/admin/properties/media-actions.ts", import.meta.url),
  "utf8",
);
const editorPageSource = readFileSync(
  new URL("../../app/(main)/admin/properties/[id]/page.tsx", import.meta.url),
  "utf8",
);
const viewPageSource = readFileSync(
  new URL("../../app/(main)/admin/properties/[id]/view/page.tsx", import.meta.url),
  "utf8",
);
const aiUsageSource = readFileSync(
  new URL("../../app/(main)/admin/_actions/ai-usage.ts", import.meta.url),
  "utf8",
);
const crmPusherSource = readFileSync(new URL("../crm/crm-pusher.ts", import.meta.url), "utf8");
const translationSource = readFileSync(
  new URL("../../app/(main)/admin/properties/translation-actions.ts", import.meta.url),
  "utf8",
);
const printSource = readFileSync(
  new URL("../../app/(main)/admin/properties/print-actions.ts", import.meta.url),
  "utf8",
);
const printPreviewSource = readFileSync(
  new URL("../../app/(main)/print-preview/[id]/[draftId]/page.tsx", import.meta.url),
  "utf8",
);
const printPdfSource = readFileSync(
  new URL("../../app/(main)/print-preview/[id]/[draftId]/pdf/route.ts", import.meta.url),
  "utf8",
);
const importSource = readFileSync(
  new URL("../../app/(main)/admin/properties/import/actions.ts", import.meta.url),
  "utf8",
);
const importWorkflowSource = readFileSync(new URL("../crm/import-workflow.ts", import.meta.url), "utf8");
const importStreamSource = readFileSync(
  new URL("../../app/api/import-stream/route.ts", import.meta.url),
  "utf8",
);
const extractionSource = readFileSync(
  new URL("../../app/(main)/admin/properties/import/ai-property-extraction.ts", import.meta.url),
  "utf8",
);
const directUploadSource = readFileSync(
  new URL("../../app/api/images/direct-upload/route.ts", import.meta.url),
  "utf8",
);
const imageListSource = readFileSync(
  new URL("../../app/api/images/list/route.ts", import.meta.url),
  "utf8",
);
const mediaUploaderSource = readFileSync(
  new URL("../../components/ui/media-uploader.tsx", import.meta.url),
  "utf8",
);
const propertyAiBadgeSource = readFileSync(
  new URL("../../app/(main)/admin/properties/_components/property-ai-usage-badge.tsx", import.meta.url),
  "utf8",
);
const imageRouteSources = [
  "../../app/api/images/enhance/analyze/route.ts",
  "../../app/api/images/enhance/generate/route.ts",
  "../../app/api/images/enhance/precision-remove/route.ts",
  "../../app/api/images/enhance/room-type/predict/route.ts",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));

test("property identity lookups include the active location boundary", () => {
  assert.match(saveSource, /reference:[\s\S]*locationId: input\.location\.id/);
  assert.match(saveSource, /slug: propertyPayload\.slug,[\s\S]*locationId: input\.location\.id/);
});

test("property relationships are validated inside the active location", () => {
  assert.match(saveSource, /validateStakeholderLocationBoundary\(input\.location\.id, stakeholders\)/);
  assert.match(saveSource, /id: propertyData\.projectId, locationId: input\.location\.id/);
  for (const source of [editorPageSource, viewPageSource, crmPusherSource]) {
    assert.match(source, /where: \{ (?:contact|company): \{ locationId/);
    assert.match(source, /filterPropertyRelationshipsToLocation/);
  }
});

test("listing mutations and media uploads resolve location context server-side", () => {
  assert.match(actionSource, /requirePropertyInActiveLocation\(id, \{ requestedLocationId: requestedLocation \}\)/);
  assert.match(actionSource, /requirePropertyInActiveLocation\(propertyId, \{ requestedLocationId \}\)/);
  assert.match(actionSource, /where: \{ id: propertyId, locationId \}/);
  assert.match(mediaActionSource, /requireAuthenticatedLocationContext\(/);
  assert.match(mediaActionSource, /locationId: access\.locationId/);
  assert.match(mediaActionSource, /uploadedBy: access\.dbUserId/);
  assert.ok(saveSource.indexOf("validateSubmittedPropertyMedia") < saveSource.indexOf("db.property.update"));
});

test("detail routes ignore query-string location overrides and prove property access first", () => {
  assert.doesNotMatch(editorPageSource, /searchLocationId|searchParams/);
  assert.doesNotMatch(viewPageSource, /searchLocationId|searchParams/);
  assert.match(editorPageSource, /requirePropertyInActiveLocation\(id\)/);
  assert.match(viewPageSource, /requirePropertyInActiveLocation\(id\)/);
  assert.ok(viewPageSource.indexOf("requirePropertyInActiveLocation(id)") < viewPageSource.indexOf("generatePreviewToken(locationId)"));
});

test("property AI usage is admin-only and location-scoped", () => {
  assert.match(aiUsageSource, /requirePropertyInActiveLocation\(propertyId, \{ adminOnly: true \}\)/);
  assert.match(aiUsageSource, /locationId,[\s\S]*resourceType: "property"/);
});

test("CRM, attribution, translations, print, and import use the shared property boundary", () => {
  assert.match(actionSource, /pushToOldCrm[\s\S]*requirePropertyInActiveLocation\(propertyId\)/);
  assert.match(actionSource, /linkPropertyCreator[\s\S]*requirePropertyInActiveLocation\(propertyId, \{ adminOnly: true \}\)/);
  assert.equal(
    [...crmPusherSource.matchAll(/where: \{ id: propertyId, locationId: location\.id \}/g)].length,
    2,
  );
  assert.match(translationSource, /requirePropertyInActiveLocation\(propertyId, \{ requestedLocationId: locationId \}\)/);
  assert.match(printSource, /assertPropertyPrintDraftWriteBoundary\(/);
  for (const source of [printPreviewSource, printPdfSource]) {
    assert.match(source, /requirePropertyInActiveLocation\(id\)/);
    assert.match(source, /where: \{ id, locationId \}/);
    assert.doesNotMatch(source, /verifyUserHasAccessToLocation/);
  }
  assert.match(importSource, /requirePropertyInActiveLocation\(propertyId\)/);
  assert.match(importSource, /authorizedImageUrls = property\.media/);
});

test("property image AI routes reject client location overrides before AI work", () => {
  for (const source of imageRouteSources) {
    assert.match(source, /requirePropertyInActiveLocation\(/);
    assert.match(source, /requestedLocationId: parsed\.data\.locationId/);
    assert.doesNotMatch(source, /verifyUserHasAccessToLocation/);
    assert.match(source, /userId: dbUserId/);
  }
});

test("import AI, draft creation, and image reuse resolve the active location server-side", () => {
  assert.match(extractionSource, /requireAuthenticatedLocationContext\(locationId\)/);
  assert.doesNotMatch(extractionSource, /locations\[0\]/);
  assert.match(importWorkflowSource, /const access = await requireAuthenticatedLocationContext\(\)/);
  assert.doesNotMatch(importWorkflowSource, /locations\[0\]/);
  assert.match(importWorkflowSource, /requireLocationImageIds\(analysisImageIds, locationId\)/);
  assert.match(importWorkflowSource, /requireLocationImageIds\(galleryImageIds, locationId\)/);
  assert.match(importWorkflowSource, /ingestUrlImportMedia\(\{/);
  assert.match(importWorkflowSource, /createPropertyAfterImportMediaValidation\(\{/);
  assert.doesNotMatch(importWorkflowSource, /validImages\.push\(\{ url: imageUrl/);
  assert.match(importWorkflowSource, /locationId: locationId/);
  assert.match(importStreamSource, /getActiveLocationId:[\s\S]*requireAuthenticatedLocationContext\(\)/);
  assert.match(importStreamSource, /siteConfig\.findUnique\(\{ where: \{ locationId \} \}\)/);
  assert.match(importStreamSource, /export async function GET\(\)[\s\S]*handlers\.GET\(\)/);
  assert.doesNotMatch(importStreamSource, /GET[\s\S]*runImportWorkflow\(/);
});

test("shared image upload and gallery endpoints enforce the active location", () => {
  assert.match(directUploadSource, /requireAuthenticatedLocationContext\(locationId\)/);
  assert.doesNotMatch(directUploadSource, /verifyUserHasAccessToLocation/);
  assert.match(imageListSource, /requireAuthenticatedLocationContext\(\)/);
  assert.match(imageListSource, /listBoundedLocationImages\(/);
});

test("property upload and AI usage disclosure expose keyboard and screen-reader state", () => {
  assert.match(mediaUploaderSource, /const inputId = useId\(\)/);
  assert.match(mediaUploaderSource, /<button/);
  assert.doesNotMatch(mediaUploaderSource, /document\.getElementById/);
  assert.match(mediaUploaderSource, /role="status"/);
  assert.match(mediaUploaderSource, /role="alert"/);
  assert.match(propertyAiBadgeSource, /aria-expanded=\{expanded\}/);
  assert.match(propertyAiBadgeSource, /aria-controls=\{detailsId\}/);
  assert.match(propertyAiBadgeSource, /role=\{showSummaryHeader \? "region"/);
});
