#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

function normalizePlanRows(rows) {
  return (rows || [])
    .map((row) => String(row["QUERY PLAN"] || row.query_plan || ""))
    .join("\n");
}

function planMatchesAny(plan, patterns) {
  const normalized = String(plan || "").toLowerCase();
  return patterns.some((pattern) => normalized.includes(pattern.toLowerCase()));
}

async function main() {
  const cwd = process.cwd();
  loadEnvFile(path.join(cwd, ".env"));
  loadEnvFile(path.join(cwd, ".env.local"));

  const db = new PrismaClient();
  try {
    const location = await db.location.findFirst({
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    });
    if (!location) throw new Error("No location found.");

    const conversation = await db.conversation.findFirst({
      where: { locationId: location.id },
      select: { id: true, contactId: true },
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    });
    if (!conversation) throw new Error("No conversation found for selected location.");

    const listPlanRows = await db.$queryRawUnsafe(
      `EXPLAIN SELECT c.id, c."lastMessageAt"
       FROM "Conversation" c
       WHERE c."locationId" = $1
         AND c."deletedAt" IS NULL
         AND c."archivedAt" IS NULL
       ORDER BY c."lastMessageAt" DESC, c.id DESC
       LIMIT 50`,
      location.id
    );

    const messagePlanRows = await db.$queryRawUnsafe(
      `EXPLAIN SELECT m.id, m."updatedAt"
       FROM "Message" m
       WHERE m."conversationId" = $1
       ORDER BY m."updatedAt" DESC
       LIMIT 250`,
      conversation.id
    );

    const historyPlanRows = await db.$queryRawUnsafe(
      `EXPLAIN SELECT h.id, h."createdAt"
       FROM "ContactHistory" h
       WHERE h."contactId" = $1
       ORDER BY h."createdAt" DESC
       LIMIT 180`,
      conversation.contactId
    );

    const listPlan = normalizePlanRows(listPlanRows);
    const messagePlan = normalizePlanRows(messagePlanRows);
    const historyPlan = normalizePlanRows(historyPlanRows);

    const checks = {
      conversationListIndex: planMatchesAny(listPlan, [
        "index scan",
        "bitmap heap scan",
      ]) && planMatchesAny(listPlan, [
        "idx_conversation_active_list",
        "conversation_locationid_deletedat_archivedat_lastmessageat_id_idx",
      ]),
      messageConversationIndex: planMatchesAny(messagePlan, [
        "index scan",
        "bitmap heap scan",
      ]) && planMatchesAny(messagePlan, [
        "idx_message_conversation_updated",
        "message_conversationid_updatedat_idx",
        "message_conversationid_createdat_idx",
      ]),
      contactHistoryIndex: planMatchesAny(historyPlan, [
        "index scan",
        "bitmap heap scan",
      ]) && planMatchesAny(historyPlan, [
        "idx_contact_history_contact_created",
        "contacthistory_contactid_createdat_idx",
      ]),
    };

    const output = {
      location: {
        id: location.id,
        name: location.name || null,
      },
      checks,
      pass: Object.values(checks).every(Boolean),
      plans: {
        listPlan,
        messagePlan,
        historyPlan,
      },
    };

    console.log(JSON.stringify(output, null, 2));
    if (!output.pass) process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("[conversations-query-plan-check] failed:", error?.message || error);
  process.exit(1);
});
