import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.env.WHATSAPP_BROWSER_CALL_BRIDGE_PORT || process.env.WHATSAPP_CALL_BRIDGE_PORT || 3038);
const SECRET = String(process.env.WHATSAPP_CALL_BRIDGE_SECRET || "").trim();
const PROFILE_DIR = String(process.env.WHATSAPP_BROWSER_CALL_PROFILE_DIR || "/home/martin/whatsapp-call-browser-profile").trim();
const RECORDING_DIR = String(process.env.WHATSAPP_BROWSER_CALL_RECORDING_DIR || "/home/martin/whatsapp-call-recordings").trim();
const WEBHOOK_URL = String(process.env.WHATSAPP_BROWSER_CALL_BRIDGE_APP_WEBHOOK_URL || process.env.WHATSAPP_CALL_BRIDGE_APP_WEBHOOK_URL || "").trim();
const AUDIO_SINK = String(process.env.WHATSAPP_BROWSER_CALL_AUDIO_SINK || "wa_call_sink").trim();
const SIMULATE = process.env.WHATSAPP_BROWSER_CALL_BRIDGE_SIMULATE === "1";
const XVFB_DISPLAY = String(process.env.WHATSAPP_BROWSER_CALL_XVFB_DISPLAY || ":99").trim();
const START_XVFB = process.env.WHATSAPP_BROWSER_CALL_START_XVFB !== "0";
const START_PULSEAUDIO = process.env.WHATSAPP_BROWSER_CALL_START_PULSEAUDIO !== "0";
const USE_FAKE_MIC = process.env.WHATSAPP_BROWSER_CALL_USE_FAKE_MIC !== "0";

type CallState = "started" | "ringing" | "recording" | "ended" | "failed";

type ActiveCall = {
    id: string;
    locationId: string;
    conversationId?: string | null;
    contactId?: string | null;
    attemptId?: string | null;
    to: string;
    targetJid?: string | null;
    state: CallState;
    startedAt: string;
    updatedAt: string;
    recordingPath?: string | null;
    recordingStartedAt?: number | null;
    recordingDurationSeconds?: number | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    ffmpeg?: ChildProcessWithoutNullStreams | null;
    ffmpegExitCode?: number | null;
    ffmpegError?: string | null;
    uiState?: Record<string, any> | null;
};

let browserPromise: Promise<any> | null = null;
let pagePromise: Promise<any> | null = null;
let xvfbProcess: ChildProcessWithoutNullStreams | null = null;
const calls = new Map<string, ActiveCall>();

function json(res: ServerResponse, status: number, body: any) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
}

function isAuthorized(req: IncomingMessage) {
    if (!SECRET) return SIMULATE || process.env.NODE_ENV !== "production";
    return req.headers["x-whatsapp-call-bridge-secret"] === SECRET;
}

async function readBody(req: IncomingMessage) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (!chunks.length) return {};
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function commandExists(command: string) {
    return new Promise<boolean>((resolve) => {
        const child = spawn("bash", ["-lc", `command -v ${command}`]);
        child.on("exit", (code) => resolve(code === 0));
        child.on("error", () => resolve(false));
    });
}

