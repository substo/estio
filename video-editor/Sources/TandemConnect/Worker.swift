import Foundation

/// `pollDelay` in poll-backoff.ts: `minimum` while work is found, doubling
/// per empty (or failed) poll up to `maximum`, half of it random.
public func pollDelay(_ streak: Int, minimum: TimeInterval, maximum: TimeInterval, random: () -> Double = { Double.random(in: 0..<1) }) -> TimeInterval {
    let ceiling = min(maximum, minimum * pow(2, Double(min(max(streak, 0), 20))))
    return ceiling / 2 + random() * ceiling / 2
}

/// What the Mac reports about itself, shared by every connection so the
/// CLIs and probes run once however many sites it's connected to.
public protocol CapabilitySource: Sendable {
    /// Waits for the first discovery.
    func load() async
    /// codex, claude, hardware, runtimes and localModels.
    func report() async -> [String: JSONValue]
    func gateInputs() async -> (power: Power?, freeDiskGb: Double?)
    /// A fresh check of one CLI (after a sign-in or sign-out).
    func readiness(_ provider: LocalProvider) async -> CLIReadiness
    func refreshReadiness() async
}

/// The real Mac: rediscovers hardware, runtimes, models and CLI sign-in
/// every 10 minutes, power and disk every minute.
public actor LocalCapabilities: CapabilitySource {
    private var providers: [LocalProvider: CLIReadiness] = [:]
    private var discovery: Discovery?
    private var loading: Task<Void, Never>?
    private var refresh: Task<Void, Never>?
    private let run: ProcessRunner

    public init(run: @escaping ProcessRunner = runNativeProcess) {
        self.run = run
    }

    public func load() async {
        if discovery != nil { return }
        if loading == nil { loading = Task { await self.refreshAll() } }
        await loading?.value
        startRefreshing()
    }

    private func refreshAll() async {
        let run = self.run
        async let codex = LocalTextAdapter(provider: .codex, run: run).readiness()
        async let claude = LocalTextAdapter(provider: .claude, run: run).readiness()
        async let found = MacDiscovery.discover(run: run)
        providers = [.codex: await codex, .claude: await claude]
        discovery = await found
    }

    private func startRefreshing() {
        guard refresh == nil else { return }
        refresh = Task {
            var elapsed: TimeInterval = 0
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 60_000_000_000)
                elapsed += 60
                if elapsed >= 600 {
                    elapsed = 0
                    await self.refreshAll()
                } else {
                    await self.refreshPowerAndDisk()
                }
            }
        }
    }

    private func refreshPowerAndDisk() async {
        let quick = await MacDiscovery.powerAndDisk(run: run)
        discovery?.hardware.freeDiskGb = quick.freeDiskGb
        discovery?.hardware.totalDiskGb = quick.totalDiskGb
        discovery?.hardware.power = quick.power
    }

    public func report() -> [String: JSONValue] {
        var out = discovery?.json ?? [:]
        for provider in LocalProvider.allCases { if let state = providers[provider] { out[provider.rawValue] = state.json } }
        return out
    }

    public func gateInputs() -> (power: Power?, freeDiskGb: Double?) {
        (discovery?.hardware.power, discovery?.hardware.freeDiskGb)
    }

    public func readiness(_ provider: LocalProvider) async -> CLIReadiness {
        await LocalTextAdapter(provider: provider, run: run).readiness()
    }

    public func refreshReadiness() async {
        let run = self.run
        async let codex = LocalTextAdapter(provider: .codex, run: run).readiness()
        async let claude = LocalTextAdapter(provider: .claude, run: run).readiness()
        providers = [.codex: await codex, .claude: await claude]
    }

    deinit { refresh?.cancel() }
}

public struct WorkerOptions: Sendable {
    public var heartbeatInterval: TimeInterval = 30
    public var pollInterval: TimeInterval = 5
    /// An idle Mac claims at most once a minute; sign-in commands ride on
    /// heartbeats, so they still arrive within 30 seconds.
    public var idlePollMax: TimeInterval = 60
    public var failurePollMax: TimeInterval = 300
    public var leaseSeconds = 120
    public var concurrency = 1
    /// `SUBSTO_CONNECT_HEARTBEAT_ONLY=1`: report and heartbeat, but never
    /// claim a job or run a sign-in command.
    public var heartbeatOnly = false
    /// How often a device the site refused keeps asking (in case an Estio
    /// admin's role comes back).
    public var refusedHeartbeatInterval: TimeInterval = 300

