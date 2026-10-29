import Foundation

/// A connection's error, shown by its stable code. Messages from a server
/// or a CLI never end up here: they may carry credentials or untrusted text.
public struct ConnectError: Error, Equatable, Sendable, CustomStringConvertible {
    public let code: String
    /// The HTTP status of a device call that got an answer, so a revoked
    /// device (401/403) can be told apart from a network failure.
    public let httpStatus: Int?

    public init(_ code: String, httpStatus: Int? = nil) {
        self.code = code
        self.httpStatus = httpStatus
    }

    public var description: String { code }

    /// The site refused this device's key: revoked, or (Estio) the admin who
    /// approved it is no longer an admin. The server answers both with 403.
    public var isRefusedDevice: Bool { httpStatus == 401 || httpStatus == 403 }
}

/// The two sites Studio connects to.
public enum KnownSite: String, CaseIterable, Sendable {
    case estio = "https://estio.co"
    case substo = "https://substo.com"

    public var origin: String { rawValue }
    /// The built-in app name, used only until the site's brand has loaded.
    public var appName: String { self == .estio ? "Estio" : "Substo" }
    public var app: String { self == .estio ? "estio" : "substo" }

    public init?(origin: String) {
        guard let site = KnownSite.allCases.first(where: { $0.origin == origin }) else { return nil }
        self = site
    }
}

public enum AppOrigin {
    /// Port of `appOrigin` in config.ts: an https origin, or http for this
    /// Mac only, with no user, password, path, query or fragment.
    public static func validate(_ value: String) throws -> String {
        guard let components = URLComponents(string: value), let scheme = components.scheme?.lowercased(),
              var host = components.host?.lowercased(), !host.isEmpty,
              components.user == nil, components.password == nil, components.query == nil, components.fragment == nil,
              components.path == "" || components.path == "/" else {
            throw ConnectError("invalid_app_origin")
        }
        if host.contains(":"), !host.hasPrefix("[") { host = "[\(host)]" }
        let local = ["localhost", "127.0.0.1", "[::1]"].contains(host)
        guard scheme == "https" || scheme == "http" && local else { throw ConnectError("invalid_app_origin") }
        let defaultPort = scheme == "https" ? 443 : 80
        let port = components.port.flatMap { $0 == defaultPort ? nil : $0 }
        return "\(scheme)://\(host)\(port.map { ":\($0)" } ?? "")"
    }

    public static func isValid(_ value: String) -> Bool { (try? validate(value)) == value }

    /// The host, for messages ("estio.co").
    public static func host(_ origin: String) -> String {
        URLComponents(string: origin)?.host ?? origin
    }
}
