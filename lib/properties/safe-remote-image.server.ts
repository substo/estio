import "server-only";

import { createSafeRemoteImageDownloader } from "@/lib/properties/safe-remote-image";

/** Server-only production entrypoint; the core factory remains dependency-injectable for tests. */
export const downloadSafeRemoteImage = createSafeRemoteImageDownloader();
