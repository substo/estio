import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { buildUserNotificationLocationWhere } from './location-scope';
import {
  getNotificationEventsChannel,
  getNotificationEventsHistoryKey,
} from '../realtime/notification-events';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

test('notification database scope requires both the user and active location', () => {
  assert.deepEqual(buildUserNotificationLocationWhere('user-new', 'location-new'), {
    userId: 'user-new',
    locationId: 'location-new',
  });
});

test('realtime notification channels and replay history are isolated by location', () => {
  assert.notEqual(
    getNotificationEventsChannel('user-1', 'location-old'),
    getNotificationEventsChannel('user-1', 'location-new'),
  );
  assert.notEqual(
    getNotificationEventsHistoryKey('user-1', 'location-old'),
    getNotificationEventsHistoryKey('user-1', 'location-new'),
  );
});

test('snapshot and read mutations derive location server-side and apply the shared scope', () => {
  const server = read('lib/notifications/server.ts');
  assert.match(server, /getCurrentNotificationAccessOrThrow[\s\S]*getActiveContactsAccess\(\)/);
  assert.match(server, /userNotification\.count\([\s\S]{0,250}buildUserNotificationLocationWhere/);
  assert.match(server, /userNotification\.findMany\([\s\S]{0,250}buildUserNotificationLocationWhere/);
  assert.match(server, /markUserNotificationRead[\s\S]{0,800}buildUserNotificationLocationWhere/);
  assert.match(server, /markAllUserNotificationsRead[\s\S]{0,600}buildUserNotificationLocationWhere/);
});

test('live and replay notification delivery use the authenticated active location', () => {
  const route = read('app/api/notifications/events/route.ts');
  const whatsapp = read('lib/notifications/inbound-whatsapp.ts');
  const reminders = read('lib/tasks/reminders.ts');

  assert.match(route, /getActiveContactsAccess\(\)/);
  assert.match(route, /getNotificationEventsChannel\(access\.internalUserId, access\.locationId\)/);
  assert.match(route, /getNotificationRealtimeEventsSince\(\{[\s\S]{0,180}locationId: access\.locationId/);
  assert.match(whatsapp, /publishNotificationRealtimeEvent\(\{[\s\S]{0,100}locationId/);
  assert.match(reminders, /publishNotificationRealtimeEvent\(\{[\s\S]{0,100}locationId: job\.locationId/);
});
