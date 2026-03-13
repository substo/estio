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

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const cleanKey = key.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[cleanKey] = "true";
      continue;
    }
    args[cleanKey] = next;
    i += 1;
  }
  return args;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[idx];
}

function summarize(samplesMs) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const total = sorted.reduce((acc, v) => acc + v, 0);
  return {
    count: sorted.length,
    minMs: sorted[0] || 0,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    maxMs: sorted[sorted.length - 1] || 0,
    avgMs: sorted.length ? total / sorted.length : 0,
  };
}

async function runBatched(iterations, concurrency, fn) {
  const samplesMs = [];
  let completed = 0;
  while (completed < iterations) {
    const size = Math.min(concurrency, iterations - completed);
    const batch = Array.from({ length: size }, async () => {
      const start = process.hrtime.bigint();
      await fn();
      const end = process.hrtime.bigint();
      const ms = Number(end - start) / 1_000_000;
      samplesMs.push(ms);
    });
    await Promise.all(batch);
    completed += size;
  }
  return samplesMs;
}

async function main() {
  const cwd = process.cwd();
  loadEnvFile(path.join(cwd, ".env"));
  loadEnvFile(path.join(cwd, ".env.local"));

  const args = parseArgs(process.argv.slice(2));
  const iterations = Math.max(10, Number(args.iterations || 80));
  const concurrency = Math.max(1, Number(args.concurrency || 8));
  const listTake = Math.max(10, Math.min(200, Number(args.listTake || 50)));
  const messageTake = Math.max(20, Math.min(500, Number(args.messageTake || 250)));
  const activityTake = Math.max(20, Math.min(400, Number(args.activityTake || 180)));

  const db = new PrismaClient();
  try {
    const locationIdArg = String(args.locationId || "").trim();

    const location =
      locationIdArg
        ? await db.location.findUnique({
            where: { id: locationIdArg },
            select: { id: true, name: true },
          })
        : await db.location.findFirst({
            select: { id: true, name: true },
            orderBy: { createdAt: "asc" },
          });

    if (!location) {
      throw new Error("No location found.");
    }

    const conversationIdArg = String(args.conversationId || "").trim();
    const activeConversation =
      conversationIdArg
        ? await db.conversation.findFirst({
            where: {
              locationId: location.id,
              OR: [{ id: conversationIdArg }, { ghlConversationId: conversationIdArg }],
            },
            select: {
              id: true,
              ghlConversationId: true,
              contactId: true,
            },
          })
        : await db.conversation.findFirst({
            where: {
              locationId: location.id,
              deletedAt: null,
            },
            orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
            select: {
              id: true,
              ghlConversationId: true,
              contactId: true,
            },
          });

    if (!activeConversation) {
      throw new Error(`No conversation found for location ${location.id}.`);
    }

    const activeDeal = await db.dealContext.findFirst({
      where: {
        locationId: location.id,
        stage: { not: "CLOSED" },
      },
      orderBy: [{ lastActivityAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        conversationIds: true,
      },
    });

    const listQuery = async () => {
      await db.conversation.findMany({
        where: {
          locationId: location.id,
          deletedAt: null,
          archivedAt: null,
        },
        orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
        take: listTake,
        include: {
          contact: {
            select: {
              name: true,
              phone: true,
              email: true,
              ghlContactId: true,
            },
          },
        },
      });
    };

    const workspaceCoreQuery = async () => {
      const [conversation] = await Promise.all([
        db.conversation.findUnique({
          where: { id: activeConversation.id },
          select: {
            id: true,
            contactId: true,
            locationId: true,
            updatedAt: true,
            lastMessageAt: true,
            unreadCount: true,
          },
        }),
      ]);

      if (!conversation) {
        throw new Error("Conversation disappeared during benchmark.");
      }

      await Promise.all([
        db.message.findMany({
          where: { conversationId: conversation.id },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: messageTake,
        }),
        db.contactHistory.findMany({
          where: { contactId: conversation.contactId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: activityTake,
        }),
        db.contactTask.findMany({
          where: {
            contactId: conversation.contactId,
            conversationId: conversation.id,
            deletedAt: null,
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: activityTake,
        }),
        db.viewing.findMany({
          where: { contactId: conversation.contactId },
          orderBy: [{ date: "desc" }, { id: "desc" }],
          take: activityTake,
        }),
      ]);
    };

    const dealWorkspaceCoreQuery = activeDeal
      ? async () => {
          const conversations = await db.conversation.findMany({
            where: {
              locationId: location.id,
              ghlConversationId: { in: activeDeal.conversationIds },
            },
            select: {
              id: true,
              contactId: true,
            },
          });

          if (conversations.length === 0) return;

          const conversationIds = conversations.map((conversation) => conversation.id);
          const contactIds = Array.from(new Set(conversations.map((conversation) => conversation.contactId)));

          await Promise.all([
            db.message.findMany({
              where: { conversationId: { in: conversationIds } },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: messageTake,
            }),
            db.contactHistory.findMany({
              where: { contactId: { in: contactIds } },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: activityTake,
            }),
            db.contactTask.findMany({
              where: {
                contactId: { in: contactIds },
                deletedAt: null,
              },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: activityTake,
            }),
            db.viewing.findMany({
              where: { contactId: { in: contactIds } },
              orderBy: [{ date: "desc" }, { id: "desc" }],
              take: activityTake,
            }),
          ]);
        }
      : null;

    const now = Date.now();
    const deltaCutoff = new Date(now - 3 * 60 * 1000);
    const deltaQuery = async () => {
      await db.conversation.findMany({
        where: {
          locationId: location.id,
          OR: [{ updatedAt: { gt: deltaCutoff } }, { id: activeConversation.id }],
        },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: 150,
        include: {
          contact: {
            select: {
              name: true,
              phone: true,
              email: true,
              ghlContactId: true,
            },
          },
        },
      });
    };

    // Warmup
    await runBatched(10, Math.min(concurrency, 4), listQuery);
    await runBatched(10, Math.min(concurrency, 4), workspaceCoreQuery);
    await runBatched(10, Math.min(concurrency, 4), deltaQuery);
    if (dealWorkspaceCoreQuery) {
      await runBatched(10, Math.min(concurrency, 4), dealWorkspaceCoreQuery);
    }

    const [listSamples, workspaceCoreSamples, deltaSamples, dealWorkspaceCoreSamples] = await Promise.all([
      runBatched(iterations, concurrency, listQuery),
      runBatched(iterations, concurrency, workspaceCoreQuery),
      runBatched(iterations, concurrency, deltaQuery),
      dealWorkspaceCoreQuery
        ? runBatched(iterations, concurrency, dealWorkspaceCoreQuery)
        : Promise.resolve([]),
    ]);

    const listStats = summarize(listSamples);
    const workspaceCoreStats = summarize(workspaceCoreSamples);
    const deltaStats = summarize(deltaSamples);
    const dealWorkspaceCoreStats = summarize(dealWorkspaceCoreSamples);

    const output = {
      context: {
        locationId: location.id,
        locationName: location.name || null,
        conversationId: activeConversation.ghlConversationId,
        dealId: activeDeal?.id || null,
        iterations,
        concurrency,
        listTake,
        messageTake,
        activityTake,
      },
      results: {
        listRefresh: listStats,
        conversationSwitchWorkspaceCore: workspaceCoreStats,
        dealSwitchWorkspaceCore: dealWorkspaceCoreStats,
        listDelta: deltaStats,
      },
      targets: {
        listRefreshP95LtMs: 700,
        conversationSwitchWorkspaceCoreP95LtMs: 700,
        dealSwitchWorkspaceCoreP95LtMs: 700,
        listDeltaP95LtMs: 500,
      },
      passFail: {
        listRefresh: listStats.p95Ms < 700,
        conversationSwitchWorkspaceCore: workspaceCoreStats.p95Ms < 700,
        dealSwitchWorkspaceCore: dealWorkspaceCoreQuery ? dealWorkspaceCoreStats.p95Ms < 700 : true,
        listDelta: deltaStats.p95Ms < 500,
      },
    };

    console.log(JSON.stringify(output, null, 2));
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("[conversations-db-load-check] failed:", error?.message || error);
  process.exit(1);
});
