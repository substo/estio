import test from "node:test";
import assert from "node:assert/strict";
import {
  AiAutomationConfigSchema,
  cadenceToDays,
  getCadenceSlotBucket,
  getTimeZoneDayKey,
  isWithinQuietHours,
  makeAutomationDueKey,
} from "./config.ts";

test("cadenceToDays maps supported values", () => {
  assert.equal(cadenceToDays("daily"), 1);
  assert.equal(cadenceToDays("every_2_days"), 2);
  assert.equal(cadenceToDays("every_3_days"), 3);
  assert.equal(cadenceToDays("weekly"), 7);
});

test("quiet hours supports overnight windows", () => {
  const inQuietHours = isWithinQuietHours(
    new Date("2026-03-12T20:30:00.000Z"),
    "Europe/Nicosia",
    { enabled: true, startHour: 21, endHour: 8 }
  );

  const outsideQuietHours = isWithinQuietHours(
    new Date("2026-03-12T10:30:00.000Z"),
    "Europe/Nicosia",
    { enabled: true, startHour: 21, endHour: 8 }
  );

  assert.equal(inQuietHours, true);
  assert.equal(outsideQuietHours, false);
});

test("quiet hours blocks entire day when start and end hour are equal", () => {
  const result = isWithinQuietHours(
    new Date("2026-03-12T12:00:00.000Z"),
    "UTC",
    { enabled: true, startHour: 8, endHour: 8 }
  );

  assert.equal(result, true);
});

test("AiAutomationConfigSchema rejects markdown-like template prompt overrides", () => {
  const parsed = AiAutomationConfigSchema.safeParse({
    enabled: true,
    enabledTemplates: ["post_viewing_follow_up"],
    templateOverrides: {
      post_viewing_follow_up: {
        prompt: "## Heading\n[bad](https://example.com)",
      },
    },
  });

  assert.equal(parsed.success, false);
});

test("AiAutomationConfigSchema validates schedule policy bounds", () => {
  const parsed = AiAutomationConfigSchema.safeParse({
    enabled: true,
    enabledTemplates: ["post_viewing_follow_up"],
    schedulePolicies: {
      post_viewing_follow_up: {
        minHoursSinceViewing: 0,
      },
    },
  });

  assert.equal(parsed.success, false);
});

test("AiAutomationConfigSchema normalizes custom follow-up target lists", () => {
  const parsed = AiAutomationConfigSchema.safeParse({
    enabledTemplates: ["custom_follow_up"],
    schedulePolicies: {
      custom_follow_up: {
        targetConversationIds: ["conv_1", "conv_1", "conv_2"],
        targetContactIds: ["ct_1", "ct_1"],
      },
    },
  });

  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data.schedulePolicies.custom_follow_up.targetConversationIds, ["conv_1", "conv_2"]);
  assert.deepEqual(parsed.data.schedulePolicies.custom_follow_up.targetContactIds, ["ct_1"]);
});

test("due key and cadence slot helpers remain deterministic", () => {
  const now = new Date("2026-03-12T08:00:00.000Z");
  const dayKey = getTimeZoneDayKey(now, "UTC");
  const slot = getCadenceSlotBucket(now, 60);

  assert.equal(dayKey, "2026-03-12");
  assert.equal(slot, String(Math.floor(now.getTime() / (60 * 60 * 1000))));

  const dueKey = makeAutomationDueKey({
    locationId: "loc_1",
    scheduleId: "sch_1",
    templateKey: "re_engagement",
    conversationId: "conv_1",
    contactId: "ct_1",
    dealId: "deal_1",
    slotKey: `${dayKey}:${slot}`,
  });

  assert.equal(
    dueKey,
    `loc:loc_1|sch:sch_1|tpl:re_engagement|conv:conv_1|ct:ct_1|deal:deal_1|slot:${dayKey}:${slot}`
  );
});
