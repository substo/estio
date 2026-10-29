import Foundation
import XCTest
@testable import TandemConnect

/// The companion's slice-2 cases: Keychain migration, discovery, setup and
/// the local gate, CLI readiness, diagnostics and sign-in commands.
final class LocalMacTests: XCTestCase {
    // MARK: Adopting the Node companion's pairing

    func writeCompanionConfig(_ dir: URL, _ value: JSONValue, mode: mode_t = 0o600) throws {
        let file = dir.appendingPathComponent("config.json")
        try value.data().write(to: file)
        chmod(file.path, mode)
    }

    func testAVersion1FileKeyMovesIntoKeychainAndOutOfTheFile() throws {
        let dir = temporaryDirectory("companion")
        defer { try? FileManager.default.removeItem(at: dir) }
        try writeCompanionConfig(dir, ["version": 1, "origin": .string(fixtureOrigin), "token": .string(fixtureToken), "name": "Test Mac", "deviceId": .string(fixtureId)])
        let store = MemoryTokenStore()
        let pairing = try XCTUnwrap(CompanionAdoption.read(directory: dir))
        XCTAssertEqual(CompanionAdoption.offer(directory: dir, connections: ConnectionsFile(), store: store), pairing, "offered though Keychain is empty: the key is in the file")
        let adopted = try CompanionAdoption.adopt(pairing, directory: dir, store: store)
        XCTAssertEqual(adopted.token, fixtureToken)
        XCTAssertEqual(adopted.connection, Connection(origin: fixtureOrigin, name: "Test Mac", deviceId: fixtureId, businessName: nil))
        XCTAssertEqual(store.all, [fixtureOrigin: fixtureToken])
        let text = try String(contentsOf: dir.appendingPathComponent("config.json"), encoding: .utf8)
        XCTAssertFalse(text.contains("studio_device_"))
        XCTAssertEqual(try CompanionAdoption.read(directory: dir)?.legacyToken, nil, "now a version 2 file")

        // A Keychain failure leaves the key in the file, so nothing is lost.
        try writeCompanionConfig(dir, ["version": 1, "origin": .string(fixtureOrigin), "token": .string(fixtureToken), "name": "Test Mac", "deviceId": .string(fixtureId)])
        let failing = MemoryTokenStore()
        failing.failWrites = true
        XCTAssertThrowsError(try CompanionAdoption.adopt(try XCTUnwrap(CompanionAdoption.read(directory: dir)), directory: dir, store: failing))
        XCTAssertTrue(try String(contentsOf: dir.appendingPathComponent("config.json"), encoding: .utf8).contains(fixtureToken))
    }

    func testAVersion2PairingIsOfferedOnlyWithAKeyAndNoConnectionAndReadOnlyWhenChosen() throws {
        let dir = temporaryDirectory("companion")
        defer { try? FileManager.default.removeItem(at: dir) }
        try writeCompanionConfig(dir, ["version": 2, "origin": "https://substo.com", "name": "Martin Mac", "deviceId": .string(fixtureId)])
        let store = MemoryTokenStore()
        XCTAssertNil(CompanionAdoption.offer(directory: dir, connections: ConnectionsFile(), store: store), "no key in Keychain")
        try store.save(origin: "https://substo.com", token: fixtureToken)
        store.promptingOrigins = ["https://substo.com"]
        let offer = try XCTUnwrap(CompanionAdoption.offer(directory: dir, connections: ConnectionsFile(), store: store))
        XCTAssertEqual(offer.origin, "https://substo.com")
        XCTAssertThrowsError(try store.read(origin: "https://substo.com", allowPrompt: false), "a launch never asks")
        XCTAssertEqual(try CompanionAdoption.adopt(offer, directory: dir, store: store).token, fixtureToken, "the owner's choice may ask")
        var connected = ConnectionsFile()
        connected.upsert(Connection(origin: "https://substo.com", name: "x", deviceId: fixtureId, businessName: nil))
        XCTAssertNil(CompanionAdoption.offer(directory: dir, connections: connected, store: store), "already connected")
        XCTAssertTrue(FileManager.default.fileExists(atPath: dir.appendingPathComponent("config.json").path), "the Node file stays")

        try store.remove(origin: "https://substo.com")
        XCTAssertThrowsError(try CompanionAdoption.adopt(offer, directory: dir, store: store)) { error in
            XCTAssertEqual((error as? ConnectError)?.code, "device_token_missing")
        }
    }

