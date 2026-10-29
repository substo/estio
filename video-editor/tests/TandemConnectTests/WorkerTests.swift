import Foundation
import XCTest
@testable import TandemConnect

/// A Mac with fixed capabilities and no CLIs.
struct FakeCapabilities: CapabilitySource {
    var power: Power? = Power(source: "ac")
    var freeDiskGb: Double? = 100
    func load() async {}
    func report() async -> [String: JSONValue] {
        ["codex": CLIReadiness(installed: true).json, "hardware": ["chip": "Apple M1", "freeDiskGb": 100], "runtimes": [:], "localModels": []]
    }
    func gateInputs() async -> (power: Power?, freeDiskGb: Double?) { (power, freeDiskGb) }
    func readiness(_ provider: LocalProvider) async -> CLIReadiness { CLIReadiness() }
    func refreshReadiness() async {}
}

final class WorkerTests: XCTestCase {
    func fastOptions() -> WorkerOptions {
        var options = WorkerOptions()
        options.heartbeatInterval = 0.05
        options.pollInterval = 0.01
        options.idlePollMax = 0.02
        options.failurePollMax = 0.02
        options.leaseSeconds = 30
        return options
    }

    func state(paused: Bool = false, commands: [JSONValue] = [], version: Int = 0) -> JSONValue {
        ["processingEnabled": true, "paused": .bool(paused), "config": ["version": .number(Double(version)), "value": LocalMacTests.defaultConfig],
         "commands": .array(commands)]
    }

    func makeWorker(_ site: FakeSite, options: WorkerOptions, handlers: [String: JobHandler]? = nil,
                commands: ((@escaping @Sendable (CommandStatus) async -> Bool) -> ProviderCommands.Dependencies)? = nil,
                events: Recorder<WorkerEvent> = Recorder()) -> ConnectionWorker {
        ConnectionWorker(client: site.client(), token: fixtureToken, deviceId: fixtureId, release: "studio-mac-0.1.0", options: options,
                         capabilities: FakeCapabilities(), handlers: handlers, commandDependencies: commands, processId: 42,
                         random: { 0.5 }, events: { events.add($0) })
    }

    func testItHeartbeatsClaimsADiagnosticCompletesWithTheLeaseTokenAndDrains() async throws {
        let claims = Counter()
        let site = FakeSite { request in
            switch request.operation {
            case "heartbeat": return envelope(self.state())
            case "claim": return envelope(claims.next() == 1 ? [fixtureJob()] : [])
            case "complete": return envelope(true)
            default: return envelope(true)
            }
        }
        let events = Recorder<WorkerEvent>()
        let worker = makeWorker(site, options: fastOptions(), events: events)
        XCTAssertEqual(worker.workerId, "mac:\(fixtureId):42")
        await worker.start()
        let completed = await eventually { site.requests.contains { $0.operation == "complete" } }
        XCTAssertTrue(completed)
        await worker.stop()

        let sent = site.requests
        let first = try XCTUnwrap(sent.first)
        XCTAssertEqual(first.operation, "heartbeat")
        let report = try XCTUnwrap(first.body?["report"]?.object)
        XCTAssertEqual(report["platform"], "darwin")
        XCTAssertEqual(report["version"], "studio-mac-0.1.0")
        XCTAssertEqual(report["handlers"], ["studio.diagnostic"])
        XCTAssertEqual(report["draining"], false)
        XCTAssertNotNil(report["hardware"])
        XCTAssertNotNil(report["codex"])
        XCTAssertEqual(first.body?["release"], "studio-mac-0.1.0")
        XCTAssertEqual(first.body?["workerId"], .string("mac:\(fixtureId):42"))

        let complete = try XCTUnwrap(sent.first { $0.operation == "complete" })
        XCTAssertEqual(complete.body?["leaseToken"], .string(fixtureId))
        XCTAssertEqual(complete.body?["result"]?["ok"], true)
        XCTAssertEqual(complete.body?["result"]?["workerId"], .string("mac:\(fixtureId):42"))

        let last = try XCTUnwrap(sent.last)
        XCTAssertEqual(last.operation, "heartbeat", "the drain is the last thing sent")
        XCTAssertEqual(last.body?["report"]?["draining"], true)
        XCTAssertEqual(last.body?["report"]?["healthy"], false)
        XCTAssertTrue(sent.dropLast().contains { $0.operation == "heartbeat" && $0.body?["report"]?["healthy"] == true }, "healthy once claims work")
        let logged = events.all.compactMap { if case .log(let fields) = $0 { return fields["event"] }; return nil }
        XCTAssertTrue(logged.contains("job_succeeded"))
        XCTAssertTrue(logged.contains("worker_draining"))
        XCTAssertFalse(events.all.description.contains(fixtureToken), "the key is never logged")
    }

