import Foundation

/// The brand a site reported (`GET /api/studio/device/brand`), kept with the
/// connection so the app shows it offline too.
public struct BrandCache: Codable, Equatable, Sendable {
    public var app: String
    public var name: String
    public var iconURL: String?
    /// The icon's bytes (PNG or SVG), at most `BrandClient.maxIconBytes`.
    public var icon: Data?
    public var fetchedAt: Date

    public init(app: String, name: String, iconURL: String?, icon: Data?, fetchedAt: Date) {
        self.app = app
        self.name = name
        self.iconURL = iconURL
        self.icon = icon
        self.fetchedAt = fetchedAt
    }
}

/// One paired site. The device key itself is in Keychain, never here.
public struct Connection: Codable, Equatable, Sendable {
    public var origin: String
    /// This Mac's name on the site.
    public var name: String
    public var deviceId: String
    /// The Location (business) that approved the pairing. Nil for a pairing
    /// adopted from the Node companion, which never saved it.
    public var businessName: String?
    public var brand: BrandCache?

    public init(origin: String, name: String, deviceId: String, businessName: String?, brand: BrandCache? = nil) {
        self.origin = origin
        self.name = name
        self.deviceId = deviceId
        self.businessName = businessName
        self.brand = brand
    }
}

public struct ConnectionsFile: Codable, Equatable, Sendable {
    public var version = 1
    /// The connection whose brand the app shows.
    public var active: String?
    public var connections: [Connection] = []

    public init(active: String? = nil, connections: [Connection] = []) {
        self.active = active
        self.connections = connections
    }

    public func connection(for origin: String) -> Connection? {
        connections.first { $0.origin == origin }
    }

    /// The active connection, or the first if the active one went away.
    public var activeConnection: Connection? {
        active.flatMap(connection(for:)) ?? connections.first
    }

    /// Adds or replaces the connection for its origin: one per site.
    public mutating func upsert(_ connection: Connection) {
        if let index = connections.firstIndex(where: { $0.origin == connection.origin }) {
            connections[index] = connection
        } else {
            connections.append(connection)
        }
        if active == nil || self.connection(for: active!) == nil { active = connection.origin }
    }

    public mutating func remove(_ origin: String) {
        connections.removeAll { $0.origin == origin }
        if active == origin { active = connections.first?.origin }
    }

    public mutating func setActive(_ origin: String) {
        guard connection(for: origin) != nil else { return }
        active = origin
    }
}

/// `connections.json` in a private folder of its own.
///
/// It's `~/Library/Application Support/Studio/Connections/connections.json`
/// rather than straight in `Studio`, because that folder is shared with the
/// asset library and is 0755; only this one is private (0700, file 0600).
public struct ConnectionStore: Sendable {
    public let directory: URL
    public var fileURL: URL { directory.appendingPathComponent("connections.json") }
    static let maxBytes = 2 * 1024 * 1024

    public init(directory: URL = ConnectionStore.defaultDirectory) {
        self.directory = directory
    }

    public static var defaultDirectory: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Studio/Connections", isDirectory: true)
    }

    /// Empty when there's no file yet. A file that isn't private, or isn't
    /// ours, is refused rather than read.
    public func load() throws -> ConnectionsFile {
        guard FileManager.default.fileExists(atPath: directory.path) else { return ConnectionsFile() }
        try PrivateFiles.checkDirectory(directory)
        guard let data = try PrivateFiles.read(fileURL, maxBytes: Self.maxBytes) else { return ConnectionsFile() }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard var file = try? decoder.decode(ConnectionsFile.self, from: data), file.version == 1 else {
            throw ConnectError("invalid_connections_file")
        }
        // Each origin once, and only valid ones.
        var seen = Set<String>()
        file.connections = file.connections.filter { AppOrigin.isValid($0.origin) && Check.isUUID($0.deviceId) && seen.insert($0.origin).inserted }
        if let active = file.active, file.connection(for: active) == nil { file.active = file.connections.first?.origin }
        return file
    }

    public func save(_ file: ConnectionsFile) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        try PrivateFiles.write(try encoder.encode(file), to: fileURL)
    }
}
