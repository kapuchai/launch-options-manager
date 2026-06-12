# Launch Options Manager

A [Millennium](https://steambrew.app/) plugin for desktop Steam on Linux that replaces the tiny
launch-options text field with a full, per-game launch options manager — structured editing,
toggleable arguments, a curated preset catalog, ProtonDB community options, profiles, and
bulk apply. Every change applies to Steam instantly; no restarts, no fighting `localconfig.vdf`.

> 🤖 **This plugin was built end-to-end by [Claude Fable 5](https://www.anthropic.com/news/claude-fable-5-mythos-5)**,
> Anthropic's frontier model, working inside Claude Code — research, architecture, implementation,
> multi-agent adversarial code review (8 rounds, 60+ verified findings fixed pre-release), and this
> README. Human direction and testing by [@kapuchai](https://github.com/kapuchai).

## Features

### Structured argument editor
Launch options are parsed into three sections — **environment variables** (`PROTON_LOG=1`),
**wrappers** (`gamemoderun`, `mangohud`, `gamescope …`), and **game arguments** (`-novid`) — and
composed back into `ENV… wrappers… %command% flags…` automatically.

- **Per-argument toggles**: switch an option off without deleting it — disabled rows are stored by
  the plugin, not written to Steam, so nothing is ever lost
- Drag-to-reorder (⠿), per-argument **notes** (✎, never sent to Steam), **undo/redo** (↶/↷)
- **Conflict warnings** for known-bad combinations (MangoHud under gamescope, redundant
  performance wrappers, HDR without Wayland, gamescope missing its `--`, …)
- Duplicate detection, autofocus on new rows, strings too complex for structured editing
  (pipes, escapes, quoted `%command%`) fall back to a safe raw mode

### Preset catalog
70+ curated Linux/Proton options in collapsible categories, each with a detailed explanation —
what it does, how to configure it, and its pitfalls. Presets that can't work on your system or
game are flagged with a reason: missing binary (probed from `PATH`), Proton-only option on a
native Linux game (detected per game), or wrong GPU vendor (driver probe, overridable in settings).

### ProtonDB integration
Live community data from protondb.com, per game: every reported launch-options string, grouped
and ranked by popularity or recency, with reporter comments and Proton versions on unfold —
plus the game's compatibility tier (platinum/gold/…) and a link to its ProtonDB page.
One click applies a community set; undo reverts it, and your previous arguments are stashed in
the Default profile automatically.

### Profiles & bulk apply
Save any argument set as a named profile, load or merge it onto other games, and **bulk-apply**
to your whole library or specific Steam collections at once. The **Default** profile always
exists as your personal baseline. Profiles export/import as JSON files via native file dialogs.

### Quality of life
- Adapts to the active Millennium theme (SpaceTheme-style `--st-*` variables) with a configurable
  accent color
- Full-store **backup and restore** to/from user-chosen files
- Works with non-Steam shortcuts (with a `%command%` reliability warning)
- Atomic writes with automatic on-disk backup of the previous data generation; corrupted-store
  protection refuses writes rather than clobbering your data

## Entry points

1. The **🔧 button** on every game's library page (next to ⚙)
2. The **🔧 icon** inside the launch-options field in game *Properties*
3. **"Launch Options"** in the top-left Steam menu — profiles & bulk apply without opening a game

## Installation

Until it's available on the [Millennium plugin store](https://steambrew.app/plugins):

```sh
git clone https://github.com/kapuchai/launch-options-manager.git
ln -s "$(pwd)/launch-options-manager" ~/.local/share/millennium/plugins/
```

Enable **Launch Options Manager** in Steam → Millennium → Plugins, then restart Steam.

Requires Millennium ≥ 3.2. The prebuilt bundle is checked in (`.millennium/Dist/`); to rebuild:

```sh
npm install --legacy-peer-deps && npm run build
```

## Data

Everything lives in `~/.local/share/launch-options-manager/lom-store.json` (plain JSON; previous
generation kept as `.bak`) — outside the plugin folder, so plugin updates never touch it. Steam only ever sees the composed launch-options string — uninstalling the plugin
leaves your games exactly as configured.

## How it works (for the curious)

- Reads/writes options live through `SteamClient.Apps.SetAppLaunchOptions` (and
  `SetShortcutLaunchOptions` for non-Steam games) with write-back verification
- LuaJIT backend handles storage (atomic tmp+rename with backup rotation), system capability
  probing, and ProtonDB fetches — including the hash-addressed report-shard scheme protondb.com
  uses for its own frontend
- The UI is plain-mouse-event based where it matters: HTML5 drag-and-drop is broken in Steam's
  CEF on Linux (verified empirically), so reordering uses tracked pointer gestures

## License

MIT
