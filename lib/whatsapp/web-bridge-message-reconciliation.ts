export function getWebBridgeDuplicateBodyReconciliation(args: {
    source?: string | null;
    existingBody?: string | null;
    incomingBody?: string | null;
}) {
    if (args.source !== "whatsapp_web_bridge") {
        return { shouldUpdate: false, body: null as string | null };
    }

    const incomingBody = String(args.incomingBody || "");
    if (!incomingBody.trim()) {
        return { shouldUpdate: false, body: null as string | null };
    }

    const existingBody = String(args.existingBody || "");
    if (existingBody === incomingBody) {
        return { shouldUpdate: false, body: null as string | null };
    }

    return { shouldUpdate: true, body: incomingBody };
}
