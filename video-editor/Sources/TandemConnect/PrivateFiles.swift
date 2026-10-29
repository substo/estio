import Foundation

/// Private folders and files, as config.ts keeps the Node companion's: the
/// folder is the user's own and 0700, the file 0600, no symlinks, and a
/// write lands whole or not at all.
enum PrivateFiles {
    static func ensureDirectory(_ url: URL) throws {
        let path = url.path
        if !FileManager.default.fileExists(atPath: path) {
            // Only the last folder is private; its parents are made as usual.
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        }
        try checkDirectory(url)
    }

    static func checkDirectory(_ url: URL) throws {
        var info = stat()
        guard lstat(url.path, &info) == 0 else { throw ConnectError("unsafe_config_directory") }
        guard info.st_mode & S_IFMT == S_IFDIR, info.st_uid == getuid(), info.st_mode & 0o077 == 0 else {
            throw ConnectError("unsafe_config_directory")
        }
    }

    /// Reads a small private file. Nil when it doesn't exist.
    static func read(_ url: URL, maxBytes: Int) throws -> Data? {
        let fd = open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        if fd < 0 {
            if errno == ENOENT { return nil }
            throw ConnectError("unsafe_config_file")
        }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_mode & S_IFMT == S_IFREG, info.st_uid == getuid(),
              info.st_mode & 0o077 == 0, info.st_size <= maxBytes else {
            throw ConnectError("unsafe_config_file")
        }
        return try handle.readToEnd() ?? Data()
    }

    /// Writes through a new temporary file in the same folder, synced, then
    /// renamed over the old one.
    static func write(_ data: Data, to url: URL) throws {
        let directory = url.deletingLastPathComponent()
        try ensureDirectory(directory)
        let temp = directory.appendingPathComponent(".\(url.lastPathComponent)-\(UUID().uuidString)")
        defer { unlink(temp.path) }
        let fd = open(temp.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw ConnectError("config_write_failed") }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        do {
            try handle.write(contentsOf: data)
            try handle.synchronize()
        } catch {
            throw ConnectError("config_write_failed")
        }
        guard rename(temp.path, url.path) == 0 else { throw ConnectError("config_write_failed") }
    }
}
