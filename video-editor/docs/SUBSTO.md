# Substo Video in Substo

This checkout lives beside Substo as a separate Git repository and macOS app. Substo manages ideas, evidence, scripts, and source recordings. Substo Video owns editable video projects and exports. Keep source footage and `.substo` projects outside either source repository, for example under `~/Movies/Substo/Projects/<video-name>/`; keep reusable assets in the editor's library. This avoids accidentally committing private media and leaves a clear path for Substo to open or reference a project later. The `substo` command and `.substo` project format are used for new edits.

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
"/Users/martingreen/projects/Substo/video-editor/.local/bin/substo" new "<video-name>.substo"
"/Users/martingreen/projects/Substo/video-editor/.local/bin/substo" media
"/Users/martingreen/projects/Substo/video-editor/.local/bin/substo" app "<video-name>.substo"
```

For a Short created directly from portrait footage, use `new "<video-name>.substo" --portrait`. The defaults for a landscape project come from the original author's workflow, so check frame size, frame rate, media roles, track placement, audio levels, and camera sync before editing or exporting. In particular, do not use `--mike` on `tighten` or the built-in `decision-models` EDL recipe as Substo presets. The section card design and some short layouts also reflect his Convex videos; make or choose your own style before publishing. Substo Video's optional asset providers use Keychain and are not needed for local editing.

## Later Substo integration

Substo now creates a `.substo` project for a content piece under its ignored `data/video-projects/` folder and opens it in Substo Video. Returning through **Open video edit** reuses that project. Substo stores only the project reference; Substo Video owns the timeline JSON. Exports written to that project's `exports/` folder appear under **View exports** in Substo. Substo's separate **Import your recording** flow copies and analyzes a source recording; it does not yet place that recording into the edit.

Use `skills/substo-video/SKILL.md` with the current project state, media, and Substo content foundation when deciding edits.
