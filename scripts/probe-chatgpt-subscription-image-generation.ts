import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Diagnostic only. This does not import Estio runtime code or alter model routing.
//
// Recommended:
//   node --import tsx scripts/probe-chatgpt-subscription-image-generation.ts
//
// Focused probes:
//   node --import tsx scripts/probe-chatgpt-subscription-image-generation.ts --mode=legacy-exec
//   node --import tsx scripts/probe-chatgpt-subscription-image-generation.ts --mode=default-exec
//   node --import tsx scripts/probe-chatgpt-subscription-image-generation.ts --mode=app-server
//
// Useful env:
//   CODEX_CLI_PATH=/usr/bin/codex
//   CHATGPT_SUBSCRIPTION_IMAGE_PROBE_MODEL=gpt-image-2
//   CHATGPT_SUBSCRIPTION_IMAGE_PROBE_TIMEOUT_MS=180000

type ProbeStatus = "passed" | "failed" | "skipped";

type ProbeResult = {
    name: string;
    status: ProbeStatus;
    elapsedMs: number;
    outputPath?: string;
    lastMessagePath?: string;
    details: string[];
};

const CODEX_COMMAND = String(process.env.CODEX_CLI_PATH || "codex").trim() || "codex";
const LEGACY_IMAGE_MODEL = String(process.env.CHATGPT_SUBSCRIPTION_IMAGE_PROBE_MODEL || "gpt-image-2").trim() || "gpt-image-2";
const TIMEOUT_MS = Number(process.env.CHATGPT_SUBSCRIPTION_IMAGE_PROBE_TIMEOUT_MS || 180000);

function hasArg(name: string): boolean {
    return process.argv.includes(name);
}

function selectedModes(): Set<string> {
    const explicit = process.argv
        .filter((arg) => arg.startsWith("--mode="))
        .flatMap((arg) => arg.slice("--mode=".length).split(","))
        .map((arg) => arg.trim())
        .filter(Boolean);
    if (hasArg("--legacy-exec")) explicit.push("legacy-exec");
    if (hasArg("--default-exec")) explicit.push("default-exec");
    if (hasArg("--app-server")) explicit.push("app-server");
    return new Set(explicit.length ? explicit : ["legacy-exec", "default-exec", "app-server"]);
}

function redact(value: string): string {
    return value.replace(/CODEX_ACCESS_TOKEN=([^\s]+)/g, "CODEX_ACCESS_TOKEN=[redacted]");
}

async function createProbeSourceImage(filePath: string): Promise<void> {
    try {
        const sharp = (await import("sharp")).default;
        const svg = Buffer.from(`
            <svg width="420" height="280" viewBox="0 0 420 280" xmlns="http://www.w3.org/2000/svg">
                <rect width="420" height="280" fill="#f7f3ed"/>
                <rect x="35" y="45" width="350" height="175" fill="#ffffff" stroke="#d7d0c8" stroke-width="4"/>
                <rect x="60" y="80" width="120" height="75" fill="#dbeafe"/>
                <rect x="235" y="82" width="95" height="64" rx="2" fill="#111827"/>
                <rect x="90" y="174" width="180" height="24" rx="12" fill="#d8c7ae"/>
                <rect x="185" y="158" width="55" height="38" rx="4" fill="#a78b65"/>
                <line x1="35" y1="220" x2="385" y2="220" stroke="#c7b9a5" stroke-width="4"/>
            </svg>
        `);
        await sharp({
            create: {
                width: 420,
                height: 280,
                channels: 3,
                background: "#f7f3ed",
            },
        })
            .composite([{ input: svg }])
            .png()
            .toFile(filePath);
    } catch {
        const onePixelPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8DwHwAFgwJ/l7nnWQAAAABJRU5ErkJggg==";
        await writeFile(filePath, Buffer.from(onePixelPng, "base64"));
    }
}

function runCommand(command: string, args: string[], cwd: string, timeoutMs: number): Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
}> {
    return new Promise((resolve) => {
        const child = spawn(command, args, {
            cwd,
            env: { ...process.env },
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
            child.kill("SIGTERM");
        }, timeoutMs);
        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.on("close", (code, signal) => {
            clearTimeout(timer);
            resolve({ code, signal, stdout, stderr });
        });
    });
}

async function maybeImageDetails(filePath: string): Promise<string[]> {
    if (!existsSync(filePath)) return [`No image artifact found at ${filePath}`];
    const size = (await stat(filePath)).size;
    const header = (await readFile(filePath)).subarray(0, 8);
    const isPng = header.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    return [`Image artifact exists: ${filePath}`, `Image bytes: ${size}`, `PNG header: ${isPng ? "yes" : "no"}`];
}