    public init() {}

    public static func fromEnvironment(_ environment: [String: String] = ProcessInfo.processInfo.environment) -> WorkerOptions {
        var options = WorkerOptions()
        options.heartbeatOnly = environment["SUBSTO_CONNECT_HEARTBEAT_ONLY"] == "1"
        return options
    }
}

/// A connection's state, for the menu.
public struct WorkerSnapshot: Equatable, Sendable {
    public enum Link: Equatable, Sendable {
        case connecting, online, offline
        /// The site answered 401/403: revoked in Settings (or, on Estio, the
        /// approving admin lost the role).
        case refused
    }

    public var link: Link = .connecting
    public var paused = false
    public var processingEnabled = false
    public var busy = false
    public var suspended = false
    public var heartbeatOnly = false
    public var lastHeartbeat: Date?

    public init() {}
}

public enum WorkerEvent: Sendable {
    case log([String: String])
    case snapshot(WorkerSnapshot)
}

/// Both sites use the same native CLI account on this Mac. A second
/// connection leaves its command pending on the server while a sign-in or
/// sign-out for that provider is already running.
final class ProviderCommandSlots: @unchecked Sendable {
    static let shared = ProviderCommandSlots()
    private let lock = NSLock()
    private var providers = Set<LocalProvider>()

    func acquire(_ provider: LocalProvider) -> Bool {
        lock.withLock { providers.insert(provider).inserted }
    }

    func release(_ provider: LocalProvider) {
        _ = lock.withLock { providers.remove(provider) }
    }
}

