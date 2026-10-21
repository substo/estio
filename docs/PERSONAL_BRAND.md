# Substo Video in Personal Brand

This checkout lives beside Personal Brand Studio as a separate Git repository and macOS app. Studio manages ideas, evidence, scripts, and source recordings. Substo Video owns editable video projects and exports. Keep source footage and `.tandem` projects outside either source repository, for example under `~/Movies/Personal Brand/Projects/<video-name>/`; keep reusable assets in the editor's library. This avoids accidentally committing private media and leaves a clear path for Studio to open or reference a project later. The `tandem` command and `.tandem` project format remain as compatibility names for now.

## First run on this Mac

This Mac has macOS 15, ffmpeg, and Xcode 26.3 in `/Applications/Xcode.app`. The selected developer directory is still Command Line Tools, so build with `DEVELOPER_DIR` set to Xcode. SwiftPM's Lottie dependency has already been fetched. Xcode 26.3's Swift optimizer crashes when compiling the timeline view for release; this checkout builds the working debug app by default. The app is signed locally and installed at `~/Applications/Substo Video.app`.

From this checkout:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer TANDEM_CODESIGN_IDENTITY=- bash setup_mac.sh
TANDEM_SKILL_DIRS="" bash install.sh "$PWD/.local/bin"
"$PWD/.local/bin/tandem" app
```

The local launcher path avoids changing your shell setup. To use `tandem` from any folder, add this checkout's `.local/bin` to your shell PATH. `setup_mac.sh` installs the app to `~/Applications/Substo Video.app`. The empty `TANDEM_SKILL_DIRS` keeps the original author-specific skill out of your global agent setup; see the note below before opting into it.

## First Personal Brand edit

Create a new folder for a YouTube long-form recording or a portrait Short. Keep camera, screen, voice, B-roll, and music files in it or its subfolders. Then use:

```bash
cd "$HOME/Movies/Personal Brand/Projects/<video-name>"
"/Users/martingreen/Documents/Personal Brand/tandem/.local/bin/tandem" new "<video-name>.tandem"
"/Users/martingreen/Documents/Personal Brand/tandem/.local/bin/tandem" media
"/Users/martingreen/Documents/Personal Brand/tandem/.local/bin/tandem" app "<video-name>.tandem"
```

For a Short created directly from portrait footage, use `new "<video-name>.tandem" --portrait`. The defaults for a landscape project come from the original author's workflow, so check frame size, frame rate, media roles, track placement, audio levels, and camera sync before editing or exporting. In particular, do not use `--mike` on `tighten` or the built-in `decision-models` EDL recipe as Personal Brand presets. The section card design and some short layouts also reflect his Convex videos; make or choose your own style before publishing. Tandem's optional asset providers use Keychain and are not needed for local editing.

## Later Studio integration

Studio now creates a `.tandem` project for a content piece under its ignored `data/video-projects/` folder and opens it in Substo Video. Returning through **Open video edit** reuses that project. Studio stores only the project reference; Substo Video owns the timeline JSON. Exports written to that project's `exports/` folder appear under **View exports** in Studio. Studio's separate **Import your recording** flow copies and analyzes a source recording; it does not yet place that recording into the edit.

The inherited `skills/tandem/SKILL.md` contains detailed examples from Mike's videos. Treat those as historical examples only. Use the project state, media, and this workspace's content foundation when deciding edits for the Boyan One channel.
