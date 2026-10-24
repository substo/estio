import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";

export class SourceSnapshotError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "SourceSnapshotError"; }
}

type SourceIdentity = Pick<BigIntStats, "dev" | "ino" | "size" | "mtimeNs" | "ctimeNs" | "mode">;
export interface SourceSnapshot {
  absolutePath: string;
  relativePath: string;
  maximumBytes: number;
  identity: SourceIdentity;
  sha256: string;
  bytes: Buffer;
}
export function sameIdentity(a: SourceIdentity, b: SourceIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.mode === b.mode;
}
function identity(info: BigIntStats): SourceIdentity {
  return { dev: info.dev, ino: info.ino, size: info.size, mtimeNs: info.mtimeNs, ctimeNs: info.ctimeNs, mode: info.mode };
}

async function openCheckedSourceFile(absolutePath: string, maximumBytes: number, ErrorType: new (code: string) => Error) {
  const before = await lstat(absolutePath, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(maximumBytes) || await realpath(absolutePath) !== absolutePath) throw new ErrorType("unsafe_or_oversized_source_file");
  const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!sameIdentity(before, await handle.stat({ bigint: true }))) throw new ErrorType("source_changed_during_preview");
    return { before, handle };
  } catch (error) { await handle.close(); throw error; }
}
async function assertOpenSourceUnchanged(absolutePath: string, before: SourceIdentity, handle: FileHandle, ErrorType: new (code: string) => Error) {
  if (!sameIdentity(before, await handle.stat({ bigint: true })) || !sameIdentity(before, await lstat(absolutePath, { bigint: true }))) throw new ErrorType("source_changed_during_preview");
}

/** A no-follow read plus identity/hash evidence, also used by final verification. */
export async function readSourceSnapshot(absolutePath: string, relativePath: string, maximumBytes: number, ErrorType: new (code: string) => Error = SourceSnapshotError): Promise<SourceSnapshot> {
  const { before, handle } = await openCheckedSourceFile(absolutePath, maximumBytes, ErrorType);
  try {
    // Bound metadata reads too: concurrent growth cannot make readFile allocate
    // beyond the captured source size. One extra byte detects observed growth.
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, Math.min(1024 * 1024, buffer.length - length), length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    await assertOpenSourceUnchanged(absolutePath, before, handle, ErrorType);
    if (length > maximumBytes || BigInt(length) !== before.size) throw new ErrorType("source_changed_during_preview");
    const bytes = buffer.subarray(0, length);
    return { absolutePath, relativePath, maximumBytes, identity: identity(before), bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
  } finally { await handle.close(); }
}

export interface SourceFileFingerprint {
  absolutePath: string;
  relativePath: string;
  identity: SourceIdentity;
  sha256: string;
  byteSize: number;
}

/** Hash media in 1 MiB chunks rather than retaining a whole video in memory. */
export async function hashSourceFile(absolutePath: string, relativePath: string, maximumBytes: number): Promise<SourceFileFingerprint> {
  const { before, handle } = await openCheckedSourceFile(absolutePath, maximumBytes, SourceSnapshotError);
  const expectedBytes = Number(before.size);
  const buffer = Buffer.alloc(1024 * 1024);
  const hash = createHash("sha256");
  let byteSize = 0;
  try {
    // Read at most the original length plus one byte, so growth cannot turn
    // a bounded preview into an unbounded read. EOF must match captured size.
    while (byteSize <= expectedBytes) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, expectedBytes - byteSize + 1), byteSize);
      if (!bytesRead) break;
      byteSize += bytesRead;
      if (byteSize > expectedBytes) throw new SourceSnapshotError("source_changed_during_preview");
      hash.update(buffer.subarray(0, bytesRead));
    }
    await assertOpenSourceUnchanged(absolutePath, before, handle, SourceSnapshotError);
    if (byteSize !== expectedBytes) throw new SourceSnapshotError("source_changed_during_preview");
    return { absolutePath, relativePath, identity: identity(before), byteSize, sha256: hash.digest("hex") };
  } finally { await handle.close(); }
}

export async function assertSourceSnapshotUnchanged(snapshot: SourceSnapshot, ErrorType: new (code: string) => Error = SourceSnapshotError): Promise<void> {
  const current = await readSourceSnapshot(snapshot.absolutePath, snapshot.relativePath, snapshot.maximumBytes, ErrorType);
  if (!sameIdentity(snapshot.identity, current.identity) || snapshot.sha256 !== current.sha256) throw new ErrorType("source_changed_during_preview");
}

