function serializedJid(value: any) {
    return String(value?._serialized || value?.serialized || value || "").trim();
}

function firstJid(candidates: any[], pattern: RegExp) {
    return candidates
        .map(serializedJid)
        .find((candidate) => pattern.test(candidate)) || "";
}

function metadataCandidates(messageOrChat: any, contact: any) {
    const data = messageOrChat?._data || {};
    const embedded = messageOrChat?._contactIdentity || messageOrChat?.contactIdentity || null;
    const fromMe = Boolean(messageOrChat?.fromMe ?? data?.id?.fromMe ?? data?.fromMe);
    const directional = fromMe
        ? [data?.recipientObj, data?.toObj, data?.recipient]
        : [data?.senderObj, data?.authorObj, data?.fromObj, data?.sender, data?.author];

    return [
        embedded,
        contact,
        ...directional,
        data?.contact,
        data?.contactObj,
    ].filter((candidate) => candidate && typeof candidate === "object");
}

export function extractWhatsAppWebBridgeContactMetadata(args: {
    messageOrChat: any;
    contact?: any;
    fallbackJid?: string;
}) {
    const candidates = metadataCandidates(args.messageOrChat, args.contact);
    const jidCandidates = candidates.flatMap((candidate) => [
        candidate?.phoneJid,
        candidate?.phoneNumber,
        candidate?.pn,
        candidate?.id,
        candidate?.wid,
        candidate?.jid,
        candidate?.lidJid,
        candidate?.lid,
    ]);
    const fallbackJid = String(args.fallbackJid || "").trim();
    const phoneJid = firstJid(
        [...jidCandidates, fallbackJid],
        /@(c\.us|s\.whatsapp\.net)$/i,
    );
    const lidJid = firstJid(
        [...jidCandidates, fallbackJid],
        /@lid$/i,
    );
    const displayName = candidates
        .map((candidate) => String(
            candidate?.displayName
            || candidate?.verifiedName
            || candidate?.name
            || candidate?.shortName
            || candidate?.pushname
            || candidate?.pushName
            || candidate?.notifyName
            || ""
        ).trim())
        .find(Boolean) || "";
    const primary = candidates[0] || {};

    return {
        phoneJid,
        lidJid,
        displayName,
        number: primary?.number || null,
        pushname: primary?.pushname || primary?.pushName || null,
        name: primary?.name || null,
        shortName: primary?.shortName || null,
        verifiedName: primary?.verifiedName || null,
        isMyContact: candidates
            .map((candidate) => candidate?.isMyContact)
            .find((value) => typeof value === "boolean") ?? null,
        isBusiness: candidates
            .map((candidate) => candidate?.isBusiness)
            .find((value) => typeof value === "boolean") ?? null,
    };
}
