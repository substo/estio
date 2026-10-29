import Foundation
import XCTest
@testable import TandemConnect

/// The Node companion's HTTP, config and pairing cases (companion.test.ts).
final class DeviceProtocolTests: XCTestCase {
    func testOriginsAreHTTPSOrThisMacOnlyWithNoCredentialBearingParts() throws {
        XCTAssertEqual(try AppOrigin.validate("https://studio.example/"), "https://studio.example")
        XCTAssertEqual(try AppOrigin.validate("http://127.0.0.1:8080"), "http://127.0.0.1:8080")
        XCTAssertEqual(try AppOrigin.validate("http://localhost:3000"), "http://localhost:3000")
        XCTAssertEqual(try AppOrigin.validate("https://Estio.co:443"), "https://estio.co")
        for origin in ["http://studio.example", "https://u:p@studio.example", "https://studio.example/path", "https://studio.example/?token=a",
                       "https://studio.example/#a", "file:///tmp/a", "studio.example"] {
            XCTAssertThrowsError(try AppOrigin.validate(origin), origin)
        }
    }

    func testTheConnectionsFileIsPrivateRoundTripsAndRefusesPermissiveOrSymlinkFiles() throws {
        let dir = temporaryDirectory("connections").appendingPathComponent("Connections")
        defer { try? FileManager.default.removeItem(at: dir.deletingLastPathComponent()) }
        let store = ConnectionStore(directory: dir)
        XCTAssertEqual(try store.load(), ConnectionsFile(), "nothing saved yet")
        var file = ConnectionsFile()
        let brand = BrandCache(app: "estio", name: "Estio", iconURL: "https://estio.co/i.png", icon: Data([1, 2, 3]), fetchedAt: Date(timeIntervalSince1970: 1_000))
        file.upsert(Connection(origin: "https://estio.co", name: "Mac", deviceId: fixtureId, businessName: "Acme", brand: brand))
        file.upsert(Connection(origin: "https://substo.com", name: "Mac", deviceId: fixtureId, businessName: nil))
        XCTAssertEqual(file.active, "https://estio.co", "the first connection becomes active")
        file.upsert(Connection(origin: "https://estio.co", name: "Mac 2", deviceId: fixtureId, businessName: "Acme"))
        XCTAssertEqual(file.connections.count, 2, "one connection per site")
        file.setActive("https://substo.com")
        file.connections[0].brand = brand
        try store.save(file)
        let attributes = try FileManager.default.attributesOfItem(atPath: store.fileURL.path)
        XCTAssertEqual((attributes[.posixPermissions] as? NSNumber)?.intValue, 0o600)
        let folder = try FileManager.default.attributesOfItem(atPath: dir.path)
        XCTAssertEqual((folder[.posixPermissions] as? NSNumber)?.intValue, 0o700)
        XCTAssertEqual(try store.load(), file)
        XCTAssertFalse(try String(contentsOf: store.fileURL, encoding: .utf8).contains("studio_device_"), "never a key")

        chmod(store.fileURL.path, 0o644)
        XCTAssertThrowsError(try store.load())
        try FileManager.default.removeItem(at: store.fileURL)
        try FileManager.default.createSymbolicLink(atPath: store.fileURL.path, withDestinationPath: "/etc/passwd")
        XCTAssertThrowsError(try store.load())

        file.remove("https://substo.com")
        XCTAssertEqual(file.active, "https://estio.co", "removing the active one picks another")
    }

