import Foundation
import os
import TandemMedia

/// Moves the folders the app had as Substo Video to their Studio names,
/// once (see `RenamedFolder`). The app's and the `substo` command's
/// entry points call `runAtLaunch()` before anything opens the asset
/// library, so whichever starts first after the update does the move, and
/// the other finds it done. It lives here rather than in the getters for
/// `AssetLibrary.defaultRoot` and `SharedLibrary.standardRoot`, which tests
/// and previews read freely and which shouldn't move folders as a side
/// effect.
///
/// A folder moves only when the old one is there and the new one isn't,
/// so nothing is ever merged or replaced: when both are there, both are
/// kept and Studio uses the new one. The shared library also stays put
/// when the asset settings name a library folder of their own, or the
/// environment names one (`$SUBSTO_LIBRARY`, or `$SUBSTO_ASSETS_ROOT`,
/// whose library is inside it).
public enum FolderRename {
    public enum Outcome: Equatable, Sendable {
        case moved
        /// The new folder is there and the old one isn't.
        case alreadyMoved
        /// Neither is there.
        case nothingToMove
        /// Both are there; neither was touched.
        case keptBoth
        /// Left where it is on purpose.
        case skipped(String)
        case failed(String)
    }

    public struct Step: Equatable, Sendable {
        public let folder: RenamedFolder
        public let outcome: Outcome
    }

    private static let log = Logger(subsystem: "com.substo.video", category: "folder-rename")

    /// Moves this user's folders, unless this is a test run or an isolated
    /// process, and logs what it couldn't move.
    public static func runAtLaunch(environment: [String: String] = ProcessInfo.processInfo.environment) {
        // Tests never touch the real folders.
        guard NSClassFromString("XCTestCase") == nil, !isIsolated(environment) else { return }
        for step in run(in: .user, environment: environment) {
            let old = step.folder.old.path, new = step.folder.new.path
            switch step.outcome {
            case .moved:
                log.notice("Moved \(old, privacy: .public) to \(new, privacy: .public)")
            case .keptBoth:
                log.notice("Kept both \(old, privacy: .public) and \(new, privacy: .public); Studio uses the second")
            case .failed(let reason):
                log.error("Couldn't move \(old, privacy: .public) to \(new, privacy: .public): \(reason, privacy: .public)")
            case .skipped(let reason):
                log.info("Left \(old, privacy: .public) where it is: \(reason, privacy: .public)")
            case .alreadyMoved, .nothingToMove:
                break
            }
        }
    }

    /// True for a process told to keep away from this Mac's library and
    /// settings (the CLI tests' `substo` runs, an agent's scratch library):
    /// it leaves every folder alone, and the next ordinary start moves them.
    public static func isIsolated(_ environment: [String: String]) -> Bool {
        [SharedLibrary.environmentKey, "SUBSTO_ASSETS_ROOT", "SUBSTO_SETTINGS"].contains { !(environment[$0] ?? "").isEmpty }
    }

    /// Moves Application Support's and Caches' folders, then the shared
    /// library. Application Support goes first so the library's check
    /// reads the asset settings where Studio now keeps them.
    @discardableResult
    public static func run(in places: RenamedFolder.Places, environment: [String: String]) -> [Step] {
        let support = RenamedFolder.applicationSupport(in: places)
        let caches = RenamedFolder.caches(in: places)
        let library = RenamedFolder.sharedLibrary(in: places)
        var steps = [Step(folder: support, outcome: move(support)), Step(folder: caches, outcome: move(caches))]
        steps.append(Step(folder: library, outcome: libraryReason(support: support, environment: environment).map(Outcome.skipped) ?? move(library)))
        return steps
    }

    /// Why the shared library shouldn't move, or nil when it should.
    static func libraryReason(support: RenamedFolder, environment: [String: String]) -> String? {
        if let path = environment[SharedLibrary.environmentKey], !path.isEmpty { return "$\(SharedLibrary.environmentKey) names the library" }
        if let path = environment["SUBSTO_ASSETS_ROOT"], !path.isEmpty { return "$SUBSTO_ASSETS_ROOT names the asset library" }
        // The new folder's settings are the ones Studio reads; the old
        // folder's are there too when both were kept.
        for folder in [support.new, support.old] {
            if let chosen = AssetSettings.load(from: folder.appendingPathComponent("Assets", isDirectory: true)).sharedLibrary {
                return "the asset settings put the library at \(chosen)"
            }
        }
        return nil
    }

    /// Renames `folder.old` to `folder.new` when only the old one is there.
    static func move(_ folder: RenamedFolder) -> Outcome {
        let oldThere = present(folder.old), newThere = present(folder.new)
        switch (oldThere, newThere) {
        case (false, true): return .alreadyMoved
        case (false, false): return .nothingToMove
        case (true, true): return .keptBoth
        case (true, false): break
        }
        do {
            try FileManager.default.createDirectory(at: folder.new.deletingLastPathComponent(), withIntermediateDirectories: true)
            // moveItem refuses to replace anything at the new path, so an
            // app and a CLI starting together can't both move it: the one
            // that loses finds the old folder gone.
            try FileManager.default.moveItem(at: folder.old, to: folder.new)
            return .moved
        } catch {
            if !present(folder.old) && present(folder.new) { return .alreadyMoved }
            return .failed(error.localizedDescription)
        }
    }

    /// True when anything is at `url`, a dangling link included.
    private static func present(_ url: URL) -> Bool {
        (try? FileManager.default.attributesOfItem(atPath: url.path)) != nil
    }
}
