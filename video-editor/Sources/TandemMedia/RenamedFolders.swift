import Foundation

/// A folder the app renamed when it went from Substo Video to Studio, and
/// where it went:
///
///     ~/Movies/Substo Library                   -> ~/Movies/Studio Library
///     ~/Library/Application Support/Substo Video -> ~/Library/Application Support/Studio
///     ~/Library/Caches/Substo Video              -> ~/Library/Caches/Studio
///
/// `FolderRename` (TandemAssets) moves them once, at app and CLI start.
/// Projects store a shared library file's absolute path, so one saved
/// before the move still names the old folder; `resolve` finds the file in
/// the new one, and the next save stores whatever path the project has.
/// Asset IDs in the shared library are paths inside it, so the catalogue
/// describes its files again where they are on the next scan.
public struct RenamedFolder: Sendable, Equatable {
    public let old: URL
    public let new: URL

    public init(old: URL, new: URL) {
        self.old = old.standardizedFileURL
        self.new = new.standardizedFileURL
    }

    /// The app's folders in Application Support and Caches.
    public static let appFolderName = "Studio"
    public static let oldAppFolderName = "Substo Video"
    /// The shared library's folder in Movies.
    public static let libraryName = "Studio Library"
    public static let oldLibraryName = "Substo Library"

    /// Where the renamed folders sit: this Mac's, or a test's temp ones.
    public struct Places: Sendable, Equatable {
        public var applicationSupport: URL
        public var caches: URL
        public var movies: URL

        public init(applicationSupport: URL, caches: URL, movies: URL) {
            self.applicationSupport = applicationSupport
            self.caches = caches
            self.movies = movies
        }

        /// This user's.
        public static var user: Places {
            let files = FileManager.default
            return Places(
                applicationSupport: files.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0],
                caches: files.urls(for: .cachesDirectory, in: .userDomainMask)[0],
                movies: files.urls(for: .moviesDirectory, in: .userDomainMask)[0]
            )
        }
    }

    public static func applicationSupport(in places: Places) -> RenamedFolder {
        RenamedFolder(
            old: places.applicationSupport.appendingPathComponent(oldAppFolderName, isDirectory: true),
            new: places.applicationSupport.appendingPathComponent(appFolderName, isDirectory: true)
        )
    }

    public static func caches(in places: Places) -> RenamedFolder {
        RenamedFolder(
            old: places.caches.appendingPathComponent(oldAppFolderName, isDirectory: true),
            new: places.caches.appendingPathComponent(appFolderName, isDirectory: true)
        )
    }

    public static func sharedLibrary(in places: Places) -> RenamedFolder {
        RenamedFolder(
            old: places.movies.appendingPathComponent(oldLibraryName, isDirectory: true),
            new: places.movies.appendingPathComponent(libraryName, isDirectory: true)
        )
    }

    /// This user's renamed folders. Worked out once: `resolve` runs for
    /// every absolute media path.
    public static let standard: [RenamedFolder] = {
        let places = Places.user
        return [sharedLibrary(in: places), applicationSupport(in: places), caches(in: places)]
    }()

    /// The same file in the new folder, when `path` is in the old one.
    func moved(_ path: String) -> String? {
        let prefix = old.path + "/"
        guard path.hasPrefix(prefix) else { return nil }
        return new.path + "/" + path.dropFirst(prefix.count)
    }

    /// The path to read `path` from: in the new folder when it names a file
    /// in an old one that isn't there any more but is in the new one;
    /// otherwise `path` as it is.
    public static func resolve(_ path: String, in renames: [RenamedFolder] = standard) -> String {
        for rename in renames {
            guard let moved = rename.moved(path) else { continue }
            let files = FileManager.default
            if files.fileExists(atPath: path) { return path }
            return files.fileExists(atPath: moved) ? moved : path
        }
        return path
    }
}
