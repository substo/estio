import Foundation

/// The setup saved in Settings → Connected computer (`StudioDeviceConfig`
/// in devices-policy.ts).
public struct DeviceConfig: Equatable, Sendable {
    public struct WorkingHours: Equatable, Sendable {
        public var start: String
        public var end: String
        public var timeZone: String
    }

    public var transcription = false
    public var text = false
    public var languages = ["en"]
    public var translationTargets: [String] = []
    public var preference = "balanced"
    public var textProvider: String?
    public var textModel: String?
    public var modelBudgetGb: Double = 20
    public var minFreeDiskGb: Double = 20
    public var allowOnBattery = false
    public var launchAtLogin = false
    public var workingHours: WorkingHours?

    public init() {}

    public static let defaults = DeviceConfig()

    /// Port of `readDeviceConfig`: exact keys, values in range, languages
    /// canonicalised. Throws on anything else.
    public static func read(_ value: JSONValue) throws -> DeviceConfig {
        let invalid = ConnectError("invalid_config")
        func object(_ value: JSONValue?) throws -> [String: JSONValue] { guard let o = value?.object else { throw invalid }; return o }
        func exact(_ o: [String: JSONValue], _ keys: Set<String>) throws { guard Set(o.keys) == keys else { throw invalid } }
        func number(_ value: JSONValue?, _ range: ClosedRange<Double>) throws -> Double {
            guard let n = value?.number, n.isFinite, range.contains(n) else { throw invalid }
            return n
        }
        let v = try object(value)
        try exact(v, ["features", "languages", "translationTargets", "preference", "textProvider", "textModel", "resources"])
        let features = try object(v["features"])
        try exact(features, ["transcription", "text"])
        guard let transcription = features["transcription"]?.bool, let text = features["text"]?.bool else { throw invalid }
        guard let preference = v["preference"]?.string, ["quality", "balanced", "speed"].contains(preference) else { throw invalid }
        let provider = v["textProvider"]
        guard provider == .null || provider == "codex" || provider == "claude" else { throw invalid }
        let model = v["textModel"]
        guard model == .null || provider != .null && Check.isModel(model?.string) else { throw invalid }
        let r = try object(v["resources"])
        try exact(r, ["modelBudgetGb", "minFreeDiskGb", "allowOnBattery", "maxConcurrentJobs", "launchAtLogin", "workingHours"])
        guard let allowOnBattery = r["allowOnBattery"]?.bool, let launchAtLogin = r["launchAtLogin"]?.bool, r["maxConcurrentJobs"]?.number == 1 else { throw invalid }
        var hours: WorkingHours?
        if r["workingHours"] != .null {
            let w = try object(r["workingHours"])
            try exact(w, ["start", "end", "timeZone"])
            let time = "^([01][0-9]|2[0-3]):[0-5][0-9]$"
            guard let start = w["start"]?.string, Check.matches(start, time), let end = w["end"]?.string, Check.matches(end, time),
                  start != end, let zone = w["timeZone"]?.string, isIanaTimeZone(zone) else { throw invalid }
            hours = WorkingHours(start: start, end: end, timeZone: zone)
        }
        var config = DeviceConfig()
        config.transcription = transcription
        config.text = text
        config.languages = try languageList(v["languages"], min: 1)
        config.translationTargets = try languageList(v["translationTargets"], min: 0)
        config.preference = preference
        config.textProvider = provider?.string
        config.textModel = model?.string
        config.modelBudgetGb = try number(r["modelBudgetGb"], 1...500)
        config.minFreeDiskGb = try number(r["minFreeDiskGb"], 5...500)
        config.allowOnBattery = allowOnBattery
        config.launchAtLogin = launchAtLogin
        config.workingHours = hours
        return config
    }

    public static func isIanaTimeZone(_ value: String) -> Bool {
        Check.matches(value, "^[A-Za-z][A-Za-z0-9_+\\-/]{0,63}$") && TimeZone(identifier: value) != nil
    }

    static func languageList(_ value: JSONValue?, min: Int) throws -> [String] {
        guard let list = value?.array, list.count >= min, list.count <= 20 else { throw ConnectError("invalid_config") }
        var out: [String] = []
        for item in list {
            guard let tag = item.string, Check.matches(tag, "^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$") else { throw ConnectError("invalid_config") }
            let canonical = canonicalLanguage(tag)
            if !out.contains(canonical) { out.append(canonical) }
        }
        return out
    }

    /// BCP 47 casing, as `Intl.getCanonicalLocales` writes it for these
    /// simple tags: "en-us" is "en-US", "zh-hant-tw" is "zh-Hant-TW".
    static func canonicalLanguage(_ tag: String) -> String {
        tag.split(separator: "-").enumerated().map { index, part in
            let text = String(part)
            if index == 0 { return text.lowercased() }
            if text.count == 4, text.allSatisfy(\.isLetter) { return text.prefix(1).uppercased() + text.dropFirst().lowercased() }
            if text.count == 2, text.allSatisfy(\.isLetter) { return text.uppercased() }
            return text.lowercased()
        }.joined(separator: "-")
    }
}