    func testUnsafeOrUnexpectedCompanionFilesAreRefused() throws {
        let dir = temporaryDirectory("companion")
        defer { try? FileManager.default.removeItem(at: dir) }
        try writeCompanionConfig(dir, ["version": 2, "origin": "https://substo.com", "name": "Mac", "deviceId": .string(fixtureId)], mode: 0o644)
        XCTAssertThrowsError(try CompanionAdoption.read(directory: dir))
        try writeCompanionConfig(dir, ["version": 2, "origin": "https://substo.com", "name": "Mac", "deviceId": .string(fixtureId), "extra": true])
        XCTAssertThrowsError(try CompanionAdoption.read(directory: dir))
        try writeCompanionConfig(dir, ["version": 2, "origin": "http://substo.com", "name": "Mac", "deviceId": .string(fixtureId)])
        XCTAssertThrowsError(try CompanionAdoption.read(directory: dir))
        chmod(dir.path, 0o755)
        XCTAssertThrowsError(try CompanionAdoption.read(directory: dir), "the folder must be private too")
        XCTAssertNil(try CompanionAdoption.read(directory: dir.appendingPathComponent("missing")))
    }

    func testTheMemoryStoreChecksKeys() throws {
        let store = MemoryTokenStore()
        XCTAssertThrowsError(try store.save(origin: fixtureOrigin, token: "studio_device_short"))
        XCTAssertThrowsError(try store.save(origin: fixtureOrigin, token: "\(fixtureToken)\ndelete-keychain x"))
        try store.save(origin: fixtureOrigin, token: fixtureToken)
        XCTAssertEqual(try store.read(origin: fixtureOrigin, allowPrompt: false), fixtureToken)
        try store.remove(origin: fixtureOrigin)
        XCTAssertNil(try store.read(origin: fixtureOrigin, allowPrompt: false))
        XCTAssertEqual(KeychainTokenStore.service, "com.estio.studio-companion.device-token", "shared with the Node companion")
    }

    // MARK: Discovery

