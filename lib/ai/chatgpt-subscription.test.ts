import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

import {
    CHATGPT_SUBSCRIPTION_MODEL_VALUE_PREFIX,
    buildCodexCliCommand,
    buildCodexTextPrompt,
    callChatGptSubscriptionWithMetadata,
    getChatGptSubscriptionSetupGuide,
    hasChatGptSubscriptionAuth,
    isChatGptSubscriptionModelId,
    resolveChatGptSubscriptionDefaultModel,
    stripChatGptSubscriptionModelPrefix,
    validateChatGptSubscriptionConnection,
} from "./chatgpt-subscription";

test("chatgpt subscription model helpers normalize provider-prefixed ids", () => {
    assert.equal(isChatGptSubscriptionModelId("chatgpt_subscription:gpt-5.4-mini"), true);
    assert.equal(isChatGptSubscriptionModelId("openai:gpt-5.4-mini"), false);
    assert.equal(stripChatGptSubscriptionModelPrefix("chatgpt_subscription:gpt-5.4"), "gpt-5.4");
    assert.equal(resolveChatGptSubscriptionDefaultModel("gpt-5.5"), "chatgpt_subscription:gpt-5.5");
    assert.equal(resolveChatGptSubscriptionDefaultModel("missing-model"), "chatgpt_subscription:gpt-5.4-mini");
});

test("buildCodexCliCommand uses locked-down noninteractive Codex execution", () => {
    const originalCliPath = process.env.CODEX_CLI_PATH;
    const originalCwd = process.env.CHATGPT_SUBSCRIPTION_CODEX_CWD;
    process.env.CODEX_CLI_PATH = "/usr/local/bin/codex-test";
    process.env.CHATGPT_SUBSCRIPTION_CODEX_CWD = "/private/tmp";

    try {
        const command = buildCodexCliCommand({
            model: `${CHATGPT_SUBSCRIPTION_MODEL_VALUE_PREFIX}gpt-5.4-mini`,
            prompt: "Generate a short reply",
            outputFile: "/tmp/out.txt",
            accessToken: "codex-token",
        });

        assert.equal(command.command, "/usr/local/bin/codex-test");
        assert.equal(command.env.CODEX_ACCESS_TOKEN, "codex-token");
        assert.equal(command.authMode, "access_token");
        assert.deepEqual(command.args.slice(0, 8), [
            "--ask-for-approval",
            "never",
            "exec",
            "--ephemeral",
            "--ignore-rules",
            "--skip-git-repo-check",
            "--sandbox",
            "read-only",
        ]);
        assert.equal(command.args.includes("gpt-5.4-mini"), true);
        assert.equal(command.args.includes("/tmp/out.txt"), true);
    } finally {
        if (originalCliPath === undefined) delete process.env.CODEX_CLI_PATH;
        else process.env.CODEX_CLI_PATH = originalCliPath;
        if (originalCwd === undefined) delete process.env.CHATGPT_SUBSCRIPTION_CODEX_CWD;
        else process.env.CHATGPT_SUBSCRIPTION_CODEX_CWD = originalCwd;
    }
});

test("buildCodexCliCommand can rely on Codex login cache without access token", () => {
    const originalToken = process.env.CODEX_ACCESS_TOKEN;
    process.env.CODEX_ACCESS_TOKEN = "ambient-token";

    try {
        const command = buildCodexCliCommand({
            model: `${CHATGPT_SUBSCRIPTION_MODEL_VALUE_PREFIX}gpt-5.4-mini`,
            prompt: "Generate a short reply",
            outputFile: "/tmp/out.txt",
        });

        assert.equal(command.authMode, "codex_login_cache");
        assert.equal(command.env.CODEX_ACCESS_TOKEN, undefined);
        assert.equal(command.args.includes("--output-last-message"), true);
    } finally {
        if (originalToken === undefined) delete process.env.CODEX_ACCESS_TOKEN;
        else process.env.CODEX_ACCESS_TOKEN = originalToken;
    }
});

test("buildCodexCliCommand passes a strict output schema to Codex", () => {
    const command = buildCodexCliCommand({
        model: `${CHATGPT_SUBSCRIPTION_MODEL_VALUE_PREFIX}gpt-5.4-mini`,
        prompt: "Return JSON",
        outputFile: "/tmp/out.txt",
        outputSchemaFile: "/tmp/schema.json",
    });

    const schemaIndex = command.args.indexOf("--output-schema");
    assert.notEqual(schemaIndex, -1);
    assert.equal(command.args[schemaIndex + 1], "/tmp/schema.json");
});