/// One connection's worker: heartbeats every 30 seconds with the Mac's
/// report, applies and acknowledges the setup from Settings, claims
/// diagnostics when the local gate allows, keeps leases alive, runs
/// sign-in commands, and drains when stopped. Port of runner.ts and the
/// companion's start command.
public actor ConnectionWorker {
    public nonisolated let workerId: String
    public nonisolated let release: String
    public nonisolated let instanceId = UUID().uuidString.lowercased()
    let client: DeviceClient
    let token: String
    let options: WorkerOptions
    let capabilities: CapabilitySource
    let settings: DeviceSettings
    let handlers: [String: JobHandler]
    let commandDependencies: (@escaping @Sendable (CommandStatus) async -> Bool) -> ProviderCommands.Dependencies
    let events: @Sendable (WorkerEvent) -> Void
    let random: @Sendable () -> Double

    private var startedAt = Date()
    private var snapshot = WorkerSnapshot()
    private var heartbeatConfirmed = false
    private var claimHealthy = false
    private var pulseTask: Task<Void, Never>?
    private var idleStreak = 0, failureStreak = 0
    private var running: [String: (task: Task<Void, Never>, abort: JobAbort)] = [:]
    private var handledCommands = Set<String>()
    private var activeCommands: [LocalProvider: Task<Void, Never>] = [:]
    private var loop: Task<Void, Never>?
    private var heartbeats: Task<Void, Never>?
    private var stopping = false
    private var nap: (continuation: CheckedContinuation<Void, Never>, timer: Task<Void, Never>)?

    public init(client: DeviceClient, token: String, deviceId: String, release: String, options: WorkerOptions,
                capabilities: CapabilitySource, settings: DeviceSettings = DeviceSettings(),
                handlers: [String: JobHandler]? = nil,
                commandDependencies: ((@escaping @Sendable (CommandStatus) async -> Bool) -> ProviderCommands.Dependencies)? = nil,
                processId: Int32 = ProcessInfo.processInfo.processIdentifier,
                random: @escaping @Sendable () -> Double = { Double.random(in: 0..<1) },
                events: @escaping @Sendable (WorkerEvent) -> Void = { _ in }) {
        self.client = client
        self.token = token
        self.workerId = "mac:\(deviceId):\(processId)"
        self.release = release
        self.options = options
        self.capabilities = capabilities
        self.settings = settings
        self.handlers = handlers ?? ["studio.diagnostic": Diagnostic.handler()]
        self.commandDependencies = commandDependencies ?? { post in
            ProviderCommands.Dependencies(post: post, readiness: { await capabilities.readiness($0) })
        }
        self.random = random
        self.events = events
        snapshot.heartbeatOnly = options.heartbeatOnly
    }

    // MARK: Lifecycle

    public func start() {
        guard loop == nil else { return }
        loop = Task { await self.runLoop() }
    }

    /// Stops claiming, aborts running work, sends a draining heartbeat and
    /// waits for jobs and commands to end.
    public func stop() async {
        stopping = true
        wake()
        await loop?.value
    }

    /// Sleep: no claims until `resume`. Work already running carries on;
    /// if its lease ran out meanwhile, its deadline stops it on wake.
    public func suspend() {
        snapshot.suspended = true
        emit()
    }

    public func resume() {
        guard snapshot.suspended else { return }
        snapshot.suspended = false
        emit()
        pulse()
        wake()
    }

    /// Sends a heartbeat soon (after one in flight).
    public func pulse() {
        Task {
            if let current = self.pulseTask { await current.value }
            await self.heartbeat()
        }
    }

    /// The login item was turned on or off: acknowledge the setup again.
    public func settingsChanged() {
        if settings.reapply() { pulse() }
    }

    public var currentSnapshot: WorkerSnapshot { snapshot }

    // MARK: The loop

    private func runLoop() async {
        await capabilities.load()
        startedAt = Date()
        await heartbeat()
        heartbeats = Task {
            while true {
                let interval = self.heartbeatInterval
                try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
                if Task.isCancelled || self.stopping { break }
                await self.heartbeat()
            }
        }
        while !stopping {
            var claimed = 0
            if !options.heartbeatOnly, !snapshot.suspended, heartbeatConfirmed, running.count < options.concurrency {
                let (power, freeDisk) = await capabilities.gateInputs()
                let gate = localGate(processingEnabled: settings.processingEnabled, paused: settings.paused, config: settings.config,
                                     power: power, freeDiskGb: freeDisk)
                var succeeded = false
                var jobs: [StudioJob] = []
                if gate.diagnostics {
                    // Only diagnostics are registered; future processing kinds
                    // must also require gate.processing.
                    do {
                        jobs = try await client.claim(token: token, workerId: workerId, limit: options.concurrency - running.count, leaseSeconds: options.leaseSeconds)
                        succeeded = true
                    } catch {
                        log("claim_failed")
                    }
                } else {
                    succeeded = true
                }
                if !succeeded { failureStreak += 1 } else { failureStreak = 0; idleStreak = jobs.isEmpty ? idleStreak + 1 : 0 }
                let changed = claimHealthy != succeeded
                claimHealthy = succeeded
                if changed { await heartbeat() }
                // A confirmed claim runs even if stopping began meanwhile.
                for job in jobs { startJob(job) }
                claimed = jobs.count
            }
            if stopping { break }
            if running.count >= options.concurrency {
                await sleep(options.pollInterval)
            } else if claimed == 0 {
                let delay = failureStreak > 0
                    ? pollDelay(failureStreak, minimum: options.pollInterval, maximum: max(options.pollInterval, options.failurePollMax), random: random)
                    : pollDelay(idleStreak - 1, minimum: options.pollInterval, maximum: max(options.pollInterval, options.idlePollMax), random: random)
                await sleep(delay)
            }
        }
        heartbeats?.cancel()
        for (_, job) in running { job.abort.fire() }
        for (_, command) in activeCommands { command.cancel() }
        // The final report goes after any pulse in flight. The server makes
        // draining final for this process.
        if let current = pulseTask { await current.value }
        await heartbeat(draining: true)
        log("worker_draining", ["running": String(running.count)])
        for (_, job) in running { await job.task.value }
        for (_, command) in activeCommands { await command.value }
    }

    private var heartbeatInterval: TimeInterval {
        snapshot.link == .refused ? options.refusedHeartbeatInterval : options.heartbeatInterval
    }

    /// Waits, unless `wake` (stop, resume) comes first.
    private func sleep(_ seconds: TimeInterval) async {
        guard !stopping else { return }
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            let timer = Task {
                try? await Task.sleep(nanoseconds: UInt64(max(seconds, 0) * 1_000_000_000))
                self.wake()
            }
            nap = (continuation, timer)
        }
    }

    private func wake() {
        guard let current = nap else { return }
        nap = nil
        current.timer.cancel()
        current.continuation.resume()
    }

    // MARK: Heartbeats

    /// One heartbeat at a time; a second call waits for the one in flight.
    func heartbeat(draining: Bool = false) async {
        if let current = pulseTask { await current.value; return }
        // Not a child task: a drain must still go out after stop.
        let task = Task { await self.sendHeartbeat(draining: draining) }
        pulseTask = task
        await task.value
        pulseTask = nil
    }

    private func sendHeartbeat(draining: Bool) async {
        let ack = settings.pendingAck
        var report = await capabilities.report()
        report["instanceId"] = .string(instanceId)
        report["platform"] = "darwin"
        report["arch"] = .string(MacDiscovery.arch)
        report["version"] = .string(release)
        report["handlers"] = .array(handlers.keys.sorted().map { .string($0) })
        report["healthy"] = .bool(claimHealthy && !draining)
        report["draining"] = .bool(draining)
        do {
            let state = try await client.heartbeat(token: token, workerId: workerId, release: release, startedAt: startedAt,
                                                   report: .object(report), configAck: ack)
            heartbeatConfirmed = true
            snapshot.link = .online
            snapshot.lastHeartbeat = Date()
            if settings.update(state, sentAck: ack) {
                log("config_applied", ["version": String(settings.appliedVersion), "status": settings.pendingAck?.status.rawValue ?? "sent"])
                pulse()
            }
            snapshot.paused = settings.paused
            snapshot.processingEnabled = settings.processingEnabled
            if let state, !options.heartbeatOnly, !stopping {
                for command in state.commands { runCommand(command) }
            }
        } catch {
            heartbeatConfirmed = false
            let refused = (error as? ConnectError)?.isRefusedDevice == true
            snapshot.link = refused ? .refused : .offline
            log(refused ? "heartbeat_refused" : "heartbeat_failed")
        }
        emit()
    }

    // MARK: Sign-in commands

    /// One at a time per provider; each command once.
    private func runCommand(_ command: ProviderCommand) {
        guard !handledCommands.contains(command.id), activeCommands[command.provider] == nil, !stopping,
              ProviderCommandSlots.shared.acquire(command.provider) else { return }
        handledCommands.insert(command.id)
        log("provider_command_started", ["kind": command.kind.rawValue, "provider": command.provider.rawValue])
        let client = self.client, token = self.token, workerId = self.workerId
        let deps = commandDependencies { status in
            (try? await client.command(token: token, workerId: workerId, status: status)) ?? true
        }
        activeCommands[command.provider] = Task {
            let status = await ProviderCommands.execute(command, deps)
            await self.commandFinished(command, status: status)
        }
    }

    private func commandFinished(_ command: ProviderCommand, status: CommandStatus.Status) async {
        log("provider_command_finished", ["kind": command.kind.rawValue, "provider": command.provider.rawValue, "status": status.rawValue])
        activeCommands[command.provider] = nil
        ProviderCommandSlots.shared.release(command.provider)
        await capabilities.refreshReadiness()
        pulse()
    }

    // MARK: Jobs

    private func startJob(_ job: StudioJob) {
        let abort = JobAbort()
        let task = Task {
            await JobRun.run(job, client: self.client, token: self.token, workerId: self.workerId, leaseSeconds: self.options.leaseSeconds,
                             handler: self.handlers[job.kind], abort: abort) { event, fields in
                self.events(.log(["event": event].merging(fields) { $1 }))
            }
            self.jobFinished(job.id)
        }
        running[job.id] = (task, abort)
        snapshot.busy = true
        emit()
    }

    private func jobFinished(_ id: String) {
        running[id] = nil
        snapshot.busy = !running.isEmpty
        emit()
        wake()
    }

    // MARK: Reporting

    private func emit() { events(.snapshot(snapshot)) }

    private func log(_ event: String, _ fields: [String: String] = [:]) {
        events(.log(["event": event].merging(fields) { $1 }))
    }
}

