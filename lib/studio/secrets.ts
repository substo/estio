import crypto from "node:crypto";

/**
 * Studio secret encryption: AES-256-GCM under STUDIO_SECRETS_KEY (base64, 32
 * bytes). The associated data binds each ciphertext to its workspace and
 * purpose, so a ciphertext copied to another workspace or field fails to open.
 * Rotation: set a new key and id, and keep the old ones in
 * STUDIO_SECRETS_PREVIOUS_KEYS ("id:base64,id:base64") until rows re-encrypt.
 */
export interface StudioSecretCiphertext { ciphertext: string; iv: string; authTag: string; keyId: string }
type Env = Record<string, string | undefined>;
const keyIdPattern = /^[a-z0-9_-]{1,32}$/;

function decodeKey(value: string | undefined) {
  if (!value) return null;
  const key = Buffer.from(value.trim(), "base64");
  return key.length === 32 ? key : null;
}
function keyring(env: Env) {
  const keys = new Map<string, Buffer>();
  for (const entry of (env.STUDIO_SECRETS_PREVIOUS_KEYS ?? "").split(",").map(part => part.trim()).filter(Boolean)) {
    const [id, value] = entry.split(":");
    const key = decodeKey(value);
    if (id && keyIdPattern.test(id) && key) keys.set(id, key);
  }
  const currentId = env.STUDIO_SECRETS_KEY_ID?.trim() || "v1";
  const current = decodeKey(env.STUDIO_SECRETS_KEY);
  if (current && keyIdPattern.test(currentId)) keys.set(currentId, current);
  return { keys, currentId: current && keyIdPattern.test(currentId) ? currentId : null };
}

export function hasStudioSecretsKey(env: Env = process.env) { return keyring(env).currentId !== null; }
export function hasStudioSecretKeyId(id: string, env: Env = process.env) { return keyring(env).keys.has(id); }

export function encryptStudioSecret(plaintext: string, context: string, env: Env = process.env): StudioSecretCiphertext {
  const { keys, currentId } = keyring(env);
  if (!currentId) throw new Error("STUDIO_SECRETS_KEY is not configured.");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keys.get(currentId)!, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64"), keyId: currentId };
}

export function decryptStudioSecret(value: StudioSecretCiphertext, context: string, env: Env = process.env): string {
  const key = keyring(env).keys.get(value.keyId);
  if (!key) throw new Error("Studio secret key is unavailable for this ciphertext.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "base64"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

export const aiCredentialContext = (workspaceId: string, provider: string) => `studio:ai-credential:${workspaceId.toLowerCase()}:${provider}`;
