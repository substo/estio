import AppKit
import ServiceManagement
import TandemConnect

/// What the active connection shows around the app: the welcome window's
/// brand line and the About panel.
@MainActor
@Observable
final class BrandPresence {
    static let shared = BrandPresence()
    var brand = ResolvedBrand.neutral
    /// "Connected to Estio · Acme Ltd", or nil with no connection.
    var line: String?
}

/// Studio's connections to estio.co and substo.com: pairing, one worker
/// per site, the active site's brand, and what the menu-bar menu does.
@MainActor
final class ConnectionsController {
    static let shared = ConnectionsController()

    private let store = ConnectionStore()
    private let tokens: DeviceTokenStore = KeychainTokenStore()
    private let transport = URLSessionTransport()
    private let capabilities = LocalCapabilities()
    private let options = WorkerOptions.fromEnvironment()
    private(set) var file = ConnectionsFile()
    private var workers: [String: ConnectionWorker] = [:]
    private var snapshots: [String: WorkerSnapshot] = [:]
    /// Connections whose key couldn't be read at launch.
    private var keyProblems: [String: ConnectionStatus] = [:]
    private var pairings: [String: (task: Task<Void, Never>, code: String?, url: URL?)] = [:]
    private var problems: [String: String] = [:]
    private var adoptable: CompanionPairing?
    private var started = false

    /// Called after anything the menu or the brand shows changes.
    var onChange: (() -> Void)?

