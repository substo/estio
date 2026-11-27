import Foundation

/// `substo graphic render|frame`: turns a self-contained HTML motion graphic (a pure function of time, `window.seek(t)`) into a
/// transparent clip, or looks at one frame of it. The drawing is done by the app binary headless (WebKit lives there, the only
/// target allowed to import AppKit); this command checks the paths and sizes, runs it, and reports.
struct GraphicCommand {
    let directory: URL

    /// Files stay in the project folder: an agent names relative paths, and nothing outside the folder is read or written.
    static func inside(_ path: String, directory: URL) throws -> URL {
        let base = directory.standardizedFileURL.resolvingSymlinksInPath()
        let url = URL(fileURLWithPath: path, relativeTo: base).standardizedFileURL
        let resolved = url.deletingLastPathComponent().resolvingSymlinksInPath().appendingPathComponent(url.lastPathComponent)
        guard resolved.path.hasPrefix(base.path + "/") else { throw UsageError(message: "\(path) is outside the project folder. Graphics are read from and written to the project folder only.") }
        return resolved
    }

    /// `dark` and `light` name the two neutral backdrops; anything else must be `#rrggbb`. (The app checks it again before drawing.)
    static func parseBackground(_ text: String) -> String? {
        switch text.lowercased() {
        case "dark": return "#2b2f36"
        case "light": return "#f1f3f5"
        default:
            let hex = text.lowercased()
            return hex.count == 7 && hex.hasPrefix("#") && hex.dropFirst().allSatisfy({ $0.isHexDigit }) ? hex : nil
        }
    }

    static func parseSize(_ text: String?) throws -> (Int, Int) {
        guard let text else { return (1920, 1080) }
        let parts = text.lowercased().split(separator: "x").compactMap { Int($0) }
        guard parts.count == 2, (16...3840).contains(parts[0]), (16...2160).contains(parts[1]) else { throw UsageError(message: "--size is WIDTHxHEIGHT between 16x16 and 3840x2160, like 1920x1080 or 1080x1920.") }
        return (parts[0], parts[1])
    }

    /// The app binary sits beside this command in the app bundle (and in the build folder during development).
    static func appBinary() throws -> URL {
        guard let executable = Bundle.main.executableURL?.resolvingSymlinksInPath() else { throw UsageError(message: "Could not find the Substo Video app to render with.") }
        let app = executable.deletingLastPathComponent().appendingPathComponent("substo-app")
        guard FileManager.default.isExecutableFile(atPath: app.path) else { throw UsageError(message: "The Substo Video app was not found next to this command (\(app.path)). Rebuild it with build-app.sh.") }
        return app
    }

    func run(_ args: Arguments) async throws -> Int32 {
        guard let mode = args.positionals.first, mode == "render" || mode == "frame" else {
            throw UsageError(message: "`substo graphic` needs render or frame, like substo graphic render title.html --duration 3.")
        }
        try args.expectPositionals(atMost: 2, command: "graphic \(mode)")
        let htmlName = try args.positional(1, "an HTML file in the project folder, like substo graphic \(mode) title.html", command: "graphic \(mode)")
        let html = try Self.inside(htmlName, directory: directory)
        guard FileManager.default.fileExists(atPath: html.path), html.pathExtension.lowercased() == "html" else { throw UsageError(message: "\(htmlName) is not an .html file in the project folder.") }
        let (width, height) = try Self.parseSize(args.options["size"])
        let fps = try args.integer("fps") ?? 30
        guard (12...60).contains(fps) else { throw UsageError(message: "--fps is between 12 and 60.") }
        let stem = html.deletingPathExtension().lastPathComponent
        var duration = 0.0, frameAt = ""
        let defaultName: String
        if mode == "render" {
            guard let text = args.options["duration"], let seconds = Double(text), seconds > 0, seconds <= 60 else { throw UsageError(message: "`substo graphic render` needs --duration in seconds (up to 60), like --duration 3.") }
            duration = seconds
            defaultName = "\(stem).mov"
        } else {
            guard let text = args.options["at"], let seconds = Double(text), seconds >= 0 else { throw UsageError(message: "`substo graphic frame` needs --at in seconds, like --at 1.5.") }
            frameAt = String(seconds)
            defaultName = "\(stem)-\(String(format: "%.2f", seconds)).png"
        }
        var background = ""
        if let text = args.options["background"] {
            guard mode == "frame" else { throw UsageError(message: "--background only applies to `substo graphic frame`: a rendered clip is always transparent so it can lay over the footage.") }
            guard let hex = Self.parseBackground(text) else { throw UsageError(message: "--background is dark, light or a #rrggbb colour, like --background dark.") }
            background = hex
        }
        let output = try Self.inside(args.options["output"] ?? defaultName, directory: directory)
        guard output.pathExtension.lowercased() == (mode == "render" ? "mov" : "png") else { throw UsageError(message: mode == "render" ? "The output of render is a .mov." : "The output of frame is a .png.") }
        let app = try Self.appBinary()

        let process = Process()
        process.executableURL = app
        process.arguments = ["--render-graphic", html.path, output.path, String(width), String(height), String(fps), String(duration == 0 ? 1 : duration)] + (frameAt.isEmpty ? [] : [frameAt] + (background.isEmpty ? [] : [background]))
        process.currentDirectoryURL = directory
        let out = Pipe(), err = Pipe()
        process.standardOutput = out; process.standardError = err
        try process.run()
        // A graphic that never finishes must not hang the agent: 5 minutes covers 60 s at 60 fps with room to spare.
        let deadline = Date().addingTimeInterval(300)
        while process.isRunning && Date() < deadline { try await Task.sleep(nanoseconds: 100_000_000) }
        if process.isRunning { process.terminate(); throw UsageError(message: "Rendering took longer than 5 minutes and was stopped. Make the graphic shorter or simpler.") }
        let text = String(decoding: out.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        let problem = String(decoding: err.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        guard process.terminationStatus == 0 else { throw UsageError(message: problem.isEmpty ? "The graphic could not be rendered." : problem) }
        print(text)
        return 0
    }
}
