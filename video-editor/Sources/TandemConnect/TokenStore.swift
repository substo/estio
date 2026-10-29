import Foundation
import Security

public enum DeviceToken {
    public static let pattern = "^studio_device_[A-Za-z0-9_-]{43}$"
    public static func isValid(_ value: String) -> Bool { Check.matches(value, pattern) }
}

/// Where device keys live, one per site (the origin is the account).
public protocol DeviceTokenStore: Sendable {
    func save(origin: String, token: String) throws
    /// The key, or nil when there is none. With `allowPrompt` false it
    /// never shows a Keychain dialog: an item macOS would ask about throws
    /// `keychain_access_needed` instead.
    func read(origin: String, allowPrompt: Bool) throws -> String?
    /// Whether there's a key, without reading it (never asks).
    func contains(origin: String) -> Bool
    func remove(origin: String) throws
}

/// For tests: never the real Keychain.
public final class MemoryTokenStore: DeviceTokenStore, @unchecked Sendable {
    private let lock = NSLock()
    private var items: [String: String] = [:]
    /// Origins whose key reads as if macOS would ask first.
    public var promptingOrigins: Set<String> = []
    public var failWrites = false

    public init(_ items: [String: String] = [:]) { self.items = items }

    public func save(origin: String, token: String) throws {
        guard DeviceToken.isValid(token) else { throw ConnectError("invalid_device_token") }
        let account = try AppOrigin.validate(origin)
        try lock.withLock {
            if failWrites { throw ConnectError("keychain_write_failed") }
            items[account] = token
        }
    }

    public func read(origin: String, allowPrompt: Bool) throws -> String? {
        try lock.withLock {
            if !allowPrompt, promptingOrigins.contains(origin), items[origin] != nil { throw ConnectError("keychain_access_needed") }
            return items[origin].flatMap { DeviceToken.isValid($0) ? $0 : nil }
        }
    }

    public func contains(origin: String) -> Bool { lock.withLock { items[origin] != nil } }

    public func remove(origin: String) throws { _ = lock.withLock { items.removeValue(forKey: origin) } }

    public var all: [String: String] { lock.withLock { items } }
}

/// The login Keychain, with the Node companion's service and account
/// (`com.estio.studio-companion.device-token`, account = origin), so a
/// pairing either of them made works for both.
///
/// An item the Node companion made through `/usr/bin/security` trusts only
/// that tool, so the first time Studio reads it macOS asks the owner to
/// allow it ("Studio wants to use your confidential information stored in
/// com.estio.studio-companion.device-token in your keychain", with the login
/// password, Always Allow, Deny and Allow). Studio reads keys without a
/// dialog at launch and only reads with one when the owner asked for it in
/// the menu.
public struct KeychainTokenStore: DeviceTokenStore {
    public static let service = "com.estio.studio-companion.device-token"
    /// `SecKeychainSetUserInteractionAllowed` is process wide: one read at a
    /// time changes it.
    private static let interaction = NSLock()

    public init() {}

    private func query(_ origin: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: Self.service,
         kSecAttrAccount as String: origin]
    }

    public func save(origin: String, token: String) throws {
        guard DeviceToken.isValid(token) else { throw ConnectError("invalid_device_token") }
        let account = try AppOrigin.validate(origin)
        let data = Data(token.utf8)
        var status = SecItemUpdate(query(account) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var add = query(account)
            add[kSecValueData as String] = data
            add[kSecAttrLabel as String] = Self.service
            status = SecItemAdd(add as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw ConnectError("keychain_write_failed") }
        // Like the Node companion: a write that silently didn't happen is
        // caught by reading it back.
        guard (try? read(origin: account, allowPrompt: true)) == token else { throw ConnectError("keychain_write_failed") }
    }

    public func read(origin: String, allowPrompt: Bool) throws -> String? {
        let account = try AppOrigin.validate(origin)
        var request = query(account)
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status: OSStatus
        if allowPrompt {
            status = SecItemCopyMatching(request as CFDictionary, &result)
        } else {
            // kSecUseAuthenticationUIFail alone still shows the legacy
            // Keychain's access dialog (checked on macOS 15); turning user
            // interaction off makes the read fail instead.
            status = Self.interaction.withLock {
                SecKeychainSetUserInteractionAllowed(false)
                defer { SecKeychainSetUserInteractionAllowed(true) }
                return SecItemCopyMatching(request as CFDictionary, &result)
            }
        }
        switch status {
        case errSecSuccess:
            guard let data = result as? Data, let token = String(data: data, encoding: .utf8) else { return nil }
            return DeviceToken.isValid(token) ? token : nil
        case errSecItemNotFound:
            return nil
        case errSecInteractionNotAllowed, errSecAuthFailed:
            if !allowPrompt { throw ConnectError("keychain_access_needed") }
            throw ConnectError("keychain_read_failed")
        case errSecUserCanceled:
            throw ConnectError("keychain_access_denied")
        default:
            throw ConnectError("keychain_read_failed")
        }
    }

    public func contains(origin: String) -> Bool {
        guard let account = try? AppOrigin.validate(origin) else { return false }
        var request = query(account)
        // Attributes only: reading them never needs the owner's say.
        request[kSecReturnAttributes as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        return SecItemCopyMatching(request as CFDictionary, &result) == errSecSuccess
    }

    public func remove(origin: String) throws {
        let account = try AppOrigin.validate(origin)
        let status = SecItemDelete(query(account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw ConnectError("keychain_remove_failed") }
    }
}
