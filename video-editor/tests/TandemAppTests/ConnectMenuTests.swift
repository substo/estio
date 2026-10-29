import AppKit
import XCTest
@testable import TandemApp
import TandemConnect

/// The menu-bar menu and the brand images, from the menu model.
@MainActor
final class ConnectMenuTests: XCTestCase {
    static let svg = Data(##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#111827"/></svg>"##.utf8)

    func testTheMenuIsBuiltFromTheModelAndRunsItsActions() {
        var state = ConnectMenuState()
        state.rows = [.init(origin: "https://estio.co", brand: "Estio", place: "Acme Ltd", status: .online)]
        state.active = "https://estio.co"
        state.loginItem = .enabled
        let menu = NSMenu()
        var performed: [ConnectMenuAction] = []
        let brand = ResolvedBrand(app: "substo", name: "Substo", icon: Self.svg, monogram: "S")
        StatusMenuBuilder.fill(menu, entries: ConnectMenuModel.entries(state), brand: { _ in brand }, perform: { performed.append($0) })
        XCTAssertEqual(menu.items.map(\.title), ["Estio · Acme Ltd", "Online", "", "Connect to Substo…", "", "Open Studio on the web", "Open editor", "",
                                                 "Launch at login", "Disconnect Estio…", "", "Quit Studio"])
        let row = menu.items[0]
        XCTAssertEqual(row.state, .on, "the active connection is ticked")
        XCTAssertNotNil(row.image, "with the brand's icon")
        XCTAssertFalse(menu.items[1].isEnabled, "the status is a line, not a command")
        XCTAssertEqual(menu.items[1].indentationLevel, 1)
        XCTAssertEqual(menu.items[8].state, .on)
        XCTAssertTrue(menu.items[2].isSeparatorItem)

        let connect = menu.items[3]
        _ = connect.target?.perform(connect.action, with: connect)
        let ran = expectation(description: "runs after the menu closes")
        DispatchQueue.main.async { ran.fulfill() }
        wait(for: [ran], timeout: 2)
        XCTAssertEqual(performed, [.connect("https://substo.com")])
    }

    func testBrandIconsLoadAsPNGOrSVGAndFallBackToAMonogram() throws {
        XCTAssertNotNil(BrandImages.icon(Self.svg), "Substo's SVG mark")
        let png = try XCTUnwrap(NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 4, pixelsHigh: 4, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                                 isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)?
            .representation(using: .png, properties: [:]))
        XCTAssertNotNil(BrandImages.icon(png), "Estio's PNG")
        XCTAssertNil(BrandImages.icon(Data("not an image".utf8)))
        let fallback = BrandImages.image(ResolvedBrand(app: "estio", name: "Estio", icon: Data("junk".utf8), monogram: "E"), size: 16)
        XCTAssertEqual(fallback.size, NSSize(width: 16, height: 16))
        XCTAssertNotNil(fallback.cgImage(forProposedRect: nil, context: nil, hints: nil), "the monogram draws")

        XCTAssertNil(BrandImages.dockIcon(.neutral), "no connection: Studio's own icon")
        let badged = try XCTUnwrap(BrandImages.dockIcon(ResolvedBrand(app: "substo", name: "Substo", icon: Self.svg, monogram: "S")))
        XCTAssertEqual(badged.size, NSSize(width: 512, height: 512))
        XCTAssertTrue(BrandImages.statusItemImage(.neutral).isTemplate, "Studio's own item follows the menu bar's colour")
        XCTAssertTrue(BrandImages.statusItemImage(ResolvedBrand(app: "estio", name: "Estio", icon: nil, monogram: "E")).isTemplate)
        XCTAssertFalse(BrandImages.statusItemImage(ResolvedBrand(app: "substo", name: "Substo", icon: Self.svg, monogram: "S")).isTemplate)
    }

    func testTheMenuBarLinkOpensOrPicks() {
        XCTAssertEqual(AppURLCommand.parse(URL(string: "substo://menubar?open=5")!), .menuBar(openSeconds: 5, pick: nil))
        XCTAssertEqual(AppURLCommand.parse(URL(string: "substo://menubar?open=5&out=/tmp/m.png")!), .menuBar(openSeconds: 5, pick: nil, out: "/tmp/m.png"))
        XCTAssertEqual(AppURLCommand.parse(URL(string: "substo://menubar?pick=Connect%20to%20Estio%E2%80%A6")!), .menuBar(openSeconds: nil, pick: "Connect to Estio…"))
        XCTAssertEqual(AppURLCommand.parse(URL(string: "substo://menubar?open=999")!), .menuBar(openSeconds: 60, pick: nil))
        XCTAssertNil(AppURLCommand.parse(URL(string: "substo://menubar")!))
    }

    func testALoginItemLaunchIsRecognised() {
        func openApplication(_ propData: OSType?) -> NSAppleEventDescriptor {
            let event = NSAppleEventDescriptor(eventClass: AEEventClass(kCoreEventClass), eventID: AEEventID(kAEOpenApplication),
                                               targetDescriptor: nil, returnID: AEReturnID(kAutoGenerateReturnID), transactionID: AETransactionID(kAnyTransactionID))
            if let propData { event.setParam(NSAppleEventDescriptor(enumCode: propData), forKeyword: AEKeyword(keyAEPropData)) }
            return event
        }
        XCTAssertTrue(LaunchKind.isLoginItemLaunch(openApplication(OSType(keyAELaunchedAsLogInItem))))
        XCTAssertFalse(LaunchKind.isLoginItemLaunch(openApplication(nil)), "opened from Finder or the Dock")
        XCTAssertFalse(LaunchKind.isLoginItemLaunch(nil))
    }
}
