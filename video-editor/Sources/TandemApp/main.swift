import AppKit
import TandemAssets

// Studio's entry point. AppKit owns the app lifecycle (so project windows,
// the keymap and the substo:// URL scheme are under our control); the
// panels inside each window are SwiftUI.
//
// Before anything opens the asset library, the folders the app had as
// Substo Video move to their Studio names, if the CLI hasn't already
// (`FolderRename`).
FolderRename.runAtLaunch()
MainActor.assumeIsolated {
    let delegate = AppDelegate()
    let app = NSApplication.shared
    app.delegate = delegate
    app.run()
    _ = delegate
}