function shellOk(command: string) {
    return new Promise<boolean>((resolve) => {
        const child = spawn("bash", ["-lc", command]);
        child.on("exit", (code) => resolve(code === 0));
        child.on("error", () => resolve(false));
    });
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureXvfb() {
    if (SIMULATE) return true;
    if (process.env.DISPLAY) return true;
    if (!START_XVFB) return false;
    if (!await commandExists("Xvfb")) return false;
    if (!xvfbProcess) {
        xvfbProcess = spawn("Xvfb", [XVFB_DISPLAY, "-screen", "0", "1280x900x24", "-nolisten", "tcp"]);
        xvfbProcess.stderr.on("data", (chunk) => {
            const text = String(chunk || "").trim();
            if (text && !/Server is already active/i.test(text)) {
                console.error("[WhatsApp Browser Call Bridge] Xvfb:", text);
            }
        });
        xvfbProcess.on("exit", () => {
            xvfbProcess = null;
            if (process.env.DISPLAY === XVFB_DISPLAY) delete process.env.DISPLAY;
        });
    }
    process.env.DISPLAY = XVFB_DISPLAY;
    await sleep(750);
    return true;
}

async function ensurePulseAudio() {
    if (SIMULATE) return true;
    if (!START_PULSEAUDIO) return shellOk("pactl info >/dev/null 2>&1");
    if (await shellOk("pactl info >/dev/null 2>&1")) return true;
    if (await commandExists("pulseaudio")) {
        await shellOk("pulseaudio --start --exit-idle-time=-1 >/dev/null 2>&1");
        await sleep(500);
    }
    return shellOk("pactl info >/dev/null 2>&1");
}

async function ensureAudioSink() {
    if (SIMULATE) return true;
    const pactl = await commandExists("pactl");
    if (!pactl) return false;
    if (!await ensurePulseAudio()) return false;
    const exists = await shellOk(`pactl list short sinks | grep -q '${AUDIO_SINK}'`);
    if (!exists) {
        const loaded = await shellOk(`pactl load-module module-null-sink sink_name=${AUDIO_SINK} sink_properties=device.description=${AUDIO_SINK}`);
        if (!loaded) return false;
    }
    await shellOk(`pactl set-default-sink ${AUDIO_SINK}`);
    process.env.PULSE_SINK = AUDIO_SINK;
    return true;
}

async function ensureBrowser() {
    if (SIMULATE) return null;
    if (!browserPromise) {
        browserPromise = (async () => {
            mkdirSync(PROFILE_DIR, { recursive: true });
            const xvfbReady = await ensureXvfb();
            const audioReady = await ensureAudioSink();
            if (!xvfbReady) throw new Error("Xvfb is not available and DISPLAY is not set.");
            if (!audioReady) throw new Error("PulseAudio sink is not ready.");
            const puppeteer = await import("puppeteer");
            const chromeArgs = [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--autoplay-policy=no-user-gesture-required",
                "--use-fake-ui-for-media-stream",
                ...(USE_FAKE_MIC ? ["--use-fake-device-for-media-stream"] : []),
            ];
            return puppeteer.launch({
                headless: false,
                userDataDir: PROFILE_DIR,
                env: {
                    ...process.env,
                    DISPLAY: process.env.DISPLAY || XVFB_DISPLAY,
                    PULSE_SINK: AUDIO_SINK,
                },
                args: chromeArgs,
            });
        })();
    }
    return browserPromise;
}

async function getPage() {
    if (SIMULATE) return null;
    if (!pagePromise) {
        pagePromise = (async () => {
            const browser = await ensureBrowser();
            const pages = await browser.pages();
            const page = pages[0] || await browser.newPage();
            await browser.defaultBrowserContext().overridePermissions("https://web.whatsapp.com", ["microphone", "camera", "notifications"]).catch(() => undefined);
            await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 }).catch(() => undefined);
            await page.goto("https://web.whatsapp.com/", { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => undefined);
            return page;
        })();
    }
    return pagePromise;
}

async function inspectWhatsAppWeb() {
    if (SIMULATE) {
        return { chromeReady: true, whatsappWebPaired: true, callButtonAvailable: true };
    }
    try {
        const page = await getPage();
        const text = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
        const paired = !/Use WhatsApp on your computer|Link a device|Scan this QR/i.test(text);
        const callButton = await page.$('[aria-label*="Voice call"], [title*="Voice call"], [data-icon="audio-call"]').catch(() => null);
        return { chromeReady: true, whatsappWebPaired: paired, callButtonAvailable: Boolean(callButton) };
    } catch {
        return { chromeReady: false, whatsappWebPaired: false, callButtonAvailable: false };
    }
}

async function buildHealth() {
    const [xvfbReady, ffmpegReady, audioSinkReady, browserState] = await Promise.all([
        ensureXvfb(),
        commandExists("ffmpeg"),
        ensureAudioSink(),
        inspectWhatsAppWeb(),
    ]);
    const ready = browserState.chromeReady && browserState.whatsappWebPaired && audioSinkReady && ffmpegReady;
    return {
        success: true,
        ok: ready,
        status: ready ? "ready" : browserState.whatsappWebPaired ? "unhealthy" : "unpaired",
        chromeReady: browserState.chromeReady,
        xvfbReady,
        display: process.env.DISPLAY || null,
        whatsappWebPaired: browserState.whatsappWebPaired,
        callButtonAvailable: browserState.callButtonAvailable,
        audioSinkReady,
        ffmpegReady,
        fakeMicEnabled: USE_FAKE_MIC,
        audioSink: AUDIO_SINK,
        profileDir: PROFILE_DIR,
        recordingDir: RECORDING_DIR,
        activeCall: Array.from(calls.values()).find((call) => !["ended", "failed"].includes(call.state)) || null,
        calls: Array.from(calls.values()).map(serializeCall),
        lastHeartbeatAt: new Date().toISOString(),
        simulated: SIMULATE,
    };
}

