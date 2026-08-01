import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routeSource = readFileSync(
  new URL('./route.ts', import.meta.url),
  'utf8',
);
const actionsSource = readFileSync(
  new URL('../../../../(main)/admin/conversations/actions.ts', import.meta.url),
  'utf8',
);
const statusSource = readFileSync(
  new URL('../../../../(main)/admin/conversations/_components/whatsapp-status.tsx', import.meta.url),
  'utf8',
);

test('WhatsApp bridge status and connection management require active ADMIN access', () => {
  assert.match(routeSource, /getActiveContactsAccess\(\)/);
  assert.match(routeSource, /access\.role !== "ADMIN"/);
  assert.match(routeSource, /status: 403/);
  assert.match(actionsSource, /async function getBasicAdminLocationContext\(\)/);
  assert.match(actionsSource, /access\.role !== 'ADMIN'/);
  assert.match(actionsSource, /getWhatsAppWebBridgeStatus[\s\S]*getBasicAdminLocationContext\(\)/);
  assert.match(actionsSource, /triggerWhatsAppWebBridgeConnection[\s\S]*getBasicAdminLocationContext\(\)/);
});

test('ordinary members do not retain a visible WhatsApp bridge status control', () => {
  assert.match(statusSource, /response\.status === 403/);
  assert.match(statusSource, /setCanViewWhatsAppStatus\(false\)/);
  assert.match(statusSource, /if \(!canViewWhatsAppStatus\) return null/);
});
