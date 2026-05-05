import test from "node:test";
import assert from "node:assert/strict";
import {
    buildProviderSyncAlerts,
    sumStatusCounts,
    truncateError,
} from "./provider-sync-dashboard";

test("buildProviderSyncAlerts promotes dead-letter work to critical", () => {
    const alerts = buildProviderSyncAlerts({
        deadJobs: 2,
        failedJobs: 0,
        disabledJobs: 0,
        staleRecords: 0,
        staleLocks: 0,
    });

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].level, "critical");
    assert.match(alerts[0].title, /Dead-letter/);
});

test("buildProviderSyncAlerts reports stale locks and stale aliases", () => {
    const alerts = buildProviderSyncAlerts({
        deadJobs: 0,
        failedJobs: 0,
        disabledJobs: 0,
        staleRecords: 3,
        staleLocks: 1,
    });

    assert.equal(alerts.length, 2);
    assert.deepEqual(alerts.map((alert) => alert.level), ["warning", "warning"]);
    assert.equal(alerts.some((alert) => alert.title.includes("locks")), true);
    assert.equal(alerts.some((alert) => alert.title.includes("aliases")), true);
});

test("dashboard helpers summarize and trim operational data", () => {
    assert.equal(
        sumStatusCounts(
            [
                { status: "failed", count: 3 },
                { status: "dead", count: 1 },
                { status: "completed", count: 20 },
            ],
            ["failed", "dead"]
        ),
        4
    );

    assert.equal(truncateError("short error", 20), "short error");
    assert.equal(truncateError("a ".repeat(40), 12), "a a a a a a…");
});
