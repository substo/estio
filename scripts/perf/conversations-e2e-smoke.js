#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

async function timedFetch(url, options) {
  const start = Date.now();
  const res = await fetch(url, options);
  const elapsedMs = Date.now() - start;
  const body = await res.text();
  return { res, elapsedMs, body };
}

function pickLocation(headerValue) {
  const loc = String(headerValue || "");
  if (!loc) return null;
  try {
    return new URL(loc, "https://placeholder.local").pathname;
  } catch {
    return loc;
  }
}

async function main() {
  const cwd = process.cwd();
  loadEnvFile(path.join(cwd, ".env"));
  loadEnvFile(path.join(cwd, ".env.local"));

  const baseUrl = String(process.env.PERF_BASE_URL || "https://estio.co").replace(/\/+$/, "");
  const authCookie = String(process.env.PERF_AUTH_COOKIE || "").trim();
  const target = `${baseUrl}/admin/conversations`;

  const commonHeaders = {
    "user-agent": "idx-rollout-e2e-smoke/1.0",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };
  if (authCookie) {
    commonHeaders.cookie = authCookie;
  }

  const first = await timedFetch(target, {
    method: "GET",
    redirect: "manual",
    headers: commonHeaders,
  });

  const status = first.res.status;
  const location = pickLocation(first.res.headers.get("location"));
  const isRedirect = status >= 300 && status < 400;
  const redirectedToAuth =
    isRedirect && !!location && /sign-in|sso|clerk/i.test(location);

  if (redirectedToAuth && !authCookie) {
    console.log(
      JSON.stringify(
        {
          success: false,
          reason: "AUTH_REQUIRED",
          baseUrl,
          target,
          firstRequest: {
            status,
            elapsedMs: first.elapsedMs,
            location,
          },
          hint:
            "Set PERF_AUTH_COOKIE with a valid logged-in cookie string to run authenticated conversations smoke validation.",
        },
        null,
        2
      )
    );
    process.exit(2);
  }

  let second = null;
  if (isRedirect && location) {
    second = await timedFetch(`${baseUrl}${location}`, {
      method: "GET",
      redirect: "manual",
      headers: commonHeaders,
    });
  }

  const effective = second || first;
  const body = effective.body || "";
  const bodyLower = body.toLowerCase();
  const likelyConversationsPage =
    bodyLower.includes("conversations") ||
    bodyLower.includes("select a conversation") ||
    bodyLower.includes("no conversations found");

  const result = {
    success: likelyConversationsPage || (redirectedToAuth && !!authCookie),
    baseUrl,
    target,
    firstRequest: {
      status,
      elapsedMs: first.elapsedMs,
      location,
    },
    secondRequest: second
      ? {
          status: second.res.status,
          elapsedMs: second.elapsedMs,
          location: pickLocation(second.res.headers.get("location")),
        }
      : null,
    checks: {
      likelyConversationsPage,
      authRedirectDetected: redirectedToAuth,
    },
    notes: [
      "This is an HTTP smoke check for rollout readiness, not a browser DOM interaction test.",
      "Use a Playwright/Puppeteer authenticated suite later for full interaction E2E coverage.",
    ],
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exit(1);
}

main().catch((error) => {
  console.error("[conversations-e2e-smoke] failed:", error?.message || error);
  process.exit(1);
});