    func testHTTPUsesTheExactOutboundContract() async throws {
        let site = FakeSite { request in
            switch request.operation {
            case "claim": return envelope([fixtureJob()])
            case "heartbeat": return envelope(nil)
            case "fail": return envelope("retry_scheduled")
            default: return envelope(true)
            }
        }
        let client = site.client()
        let state = try await client.heartbeat(token: fixtureToken, workerId: "mac:test", release: nil, startedAt: Date(timeIntervalSince1970: 0),
                                               report: ["codex": ["installed": true, "models": []]], configAck: nil)
        XCTAssertNil(state, "an older server's null still works")
        let jobs = try await client.claim(token: fixtureToken, workerId: "mac:test", limit: 1, leaseSeconds: 120)
        XCTAssertEqual(jobs.map(\.id), [fixtureId])
        XCTAssertEqual(jobs.first?.leaseToken, fixtureId)
        let extended = try await client.extend(token: fixtureToken, jobId: fixtureId, workerId: "mac:test", leaseSeconds: 120, leaseToken: fixtureId)
        let completed = try await client.complete(token: fixtureToken, jobId: fixtureId, workerId: "mac:test", result: ["ok": true], leaseToken: fixtureId)
        let failed = try await client.fail(token: fixtureToken, jobId: fixtureId, workerId: "mac:test",
                                           failure: JobFailure(code: "cli_failed", message: "safe", retryable: true), leaseToken: fixtureId)
        XCTAssertTrue(extended)
        XCTAssertTrue(completed)
        XCTAssertEqual(failed, "retry_scheduled")

        let sent = site.requests
        XCTAssertEqual(sent.map(\.url), ["heartbeat", "claim", "extend", "complete", "fail"].map { "\(fixtureOrigin)/api/studio/device/\($0)" })
        XCTAssertTrue(sent.allSatisfy { $0.method == "POST" && $0.headers["Authorization"] == "Bearer \(fixtureToken)" && $0.headers["Content-Type"] == "application/json" })
        XCTAssertEqual(sent[0].body, ["workerId": "mac:test", "release": nil, "startedAt": "1970-01-01T00:00:00.000Z",
                                      "report": ["codex": ["installed": true, "models": []]]])
        XCTAssertEqual(sent[1].body, ["workerId": "mac:test", "limit": 1, "leaseSeconds": 120])
        XCTAssertEqual(sent[2].body, ["jobId": .string(fixtureId), "workerId": "mac:test", "leaseSeconds": 120, "leaseToken": .string(fixtureId)])
        XCTAssertEqual(sent[4].body?["failure"], ["code": "cli_failed", "message": "safe", "retryable": true])
    }

    func testCanonicalLocationIdsAndPostgresTimestampsAreAccepted() async throws {
        var job = fixtureJob().object!
        job["location_id"] = "cmvntrnxm0001a4die51ayr85"
        job["lease_expires_at"] = "2026-10-28T23:00:00.123456+00:00"
        let site = FakeSite { _ in envelope([.object(job)]) }
        let claimed = try await site.client().claim(token: fixtureToken, workerId: "w", limit: 1, leaseSeconds: 120)
        XCTAssertEqual(claimed.first?.locationId, "cmvntrnxm0001a4die51ayr85")
        XCTAssertEqual(claimed.first?.leaseExpiresAt?.timeIntervalSince1970 ?? 0, 1_793_228_400.123, accuracy: 0.01)
    }

    func testHTTPRejectsBadEnvelopesClaimsAndOversizedBodiesWithoutReflectingSecrets() async {
        var badLease = fixtureJob().object!
        badLease["lease_token"] = "wrong"
        var otherKind = fixtureJob().object!
        otherKind["kind"] = "studio.script_brief"
        let responses: [HTTPResponse] = [
            envelope([:]), envelope([.object(badLease)]), envelope([.object(otherKind)]),
            json(["ok": false, "error": .string(fixtureToken)], status: 200),
            HTTPResponse(status: 200, contentType: "application/json", body: Data(repeating: 0x61, count: 300_000)),
            HTTPResponse(status: 200, contentType: "text/html", body: try! JSONValue.object(["ok": true, "data": []]).data()),
            json(["ok": false, "error": .string(fixtureToken)], status: 500),
        ]
        for response in responses {
            let site = FakeSite { _ in response }
            do {
                _ = try await site.client().claim(token: fixtureToken, workerId: "mac:test", limit: 1, leaseSeconds: 120)
                XCTFail("should fail")
            } catch {
                XCTAssertEqual((error as? ConnectError)?.code, "device_claim_failed")
                XCTAssertFalse("\(error)".contains(fixtureToken))
            }
        }
    }

    func testARevokedKeyIsToldApartFromANetworkFailure() async {
        for (status, refused) in [(401, true), (403, true), (503, false), (429, false)] {
            let site = FakeSite { _ in json(["ok": false, "error": "Access denied."], status: status) }
            do {
                _ = try await site.client().heartbeat(token: fixtureToken, workerId: "w", release: nil, startedAt: Date(), report: [:], configAck: nil)
                XCTFail("should fail")
            } catch {
                let error = error as? ConnectError
                XCTAssertEqual(error?.code, "device_heartbeat_failed")
                XCTAssertEqual(error?.httpStatus, status)
                XCTAssertEqual(error?.isRefusedDevice, refused)
            }
        }
        let offline = FakeSite { _ in throw URLError(.notConnectedToInternet) }
        do {
            _ = try await offline.client().heartbeat(token: fixtureToken, workerId: "w", release: nil, startedAt: Date(), report: [:], configAck: nil)
        } catch {
            XCTAssertEqual((error as? ConnectError)?.isRefusedDevice, false)
        }
    }

    func testAMalformedKeyIsNeverSent() async {
        let site = FakeSite { _ in envelope([]) }
        await assertThrowsCode("device_claim_failed") { try await site.client().claim(token: "studio_device_short", workerId: "w", limit: 1, leaseSeconds: 120) }
        XCTAssertTrue(site.requests.isEmpty)
    }