async function runCodexExecProbe(args: {
    name: string;
    cwd: string;
    sourceImage: string;
    model?: string;
    prompt: string;
}): Promise<ProbeResult> {
    const started = Date.now();
    const outputPath = path.join(args.cwd, `${args.name}.png`);
    const lastMessagePath = path.join(args.cwd, `${args.name}-last-message.txt`);
    const codexArgs = [
        "--ask-for-approval",
        "never",
        "exec",
        "--ephemeral",
        "--ignore-rules",
        "--skip-git-repo-check",
        "--sandbox",
        "workspace-write",
        "-C",
        args.cwd,
    ];
    if (args.model) codexArgs.push("-m", args.model);
    codexArgs.push("-i", args.sourceImage, "--output-last-message", lastMessagePath, args.prompt.replaceAll("{{OUTPUT_PATH}}", outputPath));

    const result = await runCommand(CODEX_COMMAND, codexArgs, args.cwd, TIMEOUT_MS);
    const imageDetails = await maybeImageDetails(outputPath);
    const lastMessage = existsSync(lastMessagePath) ? (await readFile(lastMessagePath, "utf8")).trim() : "";
    const details = [
        `Command: ${redact([CODEX_COMMAND, ...codexArgs].join(" "))}`,
        `Exit code: ${result.code ?? "null"}`,
        result.signal ? `Signal: ${result.signal}` : "",
        result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : "",
        result.stdout.trim() ? `stdout:\n${result.stdout.trim()}` : "",
        lastMessage ? `last message:\n${lastMessage}` : "No last-message text produced.",
        ...imageDetails,
    ].filter(Boolean);
    return {
        name: args.name,
        status: existsSync(outputPath) ? "passed" : "failed",
        elapsedMs: Date.now() - started,
        outputPath,
        lastMessagePath,
        details,
    };
}

function sendJson(child: ReturnType<typeof spawn>, id: number, method: string, params: unknown): void {
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
}

async function runAppServerProbe(rootDir: string): Promise<ProbeResult> {
    const started = Date.now();
    const outputPath = path.join(rootDir, "app-server-native-image.png");
    const details: string[] = [
        "Starts a temporary Codex app-server over stdio, creates a thread, then asks $imagegen to save a PNG.",
        "This checks the native app-server/imageGeneration path suggested by market repos, not the legacy -m gpt-image-2 path.",
    ];

    const child = spawn(CODEX_COMMAND, ["app-server", "--stdio"], {
        cwd: rootDir,
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const responses = new Map<number, any>();
    child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
        for (const line of stdout.split("\n").slice(0, -1)) {
            try {
                const parsed = JSON.parse(line);
                if (typeof parsed?.id === "number") responses.set(parsed.id, parsed);
                if (parsed?.method === "item/completed" || parsed?.method === "rawResponseItem/completed") {
                    details.push(`notification: ${JSON.stringify(parsed).slice(0, 1200)}`);
                }
            } catch {
                details.push(`non-json stdout: ${line.slice(0, 1200)}`);
            }
        }
        stdout = stdout.includes("\n") ? stdout.slice(stdout.lastIndexOf("\n") + 1) : stdout;
    });
    child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
    });

    const waitForResponse = async (id: number, timeoutMs: number): Promise<any> => {
        const until = Date.now() + timeoutMs;
        while (Date.now() < until) {
            if (responses.has(id)) return responses.get(id);
            if (child.exitCode !== null) break;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return null;
    };

    try {
        sendJson(child, 1, "initialize", {
            clientInfo: { name: "estio-chatgpt-subscription-image-probe", title: "Estio image probe", version: "0.1.0" },
            capabilities: null,
        });
        const init = await waitForResponse(1, 10000);
        details.push(init ? `initialize response: ${JSON.stringify(init).slice(0, 1200)}` : "initialize response: timed out or unavailable");
        if (!init || init.error) {
            return {
                name: "app-server-native-image",
                status: "failed",
                elapsedMs: Date.now() - started,
                outputPath,
                details: [
                    ...details,
                    stderr.trim() ? `stderr:\n${stderr.trim()}` : "No stderr.",
                ],
            };
        }

        sendJson(child, 2, "thread/start", {
            cwd: rootDir,
            runtimeWorkspaceRoots: [rootDir],
            approvalPolicy: "never",
            sandbox: "workspace-write",
            ephemeral: true,
            historyMode: "paginated",
        });
        const threadStart = await waitForResponse(2, 20000);
        details.push(threadStart ? `thread/start response: ${JSON.stringify(threadStart).slice(0, 1200)}` : "thread/start response: timed out");
        const threadId = threadStart?.result?.thread?.id || threadStart?.thread?.id;
        if (!threadId) {
            return {
                name: "app-server-native-image",
                status: "failed",
                elapsedMs: Date.now() - started,
                outputPath,
                details: [
                    ...details,
                    "Could not determine thread id from app-server response.",
                    stderr.trim() ? `stderr:\n${stderr.trim()}` : "No stderr.",
                ],
            };
        }

        const promptText = [
            "$imagegen",
            "Generate a simple photorealistic test image of a bright empty room.",
            `Save the generated PNG exactly at: ${outputPath}`,
            "Do not edit repository files. Return a short action log.",
        ].join("\n");
        sendJson(child, 3, "turn/start", {
            threadId,
            input: [{
                type: "text",
                text: promptText,
                text_elements: [],
            }],
            cwd: rootDir,
            runtimeWorkspaceRoots: [rootDir],
            approvalPolicy: "never",
        });
        const turnStart = await waitForResponse(3, 20000);
        details.push(turnStart ? `turn/start response: ${JSON.stringify(turnStart).slice(0, 1200)}` : "turn/start response: timed out");

        const until = Date.now() + TIMEOUT_MS;
        while (Date.now() < until && !existsSync(outputPath) && child.exitCode === null) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        const imageDetails = await maybeImageDetails(outputPath);
        return {
            name: "app-server-native-image",
            status: existsSync(outputPath) ? "passed" : "failed",
            elapsedMs: Date.now() - started,
            outputPath,
            details: [
                ...details,
                stderr.trim() ? `stderr:\n${stderr.trim()}` : "No stderr.",
                ...imageDetails,
            ],
        };
    } finally {
        child.kill("SIGTERM");
    }
}