    /// Real outputs captured on the target Mac (MacBook Air M1, macOS 15.7.9),
    /// display serial and IDs left out, from companion.test.ts.
    enum RealMac {
        static let brand = "Apple M1\n", memsize = "8589934592\n", swVers = "15.7.9\n"
        static let df = "Filesystem   1024-blocks      Used Available Capacity iused     ifree %iused  Mounted on\n/dev/disk3s5   482797652 383062872  58669448    87% 4316074 586694480    1%   /System/Volumes/Data\n"
        static let pmsetAc = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=7798883)\t100%; charged; 0:00 remaining present: true\n"
        static let pmsetBattery = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=7798883)\t64%; discharging; 5:12 remaining present: true\n"
        static let displays = #"{"SPDisplaysDataType":[{"_name":"kHW_AppleM1Item","spdisplays_mtlgpufamilysupport":"spdisplays_metal3","sppci_cores":"8","sppci_model":"Apple M1","spdisplays_ndrvs":[{"_name":"Color LCD","_spdisplays_display-serial-number":"omitted"}]}]}"#
        static let ollama = "Warning: could not connect to a running Ollama instance\nWarning: client version is 0.40.5\n"
        static let python = "Python 3.11.3\n", ffmpeg = "ffmpeg version 7.1.1 Copyright (c) 2000-2025 the FFmpeg developers\n"
    }

    func testRealMacOutputParsesIntoWhitelistedMetadataOnly() async {
        XCTAssertEqual(MacDiscovery.parseMemoryGb(RealMac.memsize), 8)
        XCTAssertEqual(MacDiscovery.parseOsVersion(RealMac.swVers), "15.7.9")
        XCTAssertEqual(MacDiscovery.parseDf(RealMac.df).freeDiskGb, 60.1)
        XCTAssertEqual(MacDiscovery.parseDf(RealMac.df).totalDiskGb, 494.4)
        XCTAssertEqual(MacDiscovery.parsePmset(RealMac.pmsetAc), Power(source: "ac", batteryPercent: 100))
        XCTAssertEqual(MacDiscovery.parsePmset(RealMac.pmsetBattery), Power(source: "battery", batteryPercent: 64))
        XCTAssertEqual(MacDiscovery.parsePmset("Now drawing from 'AC Power'\n"), Power(source: "ac"))
        XCTAssertEqual(MacDiscovery.parseGpu(RealMac.displays), "apple-metal")
        XCTAssertEqual(MacDiscovery.parseGpu("not json"), "unknown")
        XCTAssertEqual(MacDiscovery.versionOf(RealMac.ollama), "0.40.5")
        XCTAssertEqual(MacDiscovery.versionOf(RealMac.ffmpeg), "7.1.1")
        XCTAssertEqual(MacDiscovery.versionOf(RealMac.python), "3.11.3")
        let calls = Recorder<ProcessRequest>()
        let run: ProcessRunner = { request in
            calls.add(request)
            let key = ([request.command] + request.args).joined(separator: " ")
            let out: String? = key.contains("brand_string") ? RealMac.brand : key.contains("memsize") ? RealMac.memsize : key.contains("sw_vers") ? RealMac.swVers
                : key.contains("/bin/df") ? RealMac.df : key.contains("pmset") ? RealMac.pmsetAc : key.contains("system_profiler") ? RealMac.displays
                : key == "ollama --version" ? RealMac.ollama : key == "python3 --version" ? RealMac.python : key == "ffmpeg -version" ? RealMac.ffmpeg : nil
            guard let out else { throw ProcessFailure.unavailable }
            return ProcessOutput(stdout: out, stderr: "")
        }
        var hardware = await MacDiscovery.hardware(run: run, home: "/Users/fixture")
        hardware.timeZone = "x"
        XCTAssertEqual(hardware, Hardware(chip: "Apple M1", arch: MacDiscovery.arch, osVersion: "15.7.9", memoryGb: 8, gpu: "apple-metal",
                                          freeDiskGb: 60.1, totalDiskGb: 494.4, power: Power(source: "ac", batteryPercent: 100), timeZone: "x"))
        XCTAssertFalse(hardware.json.text.contains("omitted"))
        XCTAssertTrue(calls.all.allSatisfy { !$0.command.contains(" ") }, "never a shell line")
        XCTAssertTrue(calls.all.contains { $0.command == "/bin/df" && $0.args == ["-k", "/Users/fixture"] })
        let runtimes = await MacDiscovery.runtimes(run: run)
        XCTAssertEqual(runtimes, ["ollama": "0.40.5", "python": "3.11.3", "ffmpeg": "7.1.1"])
    }

    func testLocalModelDiscoveryReturnsSafeNamesOnly() throws {
        let home = temporaryDirectory("models")
        defer { try? FileManager.default.removeItem(at: home) }
        let fm = FileManager.default
        func dir(_ path: String) throws { try fm.createDirectory(at: home.appendingPathComponent(path), withIntermediateDirectories: true) }
        try dir(".ollama/models/manifests/registry.ollama.ai/library/llama3.2")
        fm.createFile(atPath: home.appendingPathComponent(".ollama/models/manifests/registry.ollama.ai/library/llama3.2/3b").path, contents: Data("{}".utf8))
        try dir(".ollama/models/manifests/registry.ollama.ai/acme/tiny")
        fm.createFile(atPath: home.appendingPathComponent(".ollama/models/manifests/registry.ollama.ai/acme/tiny/latest").path, contents: Data("{}".utf8))
        try dir(".lmstudio/models/lmstudio-community/Qwen2.5-7B-GGUF")
        try dir(".lmstudio/models/bad publisher/$(rm -rf)")
        try dir(".cache/huggingface/hub/models--mlx-community--whisper-large-v3-turbo")
        try dir(".cache/huggingface/hub/models--adefossez--HTDemucs")
        XCTAssertEqual(MacDiscovery.localModels(home: home.path, environment: [:]),
                       ["acme/tiny:latest", "llama3.2:3b", "lmstudio-community/Qwen2.5-7B-GGUF", "mlx-community/whisper-large-v3-turbo"])
    }

    // MARK: Setup from Settings and the local gate

    static var savedConfig: JSONValue {
        ["features": ["transcription": true, "text": false], "languages": ["en"], "translationTargets": [], "preference": "balanced",
         "textProvider": nil, "textModel": nil,
         "resources": ["modelBudgetGb": 20, "minFreeDiskGb": 30, "allowOnBattery": false, "maxConcurrentJobs": 1, "launchAtLogin": true, "workingHours": nil]]
    }

    static var defaultConfig: JSONValue {
        var value = savedConfig.object!
        value["features"] = ["transcription": false, "text": false]
        value["resources"] = ["modelBudgetGb": 20, "minFreeDiskGb": 20, "allowOnBattery": false, "maxConcurrentJobs": 1, "launchAtLogin": false, "workingHours": nil]
        return .object(value)
    }

    func testTheSetupIsValidatedAndAcknowledgedWithUnsupportedReasons() {
        XCTAssertEqual(applyDesiredConfig(version: 3, value: Self.savedConfig, launchAtLogin: false).ack,
                       ConfigAck(version: 3, status: .applied, unsupported: ["resources.launchAtLogin": UnsupportedReason.launchAtLogin,
                                                                             "features.transcription": UnsupportedReason.localWorkflow]))
        XCTAssertEqual(applyDesiredConfig(version: 3, value: Self.savedConfig, launchAtLogin: true).ack.unsupported,
                       ["features.transcription": UnsupportedReason.localWorkflow], "the app is a login item, so that setting is honoured")
        XCTAssertEqual(applyDesiredConfig(version: 4, value: Self.defaultConfig, launchAtLogin: false).ack, ConfigAck(version: 4, status: .applied))
        var extra = Self.savedConfig.object!
        extra["extra"] = true
        let bad = applyDesiredConfig(version: 5, value: .object(extra), launchAtLogin: false)
        XCTAssertNil(bad.config)
        XCTAssertEqual(bad.ack.status, .error)
        XCTAssertLessThanOrEqual(bad.ack.error?.count ?? 999, 300)

        var languages = Self.defaultConfig.object!
        languages["languages"] = ["en-us", "EN-US", "zh-hant-tw"]
        XCTAssertEqual(try DeviceConfig.read(.object(languages)).languages, ["en-US", "zh-Hant-TW"])
        var hours = Self.defaultConfig.object!
        var resources = hours["resources"]!.object!
        resources["workingHours"] = ["start": "09:00", "end": "09:00", "timeZone": "Asia/Nicosia"]
        hours["resources"] = .object(resources)
        XCTAssertThrowsError(try DeviceConfig.read(.object(hours)), "start and end must differ")

        let settings = DeviceSettings()
        func state(_ version: Int, _ value: JSONValue = Self.savedConfig) -> HeartbeatState {
            HeartbeatState(processingEnabled: true, paused: false, configVersion: version, configValue: value, commands: [])
        }
        XCTAssertFalse(settings.update(state(0, [:])))
        XCTAssertNil(settings.pendingAck)
        XCTAssertTrue(settings.update(state(2)))
        XCTAssertEqual(settings.pendingAck?.version, 2)
        XCTAssertEqual(settings.config.minFreeDiskGb, 30)
        XCTAssertFalse(settings.update(state(2)))
        XCTAssertFalse(settings.update(state(2), sentAck: ConfigAck(version: 2, status: .applied)))
        XCTAssertNil(settings.pendingAck)
        XCTAssertTrue(settings.update(state(3, ["nope": 1])))
        XCTAssertEqual(settings.pendingAck?.status, .error)
        XCTAssertEqual(settings.config.minFreeDiskGb, 30, "an invalid setup keeps the last good one")
        XCTAssertFalse(settings.update(nil))

        // Turning the login item on acknowledges the same version again.
        var loginItem = false
        let local = DeviceSettings(launchAtLogin: { loginItem })
        local.update(state(7))
        XCTAssertNotNil(local.pendingAck?.unsupported?["resources.launchAtLogin"])
        local.update(state(7), sentAck: local.pendingAck)
        loginItem = true
        XCTAssertTrue(local.reapply())
        XCTAssertEqual(local.pendingAck?.version, 7)
        XCTAssertNil(local.pendingAck?.unsupported?["resources.launchAtLogin"])
    }

    func testTheLocalGatePausesEverythingButBatteryHoursDiskAndConsentOnlyStopProcessing() {
        var config = DeviceConfig()
        config.minFreeDiskGb = 20
        let ac = Power(source: "ac")
        XCTAssertEqual(localGate(processingEnabled: true, paused: false, config: config, power: ac, freeDiskGb: 60), LocalGate(diagnostics: true, processing: true, reasons: []))
        XCTAssertEqual(localGate(processingEnabled: true, paused: true, config: config, power: ac, freeDiskGb: 60), LocalGate(diagnostics: false, processing: false, reasons: ["paused"]))
        XCTAssertEqual(localGate(processingEnabled: false, paused: false, config: config, power: ac, freeDiskGb: 60).reasons, ["processing_disabled"])
        XCTAssertEqual(localGate(processingEnabled: true, paused: false, config: config, power: Power(source: "battery"), freeDiskGb: 60),
                       LocalGate(diagnostics: true, processing: false, reasons: ["on_battery_or_unknown_power"]))
        var battery = config
        battery.allowOnBattery = true
        XCTAssertTrue(localGate(processingEnabled: true, paused: false, config: battery, power: Power(source: "battery"), freeDiskGb: 60).processing)
        XCTAssertEqual(localGate(processingEnabled: true, paused: false, config: config, power: ac, freeDiskGb: 10).reasons, ["low_disk_space"])
        XCTAssertEqual(localGate(processingEnabled: true, paused: false, config: config, power: ac, freeDiskGb: nil).reasons, ["low_disk_space"])
        let hours = DeviceConfig.WorkingHours(start: "09:00", end: "17:00", timeZone: "Asia/Nicosia")
        let noon = Check.date("2026-10-26T10:00:00Z")!, night = Check.date("2026-10-26T21:00:00Z")!
        XCTAssertTrue(withinWorkingHours(hours, now: noon))
        XCTAssertFalse(withinWorkingHours(hours, now: night))
        XCTAssertTrue(withinWorkingHours(DeviceConfig.WorkingHours(start: "22:00", end: "06:00", timeZone: "Asia/Nicosia"), now: night))
        var working = config
        working.workingHours = hours
        XCTAssertEqual(localGate(processingEnabled: true, paused: false, config: working, power: ac, freeDiskGb: 60, now: night).reasons, ["outside_working_hours"])
    }

    // MARK: CLIs

    func fixture(_ provider: LocalProvider, final: JSONValue? = nil) -> (Recorder<ProcessRequest>, LocalTextAdapter) {
        let calls = Recorder<ProcessRequest>()
        let run: ProcessRunner = { request in
            calls.add(request)
            if request.args.first == "--version" { return ProcessOutput(stdout: "1.2.3", stderr: "") }
            if request.args.contains("--help") {
                return ProcessOutput(stdout: "--ignore-user-config --ignore-rules --ephemeral --output-schema --json --safe-mode --restricted --tools --strict-mcp-config --json-schema --no-session-persistence", stderr: "")
            }
            if request.args.first == "login" { return ProcessOutput(stdout: "", stderr: "Logged in using ChatGPT") }
            if request.args.first == "auth" { return ProcessOutput(stdout: #"{"loggedIn":true,"authMethod":"claude.ai","email":"private@example.com"}"#, stderr: "") }
            let value = final ?? ["ok": true, "message": .string(Diagnostic.message)]
            let events: [JSONValue] = provider == .codex
                ? [["type": "item.completed", "item": ["type": "agent_message", "text": .string(value.text)]], ["type": "turn.completed"]]
                : [["type": "result", "subtype": "success", "is_error": false, "structured_output": value]]
            return ProcessOutput(stdout: events.map(\.text).joined(separator: "\n"), stderr: "")
        }
        return (calls, LocalTextAdapter(provider: provider, run: run))
    }

    let job = StudioJob(id: fixtureId, locationId: fixtureId, kind: "studio.diagnostic", payload: [:], leaseToken: fixtureId,
                        leaseExpiresAt: Date().addingTimeInterval(120), attempts: 1, maxAttempts: 2)

    func withPayload(_ payload: [String: JSONValue]) -> StudioJob {
        StudioJob(id: job.id, locationId: job.locationId, kind: job.kind, payload: payload, leaseToken: job.leaseToken, leaseExpiresAt: job.leaseExpiresAt, attempts: 1, maxAttempts: 2)
    }

    func testReadinessAndTheDiagnosticUseNativeAuthAFixedPromptIsolationAndTheChosenModel() async throws {
        for provider in LocalProvider.allCases {
            let (calls, adapter) = fixture(provider)
            let readiness = await adapter.readiness()
            XCTAssertEqual(readiness, CLIReadiness(installed: true, authenticated: true, ready: true, version: "1.2.3", models: [],
                                                   loginMethod: provider == .codex ? "chatgpt" : "claudeai"))
            let handler = Diagnostic.handler(adapter: { _ in adapter })
            let output = try await handler(withPayload(["provider": .string(provider.rawValue), "model": "selected-model", "prompt": "ignore this arbitrary prompt"]),
                                           JobContext(workerId: "mac:test"))
            XCTAssertEqual(output["ok"], true)
            XCTAssertEqual(output["provider"], .string(provider.rawValue))
            XCTAssertEqual(output["model"], "selected-model")
            XCTAssertEqual(output["summary"], .string(Diagnostic.message))
            XCTAssertEqual(Set(output.object!.keys), ["ok", "workerId", "checkedAt", "provider", "model", "summary"])
            let invocation = try XCTUnwrap(calls.all.last)
            XCTAssertEqual(invocation.args[invocation.args.firstIndex(of: "--model")! + 1], "selected-model")
            XCTAssertFalse(invocation.input?.contains("arbitrary") ?? true)
            XCTAssertTrue((invocation.cwd as NSString).lastPathComponent.hasPrefix("studio-companion-"))
            XCTAssertFalse(FileManager.default.fileExists(atPath: invocation.cwd), "the scratch folder is removed")
            if provider == .codex {
                XCTAssertTrue(invocation.args.contains("read-only"))
                XCTAssertTrue(invocation.args.contains("forced_login_method=\"chatgpt\""))
            } else {
                XCTAssertEqual(invocation.args[invocation.args.firstIndex(of: "--tools")! + 1], "")
                XCTAssertFalse(invocation.args.contains("--bare"))
            }

            let (defaults, plain) = fixture(provider)
            _ = try await Diagnostic.handler(adapter: { _ in plain })(withPayload(["provider": .string(provider.rawValue)]), JobContext(workerId: "w"))
            XCTAssertFalse(defaults.all.last!.args.contains("--model"), "the CLI's own default model")
            let (_, bad) = fixture(provider, final: ["ok": true, "message": "unexpected"])
            do {
                _ = try await Diagnostic.handler(adapter: { _ in bad })(withPayload(["provider": .string(provider.rawValue)]), JobContext(workerId: "w"))
                XCTFail("an unexpected answer fails")
            } catch {
                XCTAssertTrue((error as? JobError)?.message.contains("local provider check") == true)
            }
        }
    }

    func testThePlainDiagnosticRunsNoCLIAndBadProvidersOrModelsFailClosed() async throws {
        let handler = Diagnostic.handler(adapter: { _ in XCTFail("no CLI"); return LocalTextAdapter(provider: .codex) { _ in throw ProcessFailure.failed } })
        let output = try await handler(job, JobContext(workerId: "mac:test"))
        XCTAssertEqual(output["ok"], true)
        XCTAssertEqual(output["workerId"], "mac:test")
        for payload: [String: JSONValue] in [["provider": "other"], ["provider": "codex", "model": "--flag"], ["model": "missing-provider"], ["provider": nil]] {
            do {
                _ = try await handler(withPayload(payload), JobContext(workerId: "w"))
                XCTFail("\(payload)")
            } catch {
                XCTAssertEqual((error as? JobError)?.code, "invalid_diagnostic")
                XCTAssertEqual((error as? JobError)?.retryable, false)
            }
        }
    }

    func testAPIKeyLoginsAndOldCLIsCanNeverRunInference() async {
        for provider in LocalProvider.allCases {
            let generated = Flag()
            let adapter = LocalTextAdapter(provider: provider) { request in
                if request.args.first == "--version" { return ProcessOutput(stdout: "1.2.3", stderr: "") }
                if request.args.contains("--help") { return ProcessOutput(stdout: "unsupported old CLI", stderr: "") }
                if request.args.first == "login" { return ProcessOutput(stdout: "Logged in using API key", stderr: "") }
                if request.args.first == "auth" { return ProcessOutput(stdout: #"{"loggedIn":true,"authMethod":"api_key"}"#, stderr: "") }
                generated.set()
                throw ProcessFailure.failed
            }
            let readiness = await adapter.readiness()
            XCTAssertFalse(readiness.ready)
            XCTAssertEqual(readiness.loginMethod, "api_key")
            await assertThrowsCode("provider_not_ready") { try await adapter.generate(TextRequest(model: nil, prompt: "fixed", jsonSchema: [:]), validate: { $0 }) }
            XCTAssertFalse(generated.isSet)
        }
    }

    func testTheChildEnvironmentKeepsNoAPIEndpointStudioOrInjectedValues() {
        let env = nativeLoginEnvironment(["NODE_ENV": "test", "HOME": "/home/test", "PATH": "/bin", "CODEX_HOME": "/native/auth", "ANTHROPIC_API_KEY": "secret",
                                          "OPENAI_API_KEY": "secret", "OPENAI_BASE_URL": "https://other", "ANTHROPIC_BASE_URL": "https://other",
                                          "CLAUDE_CODE_OAUTH_TOKEN": "secret", "STUDIO_DEVICE_TOKEN": fixtureToken, "NODE_OPTIONS": "--require evil",
                                          "AWS_ACCESS_KEY_ID": "secret"], home: "/home/test")
        XCTAssertEqual(Set(env.keys), ["NODE_ENV", "HOME", "PATH", "CODEX_HOME", "NO_COLOR"])
        XCTAssertEqual(env["NODE_ENV"], "production")
        XCTAssertFalse(env.values.contains("secret"))
        let path = env["PATH"]!.split(separator: ":").map(String.init)
        XCTAssertEqual(path.first, "/bin", "the inherited PATH first")
        XCTAssertTrue(path.contains("/home/test/.local/bin") && path.contains("/opt/homebrew/bin"), "plus where CLIs are usually installed")
    }

    func testNativeProcessesAreBoundedInTimeAndOutputAndStopWhenCancelled() async throws {
        let echoed = try await runNativeProcess(ProcessRequest(command: "/bin/cat", args: [], input: "fixture"))
        XCTAssertEqual(echoed, ProcessOutput(stdout: "fixture", stderr: ""))
        do { _ = try await runNativeProcess(ProcessRequest(command: "/bin/sleep", args: ["5"], timeout: 0.1)); XCTFail() } catch {
            XCTAssertEqual(error as? ProcessFailure, .timeout)
        }
        do { _ = try await runNativeProcess(ProcessRequest(command: "/usr/bin/head", args: ["-c", "4096", "/dev/zero"], maxOutputBytes: 100)); XCTFail() } catch {
            XCTAssertEqual(error as? ProcessFailure, .outputLimit)
        }
        do { _ = try await runNativeProcess(ProcessRequest(command: "/usr/bin/false", args: [])); XCTFail() } catch {
            XCTAssertEqual(error as? ProcessFailure, .failed)
        }
        do { _ = try await runNativeProcess(ProcessRequest(command: "definitely-not-a-cli-xyz", args: [])); XCTFail() } catch {
            XCTAssertEqual(error as? ProcessFailure, .unavailable)
        }
        let started = Date()
        let pending = Task { try await runNativeProcess(ProcessRequest(command: "/bin/sleep", args: ["5"])) }
        try await Task.sleep(nanoseconds: 100_000_000)
        pending.cancel()
        do { _ = try await pending.value; XCTFail() } catch {
            XCTAssertEqual(error as? ProcessFailure, .cancelled)
        }
        XCTAssertLessThan(Date().timeIntervalSince(started), 3)
    }

    func testAChildGetsDefaultSignalHandlingEvenThoughTheAppIgnoresSIGTERM() async throws {
        let previous = signal(SIGTERM, SIG_IGN)
        defer { signal(SIGTERM, previous) }
        let started = Date()
        do { _ = try await runNativeProcess(ProcessRequest(command: "/bin/sleep", args: ["5"], timeout: 0.1)); XCTFail() } catch {}
        XCTAssertLessThan(Date().timeIntervalSince(started), 2, "SIGTERM stopped it, rather than the SIGKILL fallback or the sleep ending")
    }

    // MARK: Sign-in commands

    static let codexDeviceOutput = "\u{1b}[1mWelcome to Codex\u{1b}[0m\n\nFollow these steps to sign in with ChatGPT using device code authorization:\n\n1. Open this link in your browser and sign in to your account\n   \u{1b}[94mhttps://auth.openai.com/codex/device\u{1b}[0m\n\n2. Enter this one-time code \u{1b}[90m(expires in 15 minutes)\u{1b}[0m\n   \u{1b}[94mQ7RM-4KXD\u{1b}[0m\n\n\u{1b}[90mDevice codes are a common phishing target. Never share this code.\u{1b}[0m\n"
    static let claudeLoginOutput = "Opening browser to sign in…\nIf the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=abc&response_type=code&state=xyz\nPaste code here if prompted > "

    func testLoginOutputKeepsOnlyAnAllowedLinkAndTheDeviceCode() {
        func parse(_ text: String) -> [String] { let p = ProviderCommands.parseLoginOutput(text); return [p.verificationUrl ?? "-", p.userCode ?? "-"] }
        XCTAssertEqual(parse(Self.codexDeviceOutput), ["https://auth.openai.com/codex/device", "Q7RM-4KXD"])
        XCTAssertEqual(parse(Self.claudeLoginOutput), ["https://claude.com/cai/oauth/authorize?code=true&client_id=abc&response_type=code&state=xyz", "-"])
        XCTAssertEqual(parse("visit https://evil.example/codex/device then http://auth.openai.com/x\nCODE ABCD-EFGH"), ["-", "ABCD-EFGH"])
        XCTAssertEqual(parse("Go to https://user:pw@auth.openai.com/device."), ["-", "-"])
        XCTAssertEqual(parse("See https://auth.openai.com/codex/device."), ["https://auth.openai.com/codex/device", "-"])
    }

    static func ready(_ authenticated: Bool, _ method: String? = nil) -> CLIReadiness {
        CLIReadiness(installed: true, authenticated: authenticated, ready: authenticated, models: [], loginMethod: method)
    }

    func testLoginPostsRunningTheParsedDisplayThenRechecksStatus() async {
        let posts = Recorder<CommandStatus>()
        let runs = Recorder<[String]>()
        let command = ProviderCommand(id: fixtureId, kind: .login, provider: .codex)
        let status = await ProviderCommands.execute(command, ProviderCommands.Dependencies(
            post: { posts.add($0); return true }, readiness: { _ in Self.ready(true, "chatgpt") },
            login: { request in
                runs.add([request.command] + request.args)
                XCTAssertEqual(request.timeout, 15 * 60)
                request.onDisplay(LoginDisplay(verificationUrl: "https://auth.openai.com/codex/device", userCode: "Q7RM-4KXD"))
                try? await Task.sleep(nanoseconds: 50_000_000)
                return .exited
            }))
        XCTAssertEqual(status, .succeeded)
        XCTAssertEqual(runs.all, [["codex", "login", "--device-auth"]])
        XCTAssertEqual(posts.all, [CommandStatus(commandId: fixtureId, status: .running),
                                   CommandStatus(commandId: fixtureId, status: .waitingForUser, display: LoginDisplay(verificationUrl: "https://auth.openai.com/codex/device", userCode: "Q7RM-4KXD")),
                                   CommandStatus(commandId: fixtureId, status: .succeeded)])

        let claudeRuns = Recorder<[String]>()
        let timeout = await ProviderCommands.execute(ProviderCommand(id: fixtureId, kind: .login, provider: .claude), ProviderCommands.Dependencies(
            post: { posts.add($0); return true }, readiness: { _ in Self.ready(false) },
            login: { request in claudeRuns.add([request.command] + request.args); return .timeout }))
        XCTAssertEqual(timeout, .failed)
        XCTAssertEqual(claudeRuns.all, [["claude", "auth", "login", "--claudeai"]])
        XCTAssertEqual(posts.all.last, CommandStatus(commandId: fixtureId, status: .failed, error: "Sign-in timed out after 15 minutes."))

        let apiKey = await ProviderCommands.execute(ProviderCommand(id: fixtureId, kind: .login, provider: .claude), ProviderCommands.Dependencies(
            post: { _ in true }, readiness: { _ in Self.ready(false, "api_key") }, login: { _ in .exited }))
        XCTAssertEqual(apiKey, .failed)
    }

    func testLoginStopsWhenTheServerSaysTheCommandWasCancelled() async {
        let aborted = Flag()
        let status = await ProviderCommands.execute(ProviderCommand(id: fixtureId, kind: .login, provider: .codex), ProviderCommands.Dependencies(
            post: { $0.status != .waitingForUser }, readiness: { _ in Self.ready(false) },
            login: { request in
                request.onDisplay(LoginDisplay(verificationUrl: "https://auth.openai.com/codex/device"))
                while !Task.isCancelled { try? await Task.sleep(nanoseconds: 5_000_000) }
                aborted.set()
                return .cancelled
            }, keepAlive: 0.005))
        XCTAssertEqual(status, .failed)
        XCTAssertTrue(aborted.isSet)
    }

    func testLogoutRunsTheCLIsOwnSignOutAndSucceedsOnlyWhenSignedOut() async {
        let runs = Recorder<[String]>()
        let posts = Recorder<CommandStatus>()
        let run: ProcessRunner = { request in runs.add([request.command] + request.args); return ProcessOutput(stdout: "secret account text", stderr: "") }
        let out = await ProviderCommands.execute(ProviderCommand(id: fixtureId, kind: .logout, provider: .claude), ProviderCommands.Dependencies(
            post: { posts.add($0); return true }, readiness: { _ in Self.ready(false) }, run: run))
        XCTAssertEqual(out, .succeeded)
        XCTAssertEqual(runs.all, [["claude", "auth", "logout"]])
        let still = await ProviderCommands.execute(ProviderCommand(id: fixtureId, kind: .logout, provider: .codex), ProviderCommands.Dependencies(
            post: { posts.add($0); return true }, readiness: { _ in Self.ready(true, "chatgpt") }, run: run))
        XCTAssertEqual(still, .failed)
        XCTAssertEqual(runs.all.last, ["codex", "logout"])
        XCTAssertFalse("\(posts.all)".contains("secret"))
    }

    func testTheLoginRunnerStreamsOnlyTheParsedDisplayAndTimesOut() async throws {
        let displays = Recorder<LoginDisplay>()
        let script = (NSTemporaryDirectory() as NSString).appendingPathComponent("login-\(UUID().uuidString).txt")
        try Self.codexDeviceOutput.write(toFile: script, atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(atPath: script) }
        // cat prints the fixture, then waits on stdin, which stays open.
        let outcome = await ProviderCommands.runLoginProcess(ProviderCommands.LoginRequest(command: "/bin/cat", args: [script, "-"], timeout: 0.5) { displays.add($0) })
        XCTAssertEqual(outcome, .timeout)
        XCTAssertEqual(displays.all, [LoginDisplay(verificationUrl: "https://auth.openai.com/codex/device", userCode: "Q7RM-4KXD")])
        let exited = await ProviderCommands.runLoginProcess(ProviderCommands.LoginRequest(command: "/usr/bin/true", args: [], timeout: 5) { _ in })
        XCTAssertEqual(exited, .exited)
        let missing = await ProviderCommands.runLoginProcess(ProviderCommands.LoginRequest(command: "definitely-not-a-cli-xyz", args: [], timeout: 5) { _ in })
        XCTAssertEqual(missing, .failed)
    }
}

final class Recorder<T: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var items: [T] = []
    func add(_ item: T) { lock.withLock { items.append(item) } }
    var all: [T] { lock.withLock { items } }
}
