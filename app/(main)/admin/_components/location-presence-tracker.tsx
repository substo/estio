"use client";

import { useEffect } from "react";

const PRESENCE_INTERVAL_MS = 5 * 60 * 1000;
let lastSentAt = 0;

function sendPresence() {
  if (document.visibilityState !== "visible") return;
  const now = Date.now();
  if (now - lastSentAt < PRESENCE_INTERVAL_MS) return;
  lastSentAt = now;
  void fetch("/api/admin/location-session-activity", {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => undefined);
}

export function LocationPresenceTracker() {
  useEffect(() => {
    sendPresence();
    const intervalId = window.setInterval(sendPresence, PRESENCE_INTERVAL_MS);
    document.addEventListener("visibilitychange", sendPresence);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", sendPresence);
    };
  }, []);

  return null;
}
