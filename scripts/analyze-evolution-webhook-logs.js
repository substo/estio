#!/usr/bin/env node

/**
 * Analyze Evolution webhook JSON logs for LID/contact mapping issues.
 *
 * Usage examples:
 *   node scripts/analyze-evolution-webhook-logs.js --dir /home/martin/logs/evolution --phone 35799271476
 *   node scripts/analyze-evolution-webhook-logs.js --dir /home/martin/logs/evolution --lid 155731873509555
 *   node scripts/analyze-evolution-webhook-logs.js --dir /home/martin/logs/evolution --phone 35799271476 --since 2026-02-18T00:00:00Z
 */

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
      continue;
    }
    args[key] = next;
    i++;
  }
  return args;
}

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeLid(value) {
  return String(value || "").replace("@lid", "").trim();
}

function parseFileTimestamp(filename) {
  const idx = filename.indexOf("_");
  if (idx <= 0) return null;
  const raw = filename.slice(0, idx);
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${m[7]}Z`;
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const fallback = new Date(raw);
  if (!Number.isNaN(fallback.getTime())) return fallback;
  return null;
}

function matchesPhone(value, targetDigits) {
  if (!targetDigits) return true;
  const d = digits(value);
  if (!d) return false;
  if (d === targetDigits) return true;
  if (d.length >= 7 && targetDigits.length >= 7) {
    return d.endsWith(targetDigits) || targetDigits.endsWith(d);
  }
  return d.includes(targetDigits) || targetDigits.includes(d);
}

function matchesLid(value, lidRaw) {
  if (!lidRaw) return true;
  const v = normalizeLid(value);
  return v.includes(lidRaw) || lidRaw.includes(v);
}

function eventTimestamp(record) {
  if (record.fileTimestamp) return record.fileTimestamp.toISOString();
  return "unknown-time";
}

function main() {
  const argv = parseArgs(process.argv.slice(2));
  const dir = argv.dir || "/tmp/evolution-logs";
  const targetPhone = digits(argv.phone || "");
  const targetLid = normalizeLid(argv.lid || "");
  const targetInstance = argv.instance || "";
  const limit = Number(argv.limit || 0) || 0;
  const since = argv.since ? new Date(argv.since) : null;
  const sinceMs = since && !Number.isNaN(since.getTime()) ? since.getTime() : null;

  if (!fs.existsSync(dir)) {
    console.error(`[analyze] Log directory does not exist: ${dir}`);
    process.exit(1);
  }

  let files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  if (limit > 0 && files.length > limit) {
    files = files.slice(-limit);
  }

  const countsByEvent = {};
  const matchedMessages = [];
  const matchedContactMappings = [];
  let scanned = 0;
  let parsed = 0;

  let lidMessages = 0;
  let lidResolvedBySenderPn = 0;
  let lidResolvedByAlt = 0;
  let lidUnresolved = 0;

  for (const file of files) {
    scanned++;
    const full = path.join(dir, file);
    let body;
    try {
      body = JSON.parse(fs.readFileSync(full, "utf8"));
      parsed++;
    } catch {
      continue;
    }

    const fileTimestamp = parseFileTimestamp(file);
    if (sinceMs && fileTimestamp && fileTimestamp.getTime() < sinceMs) {
      continue;
    }

    const eventType = String(body.event || "").toUpperCase();
    const instance = body.instance || "";

    if (targetInstance && instance !== targetInstance) {
      continue;
    }

    countsByEvent[eventType] = (countsByEvent[eventType] || 0) + 1;

    if (eventType === "MESSAGES_UPSERT" || eventType === "MESSAGES.UPSERT") {
      const msg = body.data || {};
      const key = msg.key || {};
      const remoteJid = key.remoteJid || "";
      const senderPnRaw = key.senderPn || msg.senderPn || "";
      const senderPn = senderPnRaw.replace("@s.whatsapp.net", "");
      const remoteJidAltRaw = msg.remoteJidAlt || "";
      const remoteJidAlt = remoteJidAltRaw.replace("@s.whatsapp.net", "");
      const participant = key.participant || msg.participant || "";
      const wamId = key.id || "";
      const fromMe = !!key.fromMe;

      const row = {
        file,
        fileTimestamp,
        instance,
        eventType,
        wamId,
        fromMe,
        remoteJid,
        senderPn,
        remoteJidAlt,
        participant,
      };

      const isLidMessage = String(remoteJid).includes("@lid");
      if (isLidMessage) {
        lidMessages++;
        if (senderPn) lidResolvedBySenderPn++;
        else if (remoteJidAlt) lidResolvedByAlt++;
        else lidUnresolved++;
      }

      const phoneMatch =
        !targetPhone ||
        matchesPhone(remoteJid, targetPhone) ||
        matchesPhone(senderPn, targetPhone) ||
        matchesPhone(remoteJidAlt, targetPhone) ||
        matchesPhone(participant, targetPhone);

      const lidMatch =
        !targetLid ||
        matchesLid(remoteJid, targetLid) ||
        matchesLid(participant, targetLid);

      if (phoneMatch && lidMatch) {
        matchedMessages.push(row);
      }
      continue;
    }

    if (
      eventType === "CONTACTS_UPSERT" ||
      eventType === "CONTACTS.UPSERT" ||
      eventType === "CONTACTS_UPDATE" ||
      eventType === "CONTACTS.UPDATE"
    ) {
      const contacts = Array.isArray(body.data) ? body.data : [body.data];
      for (const c of contacts) {
        if (!c) continue;
        const id = c.id || "";
        const lid = c.lid || (String(id).endsWith("@lid") ? id : "");
        const phoneCandidate = c.phoneNumber || (String(id).endsWith("@s.whatsapp.net") ? id : "");
        const notify = c.notify || "";
        const name = c.name || "";

        const row = {
          file,
          fileTimestamp,
          instance,
          eventType,
          id,
          lid,
          phoneCandidate,
          name,
          notify,
        };

        const phoneMatch =
          !targetPhone ||
          matchesPhone(phoneCandidate, targetPhone) ||
          matchesPhone(id, targetPhone) ||
          matchesPhone(notify, targetPhone);
        const lidMatch = !targetLid || matchesLid(lid, targetLid) || matchesLid(id, targetLid);

        if (phoneMatch && lidMatch) {
          matchedContactMappings.push(row);
        }
      }
    }
  }

  const topEvents = Object.entries(countsByEvent)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  console.log("=== Evolution Webhook Log Analysis ===");
  console.log(`Directory: ${dir}`);
  console.log(`Files scanned: ${scanned}`);
  console.log(`Files parsed: ${parsed}`);
  if (targetInstance) console.log(`Instance filter: ${targetInstance}`);
  if (targetPhone) console.log(`Phone filter: ${targetPhone}`);
  if (targetLid) console.log(`LID filter: ${targetLid}`);
  if (sinceMs) console.log(`Since: ${new Date(sinceMs).toISOString()}`);

  console.log("\nTop events:");
  for (const [event, count] of topEvents) {
    console.log(`  ${event || "(empty-event)"}: ${count}`);
  }

  console.log("\nLID message resolution stats (all parsed messages):");
  console.log(`  Total @lid messages: ${lidMessages}`);
  console.log(`  Resolved by senderPn: ${lidResolvedBySenderPn}`);
  console.log(`  Resolved by remoteJidAlt: ${lidResolvedByAlt}`);
  console.log(`  Unresolved @lid (no senderPn/remoteJidAlt): ${lidUnresolved}`);

  console.log(`\nMatched message rows: ${matchedMessages.length}`);
  for (const row of matchedMessages.slice(-30)) {
    console.log(
      `  [${eventTimestamp(row)}] wamId=${row.wamId} fromMe=${row.fromMe} remoteJid=${row.remoteJid} senderPn=${row.senderPn || "-"} remoteJidAlt=${row.remoteJidAlt || "-"} participant=${row.participant || "-"}`
    );
  }

  console.log(`\nMatched contact-mapping rows: ${matchedContactMappings.length}`);
  for (const row of matchedContactMappings.slice(-30)) {
    console.log(
      `  [${eventTimestamp(row)}] event=${row.eventType} id=${row.id || "-"} lid=${row.lid || "-"} phone=${row.phoneCandidate || "-"} notify=${row.notify || "-"}`
    );
  }

  console.log("\nDiagnosis:");
  if (lidMessages > 0 && lidUnresolved === lidMessages) {
    console.log("  - Every LID message was unresolved in webhook payloads.");
  }
  if (lidUnresolved > 0 && matchedContactMappings.length === 0) {
    console.log("  - No matching CONTACTS_UPSERT/UPDATE mappings were found for the filtered data.");
    console.log("  - This usually causes placeholder/LID contacts until mapping is learned.");
  }
  if (countsByEvent["CONTACTS_UPSERT"] === undefined && countsByEvent["CONTACTS.UPSERT"] === undefined) {
    console.log("  - CONTACTS_UPSERT events are absent in logs. Check Evolution webhook event subscription.");
  }
}

main();
