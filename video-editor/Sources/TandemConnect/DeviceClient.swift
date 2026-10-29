import Foundation

public struct HTTPResponse: Sendable {
    public var status: Int
    public var contentType: String?
    public var body: Data

    public init(status: Int, contentType: String?, body: Data) {
        self.status = status
        self.contentType = contentType
        self.body = body
    }
}

/// Sends one request. Tests pass a closure; the app uses `URLSessionTransport`.
public protocol HTTPTransport: Sendable {
    /// Must refuse redirects, give up after `timeout` seconds in all and
    /// stop reading past `maxBytes`.
    func send(_ request: URLRequest, timeout: TimeInterval, maxBytes: Int) async throws -> HTTPResponse
}

public struct ClosureTransport: HTTPTransport {
    let handler: @Sendable (URLRequest) async throws -> HTTPResponse
    public init(_ handler: @escaping @Sendable (URLRequest) async throws -> HTTPResponse) { self.handler = handler }
    public func send(_ request: URLRequest, timeout: TimeInterval, maxBytes: Int) async throws -> HTTPResponse {
        try await withTimeout(timeout) { try await handler(request) }
    }
}

/// URLSession without cookies, caches or redirects.
public final class URLSessionTransport: NSObject, HTTPTransport, URLSessionTaskDelegate, @unchecked Sendable {
    private let session: URLSession

    public init(configuration: URLSessionConfiguration = .ephemeral) {
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: configuration)
        super.init()
    }

    /// `redirect: "error"`: a redirect is answered with nothing, so the 3xx
    /// itself comes back and fails, and the key never goes anywhere else.
    public func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                           newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    public func send(_ request: URLRequest, timeout: TimeInterval, maxBytes: Int) async throws -> HTTPResponse {
        var timed = request
        timed.timeoutInterval = timeout
        let request = timed
        let session = self.session
        return try await withTimeout(timeout) {
            let (bytes, response) = try await session.bytes(for: request, delegate: self)
            guard let http = response as? HTTPURLResponse else { throw ConnectError("bad_response") }
            if let length = http.value(forHTTPHeaderField: "Content-Length").flatMap(Int.init), length > maxBytes {
                bytes.task.cancel()
                throw ConnectError("response_too_large")
            }
            var body = Data()
            for try await byte in bytes {
                body.append(byte)
                if body.count > maxBytes {
                    bytes.task.cancel()
                    throw ConnectError("response_too_large")
                }
            }
            return HTTPResponse(status: http.statusCode, contentType: http.value(forHTTPHeaderField: "Content-Type"), body: body)
        }
    }
}

/// Runs `work`, cancelling it after `seconds` (AbortSignal.timeout).
func withTimeout<T: Sendable>(_ seconds: TimeInterval, _ work: @escaping @Sendable () async throws -> T) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask { try await work() }
        group.addTask {
            try await Task.sleep(nanoseconds: UInt64(max(seconds, 0) * 1_000_000_000))
            throw ConnectError("timeout")
        }
        defer { group.cancelAll() }
        guard let first = try await group.next() else { throw ConnectError("timeout") }
        return first
    }
}

// MARK: - The device protocol

public struct StudioJob: Equatable, Sendable {
    public let id: String
    public let locationId: String
    public let kind: String
    public let payload: [String: JSONValue]
    public let leaseToken: String
    public let leaseExpiresAt: Date?
    public let attempts: Int
    public let maxAttempts: Int

    /// The claim schema: diagnostics are the only kind a Mac takes yet.
    static func parse(_ value: JSONValue) throws -> StudioJob {
        guard let o = value.object, let id = o["id"]?.string, Check.isUUID(id),
              let location = o["location_id"]?.string, (1...255).contains(location.count),
              o["kind"]?.string == "studio.diagnostic", let payload = o["payload"]?.object,
              let lease = o["lease_token"]?.string, Check.isUUID(lease),
              let expires = Check.date(o["lease_expires_at"]?.string),
              let attempts = o["attempts"]?.integer, attempts >= 0,
              let max = o["max_attempts"]?.integer, max > 0 else { throw ConnectError("invalid_job") }
        return StudioJob(id: id, locationId: location, kind: "studio.diagnostic", payload: payload, leaseToken: lease,
                         leaseExpiresAt: expires, attempts: attempts, maxAttempts: max)
    }

