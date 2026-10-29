import Foundation

/// "chatgpt", "api_key", "claudeai", "console" or "unknown".
public typealias LoginMethod = String

public struct CLIReadiness: Equatable, Sendable {
    public var installed = false
    public var authenticated = false
    public var ready = false
    public var version: String?
    public var models: [String] = []
    public var loginMethod: LoginMethod?

    public init(installed: Bool = false, authenticated: Bool = false, ready: Bool = false, version: String? = nil, models: [String] = [], loginMethod: LoginMethod? = nil) {
        self.installed = installed
        self.authenticated = authenticated
        self.ready = ready
        self.version = version
        self.models = models
        self.loginMethod = loginMethod
    }

    var json: JSONValue {
        var o: [String: JSONValue] = ["installed": .bool(installed), "authenticated": .bool(authenticated), "ready": .bool(ready),
                                      "models": .array(models.map { .string($0) })]
        if let version { o["version"] = .string(version) }
        if let loginMethod { o["loginMethod"] = .string(loginMethod) }
        return .object(o)
    }
}

/// Only the login method; account, email and organisation fields in the
/// status output are never read.
public func codexLoginMethod(_ output: String) -> LoginMethod? {
    let text = output.lowercased()
    if text.contains("logged in using chatgpt") { return "chatgpt" }
    if text.range(of: "logged in using (an )?api key", options: .regularExpression) != nil { return "api_key" }
    return text.contains("logged in") && !text.contains("not logged in") ? "unknown" : nil
}

public func claudeLoginMethod(_ status: [String: JSONValue]) -> LoginMethod? {
    guard status["loggedIn"] == .bool(true) else { return nil }
    // `String(status.authMethod)`.
    let method: String
    switch status["authMethod"] {
    case .string(let value)?: method = value
    case nil: method = "undefined"
    case let other?: method = other.text
    }
    if method == "claude.ai" { return "claudeai" }
    if method == "console" { return "console" }
    return method.range(of: "api.?key", options: [.regularExpression, .caseInsensitive]) != nil ? "api_key" : "unknown"
}

public struct TextRequest: Sendable {
    public var model: String?
    public var prompt: String
    public var jsonSchema: JSONValue
}

/// A native Codex or Claude CLI: its own sign-in, no SDK, no API key and
/// no server-chosen flags. Port of providers.ts.
public struct LocalTextAdapter: Sendable {
    public let provider: LocalProvider
    let run: ProcessRunner

    public init(provider: LocalProvider, run: @escaping ProcessRunner = runNativeProcess) {
        self.provider = provider
        self.run = run
    }

    /// Runs `work` in a new private temporary folder, removed afterwards.
    static func isolated<T>(_ work: (String) async throws -> T) async throws -> T {
        let base = NSTemporaryDirectory()
        var template = Array("\((base as NSString).appendingPathComponent("studio-companion-"))XXXXXX".utf8CString)
        guard let made = mkdtemp(&template) else { throw ProcessFailure.unavailable }
        let cwd = String(cString: made)
        defer { try? FileManager.default.removeItem(atPath: cwd) }
        return try await work(cwd)
    }

