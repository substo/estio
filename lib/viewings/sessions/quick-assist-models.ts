import { resolveCrmWorkflowCapabilities } from "../../ai/crm-workflow-capabilities";
export type QuickAssistModelOption = { value: string; provider: string; model: string };
export function quickAssistModelOptions(providers: { google: boolean; openai: boolean; codex: boolean }) {
    // Session auth/edition gates run before this helper. These flags must come
    // from the actual scoped resolvers, never generic connection availability.
    const sources = { google_api: { eligible: providers.google }, openai_api: { eligible: providers.openai }, hosted_subscription: { eligible: providers.codex } };
    const canUse = (workflow: "live_assistant" | "live_transcription", source: "google_api" | "openai_api" | "hosted_subscription") =>
        resolveCrmWorkflowCapabilities({ app: "estio", workflow, sources }).routes.some(route => route.source === source && route.eligible);
    const assistant: QuickAssistModelOption[] = [];
    const transcribe: QuickAssistModelOption[] = [];
    if (canUse("live_assistant", "hosted_subscription")) for (const model of ["gpt-5.4-mini", "gpt-5.4", "gpt-5.5"]) assistant.push({ value: `chatgpt_subscription:${model}`, model, provider: "ChatGPT/Codex" });
    if (canUse("live_assistant", "google_api")) {
        for (const model of ["gemini-2.5-flash-lite", "gemini-2.5-flash"]) {
            const option = { value: model, model, provider: "Google" };
            assistant.push(option); if (canUse("live_transcription", "google_api")) transcribe.push(option);
        }
    }
    if (canUse("live_assistant", "openai_api")) {
        assistant.push({ value: "openai:gpt-4o-mini", model: "gpt-4o-mini", provider: "OpenAI API" });
        if (canUse("live_transcription", "openai_api")) for (const model of ["gpt-4o-mini-transcribe", "gpt-4o-transcribe"]) transcribe.push({ value: model, model, provider: "OpenAI API" });
    }
    return { assistant, transcribe };
}
export function selectQuickAssistModel(options: QuickAssistModelOption[], requested: string = "automatic") {
    const option = requested === "automatic" ? options[0] : options.find(o => o.value === requested);
    if (!option) throw new Error("The selected model is not connected for this mode. Check Settings → Integrations.");
    return option;
}
