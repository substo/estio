import AppKit
import AVFoundation
import WebKit

/// Renders a motion graphic written as one self-contained HTML file to a transparent video clip, with the system's own WebKit.
///
/// The page is a pure function of time: it defines `window.seek(t)` (seconds), and every frame is `seek(t)` then a snapshot with
/// a clear background. Network access is blocked (a graphic uses only what is in its folder), so what an agent writes cannot
/// phone out. The result is a ProRes 4444 clip with alpha that the editor places like any other overlay.
///
/// It lives in the app binary (the only target allowed to import AppKit) and runs headless, with no window shown:
/// `substo-app --render-graphic ...`, started by `substo graphic`.
struct GraphicRenderRequest {
    var html: URL
    var output: URL
    var width = 1920
    var height = 1080
    var fps = 30
    var duration = 3.0
    /// A single frame at this time, as a PNG, instead of a clip.
    var frameAt: Double?
    /// A plain backdrop (`#rrggbb`) behind a single frame, so layout and readability can be judged without busy footage. A preview aid for stills only:
    /// clips are always transparent, so an export always composites the graphic over the footage.
    var background: String?

    /// `dark` and `light` name the two neutral backdrops; anything else must be `#rrggbb`. nil when it is neither.
    static func parseBackground(_ text: String) -> String? {
        switch text.lowercased() {
        case "dark": return "#2b2f36"
        case "light": return "#f1f3f5"
        default:
            let hex = text.lowercased()
            guard hex.count == 7, hex.hasPrefix("#"), hex.dropFirst().allSatisfy({ $0.isHexDigit }) else { return nil }
            return hex
        }
    }
    var backgroundColour: (r: CGFloat, g: CGFloat, b: CGFloat)? {
        guard let background, let value = Int(background.dropFirst(), radix: 16) else { return nil }
        return (CGFloat((value >> 16) & 255) / 255, CGFloat((value >> 8) & 255) / 255, CGFloat(value & 255) / 255)
    }

    static let maxWidth = 3840, maxHeight = 2160, maxSeconds = 60.0, maxFrames = 3600

    /// `substo graphic` checks these too; this is the last line of defence for anything that calls the app directly.
    func validate() throws {
        guard width >= 16, height >= 16, width <= Self.maxWidth, height <= Self.maxHeight else { throw GraphicError("The size must be between 16x16 and \(Self.maxWidth)x\(Self.maxHeight).") }
        guard (12...60).contains(fps) else { throw GraphicError("The frame rate must be between 12 and 60.") }
        if let background { guard frameAt != nil, Self.parseBackground(background) == background else { throw GraphicError("A background is a #rrggbb colour (or dark or light) and only applies to a single frame; clips stay transparent.") } }
        if frameAt == nil {
            guard duration > 0, duration <= Self.maxSeconds else { throw GraphicError("The duration must be between 0 and \(Int(Self.maxSeconds)) seconds.") }
            guard Int((duration * Double(fps)).rounded(.up)) <= Self.maxFrames else { throw GraphicError("That is more than \(Self.maxFrames) frames. Use a shorter duration or a lower frame rate.") }
        }
    }
    var frameCount: Int { max(1, Int((duration * Double(fps)).rounded(.up))) }
}

struct GraphicError: Error, CustomStringConvertible { let description: String; init(_ description: String) { self.description = description } }

@MainActor
final class HTMLGraphicRenderer: NSObject, WKNavigationDelegate {
    private let webView: WKWebView
    private let window: NSWindow
    private var loaded: CheckedContinuation<Void, Error>?

    /// The page is loaded from a copy with this policy in front: only files, data and inline code, and no connections out, so a graphic can only use its own folder.
    private static let policy = #"<meta http-equiv="Content-Security-Policy" content="default-src 'self' file: data: blob: 'unsafe-inline' 'unsafe-eval'; connect-src 'none'">"#