/// Settings the Mac can't follow yet, by key, with the reason Settings shows.
public enum UnsupportedReason {
    public static let localWorkflow = "Local workflow not built yet; settings saved for later"
    public static let launchAtLogin = "Turn on Launch at login in Studio's menu-bar menu on this Mac"
}

/// Port of `applyDesiredConfig`. `launchAtLogin` says whether the app is a
/// login item now: the setting is honoured when it is, and otherwise says
/// how to turn it on (Studio doesn't add itself to login items from the web).
public func applyDesiredConfig(version: Int, value: JSONValue, launchAtLogin: Bool) -> (config: DeviceConfig?, ack: ConfigAck) {
    guard let config = try? DeviceConfig.read(value) else {
        return (nil, ConfigAck(version: version, status: .error,
                               error: "This setup is not valid for this version of Studio. Update Studio on the Mac or save the setup again."))
    }
    var unsupported: [String: String] = [:]
    if config.launchAtLogin, !launchAtLogin { unsupported["resources.launchAtLogin"] = UnsupportedReason.launchAtLogin }
    if config.transcription { unsupported["features.transcription"] = UnsupportedReason.localWorkflow }
    if config.text { unsupported["features.text"] = UnsupportedReason.localWorkflow }
    return (config, ConfigAck(version: version, status: .applied, unsupported: unsupported.isEmpty ? nil : unsupported))
}

/// Port of `DeviceSettings`: the server's device state, the applied setup
/// and the acknowledgement still to be sent with the next heartbeat.
public final class DeviceSettings: @unchecked Sendable {
    public private(set) var processingEnabled = false
    public private(set) var paused = false
    public private(set) var config = DeviceConfig.defaults
    public private(set) var appliedVersion = 0
    public private(set) var pendingAck: ConfigAck?
    private var lastValue: JSONValue = .null
    /// Whether the app is a login item, for the launch-at-login setting.
    public var launchAtLogin: () -> Bool

    public init(launchAtLogin: @escaping () -> Bool = { false }) {
        self.launchAtLogin = launchAtLogin
    }

    /// True when a new setup version arrived, so the caller sends the ack
    /// promptly.
    @discardableResult
    public func update(_ state: HeartbeatState?, sentAck: ConfigAck? = nil) -> Bool {
        if let sentAck, pendingAck?.version == sentAck.version { pendingAck = nil }
        guard let state else { return false }
        processingEnabled = state.processingEnabled
        paused = state.paused
        // Version 0 is nothing saved yet: defaults, nothing to acknowledge.
        // A restart applies and acknowledges the current version again.
        if state.configVersion == 0 || state.configVersion == appliedVersion { return false }
        apply(version: state.configVersion, value: state.configValue)
        return true
    }

    /// Acknowledges the current version again, after something local that
    /// changes the answer (the login item was turned on or off).
    @discardableResult
    public func reapply() -> Bool {
        guard appliedVersion > 0 else { return false }
        apply(version: appliedVersion, value: lastValue)
        return true
    }

    private func apply(version: Int, value: JSONValue) {
        let (config, ack) = applyDesiredConfig(version: version, value: value, launchAtLogin: launchAtLogin())
        // An invalid setup keeps the last good one.
        if let config { self.config = config }
        appliedVersion = version
        lastValue = value
        pendingAck = ack
    }
}

public func withinWorkingHours(_ hours: DeviceConfig.WorkingHours?, now: Date = Date()) -> Bool {
    guard let hours, let zone = TimeZone(identifier: hours.timeZone) else { return true }
    func minutes(_ text: String) -> Int { (Int(text.prefix(2)) ?? 0) * 60 + (Int(text.suffix(2)) ?? 0) }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = zone
    let parts = calendar.dateComponents([.hour, .minute], from: now)
    let current = (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
    let start = minutes(hours.start), end = minutes(hours.end)
    // Overnight windows wrap.
    return start < end ? current >= start && current < end : current >= start || current < end
}

public struct LocalGate: Equatable, Sendable {
    public var diagnostics: Bool
    public var processing: Bool
    public var reasons: [String]
}

/// Port of `localGate`: decided on the Mac before claiming. Only pausing
/// stops diagnostics.
public func localGate(processingEnabled: Bool, paused: Bool, config: DeviceConfig, power: Power?, freeDiskGb: Double?, now: Date = Date()) -> LocalGate {
    if paused { return LocalGate(diagnostics: false, processing: false, reasons: ["paused"]) }
    var reasons: [String] = []
    if !processingEnabled { reasons.append("processing_disabled") }
    if !config.allowOnBattery, power?.source != "ac" { reasons.append("on_battery_or_unknown_power") }
    if !withinWorkingHours(config.workingHours, now: now) { reasons.append("outside_working_hours") }
    if freeDiskGb.map({ $0 < config.minFreeDiskGb }) ?? true { reasons.append("low_disk_space") }
    return LocalGate(diagnostics: true, processing: reasons.isEmpty, reasons: reasons)
}
