import test from "node:test";
import assert from "node:assert/strict";
import {
  getRuntimeNotificationFeatureFlags,
  getRuntimeWebPushPublicKey,
} from "./runtime-config.ts";

function withEnv(overrides, fn) {
  const previous = new Map();

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("runtime notification flags disable web push when VAPID keys are missing", () => {
  withEnv(
    {
      WEB_PUSH_ENABLED: "true",
      NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY: undefined,
      WEB_PUSH_VAPID_PUBLIC_KEY: undefined,
      WEB_PUSH_VAPID_PRIVATE_KEY: undefined,
    },
    () => {
      const featureFlags = getRuntimeNotificationFeatureFlags();

      assert.equal(featureFlags.webPush, false);
      assert.equal(getRuntimeWebPushPublicKey(), "");
    }
  );
});

test("runtime notification flags keep web push enabled when the environment is configured", () => {
  withEnv(
    {
      WEB_PUSH_ENABLED: "true",
      WEB_PUSH_VAPID_PUBLIC_KEY: "public-key",
      WEB_PUSH_VAPID_PRIVATE_KEY: "private-key",
    },
    () => {
      const featureFlags = getRuntimeNotificationFeatureFlags();

      assert.equal(featureFlags.webPush, true);
      assert.equal(getRuntimeWebPushPublicKey(), "public-key");
    }
  );
});
