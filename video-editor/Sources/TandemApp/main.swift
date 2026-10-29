import AppKit

// Substo Video's entry point. AppKit owns the app lifecycle (so project windows,
// the keymap and the substo:// URL scheme are under our control); the
// panels inside each window are SwiftUI.
MainActor.assumeIsolated {
    let delegate = AppDelegate()
    let app = NSApplication.shared
    app.delegate = delegate
    app.run()
    _ = delegate
}
