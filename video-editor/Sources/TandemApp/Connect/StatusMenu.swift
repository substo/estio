import AppKit
import TandemConnect

/// Studio's menu-bar item, there whenever the app runs (windows or not):
/// the active site's brand, each connection with its Location and status,
/// connecting, disconnecting, launch at login and quitting.
@MainActor
final class StatusMenuController: NSObject, NSMenuDelegate {
    private let item: NSStatusItem
    private let connections: ConnectionsController
    private let menu = NSMenu()

    init(connections: ConnectionsController) {
        self.connections = connections
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        super.init()
        menu.delegate = self
        menu.autoenablesItems = false
        item.menu = menu
        item.button?.setAccessibilityLabel("Studio")
        refresh()
    }

    /// The item's icon and tooltip; the menu itself is built when it opens.
    func refresh() {
        let brand = connections.activeBrand
        item.button?.image = BrandImages.statusItemImage(brand)
        item.button?.imageScaling = .scaleProportionallyDown
        var tip = "Studio"
        if let line = connections.activeLine, let active = connections.file.activeConnection {
            tip = "Studio · \(line) · \(connections.status(of: active.origin).text(host: AppOrigin.host(active.origin)))"
        }
        item.button?.toolTip = tip
        if menuIsOpen { StatusMenuBuilder.fill(menu, entries: ConnectMenuModel.entries(connections.menuState), brand: connections.brand(for:), perform: connections.perform) }
    }

    private var menuIsOpen = false

    func menuNeedsUpdate(_ menu: NSMenu) {
        StatusMenuBuilder.fill(menu, entries: ConnectMenuModel.entries(connections.menuState), brand: connections.brand(for:), perform: connections.perform)
    }

    /// Opens the menu as a click would, and closes it after `seconds`
    /// (`substo url "menubar?open=5&out=/tmp/menu.png"`). With `capture`,
    /// the open menu is written there first, from inside the app.
    func open(for seconds: Double, capture: String? = nil) {
        let timer = Timer(timeInterval: seconds, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated {
                if let capture { Self.captureMenu(to: capture) }
                self?.menu.cancelTracking()
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        DispatchQueue.main.async { [weak self] in self?.item.button?.performClick(nil) }
    }

    private static func captureMenu(to path: String) {
        let windows = NSApp.windows.filter { $0.isVisible && NSStringFromClass(type(of: $0)).contains("Menu") }
        guard let window = windows.max(by: { $0.frame.height < $1.frame.height }), let image = WindowSnapshot.image(of: window) else {
            return NSLog("Studio: no open menu to capture")
        }
        let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
        try? data?.write(to: URL(fileURLWithPath: path))
    }

    /// Chooses the item with this title, as clicking it would
    /// (`substo url "menubar?pick=Connect to Estio…"`).
    func pick(_ title: String) {
        let entries = ConnectMenuModel.entries(connections.menuState)
        guard let action = entries.first(where: { $0.title == title })?.action else {
            return NSLog("Studio: no menu-bar item called %@", title)
        }
        connections.perform(action)
    }

    func menuWillOpen(_ menu: NSMenu) { menuIsOpen = true }
    func menuDidClose(_ menu: NSMenu) { menuIsOpen = false }
}

/// Turns the menu model's entries into menu items.
@MainActor
enum StatusMenuBuilder {
    static func fill(_ menu: NSMenu, entries: [ConnectMenuEntry], brand: (String) -> ResolvedBrand, perform: @escaping (ConnectMenuAction) -> Void) {
        menu.removeAllItems()
        for entry in entries {
            guard entry.kind == .item else {
                menu.addItem(.separator())
                continue
            }
            let item: NSMenuItem
            if let action = entry.action {
                // After the menu has closed, so alerts and the Keychain dialog
                // aren't run from inside it.
                item = ClosureMenuItem(entry.title, state: entry.checked ? .on : .off) { DispatchQueue.main.async { perform(action) } }
            } else {
                item = NSMenuItem(title: entry.title, action: nil, keyEquivalent: "")
                item.isEnabled = false
                item.state = entry.checked ? .on : .off
            }
            item.indentationLevel = entry.indent
            if let origin = entry.iconOrigin { item.image = BrandImages.image(brand(origin), size: 16) }
            if case .quit = entry.action { item.keyEquivalent = "q" }
            menu.addItem(item)
        }
    }
}
