import Foundation

public struct Power: Equatable, Sendable {
    /// "ac", "battery" or "unknown".
    public var source: String
    public var batteryPercent: Int?

    public init(source: String, batteryPercent: Int? = nil) {
        self.source = source
        self.batteryPercent = batteryPercent
    }

    var json: JSONValue {
        var o: [String: JSONValue] = ["source": .string(source)]
        if let batteryPercent { o["batteryPercent"] = .number(Double(batteryPercent)) }
        return .object(o)
    }
}

/// Safe, whitelisted machine metadata only: no serials, user names, paths
/// or display IDs. Port of discovery.ts.
public struct Hardware: Equatable, Sendable {
    public var chip: String
    public var arch: String
    public var osVersion: String
    public var memoryGb: Int
    /// "apple-metal", "none" or "unknown".
    public var gpu: String
    public var freeDiskGb: Double
    public var totalDiskGb: Double
    public var power: Power
    public var timeZone: String

    var json: JSONValue {
        ["chip": .string(chip), "arch": .string(arch), "osVersion": .string(osVersion), "memoryGb": .number(Double(memoryGb)),
         "gpu": .string(gpu), "freeDiskGb": .number(freeDiskGb), "totalDiskGb": .number(totalDiskGb), "power": power.json,
         "timeZone": .string(timeZone)]
    }
}

public struct Discovery: Equatable, Sendable {
    public var hardware: Hardware
    /// ollama, lmstudio, mlx, whispercpp, python, ffmpeg: version.
    public var runtimes: [String: String]
    public var localModels: [String]

    var json: [String: JSONValue] {
        ["hardware": hardware.json, "runtimes": .object(runtimes.mapValues { .string($0) }), "localModels": .array(localModels.map { .string($0) })]
    }
}

public enum MacDiscovery {
    /// `process.arch`.
    public static var arch: String {
        #if arch(arm64)
        return "arm64"
        #else
        return "x64"
        #endif
    }