    init(width: Int, height: Int) async throws {
        let config = WKWebViewConfiguration()
        let frame = NSRect(x: 0, y: 0, width: width, height: height)
        webView = WKWebView(frame: frame, configuration: config)
        webView.setValue(false, forKey: "drawsBackground")
        window = NSWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.contentView = webView
        super.init()
        webView.navigationDelegate = self
    }

    func load(_ html: URL) async throws {
        // A hidden copy beside the original (so relative files still resolve) with the policy first; removed afterwards.
        let source = try String(contentsOf: html, encoding: .utf8)
        let copy = html.deletingLastPathComponent().appendingPathComponent(".render-\(UUID().uuidString).html")
        try (Self.policy + source).write(to: copy, atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: copy) }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            loaded = continuation
            webView.loadFileURL(copy, allowingReadAccessTo: html.deletingLastPathComponent())
        }
    }

    nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        MainActor.assumeIsolated { loaded?.resume(); loaded = nil }
    }
    nonisolated func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        MainActor.assumeIsolated { loaded?.resume(throwing: error); loaded = nil }
    }
    nonisolated func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        MainActor.assumeIsolated { loaded?.resume(throwing: error); loaded = nil }
    }

    /// One frame at time `t`, at exactly width x height pixels.
    func frame(at t: Double, width: Int, height: Int) async throws -> CGImage {
        // Fonts first, then the page's own seek, then a short timer so the page has drawn it (animation frames never fire in a window that is not on screen).
        let script = """
        await document.fonts.ready;
        if (typeof window.seek !== 'function') { throw new Error('The graphic does not define window.seek(t).'); }
        await window.seek(t);
        await new Promise(r => setTimeout(r, 16));
        return true;
        """
        do { _ = try await webView.callAsyncJavaScript(script, arguments: ["t": t], in: nil, contentWorld: .page) }
        catch {
            // WebKit puts the page's own error text (and its line) in the error's user info.
            let info = (error as NSError).userInfo
            let message = (info["WKJavaScriptExceptionMessage"] as? String) ?? error.localizedDescription
            let line = (info["WKJavaScriptExceptionLineNumber"] as? Int).map { " (line \($0))" } ?? ""
            throw GraphicError("The graphic failed at \(String(format: "%.2f", t)) s: \(message)\(line). If the page has a script error at load, `seek` is never defined; also avoid top-level names that clash with the window's own (top, name, parent, length, status, event).")
        }
        let config = WKSnapshotConfiguration()
        config.rect = NSRect(x: 0, y: 0, width: width, height: height)
        config.snapshotWidth = NSNumber(value: width)
        let image = try await webView.takeSnapshot(configuration: config)
        guard let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { throw GraphicError("The page could not be captured.") }
        return cg
    }

    // MARK: Output

    static func pixelBuffer(_ image: CGImage, width: Int, height: Int, pool: CVPixelBufferPool) throws -> CVPixelBuffer {
        var buffer: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess, let buffer else { throw GraphicError("Out of memory while rendering.") }
        CVPixelBufferLockBaseAddress(buffer, [])
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
        guard let context = CGContext(data: CVPixelBufferGetBaseAddress(buffer), width: width, height: height, bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
                                      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
        else { throw GraphicError("Could not make a drawing buffer.") }
        context.clear(CGRect(x: 0, y: 0, width: width, height: height))
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        return buffer
    }

    /// The whole clip. Returns the number of frames written.
    static func renderClip(_ request: GraphicRenderRequest) async throws -> Int {
        try request.validate()
        let renderer = try await HTMLGraphicRenderer(width: request.width, height: request.height)
        try await renderer.load(request.html)
        try? FileManager.default.removeItem(at: request.output)
        let writer = try AVAssetWriter(outputURL: request.output, fileType: .mov)
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.proRes4444, AVVideoWidthKey: request.width, AVVideoHeightKey: request.height])
        input.expectsMediaDataInRealTime = false
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: request.width, kCVPixelBufferHeightKey as String: request.height])
        guard writer.canAdd(input) else { throw GraphicError("The clip could not be set up.") }
        writer.add(input)
        guard writer.startWriting() else { throw GraphicError("The clip could not be written: \(writer.error?.localizedDescription ?? "unknown error").") }
        writer.startSession(atSourceTime: .zero)
        guard let pool = adaptor.pixelBufferPool else { throw GraphicError("The clip could not be set up.") }
        let count = request.frameCount
        for n in 0..<count {
            let image = try await renderer.frame(at: Double(n) / Double(request.fps), width: request.width, height: request.height)
            let buffer = try pixelBuffer(image, width: request.width, height: request.height, pool: pool)
            while !input.isReadyForMoreMediaData { try await Task.sleep(nanoseconds: 2_000_000) }
            guard adaptor.append(buffer, withPresentationTime: CMTime(value: CMTimeValue(n), timescale: CMTimeScale(request.fps))) else {
                throw GraphicError("The clip could not be written: \(writer.error?.localizedDescription ?? "unknown error").")
            }
        }
        input.markAsFinished()
        await writer.finishWriting()
        guard writer.status == .completed else { throw GraphicError("The clip could not be finished: \(writer.error?.localizedDescription ?? "unknown error").") }
        return count
    }

    /// One frame as a PNG (for looking at a graphic before it goes on the timeline).
    static func renderStill(_ request: GraphicRenderRequest) async throws {
        try request.validate()
        let renderer = try await HTMLGraphicRenderer(width: request.width, height: request.height)
        try await renderer.load(request.html)
        let image = try await renderer.frame(at: request.frameAt ?? 0, width: request.width, height: request.height)
        // Exactly width x height pixels, like the clip (a snapshot can come back at the screen's 2x).
        guard let context = CGContext(data: nil, width: request.width, height: request.height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
              (context.clear(CGRect(x: 0, y: 0, width: request.width, height: request.height)),
               { if let c = request.backgroundColour { context.setFillColor(CGColor(colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!, components: [c.r, c.g, c.b, 1])!); context.fill(CGRect(x: 0, y: 0, width: request.width, height: request.height)) } }(),
               context.draw(image, in: CGRect(x: 0, y: 0, width: request.width, height: request.height))).0 == (), let exact = context.makeImage() else { throw GraphicError("The still could not be drawn.") }
        let rep = NSBitmapImageRep(cgImage: exact)
        guard let png = rep.representation(using: .png, properties: [:]) else { throw GraphicError("The still could not be encoded.") }
        try png.write(to: request.output)
    }
}

