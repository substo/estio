const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

const LOG_DIR = process.env.WEBHOOK_LOG_DIR || '/home/martin/logs/evolution';
const digits = (v) => String(v || '').replace(/\D/g, '');
const lidRaw = (v) => String(v || '').replace('@lid', '');
const fromJid = (v, suffix) => String(v || '').replace(suffix, '');

(async () => {
  const locations = await db.location.findMany({
    where: { evolutionInstanceId: { not: null } },
    select: { id: true, evolutionInstanceId: true }
  });
  const locByInstance = new Map(locations.map(l => [l.evolutionInstanceId, l.id]));

  const files = fs.existsSync(LOG_DIR)
    ? fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.json')).sort()
    : [];

  const evidences = [];

  for (const f of files) {
    const full = path.join(LOG_DIR, f);
    let body;
    try { body = JSON.parse(fs.readFileSync(full, 'utf8')); } catch { continue; }

    const event = String(body.event || '').toLowerCase();
    if (event !== 'messages.upsert') continue;

    const locationId = locByInstance.get(body.instance || '');
    if (!locationId) continue;

    const msg = body.data || {};
    const key = msg.key || {};
    const remoteJid = String(key.remoteJid || '');
    const prev = String(key.previousRemoteJid || msg.previousRemoteJid || '');
    const senderPn = String(key.senderPn || msg.senderPn || '');

    if (!prev.endsWith('@lid')) continue;
    if (!remoteJid.endsWith('@s.whatsapp.net')) continue;

    const phoneRemote = digits(fromJid(remoteJid, '@s.whatsapp.net'));
    const phoneSender = digits(fromJid(senderPn, '@s.whatsapp.net'));

    if (!phoneRemote) continue;
    if (!phoneSender || phoneSender !== phoneRemote) continue;

    evidences.push({
      locationId,
      lid: lidRaw(prev),
      phone: phoneRemote,
      wamId: String(key.id || ''),
      file: f
    });
  }

  const byLid = new Map();
  const byPhone = new Map();

  for (const e of evidences) {
    const k1 = `${e.locationId}|${e.lid}`;
    const s1 = byLid.get(k1) || new Set();
    s1.add(e.phone);
    byLid.set(k1, s1);

    const k2 = `${e.locationId}|${e.phone}`;
    const s2 = byPhone.get(k2) || new Set();
    s2.add(e.lid);
    byPhone.set(k2, s2);
  }

  const candidates = [];
  const skipped = {
    no_placeholder: 0,
    multi_placeholder: 0,
    no_target: 0,
    multi_target: 0,
    conflicting_lid_to_phone: 0,
    conflicting_phone_to_lid: 0,
    target_has_other_lid: 0
  };

  for (const [k, phonesSet] of byLid.entries()) {
    const [locationId, lid] = k.split('|');

    if (phonesSet.size !== 1) {
      skipped.conflicting_lid_to_phone++;
      continue;
    }

    const phone = Array.from(phonesSet)[0];
    const phoneLids = byPhone.get(`${locationId}|${phone}`) || new Set();

    if (phoneLids.size !== 1) {
      skipped.conflicting_phone_to_lid++;
      continue;
    }

    const placeholders = await db.contact.findMany({
      where: {
        locationId,
        lid: { contains: lid },
        OR: [{ phone: null }, { phone: { contains: '@lid' } }]
      },
      select: { id: true, name: true, phone: true, lid: true, createdAt: true }
    });

    if (placeholders.length === 0) { skipped.no_placeholder++; continue; }
    if (placeholders.length > 1) { skipped.multi_placeholder++; continue; }

    const source = placeholders[0];

    const targetCandidates = await db.contact.findMany({
      where: {
        locationId,
        id: { not: source.id },
        phone: { not: null }
      },
      select: { id: true, name: true, phone: true, lid: true, createdAt: true }
    });

    const targets = targetCandidates.filter(c => digits(c.phone) === phone);

    if (targets.length === 0) { skipped.no_target++; continue; }
    if (targets.length > 1) { skipped.multi_target++; continue; }

    const target = targets[0];
    if (target.lid && lidRaw(target.lid) !== lid) {
      skipped.target_has_other_lid++;
      continue;
    }

    const evidenceCount = evidences.filter(e => e.locationId === locationId && e.lid === lid && e.phone === phone).length;

    candidates.push({
      locationId,
      lid: `${lid}@lid`,
      phone: `+${phone}`,
      sourceId: source.id,
      sourceName: source.name,
      targetId: target.id,
      targetName: target.name,
      evidenceCount
    });
  }

  console.log(JSON.stringify({
    totalWebhookFiles: files.length,
    strictBridgeEvidenceEvents: evidences.length,
    uniqueLidKeys: byLid.size,
    strictMergeCandidates: candidates.length,
    skipped,
    candidates: candidates.slice(0, 80)
  }, null, 2));

  await db.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
