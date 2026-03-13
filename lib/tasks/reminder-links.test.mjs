import test from "node:test";
import assert from "node:assert/strict";
import { buildTaskReminderDeepLink } from "./reminder-links.ts";

test("buildTaskReminderDeepLink includes the task selection and related conversation", () => {
  const href = buildTaskReminderDeepLink({
    taskId: "task_123",
    conversationId: "conv_456",
  });

  assert.equal(href, "/admin/conversations?view=tasks&task=task_123&id=conv_456");
});

test("buildTaskReminderDeepLink omits the conversation when unavailable", () => {
  const href = buildTaskReminderDeepLink({
    taskId: "task_only",
  });

  assert.equal(href, "/admin/conversations?view=tasks&task=task_only");
});
