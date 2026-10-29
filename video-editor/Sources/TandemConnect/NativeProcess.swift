import Foundation

public struct ProcessRequest: Sendable {
    public var command: String
    public var args: [String]
    public var cwd: String
    public var input: String?
    public var timeout: TimeInterval
    public var maxOutputBytes: Int

    public init(command: String, args: [String], cwd: String = NSTemporaryDirectory(), input: String? = nil, timeout: TimeInterval = 90, maxOutputBytes: Int = 256 * 1024) {
        self.command = command
        self.args = args
        self.cwd = cwd
        self.input = input
        self.timeout = timeout
        self.maxOutputBytes = maxOutputBytes
    }
}

public struct ProcessOutput: Equatable, Sendable {
    public var stdout: String
    public var stderr: String
    public init(stdout: String, stderr: String) {
        self.stdout = stdout
        self.stderr = stderr
    }
}

/// `CompanionProcessError` codes.
public enum ProcessFailure: String, Error, Sendable {
    case unavailable = "cli_unavailable", failed = "cli_failed", timeout = "cli_timeout"
    case cancelled = "cli_cancelled", outputLimit = "cli_output_limit"
}

/// Runs a native program. Cancelling the calling task stops it.
public typealias ProcessRunner = @Sendable (ProcessRequest) async throws -> ProcessOutput

/// Where Codex, Claude and the local runtimes are installed. A GUI app
/// starts with a minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), so the
/// usual install folders are added to whatever PATH it has.
public enum CLISearchPath {
    public static func directories(environment: [String: String] = ProcessInfo.processInfo.environment,
                                   home: String = NSHomeDirectory()) -> [String] {
        let inherited = (environment["PATH"] ?? "").split(separator: ":").map(String.init)
        let usual = [
            "\(home)/.local/bin", "/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin",
            "\(home)/.claude/local", "\(home)/.bun/bin", "\(home)/.npm-global/bin", "\(home)/.volta/bin",
            "\(home)/.cargo/bin", "/Library/Frameworks/Python.framework/Versions/Current/bin",
            "/usr/bin", "/bin", "/usr/sbin", "/sbin",
        ]
        var seen = Set<String>()
        return (inherited + usual).filter { !$0.isEmpty && $0.hasPrefix("/") && seen.insert($0).inserted }
    }

    /// The executable a bare command name runs, like a shell's lookup.
    public static func resolve(_ command: String, in directories: [String] = directories()) -> String? {
        if command.contains("/") { return FileManager.default.isExecutableFile(atPath: command) ? command : nil }
        for directory in directories {
            let path = (directory as NSString).appendingPathComponent(command)
            var isDirectory: ObjCBool = false
            if FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory), !isDirectory.boolValue,
               FileManager.default.isExecutableFile(atPath: path) { return path }
        }
        return nil
    }
}

/// Port of `nativeLoginEnvironment`: only local runtime and login locations.
/// No API keys, endpoint overrides, proxies, NODE_OPTIONS or Studio values
/// can choose another billing or sign-in path. PATH gets the usual install
/// folders so a CLI written in Node finds `node`.
public func nativeLoginEnvironment(_ source: [String: String] = ProcessInfo.processInfo.environment, home: String = NSHomeDirectory()) -> [String: String] {
    var env = ["NODE_ENV": "production"]
    for key in ["HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL", "CODEX_HOME", "CLAUDE_CONFIG_DIR"] {
        if let value = source[key], !value.isEmpty { env[key] = value }
    }
    env["PATH"] = CLISearchPath.directories(environment: source, home: home).joined(separator: ":")
    env["NO_COLOR"] = "1"
    return env
}

/// A child in its own process group, so stopping it stops what it started.
final class SpawnedProcess: @unchecked Sendable {
    let pid: pid_t
    private var stdinFD: Int32
    private let lock = NSLock()
    private let done = DispatchGroup()
    private var exitStatus: Int32 = -1

