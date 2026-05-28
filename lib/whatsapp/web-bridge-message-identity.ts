import { parseWhatsAppWebChatIdentity } from "@/lib/whatsapp/web-bridge";

export type ResolvedWebBridgeMessageContactIdentity = {
    fromMe: boolean;
    isGroup: boolean;
    remoteJid: string;
    senderJid: string;
    contactJid: string;
    ownJid: string;
    contactIdentity: ReturnType<typeof parseWhatsAppWebChatIdentity>;
    ownIdentity: ReturnType<typeof parseWhatsAppWebChatIdentity>;
};

export function resolveInboundWhatsAppContactIdentity(input: {
    message: any;
    phone?: any;
}): ResolvedWebBridgeMessageContactIdentity {
    const message = input.message || {};
    const fromMe = Boolean(message.fromMe);
    const fromId = String(message.from || "");
    const toId = String(message.to || "");
    const participantJid = String(message.participant || message.author || message.sender || "").trim();
    const remoteJid = fromMe ? toId : fromId;
    const isGroup = /@g\.us$/i.test(remoteJid);
    const senderJid = !fromMe && isGroup && participantJid ? participantJid : remoteJid;
    const ownJid = String(input.phone || (fromMe ? fromId : toId) || "");
    const contactJid = fromMe ? remoteJid : senderJid;

    return {
        fromMe,
        isGroup,
        remoteJid,
        senderJid,
        contactJid,
        ownJid,
        contactIdentity: parseWhatsAppWebChatIdentity(contactJid),
        ownIdentity: parseWhatsAppWebChatIdentity(ownJid),
    };
}
