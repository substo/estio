import AppKit
import AVFoundation
import XCTest
@testable import TandemApp

/// `substo graphic`: an HTML motion graphic (a pure function of `window.seek(t)`) rendered to a transparent clip by the app's WebKit.
@MainActor
final class GraphicRenderTests: XCTestCase {
    private func folder() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("graphic-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }

    private func pixel(_ png: URL, x: Int, y: Int) throws -> (r: Int, g: Int, b: Int, a: Int) {
        let rep = try XCTUnwrap(NSBitmapImageRep(data: Data(contentsOf: png)))
        let c = try XCTUnwrap(rep.colorAt(x: x, y: y)?.usingColorSpace(NSColorSpace.sRGB))
        return (Int((c.redComponent * 255).rounded()), Int((c.greenComponent * 255).rounded()), Int((c.blueComponent * 255).rounded()), Int((c.alphaComponent * 255).rounded()))
    }

    /// The stored bytes of one pixel, with no colour conversion (colorAt would convert from whatever profile the PNG declares).
    private func rawPixel(_ png: URL, x: Int, y: Int) throws -> (r: Int, g: Int, b: Int, a: Int) {
        let rep = try XCTUnwrap(NSBitmapImageRep(data: Data(contentsOf: png)))
        var p = [Int](repeating: 0, count: 5)
        rep.getPixel(&p, atX: x, y: y)
        return (p[0], p[1], p[2], p.count > 3 ? p[3] : 255)
    }

    func testRefusesRequestsOutsideTheLimits() {
        let html = URL(fileURLWithPath: "/tmp/x.html"), out = URL(fileURLWithPath: "/tmp/x.mov")
        XCTAssertThrowsError(try GraphicRenderRequest(html: html, output: out, width: 8000, height: 1080).validate())
        XCTAssertThrowsError(try GraphicRenderRequest(html: html, output: out, fps: 120).validate())
        XCTAssertThrowsError(try GraphicRenderRequest(html: html, output: out, duration: 0).validate())
        XCTAssertThrowsError(try GraphicRenderRequest(html: html, output: out, duration: 61).validate())
        XCTAssertThrowsError(try GraphicRenderRequest(html: html, output: out, fps: 60, duration: 60.5).validate())
        XCTAssertNoThrow(try GraphicRenderRequest(html: html, output: out, width: 1080, height: 1920, fps: 30, duration: 3).validate())
    }

    func testAPlainBackgroundOnlyAppliesToStillsAndIsValidated() {
        let html = URL(fileURLWithPath: "/tmp/x.html"), out = URL(fileURLWithPath: "/tmp/x.png")
        XCTAssertEqual(GraphicRenderRequest.parseBackground("dark"), "#2b2f36")
        XCTAssertEqual(GraphicRenderRequest.parseBackground("LIGHT"), "#f1f3f5")
        XCTAssertEqual(GraphicRenderRequest.parseBackground("#AABBCC"), "#aabbcc")
        XCTAssertNil(GraphicRenderRequest.parseBackground("red")); XCTAssertNil(GraphicRenderRequest.parseBackground("#abc"))
        var still = GraphicRenderRequest(html: html, output: out, width: 64, height: 64); still.frameAt = 0; still.background = "#2b2f36"
        XCTAssertNoThrow(try still.validate())
        var clip = GraphicRenderRequest(html: html, output: out, width: 64, height: 64, duration: 1); clip.background = "#2b2f36"
        XCTAssertThrowsError(try clip.validate())
    }

    func testAStillOnAPlainBackgroundIsOpaqueAndKeepsTheGraphicOnTop() async throws {
        let dir = try folder()
        try """
        <!doctype html><html><body style="margin:0"><div style="position:absolute;left:16px;top:16px;width:32px;height:32px;background:#ff0000"></div>
        <script>window.seek = t => {};</script></body></html>
        """.write(to: dir.appendingPathComponent("g.html"), atomically: true, encoding: .utf8)
        var still = GraphicRenderRequest(html: dir.appendingPathComponent("g.html"), output: dir.appendingPathComponent("plain.png"), width: 64, height: 64, fps: 30, duration: 1)
        still.frameAt = 0; still.background = "#2b2f36"
        try await HTMLGraphicRenderer.renderStill(still)
        let corner = try rawPixel(still.output, x: 2, y: 2), inside = try rawPixel(still.output, x: 32, y: 32)
        XCTAssertEqual(corner.a, 255); XCTAssertEqual(corner.r, 0x2b, accuracy: 2); XCTAssertEqual(corner.g, 0x2f, accuracy: 2); XCTAssertEqual(corner.b, 0x36, accuracy: 2)
        XCTAssertEqual(inside.a, 255); XCTAssertGreaterThan(inside.r, 200)
    }

    func testRendersATransparentClipAndFrames() async throws {
        let dir = try folder()
        // A red box that only appears once t > 0.1 s; transparent everywhere else.
        try """
        <!doctype html><html><body style="margin:0"><div id="b" style="position:absolute;left:16px;top:16px;width:32px;height:32px;background:#ff0000;opacity:0"></div>
        <script>window.seek = t => { document.getElementById('b').style.opacity = t > 0.1 ? 1 : 0; };</script></body></html>
        """.write(to: dir.appendingPathComponent("g.html"), atomically: true, encoding: .utf8)

        let clip = GraphicRenderRequest(html: dir.appendingPathComponent("g.html"), output: dir.appendingPathComponent("g.mov"), width: 64, height: 64, fps: 30, duration: 0.2)
        let frames = try await HTMLGraphicRenderer.renderClip(clip)
        XCTAssertEqual(frames, 6)
        let asset = AVURLAsset(url: clip.output)
        let track = try await asset.loadTracks(withMediaType: .video).first
        XCTAssertNotNil(track)
        let size = try await XCTUnwrap(track).load(.naturalSize)
        XCTAssertEqual(Int(size.width), 64); XCTAssertEqual(Int(size.height), 64)
        let seconds = try await asset.load(.duration).seconds
        XCTAssertEqual(seconds, 0.2, accuracy: 0.05)
        // The hidden copy used for loading is gone.
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: dir.path).filter { $0.hasPrefix(".render-") }, [])

