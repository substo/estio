import { isAllowedTunnelTarget } from "./policy";

/**
 * Studio's read-only YouTube search may borrow a connected device's network, on its own listener. It is isolated from the
 * WhatsApp session listener: separate host allowlist (never WhatsApp hosts), separate stream cap, and its bytes never count
 * toward WhatsApp send-proof snapshots.
 */
export const STUDIO_EGRESS_ALLOWED_SUFFIXES = ["youtube.com", "ytimg.com", "gstatic.com", "google.com", "googleapis.com", "ggpht.com", "googleusercontent.com"];
export const STUDIO_EGRESS_MAX_STREAMS = 16;
/** The listener closes after this long without a lease request, so an idle phone is not kept busy. */
export const STUDIO_EGRESS_IDLE_MS = 120_000;
export const isAllowedStudioEgressTarget = (host: string, port: number) => isAllowedTunnelTarget({ host, port, allowedSuffixes: STUDIO_EGRESS_ALLOWED_SUFFIXES });

/** Only streams opened by the WhatsApp listener may move the send-proof counters. */
export const countsTowardSendProof = (studioStreamIds: ReadonlySet<string>, streamId: string) => !studioStreamIds.has(streamId);