    public func readiness() async -> CLIReadiness {
        (try? await Self.isolated { cwd in
            var result = CLIReadiness()
            do {
                let version = try await run(ProcessRequest(command: provider.rawValue, args: ["--version"], cwd: cwd, timeout: 10, maxOutputBytes: 8192))
                result.installed = true
                result.version = version.stdout.range(of: #"\b\d+\.\d+\.\d+\b"#, options: .regularExpression).map { String(version.stdout[$0]) }
                let help = try await run(ProcessRequest(command: provider.rawValue, args: provider == .codex ? ["exec", "--help"] : ["--help"],
                                                        cwd: cwd, timeout: 10, maxOutputBytes: 64 * 1024))
                let flags = provider == .codex
                    ? ["--ignore-user-config", "--ignore-rules", "--ephemeral", "--output-schema", "--json"]
                    : ["--safe-mode", "--restricted", "--tools", "--strict-mcp-config", "--json-schema", "--no-session-persistence"]
                let supported = flags.allSatisfy { help.stdout.contains($0) }
                let auth = try await run(ProcessRequest(command: provider.rawValue, args: provider == .codex ? ["login", "status"] : ["auth", "status", "--json"],
                                                        cwd: cwd, timeout: 10, maxOutputBytes: 8192))
                if provider == .codex {
                    result.loginMethod = codexLoginMethod("\(auth.stdout)\n\(auth.stderr)")
                } else {
                    guard let status = try JSONValue.parse(Data(auth.stdout.utf8)).object else { return result }
                    result.loginMethod = claudeLoginMethod(status)
                }
                // Only subscription logins count: an API key or Console login
                // would bill a different account.
                result.authenticated = result.loginMethod == (provider == .codex ? "chatgpt" : "claudeai")
                result.ready = result.authenticated && supported && result.version != nil
            } catch {
                // No raw CLI output or credential-bearing auth data leaves here.
            }
            return result
        }) ?? CLIReadiness()
    }

    /// One structured answer, validated by `validate`.
    public func generate(_ request: TextRequest, validate: (JSONValue) throws -> JSONValue) async throws -> JSONValue {
        if let model = request.model, !Check.isModel(model) { throw ConnectError("invalid_text_request") }
        guard !request.prompt.isEmpty, request.prompt.utf8.count <= 64 * 1024 else { throw ConnectError("invalid_text_request") }
        guard await readiness().ready else { throw ConnectError("provider_not_ready") }
        return try await Self.isolated { cwd in
            let args: [String]
            let modelArgs = request.model.map { ["--model", $0] } ?? []
            if provider == .codex {
                let schemaPath = (cwd as NSString).appendingPathComponent("response.schema.json")
                guard FileManager.default.createFile(atPath: schemaPath, contents: try request.jsonSchema.data(), attributes: [.posixPermissions: 0o600]) else {
                    throw ConnectError("invalid_text_request")
                }
                args = ["exec", "--ignore-user-config", "--ignore-rules", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only"]
                    + modelArgs + ["--json", "--output-schema", schemaPath,
                    "-c", "model_provider=\"openai\"", "-c", "forced_login_method=\"chatgpt\"", "-c", "approval_policy=\"never\"",
                    "-c", "web_search=\"disabled\"", "-c", "features.shell_tool=false", "-c", "features.unified_exec=false",
                    "-c", "features.apps=false", "-c", "features.plugins=false", "-c", "features.hooks=false", "-c", "features.multi_agent=false",
                    "-c", "features.code_mode=false", "-c", "features.skill_search=false", "-c", "features.skip_host_skill_discovery=true", "-"]
            } else {
                args = ["-p", "--output-format", "stream-json", "--verbose"] + modelArgs
                    + ["--safe-mode", "--restricted", "--tools", "", "--permission-mode", "dontAsk", "--permission-prompts", "none",
                       "--strict-mcp-config", "--mcp-config", "{\"mcpServers\":{}}", "--setting-sources", "", "--no-session-persistence",
                       "--disable-slash-commands", "--no-chrome", "--json-schema", request.jsonSchema.text]
            }
            let output = try await run(ProcessRequest(command: provider.rawValue, args: args, cwd: cwd, input: request.prompt, timeout: 90, maxOutputBytes: 256 * 1024))
            do {
                let events = try output.stdout.trimmingCharacters(in: .whitespacesAndNewlines).components(separatedBy: "\n").filter { !$0.isEmpty }.map { line -> [String: JSONValue] in
                    guard let event = try JSONValue.parse(Data(line.utf8)).object else { throw ConnectError("invalid") }
                    return event
                }
                let value: JSONValue?
                if provider == .codex {
                    guard events.contains(where: { $0["type"] == "turn.completed" }),
                          !events.contains(where: { $0["type"] == "turn.failed" || $0["type"] == "error" }) else { throw ConnectError("invalid") }
                    let messages = events.filter { $0["type"] == "item.completed" }.compactMap { $0["item"]?.object }.filter { $0["type"] == "agent_message" }
                    guard let text = messages.last?["text"]?.string, text.utf8.count <= 4096 else { throw ConnectError("invalid") }
                    value = try JSONValue.parse(Data(text.utf8))
                } else {
                    let results = events.filter { $0["type"] == "result" }
                    guard results.count == 1, results[0]["is_error"] == .bool(false), results[0]["subtype"] == "success" else { throw ConnectError("invalid") }
                    value = results[0]["structured_output"]
                }
                guard let value, value.text.utf8.count <= 4096 else { throw ConnectError("invalid") }
                return try validate(value)
            } catch {
                throw ConnectError("invalid_provider_result")
            }
        }
    }
}

/// A job handler's failure, shown to the Location's team: never secrets.
public struct JobError: Error, Equatable, Sendable {
    public var code: String
    public var message: String
    public var retryable: Bool
    public var retryAfterSeconds: Int?

    public init(_ code: String, _ message: String, retryable: Bool, retryAfterSeconds: Int? = nil) {
        self.code = code
        self.message = message
        self.retryable = retryable
        self.retryAfterSeconds = retryAfterSeconds
    }
}

public struct JobContext: Sendable {
    public var workerId: String
}

public typealias JobHandler = @Sendable (StudioJob, JobContext) async throws -> JSONValue

/// The `studio.diagnostic` job (diagnostic.ts): without a provider it only
/// proves the Mac can take and finish a job; with one it asks that CLI for
/// a fixed answer and checks it.
public enum Diagnostic {
    public static let message = "Studio Mac connection works"

    static let schema: JSONValue = [
        "type": "object",
        "properties": ["ok": ["type": "boolean", "const": true], "message": ["type": "string", "const": .string(message)]],
        "required": ["ok", "message"], "additionalProperties": false,
    ]

    static func answer(_ value: JSONValue) throws -> JSONValue {
        guard let o = value.object, Set(o.keys) == ["ok", "message"], o["ok"] == .bool(true), o["message"] == .string(message) else {
            throw ConnectError("invalid_answer")
        }
        return value
    }

    public static func handler(adapter: @escaping @Sendable (LocalProvider) -> LocalTextAdapter = { LocalTextAdapter(provider: $0) },
                               now: @escaping @Sendable () -> Date = { Date() }) -> JobHandler {
        { job, context in
            let provider = job.payload["provider"]
            let model = job.payload["model"]
            guard let provider else {
                if model != nil { throw JobError("invalid_diagnostic", "Choose a provider for the model check.", retryable: false) }
                return ["ok": true, "workerId": .string(context.workerId), "checkedAt": .string(Check.isoString(now()))]
            }
            guard let chosen = provider.string.flatMap(LocalProvider.init(rawValue:)), model == nil || Check.isModel(model?.string) else {
                throw JobError("invalid_diagnostic", "Choose a supported provider and model.", retryable: false)
            }
            do {
                let request = TextRequest(model: model?.string,
                                          prompt: "Return only JSON with exactly these values: {\"ok\":true,\"message\":\"\(message)\"}. Do not use any tools or access files.",
                                          jsonSchema: schema)
                let result = try await adapter(chosen).generate(request, validate: answer)
                // Checked again even for an injected adapter; no raw provider
                // output, usage or credentials go back.
                _ = try answer(result)
                var out: [String: JSONValue] = ["ok": true, "workerId": .string(context.workerId), "checkedAt": .string(Check.isoString(now())),
                                                "provider": .string(chosen.rawValue), "summary": .string(message)]
                if let model = model?.string { out["model"] = .string(model) }
                return .object(out)
            } catch {
                let code = (error as? ProcessFailure)?.rawValue ?? ((error as? ConnectError)?.code == "provider_not_ready" ? "provider_not_ready" : "provider_check_failed")
                throw JobError(code, "The local provider check could not complete. Check native CLI login, selected model and subscription limits on the Mac.",
                               retryable: code == "cli_cancelled" || code == "cli_timeout")
            }
        }
    }
}