    func testHeartbeatOnlyNeverClaimsOrRunsCommands() async throws {
        let site = FakeSite { request in
            request.operation == "heartbeat"
                ? envelope(self.state(commands: [["id": .string(fixtureId), "kind": "provider_login", "provider": "codex"]]))
                : envelope([fixtureJob()])
        }
        var options = fastOptions()
        options.heartbeatOnly = true
        let ran = Flag()
        let worker = makeWorker(site, options: options, commands: { post in
            ProviderCommands.Dependencies(post: post, readiness: { _ in CLIReadiness() }, login: { _ in ran.set(); return .exited }, run: { _ in ran.set(); return ProcessOutput(stdout: "", stderr: "") })
        })
        await worker.start()
        let several = await eventually { site.requests.filter { $0.operation == "heartbeat" }.count >= 3 }
        XCTAssertTrue(several)
        await worker.stop()
        XCTAssertEqual(Set(site.requests.map(\.operation)), ["heartbeat"], "heartbeats only")
        XCTAssertFalse(ran.isSet)
        let snapshot = await worker.currentSnapshot
        XCTAssertTrue(snapshot.heartbeatOnly)
    }

    func testPausedInSettingsClaimsNothingAndAckIsSent() async throws {
        let site = FakeSite { request in
            request.operation == "heartbeat" ? envelope(self.state(paused: true, version: 3)) : envelope([fixtureJob()])
        }
        let worker = makeWorker(site, options: fastOptions())
        await worker.start()
        let acked = await eventually { site.requests.contains { $0.body?["configAck"]?["version"] == 3 } }
        XCTAssertTrue(acked, "the setup is acknowledged promptly")
        try await Task.sleep(nanoseconds: 100_000_000)
        await worker.stop()
        XCTAssertFalse(site.requests.contains { $0.operation == "claim" })
        let snapshot = await worker.currentSnapshot
        XCTAssertEqual(ConnectionStatus.from(snapshot), .paused)
    }

    func testARefusedKeyShowsRevokedAndNeverClaims() async {
        let site = FakeSite { _ in json(["ok": false, "error": "Access denied."], status: 403) }
        let worker = makeWorker(site, options: fastOptions())
        await worker.start()
        let refused = await eventually { await worker.currentSnapshot.link == .refused }
        XCTAssertTrue(refused)
        await worker.stop()
        XCTAssertFalse(site.requests.contains { $0.operation == "claim" })
        let snapshot = await worker.currentSnapshot
        XCTAssertEqual(ConnectionStatus.from(snapshot), .revoked)
    }

    func testNoNetworkShowsOffline() async {
        let site = FakeSite { _ in throw URLError(.notConnectedToInternet) }
        let worker = makeWorker(site, options: fastOptions())
        await worker.start()
        let offline = await eventually { await worker.currentSnapshot.link == .offline }
        XCTAssertTrue(offline)
        await worker.stop()
    }

    func testSleepStopsClaimsAndWakeResumesThem() async throws {
        let site = FakeSite { request in request.operation == "heartbeat" ? envelope(self.state()) : envelope([]) }
        let worker = makeWorker(site, options: fastOptions())
        await worker.suspend()
        await worker.start()
        try await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertFalse(site.requests.contains { $0.operation == "claim" }, "asleep")
        let asleep = await worker.currentSnapshot
        XCTAssertEqual(ConnectionStatus.from(asleep), .sleeping)
        await worker.resume()
        let claimed = await eventually { site.requests.contains { $0.operation == "claim" } }
        XCTAssertTrue(claimed)
        await worker.stop()
    }

    func testAFailingHandlerReportsAClassifiedFailureAndALostLeaseRecordsNothing() async throws {
        let claims = Counter()
        let site = FakeSite { request in
            switch request.operation {
            case "heartbeat": return envelope(self.state())
            case "claim": return envelope(claims.next() == 1 ? [fixtureJob()] : [])
            case "fail": return envelope("failed")
            default: return envelope(true)
            }
        }
        let worker = makeWorker(site, options: fastOptions(), handlers: ["studio.diagnostic": { _, _ in
            throw JobError("invalid_diagnostic", "Choose a supported provider and model.", retryable: false)
        }])
        await worker.start()
        let failed = await eventually { site.requests.contains { $0.operation == "fail" } }
        XCTAssertTrue(failed)
        await worker.stop()
        let fail = try XCTUnwrap(site.requests.first { $0.operation == "fail" })
        XCTAssertEqual(fail.body?["failure"], ["code": "invalid_diagnostic", "message": "Choose a supported provider and model.", "retryable": false])
        XCTAssertEqual(fail.body?["leaseToken"], .string(fixtureId))

        // A lease that already ran out: the handler's result is never saved.
        let lateClaims = Counter()
        let expired = FakeSite { request in
            switch request.operation {
            case "heartbeat": return envelope(self.state())
            case "claim": return envelope(lateClaims.next() == 1 ? [fixtureJob(leaseExpires: Date().addingTimeInterval(-1))] : [])
            default: return envelope(true)
            }
        }
        let events = Recorder<WorkerEvent>()
        let late = makeWorker(expired, options: fastOptions(), events: events)
        await late.start()
        let lost = await eventually { events.all.contains { if case .log(let f) = $0 { return f["event"] == "job_lease_lost" }; return false } }
        XCTAssertTrue(lost)
        await late.stop()
        XCTAssertFalse(expired.requests.contains { $0.operation == "complete" || $0.operation == "fail" })
    }