    static func safeText(_ value: String?, fallback: String = "unknown") -> String {
        let cleaned = String((value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            .filter { $0.isASCII && ($0.isLetter || $0.isNumber || " ._()-".contains($0)) }.prefix(100))
        return cleaned.isEmpty ? fallback : cleaned
    }

    static func round1(_ value: Double) -> Double { (value * 10).rounded() / 10 }

    public static func versionOf(_ text: String) -> String? {
        guard let range = text.range(of: #"\b\d+\.\d+(\.\d+)?\b"#, options: .regularExpression) else { return nil }
        return String(text[range])
    }

    public static func parseMemoryGb(_ memsize: String) -> Int {
        guard let bytes = Double(memsize.trimmingCharacters(in: .whitespacesAndNewlines)), bytes.isFinite, bytes > 0 else { return 0 }
        return Int((bytes / pow(2, 30)).rounded())
    }

    /// `df -k <path>`: the second line's 1024-blocks and Available, in
    /// decimal GB like Finder.
    public static func parseDf(_ output: String) -> (freeDiskGb: Double, totalDiskGb: Double) {
        let lines = output.trimmingCharacters(in: .whitespacesAndNewlines).components(separatedBy: "\n")
        guard lines.count > 1 else { return (0, 0) }
        let row = lines[1].split(whereSeparator: { $0 == " " || $0 == "\t" }).map(String.init)
        guard row.count > 3, let total = Double(row[1]), let free = Double(row[3]) else { return (0, 0) }
        return (round1(free * 1024 / 1e9), round1(total * 1024 / 1e9))
    }

    /// `pmset -g batt`.
    public static func parsePmset(_ output: String) -> Power {
        let source = output.contains("'AC Power'") ? "ac" : output.contains("'Battery Power'") ? "battery" : "unknown"
        guard let range = output.range(of: #"\t(\d{1,3})%;"#, options: .regularExpression) else { return Power(source: source) }
        let digits = output[range].filter(\.isNumber)
        return Power(source: source, batteryPercent: min(100, Int(digits) ?? 0))
    }

    /// `system_profiler SPDisplaysDataType -json`.
    public static func parseGpu(_ output: String) -> String {
        guard let data = output.data(using: .utf8), let root = try? JSONValue.parse(data), let gpus = root["SPDisplaysDataType"]?.array else { return "unknown" }
        if gpus.isEmpty { return "none" }
        let metal = gpus.contains { gpu in
            (gpu.object ?? [:]).contains { key, value in
                key.range(of: "mtl|metal", options: [.regularExpression, .caseInsensitive]) != nil
                    && (value.string ?? "").range(of: "metal", options: .caseInsensitive) != nil
            }
        }
        return metal ? "apple-metal" : "unknown"
    }

    /// `sw_vers -productVersion`.
    public static func parseOsVersion(_ output: String) -> String {
        let text = output.trimmingCharacters(in: .whitespacesAndNewlines)
        return Check.matches(text, #"^\d+(\.\d+){0,2}$"#) ? text : "unknown"
    }

    static func quiet(_ run: @escaping ProcessRunner, _ command: String, _ args: [String], timeout: TimeInterval = 10) async -> String {
        guard let output = try? await run(ProcessRequest(command: command, args: args, cwd: NSTemporaryDirectory(), timeout: timeout, maxOutputBytes: 256 * 1024)) else { return "" }
        return "\(output.stdout)\n\(output.stderr)"
    }

    static func firstLine(_ text: String) -> String { text.components(separatedBy: "\n").first ?? "" }

    public static func hardware(run: @escaping ProcessRunner = runNativeProcess, home: String = NSHomeDirectory()) async -> Hardware {
        async let chip = quiet(run, "/usr/sbin/sysctl", ["-n", "machdep.cpu.brand_string"])
        async let memsize = quiet(run, "/usr/sbin/sysctl", ["-n", "hw.memsize"])
        async let os = quiet(run, "/usr/bin/sw_vers", ["-productVersion"])
        async let df = quiet(run, "/bin/df", ["-k", home])
        async let batt = quiet(run, "/usr/bin/pmset", ["-g", "batt"])
        async let displays = quiet(run, "/usr/sbin/system_profiler", ["SPDisplaysDataType", "-json"], timeout: 30)
        let disk = parseDf(await df)
        return Hardware(chip: safeText(firstLine(await chip)), arch: safeText(arch), osVersion: parseOsVersion(firstLine(await os)),
                        memoryGb: parseMemoryGb(firstLine(await memsize)), gpu: parseGpu(await displays),
                        freeDiskGb: disk.freeDiskGb, totalDiskGb: disk.totalDiskGb, power: parsePmset(await batt),
                        timeZone: TimeZone.current.identifier)
    }

    /// Free disk and power change quickly: refreshed every minute for the
    /// local gate.
    public static func powerAndDisk(run: @escaping ProcessRunner = runNativeProcess, home: String = NSHomeDirectory()) async -> (freeDiskGb: Double, totalDiskGb: Double, power: Power) {
        async let df = quiet(run, "/bin/df", ["-k", home])
        async let batt = quiet(run, "/usr/bin/pmset", ["-g", "batt"])
        let disk = parseDf(await df)
        return (disk.freeDiskGb, disk.totalDiskGb, parsePmset(await batt))
    }

    static let runtimeProbes: [(String, String, [String])] = [
        ("ollama", "ollama", ["--version"]), ("lmstudio", "lms", ["version"]), ("whispercpp", "whisper-cli", ["--version"]),
        ("python", "python3", ["--version"]), ("ffmpeg", "ffmpeg", ["-version"]),
        ("mlx", "python3", ["-I", "-c", "import importlib.metadata as m; print(m.version('mlx'))"]),
    ]

    public static func runtimes(run: @escaping ProcessRunner = runNativeProcess) async -> [String: String] {
        await withTaskGroup(of: (String, String?).self) { group in
            for (key, command, args) in runtimeProbes {
                group.addTask { (key, versionOf(await quiet(run, command, args))) }
            }
            var out: [String: String] = [:]
            for await (key, version) in group { if let version { out[key] = version } }
            return out
        }
    }

    static func names(_ directory: String) -> [String] {
        guard let entries = try? FileManager.default.contentsOfDirectory(atPath: directory) else { return [] }
        return entries.filter { !$0.hasPrefix(".") }
    }

    /// Model names only, no paths: Ollama manifests, LM Studio and the
    /// Hugging Face MLX caches.
    public static func localModels(home: String = NSHomeDirectory(), environment: [String: String] = ProcessInfo.processInfo.environment) -> [String] {
        var found = Set<String>()
        let root = environment["OLLAMA_MODELS"].flatMap { $0.isEmpty ? nil : $0 } ?? "\(home)/.ollama/models"
        let manifests = "\(root)/manifests"
        for registry in names(manifests) {
            for namespace in names("\(manifests)/\(registry)") {
                for model in names("\(manifests)/\(registry)/\(namespace)") {
                    for tag in names("\(manifests)/\(registry)/\(namespace)/\(model)") {
                        let prefix = registry == "registry.ollama.ai" && namespace == "library" ? "" : "\(namespace)/"
                        found.insert("\(prefix)\(model):\(tag)")
                    }
                }
            }
        }
        for root in ["\(home)/.lmstudio/models", "\(home)/.cache/lm-studio/models"] {
            for publisher in names(root) {
                for model in names("\(root)/\(publisher)") { found.insert("\(publisher)/\(model)") }
            }
        }
        for entry in names("\(home)/.cache/huggingface/hub") {
            for publisher in ["mlx-community", "lmstudio-community"] where entry.hasPrefix("models--\(publisher)--") {
                found.insert("\(publisher)/\(entry.dropFirst("models--\(publisher)--".count))")
            }
        }
        // JavaScript's default sort: by UTF-16 code units.
        return Array(found.filter { Check.isModel($0) }.sorted { Array($0.utf16).lexicographicallyPrecedes(Array($1.utf16)) }.prefix(100))
    }

    public static func discover(run: @escaping ProcessRunner = runNativeProcess, home: String = NSHomeDirectory()) async -> Discovery {
        async let hardware = hardware(run: run, home: home)
        async let runtimes = runtimes(run: run)
        return Discovery(hardware: await hardware, runtimes: await runtimes, localModels: localModels(home: home))
    }
}
