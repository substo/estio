import { randomUUID } from "node:crypto";
import {
    DeleteObjectCommand,
    GetObjectCommand,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { DEFAULT_SESSION_AUTH_MAX_ARCHIVE_BYTES } from "./session-auth-crypto";

export type SessionAuthObjectStoreConfig = {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    endpoint: string;
};

export function getSessionAuthObjectStoreConfig(env: NodeJS.ProcessEnv = process.env): SessionAuthObjectStoreConfig {
    const accountId = String(env.CLOUDFLARE_R2_ACCOUNT_ID || env.R2_ACCOUNT_ID || "").trim();
    const accessKeyId = String(env.WHATSAPP_SESSION_AUTH_R2_ACCESS_KEY_ID || "").trim();
    const secretAccessKey = String(env.WHATSAPP_SESSION_AUTH_R2_SECRET_ACCESS_KEY || "").trim();
    const bucket = String(env.WHATSAPP_SESSION_AUTH_R2_BUCKET || "").trim();
    const endpoint = String(env.WHATSAPP_SESSION_AUTH_R2_ENDPOINT || (accountId
        ? `https://${accountId}.r2.cloudflarestorage.com`
        : "")).trim();
    if (!/^[a-f0-9]{32}$/i.test(accountId) || !accessKeyId || !secretAccessKey) {
        throw new Error("Dedicated WhatsApp session-auth R2 credentials are missing or invalid");
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,126}[a-zA-Z0-9]$/.test(bucket)) {
        throw new Error("WhatsApp session-auth R2 bucket is missing or invalid");
    }
    let parsed: URL;
    try {
        parsed = new URL(endpoint);
    } catch {
        throw new Error("WhatsApp session-auth R2 endpoint is invalid");
    }
    if (
        parsed.protocol !== "https:"
        || parsed.username
        || parsed.password
        || parsed.search
        || parsed.hash
        || parsed.pathname !== "/"
        || parsed.hostname !== `${accountId}.r2.cloudflarestorage.com`
    ) {
        throw new Error("WhatsApp session-auth R2 endpoint is not the configured Cloudflare account endpoint");
    }
    return { accountId, accessKeyId, secretAccessKey, bucket, endpoint: parsed.toString().replace(/\/$/, "") };
}

export function buildSessionAuthObjectKey(placementId: string, generation: number, objectId: string = randomUUID()) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(placementId)) throw new Error("Session-auth placement ID is invalid");
    if (!Number.isSafeInteger(generation) || generation < 1) throw new Error("Session-auth generation is invalid");
    if (!/^[a-zA-Z0-9-]{1,64}$/.test(objectId)) throw new Error("Session-auth object ID is invalid");
    return `whatsapp-session-auth/v1/placement/${placementId}/generation/${generation}/${objectId}.bin`;
}

function validateManagedSessionAuthObjectKey(key: string) {
    if (!/^whatsapp-session-auth\/v1\/placement\/[a-zA-Z0-9_-]+\/generation\/[1-9][0-9]*\/[a-zA-Z0-9-]+\.bin$/.test(key)) {
        throw new Error("Session-auth object key is outside the managed prefix");
    }
    return key;
}

async function objectBodyToBuffer(body: any, maxBytes: number) {
    if (!body || typeof body[Symbol.asyncIterator] !== "function") throw new Error("Session-auth object body is unavailable");
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of body) {
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += value.length;
        if (total > maxBytes) throw new Error("Session-auth object exceeds the configured size limit");
        chunks.push(value);
    }
    if (!total) throw new Error("Session-auth object is empty");
    return Buffer.concat(chunks, total);
}

export class R2SessionAuthObjectStore {
    private readonly config: SessionAuthObjectStoreConfig;
    private readonly client: S3Client;

    constructor(config = getSessionAuthObjectStoreConfig(), client?: S3Client) {
        this.config = config;
        this.client = client || new S3Client({
            region: "auto",
            endpoint: config.endpoint,
            forcePathStyle: true,
            // A detach performs both an immutable PUT and a read-back GET. Keep each
            // request below half of the 180-second fenced detach deadline.
            requestHandler: new NodeHttpHandler({ connectionTimeout: 5_000, requestTimeout: 60_000 }),
            credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        });
    }

    async putImmutable(args: { key: string; ciphertext: Buffer; ciphertextSha256: string }) {
        validateManagedSessionAuthObjectKey(args.key);
        if (!args.ciphertext.length || args.ciphertext.length > DEFAULT_SESSION_AUTH_MAX_ARCHIVE_BYTES) {
            throw new Error("Session-auth encrypted object size is invalid");
        }
        const response = await this.client.send(new PutObjectCommand({
            Bucket: this.config.bucket,
            Key: args.key,
            Body: args.ciphertext,
            ContentLength: args.ciphertext.length,
            ContentType: "application/octet-stream",
            Metadata: { ciphertext_sha256: args.ciphertextSha256 },
            IfNoneMatch: "*",
        }));
        return { etag: response.ETag || null, versionId: response.VersionId || null };
    }

    async get(args: { key: string; maxBytes?: number }) {
        validateManagedSessionAuthObjectKey(args.key);
        const maxBytes = args.maxBytes ?? DEFAULT_SESSION_AUTH_MAX_ARCHIVE_BYTES;
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > DEFAULT_SESSION_AUTH_MAX_ARCHIVE_BYTES) {
            throw new Error("Session-auth object size limit is invalid");
        }
        const response = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: args.key }));
        if (Number(response.ContentLength || 0) > maxBytes) throw new Error("Session-auth object exceeds the configured size limit");
        return objectBodyToBuffer(response.Body, maxBytes);
    }

    async deleteRetainedObject(key: string) {
        validateManagedSessionAuthObjectKey(key);
        await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
    }
}