        // Frame at 0.15 s: exactly 64x64, the box opaque red, the corner fully transparent.
        var still = GraphicRenderRequest(html: clip.html, output: dir.appendingPathComponent("f.png"), width: 64, height: 64, fps: 30, duration: 1)
        still.frameAt = 0.15
        try await HTMLGraphicRenderer.renderStill(still)
        let rep = try XCTUnwrap(NSBitmapImageRep(data: Data(contentsOf: still.output)))
        XCTAssertEqual(rep.pixelsWide, 64)
        let inside = try pixel(still.output, x: 32, y: 32), corner = try pixel(still.output, x: 2, y: 2)
        XCTAssertEqual(inside.a, 255); XCTAssertGreaterThan(inside.r, 200); XCTAssertLessThan(inside.g, 60); XCTAssertLessThan(inside.b, 60)
        XCTAssertEqual(corner.a, 0)
        // Before the box appears the whole frame is transparent.
        still.frameAt = 0
        try await HTMLGraphicRenderer.renderStill(still)
        XCTAssertEqual(try pixel(still.output, x: 32, y: 32).a, 0)
    }

    func testAPageWithoutSeekFailsWithAUsefulMessage() async throws {
        let dir = try folder()
        try "<!doctype html><html><body>no seek here</body></html>".write(to: dir.appendingPathComponent("n.html"), atomically: true, encoding: .utf8)
        var request = GraphicRenderRequest(html: dir.appendingPathComponent("n.html"), output: dir.appendingPathComponent("n.png"), width: 32, height: 32)
        request.frameAt = 0
        do { try await HTMLGraphicRenderer.renderStill(request); XCTFail("should have thrown") }
        catch { XCTAssertTrue("\(error)".contains("window.seek"), "\(error)") }
    }

    func testTheNetworkIsBlocked() async throws {
        let dir = try folder()
        // Green means the page's request out was refused; red means it got through.
        try """
        <!doctype html><html><body style="margin:0"><div id="s" style="width:32px;height:32px;background:#ff0000"></div>
        <script>window.result = 'pending'; fetch('https://example.com').then(() => { window.result = 'open' }).catch(() => { window.result = 'blocked' });
        window.seek = async t => { await new Promise(r => setTimeout(r, 500)); document.getElementById('s').style.background = window.result === 'blocked' ? '#00ff00' : '#ff0000'; };</script></body></html>
        """.write(to: dir.appendingPathComponent("net.html"), atomically: true, encoding: .utf8)
        var request = GraphicRenderRequest(html: dir.appendingPathComponent("net.html"), output: dir.appendingPathComponent("net.png"), width: 32, height: 32)
        request.frameAt = 0
        try await HTMLGraphicRenderer.renderStill(request)
        let p = try pixel(request.output, x: 16, y: 16)
        XCTAssertGreaterThan(p.g, 200); XCTAssertLessThan(p.r, 60)
    }
}