test("buildCodexTextPrompt forbids filesystem/tool behavior", () => {
    const prompt = buildCodexTextPrompt("Be concise.", "Write a reply.");
    assert.match(prompt, /Do not inspect files, run commands, edit code/);
    assert.match(prompt, /System instructions:\nBe concise\./);
    assert.match(prompt, /User input:\nWrite a reply\./);
});

test("getChatGptSubscriptionSetupGuide reports Codex auth commands and transport flag", () => {
    const originalTransport = process.env.CHATGPT_SUBSCRIPTION_TRANSPORT;
    const originalCliPath = process.env.CODEX_CLI_PATH;
    process.env.CHATGPT_SUBSCRIPTION_TRANSPORT = "codex_cli";
    process.env.CODEX_CLI_PATH = "/opt/codex";

    try {
        const guide = getChatGptSubscriptionSetupGuide();
        assert.equal(guide.transportEnabled, true);
        assert.equal(guide.transportEnvVar, "CHATGPT_SUBSCRIPTION_TRANSPORT");
        assert.equal(guide.requiredTransportValue, "codex_cli");
        assert.equal(guide.deviceAuthCommand, "/opt/codex login --device-auth");
        assert.equal(guide.statusCommand, "/opt/codex login status");
        assert.match(guide.accessTokenCommand, /login --with-access-token/);
    } finally {
        if (originalTransport === undefined) delete process.env.CHATGPT_SUBSCRIPTION_TRANSPORT;
        else process.env.CHATGPT_SUBSCRIPTION_TRANSPORT = originalTransport;
        if (originalCliPath === undefined) delete process.env.CODEX_CLI_PATH;
        else process.env.CODEX_CLI_PATH = originalCliPath;
    }
});

test("hasChatGptSubscriptionAuth requires enabled server transport", async () => {
    const originalTransport = process.env.CHATGPT_SUBSCRIPTION_TRANSPORT;

    try {
        delete process.env.CHATGPT_SUBSCRIPTION_TRANSPORT;
        assert.equal(await hasChatGptSubscriptionAuth(), false);

        process.env.CHATGPT_SUBSCRIPTION_TRANSPORT = "codex_cli";
        assert.equal(await hasChatGptSubscriptionAuth(), true);
    } finally {
        if (originalTransport === undefined) delete process.env.CHATGPT_SUBSCRIPTION_TRANSPORT;
        else process.env.CHATGPT_SUBSCRIPTION_TRANSPORT = originalTransport;
    }
});

test("callChatGptSubscriptionWithMetadata requires explicit transport opt-in", async () => {
    const originalTransport = process.env.CHATGPT_SUBSCRIPTION_TRANSPORT;
    delete process.env.CHATGPT_SUBSCRIPTION_TRANSPORT;

    try {
        await assert.rejects(
            () => callChatGptSubscriptionWithMetadata("chatgpt_subscription:gpt-5.4-mini", "System", "Input", {
                accessToken: "token",
            }),
            /ChatGPT subscription transport is disabled/
        );
    } finally {
        if (originalTransport === undefined) delete process.env.CHATGPT_SUBSCRIPTION_TRANSPORT;
        else process.env.CHATGPT_SUBSCRIPTION_TRANSPORT = originalTransport;
    }
});

test("callChatGptSubscriptionWithMetadata runs Codex CLI through injectable runner", async () => {
    const originalTransport = process.env.CHATGPT_SUBSCRIPTION_TRANSPORT;
    process.env.CHATGPT_SUBSCRIPTION_TRANSPORT = "codex_cli";

    try {
        const calls: Array<{ command: string; args: string[]; env?: NodeJS.ProcessEnv }> = [];
        const result = await callChatGptSubscriptionWithMetadata(
            "chatgpt_subscription:gpt-5.4-mini",
            "System",
            "Input",
            {
                accessToken: "token",
                runner: async (command: string, args: string[], options: any) => {
                    calls.push({ command, args, env: options?.env });
                    const outputIndex = args.indexOf("--output-last-message") + 1;
                    await writeFile(args[outputIndex], "subscription answer", "utf8");
                    return { stdout: "", stderr: "" } as any;
                },
            }
        );

        assert.equal(calls.length, 1);
        assert.equal(calls[0].args.includes("--ephemeral"), true);
        assert.equal(calls[0].env?.CODEX_ACCESS_TOKEN, "token");
        assert.equal(result.text, "subscription answer");
        assert.equal(result.model, "gpt-5.4-mini");
        assert.equal(result.usage.totalTokens > 0, true);
    } finally {
        if (originalTransport === undefined) delete process.env.CHATGPT_SUBSCRIPTION_TRANSPORT;
        else process.env.CHATGPT_SUBSCRIPTION_TRANSPORT = originalTransport;
    }
});

