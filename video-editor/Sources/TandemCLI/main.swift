import Foundation
import TandemAssets

// `substo`: see Help.swift for the commands and CLI.swift for how they run.
// First, move the folders the app had as Substo Video to their Studio
// names, if the app hasn't already (`FolderRename`).
FolderRename.runAtLaunch()
let status = await CLI(
    arguments: Array(CommandLine.arguments.dropFirst()),
    directory: URL(fileURLWithPath: FileManager.default.currentDirectoryPath),
    environment: ProcessInfo.processInfo.environment
).run()
exit(status)
