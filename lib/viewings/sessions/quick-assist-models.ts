export type QuickAssistModelOption = { value: string; provider: string; model: string };
export function quickAssistModelOptions(providers: { google: boolean; openai: boolean; codex: boolean }) {
    const assistant: QuickAssistModelOption[] = [];
    const transcribe: QuickAssistModelOption[] = [];
    if (providers.google) {
        for (const model of ["gemini-2.5-flash", "gemini-2.5-flash-lite"]) {
            const option = { value: model, model, provider: "Google" };
            assistant.push(option); transcribe.push(option);
        }
    }
    if (providers.openai) {
        assistant.push({ value: "openai:gpt-4o-mini", model: "gpt-4o-mini", provider: "OpenAI API" });
        for (const model of ["gpt-4o-mini-transcribe", "gpt-4o-transcribe"]) transcribe.push({ value: model, model, provider: "OpenAI API" });
    }
    if (providers.codex) for (const model of ["gpt-5.4-mini", "gpt-5.4", "gpt-5.5"]) assistant.push({ value: `chatgpt_subscription:${model}`, model, provider: "ChatGPT/Codex" });
    return { assistant, transcribe };
}
export function selectQuickAssistModel(options: QuickAssistModelOption[], requested: string = "automatic") {
    const option = requested === "automatic" ? options[0] : options.find(o => o.value === requested);
    if (!option) throw new Error("The selected model is not connected for this mode. Check Settings → Integrations.");
    return option;
}