    public init(id: String, locationId: String, kind: String, payload: [String: JSONValue], leaseToken: String, leaseExpiresAt: Date?, attempts: Int, maxAttempts: Int) {
        self.id = id
        self.locationId = locationId
        self.kind = kind
        self.payload = payload
        self.leaseToken = leaseToken
        self.leaseExpiresAt = leaseExpiresAt
        self.attempts = attempts
        self.maxAttempts = maxAttempts
    }
}

public enum LocalProvider: String, Sendable, CaseIterable {
    case codex, claude
}

public struct ProviderCommand: Equatable, Sendable {
    public enum Kind: String, Sendable { case login = "provider_login", logout = "provider_logout" }
    public let id: String
    public let kind: Kind
    public let provider: LocalProvider

    public init(id: String, kind: Kind, provider: LocalProvider) {
        self.id = id
        self.kind = kind
        self.provider = provider
    }
}

/// What a heartbeat answers: the device's state in Settings.
public struct HeartbeatState: Equatable, Sendable {
    public var processingEnabled: Bool
    public var paused: Bool
    public var configVersion: Int
    public var configValue: JSONValue
    public var commands: [ProviderCommand]

    public init(processingEnabled: Bool, paused: Bool, configVersion: Int, configValue: JSONValue, commands: [ProviderCommand]) {
        self.processingEnabled = processingEnabled
        self.paused = paused
        self.configVersion = configVersion
        self.configValue = configValue
        self.commands = commands
    }

    /// `z.union([z.null(), z.boolean(), heartbeatState])`: nil for an older
    /// server's null or boolean; anything else malformed fails the call.
    static func parse(_ value: JSONValue) throws -> HeartbeatState? {
        switch value {
        case .null, .bool: return nil
        default: break
        }
        guard let o = value.object, let processing = o["processingEnabled"]?.bool, let paused = o["paused"]?.bool,
              let config = o["config"]?.object, let version = config["version"]?.integer, version >= 0,
              let list = o["commands"]?.array, list.count <= 20 else { throw ConnectError("invalid_heartbeat") }
        let commands = try list.map { item -> ProviderCommand in
            guard let c = item.object, let id = c["id"]?.string, Check.isUUID(id),
                  let kind = c["kind"]?.string.flatMap(ProviderCommand.Kind.init(rawValue:)),
                  let provider = c["provider"]?.string.flatMap(LocalProvider.init(rawValue:)) else { throw ConnectError("invalid_heartbeat") }
            return ProviderCommand(id: id, kind: kind, provider: provider)
        }
        return HeartbeatState(processingEnabled: processing, paused: paused, configVersion: version, configValue: config["value"] ?? .null, commands: commands)
    }
}

public struct ConfigAck: Equatable, Sendable {
    public enum Status: String, Sendable { case applied, error }
    public var version: Int
    public var status: Status
    public var unsupported: [String: String]?
    public var error: String?

    public init(version: Int, status: Status, unsupported: [String: String]? = nil, error: String? = nil) {
        self.version = version
        self.status = status
        self.unsupported = unsupported
        self.error = error
    }

    var json: JSONValue {
        var o: [String: JSONValue] = ["version": .number(Double(version)), "status": .string(status.rawValue)]
        if let unsupported { o["unsupported"] = .object(unsupported.mapValues { .string($0) }) }
        if let error { o["error"] = .string(error) }
        return .object(o)
    }
}

public struct CommandStatus: Equatable, Sendable {
    public enum Status: String, Sendable { case running, waitingForUser = "waiting_for_user", succeeded, failed }
    public var commandId: String
    public var status: Status
    public var display: LoginDisplay?
    public var error: String?

    public init(commandId: String, status: Status, display: LoginDisplay? = nil, error: String? = nil) {
        self.commandId = commandId
        self.status = status
        self.display = display
        self.error = error
    }
}

public struct LoginDisplay: Equatable, Sendable {
    public var verificationUrl: String
    public var userCode: String?

    public init(verificationUrl: String, userCode: String? = nil) {
        self.verificationUrl = verificationUrl
        self.userCode = userCode
    }
}

public struct PairStart: Equatable, Sendable {
    public let pairingId: String
    public let deviceCode: String
    public let userCode: String
    public let verificationUrl: String
    public let expiresAt: Date
    public let intervalSeconds: Int
}

