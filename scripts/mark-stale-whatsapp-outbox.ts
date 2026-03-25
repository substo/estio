import db from "@/lib/db";

type CleanupResult = {
    inspected: number;
    outboxUpdated: number;
    messageUpdated: number;
    cutoffIso: string;
    dryRun: boolean;
};

function parseCutoffMinutes(argv: string[]): number {
    const explicitArg = argv.find((arg) => arg.startsWith("--cutoff-minutes="));
    const raw = explicitArg ? explicitArg.split("=")[1] : process.env.WHATSAPP_OUTBOX_STALE_FAIL_CUTOFF_MINUTES;
    const parsed = Number(raw || 15);
    if (!Number.isFinite(parsed)) return 15;
    return Math.max(1, Math.floor(parsed));
}

function hasFlag(argv: string[], flag: string): boolean {
    return argv.includes(flag);
}

async function runCleanup(cutoffMinutes: number, dryRun: boolean): Promise<CleanupResult> {
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - cutoffMinutes * 60 * 1000);
    const staleRows = await (db as any).whatsAppOutboundOutbox.findMany({
        where: {
            status: { in: ["pending", "failed", "processing"] },
            createdAt: { lte: cutoffDate },
        },
        select: {
            id: true,
            messageId: true,
            status: true,
            createdAt: true,
            conversationId: true,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    if (dryRun || staleRows.length === 0) {
        return {
            inspected: staleRows.length,
            outboxUpdated: 0,
            messageUpdated: 0,
            cutoffIso: cutoffDate.toISOString(),
            dryRun,
        };
    }

    const staleOutboxIds = staleRows.map((row: any) => String(row.id));
    const staleMessageIds = staleRows.map((row: any) => String(row.messageId));
    const operatorError = `Operator cleanup: marked stale open outbox row (> ${cutoffMinutes}m) as failed/dead.`;

    const [outboxUpdate, messageUpdate] = await db.$transaction([
        (db as any).whatsAppOutboundOutbox.updateMany({
            where: { id: { in: staleOutboxIds } },
            data: {
                status: "dead",
                processedAt: now,
                lockedAt: null,
                lockedBy: null,
                lastError: operatorError,
            },
        }),
        db.message.updateMany({
            where: {
                id: { in: staleMessageIds },
                direction: "outbound",
                status: { in: ["sending", "sent", "delivered", "read", "played"] },
            },
            data: {
                status: "failed",
                updatedAt: now,
            },
        }),
    ]);

    return {
        inspected: staleRows.length,
        outboxUpdated: Number((outboxUpdate as any)?.count || 0),
        messageUpdated: Number((messageUpdate as any)?.count || 0),
        cutoffIso: cutoffDate.toISOString(),
        dryRun,
    };
}

async function main() {
    const argv = process.argv.slice(2);
    const cutoffMinutes = parseCutoffMinutes(argv);
    const dryRun = hasFlag(argv, "--dry-run");

    const result = await runCleanup(cutoffMinutes, dryRun);
    console.log(JSON.stringify({
        success: true,
        cutoffMinutes,
        ...result,
    }, null, 2));
}

main()
    .catch((error) => {
        console.error("[mark-stale-whatsapp-outbox] Failed:", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.$disconnect();
    });
