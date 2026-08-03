import db from "@/lib/db";
import {
    provisionLocationChatGptAccessToken,
    type WorkspaceAccountType,
} from "@/lib/ai/location-chatgpt-provisioning";

const args = process.argv.slice(2);

function getArg(flag: string): string {
    const match = args.find((arg) => arg.startsWith(`${flag}=`));
    return match ? match.slice(flag.length + 1).trim() : "";
}

async function readSecretFromStdin(maxBytes = 8192): Promise<string> {
    if (process.stdin.isTTY) {
        throw new Error("The Codex access token must be provided through stdin.");
    }
    process.stdin.setEncoding("utf8");
    let value = "";
    for await (const chunk of process.stdin) {
        value += String(chunk);
        if (Buffer.byteLength(value, "utf8") > maxBytes) {
            throw new Error("The Codex access token input is too large.");
        }
    }
    return value.trim();
}

async function main() {
    if (args.some((arg) => arg === "--token" || arg.startsWith("--token="))) {
        throw new Error("Do not pass the Codex access token as a command-line argument; provide it through stdin.");
    }
    const accountType = getArg("--account-type") as WorkspaceAccountType;
    const accessToken = await readSecretFromStdin();
    const result = await provisionLocationChatGptAccessToken({
        locationId: getArg("--location-id"),
        actorUserId: getArg("--actor-user-id"),
        accountType,
        workspaceLabel: getArg("--workspace-label"),
        accessToken,
        dryRun: args.includes("--dry-run"),
    });
    console.log(JSON.stringify({
        success: true,
        ...result,
        message: result.stored
            ? "The location ChatGPT workspace connection was validated and encrypted."
            : "Dry run passed; no credential was stored.",
    }, null, 2));
}

main()
    .catch((error) => {
        console.error("[settings/provision-location-chatgpt] Failed:", error instanceof Error ? error.message : "Unknown error");
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.$disconnect();
    });
