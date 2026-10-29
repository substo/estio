import Foundation

/// A connection's status as the menu shows it.
public enum ConnectionStatus: Equatable, Sendable {
    case connecting, online, busy, paused, offline, revoked, sleeping
    /// The key is in Keychain but macOS asks before Studio may read it.
    case needsKeychainAccess
    /// Its key is gone from Keychain.
    case missingKey

    public static func from(_ snapshot: WorkerSnapshot) -> ConnectionStatus {
        switch snapshot.link {
        case .refused: return .revoked
        case .connecting: return .connecting
        case .offline: return .offline
        case .online:
            if snapshot.suspended { return .sleeping }
            if snapshot.paused { return .paused }
            return snapshot.busy ? .busy : .online
        }
    }

    public func text(host: String) -> String {
        switch self {
        case .connecting: return "Connecting…"
        case .online: return "Online"
        case .busy: return "Busy: running a job"
        case .paused: return "Paused in Settings"
        case .offline: return "Offline: can't reach \(host)"
        case .revoked: return "Disconnected by the site (revoked)"
        case .sleeping: return "Asleep: not taking jobs"
        case .needsKeychainAccess: return "Allow Keychain access…"
        case .missingKey: return "Key missing from Keychain: connect again"
        }
    }
}

public enum LoginItemState: Equatable, Sendable {
    case enabled, disabled, requiresApproval, unavailable
}

public enum ConnectMenuAction: Equatable, Sendable {
    case makeActive(String)
    case connect(String)
    case cancelPairing(String)
    case openApproval(String)
    case adopt(String)
    case allowKeychain(String)
    case disconnect(String)
    case openWeb(String)
    case openEditor
    case toggleLaunchAtLogin
    case openLoginItemsSettings
    case quit
}

public struct ConnectMenuEntry: Equatable, Sendable {
    public enum Kind: Equatable, Sendable { case item, separator }
    public var kind: Kind
    public var title: String
    public var action: ConnectMenuAction?
    public var checked: Bool
    public var indent: Int
    /// The origin whose brand icon goes beside it.
    public var iconOrigin: String?

    public static let separator = ConnectMenuEntry(kind: .separator, title: "", action: nil, checked: false, indent: 0, iconOrigin: nil)

    public static func item(_ title: String, _ action: ConnectMenuAction?, checked: Bool = false, indent: Int = 0, icon: String? = nil) -> ConnectMenuEntry {
        ConnectMenuEntry(kind: .item, title: title, action: action, checked: checked, indent: indent, iconOrigin: icon)
    }

    public var isEnabled: Bool { action != nil }
}

/// Everything the menu-bar menu is made from.
public struct ConnectMenuState: Equatable, Sendable {
    public struct Row: Equatable, Sendable {
        public var origin: String
        public var brand: String
        /// The Location, or this Mac's name when it isn't known.
        public var place: String
        public var status: ConnectionStatus

        public init(origin: String, brand: String, place: String, status: ConnectionStatus) {
            self.origin = origin
            self.brand = brand
            self.place = place
            self.status = status
        }
    }

    public struct PendingPairing: Equatable, Sendable {
        public var origin: String
        public var brand: String
        /// Nil until the site has answered with one.
        public var code: String?

        public init(origin: String, brand: String, code: String?) {
            self.origin = origin
            self.brand = brand
            self.code = code
        }
    }

    public var rows: [Row] = []
    public var active: String?
    public var pairings: [PendingPairing] = []
    /// The last pairing problem per site, shown under its Connect item.
    public var problems: [String: String] = [:]
    /// A Node companion pairing Studio could use.
    public var adoptable: String?
    public var loginItem: LoginItemState = .disabled
    public var heartbeatOnly = false

    public init() {}
}

/// Pure: state in, menu entries out.
public enum ConnectMenuModel {
    public static func entries(_ state: ConnectMenuState) -> [ConnectMenuEntry] {
        var out: [ConnectMenuEntry] = []
        let suffix = state.heartbeatOnly ? " (heartbeat only)" : ""
        for row in state.rows {
            out.append(.item("\(row.brand) · \(row.place)", .makeActive(row.origin), checked: row.origin == state.active, icon: row.origin))
            let action: ConnectMenuAction? = row.status == .needsKeychainAccess ? .allowKeychain(row.origin) : nil
            let extra = [ConnectionStatus.online, .busy].contains(row.status) ? suffix : ""
            out.append(.item(row.status.text(host: AppOrigin.host(row.origin)) + extra, action, indent: 1))
        }
        for pairing in state.pairings {
            out.append(.item("\(pairing.brand) · waiting for approval", pairing.code == nil ? nil : .openApproval(pairing.origin), icon: pairing.origin))
            if let code = pairing.code {
                out.append(.item("Code \(code): open the approval page", .openApproval(pairing.origin), indent: 1))
            } else {
                out.append(.item("Asking \(AppOrigin.host(pairing.origin)) for a code…", nil, indent: 1))
            }
            out.append(.item("Cancel", .cancelPairing(pairing.origin), indent: 1))
        }
        if !out.isEmpty { out.append(.separator) }

        var connecting: [ConnectMenuEntry] = []
        let taken = Set(state.rows.map(\.origin) + state.pairings.map(\.origin))
        for site in KnownSite.allCases where !taken.contains(site.origin) {
            connecting.append(.item("Connect to \(site.appName)…", .connect(site.origin)))
            if let problem = state.problems[site.origin] { connecting.append(.item(problem, nil, indent: 1)) }
        }
        if let origin = state.adoptable, !taken.contains(origin) {
            connecting.append(.item("Use this Mac's existing \(AppOrigin.host(origin)) pairing…", .adopt(origin)))
        }
        if !connecting.isEmpty { out += connecting + [.separator] }

        if let active = state.active, state.rows.contains(where: { $0.origin == active }) {
            out.append(.item("Open Studio on the web", .openWeb(active)))
        }
        out.append(.item("Open editor", .openEditor))
        out.append(.separator)

        switch state.loginItem {
        case .enabled: out.append(.item("Launch at login", .toggleLaunchAtLogin, checked: true))
        case .disabled: out.append(.item("Launch at login", .toggleLaunchAtLogin))
        case .requiresApproval:
            out.append(.item("Launch at login", .toggleLaunchAtLogin, checked: true))
            out.append(.item("Allow it in System Settings…", .openLoginItemsSettings, indent: 1))
        case .unavailable: out.append(.item("Launch at login (not available for this copy)", nil))
        }
        for row in state.rows { out.append(.item("Disconnect \(row.brand)…", .disconnect(row.origin))) }
        out.append(.separator)
        if state.heartbeatOnly { out.append(.item("Test mode: heartbeats only, no jobs or sign-ins", nil)) }
        out.append(.item("Quit Studio", .quit))
        return out
    }

    /// What a pairing problem says, by its code.
    public static func problem(_ code: String) -> String {
        switch code {
        case "pairing_denied": return "Pairing was denied in the browser."
        case "pairing_expired": return "The code expired. Connect again."
        case "pairing_consumed": return "That pairing was already used. Connect again."
        case "invalid_pairing_url": return "The site sent an unexpected approval link, so Studio stopped."
        case "keychain_write_failed": return "Couldn't save the key to Keychain."
        case "keychain_access_denied": return "Keychain access was denied."
        case "device_token_missing": return "The old pairing's key isn't in Keychain."
        default: return "Couldn't start pairing. Check your connection."
        }
    }
}
