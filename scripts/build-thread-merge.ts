import { threadMerge } from "../lib/build/thread-merge";
const [phase, receipt] = process.argv.slice(2);
if ((phase !== "prepare" && phase !== "finish") || !receipt || process.argv.length !== 4) throw new Error("Usage: build-thread-merge.ts prepare|finish APPROVAL_RECEIPT");
threadMerge(receipt, phase).then(v => console.log(JSON.stringify(v))).catch(e => { console.error(e.message); process.exitCode = 1; });
