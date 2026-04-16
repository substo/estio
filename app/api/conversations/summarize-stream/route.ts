import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { getLocationContext } from "@/lib/auth/location-context";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getModelForTask } from "@/lib/ai/model-router";
import { calculateRunCostFromUsage } from "@/lib/ai/pricing";
import { revalidatePath } from "next/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SummarizeStreamBody = {
    conversationId?: string;
    selectedText?: string;
    model?: string;
};

const MAX_SELECTION_TEXT_LENGTH = 12000;

function sanitize(value: unknown): string {
    if (typeof value !== "string") return "";
    return value.replace(/\u00a0/g, " ").trim();
}

function normalizeSingleLine(text: string, fallback: string): string {
    const cleaned = String(text || "")
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/[\r\n]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return cleaned || fallback;
}

function normalizeFirstNameToken(value: string | null | undefined): string {
    const cleaned = String(value || "")
        .trim()
        .replace(/^[^\p{L}]+/u, "")
        .replace(/[^\p{L}'-]+$/gu, "");
    if (!cleaned) return "";
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function deriveFirstNameFromEmail(email: string | null | undefined): string {
    const rawEmail = String(email || "").trim().toLowerCase();
    if (!rawEmail || !rawEmail.includes("@")) return "";
    const [rawLocal, rawDomain] = rawEmail.split("@");
    let local = String(rawLocal || "").split("+")[0].trim();
    const domain = String(rawDomain || "").trim();
    if (!local) return "";
    const labels = domain.split(".").map((l) => l.trim()).filter(Boolean);
    const domainStems = Array.from(new Set([
        labels.length >= 2 ? labels[labels.length - 2] : "",
        ...labels.filter((l) => l.length >= 4),
    ])).filter(Boolean).sort((a, b) => b.length - a.length);
    for (const stem of domainStems) {
        if (local.endsWith(stem) && local.length > stem.length + 1) {
            local = local.slice(0, -stem.length);
            break;
        }
    }
    const token = local.replace(/[._-]+/g, " ").trim().split(/\s+/)[0] || "";
    return normalizeFirstNameToken(token);
}

function deriveOptionalFirstName(
    firstName: string | null | undefined,
    name: string | null | undefined,
    email: string | null | undefined
): string {
    const nfn = normalizeFirstNameToken(firstName);
    if (nfn) return nfn;
    const rawName = String(name || "").trim();
    if (rawName) {
        const fromName = normalizeFirstNameToken(rawName.split(/\s+/)[0]);
        if (fromName) return fromName;
    }
    const fromEmail = deriveFirstNameFromEmail(email);
    if (fromEmail) return fromEmail;
    return "";
}

function escapeRegExp(value: string): string {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePhoneDigits(value: string | null | undefined): string {
    return String(value || "").replace(/\D/g, "");
}

function phoneDigitsLikelyMatch(a: string, b: string): boolean {
    const left = String(a || "").trim();
    const right = String(b || "").trim();
    if (!left || !right) return false;
    if (left === right) return true;
    if (left.length < 7 || right.length < 7) return false;
    return left.endsWith(right) || right.endsWith(left);
}

function replaceContactIdentityMentionsWithFirstName(
    summary: string,
    contact: { firstName?: string | null; name?: string | null; email?: string | null; phone?: string | null } | null | undefined
): string {
    const firstName = deriveOptionalFirstName(contact?.firstName, contact?.name, contact?.email) || "Contact";
    const contactDigits = normalizePhoneDigits(contact?.phone);
    const contactEmail = String(contact?.email || "").trim();
    const contactName = String(contact?.name || "").trim();
    let rewritten = String(summary || "");
    if (contactDigits) {
        rewritten = rewritten.replace(/\+?\d[\d\s().-]{5,}\d/g, (token) => {
            const tokenDigits = normalizePhoneDigits(token);
            if (!tokenDigits) return token;
            return phoneDigitsLikelyMatch(tokenDigits, contactDigits) ? firstName : token;
        });
    }
    if (contactEmail) {
        rewritten = rewritten.replace(new RegExp(escapeRegExp(contactEmail), "gi"), firstName);
    }
    if (contactName && contactName.toLowerCase() !== firstName.toLowerCase()) {
        rewritten = rewritten.replace(new RegExp(`\\b${escapeRegExp(contactName)}\\b`, "gi"), firstName);
    }
    rewritten = rewritten.replace(new RegExp(`\\b(?:lead|contact|client)\\s+${escapeRegExp(firstName)}\\b`, "gi"), firstName);
    rewritten = rewritten.replace(/\b(?:lead|contact|client)\s+(?:named\s+)?(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\+?\d[\d\s().-]{5,}\d)\b/gi, firstName);
    return rewritten;
}

function formatLogDate(date: Date): string {
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yy = String(date.getFullYear()).slice(-2);
    return `${dd}.${mm}.${yy}`;
}

function normalizeForLogDedupe(text: string): string {
    return String(text || "")
        .toLowerCase()
        .replace(/[\r\n]+/g, " ")
        .replace(/[^a-z0-9\s€$£%.,:/-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function tokenizeForLogDedupe(text: string): string[] {
    return normalizeForLogDedupe(text).split(/\s+/).filter(Boolean);
}

function isLikelyDuplicateManualEntry(candidate: string, existing: string): boolean {
    const a = normalizeForLogDedupe(candidate);
    const b = normalizeForLogDedupe(existing);
    if (!a || !b) return false;
    if (a === b) return true;
    const tokensA = tokenizeForLogDedupe(a);
    const tokensB = new Set(tokenizeForLogDedupe(b));
    if (!tokensA.length || !tokensB.size) return false;
    const overlap = tokensA.filter((t) => tokensB.has(t)).length;
    return overlap / Math.max(tokensA.length, tokensB.size) > 0.75;
}

function extractManualEntryTextFromChanges(changes: unknown): string {
    if (!changes || typeof changes !== "object") return "";
    const obj = changes as Record<string, unknown>;
    return String(obj.entry || "").trim();
}

export async function POST(req: NextRequest) {
    const location = await getLocationContext();
    if (!location) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null) as SummarizeStreamBody | null;
    const conversationId = sanitize(body?.conversationId);
    const selectedText = sanitize(body?.selectedText);
    const modelOverride = sanitize(body?.model);

    if (!conversationId) {
        return NextResponse.json({ success: false, error: "conversationId is required" }, { status: 400 });
    }

    const trimmedText = selectedText.length > MAX_SELECTION_TEXT_LENGTH
        ? selectedText.slice(0, MAX_SELECTION_TEXT_LENGTH)
        : selectedText;

    if (!trimmedText || trimmedText.length < 5) {
        return NextResponse.json({ success: false, error: "Selected text is too short" }, { status: 400 });
    }

    // Resolve conversation
    const conversation = await db.conversation.findFirst({
        where: {
            locationId: location.id,
            OR: [
                { id: conversationId },
                { ghlConversationId: conversationId },
            ],
        },
        select: {
            id: true,
            ghlConversationId: true,
            contactId: true,
            contact: {
                select: {
                    firstName: true,
                    name: true,
                    email: true,
                    phone: true,
                },
            },
        },
    });

    if (!conversation) {
        return NextResponse.json({ success: false, error: "Conversation not found" }, { status: 404 });
    }

    const contactFirstName = deriveOptionalFirstName(
        conversation.contact?.firstName,
        conversation.contact?.name,
        conversation.contact?.email
    );

    // Build prompt (same as server action)
    const summaryPrompt = [
        "You write concise internal CRM activity summaries for real estate teams.",
        "Rules:",
        "- Return exactly one plain-text sentence.",
        "- Keep it factual and action-oriented.",
        "- Include key entities (person/property/reference/price/date) only if present in the source text.",
        contactFirstName
            ? `- Refer to the person as ${contactFirstName} (first name only) when mentioning the contact.`
            : "- If a contact name is present, refer to the person by first name only.",
        "- Never identify the contact by full name, phone number, or email.",
        "- Do not include agent name or date prefix.",
        "- Do not use markdown, bullets, or quotes.",
        "",
        "Selected text:",
        '"""',
        trimmedText,
        '"""',
    ].join("\n");

    // Resolve API key and model
    const siteConfig = await db.siteConfig.findUnique({
        where: { locationId: location.id },
    });
    const configAny = siteConfig as any;
    const apiKey = configAny?.googleAiApiKey || process.env.GOOGLE_API_KEY;

    if (!apiKey) {
        return NextResponse.json({ success: false, error: "No AI API key configured" }, { status: 500 });
    }

    const modelId = modelOverride || getModelForTask("simple_generation");

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const push = (payload: Record<string, unknown>) => {
                controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
            };

            try {
                push({ type: "started", ts: new Date().toISOString() });

                const genAI = new GoogleGenerativeAI(apiKey);
                const model = genAI.getGenerativeModel({
                    model: modelId,
                    generationConfig: {
                        responseMimeType: "text/plain",
                        temperature: 0.2,
                    } as any,
                });

                const startedAt = Date.now();
                const streamResult = await model.generateContentStream(summaryPrompt);
                let rawSummary = "";

                for await (const chunk of streamResult.stream) {
                    const delta = chunk.text();
                    if (!delta) continue;
                    rawSummary += delta;
                    push({ type: "chunk", text: delta });
                }

                const response = await streamResult.response;
                if (!rawSummary) {
                    rawSummary = response.text();
                    if (rawSummary) {
                        push({ type: "chunk", text: rawSummary });
                    }
                }

                const latencyMs = Date.now() - startedAt;

                // Post-process (same as server action)
                const normalizedSummary = normalizeSingleLine(rawSummary, "Contacted lead and captured conversation update.");
                const summary = replaceContactIdentityMentionsWithFirstName(normalizedSummary, conversation.contact);

                push({ type: "summary_ready", summary });

                // Persist CRM log entry
                const user = await db.user.findUnique({
                    where: { clerkId: clerkUserId },
                    select: { id: true, firstName: true, name: true, email: true },
                });

                let entry = summary;
                let skipped = false;
                let persistError: string | null = null;

                if (user) {
                    // Check for duplicates
                    const recent = await db.contactHistory.findMany({
                        where: { contactId: conversation.contactId, action: "MANUAL_ENTRY" },
                        orderBy: { createdAt: "desc" },
                        take: 8,
                        select: { id: true, createdAt: true, changes: true },
                    });

                    let duplicate = false;
                    let duplicateEntry = "";
                    for (const item of recent) {
                        const existingEntry = extractManualEntryTextFromChanges(item.changes);
                        if (!existingEntry) continue;
                        if (isLikelyDuplicateManualEntry(summary, existingEntry)) {
                            duplicate = true;
                            duplicateEntry = existingEntry;
                            break;
                        }
                    }

                    if (duplicate) {
                        skipped = true;
                        entry = duplicateEntry;
                    } else {
                        const now = new Date();
                        const actorFirstName = deriveOptionalFirstName(user.firstName, user.name, user.email) || "User";
                        const normalizedBody = normalizeSingleLine(summary, "Updated conversation notes.");
                        entry = `${formatLogDate(now)} ${actorFirstName}: ${normalizedBody}`;

                        await db.contactHistory.create({
                            data: {
                                contactId: conversation.contactId,
                                userId: user.id,
                                action: "MANUAL_ENTRY",
                                changes: { date: now.toISOString(), entry },
                            },
                        });

                        revalidatePath(`/admin/contacts/${conversation.contactId}/view`);
                    }
                } else {
                    persistError = "User not found";
                }

                // Persist AI execution trace (fire and forget)
                try {
                    const usageMeta = (response.usageMetadata || {}) as Record<string, unknown>;
                    const readUsage = (key: string) => {
                        const value = Number(usageMeta[key]);
                        return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
                    };
                    const usage = {
                        promptTokens: readUsage("promptTokenCount"),
                        completionTokens: readUsage("candidatesTokenCount"),
                        totalTokens: readUsage("totalTokenCount"),
                        thoughtsTokens: readUsage("thoughtsTokenCount"),
                        toolUsePromptTokens: readUsage("toolUsePromptTokenCount"),
                    };

                    const costEstimate = calculateRunCostFromUsage(modelId, usage);

                    await db.agentExecution.create({
                        data: {
                            conversationId: conversation.id,
                            locationId: location.id,
                            taskTitle: "Selection Summary to CRM Log",
                            taskStatus: "done",
                            status: "success",
                            skillName: "selection_toolbar",
                            intent: "selection_summary",
                            model: modelId,
                            thoughtSummary: `Selection action "Selection Summary to CRM Log" completed and usage recorded.`,
                            thoughtSteps: [
                                { step: 1, description: "LLM request payload", conclusion: "Captured full request prompt", data: { model: modelId, prompt: summaryPrompt } },
                                { step: 2, description: "LLM response payload", conclusion: "Captured normalized output and usage metadata", data: { rawOutput: rawSummary, normalizedOutput: summary, usage } },
                                { step: 3, description: "Usage & cost estimate", conclusion: `Estimated run cost (${costEstimate.confidence} confidence)`, data: { usd: costEstimate.amount, method: costEstimate.method, confidence: costEstimate.confidence } },
                            ] as any,
                            latencyMs: Math.max(1, Math.round(latencyMs)),
                            promptTokens: usage.promptTokens,
                            completionTokens: usage.completionTokens,
                            totalTokens: usage.totalTokens,
                            cost: costEstimate.amount,
                        },
                    });
                } catch (traceError) {
                    console.warn("[summarize-stream] Failed to persist AI usage trace:", traceError);
                }

                push({
                    type: "complete",
                    entry,
                    summary,
                    skipped,
                    error: persistError,
                });
            } catch (error: any) {
                console.error("[summarize-stream] Error:", error);
                push({
                    type: "error",
                    message: error?.message || "Failed to summarize selection",
                });
            } finally {
                controller.close();
            }
        },
    });

    return new NextResponse(stream, {
        headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "Transfer-Encoding": "chunked",
            "X-Content-Type-Options": "nosniff",
        },
    });
}
