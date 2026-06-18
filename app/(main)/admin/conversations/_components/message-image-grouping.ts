import type { Message } from "@/lib/ghl/conversations";
import {
    classifyMessageAttachments,
    normalizeMessageAttachments,
    type NormalizedMessageAttachment,
} from "./message-bubble-attachment-actions";

const GROUP_WINDOW_MS = 90 * 1000;
const MEDIA_PLACEHOLDER_BODIES = new Set(["", "[image]", "[media]"]);

export type MessageImageGroupItem = {
    message: Message;
    image: NormalizedMessageAttachment;
};

export type MessageImageGroup = {
    id: string;
    direction: "inbound" | "outbound";
    messages: Message[];
    items: MessageImageGroupItem[];
};

export type GroupedMessageTimelineItem<TActivity> =
    | { kind: "activity"; activity: TActivity }
    | { kind: "message"; message: Message }
    | { kind: "image-group"; group: MessageImageGroup };

function getMessageTime(message: Message): number {
    const time = new Date(message.dateAdded).getTime();
    return Number.isFinite(time) ? time : 0;
}

function isImageOnlyWhatsAppMessage(message: Message): MessageImageGroupItem | null {
    if (!String(message.type || "").toUpperCase().includes("WHATSAPP")) return null;

    const attachments = normalizeMessageAttachments(message.attachments);
    const { imageAttachments, audioAttachments, videoAttachments, contactAttachments, fileAttachments } = classifyMessageAttachments(attachments);
    if (imageAttachments.length !== 1 || audioAttachments.length > 0 || videoAttachments.length > 0 || contactAttachments.length > 0 || fileAttachments.length > 0) {
        return null;
    }

    const body = String(message.body || "").trim().toLowerCase();
    if (!MEDIA_PLACEHOLDER_BODIES.has(body)) return null;

    return {
        message,
        image: imageAttachments[0],
    };
}

function canAppendToGroup(group: MessageImageGroup, candidate: MessageImageGroupItem): boolean {
    const previous = group.messages[group.messages.length - 1];
    if (!previous) return false;
    if (previous.direction !== candidate.message.direction) return false;
    if (String(previous.source || "") !== String(candidate.message.source || "")) return false;

    const previousTime = getMessageTime(previous);
    const candidateTime = getMessageTime(candidate.message);
    if (!previousTime || !candidateTime) return false;

    return Math.abs(candidateTime - previousTime) <= GROUP_WINDOW_MS;
}

function createGroup(item: MessageImageGroupItem): MessageImageGroup {
    return {
        id: `image-group-${item.message.id}`,
        direction: item.message.direction,
        messages: [item.message],
        items: [item],
    };
}

function finalizeGroup<TActivity>(
    output: GroupedMessageTimelineItem<TActivity>[],
    group: MessageImageGroup | null
) {
    if (!group) return;
    if (group.items.length >= 2) {
        output.push({ kind: "image-group", group });
        return;
    }
    output.push({ kind: "message", message: group.messages[0] });
}

export function groupAdjacentWhatsAppImageMessages<TActivity>(
    timelineItems: Array<{ kind: "activity"; activity: TActivity } | { kind: "message"; message: Message }>
): GroupedMessageTimelineItem<TActivity>[] {
    const output: GroupedMessageTimelineItem<TActivity>[] = [];
    let currentGroup: MessageImageGroup | null = null;

    for (const item of timelineItems) {
        if (item.kind === "activity") {
            finalizeGroup(output, currentGroup);
            currentGroup = null;
            output.push(item);
            continue;
        }

        const imageItem = isImageOnlyWhatsAppMessage(item.message);
        if (!imageItem) {
            finalizeGroup(output, currentGroup);
            currentGroup = null;
            output.push(item);
            continue;
        }

        if (!currentGroup) {
            currentGroup = createGroup(imageItem);
            continue;
        }

        if (canAppendToGroup(currentGroup, imageItem)) {
            currentGroup.messages.push(imageItem.message);
            currentGroup.items.push(imageItem);
            continue;
        }

        finalizeGroup(output, currentGroup);
        currentGroup = createGroup(imageItem);
    }

    finalizeGroup(output, currentGroup);
    return output;
}
