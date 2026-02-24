import path from "path";
import { randomUUID } from "crypto";
import {
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const DEFAULT_BUCKET_NAME = "whatsapp-media";
const DEFAULT_UPLOAD_TTL_SECONDS = 600;
const DEFAULT_READ_TTL_SECONDS = 300;

let r2ClientSingleton: S3Client | null = null;

type R2Config = {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucketName: string;
    endpoint: string;
};

function getAppEnvSegment() {
    return String(
        process.env.APP_ENV ||
        process.env.VERCEL_ENV ||
        process.env.NODE_ENV ||
        "development"
    )
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "-");
}

function getR2Config(): R2Config {
    const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID || process.env.R2_ACCOUNT_ID || "";
    const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID || "";
    const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY || "";
    const bucketName = process.env.R2_BUCKET_NAME || DEFAULT_BUCKET_NAME;
    const endpoint = process.env.CLOUDFLARE_R2_ENDPOINT || process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");

    if (!accountId || !accessKeyId || !secretAccessKey || !bucketName || !endpoint) {
        throw new Error("Missing Cloudflare R2 configuration. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME.");
    }

    return { accountId, accessKeyId, secretAccessKey, bucketName, endpoint };
}

function getR2Client() {
    if (r2ClientSingleton) return r2ClientSingleton;

    const config = getR2Config();
    r2ClientSingleton = new S3Client({
        region: "auto",
        endpoint: config.endpoint,
        forcePathStyle: true,
        credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
        },
    });
    return r2ClientSingleton;
}

function sanitizePathSegment(value: string) {
    return String(value || "")
        .trim()
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .replace(/_+/g, "_")
        .slice(0, 120) || "unknown";
}

function inferExtension(fileName?: string, contentType?: string) {
    const fromName = path.extname(String(fileName || "")).toLowerCase();
    if (fromName) return fromName;

    const type = String(contentType || "").toLowerCase();
    if (type === "image/jpeg") return ".jpg";
    if (type === "image/png") return ".png";
    if (type === "image/webp") return ".webp";
    if (type === "image/gif") return ".gif";
    if (type === "image/heic") return ".heic";
    return ".bin";
}

export function sanitizeWhatsAppMediaFilename(fileName: string, contentType?: string) {
    const rawBase = path.basename(String(fileName || "upload")).replace(/\.[^.]+$/, "");
    const safeBase = sanitizePathSegment(rawBase) || "upload";
    return `${safeBase}${inferExtension(fileName, contentType)}`;
}

function dateSegments() {
    const now = new Date();
    const y = String(now.getUTCFullYear());
    const m = String(now.getUTCMonth() + 1).padStart(2, "0");
    const d = String(now.getUTCDate()).padStart(2, "0");
    return { y, m, d };
}

export function buildWhatsAppOutboundUploadKey(input: {
    locationId: string;
    contactId: string;
    conversationId: string;
    fileName: string;
    contentType?: string;
}) {
    const { y, m, d } = dateSegments();
    const safeName = sanitizeWhatsAppMediaFilename(input.fileName, input.contentType);
    const ext = path.extname(safeName);
    const env = getAppEnvSegment();

    return [
        "whatsapp",
        "evolution",
        "v1",
        "env",
        env,
        "location",
        sanitizePathSegment(input.locationId),
        "contact",
        sanitizePathSegment(input.contactId),
        "conversation",
        sanitizePathSegment(input.conversationId),
        "outbound",
        y,
        m,
        d,
        `${randomUUID()}${ext}`,
    ].join("/");
}

export function buildWhatsAppInboundAttachmentKey(input: {
    locationId: string;
    contactId?: string | null;
    conversationId: string;
    messageId: string;
    fileName: string;
    contentType?: string;
}) {
    const safeName = sanitizeWhatsAppMediaFilename(input.fileName, input.contentType);
    const ext = path.extname(safeName);
    const env = getAppEnvSegment();

    const base = [
        "whatsapp",
        "evolution",
        "v1",
        "env",
        env,
        "location",
        sanitizePathSegment(input.locationId),
    ];

    if (input.contactId) {
        base.push("contact", sanitizePathSegment(input.contactId));
    }

    base.push(
        "conversation",
        sanitizePathSegment(input.conversationId),
        "message",
        sanitizePathSegment(input.messageId),
        "inbound",
        `${randomUUID()}${ext}`,
    );

    return base.join("/");
}

export function toR2Uri(key: string) {
    const { bucketName } = getR2Config();
    return `r2://${bucketName}/${key.replace(/^\/+/, "")}`;
}

export function parseR2Uri(uri: string): { bucket: string; key: string } | null {
    if (!uri.startsWith("r2://")) return null;
    const rest = uri.slice("r2://".length);
    const slash = rest.indexOf("/");
    if (slash <= 0) return null;
    const bucket = rest.slice(0, slash);
    const key = rest.slice(slash + 1);
    if (!bucket || !key) return null;
    return { bucket, key };
}

export async function createWhatsAppMediaUploadUrl(params: {
    key: string;
    contentType: string;
    expiresInSeconds?: number;
}) {
    const { bucketName } = getR2Config();
    const client = getR2Client();
    const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: params.key,
        ContentType: params.contentType,
    });

    const uploadUrl = await getSignedUrl(client, command, {
        expiresIn: params.expiresInSeconds || DEFAULT_UPLOAD_TTL_SECONDS,
    });

    return {
        uploadUrl,
        bucketName,
        key: params.key,
    };
}

export async function createWhatsAppMediaReadUrl(params: {
    key: string;
    contentType?: string;
    fileName?: string;
    disposition?: "inline" | "attachment";
    expiresInSeconds?: number;
}) {
    const { bucketName } = getR2Config();
    const client = getR2Client();
    const disposition = params.disposition || "inline";
    const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: params.key,
        ResponseContentType: params.contentType,
        ResponseContentDisposition: params.fileName
            ? `${disposition}; filename="${sanitizePathSegment(params.fileName)}"`
            : disposition,
    });

    const url = await getSignedUrl(client, command, {
        expiresIn: params.expiresInSeconds || DEFAULT_READ_TTL_SECONDS,
    });

    return url;
}

export async function putWhatsAppMediaObject(params: {
    key: string;
    body: Buffer | Uint8Array;
    contentType: string;
    contentLength?: number;
}) {
    const { bucketName } = getR2Config();
    const client = getR2Client();

    await client.send(
        new PutObjectCommand({
            Bucket: bucketName,
            Key: params.key,
            Body: params.body,
            ContentType: params.contentType,
            ContentLength: params.contentLength,
        })
    );

    return {
        bucketName,
        key: params.key,
        r2Uri: toR2Uri(params.key),
    };
}

export async function headWhatsAppMediaObject(key: string) {
    const { bucketName } = getR2Config();
    const client = getR2Client();

    try {
        const res = await client.send(
            new HeadObjectCommand({
                Bucket: bucketName,
                Key: key,
            })
        );
        return {
            exists: true,
            contentLength: res.ContentLength ?? undefined,
            contentType: res.ContentType ?? undefined,
            etag: res.ETag ?? undefined,
        };
    } catch (error: any) {
        const code = error?.$metadata?.httpStatusCode || error?.$response?.statusCode;
        if (code === 404 || error?.name === "NotFound") {
            return { exists: false as const };
        }
        throw error;
    }
}
