#!/usr/bin/env tsx
import { parseArgs } from "node:util";
import { verifyRecoveryBundle } from "../lib/studio/recovery/archive";
async function main() {
 const { values } = parseArgs({ options: { bundle: { type: "string" }, "manifest-sha256": { type: "string" }, "project-ref": { type: "string" }, bucket: { type: "string" } }, strict: true });
 if (!values.bundle || !values["manifest-sha256"] || !values["project-ref"] || !values.bucket) throw new Error("missing_arguments");
 console.log(JSON.stringify(await verifyRecoveryBundle({ root: values.bundle, manifestSha256: values["manifest-sha256"], projectRef: values["project-ref"], bucket: values.bucket })));
}
main().catch(() => { console.error(JSON.stringify({ verified: false, error: "recovery_verification_failed" })); process.exitCode = 1; });
