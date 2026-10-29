import Foundation

/// The brand Studio shows for a connection: what the site said, or the
/// built-in app name when it never loaded.
public struct ResolvedBrand: Equatable, Sendable {
    /// "estio", "substo", or nil for Studio's own neutral identity.
    public var app: String?
    public var name: String
    public var icon: Data?
    /// One letter for when there's no icon.
    public var monogram: String

    public init(app: String?, name: String, icon: Data?, monogram: String) {
        self.app = app
        self.name = name
        self.icon = icon
        self.monogram = monogram
    }

    public static let neutral = ResolvedBrand(app: nil, name: "Studio", icon: nil, monogram: "S")

    /// The brand for a connection, or Studio's own with none.
    public static func resolve(_ connection: Connection?) -> ResolvedBrand {
        guard let connection else { return .neutral }
        return resolve(origin: connection.origin, cache: connection.brand)
    }

    public static func resolve(origin: String, cache: BrandCache?) -> ResolvedBrand {
        let name = cache?.name ?? KnownSite(origin: origin)?.appName ?? AppOrigin.host(origin)
        let app = cache?.app ?? KnownSite(origin: origin)?.app
        let letter = name.first(where: { $0.isLetter || $0.isNumber }).map { String($0).uppercased() } ?? "S"
        return ResolvedBrand(app: app, name: name, icon: cache?.icon, monogram: letter)
    }
}

/// `GET <origin>/api/studio/device/brand` (public, no tenant data) and its
/// icon.
public enum BrandClient {
    public static let maxIconBytes = 256 * 1024

    public static func fetch(origin: String, transport: HTTPTransport, now: Date = Date()) async throws -> BrandCache {
        let origin = try AppOrigin.validate(origin)
        guard let url = URL(string: "\(origin)/api/studio/device/brand") else { throw ConnectError("brand_failed") }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let response: HTTPResponse
        do { response = try await transport.send(request, timeout: DeviceClient.timeout, maxBytes: 16 * 1024) } catch { throw ConnectError("brand_failed") }
        guard response.status == 200, response.contentType?.contains("application/json") == true,
              let envelope = try? JSONValue.parse(response.body).object, envelope["ok"] == .bool(true),
              let data = envelope["data"]?.object, let app = data["app"]?.string, ["estio", "substo"].contains(app),
              let name = data["name"]?.string, (1...100).contains(name.count) else { throw ConnectError("brand_failed", httpStatus: response.status) }
        var iconURL: String?
        var icon: Data?
        if let link = data["iconUrl"]?.string, let iconLocation = iconLocation(link, origin: origin) {
            iconURL = iconLocation.absoluteString
            icon = try? await fetchIcon(iconLocation, transport: transport)
        }
        return BrandCache(app: app, name: name, iconURL: iconURL, icon: icon, fetchedAt: now)
    }

    /// Only an icon on the same site.
    static func iconLocation(_ link: String, origin: String) -> URL? {
        guard let url = URL(string: link), let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.user == nil, components.password == nil, let scheme = components.scheme, let host = components.host,
              (try? AppOrigin.validate("\(scheme)://\(host)\(components.port.map { ":\($0)" } ?? "")")) == origin else { return nil }
        return url
    }

    static func fetchIcon(_ url: URL, transport: HTTPTransport) async throws -> Data? {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        let response = try await transport.send(request, timeout: DeviceClient.timeout, maxBytes: maxIconBytes)
        guard response.status == 200, let type = response.contentType?.lowercased(),
              ["image/png", "image/svg+xml", "image/jpeg", "image/webp", "image/x-icon", "image/vnd.microsoft.icon"].contains(where: { type.hasPrefix($0) }),
              !response.body.isEmpty, response.body.count <= maxIconBytes else { return nil }
        return response.body
    }
}