function serializeCall(call: ActiveCall) {
    return {
        success: call.state !== "failed",
        callId: call.id,
        bridgeCallId: call.id,
        state: call.state,
        status: call.state,
        locationId: call.locationId,
        conversationId: call.conversationId || null,
        contactId: call.contactId || null,
        attemptId: call.attemptId || null,
        recordingPath: call.recordingPath || null,
        recordingDurationSeconds: call.recordingDurationSeconds || null,
        errorCode: call.errorCode || null,
        errorMessage: call.errorMessage || null,
        ffmpegExitCode: call.ffmpegExitCode ?? null,
        ffmpegError: call.ffmpegError || null,
        uiState: call.uiState || null,
        updatedAt: call.updatedAt,
    };
}

async function postWebhook(call: ActiveCall) {
    if (!WEBHOOK_URL || !call.locationId) return;
    await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(SECRET ? { "x-whatsapp-call-bridge-secret": SECRET } : {}),
        },
        body: JSON.stringify(serializeCall(call)),
    }).catch((error) => {
        console.error("[WhatsApp Browser Call Bridge] webhook failed:", error?.message || error);
    });
}

function startRecording(call: ActiveCall) {
    mkdirSync(RECORDING_DIR, { recursive: true });
    const path = join(RECORDING_DIR, `${call.id}.wav`);
    call.recordingPath = path;
    call.recordingStartedAt = Date.now();
    if (SIMULATE) return;
    call.ffmpeg = spawn("ffmpeg", [
        "-y",
        "-f",
        "pulse",
        "-i",
        `${AUDIO_SINK}.monitor`,
        "-ac",
        "1",
        "-ar",
        "16000",
        path,
    ]);
    let stderr = "";
    call.ffmpeg.stderr.on("data", (chunk) => {
        stderr = `${stderr}${String(chunk || "")}`.slice(-4000);
    });
    call.ffmpeg.on("exit", (code) => {
        call.ffmpegExitCode = code;
        call.ffmpegError = stderr.trim() || null;
    });
}

async function stopRecording(call: ActiveCall) {
    if (SIMULATE) {
        call.recordingDurationSeconds = call.recordingStartedAt ? Math.max(0, Math.round((Date.now() - call.recordingStartedAt) / 1000)) : null;
        return { ok: true, size: 1 };
    }
    if (!call.ffmpeg) return { ok: false, size: 0, error: "ffmpeg was not started." };
    if (!call.ffmpeg.killed) call.ffmpeg.kill("SIGINT");
    await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 8000);
        call.ffmpeg?.once("close", () => {
            clearTimeout(timeout);
            resolve();
        });
    });
    call.recordingDurationSeconds = call.recordingStartedAt ? Math.max(0, Math.round((Date.now() - call.recordingStartedAt) / 1000)) : null;
    const size = call.recordingPath && existsSync(call.recordingPath) ? statSync(call.recordingPath).size : 0;
    if (call.ffmpegExitCode != null && call.ffmpegExitCode !== 0 && call.ffmpegExitCode !== 255) {
        return { ok: false, size, error: call.ffmpegError || `ffmpeg exited with ${call.ffmpegExitCode}.` };
    }
    if (size <= 0) return { ok: false, size, error: "Recording file is missing or empty." };
    return { ok: true, size };
}

async function inspectCallUi() {
    if (SIMULATE) return { callWindowVisible: true, hangupVisible: true, text: "simulated call" };
    const page = await getPage();
    const text = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
    const hangup = await page.$('[aria-label*="End call"], [aria-label*="Hang up"], [data-icon="call-end"]').catch(() => null);
    const callWindowVisible = Boolean(hangup) || /ringing|calling|end call|hang up|ongoing call/i.test(text);
    const errorVisible = /couldn.t place call|call unavailable|failed|unable to call|not available/i.test(text);
    return {
        callWindowVisible,
        hangupVisible: Boolean(hangup),
        errorVisible,
        text: text.slice(0, 2000),
    };
}

