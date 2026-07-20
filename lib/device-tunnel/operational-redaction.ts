import { createHash } from "node:crypto";

const SAFE_NAMESPACE = /^[a-z][a-z0-9_]{0,31}$/;

export function redactOperationalIdentifier(value: unknown, namespace = "ref") {
    if (!SAFE_NAMESPACE.test(namespace)) throw new Error("operational_redaction_namespace_invalid");
    const normalized = String(value || "").trim();
    if (!normalized) return null;
    return `${namespace}_${createHash("sha256").update(`${namespace}\0${normalized}`).digest("hex").slice(0, 16)}`;
}

export function fingerprintOperationalPath(value: unknown) {
    return redactOperationalIdentifier(value, "path");
}