    func testHeartbeatSendsTheAckAndReturnsDeviceState() async throws {
        let response: JSONValue = ["processingEnabled": false, "paused": true, "config": ["version": 1, "value": [:]],
                                   "commands": [["id": .string(fixtureId), "kind": "provider_login", "provider": "codex"]]]
        let site = FakeSite { _ in envelope(response) }
        let ack = ConfigAck(version: 1, status: .applied)
        let state = try await site.client().heartbeat(token: fixtureToken, workerId: "w", release: "r", startedAt: Date(), report: [:], configAck: ack)
        XCTAssertEqual(site.requests[0].body?["configAck"], ["version": 1, "status": "applied"])
        XCTAssertEqual(state, HeartbeatState(processingEnabled: false, paused: true, configVersion: 1, configValue: [:],
                                             commands: [ProviderCommand(id: fixtureId, kind: .login, provider: .codex)]))
        var shell = response.object!
        shell["commands"] = [["id": .string(fixtureId), "kind": "shell", "provider": "codex"]]
        let bad = FakeSite { _ in envelope(.object(shell)) }
        await assertThrowsCode("device_heartbeat_failed") {
            try await bad.client().heartbeat(token: fixtureToken, workerId: "w", release: nil, startedAt: Date(), report: [:], configAck: nil)
        }
    }

    func testCommandStatusUsesTheBearerKeyAndUnderstandsCancellation() async throws {
        for (data, open) in [(JSONValue.bool(true), true), (["status": "cancelled"], false), (.bool(false), false), (nil, true), (["status": "running"], true)] {
            let site = FakeSite { request in
                XCTAssertTrue(request.url.hasSuffix("/api/studio/device/command"))
                XCTAssertEqual(request.headers["Authorization"], "Bearer \(fixtureToken)")
                return envelope(data)
            }
            let result = try await site.client().command(token: fixtureToken, workerId: "mac:test", status: CommandStatus(commandId: fixtureId, status: .running))
            XCTAssertEqual(result, open)
            XCTAssertEqual(site.requests[0].body, ["workerId": "mac:test", "commandId": .string(fixtureId), "status": "running"])
        }
    }

    // MARK: The real URLSession transport

