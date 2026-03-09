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

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[idx];
}

function summarize(samplesMs) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const total = sorted.reduce((acc, value) => acc + value, 0);
  return {
    count: sorted.length,
    minMs: sorted[0] || 0,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    maxMs: sorted[sorted.length - 1] || 0,
    avgMs: sorted.length ? total / sorted.length : 0,
  };
}

async function main() {
  const cwd = process.cwd();
  loadEnvFile(path.join(cwd, ".env"));
  loadEnvFile(path.join(cwd, ".env.local"));

  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error("Playwright is not installed. Install with `npm i -D playwright` and run again.");
  }

  const baseUrl = String(process.env.PERF_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
  const authCookie = String(process.env.PERF_AUTH_COOKIE || "").trim();
  const iterations = Math.max(6, Number(process.env.PERF_UI_ITERATIONS || 18));
  const target = `${baseUrl}/admin/conversations`;

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    if (authCookie) {
      const cookieParts = authCookie.split(";").map((part) => part.trim()).filter(Boolean);
      for (const pair of cookieParts) {
        const idx = pair.indexOf("=");
        if (idx <= 0) continue;
        await context.addCookies([{
          name: pair.slice(0, idx).trim(),
          value: pair.slice(idx + 1).trim(),
          url: baseUrl,
          path: "/",
        }]);
      }
    }

    const page = await context.newPage();
    await page.goto(target, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-conversation-id]', { timeout: 20_000 });

    const conversationIds = await page.$$eval('[data-conversation-id]', (rows) =>
      rows.map((row) => row.getAttribute("data-conversation-id")).filter(Boolean).slice(0, 5)
    );
    if (!conversationIds || conversationIds.length < 2) {
      throw new Error("Need at least 2 conversation rows to run switch benchmark.");
    }

    const warmSamples = [];
    const coldSamples = [];

    for (let i = 0; i < iterations; i += 1) {
      const id = conversationIds[i % conversationIds.length];
      const isWarmPhase = i >= Math.floor(iterations / 3);

      const elapsed = await page.evaluate(async (conversationId) => {
        const row = document.querySelector(`[data-conversation-id="${conversationId}"]`);
        if (!row) return null;
        const start = performance.now();
        row.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        const timeoutAt = performance.now() + 12_000;
        while (performance.now() < timeoutAt) {
          const active = document.querySelector("[data-chat-active-conversation-id]");
          const activeId = active?.getAttribute("data-chat-active-conversation-id");
          if (activeId === conversationId) {
            return performance.now() - start;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return null;
      }, id);

      if (!elapsed) continue;
      if (isWarmPhase) {
        warmSamples.push(elapsed);
      } else {
        coldSamples.push(elapsed);
      }
    }

    const warmStats = summarize(warmSamples);
    const coldStats = summarize(coldSamples);
    const output = {
      target,
      iterations,
      samples: {
        cold: coldStats,
        warm: warmStats,
      },
      targets: {
        warmP95LtMs: 350,
        coldP95LtMs: 700,
      },
      passFail: {
        warm: warmStats.count > 0 ? warmStats.p95Ms <= 350 : false,
        cold: coldStats.count > 0 ? coldStats.p95Ms <= 700 : false,
      },
    };

    console.log(JSON.stringify(output, null, 2));
    if (!output.passFail.warm || !output.passFail.cold) {
      process.exit(1);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[conversations-ui-benchmark-playwright] failed:", error?.message || error);
  process.exit(1);
});
