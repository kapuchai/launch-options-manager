# Launch Options Manager

A [Millennium](https://steambrew.app/) plugin that replaces Steam's tiny launch-options text
field with a full, per-game launch options manager. Every change applies to Steam instantly —
no restarts.

## Features

- **Structured editor** — launch options split into environment variables, wrappers and game
  arguments, composed around `%command%` automatically. Each argument has an **on/off toggle**
  (disabled args are remembered by the plugin instead of deleted), drag-to-reorder, notes,
  undo/redo, and warnings for known-bad combinations.
- **Preset catalog** — 70+ curated Linux/Proton options with detailed explanations. Presets that
  can't work on your system or game are flagged (missing program, Proton-only option on a native
  game, wrong GPU vendor).
- **ProtonDB integration** — community-reported launch options per game, ranked by popularity or
  recency, with reporter comments and the game's compatibility tier. One click applies a set;
  undo reverts it.
- **Profiles & bulk apply** — save argument sets, load them onto other games, or apply to whole
  collections at once. Profiles export/import as JSON files.
- **Safety** — full backup/restore via file dialogs, automatic on-disk backups, and
  corruption-safe storage that never clobbers your data.

## Entry points

1. The **🔧 button** on every game's library page (next to ⚙)
2. The **🔧 icon** inside the launch-options field in game *Properties*
3. **"Launch Options"** in the top-left Steam menu — profiles & bulk apply without opening a game

## Installation

Until it's available on the [Millennium plugin store](https://steambrew.app/plugins), download
the [latest release](https://github.com/kapuchai/launch-options-manager/releases) (or clone this
repository) into Millennium's plugins folder:

- **Linux:** `~/.local/share/millennium/plugins/`
- **Windows:** `<Steam folder>\plugins\`

Then enable **Launch Options Manager** in Steam → Millennium → Plugins and restart Steam.
Requires Millennium ≥ 3.2. No build step needed — the plugin ships prebuilt.

Note: the wrapper/environment-variable presets target Linux/Proton; on Windows the useful surface
is game flags, profiles, bulk apply, and ProtonDB data.

## Data

Your data lives outside the plugin folder as plain JSON — `~/.local/share/launch-options-manager/`
on Linux, `%APPDATA%\launch-options-manager\` on Windows — so plugin updates never touch it. Steam only ever sees the composed launch-options
string — uninstalling the plugin leaves your games exactly as configured.

## License

MIT

---

🤖 Built with **Claude Fable 5**