    func testTheTransportRefusesRedirectsCapsBodiesAndTimesOut() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubProtocol.self]
        let transport = URLSessionTransport(configuration: configuration)
        let client = try DeviceClient(origin: "https://stub.example", transport: transport)

        StubProtocol.mode = .redirect
        await assertThrowsCode("device_claim_failed") { try await client.claim(token: fixtureToken, workerId: "w", limit: 1, leaseSeconds: 120) }
        XCTAssertEqual(StubProtocol.followed, false, "the redirect's target was never asked for")

        StubProtocol.mode = .large
        do {
            _ = try await transport.send(URLRequest(url: URL(string: "https://stub.example/x")!), timeout: 5, maxBytes: 1024)
            XCTFail("too large")
        } catch {}

        StubProtocol.mode = .hang
        let started = Date()
        do {
            _ = try await transport.send(URLRequest(url: URL(string: "https://stub.example/x")!), timeout: 0.3, maxBytes: 1024)
            XCTFail("should time out")
        } catch {}
        XCTAssertLessThan(Date().timeIntervalSince(started), 3)

        StubProtocol.mode = .ok
        let response = try await transport.send(URLRequest(url: URL(string: "https://stub.example/x")!), timeout: 5, maxBytes: 1024)
        XCTAssertEqual(response.status, 200)
        XCTAssertEqual(response.contentType, "application/json")
    }

    // MARK: Pairing

    func testPairingOpensOnlyTheSitesApprovalPagePollsAndStoresTheKey() async throws {
        let polls = Counter()
        let site = FakeSite { request in
            XCTAssertNil(request.headers["Authorization"])
            if request.url.hasSuffix("/pair/start") {
                return envelope(["pairingId": .string(fixtureId), "deviceCode": .string(String(repeating: "d", count: 43)), "userCode": "ABCD-EF23",
                                 "verificationUrl": .string("\(fixtureOrigin)/studio/settings/computer?code=ABCD-EF23"),
                                 "expiresAt": .string(Check.isoString(Date().addingTimeInterval(600))), "intervalSeconds": 5])
            }
            XCTAssertEqual(request.body, ["pairingId": .string(fixtureId), "deviceCode": .string(String(repeating: "d", count: 43))])
            switch polls.next() {
            case 1: return json(["ok": false, "error": "slow down"], status: 429)
            case 2: return envelope(["status": "pending"])
            default: return envelope(["status": "approved", "token": .string(fixtureToken), "deviceId": .string(fixtureId), "businessName": "Acme\u{1b}[31m Ltd"])
            }
        }
        let client = site.client()
        let store = MemoryTokenStore()
        let started = try await Pairing.begin(client: client, name: "Test Mac")
        XCTAssertEqual(site.requests[0].body, ["name": "Test Mac", "platform": "darwin"])
        XCTAssertEqual(started.approvalURL.absoluteString, "\(fixtureOrigin)/studio/settings/computer?code=ABCD-EF23")
        XCTAssertEqual(started.userCode, "ABCD-EF23")
        let (connection, token) = try await Pairing.waitForApproval(started, client: client, name: "Test Mac", store: store, sleep: { _ in })
        XCTAssertEqual(token, fixtureToken)
        XCTAssertEqual(connection, Connection(origin: fixtureOrigin, name: "Test Mac", deviceId: fixtureId, businessName: "Acme31m Ltd"))
        XCTAssertEqual(store.all, [fixtureOrigin: fixtureToken])
    }

    func testPairingRefusesForeignApprovalLinksAndReportsDenialAndExpiry() async throws {
        func start(_ link: String) -> HTTPResponse {
            envelope(["pairingId": .string(fixtureId), "deviceCode": .string(String(repeating: "d", count: 43)), "userCode": "ABCD-EF23",
                      "verificationUrl": .string(link), "expiresAt": .string(Check.isoString(Date().addingTimeInterval(600))), "intervalSeconds": 5])
        }
        for link in ["https://evil.example/studio/settings/computer?code=ABCD-EF23", "\(fixtureOrigin)/elsewhere", "https://u:p@studio.example/studio/settings/computer"] {
            let foreign = FakeSite { _ in start(link) }
            await assertThrowsCode("invalid_pairing_url") { try await Pairing.begin(client: foreign.client(), name: "Mac") }
        }
        for status in ["denied", "expired", "consumed"] {
            let site = FakeSite { request in
                request.url.hasSuffix("/start") ? start("\(fixtureOrigin)/studio/settings/computer?code=ABCD-EF23") : envelope(["status": .string(status)])
            }
            let started = try await Pairing.begin(client: site.client(), name: "Mac")
            await assertThrowsCode("pairing_\(status)") {
                try await Pairing.waitForApproval(started, client: site.client(), name: "Mac", store: MemoryTokenStore(), sleep: { _ in })
            }
        }
        let pending = FakeSite { request in
            request.url.hasSuffix("/start") ? start("\(fixtureOrigin)/studio/settings/computer?code=ABCD-EF23") : envelope(["status": "pending"])
        }
        let started = try await Pairing.begin(client: pending.client(), name: "Mac")
        let clock = Clock()
        await assertThrowsCode("pairing_expired") {
            try await Pairing.waitForApproval(started, client: pending.client(), name: "Mac", store: MemoryTokenStore(), now: { clock.advance(400) }, sleep: { _ in })
        }
    }

    func testTheDeviceNameIsTheMacsNameMadeSafe() {
        XCTAssertEqual(Pairing.deviceName("Martin’s MacBook Air"), "Martin’s MacBook Air")
        XCTAssertEqual(Pairing.deviceName(" a\u{7}b\n "), "ab")
        XCTAssertEqual(Pairing.deviceName(String(repeating: "x", count: 150)).count, 100)
        XCTAssertEqual(Pairing.deviceName(nil), "Mac")
    }
}

final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0
    func next() -> Int { lock.withLock { value += 1; return value } }
    var count: Int { lock.withLock { value } }
}

final class Clock: @unchecked Sendable {
    private let lock = NSLock()
    private var now = Date()
    func advance(_ seconds: TimeInterval) -> Date { lock.withLock { now = now.addingTimeInterval(seconds); return now } }
}

/// A URL protocol that answers the transport tests without a network.
final class StubProtocol: URLProtocol, @unchecked Sendable {
    enum Mode { case ok, redirect, large, hang }
    nonisolated(unsafe) static var mode = Mode.ok
    nonisolated(unsafe) static var followed = false

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url else { return }
        if url.host == "elsewhere.example" { Self.followed = true }
        switch Self.mode {
        case .redirect:
            let response = HTTPURLResponse(url: url, statusCode: 302, httpVersion: "HTTP/1.1", headerFields: ["Location": "https://elsewhere.example/steal"])!
            client?.urlProtocol(self, wasRedirectedTo: URLRequest(url: URL(string: "https://elsewhere.example/steal")!), redirectResponse: response)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocolDidFinishLoading(self)
        case .large:
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(repeating: 0x61, count: 4096))
            client?.urlProtocolDidFinishLoading(self)
        case .hang:
            break
        case .ok:
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data("{\"ok\":true,\"data\":true}".utf8))
            client?.urlProtocolDidFinishLoading(self)
        }
    }

    override func stopLoading() {}
}
