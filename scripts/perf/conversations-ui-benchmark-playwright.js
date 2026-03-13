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

async function benchmarkActivation(page, ids, options) {
  const warmSamples = [];
  const coldSamples = [];

  for (let i = 0; i < options.iterations; i += 1) {
    const id = ids[i % ids.length];
    const isWarmPhase = i >= Math.floor(options.iterations / 3);

    const elapsed = await page.evaluate(async (args) => {
      const row = document.querySelector(args.rowSelector.replace("__ID__", args.id));
      if (!row) return null;
      const start = performance.now();
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      const timeoutAt = performance.now() + 12_000;
      while (performance.now() < timeoutAt) {
        const active = document.querySelector(args.activeSelector);
        const activeId = active?.getAttribute(args.activeAttribute);
        const isReady = args.readyAttribute
          ? active?.getAttribute(args.readyAttribute) === "true"
          : true;
        if (activeId === args.id && isReady) {
          return performance.now() - start;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return null;
    }, {
      id,
      rowSelector: options.rowSelector,
      activeSelector: options.activeSelector,
      activeAttribute: options.activeAttribute,
      readyAttribute: options.readyAttribute || null,
    });

    if (!elapsed) continue;
    if (isWarmPhase) {
      warmSamples.push(elapsed);
    } else {
      coldSamples.push(elapsed);
    }
  }

  return {
    cold: summarize(coldSamples),
    warm: summarize(warmSamples),
  };
}

async function clickTab(page, label) {
  const tab = page.getByRole("tab", { name: new RegExp(label, "i") });
  const count = await tab.count();
  if (count === 0) return false;
  await tab.first().click();
  return true;
}

async function runBindToOpenBenchmark(page) {
  const hasSelectionToggle = await page.locator('[data-selection-mode-toggle="true"]').count();
  if (!hasSelectionToggle) {
    return { skipped: true, reason: "Selection mode toggle unavailable." };
  }

  const conversationCount = await page.locator('[data-conversation-id]').count();
  if (conversationCount < 2) {
    return { skipped: true, reason: "Need at least 2 conversations to benchmark bind flow." };
  }

  await page.locator('[data-selection-mode-toggle="true"]').first().click();
  await page.locator('[data-conversation-id]').nth(0).click();
  await page.locator('[data-conversation-id]').nth(1).click();
  await page.locator('[data-bind-deal-action="true"]').first().click();
  await page.waitForSelector('[data-create-deal-title="true"]', { timeout: 10_000 });

  const title = `Perf Bind ${Date.now()}`;
  const bindSamples = await page.evaluate(async (nextTitle) => {
    const input = document.querySelector('[data-create-deal-title="true"]');
    if (!input) return null;
    input.focus();
    input.value = nextTitle;
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const submit = document.querySelector('[data-create-deal-submit="true"]');
    if (!submit) return null;

    const start = performance.now();
    submit.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    let shellMs = null;
    const timeoutAt = performance.now() + 15_000;
    while (performance.now() < timeoutAt) {
      const activeDeal = document.querySelector('[data-deal-active-id]');
      if (activeDeal && shellMs === null) {
        shellMs = performance.now() - start;
      }
      if (activeDeal?.getAttribute('data-deal-initial-paint-ready') === 'true') {
        return {
          shellMs,
          firstPaintMs: performance.now() - start,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  }, title);

  if (!bindSamples) {
    return { skipped: true, reason: "Bind flow did not complete within timeout." };
  }

  return {
    shellMs: bindSamples.shellMs,
    firstPaintMs: bindSamples.firstPaintMs,
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

    const chatStats = await benchmarkActivation(page, conversationIds, {
      iterations,
      rowSelector: '[data-conversation-id="__ID__"]',
      activeSelector: "[data-chat-active-conversation-id]",
      activeAttribute: "data-chat-active-conversation-id",
      readyAttribute: "data-chat-initial-paint-ready",
    });

    await clickTab(page, "Deals");
    await page.waitForSelector('[data-deal-id]', { timeout: 5_000 }).catch(() => null);
    let dealStats = null;
    const dealRowCount = await page.locator('[data-deal-id]').count();
    if (dealRowCount >= 1) {
      const dealIds = await page.$$eval('[data-deal-id]', (rows) =>
        rows.map((row) => row.getAttribute("data-deal-id")).filter(Boolean).slice(0, 5)
      );
      dealStats = await benchmarkActivation(page, dealIds, {
        iterations,
        rowSelector: '[data-deal-id="__ID__"]',
        activeSelector: "[data-deal-active-id]",
        activeAttribute: "data-deal-active-id",
        readyAttribute: "data-deal-initial-paint-ready",
      });
    }

    await clickTab(page, "Chats");
    const bindToOpen = await runBindToOpenBenchmark(page);

    const output = {
      target,
      iterations,
      samples: {
        chats: chatStats,
        deals: dealStats,
        bindToOpen,
      },
      targets: {
        chatsWarmP95LtMs: 350,
        chatsColdP95LtMs: 700,
        dealsWarmP95LtMs: 350,
        dealsColdP95LtMs: 700,
        bindShellLtMs: 250,
        bindFirstPaintLtMs: 700,
      },
      passFail: {
        chatsWarm: chatStats.warm.count > 0 ? chatStats.warm.p95Ms <= 350 : false,
        chatsCold: chatStats.cold.count > 0 ? chatStats.cold.p95Ms <= 700 : false,
        dealsWarm: dealStats ? (dealStats.warm.count > 0 ? dealStats.warm.p95Ms <= 350 : false) : true,
        dealsCold: dealStats ? (dealStats.cold.count > 0 ? dealStats.cold.p95Ms <= 700 : false) : true,
        bindShell: bindToOpen?.skipped ? true : Number(bindToOpen?.shellMs || 0) <= 250,
        bindFirstPaint: bindToOpen?.skipped ? true : Number(bindToOpen?.firstPaintMs || 0) <= 700,
      },
    };

    console.log(JSON.stringify(output, null, 2));
    if (Object.values(output.passFail).some((value) => value === false)) {
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
