import { modelSupportsTask } from "@/lib/ai/model-capabilities";

export function resolveReplyTranslationModel(args: {
    requestedModel?: string | null;
    configuredModel: string;
}): string {
    const requestedModel = String(args.requestedModel || "").trim();
    if (
        requestedModel
        && modelSupportsTask({ value: requestedModel }, "conversation.translation")
    ) {
        return requestedModel;
    }

    return String(args.configuredModel || "").trim();
}