public enum PairPoll: Equatable, Sendable {
    case pending
    case approved(token: String, deviceId: String, businessName: String)
    case denied, expired, consumed
}

public struct JobFailure: Equatable, Sendable {
    public var code: String
    public var message: String
    public var retryable: Bool
    public var retryAfterSeconds: Int?

    public init(code: String, message: String, retryable: Bool, retryAfterSeconds: Int? = nil) {
        self.code = code
        self.message = message
        self.retryable = retryable
        self.retryAfterSeconds = retryAfterSeconds
    }
}

/// POST `/api/studio/device/<operation>` on one site. Port of `deviceCall`
/// and `createDeviceStudioQueue` in http-queue.ts.
public struct DeviceClient: Sendable {
    public static let timeout: TimeInterval = 15
    public static let maxResponseBytes = 256 * 1024

    public let origin: String
    let transport: HTTPTransport

    public init(origin: String, transport: HTTPTransport) throws {
        self.origin = try AppOrigin.validate(origin)
        self.transport = transport
    }

    /// One JSON POST. Response bodies and transport errors never come out:
    /// a failure is `device_<operation>_failed`, with the HTTP status when
    /// there was one.
    public func call(_ operation: String, token: String?, body: JSONValue) async throws -> JSONValue {
        let code = "device_\(operation.replacingOccurrences(of: "/", with: "_"))_failed"
        if let token, !DeviceToken.isValid(token) { throw ConnectError(code) }
        guard let url = URL(string: "\(origin)/api/studio/device/\(operation)") else { throw ConnectError(code) }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        request.httpBody = try? body.data()
        let response: HTTPResponse
        do {
            response = try await transport.send(request, timeout: Self.timeout, maxBytes: Self.maxResponseBytes)
        } catch {
            throw ConnectError(code)
        }
        guard (200..<300).contains(response.status) else { throw ConnectError(code, httpStatus: response.status) }
        guard response.contentType?.contains("application/json") == true, response.body.count <= Self.maxResponseBytes,
              let envelope = try? JSONValue.parse(response.body).object, envelope["ok"] == .bool(true) else {
            throw ConnectError(code, httpStatus: response.status)
        }
        return envelope["data"] ?? .null
    }

    /// Runs a parse and maps any failure to the operation's code.
    private func checked<T>(_ operation: String, _ status: Int? = nil, _ parse: () throws -> T) throws -> T {
        do { return try parse() } catch { throw ConnectError("device_\(operation.replacingOccurrences(of: "/", with: "_"))_failed", httpStatus: status) }
    }

    // MARK: Device operations (Bearer token)

    public func heartbeat(token: String, workerId: String, release: String?, startedAt: Date, report: JSONValue, configAck: ConfigAck?) async throws -> HeartbeatState? {
        var body: [String: JSONValue] = ["workerId": .string(workerId), "release": release.map(JSONValue.string) ?? .null,
                                         "startedAt": .string(Check.isoString(startedAt)), "report": report]
        if let configAck { body["configAck"] = configAck.json }
        let data = try await call("heartbeat", token: token, body: .object(body))
        return try checked("heartbeat") { try HeartbeatState.parse(data) }
    }

    public func claim(token: String, workerId: String, limit: Int, leaseSeconds: Int) async throws -> [StudioJob] {
        let data = try await call("claim", token: token, body: ["workerId": .string(workerId), "limit": .number(Double(limit)), "leaseSeconds": .number(Double(leaseSeconds))])
        return try checked("claim") {
            guard let list = data.array, list.count <= 50 else { throw ConnectError("invalid_claim") }
            return try list.map(StudioJob.parse)
        }
    }

    public func extend(token: String, jobId: String, workerId: String, leaseSeconds: Int, leaseToken: String) async throws -> Bool {
        let data = try await call("extend", token: token, body: ["jobId": .string(jobId), "workerId": .string(workerId),
                                                                 "leaseSeconds": .number(Double(leaseSeconds)), "leaseToken": .string(leaseToken)])
        return try checked("extend") { guard let value = data.bool else { throw ConnectError("invalid") }; return value }
    }

