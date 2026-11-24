import AppKit

// Substo Video's entry point. AppKit owns the app lifecycle (so project windows,
// the keymap and the substo:// URL scheme are under our control); the
// panels inside each window are SwiftUI.
MainActor.assumeIsolated {
    // `substo graphic` renders an HTML motion graphic headless (no window, no editor) and exits.
    if CommandLine.arguments.count > 1, CommandLine.arguments[1] == GraphicRenderEntry.flag { GraphicRenderEntry.run(Array(CommandLine.arguments.dropFirst(2))) }
    let delegate = AppDelegate()
    let app = NSApplication.shared
    app.delegate = delegate
    app.run()
    _ = delegate
}
