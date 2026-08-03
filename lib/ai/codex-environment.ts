const CODEX_CREDENTIAL_ENV_KEYS = [
    "CODEX_ACCESS_TOKEN",
    "OPENAI_API_KEY",
    "OPENAI_ORG_ID",
    "OPENAI_ORGANIZATION",
    "OPENAI_PROJECT_ID",
] as const;

export function buildIsolatedCodexEnvironment(input: {
    baseEnv?: NodeJS.ProcessEnv;
    codexHome: string;
    accessToken?: string | null;
}): NodeJS.ProcessEnv {
    const env = { ...(input.baseEnv || process.env) };
    for (const key of CODEX_CREDENTIAL_ENV_KEYS) delete env[key];
    env.CODEX_HOME = input.codexHome;
    const accessToken = String(input.accessToken || "").trim();
    if (accessToken) env.CODEX_ACCESS_TOKEN = accessToken;
    return env;
}