    public func complete(token: String, jobId: String, workerId: String, result: JSONValue, leaseToken: String) async throws -> Bool {
        let data = try await call("complete", token: token, body: ["jobId": .string(jobId), "workerId": .string(workerId),
                                                                   "result": result, "leaseToken": .string(leaseToken)])
        return try checked("complete") { guard let value = data.bool else { throw ConnectError("invalid") }; return value }
    }

    public func fail(token: String, jobId: String, workerId: String, failure: JobFailure, leaseToken: String) async throws -> String {
        var f: [String: JSONValue] = ["code": .string(failure.code), "message": .string(failure.message), "retryable": .bool(failure.retryable)]
        if let after = failure.retryAfterSeconds { f["retryAfterSeconds"] = .number(Double(after)) }
        let data = try await call("fail", token: token, body: ["jobId": .string(jobId), "workerId": .string(workerId),
                                                               "failure": .object(f), "leaseToken": .string(leaseToken)])
        return try checked("fail") {
            guard let value = data.string, ["retry_scheduled", "failed", "lease_lost"].contains(value) else { throw ConnectError("invalid") }
            return value
        }
    }

    /// Reports a provider command's progress. False when the server says it
    /// was cancelled or already finished.
    public func command(token: String, workerId: String, status: CommandStatus) async throws -> Bool {
        var body: [String: JSONValue] = ["workerId": .string(workerId), "commandId": .string(status.commandId), "status": .string(status.status.rawValue)]
        if let display = status.display {
            var d: [String: JSONValue] = ["verificationUrl": .string(display.verificationUrl)]
            if let code = display.userCode { d["userCode"] = .string(code) }
            body["display"] = .object(d)
        }
        if let error = status.error { body["error"] = .string(error) }
        let data = try await call("command", token: token, body: .object(body))
        return try checked("command") {
            switch data {
            case .bool(let value): return value
            case .null: return true
            case .object(let o):
                if let cancelled = o["cancelled"], cancelled.bool == nil { throw ConnectError("invalid") }
                if let state = o["status"], state.string == nil { throw ConnectError("invalid") }
                return o["cancelled"]?.bool != true && o["status"]?.string != "cancelled"
            default: throw ConnectError("invalid")
            }
        }
    }

    // MARK: Pairing (no token)

    public func startPairing(name: String, platform: String) async throws -> PairStart {
        let data = try await call("pair/start", token: nil, body: ["name": .string(name), "platform": .string(platform)])
        return try checked("pair/start") {
            guard let o = data.object, let id = o["pairingId"]?.string, Check.isUUID(id),
                  let device = o["deviceCode"]?.string, Check.matches(device, "^[A-Za-z0-9_-]{20,100}$"),
                  let user = o["userCode"]?.string, Check.matches(user, "^[A-Z0-9]{4}-[A-Z0-9]{4}$"),
                  let link = o["verificationUrl"]?.string, link.count <= 500, URL(string: link)?.scheme != nil,
                  let expires = Check.date(o["expiresAt"]?.string),
                  let interval = o["intervalSeconds"]?.integer, (1...60).contains(interval) else { throw ConnectError("invalid") }
            return PairStart(pairingId: id, deviceCode: device, userCode: user, verificationUrl: link, expiresAt: expires, intervalSeconds: interval)
        }
    }

    public func pollPairing(pairingId: String, deviceCode: String) async throws -> PairPoll {
        let data = try await call("pair/poll", token: nil, body: ["pairingId": .string(pairingId), "deviceCode": .string(deviceCode)])
        return try checked("pair/poll") {
            switch data["status"]?.string {
            case "pending": return .pending
            case "denied": return .denied
            case "expired": return .expired
            case "consumed": return .consumed
            case "approved":
                guard let token = data["token"]?.string, DeviceToken.isValid(token),
                      let device = data["deviceId"]?.string, Check.isUUID(device),
                      data["businessName"]?.string != nil || data["businessName"] == nil || data["businessName"] == .null else { throw ConnectError("invalid") }
                // A Location without a name would make the Node companion drop
                // the only copy of the key; here it's just an empty name.
                let business = data["businessName"]?.string ?? ""
                guard business.count <= 200 else { throw ConnectError("invalid") }
                return .approved(token: token, deviceId: device, businessName: business)
            default: throw ConnectError("invalid")
            }
        }
    }
}
