import { constants } from "node:fs";
import { mkdir, open, rename, rm, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export function appOrigin(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      !(url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    throw new Error("invalid_app_origin");
  return url.origin;
}
export const configSchema = z.object({ version: z.literal(1), origin: z.string().transform(appOrigin),
  token: z.string().regex(/^studio_device_[A-Za-z0-9_-]{43}$/), name: z.string().min(1).max(100), deviceId: z.string().uuid() }).strict();
export type CompanionConfig = z.infer<typeof configSchema>;
export const defaultConfigDir = () => join(homedir(), "Library", "Application Support", "Estio", "StudioCompanion");

async function privateDirectory(dir: string) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const stat = await lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0)
    throw new Error("unsafe_config_directory");
}
export async function saveConfig(input: CompanionConfig, dir = defaultConfigDir()) {
  const config = configSchema.parse(input);
  await privateDirectory(dir);
  const temp = join(dir, `.config-${randomUUID()}`);
  try {
    const file = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(JSON.stringify(config)); await file.sync(); } finally { await file.close(); }
    await rename(temp, join(dir, "config.json"));
  } finally { await rm(temp, { force: true }); }
}
export async function loadConfig(dir = defaultConfigDir()): Promise<CompanionConfig> {
  await privateDirectory(dir);
  const file = await open(join(dir, "config.json"), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || stat.size > 8192)
      throw new Error("unsafe_config_file");
    return configSchema.parse(JSON.parse(await file.readFile("utf8")));
  } finally { await file.close(); }
}