/// Stops one job: its lease ran out, a renewal failed or the worker is
/// stopping.
final class JobAbort: @unchecked Sendable {
    private let lock = NSLock()
    private var fired = false
    private var handler: Task<JSONValue, Error>?
    private var deadline: Task<Void, Never>?

    var aborted: Bool { lock.withLock { fired } }

    func fire() {
        let (handler, deadline): (Task<JSONValue, Error>?, Task<Void, Never>?) = lock.withLock {
            fired = true
            return (self.handler, self.deadline)
        }
        handler?.cancel()
        deadline?.cancel()
    }

    func attach(_ task: Task<JSONValue, Error>) {
        let already: Bool = lock.withLock { handler = task; return fired }
        if already { task.cancel() }
    }

    /// Aborts after `seconds`, replacing the previous deadline.
    func arm(_ seconds: TimeInterval) {
        guard seconds.isFinite, seconds > 0 else { fire(); return }
        let timer = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            if !Task.isCancelled { self?.fire() }
        }
        let old: Task<Void, Never>? = lock.withLock {
            let previous = deadline
            deadline = timer
            return previous
        }
        old?.cancel()
    }

    func disarm() {
        let timer: Task<Void, Never>? = lock.withLock { let t = deadline; deadline = nil; return t }
        timer?.cancel()
    }
}

