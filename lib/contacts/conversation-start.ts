export type ContactConversationStartIdentity = {
    phone?: string | null;
    email?: string | null;
};

export type ContactConversationStartMessageType = "TYPE_WHATSAPP" | "TYPE_SMS" | "TYPE_EMAIL";

export function canStartContactConversation(contact: ContactConversationStartIdentity | null | undefined): boolean {
    return !!contact?.phone || !!contact?.email;
}

export async function resolveContactConversationStartMessageType(
    contact: ContactConversationStartIdentity,
    resolvePhoneChannelType: (phone: string) => Promise<"TYPE_WHATSAPP" | "TYPE_SMS">
): Promise<ContactConversationStartMessageType | null> {
    if (contact.phone) {
        return resolvePhoneChannelType(contact.phone);
    }

    if (contact.email) {
        return "TYPE_EMAIL";
    }

    return null;
}