async function main(): Promise<void> {
    const modes = selectedModes();
    const rootDir = await mkdtemp(path.join(tmpdir(), "estio-chatgpt-subscription-image-probe-"));
    await mkdir(rootDir, { recursive: true });
    const sourceImage = path.join(rootDir, "source-room.png");
    await createProbeSourceImage(sourceImage);

    const results: ProbeResult[] = [];
    if (modes.has("legacy-exec")) {
        results.push(await runCodexExecProbe({
            name: "legacy-gpt-image-model",
            cwd: rootDir,
            sourceImage,
            model: LEGACY_IMAGE_MODEL,
            prompt: [
                "$imagegen",
                "Edit the attached simple room image into a brighter, cleaner property listing image.",
                "Preserve the room layout and do not add text.",
                "Save the final generated image as a PNG at this exact path: {{OUTPUT_PATH}}",
                "Return a short action log.",
            ].join("\n"),
        }));
    }

    if (modes.has("default-exec")) {
        results.push(await runCodexExecProbe({
            name: "default-model-imagegen-skill",
            cwd: rootDir,
            sourceImage,
            prompt: [
                "$imagegen",
                "Generate a simple photorealistic image of a bright empty modern living room.",
                "Save the final generated image as a PNG at this exact path: {{OUTPUT_PATH}}",
                "Return a short action log.",
            ].join("\n"),
        }));
    }

    if (modes.has("app-server")) {
        results.push(await runAppServerProbe(rootDir));
    }

    const reportPath = path.join(rootDir, "report.json");
    await writeFile(reportPath, JSON.stringify({
        generatedAt: new Date().toISOString(),
        codexCommand: CODEX_COMMAND,
        legacyImageModel: LEGACY_IMAGE_MODEL,
        timeoutMs: TIMEOUT_MS,
        rootDir,
        sourceImage,
        results,
    }, null, 2));

    console.log(`Probe root: ${rootDir}`);
    console.log(`Report: ${reportPath}`);
    for (const result of results) {
        console.log(`\n[${result.status.toUpperCase()}] ${result.name} (${result.elapsedMs}ms)`);
        console.log(`Output: ${result.outputPath || "n/a"}`);
        for (const detail of result.details) {
            console.log(`- ${detail.split("\n").join("\n  ")}`);
        }
    }

    const passed = results.some((result) => result.status === "passed");
    process.exitCode = results.length === 0 || passed ? 0 : 1;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
