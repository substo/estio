import { YoutubeError } from "./youtube-api";
/** Bounded before parsing; do not buffer an arbitrarily large authenticated POST. */
export async function readYoutubeRequestText(request: Request): Promise<string> {
  const reader = request.body?.getReader(); if (!reader) return "";
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 16_384) { await reader.cancel(); throw new YoutubeError("request_too_large", "Request too large."); }
      chunks.push(part.value);
    }
    try { return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); }
    catch { throw new YoutubeError("invalid_request", "Invalid request text."); }
  } finally { reader.releaseLock(); }
}
