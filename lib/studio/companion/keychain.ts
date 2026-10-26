import { tmpdir } from "node:os";
import { appOrigin, defaultConfigDir, deviceTokenPattern, loadStoredConfig, saveConfig, type CompanionConfig, type DeviceCredentials } from "./config";
import { runNativeProcess, type ProcessRunner } from "./process";

export const keychainService = "com.estio.studio-companion.device-token";
export interface DeviceTokenStore {
  save(origin: string, token: string): Promise<void>;
  read(origin: string): Promise<string | null>;
  remove(origin: string): Promise<void>;
}
/** macOS Keychain via /usr/bin/security. The token is written through `security -i` stdin and read
 * from stdout, so it never appears in argv / `ps`. Account = app origin, one pairing per origin. */
export function createKeychainStore(run: ProcessRunner = runNativeProcess, command = "/usr/bin/security"): DeviceTokenStore {
  const call = (args: string[], input?: string) => run({ command, args, cwd: tmpdir(), input, timeoutMs: 15_000, maxOutputBytes: 8192 });
  const read = async (origin: string) => {
    try {
      const { stdout } = await call(["find-generic-password", "-a", appOrigin(origin), "-s", keychainService, "-w"]);
      const token = stdout.trim();
      return deviceTokenPattern.test(token) ? token : null;
    } catch { return null; }
  };
  return {
    read,
    async save(origin, token) {
      // Both values are pattern-checked, so they need no quoting inside the interactive command line.
      if (!deviceTokenPattern.test(token)) throw new Error("invalid_device_token");
      const account = appOrigin(origin);
      if (!/^[A-Za-z0-9:/.[\]-]+$/.test(account)) throw new Error("invalid_app_origin");
      try { await call(["-i"], `add-generic-password -U -a ${account} -s ${keychainService} -w ${token}\n`); }
      catch { throw new Error("keychain_write_failed"); }
      if (await read(account) !== token) throw new Error("keychain_write_failed");
    },
    async remove(origin) {
      try { await call(["delete-generic-password", "-a", appOrigin(origin), "-s", keychainService]); } catch { /* already absent */ }
    },
  };
}
/** Load config + Keychain token. A slice-1 file token is moved into Keychain, verified, then removed from the file. */
export async function loadCredentials(store: DeviceTokenStore = createKeychainStore(), dir = defaultConfigDir()):
  Promise<{ config: CompanionConfig; credentials: DeviceCredentials; migrated: boolean }> {
  const { config, legacyToken } = await loadStoredConfig(dir);
  if (legacyToken) {
    await store.save(config.origin, legacyToken);
    await saveConfig(config, dir);
    return { config, credentials: { origin: config.origin, token: legacyToken }, migrated: true };
  }
  const token = await store.read(config.origin);
  if (!token) throw new Error("device_token_missing");
  return { config, credentials: { origin: config.origin, token }, migrated: false };
}