/// `substo-app --render-graphic <html> <output> <width> <height> <fps> <duration> [frameAt] [background]`: headless, no window, exits when done.
enum GraphicRenderEntry {
    static let flag = "--render-graphic"

    @MainActor static func run(_ arguments: [String]) -> Never {
        func fail(_ message: String) -> Never { FileHandle.standardError.write(Data((message + "\n").utf8)); exit(1) }
        guard arguments.count >= 6, let width = Int(arguments[2]), let height = Int(arguments[3]), let fps = Int(arguments[4]), let duration = Double(arguments[5]) else { fail("usage: --render-graphic <html> <output> <width> <height> <fps> <duration> [frameAt]") }
        var request = GraphicRenderRequest(html: URL(fileURLWithPath: arguments[0]), output: URL(fileURLWithPath: arguments[1]), width: width, height: height, fps: fps, duration: duration)
        if arguments.count >= 7 { request.frameAt = Double(arguments[6]) }
        if arguments.count >= 8 { request.background = arguments[7] }
        NSApplication.shared.setActivationPolicy(.prohibited)
        Task { @MainActor in
            do {
                if request.frameAt != nil { try await HTMLGraphicRenderer.renderStill(request); print("rendered \(request.output.path)") }
                else { let frames = try await HTMLGraphicRenderer.renderClip(request); print("rendered \(request.output.path) (\(frames) frames, \(request.width)x\(request.height) at \(request.fps) fps, transparent)") }
                exit(0)
            } catch { fail("\(error)") }
        }
        NSApplication.shared.run()
        exit(0)
    }
}