    /// `studio-mac-<version>`: the release and version the site shows.
    let release = "studio-mac-\(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev")"

    var heartbeatOnly: Bool { options.heartbeatOnly }

    func start() {
        guard !started else { return }
        started = true
        do {
            file = try store.load()
        } catch {
            NSLog("Studio connect: couldn't read the connections file (%@); starting with none", "\(error)")
        }
        // Checked without reading the key, so without a Keychain dialog.
        adoptable = CompanionAdoption.offer(connections: file, store: tokens)
        for connection in file.connections { startWorker(connection, token: nil) }
        for connection in file.connections { refreshBrand(connection.origin) }
        observeSleep()
        changed()
    }

    // MARK: - State for the menu and the brand

    var activeBrand: ResolvedBrand { ResolvedBrand.resolve(file.activeConnection) }

    func brand(for origin: String) -> ResolvedBrand {
        ResolvedBrand.resolve(origin: origin, cache: file.connection(for: origin)?.brand ?? pendingBrands[origin])
    }

    func status(of origin: String) -> ConnectionStatus {
        if let problem = keyProblems[origin] { return problem }
        return snapshots[origin].map(ConnectionStatus.from) ?? .connecting
    }

    var menuState: ConnectMenuState {
        var state = ConnectMenuState()
        state.rows = file.connections.map { connection in
            .init(origin: connection.origin, brand: brand(for: connection.origin).name,
                  place: connection.businessName ?? connection.name, status: status(of: connection.origin))
        }
        state.active = file.activeConnection?.origin
        state.pairings = pairings.keys.sorted().map { .init(origin: $0, brand: brand(for: $0).name, code: pairings[$0]?.code) }
        state.problems = problems
        state.adoptable = adoptable?.origin
        state.loginItem = Self.loginItemState
        state.heartbeatOnly = options.heartbeatOnly
        return state
    }

    /// One line for tooltips and About: "Connected to Estio · Acme Ltd".
    var activeLine: String? {
        guard let connection = file.activeConnection else { return nil }
        return "Connected to \(brand(for: connection.origin).name) · \(connection.businessName ?? connection.name)"
    }

    private func changed() {
        BrandPresence.shared.brand = activeBrand
        BrandPresence.shared.line = activeLine
        NSApp.applicationIconImage = BrandImages.dockIcon(activeBrand)
        onChange?()
    }

    private func save() {
        do { try store.save(file) } catch { NSLog("Studio connect: couldn't save the connections file (%@)", "\(error)") }
    }

    // MARK: - Menu actions

    func perform(_ action: ConnectMenuAction) {
        switch action {
        case .makeActive(let origin):
            file.setActive(origin)
            save()
            changed()
        case .connect(let origin): connect(origin)
        case .cancelPairing(let origin): pairings[origin]?.task.cancel()
        case .openApproval(let origin):
            if let url = pairings[origin]?.url { NSWorkspace.shared.open(url) }
        case .adopt(let origin): adopt(origin)
        case .allowKeychain(let origin): allowKeychain(origin)
        case .disconnect(let origin): disconnect(origin)
        case .openWeb(let origin):
            if let url = URL(string: "\(origin)/studio") { NSWorkspace.shared.open(url) }
        case .openEditor:
            ProjectDocuments.shared.showWelcome()
            NSApp.activate()
        case .toggleLaunchAtLogin: toggleLaunchAtLogin()
        case .openLoginItemsSettings: SMAppService.openSystemSettingsLoginItems()
        case .quit: NSApp.terminate(nil)
        }
    }

    // MARK: - Workers

    /// Starts a site's worker. With no key given, it's read without a
    /// Keychain dialog; one macOS would ask about waits for the owner.
    private func startWorker(_ connection: Connection, token given: String?) {
        let origin = connection.origin
        guard workers[origin] == nil else { return }
        let token: String
        if let given {
            token = given
        } else {
            do {
                guard let stored = try tokens.read(origin: origin, allowPrompt: false) else {
                    keyProblems[origin] = .missingKey
                    return
                }
                token = stored
            } catch {
                keyProblems[origin] = .needsKeychainAccess
                return
            }
        }
        keyProblems[origin] = nil
        guard let client = try? DeviceClient(origin: origin, transport: transport) else { return }
        let host = AppOrigin.host(origin)
        let worker = ConnectionWorker(client: client, token: token, deviceId: connection.deviceId, release: release, options: options,
                                      capabilities: capabilities, settings: DeviceSettings(launchAtLogin: { Self.isLoginItem }), events: { [weak self] event in
            switch event {
            case .log(let fields):
                // Event names, job IDs and codes only: never keys or replies.
                NSLog("Studio connect %@: %@", host, fields.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: " "))
            case .snapshot(let snapshot):
                Task { @MainActor in
                    guard let self, self.workers[origin] != nil else { return }
                    self.snapshots[origin] = snapshot
                    self.onChange?()
                }
            }
        })
        workers[origin] = worker
        snapshots[origin] = nil
        Task { await worker.start() }
    }

    private func stopWorker(_ origin: String) async {
        guard let worker = workers.removeValue(forKey: origin) else { return }
        snapshots[origin] = nil
        await worker.stop()
    }

    /// Quitting: every worker stops claiming and sends a draining heartbeat.
    func drain() async {
        let all = Array(workers.values)
        workers = [:]
        await withTaskGroup(of: Void.self) { group in
            for worker in all { group.addTask { await worker.stop() } }
        }
    }

    var hasWorkers: Bool { !workers.isEmpty }

    private func observeSleep() {
        let center = NSWorkspace.shared.notificationCenter
        center.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { for worker in ConnectionsController.shared.workers.values { Task { await worker.suspend() } } }
        }
        center.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { for worker in ConnectionsController.shared.workers.values { Task { await worker.resume() } } }
        }
    }

    // MARK: - Brand

    private var pendingBrands: [String: BrandCache] = [:]

    /// Fetches a site's brand. A failure keeps what was cached, and the
    /// built-in name only shows when it never loaded.
    private func refreshBrand(_ origin: String) {
        let transport = self.transport
        Task {
            guard let fetched = try? await BrandClient.fetch(origin: origin, transport: transport) else { return }
            var brand = fetched
            let old = file.connection(for: origin)?.brand ?? pendingBrands[origin]
            if brand.icon == nil, old?.iconURL == brand.iconURL { brand.icon = old?.icon }
            if var connection = file.connection(for: origin) {
                guard connection.brand != brand else { return }
                connection.brand = brand
                file.upsert(connection)
                save()
            } else {
                pendingBrands[origin] = brand
            }
            changed()
        }
    }

    // MARK: - Pairing

    private func connect(_ origin: String) {
        guard pairings[origin] == nil, file.connection(for: origin) == nil, let client = try? DeviceClient(origin: origin, transport: transport) else { return }
        problems[origin] = nil
        refreshBrand(origin)
        let name = Pairing.deviceName()
        let tokens = self.tokens
        let task = Task {
            do {
                let started = try await Pairing.begin(client: client, name: name)
                pairings[origin]?.code = started.userCode
                pairings[origin]?.url = started.approvalURL
                onChange?()
                NSWorkspace.shared.open(started.approvalURL)
                var (connection, token) = try await Pairing.waitForApproval(started, client: client, name: name, store: tokens)
                connection.brand = pendingBrands.removeValue(forKey: origin)
                file.upsert(connection)
                save()
                adoptable = adoptable?.origin == origin ? nil : adoptable
                startWorker(connection, token: token)
                refreshBrand(origin)
            } catch is CancellationError {
                // Cancelled from the menu.
            } catch {
                if !Task.isCancelled { problems[origin] = ConnectMenuModel.problem((error as? ConnectError)?.code ?? "") }
            }
            pairings[origin] = nil
            changed()
        }
        pairings[origin] = (task, nil, nil)
        changed()
    }

    // MARK: - Keychain

    /// Reads a key the owner asked for: macOS may show its dialog.
    private func readWithPrompt(_ origin: String) async throws -> String? {
        let tokens = self.tokens
        return try await Task.detached { try tokens.read(origin: origin, allowPrompt: true) }.value
    }

    private func allowKeychain(_ origin: String) {
        guard let connection = file.connection(for: origin) else { return }
        Task {
            do {
                guard let token = try await readWithPrompt(origin) else {
                    keyProblems[origin] = .missingKey
                    return changed()
                }
                keyProblems[origin] = nil
                startWorker(connection, token: token)
            } catch {
                keyProblems[origin] = .needsKeychainAccess
            }
            changed()
        }
    }

    private func adopt(_ origin: String) {
        guard let pairing = adoptable, pairing.origin == origin else { return }
        let alert = NSAlert()
        alert.messageText = "Use the existing \(AppOrigin.host(origin)) pairing?"
        alert.informativeText = "This Mac was paired with \(AppOrigin.host(origin)) by the Studio companion in Terminal. Studio will use that pairing and its key in Keychain. macOS will ask whether Studio may use the key: enter your login password and choose Always Allow."
        alert.addButton(withTitle: "Use pairing")
        alert.addButton(withTitle: "Cancel")
        NSApp.activate()
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let tokens = self.tokens
        Task {
            do {
                let adopted = try await Task.detached { try CompanionAdoption.adopt(pairing, store: tokens) }.value
                file.upsert(adopted.connection)
                save()
                adoptable = nil
                startWorker(adopted.connection, token: adopted.token)
                refreshBrand(origin)
            } catch {
                problems[origin] = ConnectMenuModel.problem((error as? ConnectError)?.code ?? "keychain_access_denied")
            }
            changed()
        }
    }

    // MARK: - Disconnect

    private func disconnect(_ origin: String) {
        guard let connection = file.connection(for: origin) else { return }
        let brand = brand(for: origin).name
        let alert = NSAlert()
        alert.messageText = "Disconnect Studio from \(brand)?"
        alert.informativeText = "This Mac stops working for \(connection.businessName ?? brand), and Studio forgets its key for \(AppOrigin.host(origin)). The computer stays listed in Studio → Settings → Connected computer on \(AppOrigin.host(origin)) until you revoke it there."
        alert.addButton(withTitle: "Disconnect")
        alert.addButton(withTitle: "Cancel")
        NSApp.activate()
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        Task {
            await stopWorker(origin)
            do { try tokens.remove(origin: origin) } catch { NSLog("Studio connect: couldn't remove the %@ key from Keychain", AppOrigin.host(origin)) }
            keyProblems[origin] = nil
            file.remove(origin)
            save()
            adoptable = CompanionAdoption.offer(connections: file, store: tokens)
            changed()
        }
    }

    // MARK: - Launch at login

    nonisolated static var isLoginItem: Bool { SMAppService.mainApp.status == .enabled }

    static var loginItemState: LoginItemState {
        switch SMAppService.mainApp.status {
        case .enabled: return .enabled
        case .requiresApproval: return .requiresApproval
        default: return .disabled
        }
    }

    private func toggleLaunchAtLogin() {
        do {
            if SMAppService.mainApp.status == .notRegistered || SMAppService.mainApp.status == .notFound {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
        } catch {
            let alert = NSAlert()
            alert.messageText = "Couldn't change Launch at login"
            alert.informativeText = "macOS didn't allow it. You can add Studio in System Settings → General → Login Items."
            alert.runModal()
        }
        for worker in workers.values { Task { await worker.settingsChanged() } }
        changed()
    }
}

/// Whether macOS opened Studio as a login item: then it opens no windows.
enum LaunchKind {
    static func isLoginItemLaunch(_ event: NSAppleEventDescriptor?) -> Bool {
        guard let event, event.eventClass == AEEventClass(kCoreEventClass), event.eventID == AEEventID(kAEOpenApplication) else { return false }
        return event.paramDescriptor(forKeyword: AEKeyword(keyAEPropData))?.enumCodeValue == OSType(keyAELaunchedAsLogInItem)
    }
}
