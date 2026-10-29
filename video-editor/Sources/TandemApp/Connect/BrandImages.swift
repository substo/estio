import AppKit
import TandemConnect

/// The active connection's brand as images: the menu-bar item, menu rows,
/// the Dock icon while Studio runs and the About panel. The app icon in
/// Finder stays Studio's own; it's fixed when the app is built.
@MainActor
enum BrandImages {
    /// The site's icon (Estio sends a PNG, Substo an SVG, which NSImage
    /// reads on macOS 14 and later), or nil when it's missing or unreadable.
    static func icon(_ data: Data?) -> NSImage? {
        guard let data, let image = NSImage(data: data), image.isValid, image.size.width > 0, image.size.height > 0 else { return nil }
        return image
    }

    /// The brand at `size` points: its icon, or its first letter on a
    /// rounded square.
    static func image(_ brand: ResolvedBrand, size: CGFloat) -> NSImage {
        if let icon = icon(brand.icon) { return scaled(icon, size: size) }
        return monogram(brand.monogram, size: size)
    }

    static func scaled(_ image: NSImage, size: CGFloat) -> NSImage {
        let out = NSImage(size: NSSize(width: size, height: size), flipped: false) { rect in
            image.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1)
            return true
        }
        out.accessibilityDescription = image.accessibilityDescription
        return out
    }

    static func monogram(_ letter: String, size: CGFloat, template: Bool = false) -> NSImage {
        let image = NSImage(size: NSSize(width: size, height: size), flipped: false) { rect in
            let inset = rect.insetBy(dx: size * 0.04, dy: size * 0.04)
            let shape = NSBezierPath(roundedRect: inset, xRadius: size * 0.22, yRadius: size * 0.22)
            (template ? NSColor.black : NSColor(calibratedRed: 0.07, green: 0.09, blue: 0.15, alpha: 1)).setFill()
            shape.fill()
            let font = NSFont.systemFont(ofSize: size * 0.58, weight: .bold)
            let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: template ? NSColor.clear : NSColor.white]
            let text = NSAttributedString(string: letter, attributes: attributes)
            let bounds = text.size()
            let origin = NSPoint(x: rect.midX - bounds.width / 2, y: rect.midY - bounds.height / 2 - font.descender / 2)
            if template, let context = NSGraphicsContext.current {
                // The letter is cut out of the square, so a template image
                // shows it in the menu bar's own colour.
                context.compositingOperation = .destinationOut
                NSAttributedString(string: letter, attributes: [.font: font, .foregroundColor: NSColor.black]).draw(at: origin)
                context.compositingOperation = .sourceOver
            } else {
                text.draw(at: origin)
            }
            return true
        }
        image.isTemplate = template
        return image
    }

    /// The menu-bar item: the brand's icon, or Studio's own symbol with no
    /// connection.
    static func statusItemImage(_ brand: ResolvedBrand) -> NSImage {
        guard brand.app != nil else {
            let symbol = NSImage(systemSymbolName: "film.stack", accessibilityDescription: "Studio") ?? monogram("S", size: 18, template: true)
            symbol.isTemplate = true
            return symbol
        }
        if let icon = icon(brand.icon) { return scaled(icon, size: 18) }
        return monogram(brand.monogram, size: 18, template: true)
    }

    /// Studio's own icon from the bundle, never the Dock icon set at run
    /// time.
    static var neutralAppIcon: NSImage {
        NSWorkspace.shared.icon(forFile: Bundle.main.bundlePath)
    }

    /// The Dock icon: Studio's icon with the brand as a small badge in the
    /// corner, so it's still recognisably Studio.
    static func dockIcon(_ brand: ResolvedBrand) -> NSImage? {
        guard brand.app != nil else { return nil }
        let base = neutralAppIcon
        let mark = image(brand, size: 512)
        return NSImage(size: NSSize(width: 512, height: 512), flipped: false) { rect in
            base.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1)
            let side = rect.width * 0.4
            let badge = NSRect(x: rect.maxX - side - rect.width * 0.04, y: rect.minY + rect.width * 0.06, width: side, height: side)
            let ring = NSBezierPath(roundedRect: badge.insetBy(dx: -side * 0.06, dy: -side * 0.06), xRadius: side * 0.3, yRadius: side * 0.3)
            NSColor.white.setFill()
            NSGraphicsContext.saveGraphicsState()
            let shadow = NSShadow()
            shadow.shadowBlurRadius = side * 0.08
            shadow.shadowOffset = NSSize(width: 0, height: -side * 0.03)
            shadow.shadowColor = NSColor.black.withAlphaComponent(0.35)
            shadow.set()
            ring.fill()
            NSGraphicsContext.restoreGraphicsState()
            NSGraphicsContext.saveGraphicsState()
            NSBezierPath(roundedRect: badge, xRadius: side * 0.24, yRadius: side * 0.24).addClip()
            mark.draw(in: badge, from: .zero, operation: .sourceOver, fraction: 1)
            NSGraphicsContext.restoreGraphicsState()
            return true
        }
    }
}
