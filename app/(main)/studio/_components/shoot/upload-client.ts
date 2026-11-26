import { readStudioUploadRequest } from "@/lib/studio/upload-policy";
import type { UploadCommand, UploadRecoveryResult } from "@/lib/studio/upload-recovery";

/** The same presigned-R2 flow as the footage drop zone (start -> PUT to storage -> confirm with HEAD), for one file with one progress callback. Nothing is stored in the browser. */
export async function uploadRecordFile(file: File, o: { recordId: string; headers: Record<string, string>; onProgress: (percent: number) => void }): Promise<void> {
  const input = readStudioUploadRequest({ recordId: o.recordId, filename: file.name, contentType: file.type.split(";")[0], byteSize: file.size });
  const uploadId = crypto.randomUUID();
  const command = async (value: UploadCommand): Promise<UploadRecoveryResult> => {
    const response = await fetch("/studio/uploads/api", { method: "POST", headers: { ...o.headers, "Content-Type": "application/json" }, body: JSON.stringify(value), cache: "no-store", signal: AbortSignal.timeout(60_000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Upload outcome could not be confirmed. Try again.");
    return result;
  };
  let result = await command({ action: "start", uploadId, input });
  if (result.status === "ready") {
    const target = result;
    await new Promise<void>(resolve => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", target.url); xhr.timeout = 30 * 60_000;
      for (const [name, value] of Object.entries(target.headers)) xhr.setRequestHeader(name, value);
      xhr.upload.onprogress = event => { if (event.lengthComputable) o.onProgress(Math.round(event.loaded / event.total * 100)); };
      xhr.onload = xhr.onerror = xhr.onabort = xhr.ontimeout = () => resolve();   // HEAD below decides, not the browser status
      xhr.send(file);
    });
    result = await command({ action: "recover", uploadId, recordId: o.recordId });
  }
  if (result.status !== "uploaded") throw new Error("The video did not reach storage. Check your connection and try again.");
}