    func testTheLeaseIsExtendedWhileAJobRunsAndAFailedRenewalAbortsIt() async throws {
        let claims = Counter()
        let site = FakeSite { request in
            switch request.operation {
            case "heartbeat": return envelope(self.state())
            case "claim": return envelope(claims.next() == 1 ? [fixtureJob()] : [])
            case "extend": return envelope(false)
            default: return envelope(true)
            }
        }
        var options = fastOptions()
        options.leaseSeconds = 10 // renewals every max(1, 10/3) seconds
        let cancelled = Flag()
        let worker = makeWorker(site, options: options, handlers: ["studio.diagnostic": { _, _ in
            while !Task.isCancelled { try? await Task.sleep(nanoseconds: 10_000_000) }
            cancelled.set()
            throw JobError("cli_cancelled", "stopped", retryable: true)
        }])
        await worker.start()
        let aborted = await eventually(10) { cancelled.isSet }
        XCTAssertTrue(aborted, "the server said the lease is gone")
        await worker.stop()
        let extend = try XCTUnwrap(site.requests.first { $0.operation == "extend" })
        XCTAssertEqual(extend.body, ["jobId": .string(fixtureId), "workerId": .string("mac:\(fixtureId):42"), "leaseSeconds": 10, "leaseToken": .string(fixtureId)])
        XCTAssertFalse(site.requests.contains { $0.operation == "complete" || $0.operation == "fail" }, "a lost lease reports nothing")
    }

    func testSignInCommandsArriveWithHeartbeatsAndRunOnce() async throws {
        let command: JSONValue = ["id": .string(fixtureId), "kind": "provider_logout", "provider": "claude"]
        let site = FakeSite { request in
            request.operation == "heartbeat" ? envelope(self.state(commands: [command])) : envelope(request.operation == "claim" ? [] : true)
        }
        let runs = Recorder<[String]>()
        let worker = makeWorker(site, options: fastOptions(), commands: { post in
            ProviderCommands.Dependencies(post: post, readiness: { _ in CLIReadiness() },
                                          run: { request in runs.add([request.command] + request.args); return ProcessOutput(stdout: "", stderr: "") })
        })
        await worker.start()
        let done = await eventually { site.requests.contains { $0.operation == "command" && $0.body?["status"] == "succeeded" } }
        XCTAssertTrue(done)
        try await Task.sleep(nanoseconds: 150_000_000)
        await worker.stop()
        XCTAssertEqual(runs.all, [["claude", "auth", "logout"]], "once, though every heartbeat lists it")
        let posts = site.requests.filter { $0.operation == "command" }.map { $0.body?["status"]?.string ?? "" }
        XCTAssertEqual(posts, ["running", "succeeded"])
    }

    func testConnectionsSerializeCommandsForTheSameMachineProvider() async throws {
        let command: JSONValue = ["id": .string(fixtureId), "kind": "provider_logout", "provider": "claude"]
        func site() -> FakeSite {
            FakeSite { request in
                request.operation == "heartbeat" ? envelope(self.state(commands: [command])) : envelope(request.operation == "claim" ? [] : true)
            }
        }
        let firstSite = site(), secondSite = site()
        let runs = Recorder<String>()
        let release = Flag()
        let dependencies: (@escaping @Sendable (CommandStatus) async -> Bool) -> ProviderCommands.Dependencies = { post in
            ProviderCommands.Dependencies(post: post, readiness: { _ in CLIReadiness() }, run: { request in
                runs.add(request.command)
                while !release.isSet && !Task.isCancelled { try? await Task.sleep(nanoseconds: 10_000_000) }
                return ProcessOutput(stdout: "", stderr: "")
            })
        }
        let first = makeWorker(firstSite, options: fastOptions(), commands: dependencies)
        let second = makeWorker(secondSite, options: fastOptions(), commands: dependencies)
        await first.start()
        let started = await eventually { runs.all.count == 1 }
        XCTAssertTrue(started)
        await second.start()
        try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertEqual(runs.all.count, 1, "both sites use the same local Claude account; the second command must wait")
        XCTAssertFalse(secondSite.requests.contains { $0.operation == "command" }, "a waiting command has not started on the server")
        release.set()
        let resumed = await eventually { secondSite.requests.contains { $0.operation == "command" && $0.body?["status"] == "succeeded" } }
        XCTAssertTrue(resumed, "the second connection retries after the first releases the provider")
        await first.stop()
        await second.stop()
        XCTAssertEqual(runs.all, ["claude", "claude"])
    }

    func testPollDelayBacksOffWithJitter() {
        XCTAssertEqual(pollDelay(0, minimum: 5, maximum: 60, random: { 0 }), 2.5)
        XCTAssertEqual(pollDelay(0, minimum: 5, maximum: 60, random: { 1 }), 5)
        XCTAssertEqual(pollDelay(3, minimum: 5, maximum: 60, random: { 1 }), 40)
        XCTAssertEqual(pollDelay(10, minimum: 5, maximum: 60, random: { 1 }), 60)
        XCTAssertEqual(pollDelay(-1, minimum: 5, maximum: 60, random: { 1 }), 5)
    }
}
