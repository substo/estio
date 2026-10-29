import Foundation

/// Device-started, browser-approved pairing (pairing.ts): the site gives a
/// short code and an approval page; an admin approves this Mac for their
/// Location; polling then returns the device key once.
public enum Pairing {
    public static let platform = "darwin"
    /// The Node companion never waits longer than this, whatever the site says.
    public static let maxWait: TimeInterval = 15 * 60

    /// This Mac's name as Settings shows it, like "Martin's MacBook Air".
    public static func deviceName(_ localizedName: String? = Host.current().localizedName) -> String {
        let cleaned = (localizedName ?? "").unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }
        let name = String(String.UnicodeScalarView(cleaned)).trimmingCharacters(in: .whitespacesAndNewlines)
        let short = String(name.prefix(100)).trimmingCharacters(in: .whitespacesAndNewlines)
        return short.isEmpty ? "Mac" : short
    }

    /// Only an approval page on the site being paired, never one the server
    /// chose elsewhere.
    public static func approvalURL(_ start: PairStart, origin: String) throws -> URL {
        guard let components = URLComponents(string: start.verificationUrl), let url = components.url,
              components.user == nil, components.password == nil, components.path == "/studio/settings/computer",
              let scheme = components.scheme, let host = components.host,
              (try? AppOrigin.validate("\(scheme)://\(host)\(components.port.map { ":\($0)" } ?? "")")) == origin else {
            throw ConnectError("invalid_pairing_url")
        }
        return url
    }

    /// A Location name safe to show: letters, digits and simple punctuation.
    public static func printable(_ value: String) -> String {
        let kept = value.unicodeScalars.filter { scalar in
            scalar.properties.isAlphabetic || scalar.properties.numericType != nil || " .,'&()_-".unicodeScalars.contains(scalar)
        }
        return String(String(String.UnicodeScalarView(kept)).prefix(100))
    }

    public struct Started: Sendable {
        public let start: PairStart
        public let approvalURL: URL
        public var userCode: String { start.userCode }
    }

    /// Asks the site for a code and checks the approval page.
    public static func begin(client: DeviceClient, name: String) async throws -> Started {
        let start = try await client.startPairing(name: name, platform: platform)
        return Started(start: start, approvalURL: try approvalURL(start, origin: client.origin))
    }

    /// Polls at the site's interval until approval, denial or expiry, then
    /// saves the key to Keychain before anything else. Cancelling the task
    /// stops it.
    public static func waitForApproval(_ started: Started, client: DeviceClient, name: String, store: DeviceTokenStore,
                                       now: @Sendable () -> Date = { Date() },
                                       sleep: @Sendable (TimeInterval) async throws -> Void = { try await Task.sleep(nanoseconds: UInt64($0 * 1_000_000_000)) }) async throws -> (connection: Connection, token: String) {
        let start = started.start
        let expiresAt = min(start.expiresAt, now().addingTimeInterval(maxWait))
        while now() < expiresAt {
            try await sleep(TimeInterval(start.intervalSeconds))
            try Task.checkCancellation()
            let result: PairPoll
            do {
                result = try await client.pollPairing(pairingId: start.pairingId, deviceCode: start.deviceCode)
            } catch {
                // A network blip or rate limit: keep polling until expiry.
                continue
            }
            switch result {
            case .pending: continue
            case .denied: throw ConnectError("pairing_denied")
            case .expired: throw ConnectError("pairing_expired")
            case .consumed: throw ConnectError("pairing_consumed")
            case .approved(let token, let deviceId, let businessName):
                try store.save(origin: client.origin, token: token)
                let business = printable(businessName)
                return (Connection(origin: client.origin, name: name, deviceId: deviceId, businessName: business.isEmpty ? nil : business), token)
            }
        }
        throw ConnectError("pairing_expired")
    }
}
