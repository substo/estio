import XCTest
import TandemCore
import TandemMedia
@testable import TandemAssets

/// The app was called Substo Video, and its folders were named after it.
/// Studio moves them once, at app and CLI start: `~/Movies/Substo Library`
/// to `~/Movies/Studio Library`, and `Substo Video` in Application Support
/// and Caches to `Studio`. These tests use a temp home, never the real one.
final class FolderRenameTests: XCTestCase {
    /// A temp stand-in for this Mac's Application Support, Caches and Movies.
    func makePlaces() -> RenamedFolder.Places {
        let home = tempFolder("rename-home")
        return RenamedFolder.Places(
            applicationSupport: home.appendingPathComponent("Library/Application Support", isDirectory: true),
            caches: home.appendingPathComponent("Library/Caches", isDirectory: true),
            movies: home.appendingPathComponent("Movies", isDirectory: true)
        )
    }

    /// Writes `text` at `path` under `folder`, making its folders.
    @discardableResult
    func write(_ text: String, _ path: String, in folder: URL) throws -> URL {
        let url = folder.appendingPathComponent(path)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(text.utf8).write(to: url)
        return url
    }

    func read(_ path: String, in folder: URL) -> String? {
        (try? Data(contentsOf: folder.appendingPathComponent(path))).map { String(decoding: $0, as: UTF8.self) }
    }

    func exists(_ url: URL) -> Bool {
        FileManager.default.fileExists(atPath: url.path)
    }

    func testTheNewNames() {
        XCTAssertEqual(SharedLibrary.defaultName, "Studio Library")
        XCTAssertTrue(SharedLibrary.standardRoot.path.hasSuffix("/Movies/Studio Library"), SharedLibrary.standardRoot.path)
        XCTAssertTrue(AssetLibrary.defaultRoot.path.hasSuffix("/Application Support/Studio/Assets"), AssetLibrary.defaultRoot.path)
        XCTAssertTrue(AssetLibrary.defaultPreviewFolder.path.hasSuffix("/Caches/Studio/AssetPreviews"), AssetLibrary.defaultPreviewFolder.path)
        let places = makePlaces()
        XCTAssertEqual(RenamedFolder.sharedLibrary(in: places).old.lastPathComponent, "Substo Library")
        XCTAssertEqual(RenamedFolder.applicationSupport(in: places).old.lastPathComponent, "Substo Video")
        XCTAssertEqual(RenamedFolder.caches(in: places).new.lastPathComponent, "Studio")
    }

    func testMovesEachFolderWhenOnlyTheOldOneIsThere() throws {
        let places = makePlaces()
        let support = RenamedFolder.applicationSupport(in: places)
        let caches = RenamedFolder.caches(in: places)
        let library = RenamedFolder.sharedLibrary(in: places)
        try write("catalogue", "Assets/catalog.sqlite", in: support.old)
        try write("preview", "AssetPreviews/a.jpg", in: caches.old)
        try write("sticker", "Stickers/Star.mov", in: library.old)

        let steps = FolderRename.run(in: places, environment: [:])

        XCTAssertEqual(steps.map(\.outcome), [.moved, .moved, .moved], "\(steps)")
        XCTAssertEqual(read("Assets/catalog.sqlite", in: support.new), "catalogue")
        XCTAssertEqual(read("AssetPreviews/a.jpg", in: caches.new), "preview")
        XCTAssertEqual(read("Stickers/Star.mov", in: library.new), "sticker")
        XCTAssertFalse(exists(support.old))
        XCTAssertFalse(exists(caches.old))
        XCTAssertFalse(exists(library.old))

        // Once moved, there's nothing left to do.
        XCTAssertEqual(FolderRename.run(in: places, environment: [:]).map(\.outcome), [.alreadyMoved, .alreadyMoved, .alreadyMoved])
    }

    func testNothingHappensWithoutTheOldFolders() {
        let places = makePlaces()
        XCTAssertEqual(FolderRename.run(in: places, environment: [:]).map(\.outcome), [.nothingToMove, .nothingToMove, .nothingToMove])
        XCTAssertFalse(exists(RenamedFolder.sharedLibrary(in: places).new), "the move never makes a folder that wasn't there")
    }

    func testKeepsBothWhenTheNewFolderIsAlreadyThere() throws {
        let places = makePlaces()
        let support = RenamedFolder.applicationSupport(in: places)
        let caches = RenamedFolder.caches(in: places)
        let library = RenamedFolder.sharedLibrary(in: places)
        for rename in [support, caches, library] {
            try write("old", "file.txt", in: rename.old)
            try write("new", "file.txt", in: rename.new)
        }
        // An empty new folder still counts: a rename onto it would replace it.
        let emptyPlaces = makePlaces()
        let emptyLibrary = RenamedFolder.sharedLibrary(in: emptyPlaces)
        try write("old", "Stickers/Star.mov", in: emptyLibrary.old)
        try FileManager.default.createDirectory(at: emptyLibrary.new, withIntermediateDirectories: true)

        XCTAssertEqual(FolderRename.run(in: places, environment: [:]).map(\.outcome), [.keptBoth, .keptBoth, .keptBoth])
        for rename in [support, caches, library] {
            XCTAssertEqual(read("file.txt", in: rename.old), "old")
            XCTAssertEqual(read("file.txt", in: rename.new), "new")
        }
        XCTAssertEqual(FolderRename.run(in: emptyPlaces, environment: [:]).last?.outcome, .keptBoth)
        XCTAssertEqual(read("Stickers/Star.mov", in: emptyLibrary.old), "old")
    }

