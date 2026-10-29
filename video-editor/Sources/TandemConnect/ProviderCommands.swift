import Foundation

/// Connect and Disconnect Codex or Claude from Settings: the CLI's own
/// subscription sign-in and sign-out, on this Mac. Port of commands.ts.
public enum ProviderCommands {
    public static let loginTimeout: TimeInterval = 15 * 60
    /// `PROVIDER_LOGIN_HOSTS` in devices-policy.ts: the only sign-in pages
    /// passed on to Settings.
    public static let verificationHosts = ["auth.openai.com", "chatgpt.com", "claude.ai", "console.anthropic.com", "platform.claude.com", "claude.com"]

    /// Fixed arguments, never chosen by the server.
    public static func args(_ provider: LocalProvider, _ kind: ProviderCommand.Kind) -> [String] {
        switch (provider, kind) {
        case (.codex, .login): return ["login", "--device-auth"]
        case (.codex, .logout): return ["logout"]
        case (.claude, .login): return ["auth", "login", "--claudeai"]
        case (.claude, .logout): return ["auth", "logout"]
        }
    }

    /// Only the verification link (on an allowed host) and the device code
    /// come out of the CLI's output; everything else is dropped.
    public static func parseLoginOutput(_ output: String) -> (verificationUrl: String?, userCode: String?) {
        let ansi = #"\x{1b}\[[0-?]*[ -/]*[@-~]|\x{1b}\][^\x{07}]*(\x{07}|\x{1b}\\)"#
        let text = output.replacingOccurrences(of: ansi, with: "", options: .regularExpression)
        var link: String?
        let urls = try! NSRegularExpression(pattern: #"https://[^\s"'<>`]+"#)
        for match in urls.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
            guard let range = Range(match.range, in: text) else { continue }
            let candidate = String(text[range]).replacingOccurrences(of: #"[.,;:)\]]+$"#, with: "", options: .regularExpression)
            guard let url = URLComponents(string: candidate), url.scheme == "https", url.user == nil, url.password == nil,
                  let host = url.host?.lowercased(), verificationHosts.contains(host), url.port == nil, candidate.count <= 2000 else { continue }
            link = url.string ?? candidate
            break
        }
        var code: String?
        let codes = try! NSRegularExpression(pattern: #"(?:^|\s)([A-Z0-9]{4,8}-[A-Z0-9]{4,8})(?=\s|$)"#, options: [.anchorsMatchLines])
        if let match = codes.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)), let range = Range(match.range(at: 1), in: text) {
            let value = String(text[range])
            if Check.matches(value, "^[A-Z0-9-]{4,16}$") { code = value }
        }
        return (link, code)
    }

    public enum LoginOutcome: Sendable { case exited, failed, timeout, cancelled }

    public struct LoginRequest: Sendable {
        public var command: String
        public var args: [String]
        public var timeout: TimeInterval
        public var onDisplay: @Sendable (LoginDisplay) -> Void
    }

    /// Runs a login and streams its output only into the parser. Stdin stays
    /// open (never written), so a CLI waiting for a pasted code doesn't
    /// stop. Cancelling the calling task stops it.
    public typealias LoginRunner = @Sendable (LoginRequest) async -> LoginOutcome

    public static let runLoginProcess: LoginRunner = { request in
        guard !Task.isCancelled else { return .cancelled }
        guard let executable = CLISearchPath.resolve(request.command) else { return .failed }
        let state = LoginOutputState(onDisplay: request.onDisplay)
        let process: SpawnedProcess
        do {
            process = try SpawnedProcess(executable: executable, args: request.args, environment: nativeLoginEnvironment(), cwd: NSTemporaryDirectory()) { data, _ in
                state.append(data)
            }
        } catch {
            return .failed
        }
        let outcome = OutcomeBox()
        @Sendable func stop(_ why: LoginOutcome) {
            guard outcome.set(why) else { return }
            process.signalGroup(SIGTERM)
            DispatchQueue.global().asyncAfter(deadline: .now() + 1) { process.signalGroup(SIGKILL) }
        }
        let timer = DispatchWorkItem { stop(.timeout) }
        DispatchQueue.global().asyncAfter(deadline: .now() + request.timeout, execute: timer)
        let code = await withTaskCancellationHandler {
            await process.wait()
        } onCancel: {
            stop(.cancelled)
        }
        timer.cancel()
        return outcome.value ?? (code == 0 ? .exited : .failed)
    }

    public struct Dependencies: Sendable {
        /// Posts a status; false when the server says the command is over.
        public var post: @Sendable (CommandStatus) async -> Bool
        public var readiness: @Sendable (LocalProvider) async -> CLIReadiness
        public var login: LoginRunner = ProviderCommands.runLoginProcess
        public var run: ProcessRunner = runNativeProcess
        public var timeout: TimeInterval = ProviderCommands.loginTimeout
        public var keepAlive: TimeInterval = 10

