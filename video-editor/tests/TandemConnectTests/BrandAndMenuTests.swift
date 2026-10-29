import Foundation
import XCTest
@testable import TandemConnect

final class BrandAndMenuTests: XCTestCase {
    static let svg = Data(##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#111827"/></svg>"##.utf8)

    func testTheBrandAndItsIconComeFromTheSite() async throws {
        let site = FakeSite { request in
            if request.url == "https://substo.com/api/studio/device/brand" {
                XCTAssertEqual(request.method, "GET")
                XCTAssertNil(request.headers["Authorization"])
                return envelope(["app": "substo", "name": "Substo", "iconUrl": "https://substo.com/images/substo-mark.svg"])
            }
            XCTAssertEqual(request.url, "https://substo.com/images/substo-mark.svg")
            return HTTPResponse(status: 200, contentType: "image/svg+xml", body: Self.svg)
        }
        let brand = try await BrandClient.fetch(origin: "https://substo.com", transport: site.transport, now: Date(timeIntervalSince1970: 5))
        XCTAssertEqual(brand, BrandCache(app: "substo", name: "Substo", iconURL: "https://substo.com/images/substo-mark.svg", icon: Self.svg, fetchedAt: Date(timeIntervalSince1970: 5)))
    }

    func testAnIconElsewhereOrNotAnImageIsNotFetched() async throws {
        let site = FakeSite { request in
            if request.url.hasSuffix("/brand") { return envelope(["app": "estio", "name": "Estio", "iconUrl": "https://evil.example/x.png"]) }
            XCTFail("no icon request")
            return HTTPResponse(status: 404, contentType: nil, body: Data())
        }
        let brand = try await BrandClient.fetch(origin: "https://estio.co", transport: site.transport)
        XCTAssertNil(brand.icon)
        XCTAssertNil(brand.iconURL)
        let html = FakeSite { request in
            request.url.hasSuffix("/brand") ? envelope(["app": "estio", "name": "Estio", "iconUrl": "https://estio.co/x.png"])
                : HTTPResponse(status: 200, contentType: "text/html", body: Data("<html>".utf8))
        }
        let other = try await BrandClient.fetch(origin: "https://estio.co", transport: html.transport)
        XCTAssertNil(other.icon)
        for bad: JSONValue in [["app": "tenant", "name": "x", "iconUrl": nil], ["app": "estio", "name": ""], [:]] {
            let broken = FakeSite { _ in envelope(bad) }
            await assertThrowsCode("brand_failed") { try await BrandClient.fetch(origin: "https://estio.co", transport: broken.transport) }
        }
    }

    func testBrandsFallBackToTheBuiltInNamesOnlyWhenTheyNeverLoaded() {
        XCTAssertEqual(ResolvedBrand.resolve(nil), .neutral)
        let estio = Connection(origin: "https://estio.co", name: "Mac", deviceId: fixtureId, businessName: "Acme")
        XCTAssertEqual(ResolvedBrand.resolve(estio), ResolvedBrand(app: "estio", name: "Estio", icon: nil, monogram: "E"))
        var cached = estio
        cached.brand = BrandCache(app: "estio", name: "Estio Pro", iconURL: nil, icon: Data([1]), fetchedAt: Date())
        XCTAssertEqual(ResolvedBrand.resolve(cached), ResolvedBrand(app: "estio", name: "Estio Pro", icon: Data([1]), monogram: "E"))
        let local = Connection(origin: "http://localhost:3000", name: "Mac", deviceId: fixtureId, businessName: nil)
        XCTAssertEqual(ResolvedBrand.resolve(local).name, "localhost")
    }

    func testTheMenuForANewMacOffersBothSitesAndTheOldPairing() {
        var state = ConnectMenuState()
        state.adoptable = "https://substo.com"
        let titles = ConnectMenuModel.entries(state).map(\.title)
        XCTAssertEqual(titles, ["Connect to Estio…", "Connect to Substo…", "Use this Mac's existing substo.com pairing…", "",
                                "Open editor", "", "Launch at login", "", "Quit Studio"])
        XCTAssertEqual(ConnectMenuModel.entries(state)[2].action, .adopt("https://substo.com"))
    }

    func testTheMenuShowsEachConnectionItsStatusAndTheActiveOne() {
        var state = ConnectMenuState()
        state.rows = [
            .init(origin: "https://estio.co", brand: "Estio", place: "Acme Ltd", status: .online),
            .init(origin: "https://substo.com", brand: "Substo", place: "Martin Mac", status: .revoked),
        ]
        state.active = "https://estio.co"
        state.adoptable = "https://substo.com"
        state.loginItem = .enabled
        let entries = ConnectMenuModel.entries(state)
        XCTAssertEqual(entries.map(\.title), [
            "Estio · Acme Ltd", "Online", "Substo · Martin Mac", "Disconnected by the site (revoked)", "",
            "Open Studio on the web", "Open editor", "", "Launch at login", "Disconnect Estio…", "Disconnect Substo…", "", "Quit Studio",
        ])
        XCTAssertEqual(entries[0].action, .makeActive("https://estio.co"))
        XCTAssertTrue(entries[0].checked)
        XCTAssertFalse(entries[2].checked)
        XCTAssertEqual(entries[0].iconOrigin, "https://estio.co")
        XCTAssertFalse(entries[1].isEnabled, "a status line, not a command")
        XCTAssertEqual(entries[1].indent, 1)
        XCTAssertEqual(entries[5].action, .openWeb("https://estio.co"))
        XCTAssertTrue(entries[8].checked)
        XCTAssertEqual(entries[10].action, .disconnect("https://substo.com"))
    }

    func testThePairingShowsItsCodeAndAProblemShowsUnderConnect() {
        var state = ConnectMenuState()
        state.pairings = [.init(origin: "https://estio.co", brand: "Estio", code: "ABCD-EF23")]
        state.problems = ["https://substo.com": ConnectMenuModel.problem("pairing_expired")]
        state.loginItem = .requiresApproval
        state.heartbeatOnly = true
        let entries = ConnectMenuModel.entries(state)
        XCTAssertEqual(entries.map(\.title), [
            "Estio · waiting for approval", "Code ABCD-EF23: open the approval page", "Cancel", "",
            "Connect to Substo…", "The code expired. Connect again.", "",
            "Open editor", "", "Launch at login", "Allow it in System Settings…", "",
            "Test mode: heartbeats only, no jobs or sign-ins", "Quit Studio",
        ])
        XCTAssertEqual(entries[1].action, .openApproval("https://estio.co"))
        XCTAssertEqual(entries[2].action, .cancelPairing("https://estio.co"))
        XCTAssertEqual(entries[10].action, .openLoginItemsSettings)
        var asking = state
        asking.pairings = [.init(origin: "https://estio.co", brand: "Estio", code: nil)]
        XCTAssertEqual(ConnectMenuModel.entries(asking)[1].title, "Asking estio.co for a code…")
    }

    func testStatusesReadPlainly() {
        var snapshot = WorkerSnapshot()
        XCTAssertEqual(ConnectionStatus.from(snapshot), .connecting)
        snapshot.link = .online
        XCTAssertEqual(ConnectionStatus.from(snapshot), .online)
        snapshot.busy = true
        XCTAssertEqual(ConnectionStatus.from(snapshot), .busy)
        snapshot.paused = true
        XCTAssertEqual(ConnectionStatus.from(snapshot), .paused)
        snapshot.link = .offline
        XCTAssertEqual(ConnectionStatus.from(snapshot), .offline)
        XCTAssertEqual(ConnectionStatus.offline.text(host: "estio.co"), "Offline: can't reach estio.co")
        var keychain = ConnectMenuState()
        keychain.rows = [.init(origin: "https://substo.com", brand: "Substo", place: "Mac", status: .needsKeychainAccess)]
        XCTAssertEqual(ConnectMenuModel.entries(keychain)[1].action, .allowKeychain("https://substo.com"))
        var online = ConnectMenuState()
        online.heartbeatOnly = true
        online.rows = [.init(origin: "https://estio.co", brand: "Estio", place: "Acme", status: .online)]
        XCTAssertEqual(ConnectMenuModel.entries(online)[1].title, "Online (heartbeat only)")
    }

    /// `SUBSTO_LIVE_CONNECT=1`: the public brand endpoint on both live sites
    /// (no key, no pairing).
    func testLiveBrandEndpoints() async throws {
        guard ProcessInfo.processInfo.environment["SUBSTO_LIVE_CONNECT"] == "1" else { throw XCTSkip("set SUBSTO_LIVE_CONNECT=1 to call estio.co and substo.com") }
        let transport = URLSessionTransport()
        let estio = try await BrandClient.fetch(origin: "https://estio.co", transport: transport)
        XCTAssertEqual(estio.app, "estio")
        XCTAssertEqual(estio.name, "Estio")
        XCTAssertEqual(estio.icon?.prefix(4), Data([0x89, 0x50, 0x4E, 0x47]), "a PNG")
        let substo = try await BrandClient.fetch(origin: "https://substo.com", transport: transport)
        XCTAssertEqual(substo.app, "substo")
        XCTAssertTrue(String(decoding: substo.icon ?? Data(), as: UTF8.self).contains("<svg"), "an SVG")
    }
}