    func testTheLibraryStaysWhereSettingsPutIt() throws {
        let places = makePlaces()
        let support = RenamedFolder.applicationSupport(in: places)
        let library = RenamedFolder.sharedLibrary(in: places)
        try write("sticker", "Stickers/Star.mov", in: library.old)
        // Saved by the old app: the settings move with their folder first,
        // and still say where the library is.
        try AssetSettings(sharedLibrary: library.old.path).save(to: support.old.appendingPathComponent("Assets", isDirectory: true))

        let steps = FolderRename.run(in: places, environment: [:])

        XCTAssertEqual(steps.first?.outcome, .moved)
        guard case .skipped = steps.last?.outcome else { return XCTFail("\(steps)") }
        XCTAssertEqual(read("Stickers/Star.mov", in: library.old), "sticker")
        XCTAssertFalse(exists(library.new))
    }

    func testTheLibraryStaysWhenTheEnvironmentNamesOne() throws {
        for key in [SharedLibrary.environmentKey, "SUBSTO_ASSETS_ROOT"] {
            let places = makePlaces()
            let library = RenamedFolder.sharedLibrary(in: places)
            try write("sticker", "Stickers/Star.mov", in: library.old)

            let steps = FolderRename.run(in: places, environment: [key: tempFolder("override").path])

            guard case .skipped = steps.last?.outcome else { return XCTFail("\(key): \(steps)") }
            XCTAssertEqual(read("Stickers/Star.mov", in: library.old), "sticker", key)
            XCTAssertFalse(exists(library.new), key)
        }
    }

    /// The CLI tests run the real `substo` binary with a scratch library
    /// and settings; such a process moves nothing at launch.
    func testAnIsolatedProcessLeavesThisMacsFoldersAlone() {
        XCTAssertFalse(FolderRename.isIsolated([:]))
        XCTAssertFalse(FolderRename.isIsolated(["SUBSTO_LIBRARY": ""]))
        for key in ["SUBSTO_LIBRARY", "SUBSTO_ASSETS_ROOT", "SUBSTO_SETTINGS"] {
            XCTAssertTrue(FolderRename.isIsolated([key: "/tmp/elsewhere"]), key)
        }
    }

    /// Projects store a shared library file's absolute path, so a project
    /// saved before the move still names `~/Movies/Substo Library/...`.
    func testOldLibraryPathsInProjectsFindTheMovedFiles() throws {
        let places = makePlaces()
        let library = RenamedFolder.sharedLibrary(in: places)
        let star = try write("sticker", "Stickers/Star.mov", in: library.old)
        let stored = star.path
        FolderRename.run(in: places, environment: [:])
        let moved = library.new.appendingPathComponent("Stickers/Star.mov")
        XCTAssertTrue(exists(moved))

        XCTAssertEqual(RenamedFolder.resolve(stored, in: [library]), moved.path)
        let folder = ProjectFolder(root: tempFolder("project"))
        XCTAssertEqual(folder.url(forPath: stored, renamed: [library]).path, moved.path)
        let item = MediaItem(id: "med_star", path: stored, kind: .video, role: .sticker, duration: Time(seconds: 5), hasVideo: true)
        XCTAssertEqual(folder.url(for: item, renamed: [library]).path, moved.path)

        // A file that's in neither keeps the path the project stored, so
        // missing media reports name it as it was.
        let gone = library.old.appendingPathComponent("Stickers/Gone.mov").path
        XCTAssertEqual(RenamedFolder.resolve(gone, in: [library]), gone)
        // Other paths, and relative ones, are left alone.
        XCTAssertEqual(RenamedFolder.resolve("/Volumes/Work/Star.mov", in: [library]), "/Volumes/Work/Star.mov")
        XCTAssertEqual(folder.url(forPath: "media/Substo Library/Stickers/Star.mov", renamed: [library]).path,
                       folder.root.appendingPathComponent("media/Substo Library/Stickers/Star.mov").path)
        // A folder whose name only starts the same isn't the old library.
        let lookalike = library.old.deletingLastPathComponent().appendingPathComponent("Substo Library 2/Stickers/Star.mov").path
        XCTAssertEqual(RenamedFolder.resolve(lookalike, in: [library]), lookalike)
    }

    func testAFileStillInTheOldFolderIsUsedThere() throws {
        // The library wasn't moved (both were there): the old path is real.
        let places = makePlaces()
        let library = RenamedFolder.sharedLibrary(in: places)
        let star = try write("old", "Stickers/Star.mov", in: library.old)
        try write("new", "Stickers/Star.mov", in: library.new)
        XCTAssertEqual(RenamedFolder.resolve(star.path, in: [library]), star.path)
    }
}