    /// `onOutput` gets each chunk, on a background thread (true for stdout).
    init(executable: String, args: [String], environment: [String: String], cwd: String, onOutput: @escaping @Sendable (Data, Bool) -> Void) throws {
        var inPipe: [Int32] = [0, 0], outPipe: [Int32] = [0, 0], errPipe: [Int32] = [0, 0]
        guard pipe(&inPipe) == 0 else { throw ProcessFailure.unavailable }
        guard pipe(&outPipe) == 0 else { close(inPipe[0]); close(inPipe[1]); throw ProcessFailure.unavailable }
        guard pipe(&errPipe) == 0 else { [inPipe, outPipe].flatMap { $0 }.forEach { close($0) }; throw ProcessFailure.unavailable }

        var actions = posix_spawn_file_actions_t(nil as OpaquePointer?)
        posix_spawn_file_actions_init(&actions)
        defer { posix_spawn_file_actions_destroy(&actions) }
        posix_spawn_file_actions_adddup2(&actions, inPipe[0], 0)
        posix_spawn_file_actions_adddup2(&actions, outPipe[1], 1)
        posix_spawn_file_actions_adddup2(&actions, errPipe[1], 2)
        posix_spawn_file_actions_addchdir_np(&actions, cwd)

        var attributes = posix_spawnattr_t(nil as OpaquePointer?)
        posix_spawnattr_init(&attributes)
        defer { posix_spawnattr_destroy(&attributes) }
        // Its own group (detached: true), every other descriptor closed, and
        // default signal handling: the app ignores SIGTERM (it quits
        // cleanly on it), and a child would inherit that.
        posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_CLOEXEC_DEFAULT | POSIX_SPAWN_SETSIGDEF | POSIX_SPAWN_SETSIGMASK))
        posix_spawnattr_setpgroup(&attributes, 0)
        var defaults = sigset_t()
        sigemptyset(&defaults)
        for signal in [SIGTERM, SIGINT, SIGPIPE, SIGHUP, SIGQUIT, SIGCHLD] { sigaddset(&defaults, signal) }
        posix_spawnattr_setsigdefault(&attributes, &defaults)
        var mask = sigset_t()
        sigemptyset(&mask)
        posix_spawnattr_setsigmask(&attributes, &mask)

        let argv = ([executable] + args).map { strdup($0) } + [nil]
        let envp = environment.map { strdup("\($0.key)=\($0.value)") } + [nil]
        defer { (argv + envp).forEach { free($0) } }
        var child: pid_t = 0
        let result = posix_spawn(&child, executable, &actions, &attributes, argv, envp)
        close(inPipe[0]); close(outPipe[1]); close(errPipe[1])
        guard result == 0 else {
            close(inPipe[1]); close(outPipe[0]); close(errPipe[0])
            throw ProcessFailure.unavailable
        }
        pid = child
        stdinFD = inPipe[1]
        // Writing to a CLI that already exited must not raise SIGPIPE in the app.
        _ = fcntl(stdinFD, F_SETNOSIGPIPE, 1)

        for (fd, isStdout) in [(outPipe[0], true), (errPipe[0], false)] {
            done.enter()
            Thread.detachNewThread { [done] in
                var buffer = [UInt8](repeating: 0, count: 16 * 1024)
                while true {
                    let count = read(fd, &buffer, buffer.count)
                    if count > 0 { onOutput(Data(buffer[0..<count]), isStdout) }
                    else if count == 0 || errno != EINTR { break }
                }
                close(fd)
                done.leave()
            }
        }
        done.enter()
        Thread.detachNewThread { [weak self, done, child] in
            var status: Int32 = 0
            while waitpid(child, &status, 0) < 0 && errno == EINTR {}
            // Like the companion's cleanup: whatever the CLI left running in
            // its group goes too, which also closes the output pipes.
            kill(-child, SIGKILL)
            self?.lock.withLock { self?.exitStatus = status }
            done.leave()
        }
    }

    func write(_ data: Data) {
        lock.withLock {
            guard stdinFD >= 0 else { return }
            data.withUnsafeBytes { raw in
                var offset = 0
                while offset < raw.count {
                    let written = Darwin.write(stdinFD, raw.baseAddress! + offset, raw.count - offset)
                    if written <= 0 { if errno == EINTR { continue }; break }
                    offset += written
                }
            }
        }
    }

    func closeInput() {
        lock.withLock {
            if stdinFD >= 0 { close(stdinFD); stdinFD = -1 }
        }
    }

    func signalGroup(_ signal: Int32) {
        kill(-pid, signal)
    }

    /// The exit code once it exited and its output closed (-1 for a signal).
    func wait() async -> Int32 {
        await withCheckedContinuation { continuation in
            done.notify(queue: .global()) { [self] in
                closeInput()
                let status = lock.withLock { exitStatus }
                // WIFEXITED / WEXITSTATUS
                continuation.resume(returning: status & 0x7f == 0 ? (status >> 8) & 0xff : -1)
            }
        }
    }
}