async function inspectInteractiveElements() {
    if (SIMULATE) return [];
    const page = await getPage();
    return page.evaluate(() => {
        return Array.from(document.querySelectorAll("button,[role='button'],[aria-label],[title]"))
            .slice(0, 200)
            .map((element: any) => ({
                tag: element.tagName,
                role: element.getAttribute("role"),
                ariaLabel: element.getAttribute("aria-label"),
                title: element.getAttribute("title"),
                text: String(element.innerText || element.textContent || "").trim().slice(0, 120),
                dataIcon: element.querySelector?.("[data-icon]")?.getAttribute("data-icon") || element.getAttribute("data-icon"),
                className: String(element.getAttribute?.("class") || "").slice(0, 160),
            }));
    }).catch(() => []);
}

async function inspectMediaEnvironment() {
    if (SIMULATE) return { simulated: true };
    const page = await getPage();
    return page.evaluate(async () => {
        const devices = await navigator.mediaDevices?.enumerateDevices?.().catch(() => []) || [];
        const queryPermission = async (name: PermissionName) => {
            try {
                const status = await navigator.permissions?.query?.({ name });
                return status?.state || "unknown";
            } catch {
                return "unknown";
            }
        };
        return {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            viewport: {
                width: window.innerWidth,
                height: window.innerHeight,
                devicePixelRatio: window.devicePixelRatio,
            },
            microphonePermission: await queryPermission("microphone" as PermissionName),
            cameraPermission: await queryPermission("camera" as PermissionName),
            devices: devices.map((device) => ({
                kind: device.kind,
                hasLabel: Boolean(device.label),
                deviceIdPresent: Boolean(device.deviceId),
                groupIdPresent: Boolean(device.groupId),
            })),
        };
    }).catch((error: any) => ({ error: error?.message || "Unable to inspect media environment." }));
}

async function clickHangupIfVisible() {
    if (SIMULATE) return true;
    const page = await getPage();
    const selectors = [
        '[aria-label*="End call"]',
        '[aria-label*="Hang up"]',
        '[data-icon="call-end"]',
    ];
    for (const selector of selectors) {
        const element = await page.$(selector).catch(() => null);
        if (element) {
            await element.click().catch(() => undefined);
            return true;
        }
    }
    return false;
}

async function clickVoiceCall(to: string) {
    if (SIMULATE) return { callWindowVisible: true, hangupVisible: true, errorVisible: false, text: "simulated call" };
    const page = await getPage();
    const digits = String(to || "").replace(/\D/g, "");
    if (digits) {
        await page.goto(`https://web.whatsapp.com/send?phone=${digits}`, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => undefined);
        await sleep(3500);
    }
    const selectors = [
        '[aria-label*="Voice call"]',
        '[aria-label*="voice call"]',
        '[aria-label*="Call"]',
        '[aria-label*="call"]',
        '[title*="Voice call"]',
        '[title*="voice call"]',
        '[title*="Call"]',
        '[title*="call"]',
        '[data-icon="audio-call"]',
        '[data-icon="video-call"]',
        '[data-icon="video-call-outline"]',
        '[data-icon="call-video"]',
    ];
    for (const selector of selectors) {
        const element = await page.$(selector).catch(() => null);
        if (element) {
            await element.evaluate((node: any) => {
                const target = node.closest?.("button,[role='button']") || node;
                target.click();
            });
            await sleep(1500);
            return await inspectCallUi();
        }
    }
    throw new Error("WhatsApp Web voice call button was not found.");
}