        public init(post: @escaping @Sendable (CommandStatus) async -> Bool, readiness: @escaping @Sendable (LocalProvider) async -> CLIReadiness,
                    login: @escaping LoginRunner = ProviderCommands.runLoginProcess, run: @escaping ProcessRunner = runNativeProcess,
                    timeout: TimeInterval = ProviderCommands.loginTimeout, keepAlive: TimeInterval = 10) {
            self.post = post
            self.readiness = readiness
            self.login = login
            self.run = run
            self.timeout = timeout
            self.keepAlive = keepAlive
        }
    }

    /// Runs one command. Only the status, the parsed link and code and fixed
    /// error text are reported. Cancelling the task stops it.
    public static func execute(_ command: ProviderCommand, _ deps: Dependencies) async -> CommandStatus.Status {
        @Sendable func post(_ status: CommandStatus.Status, display: LoginDisplay? = nil, error: String? = nil) async -> Bool {
            await deps.post(CommandStatus(commandId: command.id, status: status, display: display, error: error))
        }
        func finish(_ ok: Bool, _ error: String) async -> CommandStatus.Status {
            _ = await post(ok ? .succeeded : .failed, error: ok ? nil : error)
            return ok ? .succeeded : .failed
        }
        let args = Self.args(command.provider, command.kind)
        guard await post(.running) else { return .failed }
        if command.kind == .logout {
            // The status check afterwards decides.
            _ = try? await deps.run(ProcessRequest(command: command.provider.rawValue, args: args, cwd: NSTemporaryDirectory(), timeout: 60, maxOutputBytes: 64 * 1024))
            let after = await deps.readiness(command.provider)
            return await finish(!after.authenticated && after.loginMethod == nil, "Sign-out did not complete on the Mac.")
        }
        let shared = LoginShared()
        let login = Task {
            await deps.login(LoginRequest(command: command.provider.rawValue, args: args, timeout: deps.timeout) { display in
                shared.display = display
                Task {
                    if !(await post(.waitingForUser, display: display)) { shared.cancel() }
                }
            })
        }
        shared.loginTask = login
        let keepAlive = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(deps.keepAlive * 1_000_000_000))
                guard !Task.isCancelled else { break }
                if let display = shared.display, !(await post(.waitingForUser, display: display)) { shared.cancel() }
            }
        }
        let outcome = await withTaskCancellationHandler {
            await login.value
        } onCancel: {
            login.cancel()
        }
        keepAlive.cancel()
        if shared.cancelled { return .failed }
        switch outcome {
        case .timeout: return await finish(false, "Sign-in timed out after 15 minutes.")
        case .cancelled: return await finish(false, "Sign-in was stopped because Studio quit or the Mac went to sleep.")
        case .exited, .failed:
            let after = await deps.readiness(command.provider)
            return await finish(after.authenticated, outcome == .failed ? "Sign-in did not complete on the Mac." : "Signed in, but not with a subscription account.")
        }
    }
}

final class LoginShared: @unchecked Sendable {
    private let lock = NSLock()
    private var _display: LoginDisplay?
    private var _cancelled = false
    var loginTask: Task<ProviderCommands.LoginOutcome, Never>?

    var display: LoginDisplay? {
        get { lock.withLock { _display } }
        set { lock.withLock { _display = newValue } }
    }

    var cancelled: Bool { lock.withLock { _cancelled } }

    /// The server says the command was cancelled: stop the CLI.
    func cancel() {
        let task: Task<ProviderCommands.LoginOutcome, Never>? = lock.withLock { _cancelled = true; return loginTask }
        task?.cancel()
    }
}

final class OutcomeBox: @unchecked Sendable {
    private let lock = NSLock()
    private var outcome: ProviderCommands.LoginOutcome?
    func set(_ value: ProviderCommands.LoginOutcome) -> Bool { lock.withLock { if outcome != nil { return false }; outcome = value; return true } }
    var value: ProviderCommands.LoginOutcome? { lock.withLock { outcome } }
}

/// Collects a login's output (up to 64 KB) and reports each new link/code.
final class LoginOutputState: @unchecked Sendable {
    private let lock = NSLock()
    private var buffer = Data()
    private var reported = ""
    private let onDisplay: @Sendable (LoginDisplay) -> Void

    init(onDisplay: @escaping @Sendable (LoginDisplay) -> Void) { self.onDisplay = onDisplay }

    func append(_ data: Data) {
        let display: LoginDisplay? = lock.withLock {
            if buffer.count < 64 * 1024 { buffer.append(data) }
            let parsed = ProviderCommands.parseLoginOutput(String(decoding: buffer, as: UTF8.self))
            guard let link = parsed.verificationUrl else { return nil }
            let key = "\(link) \(parsed.userCode ?? "")"
            guard key != reported else { return nil }
            reported = key
            return LoginDisplay(verificationUrl: link, userCode: parsed.userCode)
        }
        if let display { onDisplay(display) }
    }
}
