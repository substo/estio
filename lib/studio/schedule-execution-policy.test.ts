import { test } from "node:test";
import assert from "node:assert/strict";
import { readScheduleRunCommand } from "./schedule-execution-policy";
const command = { action: "run_now", scheduleId: "AA100000-0000-4000-8000-000000000001", version: 2,
  requestId: "AA500000-0000-4000-8000-000000000001", ideas: [{ id: "AA200000-0000-4000-8000-000000000001", version: 4 }], confirmPaid: true };
test("schedule commands bind a saved version, canonical selection and explicit paid consent", () => {
  const result = readScheduleRunCommand(command);
  assert.equal(result.scheduleId, command.scheduleId.toLowerCase());
  assert.equal(result.requestId, command.requestId.toLowerCase());
  assert.deepEqual(result.ideas, [{ id: command.ideas[0].id.toLowerCase(), version: 4 }]);
  assert.equal(result.version, 2);
  assert.equal(result.confirmPaid, true);
});
test("unsaved, malformed, stale-shaped, unconfirmed and unbounded commands are rejected", () => {
  for (const patch of [{ action: "enable" }, { scheduleId: "bad" }, { version: 0 }, { version: 1.5 }, { version: "2" },
    { confirmPaid: false }, { requestId: "bad" }, { ideas: [] }, { ideas: Array(6).fill(command.ideas[0]) },
    { ideas: [command.ideas[0], command.ideas[0]] }, { ideas: [{ ...command.ideas[0], version: 0 }] }]) {
    assert.throws(() => readScheduleRunCommand({ ...command, ...patch }));
  }
});
test("posted focus cannot override the authoritative saved definition", () => {
  assert.equal(Object.hasOwn(readScheduleRunCommand({ ...command, focus: "Injected replacement focus" }), "focus"), false);
});

test("recurring activation requires its own consent and optimistic activation version", async () => {
  const { readScheduleCommand } = await import("./schedule-execution-policy");
  const enable = { ...command, action: "enable", stateVersion: 0, confirmRecurringPaid: true };
  assert.equal(readScheduleCommand(enable).action, "enable");
  for (const patch of [{ confirmRecurringPaid: undefined }, { confirmRecurringPaid: false }, { stateVersion: -1 }, { stateVersion: 1.2 }, { stateVersion: "0" }, { ideas: [] }]) {
    assert.throws(() => readScheduleCommand({ ...enable, ...patch }));
  }
  const pause = readScheduleCommand({ ...enable, action: "pause", ideas: undefined, confirmRecurringPaid: false });
  assert.equal(pause.action, "pause"); assert.deepEqual(pause.ideas, []);
  assert.equal(readScheduleCommand(command).action, "run_now");
});
