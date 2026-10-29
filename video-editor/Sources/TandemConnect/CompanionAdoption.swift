import Foundation

/// A pairing the Node companion made (`npm run start:studio-companion --
/// pair`): its `config.json` names the site, this Mac's name there and the
/// device; its key is in Keychain under the same service Studio uses.
///
/// Studio offers to use it and adopts it only when the owner says so,
/// because reading the key the first time shows a Keychain dialog. The Node
/// file stays where it is (retiring the companion is a later step).
public struct CompanionPairing: Equatable, Sendable {
    public let origin: String
    public let name: String
    public let deviceId: String
    /// A slice-1 file still holding the key itself, to move into Keychain.
    let legacyToken: String?

    public static func == (a: CompanionPairing, b: CompanionPairing) -> Bool {
        a.origin == b.origin && a.name == b.name && a.deviceId == b.deviceId && a.legacyToken == b.legacyToken
    }
}

public enum CompanionAdoption {
    public static var defaultDirectory: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Estio/StudioCompanion", isDirectory: true)
    }

    /// Port of `loadStoredConfig`: the private folder and file checks, then
    /// version 2 (origin, name, device) or, only to migrate it, version 1
    /// with the key in the file. Nil when there's no file.
    public static func read(directory: URL = defaultDirectory) throws -> CompanionPairing? {
        guard FileManager.default.fileExists(atPath: directory.path) else { return nil }
        try PrivateFiles.checkDirectory(directory)
        guard let data = try PrivateFiles.read(directory.appendingPathComponent("config.json"), maxBytes: 8192) else { return nil }
        guard let object = try? JSONValue.parse(data).object else { throw ConnectError("invalid_companion_config") }
        let version = object["version"]?.integer
        let keys = Set(object.keys)
        // `.strict()` in the schemas: no other keys.
        let expected: Set<String> = version == 1 ? ["version", "origin", "token", "name", "deviceId"] : ["version", "origin", "name", "deviceId"]
        guard version == 1 || version == 2, keys == expected,
              let rawOrigin = object["origin"]?.string, let origin = try? AppOrigin.validate(rawOrigin),
              let name = object["name"]?.string, (1...100).contains(name.count),
              let deviceId = object["deviceId"]?.string, Check.isUUID(deviceId) else {
            throw ConnectError("invalid_companion_config")
        }
        var legacyToken: String?
        if version == 1 {
            guard let token = object["token"]?.string, DeviceToken.isValid(token) else { throw ConnectError("invalid_companion_config") }
            legacyToken = token
        }
        return CompanionPairing(origin: origin, name: name, deviceId: deviceId, legacyToken: legacyToken)
    }

    /// The pairing to offer: there's a Node pairing, Studio has no
    /// connection for its site, and a key exists for it (checked without
    /// reading it, so without a dialog).
    public static func offer(directory: URL = defaultDirectory, connections: ConnectionsFile, store: DeviceTokenStore) -> CompanionPairing? {
        guard let pairing = try? read(directory: directory), connections.connection(for: pairing.origin) == nil else { return nil }
        guard pairing.legacyToken != nil || store.contains(origin: pairing.origin) else { return nil }
        return pairing
    }

    /// Reads the key (macOS may ask the owner), migrating a slice-1 file
    /// exactly as keychain.ts does: into Keychain, verified, then the file
    /// rewritten without it. Returns the connection to add.
    public static func adopt(_ pairing: CompanionPairing, directory: URL = defaultDirectory, store: DeviceTokenStore) throws -> (connection: Connection, token: String) {
        let connection = Connection(origin: pairing.origin, name: pairing.name, deviceId: pairing.deviceId, businessName: nil)
        if let legacy = pairing.legacyToken {
            try store.save(origin: pairing.origin, token: legacy)
            let config: JSONValue = ["version": 2, "origin": .string(pairing.origin), "name": .string(pairing.name), "deviceId": .string(pairing.deviceId)]
            try PrivateFiles.write(try config.data(), to: directory.appendingPathComponent("config.json"))
            return (connection, legacy)
        }
        guard let token = try store.read(origin: pairing.origin, allowPrompt: true) else { throw ConnectError("device_token_missing") }
        return (connection, token)
    }
}
