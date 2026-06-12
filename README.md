# Launch Options Manager

A [Millennium](https://steambrew.app/) plugin for desktop Steam on Linux that replaces the tiny
launch-options text field with a real manager:

- **Structured editor** — launch options are split into *environment variables*, *wrappers*
  (before `%command%`) and *game arguments* (after `%command%`). Each entry has its own
  **on/off toggle**: switch `mangohud` or `PROTON_LOG=1` off without deleting it. Disabled
  entries are remembered by the plugin, not written to Steam.
- **Preset catalog** — ~65 curated Linux/Proton options (gamemoderun, gamescope variants,
  MangoHud, `PROTON_*`, DXVK/VKD3D/Mesa/NVIDIA env vars, common game flags) in collapsible
  categories. Already-added presets are marked; presets that can't work on the system or
  game are flagged (missing binary, Proton-only option on a native Linux game, wrong GPU
  vendor).
- **Profiles** — save the current argument set under a name, load it onto any game
  (replace or merge), and **bulk-apply** a profile to many games at once (with all-games /
  installed / per-collection selection). A starter "Default" profile is created on first run.
- **Instant apply** — changes go through `SteamClient.Apps.SetAppLaunchOptions`, so they're
  live immediately; no Steam restart, no fighting `localconfig.vdf`.
- `%command%` is inserted/dropped automatically: env vars and wrappers imply it, plain game
  flags don't need it.
- **Theme-aware** — adapts to the active Millennium theme (reads SpaceTheme-style `--st-*`
  and Millennium `--SystemAccentColor*` CSS variables, falls back to a Steam-like dark look).
- Entry points are configurable in the plugin's Millennium settings panel (game-page ⚡
  button, Properties-dialog link).

Options that use shell constructs the structured editor can't represent
(pipes, `;`, quoting around `%command%`, …) are detected and edited as a single raw block instead.

## Using it

Two entry points, both per game:

1. On a game's library page, click the **⚡** button next to the settings (**⚙**) button.
2. In the vanilla *Properties → General* dialog, click **⚡ Open Launch Options Manager**.

The manager opens in its own window. Edits apply automatically (debounced while typing);
the final string is always visible at the bottom and can be copied.

Per-game state and profiles are stored in `lom-store.json` in the plugin directory —
plain JSON, easy to back up or edit.

> **Non-Steam shortcuts:** Steam historically does not substitute `%command%` for non-Steam
> games. The manager still works for them (it uses `SetShortcutLaunchOptions`), but wrappers
> and env vars may be unreliable there — the manager shows a warning badge for shortcuts.

## Building

```sh
npm install --legacy-peer-deps   # or pnpm install
npm run build                    # millennium-ttc --build prod → .millennium/Dist/index.js
```

## Installing

```sh
ln -s "$(pwd)" ~/.local/share/millennium/plugins/launch-options-manager
```

then enable **Launch Options Manager** in Steam → Millennium settings → Plugins
(or add `"launch-options-manager"` to `plugins.enabledPlugins` in
`~/.config/millennium/config.json` while Steam is closed) and restart Steam.

## Development notes

- Millennium ≥ 3.2 (Lua backend; Python backends are no longer supported).
- Frontend runs in Steam's SharedJSContext; built with `@steambrew/ttc`, React is Steam's own
  (`window.SP_REACT`).
- Debugging: run `steam -dev`, open `http://127.0.0.1:8080` in a Chromium browser and pick the
  *SharedJSContext* target. Millennium logs land in `~/.local/state/millennium/logs` and
  `~/.local/share/Steam/logs/console-linux.txt`.
