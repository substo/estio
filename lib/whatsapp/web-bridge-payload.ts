export type PreparedWhatsAppWebBridgeWebhookPayload = {
    payload: Record<string, any>;
    body: string;
    originalBodyBytes: number;
    bodyBytes: number;
    omittedInlineMedia: boolean;
};

function byteLength(value: string) {
    return Buffer.byteLength(value, "utf8");
}

function buildBody(payload: Record<string, any>) {
    return JSON.stringify(payload);
}

function clonePayloadWithoutInlineMedia(payload: Record<string, any>, originalBodyBytes: number, maxBodyBytes: number) {
    const message = payload?.message && typeof payload.message === "object" ? payload.message : null;
    const media = message?.media && typeof message.media === "object" ? message.media : null;
    if (!message || !media || typeof media.data !== "string" || !media.data) return null;

    const { data: _data, ...mediaWithoutData } = media;
    return {
        ...payload,
        message: {
            ...message,
            media: mediaWithoutData,
            mediaMeta: {
                ...(message.mediaMeta || {}),
                inlined: false,
                omittedFromWebhook: true,
            },
            mediaError: message.mediaError || {
                code: "webhook_payload_too_large",
                message: `Inline media omitted because the webhook JSON body would exceed ${maxBodyBytes} bytes.`,
                payloadBytes: originalBodyBytes,
                limitBytes: maxBodyBytes,
                size: media.size || message.mediaMeta?.size || null,
                mimetype: media.mimetype || message.mediaMeta?.mimetype || null,
                filename: media.filename || message.mediaMeta?.filename || null,
            },
        },
    };
}

export function prepareWhatsAppWebBridgeWebhookPayload(args: {
    payload: Record<string, any>;
    maxBodyBytes: number;
}): PreparedWhatsAppWebBridgeWebhookPayload {
    const originalBody = buildBody(args.payload);
    const originalBodyBytes = byteLength(originalBody);
    if (originalBodyBytes <= args.maxBodyBytes) {
        return {
            payload: args.payload,
            body: originalBody,
            originalBodyBytes,
            bodyBytes: originalBodyBytes,
            omittedInlineMedia: false,
        };
    }

    const withoutInlineMedia = clonePayloadWithoutInlineMedia(args.payload, originalBodyBytes, args.maxBodyBytes);
    if (!withoutInlineMedia) {
        return {
            payload: args.payload,
            body: originalBody,
            originalBodyBytes,
            bodyBytes: originalBodyBytes,
            omittedInlineMedia: false,
        };
    }

    const body = buildBody(withoutInlineMedia);
    return {
        payload: withoutInlineMedia,
        body,
        originalBodyBytes,
        bodyBytes: byteLength(body),
        omittedInlineMedia: true,
    };
}
