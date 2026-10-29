import Foundation
import XCTest
@testable import TandemConnect

let fixtureId = "00000000-0000-4000-8000-000000000001"
let fixtureOrigin = "https://studio.example"
let fixtureToken = "studio_device_" + String(repeating: "a", count: 43)

func fixtureJob(leaseExpires: Date = Date().addingTimeInterval(120)) -> JSONValue {
    ["id": .string(fixtureId), "location_id": .string(fixtureId), "kind": "studio.diagnostic", "payload": [:],
     "lease_token": .string(fixtureId), "lease_expires_at": .string(Check.isoString(leaseExpires)), "attempts": 1, "max_attempts": 2]
}

struct SentRequest: Sendable {
    var url: String
    var method: String
    var headers: [String: String]
    var body: JSONValue?
    var operation: String { url.components(separatedBy: "/").last ?? "" }
}

/// A fake site: records every request and answers from `respond`.
final class FakeSite: @unchecked Sendable {
    private let lock = NSLock()
    private var sent: [SentRequest] = []
    var respond: @Sendable (SentRequest) async throws -> HTTPResponse

    init(_ respond: @escaping @Sendable (SentRequest) async throws -> HTTPResponse) {
        self.respond = respond
    }

    var requests: [SentRequest] { lock.withLock { sent } }

    var transport: HTTPTransport {
        ClosureTransport { [self] request in
            let body = request.httpBody.flatMap { try? JSONValue.parse($0) }
            let recorded = SentRequest(url: request.url?.absoluteString ?? "", method: request.httpMethod ?? "", headers: request.allHTTPHeaderFields ?? [:], body: body)
            lock.withLock { sent.append(recorded) }
            return try await respond(recorded)
        }
    }

    func client(_ origin: String = fixtureOrigin) -> DeviceClient { try! DeviceClient(origin: origin, transport: transport) }
}

func envelope(_ data: JSONValue, status: Int = 200) -> HTTPResponse {
    HTTPResponse(status: status, contentType: "application/json", body: try! JSONValue.object(["ok": true, "data": data]).data())
}

func json(_ value: JSONValue, status: Int) -> HTTPResponse {
    HTTPResponse(status: status, contentType: "application/json", body: try! value.data())
}

func temporaryDirectory(_ name: String) -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(name)-\(UUID().uuidString)", isDirectory: true)
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    return url
}

/// Waits up to `timeout` for `condition`.
func eventually(_ timeout: TimeInterval = 5, _ condition: () async -> Bool) async -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if await condition() { return true }
        try? await Task.sleep(nanoseconds: 10_000_000)
    }
    return await condition()
}

func assertThrowsCode<T>(_ code: String, _ work: () async throws -> T, file: StaticString = #filePath, line: UInt = #line) async {
    do {
        _ = try await work()
        XCTFail("expected \(code)", file: file, line: line)
    } catch {
        XCTAssertEqual((error as? ConnectError)?.code ?? "\(error)", code, file: file, line: line)
    }
}