async function startCall(body: any) {
    const activeCall = Array.from(calls.values()).find((existing) => ["started", "ringing", "recording"].includes(existing.state));
    if (activeCall) {
        return {
            success: false,
            callId: activeCall.id,
            bridgeCallId: activeCall.id,
            state: activeCall.state,
            status: activeCall.state,
            errorCode: "active_call_in_progress",
            errorMessage: "Another WhatsApp browser call is already active.",
            activeCall: serializeCall(activeCall),
        };
    }

    const call: ActiveCall = {
        id: `browser_call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        locationId: String(body?.locationId || ""),
        conversationId: body?.conversationId ? String(body.conversationId) : null,
        contactId: body?.contactId ? String(body.contactId) : null,
        attemptId: body?.attemptId ? String(body.attemptId) : null,
        to: String(body?.to || ""),
        targetJid: body?.targetJid ? String(body.targetJid) : null,
        state: "started",
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    calls.set(call.id, call);
    try {
        const uiState = await clickVoiceCall(call.to);
        call.uiState = uiState;
        if (!uiState?.callWindowVisible) {
            throw new Error("WhatsApp call UI did not open after clicking the voice call button.");
        }
        if (uiState?.errorVisible) {
            throw new Error("WhatsApp Web showed a call error after clicking the voice call button.");
        }
        call.state = "ringing";
        call.updatedAt = new Date().toISOString();
        startRecording(call);
        await sleep(750);
        if (!SIMULATE) {
            const recordingSize = call.recordingPath && existsSync(call.recordingPath) ? statSync(call.recordingPath).size : 0;
            if (recordingSize <= 0 && call.ffmpegExitCode != null) {
                throw new Error(call.ffmpegError || "ffmpeg exited before recording audio.");
            }
        }
        call.state = "recording";
        call.updatedAt = new Date().toISOString();
        await postWebhook(call);
    } catch (error: any) {
        call.state = "failed";
        call.errorCode = "browser_call_start_failed";
        call.errorMessage = error?.message || "Failed to start WhatsApp Web call.";
        call.updatedAt = new Date().toISOString();
        await postWebhook(call);
    }
    return serializeCall(call);
}

async function endCall(call: ActiveCall) {
    await clickHangupIfVisible();
    const recording = await stopRecording(call);
    call.state = recording.ok ? "ended" : "failed";
    if (!recording.ok) {
        call.errorCode = "browser_call_recording_failed";
        call.errorMessage = recording.error || "Recording did not finalize.";
    }
    call.updatedAt = new Date().toISOString();
    await postWebhook(call);
    return serializeCall(call);
}

const server = createServer(async (req, res) => {
    if (!isAuthorized(req)) return json(res, 401, { success: false, error: "Unauthorized" });
    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    try {
        if (req.method === "GET" && url.pathname === "/health") return json(res, 200, await buildHealth());
        if (req.method === "GET" && url.pathname === "/debug/dom") {
            const page = await getPage();
            const payload = SIMULATE
                ? { success: true, simulated: true }
                : {
                    success: true,
                    url: page.url(),
                    title: await page.title().catch(() => ""),
                    state: await inspectWhatsAppWeb(),
                    callUi: await inspectCallUi().catch(() => null),
                    text: await page.evaluate(() => document.body?.innerText || "").catch(() => ""),
                };
            return json(res, 200, payload);
        }
        if (req.method === "GET" && url.pathname === "/debug/elements") {
            return json(res, 200, { success: true, elements: await inspectInteractiveElements() });
        }
        if (req.method === "GET" && url.pathname === "/debug/media") {
            return json(res, 200, { success: true, media: await inspectMediaEnvironment() });
        }
        if (req.method === "GET" && url.pathname === "/debug/screenshot") {
            if (SIMULATE) return json(res, 200, { success: true, simulated: true });
            const page = await getPage();
            const image = await page.screenshot({ type: "png", fullPage: false });
            res.writeHead(200, { "Content-Type": "image/png" });
            return res.end(image);
        }
        if (req.method === "POST" && url.pathname === "/session/start") {
            await getPage();
            return json(res, 200, await buildHealth());
        }
        if (req.method === "POST" && url.pathname === "/call/start") return json(res, 200, await startCall(await readBody(req)));
        if (req.method === "POST" && url.pathname === "/call/end") {
            const body = await readBody(req);
            const id = String(body?.callId || body?.bridgeCallId || "");
            const call = calls.get(id);
            if (!call) return json(res, 404, { success: false, error: "Call not found." });
            return json(res, 200, await endCall(call));
        }
        const callMatch = url.pathname.match(/^\/call\/([^/]+)$/);
        if (req.method === "GET" && callMatch) {
            const call = calls.get(decodeURIComponent(callMatch[1]));
            if (!call) return json(res, 404, { success: false, error: "Call not found." });
            return json(res, 200, serializeCall(call));
        }
        return json(res, 404, { success: false, error: "Not found." });
    } catch (error: any) {
        return json(res, 500, { success: false, error: error?.message || "Browser call bridge failed." });
    }
});

server.listen(PORT, () => {
    mkdirSync(PROFILE_DIR, { recursive: true });
    mkdirSync(RECORDING_DIR, { recursive: true });
    console.log(`[WhatsApp Browser Call Bridge] listening on :${PORT}`);
    console.log(`[WhatsApp Browser Call Bridge] profile=${PROFILE_DIR} recordings=${RECORDING_DIR}`);
});