test("callChatGptSubscriptionWithMetadata writes and uses the supplied JSON schema", async () => {
    const originalTransport = process.env.CHATGPT_SUBSCRIPTION_TRANSPORT;
    process.env.CHATGPT_SUBSCRIPTION_TRANSPORT = "codex_cli";

    try {
        let schema: any = null;
        await callChatGptSubscriptionWithMetadata(
            "chatgpt_subscription:gpt-5.4-mini",
            "System",
            "Input",
            {
                accessToken: "token",
                jsonSchema: {
                    type: "object",
                    properties: { ok: { type: "boolean" } },
                    required: ["ok"],
                },
                runner: async (_command: string, args: string[]) => {
                    const schemaIndex = args.indexOf("--output-schema");
                    schema = JSON.parse(await readFile(args[schemaIndex + 1], "utf8"));
                    const outputIndex = args.indexOf("--output-last-message") + 1;
                    await writeFile(args[outputIndex], "{\"ok\":true}", "utf8");
                    return { stdout: "", stderr: "" } as any;
                },
            },
        );
        assert.deepEqual(schema.required, ["ok"]);
    } finally {
        if (originalTransport === undefined) delete process.env.CHATGPT_SUBSCRIPTION_TRANSPORT;
        else process.env.CHATGPT_SUBSCRIPTION_TRANSPORT = originalTransport;
    }
});

test("callChatGptSubscriptionWithMetadata supports device-auth Codex login cache", async () => {
    const originalTransport = process.env.CHATGPT_SUBSCRIPTION_TRANSPORT;
    process.env.CHATGPT_SUBSCRIPTION_TRANSPORT = "codex_cli";

    try {
        const calls: Array<{ env?: NodeJS.ProcessEnv }> = [];
        const result = await callChatGptSubscriptionWithMetadata(
            "chatgpt_subscription:gpt-5.4-mini",
            "System",
            "Input",
            {
                runner: async (_command: string, args: string[], options: any) => {
                    calls.push({ env: options?.env });
                    const outputIndex = args.indexOf("--output-last-message") + 1;
                    await writeFile(args[outputIndex], "cache auth answer", "utf8");
                    return { stdout: "", stderr: "" } as any;
                },
            }
        );

        assert.equal(calls.length, 1);
        assert.equal(calls[0].env?.CODEX_ACCESS_TOKEN, undefined);
        assert.equal(result.text, "cache auth answer");
    } finally {
        if (originalTransport === undefined) delete process.env.CHATGPT_SUBSCRIPTION_TRANSPORT;
        else process.env.CHATGPT_SUBSCRIPTION_TRANSPORT = originalTransport;
    }
});

test("validateChatGptSubscriptionConnection reports success through the same transport", async () => {
    const originalTransport = process.env.CHATGPT_SUBSCRIPTION_TRANSPORT;
    process.env.CHATGPT_SUBSCRIPTION_TRANSPORT = "codex_cli";

    try {
        const status = await validateChatGptSubscriptionConnection({
            modelId: "chatgpt_subscription:gpt-5.4-mini",
            accessToken: "token",
            runner: async (_command: string, args: string[]) => {
                const outputIndex = args.indexOf("--output-last-message") + 1;
                await writeFile(args[outputIndex], "Estio ChatGPT subscription connection ok", "utf8");
                return { stdout: "", stderr: "" } as any;
            },
        });

        assert.equal(status.ok, true);
        assert.equal(status.provider, "chatgpt_subscription");
        assert.equal(status.transport, "codex_cli");
        assert.equal(status.model, "gpt-5.4-mini");
        assert.equal(status.details?.usage?.totalTokens! > 0, true);
    } finally {
        if (originalTransport === undefined) delete process.env.CHATGPT_SUBSCRIPTION_TRANSPORT;
        else process.env.CHATGPT_SUBSCRIPTION_TRANSPORT = originalTransport;
    }
});

test("validateChatGptSubscriptionConnection reports disabled transport clearly", async () => {
    const originalTransport = process.env.CHATGPT_SUBSCRIPTION_TRANSPORT;
    delete process.env.CHATGPT_SUBSCRIPTION_TRANSPORT;

    try {
        const status = await validateChatGptSubscriptionConnection({
            accessToken: "token",
        });

        assert.equal(status.ok, false);
        assert.match(status.message, /transport is disabled/);
    } finally {
        if (originalTransport === undefined) delete process.env.CHATGPT_SUBSCRIPTION_TRANSPORT;
        else process.env.CHATGPT_SUBSCRIPTION_TRANSPORT = originalTransport;
    }
});