final class Flag: @unchecked Sendable {
    private let lock = NSLock()
    private var value = false
    func set() { lock.withLock { value = true } }
    var isSet: Bool { lock.withLock { value } }
}

/// Port of `runStudioJob`: keep the lease alive, then record success or a
/// classified failure. A lost lease records nothing.
enum JobRun {
    static func run(_ job: StudioJob, client: DeviceClient, token: String, workerId: String, leaseSeconds: Int,
                    handler: JobHandler?, abort: JobAbort, log: @escaping @Sendable (String, [String: String]) -> Void) async {
        let lease = TimeInterval(leaseSeconds)
        let finished = Flag()
        let fields = ["jobId": job.id, "kind": job.kind]
        abort.arm(min(lease, job.leaseExpiresAt.map { $0.timeIntervalSinceNow } ?? .infinity))
        // Fail closed on transport errors; the deadline aborts even if a
        // renewal hangs.
        let renewal = Task {
            while true {
                try? await Task.sleep(nanoseconds: UInt64(max(1, lease / 3) * 1_000_000_000))
                if Task.isCancelled || finished.isSet || abort.aborted { return }
                let requestedAt = Date()
                do {
                    let held = try await client.extend(token: token, jobId: job.id, workerId: workerId, leaseSeconds: leaseSeconds, leaseToken: job.leaseToken)
                    if finished.isSet || abort.aborted { return }
                    if !held { abort.fire(); return }
                    // From when the request started, never from the reply.
                    abort.arm(requestedAt.addingTimeInterval(lease).timeIntervalSinceNow)
                } catch {
                    abort.fire()
                    return
                }
            }
        }
        defer {
            finished.set()
            renewal.cancel()
            abort.disarm()
        }
        if abort.aborted { return log("job_lease_lost", fields) }
        do {
            guard let handler else { throw JobError("unknown_job_kind", "This job type is not supported by the worker.", retryable: false) }
            let work = Task { try await handler(job, JobContext(workerId: workerId)) }
            abort.attach(work)
            let result = try await work.value
            if abort.aborted { return log("job_lease_lost", fields) }
            let recorded = try await client.complete(token: token, jobId: job.id, workerId: workerId, result: result, leaseToken: job.leaseToken)
            log(recorded ? "job_succeeded" : "job_lease_lost", fields)
        } catch {
            if abort.aborted { return log("job_lease_lost", fields) }
            let failure = (error as? JobError).map { JobFailure(code: $0.code, message: $0.message, retryable: $0.retryable, retryAfterSeconds: $0.retryAfterSeconds) }
                ?? JobFailure(code: "unexpected_error", message: "The worker hit an unexpected error. It will retry.", retryable: true)
            let outcome = (try? await client.fail(token: token, jobId: job.id, workerId: workerId, failure: failure, leaseToken: job.leaseToken)) ?? "report_failed"
            log("job_failed", fields.merging(["code": failure.code, "outcome": outcome]) { $1 })
        }
    }
}
