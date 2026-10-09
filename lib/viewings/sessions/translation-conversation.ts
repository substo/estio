export function selectedLanguageMatches(detected: string, selected: string): boolean {
    return detected.toLowerCase().split("-")[0] === selected.toLowerCase().split("-")[0];
}

export function translationTargets(input: {
    role: "agent" | "client";
    participantMode: string;
    speechMode: string;
    agentLanguage: string;
    clientLanguage: string;
}): string[] {
    const agentTarget = input.clientLanguage;
    if (input.role === "agent" && input.participantMode === "agent_only"
        && input.speechMode === "continuous" && !selectedLanguageMatches(input.agentLanguage, input.clientLanguage)) {
        return [agentTarget, input.agentLanguage];
    }
    return [input.role === "client" ? input.agentLanguage : agentTarget];
}
