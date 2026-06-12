# Launch Options Manager

A [Millennium](https://steambrew.app/) plugin for desktop Steam on Linux that replaces the tiny
launch-options text field with a full, per-game launch options manager. Every change applies to
Steam instantly — no restarts.

> 🤖 Built end-to-end by **Claude Fable 5** (Anthropic) in Claude Code.

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

Your data lives in `~/.local/share/launch-options-manager/` as plain JSON, outside the plugin
folder, so plugin updates never touch it. Steam only ever sees the composed launch-options
string — uninstalling the plugin leaves your games exactly as configured.

## License

MIT
