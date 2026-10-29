# The Studio app in Substo

This editor, the Studio Mac app, lives in the Estio repository at `video-editor/`, beside the Estio/Substo web apps (CRM and web Studio). It stays a native macOS app built with SwiftPM; the web build and deploy ignore this folder. Web Studio manages ideas, evidence, scripts and source recordings. The Mac app owns editable video projects and exports. Keep source footage and `.substo` projects outside the repository, for example under `~/Movies/Substo/Projects/<video-name>/`; keep reusable assets in the editor's library. The app is called Studio; the `substo` command, the `.substo` project format, the `substo://` link scheme, the `SUBSTO_*` variables and the bundle ID `com.substo.video` keep their names.

## First run on this Mac

This Mac has macOS 15, ffmpeg, and Xcode 26.3 in `/Applications/Xcode.app`. The selected developer directory is still Command Line Tools, so build with `DEVELOPER_DIR` set to Xcode. SwiftPM's Lottie dependency has already been fetched. Xcode 26.3's Swift optimizer crashes when compiling the timeline view for release; this checkout builds the working debug app by default. The app is signed locally and installed at `~/Applications/Studio.app`.

From this checkout:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SUBSTO_CODESIGN_IDENTITY=- bash setup_mac.sh
SUBSTO_SKILL_DIRS="" bash install.sh "$PWD/.local/bin"
"$PWD/.local/bin/substo" app
```

The local launcher path avoids changing your shell setup. To use `substo` from any folder, add this checkout's `.local/bin` to your shell PATH. `setup_mac.sh` installs the app to `~/Applications/Studio.app` and removes the old `~/Applications/Substo Video.app`. The empty `SUBSTO_SKILL_DIRS` skips installation of the editor skill.

## Renamed from Substo Video

The app was called Substo Video. The first time Studio or the `substo` command starts after the update, it moves its folders to their new names (`FolderRename`):

- `~/Movies/Substo Library` to `~/Movies/Studio Library`, unless the asset settings name another library folder;
- `~/Library/Application Support/Substo Video` to `~/Library/Application Support/Studio`;
- `~/Library/Caches/Substo Video` to `~/Library/Caches/Studio`.

A process with `SUBSTO_LIBRARY`, `SUBSTO_ASSETS_ROOT` or `SUBSTO_SETTINGS` set (tests, scratch runs) moves nothing. A folder moves only when the new one isn't there; when both are, both are kept and Studio uses the new one. Projects saved before the move name shared library files by their old absolute path, and those still open from the new folder (`RenamedFolder`). `~/Library/Application Support/Substo` (the `substo://` link key, settings, keymap and models) is named after the `substo` command and stays. macOS privacy permissions follow the bundle ID and signing requirement, so they survive the new install path.

## First Substo edit

Create a new folder for a YouTube long-form recording or a portrait Short. Keep camera, screen, voice, B-roll, and music files in it or its subfolders. Then use:

```bash
cd "$HOME/Movies/Substo/Projects/<video-name>"
"/Users/martingreen/Projects/Estio/video-editor/.local/bin/substo" new "<video-name>.substo"
"/Users/martingreen/Projects/Estio/video-editor/.local/bin/substo" media
"/Users/martingreen/Projects/Estio/video-editor/.local/bin/substo" app "<video-name>.substo"
```

For a Short created directly from portrait footage, use `new "<video-name>.substo" --portrait`. The defaults for a landscape project come from the original author's workflow, so check frame size, frame rate, media roles, track placement, audio levels, and camera sync before editing or exporting. In particular, do not use `--mike` on `tighten` or the built-in `decision-models` EDL recipe as Substo presets. The section card design and some short layouts also reflect his Convex videos; make or choose your own style before publishing. Studio's optional asset providers use Keychain and are not needed for local editing.

## Connecting to Estio and Substo

Studio connects this Mac to estio.co, substo.com or both, one Location each, from its menu-bar item (it stays there while Studio runs, with or without windows; Quit Studio in that menu or Cmd-Q quits). It replaces `npm run start:studio-companion`: same pairing, same Keychain item, same Settings → Connected computer page.

- **Connect to Estio… / Connect to Substo…** asks the site for a code, opens its approval page in your browser and shows the code in the menu until an admin approves it (or it expires after 10 minutes; Cancel stops waiting). The key goes to Keychain, then the connection is saved.
- Each connection shows its brand, Location and status: Online, Busy, Paused in Settings, Offline, Asleep, or **Disconnected by the site (revoked)** when the site refuses its key. Click one to make it the active connection: its brand shows on the menu-bar item, as a badge on the Dock icon, in the welcome window and in About. The Finder icon stays Studio's.
- **Disconnect…** stops that connection and removes its key from this Mac. Revoking the computer stays in Settings → Connected computer on the site.
- **Launch at login** adds Studio as a login item; started that way it opens no windows.
- **Use this Mac's existing substo.com pairing…** appears when the Node companion paired this Mac. Studio adopts it only when you choose it: macOS then shows "Studio wants to use your confidential information stored in "com.estio.studio-companion.device-token" in your keychain." Enter your login password and choose Always Allow. A key macOS would ask about is never read at launch; the connection shows **Allow Keychain access…** instead. While Studio is signed ad hoc, a rebuild may make macOS ask again. The companion's `config.json` is left in place.

Studio does what the companion did: heartbeats every 30 seconds with the same report (hardware, runtimes, local models, Codex/Claude sign-in state), applies and acknowledges the setup saved in Settings, takes Mac check jobs when the local gate allows, runs Connect/Disconnect Codex or Claude from Settings with the CLI's own sign-in, stops claiming while the Mac sleeps and sends a draining heartbeat when it quits. Its connections live in `~/Library/Application Support/Studio/Connections/connections.json`; keys are only in Keychain.

`SUBSTO_CONNECT_HEARTBEAT_ONLY=1` (for checking a build) makes every connection heartbeat but never claim a job or run a sign-in command, so queued Mac checks and Connect Codex/Claude requests wait. A normal start runs them, and they may use your Codex or Claude subscription. Launch the app binary with it, for example `SUBSTO_CONNECT_HEARTBEAT_ONLY=1 ~/Applications/Studio.app/Contents/MacOS/substo-app`.

## Web Studio integration (next)

The retired local Substo app linked a content piece to a `.substo` project under its own `data/video-projects/` folder, opened it here, and listed MP4s from the project's `exports/` folder. Hosted Studio does not do this yet. The plan is to run it through Studio's connection: Studio asks the Mac to create or open the project for a content item with its media, and finished exports upload back to Studio. See `documentation/studio-mac-processing-plan.md`.

`skills/editor-v1/` (the Codex documentary-edit kit) and `skills/substo-video/SKILL.md` came over unchanged. Editor V1 still describes the retired local app's folders and will be adapted with the web Studio integration.
