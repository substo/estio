# Substo Video in Substo

This editor lives in the Estio repository at `video-editor/`, beside the Estio/Substo web apps (CRM and Studio). It stays a native macOS app built with SwiftPM; the web build and deploy ignore this folder. Studio manages ideas, evidence, scripts and source recordings. The editor owns editable video projects and exports. Keep source footage and `.substo` projects outside the repository, for example under `~/Movies/Substo/Projects/<video-name>/`; keep reusable assets in the editor's library. The `substo` command and `.substo` project format are used for new edits; the app and command names will be renamed later.

## First run on this Mac

This Mac has macOS 15, ffmpeg, and Xcode 26.3 in `/Applications/Xcode.app`. The selected developer directory is still Command Line Tools, so build with `DEVELOPER_DIR` set to Xcode. SwiftPM's Lottie dependency has already been fetched. Xcode 26.3's Swift optimizer crashes when compiling the timeline view for release; this checkout builds the working debug app by default. The app is signed locally and installed at `~/Applications/Substo Video.app`.

From this checkout:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SUBSTO_CODESIGN_IDENTITY=- bash setup_mac.sh
SUBSTO_SKILL_DIRS="" bash install.sh "$PWD/.local/bin"
"$PWD/.local/bin/substo" app
```

The local launcher path avoids changing your shell setup. To use `substo` from any folder, add this checkout's `.local/bin` to your shell PATH. `setup_mac.sh` installs the app to `~/Applications/Substo Video.app`. The empty `SUBSTO_SKILL_DIRS` skips installation of the editor skill.

## First Substo edit

Create a new folder for a YouTube long-form recording or a portrait Short. Keep camera, screen, voice, B-roll, and music files in it or its subfolders. Then use:

```bash
cd "$HOME/Movies/Substo/Projects/<video-name>"
"/Users/martingreen/Projects/Estio/video-editor/.local/bin/substo" new "<video-name>.substo"
"/Users/martingreen/Projects/Estio/video-editor/.local/bin/substo" media
"/Users/martingreen/Projects/Estio/video-editor/.local/bin/substo" app "<video-name>.substo"
```

For a Short created directly from portrait footage, use `new "<video-name>.substo" --portrait`. The defaults for a landscape project come from the original author's workflow, so check frame size, frame rate, media roles, track placement, audio levels, and camera sync before editing or exporting. In particular, do not use `--mike` on `tighten` or the built-in `decision-models` EDL recipe as Substo presets. The section card design and some short layouts also reflect his Convex videos; make or choose your own style before publishing. Substo Video's optional asset providers use Keychain and are not needed for local editing.

## Studio integration (next)

The retired local Substo app linked a content piece to a `.substo` project under its own `data/video-projects/` folder, opened it here, and listed MP4s from the project's `exports/` folder. Hosted Studio does not do this yet. The plan is to run it through the paired Mac companion: Studio asks the Mac to create or open the project for a content item with its media, and finished exports upload back to Studio. See `documentation/studio-mac-processing-plan.md`.

`skills/editor-v1/` (the Codex documentary-edit kit) and `skills/substo-video/SKILL.md` came over unchanged. Editor V1 still describes the retired local app's folders and will be adapted with the Studio integration.