/// Stops a running child once, for the first reason that came up, even if
/// the reason comes before the child has started.
final class ProcessControl: @unchecked Sendable {
    private let lock = NSLock()
    private var reason: ProcessFailure?
    private var process: SpawnedProcess?

    var failure: ProcessFailure? { lock.withLock { reason } }

    func attach(_ process: SpawnedProcess) {
        let pending: Bool = lock.withLock { self.process = process; return reason != nil }
        if pending { terminate(process) }
    }

    func halt(_ failure: ProcessFailure) {
        let target: SpawnedProcess?? = lock.withLock {
            if reason != nil { return .none }
            reason = failure
            return .some(process)
        }
        if case .some(let process?) = target { terminate(process) }
    }

    private func terminate(_ process: SpawnedProcess) {
        process.signalGroup(SIGTERM)
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.25) { process.signalGroup(SIGKILL) }
    }
}

/// Port of `runNativeProcess`: no shell, the minimal environment, bounded
/// time and output, and cancellation through the calling task.
public let runNativeProcess: ProcessRunner = { request in
    guard !Task.isCancelled else { throw ProcessFailure.cancelled }
    guard let executable = CLISearchPath.resolve(request.command) else { throw ProcessFailure.unavailable }
    let control = ProcessControl()
    let output = OutputBuffer(limit: request.maxOutputBytes) { control.halt(.outputLimit) }
    let process = try SpawnedProcess(executable: executable, args: request.args, environment: nativeLoginEnvironment(), cwd: request.cwd) { data, isStdout in
        output.append(data, stdout: isStdout)
    }
    control.attach(process)
    let timer = DispatchWorkItem { control.halt(.timeout) }
    DispatchQueue.global().asyncAfter(deadline: .now() + request.timeout, execute: timer)
    defer { timer.cancel() }
    // An early exit may close stdin before the prompt is written; that's fine.
    process.write(Data((request.input ?? "").utf8))
    process.closeInput()
    let code = await withTaskCancellationHandler {
        await process.wait()
    } onCancel: {
        control.halt(.cancelled)
    }
    if let failure = control.failure { throw failure }
    guard code == 0 else { throw ProcessFailure.failed }
    return output.result
}

final class OutputBuffer: @unchecked Sendable {
    private let lock = NSLock()
    private var stdout = Data(), stderr = Data()
    private let limit: Int
    private let onLimit: @Sendable () -> Void

    init(limit: Int, onLimit: @escaping @Sendable () -> Void) {
        self.limit = limit
        self.onLimit = onLimit
    }

    /// False once the total passed the limit.
    @discardableResult
    func append(_ data: Data, stdout isStdout: Bool) -> Bool {
        let over: Bool = lock.withLock {
            if stdout.count + stderr.count + data.count > limit { return true }
            if isStdout { stdout.append(data) } else { stderr.append(data) }
            return false
        }
        if over { onLimit() }
        return !over
    }

    var result: ProcessOutput {
        lock.withLock { ProcessOutput(stdout: String(decoding: stdout, as: UTF8.self), stderr: String(decoding: stderr, as: UTF8.self)) }
    }
}
