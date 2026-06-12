import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DialogButton } from '@steambrew/client';
import { ArgItem, ArgKind, GpuVendor, composeLaunchOptions, detectConflicts, makeItem, parseLaunchOptions, tokenize } from './model';
import { PRESETS, Preset } from './presets';
import {
    Capabilities,
    getStoreGeneration,
    GameEntry,
    flushStore,
    getAllGames,
    getCapabilities,
    getGameItems,
    getGameName,
    getProfiles,
    getUISettings,
    getUserCollections,
    deleteProfile,
    fetchProtonDBReports,
    importProfilesFromText,
    PDBResult,
    serializeProfiles,
    isShortcut,
    loadStore,
    onSaveFailure,
    persistenceBlocked,
    saveProfile,
    setAndVerifyLaunchOptions,
    setGameItems,
    setLaunchOptions,
    updateUISettings,
} from './store';

// ── theme ───────────────────────────────────────────────────────────────────

interface Palette {
    bg: string;
    panel: string;
    panelHover: string;
    border: string;
    text: string;
    muted: string;
    accent: string;
    green: string;
    red: string;
    yellow: string;
    mono: string;
    input: string;
    header: string;
    accentHover: string;
    accentDim: string;
}

interface PaletteExtra {
    input: string;
    header: string;
    accentHover: string;
}

const FALLBACK: Palette & PaletteExtra = {
    bg: '#1a2027',
    panel: '#28303a',
    panelHover: '#2f3845',
    border: 'rgba(255,255,255,0.09)',
    text: '#dcdedf',
    muted: '#8b929a',
    accent: '#666cff',
    green: '#5ba32b',
    red: '#d94126',
    yellow: '#e8a33d',
    mono: '"DejaVu Sans Mono", Consolas, monospace',
    input: '#161b21',
    header: '#2f3845',
    accentHover: '#878cff',
    accentDim: 'rgb(72, 76, 179)',
};

// the accent every UI element should follow when the theme doesn't provide
// one — exported so the settings panel can show/use the effective value
export const DEFAULT_ACCENT = '#666cff';

// parse '#rrggbb' or 'rgb(r, g, b)' into channels
function parseColor(color: string): [number, number, number] | null {
    const hex = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (hex) return [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16)];
    const rgb = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    return null;
}

function lighten(color: string, amount: number): string {
    const c = parseColor(color);
    if (!c) return color;
    const mix = (v: number) => Math.min(255, Math.round(v * (1 - amount) + 255 * amount));
    return `rgb(${mix(c[0])}, ${mix(c[1])}, ${mix(c[2])})`;
}

// toward black — filled elements (toggles, active pills/tabs) use a dimmed
// accent: a solid block of the raw accent reads much harsher than text
function darken(color: string, amount: number): string {
    const c = parseColor(color);
    if (!c) return color;
    const mix = (v: number) => Math.round(v * (1 - amount));
    return `rgb(${mix(c[0])}, ${mix(c[1])}, ${mix(c[2])})`;
}

// Adapt to the active Millennium theme: SpaceTheme (and themes following its
// convention) define --st-* RGB-triplet variables; Millennium itself injects
// --SystemAccentColor*. Anything missing falls back to a Steam-like dark look.
function readPalette(doc: Document, accentOverride?: string): Palette {
    let palette = FALLBACK;
    try {
        const root = getComputedStyle(doc.documentElement);
        const triplet = (name: string): string | null => {
            const v = root.getPropertyValue(name).trim();
            return /^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/.test(v) ? v : null;
        };
        const rgb = (name: string, fallback: string) => {
            const t = triplet(name);
            return t ? `rgb(${t})` : fallback;
        };
        const themed = triplet('--st-background') !== null || triplet('--st-accent-1') !== null;
        if (themed) {
            const bodyColor = getComputedStyle(doc.body).color;
            // SpaceTheme layering: the near-black --st-background sits behind
            // everything; the lighter grays color-2/5 are the visible
            // surfaces, so the manager builds on those.
            palette = {
                bg: rgb('--st-color-4', FALLBACK.bg),
                panel: rgb('--st-color-5', FALLBACK.panel),
                panelHover: rgb('--st-color-6', FALLBACK.panelHover),
                border: 'rgba(255,255,255,0.09)',
                text: bodyColor && bodyColor !== 'rgba(0, 0, 0, 0)' ? bodyColor : FALLBACK.text,
                muted: FALLBACK.muted,
                accent: rgb('--st-accent-1', rgb('--SystemAccentColor-RGB', FALLBACK.accent)),
                accentHover: rgb('--st-accent-2', rgb('--st-accent-1', FALLBACK.accentHover)),
                green: rgb('--st-green', FALLBACK.green),
                red: rgb('--st-red', FALLBACK.red),
                yellow: rgb('--st-yellow', FALLBACK.yellow),
                mono: FALLBACK.mono,
                input: rgb('--st-color-1', FALLBACK.input),
                header: rgb('--st-color-6', FALLBACK.header),
                accentDim: '',
            };
        }
    } catch { /* fall through to fallback */ }
    if (accentOverride && /^#[0-9a-f]{6}$/i.test(accentOverride)) {
        palette = { ...palette, accent: accentOverride, accentHover: lighten(accentOverride, 0.18), accentDim: '' };
    }
    if (!palette.accentDim) palette = { ...palette, accentDim: darken(palette.accent, 0.3) };
    return palette;
}

function makeStyles(C: Palette): Record<string, React.CSSProperties> {
    return {
        root: {
            display: 'flex', flexDirection: 'column', height: '100%', minHeight: '560px',
            background: C.bg, color: C.text, fontSize: '13px',
        },
        tabBar: { display: 'flex', gap: '6px', padding: '10px 14px', flexShrink: 0 },
        tab: { padding: '6px 16px', cursor: 'pointer', borderRadius: '14px', color: C.muted, userSelect: 'none', border: '1px solid transparent' },
        tabActive: { background: C.accentDim, color: '#fff' },
        body: { flex: 1, overflowY: 'auto', padding: '12px 16px' },
        section: { marginBottom: '16px' },
        sectionTitle: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', color: C.muted, margin: '0 0 6px 2px' },
        row: {
            display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 8px',
            background: C.panel, borderRadius: '8px', marginBottom: '4px', border: `1px solid ${C.border}`,
        },
        rowDisabled: { opacity: 0.55 },
        input: {
            flex: 1, background: C.input, color: C.text, border: `1px solid ${C.border}`,
            borderRadius: '6px', padding: '5px 8px', fontFamily: C.mono, fontSize: '12px', outline: 'none', minWidth: 0,
        },
        iconBtn: {
            background: 'transparent', color: C.muted, border: 'none', cursor: 'pointer',
            padding: '2px 5px', fontSize: '13px', lineHeight: 1, borderRadius: '6px',
        },
        addBtn: {
            background: 'transparent', color: C.accent, border: `1px dashed ${C.border}`, cursor: 'pointer',
            padding: '6px 10px', borderRadius: '8px', fontSize: '12px', width: '100%', textAlign: 'left',
        },
        preview: {
            flexShrink: 0, borderTop: `2px solid ${C.accentDim}`, padding: '10px 16px 12px 16px',
            display: 'flex', flexDirection: 'column', gap: '5px', background: C.panel,
        },
        previewText: {
            fontFamily: C.mono, fontSize: '13px', color: C.text, wordBreak: 'break-all',
            whiteSpace: 'pre-wrap', minHeight: '18px', userSelect: 'text',
        },
        toggle: { cursor: 'pointer', width: '30px', height: '16px', borderRadius: '8px', position: 'relative', flexShrink: 0, transition: 'background 0.15s' },
        knob: { position: 'absolute', top: '2px', width: '12px', height: '12px', borderRadius: '50%', background: '#fff', transition: 'left 0.15s' },
        smallBtn: {
            background: C.panel, color: C.text, border: `1px solid ${C.border}`, cursor: 'pointer',
            padding: '4px 12px', borderRadius: '8px', fontSize: '12px',
        },
        badge: {
            fontSize: '10px', padding: '2px 8px', borderRadius: '8px', whiteSpace: 'nowrap',
            background: C.header, border: '1px solid rgba(255,255,255,0.16)', color: C.text,
        },
        catHeader: {
            display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none',
            padding: '8px 12px', background: C.header, borderLeft: `3px solid ${C.accent}`,
            borderRadius: '8px', marginBottom: '4px', fontWeight: 600,
        },
        presetRow: {
            display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px',
            background: C.panel, borderRadius: '8px', marginBottom: '3px', marginLeft: '12px',
            border: `1px solid ${C.border}`, cursor: 'pointer',
        },
        pill: {
            background: C.panel, color: C.text, border: `1px solid ${C.border}`, cursor: 'pointer',
            padding: '4px 12px', borderRadius: '14px', fontSize: '12px',
        },
        pillActive: {
            background: C.accentDim, color: '#fff', border: `1px solid ${C.accentDim}`,
        },
    };
}

// :hover and friends can't be expressed inline; a small stylesheet derived
// from the palette is injected into the pop-out document. Also styles native
// <select>/<option>, whose dropdown list ignores inline colors.
function paletteCss(C: Palette): string {
    return `
.lom-root button { transition: filter .12s ease, background .12s ease, color .12s ease, opacity .12s ease; }
.lom-root button:hover { filter: brightness(1.3); }
.lom-root .lom-preset-row { transition: background .12s ease, opacity .12s ease; }
.lom-root .lom-preset-row:hover { background: ${C.panelHover} !important; }
.lom-root .lom-cat-header { transition: filter .12s ease; }
.lom-root .lom-cat-header:hover { filter: brightness(1.15); }
.lom-root .lom-fade { animation: lomFade .16s ease; }
@keyframes lomFade { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
.lom-root select { background: ${C.input}; color: ${C.text}; border: 1px solid ${C.border}; }
.lom-root select option { background-color: ${C.panel}; color: ${C.text}; }
.lom-root input::placeholder, .lom-root textarea::placeholder { color: ${C.muted}; }
.lom-root .lom-drag-over { box-shadow: inset 0 2px 0 ${C.accent}; }
.lom-root .lom-drag-over-after { box-shadow: inset 0 -2px 0 ${C.accent}; }
.lom-root .lom-dragging { opacity: 0.4; }
.lom-root ::-webkit-scrollbar { width: 8px; }
.lom-root ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 4px; }
`;
}

function injectStylesheet(doc: Document, C: Palette): void {
    try {
        let style = doc.getElementById('lom-style') as HTMLStyleElement | null;
        if (!style) {
            style = doc.createElement('style');
            style.id = 'lom-style';
            doc.head.appendChild(style);
        }
        style.textContent = paletteCss(C);
    } catch (e) {
        console.error('[launch-options-manager] stylesheet injection failed', e);
    }
}

// Save text via the browser download path (CEF shows the save dialog / drops
// it in the downloads folder) — gives the user a real file destination.
export function downloadText(doc: Document, filename: string, text: string): void {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    doc.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Open the OS file picker and resolve with the chosen file's text
// (null = cancelled).
export function pickTextFile(doc: Document): Promise<string | null> {
    return new Promise((resolve) => {
        const input = doc.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.style.display = 'none';
        doc.body.appendChild(input);
        const win = doc.defaultView;
        let settled = false;
        const settle = async (file: File | undefined) => {
            if (settled) return;
            settled = true;
            input.remove();
            win?.removeEventListener('focus', onFocus, true);
            if (!file) {
                resolve(null);
                return;
            }
            try {
                resolve(await file.text());
            } catch (e) {
                console.error('[launch-options-manager] reading picked file failed', e);
                resolve(null);
            }
        };
        // A cancelled dialog never fires 'change'. Chromium 113+ fires
        // 'cancel'; the focus fallback covers anything older — the delay lets
        // a real 'change' win the race after the dialog closes.
        const onFocus = () => setTimeout(() => settle(input.files?.[0]), 400);
        input.addEventListener('change', () => settle(input.files?.[0]));
        input.addEventListener('cancel', () => settle(undefined));
        win?.addEventListener('focus', onFocus, true);
        input.click();
    });
}

const ThemeCtx = createContext<{ C: Palette; S: Record<string, React.CSSProperties> }>({ C: FALLBACK, S: makeStyles(FALLBACK) });
const useTheme = () => useContext(ThemeCtx);

// ── small components ────────────────────────────────────────────────────────

function MiniToggle(props: { value: boolean; onChange: (v: boolean) => void }) {
    const { C, S } = useTheme();
    return (
        <div
            style={{ ...S.toggle, background: props.value ? C.accentDim : 'rgba(128,128,128,0.35)' }}
            onClick={() => props.onChange(!props.value)}
            title={props.value ? 'Enabled — click to disable (kept, not deleted)' : 'Disabled — click to enable'}
        >
            <div style={{ ...S.knob, left: props.value ? '16px' : '2px' }} />
        </div>
    );
}

interface RowProps {
    item: ArgItem;
    dragging: boolean;
    dropBefore: boolean;
    dropAfter: boolean;
    autoFocusText: boolean;
    duplicate: boolean;
    onChange: (patch: Partial<ArgItem>, immediate?: boolean) => void;
    onDelete: () => void;
    onGripDown: (e: React.MouseEvent) => void;
    registerEl: (el: HTMLElement | null) => void;
}

function ItemRow(props: RowProps) {
    const { item, dragging, dropBefore, dropAfter, autoFocusText, duplicate } = props;
    const { C, S } = useTheme();
    const [noteOpen, setNoteOpen] = useState(false);
    const showNote = noteOpen || Boolean(item.note);

    return (
        <div
            ref={props.registerEl}
            className={`${dragging ? 'lom-dragging' : ''} ${dropBefore ? 'lom-drag-over' : ''} ${dropAfter ? 'lom-drag-over-after' : ''}`}
            style={{ ...S.row, flexDirection: 'column', alignItems: 'stretch', gap: '4px', ...(item.enabled ? {} : S.rowDisabled) }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {/* Reordering uses plain mouse events: HTML5 drag-and-drop is
                    unreliable in Steam's CEF on Linux (dragstart fires but the
                    drag sequence dies — observed live). */}
                <span
                    style={{ color: C.muted, cursor: 'grab', fontSize: '14px', lineHeight: 1, userSelect: 'none', padding: '2px 2px' }}
                    title="Drag to reorder"
                    onMouseDown={props.onGripDown}
                >⠿</span>
                <MiniToggle value={item.enabled} onChange={(enabled) => props.onChange({ enabled }, true)} />
                <input
                    style={S.input}
                    value={item.text}
                    spellCheck={false}
                    autoFocus={autoFocusText}
                    onChange={(e) => props.onChange({ text: (e.target as HTMLInputElement).value })}
                />
                {duplicate && <span style={{ ...S.badge, color: C.yellow, borderColor: C.yellow, flexShrink: 0 }} title="Another enabled row sets the same option">duplicate</span>}
                <button style={{ ...S.iconBtn, ...(showNote ? { color: C.accent } : {}) }} title={item.note ? 'Edit note' : 'Add a note'}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setNoteOpen(!noteOpen)}>✎</button>
                <button style={{ ...S.iconBtn, color: C.red }} title="Remove" onClick={props.onDelete}>✕</button>
            </div>
            {showNote && (
                noteOpen
                    ? <input
                        style={{ ...S.input, fontFamily: 'inherit', fontSize: '11px', marginLeft: '60px' }}
                        placeholder="Note to self (not sent to Steam)…"
                        value={item.note ?? ''}
                        autoFocus
                        onChange={(e) => props.onChange({ note: (e.target as HTMLInputElement).value })}
                        onBlur={() => setNoteOpen(false)}
                        onKeyDown={(e) => { if ((e as any).key === 'Enter') setNoteOpen(false); }}
                    />
                    : <div style={{ color: C.muted, fontSize: '11px', marginLeft: '60px', cursor: 'text' }}
                        onClick={() => setNoteOpen(true)}>{item.note}</div>
            )}
        </div>
    );
}

const KIND_SECTIONS: { kind: ArgKind; title: string; hint: string; placeholder: string }[] = [
    { kind: 'env', title: 'Environment variables', hint: 'VAR=value, set before the game starts', placeholder: 'PROTON_LOG=1' },
    { kind: 'wrapper', title: 'Wrappers (run before %command%)', hint: 'commands that wrap the game process', placeholder: 'gamemoderun' },
    { kind: 'flag', title: 'Game arguments (after %command%)', hint: 'passed to the game itself', placeholder: '-novid' },
];

// Exact match (normalized tokens; env vars by name) → the preset itself is
// present. First-token match → a *variant* is present (e.g. another gamescope
// flag set), shown as a hint without blocking the Add button.
function presetExactKey(kind: ArgKind, text: string): string {
    if (kind === 'env') return `env:${text.split('=')[0]}`;
    return `${kind}:${tokenize(text).join(' ')}`;
}

function presetSignature(kind: ArgKind, text: string): string {
    if (kind === 'env') return `env:${text.split('=')[0]}`;
    return `${kind}:${tokenize(text)[0] ?? text}`;
}

// ── main window ─────────────────────────────────────────────────────────────

type Tab = 'args' | 'presets' | 'profiles' | 'bulk' | 'protondb';

export function ManagerWindow({ appid }: { appid: number }) {
    // appid 0 = standalone mode (opened from the Steam menu): no game
    // context, only profile management and bulk apply.
    const standalone = appid === 0;
    const [items, setItems] = useState<ArgItem[] | null>(null);
    const [tab, setTab] = useState<Tab>(standalone ? 'profiles' : 'args');
    const [focusId, setFocusId] = useState<string | null>(null);
    const [status, setStatus] = useState<string>('');
    // semantic key, resolved against the live palette at render time — a
    // closure-captured color string would freeze the pre-theme fallback
    const [statusColor, setStatusColor] = useState<keyof Palette>('muted');
    const [caps, setCaps] = useState<Capabilities | null>(null);
    const [proton, setProton] = useState<boolean | null>(null);
    const [theme, setTheme] = useState<{ C: Palette; S: Record<string, React.CSSProperties> }>(
        () => ({ C: FALLBACK, S: makeStyles(FALLBACK) }));
    const rootRef = useRef<HTMLDivElement | null>(null);
    const applyTimer = useRef<any>(null);
    const statusTimer = useRef<any>(null);
    // Items waiting in the debounce window; flushed (not discarded) on unmount
    // so closing the window right after typing doesn't lose the edit.
    const pendingItems = useRef<ArgItem[] | null>(null);
    // Monotonic apply counter — a superseded verification must not flash its
    // (stale) result over a newer apply's.
    const runSeq = useRef(0);
    // Last string actually written to Steam: compose-neutral edits (notes,
    // empty rows) are persisted to the plugin store without a Steam write or
    // an 'Applying…' flash.
    const lastPushed = useRef<string | null>(null);
    // Store generation at load time — if a backup restore replaced the store
    // while this window is open, its state is stale and must not be persisted.
    const storeGen = useRef(getStoreGeneration());
    // Undo/redo over the item list. Typing is coalesced (one entry per pause)
    // so a keystroke doesn't become an undo step.
    const undoStack = useRef<ArgItem[][]>([]);
    const redoStack = useRef<ArgItem[][]>([]);
    const lastHistoryPush = useRef(0);
    const gameName = useMemo(() => (standalone ? 'Profiles & bulk apply' : getGameName(appid)), [appid]);
    const { C, S } = theme;

    const flash = (msg: string, color: keyof Palette = 'muted', autoClear = false) => {
        setStatus(msg);
        setStatusColor(color);
        if (statusTimer.current) clearTimeout(statusTimer.current);
        if (autoClear) {
            statusTimer.current = setTimeout(() => setStatus(''), 2500);
        }
    };

    useEffect(() => {
        // theme probe: own popout document first, falling back to defaults;
        // re-applied with the user's accent override once the store loads
        const doc = rootRef.current?.ownerDocument;
        if (!doc) return;
        const apply = (accent?: string) => {
            const palette = readPalette(doc, accent);
            setTheme({ C: palette, S: makeStyles(palette) });
            injectStylesheet(doc, palette);
        };
        apply();
        loadStore().then(() => {
            const accent = getUISettings().accentColor;
            if (accent) apply(accent);
        });
    }, []);

    useEffect(() => {
        if (!standalone) getCapabilities().then(setCaps);
        onSaveFailure((reason) => {
            flash(reason === 'loadFailed'
                ? 'Changes are NOT saved — the plugin store file could not be read'
                : 'Failed to save plugin data to disk', 'red');
        });
        if (standalone) {
            loadStore().then(() => {
                setItems([]);
                lastPushed.current = '';
                if (persistenceBlocked()) {
                    flash('Changes are NOT saved — the plugin store file could not be read', 'red');
                }
            });
            return () => {
                onSaveFailure(null);
                if (statusTimer.current) clearTimeout(statusTimer.current);
                flushStore();
            };
        }
        getGameItems(appid).then(({ items: loadedItems, liveUnknown, proton: protonFlag }) => {
            setItems(loadedItems);
            setProton(protonFlag);
            lastPushed.current = composeLaunchOptions(loadedItems);
            if (persistenceBlocked()) {
                flash('Changes are NOT saved — the plugin store file could not be read', 'red');
            } else if (liveUnknown) {
                flash('Steam did not report current options — showing saved state', 'yellow');
            }
        }).catch((e) => {
            console.error('[launch-options-manager] load failed', e);
            setItems([]);
            flash('Failed to read launch options', 'red');
        });
        return () => {
            onSaveFailure(null);
            if (applyTimer.current) clearTimeout(applyTimer.current);
            applyTimer.current = null;
            if (statusTimer.current) clearTimeout(statusTimer.current);
            if (pendingItems.current && getStoreGeneration() === storeGen.current) {
                const next = pendingItems.current;
                pendingItems.current = null;
                const composed = composeLaunchOptions(next);
                setGameItems(appid, next, composed);
                if (composed !== lastPushed.current) setLaunchOptions(appid, composed);
            }
            flushStore();
        };
    }, [appid]);

    // Persist + push to Steam, debounced so typing doesn't write partial args.
    const update = (next: ArgItem[], immediate = false, fromHistory = false) => {
        if (!fromHistory && items) {
            const now = Date.now();
            // any divergent edit invalidates redo, snapshotted or not
            redoStack.current = [];
            // structural ops always snapshot; typing coalesces within 800ms
            if (immediate || now - lastHistoryPush.current > 800) {
                undoStack.current.push(items);
                if (undoStack.current.length > 50) undoStack.current.shift();
            }
            lastHistoryPush.current = now;
        }
        setItems(next);
        pendingItems.current = next;
        if (applyTimer.current) clearTimeout(applyTimer.current);
        const run = async () => {
            applyTimer.current = null;
            pendingItems.current = null;
            if (getStoreGeneration() !== storeGen.current) {
                flash('The plugin store was restored — close and reopen this window to keep editing', 'yellow');
                return;
            }
            const seq = ++runSeq.current;
            const composed = composeLaunchOptions(next);
            setGameItems(appid, next, composed);
            if (composed === lastPushed.current) {
                flash('Saved', 'muted', true);
                return;
            }
            lastPushed.current = composed;
            flash('Applying…', 'muted');
            try {
                const verified = await setAndVerifyLaunchOptions(appid, composed);
                if (seq !== runSeq.current) return; // superseded by a newer apply
                if (verified) flash('✓ Applied', 'green', true);
                else flash('Sent, but Steam did not confirm the change', 'yellow');
            } catch (e) {
                console.error('[launch-options-manager] apply failed', e);
                if (seq === runSeq.current) flash('Could not apply — SteamClient API unavailable', 'red');
            }
        };
        if (immediate) run();
        else applyTimer.current = setTimeout(run, 600);
    };

    const undo = () => {
        if (!items || !undoStack.current.length) return;
        redoStack.current.push(items);
        lastHistoryPush.current = 0; // next edit must snapshot the restored state
        update(undoStack.current.pop()!, true, true);
    };

    const redo = () => {
        if (!items || !redoStack.current.length) return;
        undoStack.current.push(items);
        lastHistoryPush.current = 0;
        update(redoStack.current.pop()!, true, true);
    };

    // Replace the editor state without re-applying (the caller already wrote
    // to Steam) — used when bulk apply targets the game that is open here.
    const adoptItems = (next: ArgItem[]) => {
        if (applyTimer.current) clearTimeout(applyTimer.current);
        applyTimer.current = null;
        pendingItems.current = null;
        runSeq.current++;
        if (items) {
            undoStack.current.push(items);
            if (undoStack.current.length > 50) undoStack.current.shift();
            redoStack.current = [];
            lastHistoryPush.current = Date.now();
        }
        lastPushed.current = composeLaunchOptions(next);
        setItems(next);
    };

    if (items === null) {
        return (
            <ThemeCtx.Provider value={theme}>
                <div ref={rootRef} style={{ ...S.root, alignItems: 'center', justifyContent: 'center' }}>Loading…</div>
            </ThemeCtx.Provider>
        );
    }

    const composed = composeLaunchOptions(items);
    const hasRaw = items.some((it) => it.kind === 'raw');
    const addedExact = new Set(items.map((it) => presetExactKey(it.kind, it.text)));
    const addedSignatures = new Set(items.map((it) => presetSignature(it.kind, it.text)));

    const changeItem = (id: string, patch: Partial<ArgItem>, immediate = false) =>
        update(items.map((it) => (it.id === id ? { ...it, ...patch } : it)), immediate);

    const deleteItem = (id: string) => update(items.filter((it) => it.id !== id), true);

    // Drag & drop within a section; cross-kind moves are ignored (order
    // across kinds is fixed). `after` = drop below the target row.
    const reorderItem = (dragId: string, targetId: string, after: boolean) => {
        if (dragId === targetId) return;
        const dragged = items.find((it) => it.id === dragId);
        const target = items.find((it) => it.id === targetId);
        if (!dragged || !target || dragged.kind !== target.kind) return;
        const next = items.filter((it) => it.id !== dragId);
        next.splice(next.indexOf(target) + (after ? 1 : 0), 0, dragged);
        if (next.every((it, i) => it === items[i])) return;
        update(next, true);
    };

    const addItem = (kind: ArgKind, text = '') => {
        const it = makeItem(kind, text);
        it.text = text; // keep untrimmed while the user is still typing
        setFocusId(it.id);
        // a row addition is structural — force a snapshot even though an
        // empty row uses the debounced (non-immediate) apply path
        lastHistoryPush.current = 0;
        update([...items, it], text !== '');
    };

    // %command% highlighted so the structure of the final string stands out
    const previewParts = (composed || '').split('%command%');

    const tabs: { id: Tab; label: string }[] = standalone
        ? [
            { id: 'profiles', label: 'Profiles' },
            { id: 'bulk', label: 'Bulk apply' },
        ]
        : [
            { id: 'args' as Tab, label: 'Arguments' },
            { id: 'presets' as Tab, label: 'Presets' },
            ...(isShortcut(appid) ? [] : [{ id: 'protondb' as Tab, label: 'ProtonDB' }]),
            { id: 'profiles' as Tab, label: 'Profiles' },
            { id: 'bulk' as Tab, label: 'Bulk apply' },
        ];

    return (
        <ThemeCtx.Provider value={theme}>
            <div ref={rootRef} style={S.root} className="lom-root">
                <div style={{ padding: '12px 16px 6px 16px', display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                    <div style={{ fontSize: '17px', fontWeight: 600 }}>{gameName}</div>
                    {isShortcut(appid) && (
                        <div style={{ color: C.yellow, fontSize: '11px' }} title="Steam may not substitute %command% for non-Steam games — wrappers and env vars can be unreliable here.">
                            non-Steam shortcut
                        </div>
                    )}
                    {proton !== null && !isShortcut(appid) && (
                        <div style={{ ...S.badge }} title={proton
                            ? 'Runs through a compatibility tool — Proton/Wine options apply.'
                            : 'Runs natively on Linux — PROTON_*/WINE* options have no effect.'}>
                            {proton ? 'Proton' : 'native Linux'}
                        </div>
                    )}
                    <span style={{ color: C[statusColor] as string, fontSize: '12px', marginLeft: 'auto' }}>{status}</span>
                    {!standalone && (
                        <span style={{ display: 'flex', gap: '2px' }}>
                            <button
                                style={{ ...S.iconBtn, fontSize: '15px', ...(undoStack.current.length ? {} : { opacity: 0.3, cursor: 'default' }) }}
                                title="Undo (revert the last change, including applied ProtonDB/profile sets)"
                                onClick={undo}>↶</button>
                            <button
                                style={{ ...S.iconBtn, fontSize: '15px', ...(redoStack.current.length ? {} : { opacity: 0.3, cursor: 'default' }) }}
                                title="Redo"
                                onClick={redo}>↷</button>
                        </span>
                    )}
                </div>
                <div style={S.tabBar}>
                    {tabs.map((t) => (
                        <div key={t.id} style={{ ...S.tab, ...(tab === t.id ? S.tabActive : {}) }}
                            onClick={() => { setTab(t.id); setFocusId(null); }}>
                            {t.label}
                        </div>
                    ))}
                </div>
                <div style={S.body} className="lom-fade" key={tab}>
                    {tab === 'args' && (
                        <ArgsTab items={items} hasRaw={hasRaw} focusId={focusId}
                            onChange={changeItem} onDelete={deleteItem} onReorder={reorderItem} onAdd={addItem}
                            onClearAll={() => update([], true)} />
                    )}
                    {tab === 'presets' && (
                        <PresetsTab hasRaw={hasRaw} caps={caps} proton={proton}
                            vendor={getUISettings().gpuVendor}
                            addedExact={addedExact} addedSignatures={addedSignatures}
                            onAdd={(p) => { addItem(p.kind, p.text); flash(`Added: ${p.text}`, 'green', true); }} />
                    )}
                    {tab === 'profiles' && (
                        <ProfilesTab items={items} flash={flash} hasRaw={hasRaw} standalone={standalone}
                            onLoad={(profileItems, replace) => {
                                const copies = profileItems.map((it) => ({ ...makeItem(it.kind, it.text, it.enabled), note: it.note }));
                                update(replace ? copies : [...items, ...copies], true);
                                setTab('args');
                            }} />
                    )}
                    {tab === 'protondb' && (
                        <ProtonDBTab appid={appid} flash={flash}
                            onUse={(lo) => {
                                const parsed = parseLaunchOptions(lo);
                                // keep existing disabled rows — unless the new
                                // string is raw-mode, where they'd be hidden
                                const keepDisabled = parsed.some((it) => it.kind === 'raw')
                                    ? []
                                    : items.filter((it) => !it.enabled && it.kind !== 'raw');
                                update([...parsed, ...keepDisabled], true);
                                setTab('args');
                            }} />
                    )}
                    {tab === 'bulk' && <BulkTab flash={flash} currentAppid={appid} onAppliedToCurrent={adoptItems} />}
                </div>
                {!standalone && <div style={S.preview} className="lom-preview">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '11px', color: C.accent, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>
                            Current launch options
                        </span>
                    </div>
                    <div style={S.previewText}>
                        {composed
                            ? previewParts.map((part, i) => (
                                <React.Fragment key={i}>
                                    {i > 0 && <span style={{ color: C.accent, fontWeight: 600 }}>%command%</span>}
                                    {part}
                                </React.Fragment>
                            ))
                            : <span style={{ color: C.muted }}>(empty — Steam launches the game unmodified)</span>}
                    </div>
                </div>}
            </div>
        </ThemeCtx.Provider>
    );
}

// ── tabs ────────────────────────────────────────────────────────────────────

function ArgsTab(props: {
    items: ArgItem[]; hasRaw: boolean; focusId: string | null;
    onChange: (id: string, patch: Partial<ArgItem>, immediate?: boolean) => void;
    onDelete: (id: string) => void;
    onReorder: (dragId: string, targetId: string, after: boolean) => void;
    onAdd: (kind: ArgKind, text?: string) => void;
    onClearAll: () => void;
}) {
    const { items, hasRaw, focusId, onChange, onDelete, onReorder, onAdd, onClearAll } = props;
    const { C, S } = useTheme();
    const [dragId, setDragId] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
    const [confirmClear, setConfirmClear] = useState(false);
    const rowEls = useRef(new Map<string, HTMLElement>());
    const dropRef = useRef<{ id: string; after: boolean } | null>(null);

    // Plain-mouse drag: grip mousedown arms it; past a 5px threshold the row
    // follows the cursor among its same-kind siblings; mouseup commits.
    const startDrag = (item: ArgItem) => (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const doc = (e.currentTarget as HTMLElement).ownerDocument;
        const startX = (e as any).clientX;
        const startY = (e as any).clientY;
        let active = false;
        const siblings = items.filter((x) => x.kind === item.kind);

        const cancel = () => {
            doc.removeEventListener('mousemove', onMove, true);
            doc.removeEventListener('mouseup', onUp, true);
            dropRef.current = null;
            setDragId(null);
            setDropTarget(null);
        };
        const onMove = (ev: MouseEvent) => {
            // the mouseup was lost (focus stolen mid-drag): abort, otherwise
            // the next innocent click would commit a phantom reorder
            if ((ev.buttons & 1) === 0) {
                cancel();
                return;
            }
            if (!active) {
                if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 5) return;
                active = true;
                setDragId(item.id);
            }
            let best: { id: string; after: boolean } | null = null;
            let firstRect: DOMRect | null = null;
            let lastSib: { id: string; rect: DOMRect } | null = null;
            for (const sib of siblings) {
                const el = rowEls.current.get(sib.id);
                if (!el) continue;
                const rect = el.getBoundingClientRect();
                if (!firstRect) firstRect = rect;
                lastSib = { id: sib.id, rect };
                if (ev.clientY >= rect.top && ev.clientY <= rect.bottom) {
                    best = { id: sib.id, after: ev.clientY > rect.top + rect.height / 2 };
                }
            }
            // above the first row / below the last row of the section
            if (!best && firstRect && ev.clientY < firstRect.top) best = { id: siblings[0].id, after: false };
            if (!best && lastSib && ev.clientY > lastSib.rect.bottom) best = { id: lastSib.id, after: true };
            if (best) {
                dropRef.current = best;
                setDropTarget(best);
            }
        };
        const onUp = (ev: MouseEvent) => {
            if (ev.button !== 0) return; // only the left button ends the drag
            const drop = dropRef.current;
            const commit = active && drop && drop.id !== item.id;
            cancel();
            if (commit) onReorder(item.id, drop!.id, drop!.after);
        };
        doc.addEventListener('mousemove', onMove, true);
        doc.addEventListener('mouseup', onUp, true);
    };

    // Same option set twice among ENABLED rows (env vars by name,
    // wrappers/flags by first token) — flagged with a badge.
    const sigCounts = new Map<string, number>();
    for (const it of items) {
        if (!it.enabled || !it.text.trim() || it.kind === 'raw') continue;
        const sig = presetSignature(it.kind, it.text);
        sigCounts.set(sig, (sigCounts.get(sig) ?? 0) + 1);
    }
    const isDuplicate = (it: ArgItem) =>
        it.enabled && Boolean(it.text.trim()) && it.kind !== 'raw' && (sigCounts.get(presetSignature(it.kind, it.text)) ?? 0) > 1;

    if (hasRaw) {
        const raw = items.find((it) => it.kind === 'raw')!;
        return (
            <div>
                <div style={{ ...S.section, color: C.muted, lineHeight: 1.5 }}>
                    These launch options use shell constructs (pipes, escapes, quoting around %command%, …) that
                    can't be split into separate toggles, so they're edited as one block. Presets and profile
                    merging are unavailable in this mode.
                </div>
                <div style={{ ...S.row, alignItems: 'stretch' }}>
                    <MiniToggle value={raw.enabled} onChange={(v) => onChange(raw.id, { enabled: v }, true)} />
                    <textarea
                        style={{ ...S.input, minHeight: '90px', resize: 'vertical' }}
                        value={raw.text}
                        spellCheck={false}
                        onChange={(e) => onChange(raw.id, { text: (e.target as HTMLTextAreaElement).value })}
                    />
                </div>
                <button
                    style={{ ...S.smallBtn, marginTop: '8px', color: C.red }}
                    title="Removes the raw block (clears the game's launch options) and enables the structured editor"
                    onClick={() => onDelete(raw.id)}
                >Discard and switch to structured editing</button>
            </div>
        );
    }

    const conflicts = detectConflicts(items);

    return (
        <div>
            {conflicts.length > 0 && (
                <div style={{ ...S.section, border: `1px solid ${C.yellow}`, borderRadius: '8px', padding: '8px 12px' }}>
                    {conflicts.map((w) => (
                        <div key={w} style={{ color: C.yellow, fontSize: '12px', lineHeight: 1.6 }}>⚠ {w}</div>
                    ))}
                </div>
            )}
            {KIND_SECTIONS.map((sec) => {
                const sectionItems = items.filter((it) => it.kind === sec.kind);
                return (
                    <div key={sec.kind} style={S.section}>
                        <div style={S.sectionTitle}>{sec.title} <span style={{ opacity: 0.6 }}>— {sec.hint}</span></div>
                        {sectionItems.map((it) => (
                            <ItemRow key={it.id} item={it}
                                dragging={dragId === it.id}
                                dropBefore={dropTarget?.id === it.id && !dropTarget.after && dragId !== null && dragId !== it.id}
                                dropAfter={dropTarget?.id === it.id && Boolean(dropTarget?.after) && dragId !== null && dragId !== it.id}
                                autoFocusText={focusId === it.id}
                                duplicate={isDuplicate(it)}
                                onChange={(patch, immediate) => onChange(it.id, patch, immediate)}
                                onDelete={() => onDelete(it.id)}
                                onGripDown={startDrag(it)}
                                registerEl={(el) => {
                                    if (el) rowEls.current.set(it.id, el);
                                    else rowEls.current.delete(it.id);
                                }} />
                        ))}
                        <button style={S.addBtn} onClick={() => onAdd(sec.kind)}>+ add</button>
                    </div>
                );
            })}
            {items.length > 0 && (
                <button
                    style={{ ...S.smallBtn, color: C.red, marginTop: '4px' }}
                    onClick={() => {
                        if (!confirmClear) {
                            setConfirmClear(true);
                            setTimeout(() => setConfirmClear(false), 2500);
                            return;
                        }
                        setConfirmClear(false);
                        onClearAll();
                    }}
                >{confirmClear ? 'Click again to remove everything' : 'Clear all arguments'}</button>
            )}
        </div>
    );
}

// Why a preset may not work here; null = no objection. The user's GPU choice
// in plugin settings overrides the driver probe.
function presetIssue(p: Preset, caps: Capabilities | null, proton: boolean | null, vendor: GpuVendor): string | null {
    if (p.bin && caps && caps.bins[p.bin] === false) return `${p.bin} is not installed`;
    if (p.proton && proton === false) return 'Proton games only — this game runs natively';
    if (vendor === 'off') return null; // user disabled vendor-based hints
    const nvidia = vendor === 'nvidia' ? true : vendor === 'amd' ? false : caps ? caps.nvidia : null;
    const amd = vendor === 'amd' ? true : vendor === 'nvidia' ? false : caps ? caps.amd : null;
    const intel = vendor === 'auto' ? (caps ? caps.intel : null) : false;
    if (p.gpu === 'nvidia' && nvidia === false) return 'NVIDIA-only option';
    if (p.gpu === 'amd' && amd === false && nvidia) return 'AMD-only option';
    // Mesa drives AMD and Intel GPUs; only flag when neither is present
    if (p.gpu === 'mesa' && nvidia && amd === false && !intel) return 'Mesa option — no Mesa GPU detected';
    return null;
}

function PresetsTab(props: {
    onAdd: (p: Preset) => void;
    hasRaw: boolean;
    caps: Capabilities | null;
    proton: boolean | null;
    vendor: GpuVendor;
    addedExact: Set<string>;
    addedSignatures: Set<string>;
}) {
    const { onAdd, hasRaw, caps, proton, vendor, addedExact, addedSignatures } = props;
    const { C, S } = useTheme();
    const [filter, setFilter] = useState('');
    const [openCats, setOpenCats] = useState<string[]>(() => getUISettings().openCategories);
    const [expandedPreset, setExpandedPreset] = useState<string | null>(null);

    if (hasRaw) {
        return (
            <div style={{ color: C.muted, lineHeight: 1.6 }}>
                This game's launch options are in raw mode (shell constructs that can't be split into toggles), so
                presets can't be added — they would be ignored by the raw string. Switch to structured editing on
                the Arguments tab first.
            </div>
        );
    }

    const lower = filter.toLowerCase();
    const filtering = lower.length > 0;
    const visible = PRESETS.filter(
        (p) => !filtering || p.text.toLowerCase().includes(lower) || p.description.toLowerCase().includes(lower),
    );
    const categories = [...new Set(visible.map((p) => p.category))];

    const toggleCat = (cat: string) => {
        const next = openCats.includes(cat) ? openCats.filter((c) => c !== cat) : [...openCats, cat];
        setOpenCats(next);
        updateUISettings({ openCategories: next });
    };

    return (
        <div>
            <input
                style={{ ...S.input, width: '100%', boxSizing: 'border-box', marginBottom: '12px' }}
                placeholder="Filter presets…"
                value={filter}
                spellCheck={false}
                onChange={(e) => setFilter((e.target as HTMLInputElement).value)}
            />
            {categories.map((cat) => {
                const catPresets = visible.filter((p) => p.category === cat);
                const open = filtering || openCats.includes(cat);
                return (
                    <div key={cat} style={{ marginBottom: '10px' }}>
                        <div className="lom-cat-header" style={S.catHeader} onClick={() => !filtering && toggleCat(cat)}>
                            <span style={{ fontSize: '11px', color: C.accent }}>{open ? '▾' : '▸'}</span>
                            <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '12px' }}>{cat}</span>
                            <span style={{ color: C.muted, fontSize: '11px', marginLeft: 'auto', fontWeight: 400 }}>{catPresets.length} presets</span>
                        </div>
                        {open && catPresets.map((p) => {
                            const exact = addedExact.has(presetExactKey(p.kind, p.text));
                            const similar = !exact && addedSignatures.has(presetSignature(p.kind, p.text));
                            const issue = presetIssue(p, caps, proton, vendor);
                            const expanded = expandedPreset === p.text;
                            return (
                                <div key={p.text} className="lom-preset-row" style={{ ...S.presetRow, flexDirection: 'column', alignItems: 'stretch', gap: '4px', ...(issue ? { opacity: 0.65 } : {}) }}
                                    onClick={() => setExpandedPreset(expanded ? null : p.text)}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ fontSize: '9px', color: C.muted, flexShrink: 0 }}>{expanded ? '▾' : '▸'}</span>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontFamily: C.mono, fontSize: '12px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                {p.text}
                                                {issue && <span style={{ ...S.badge, color: C.yellow, borderColor: C.yellow }}>{issue}</span>}
                                                {similar && <span style={S.badge}>similar item present</span>}
                                            </div>
                                            {!expanded && <div style={{ color: C.muted, fontSize: '11px', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description}</div>}
                                        </div>
                                        {exact
                                            ? <span style={{ ...S.badge, color: C.green, borderColor: C.green, flexShrink: 0 }}>✓ added</span>
                                            : <button style={{ ...S.smallBtn, flexShrink: 0 }}
                                                onClick={(e) => { e.stopPropagation(); onAdd(p); }}>{similar ? '+ Add variant' : '+ Add'}</button>}
                                    </div>
                                    {expanded && (
                                        <div style={{ marginLeft: '17px', paddingBottom: '2px' }} onClick={(e) => e.stopPropagation()}>
                                            <div style={{ fontSize: '12px', lineHeight: 1.55 }}>{p.description}</div>
                                            {p.details && <div style={{ color: C.muted, fontSize: '12px', lineHeight: 1.55, marginTop: '4px' }}>{p.details}</div>}
                                            <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                                                <span style={S.badge}>{p.kind === 'env' ? 'environment variable' : p.kind === 'wrapper' ? 'wrapper command' : 'game argument'}</span>
                                                {p.bin && <span style={S.badge}>needs: {p.bin}</span>}
                                                {p.proton && <span style={S.badge}>Proton games</span>}
                                                {p.gpu && <span style={S.badge}>{p.gpu === 'mesa' ? 'Mesa GPUs' : `${p.gpu.toUpperCase()} GPUs`}</span>}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );
}

function ProfilesTab(props: {
    items: ArgItem[];
    hasRaw: boolean;
    standalone: boolean;
    flash: (msg: string, color?: keyof Palette, autoClear?: boolean) => void;
    onLoad: (items: ArgItem[], replace: boolean) => void;
}) {
    const { items, hasRaw, standalone, flash, onLoad } = props;
    const { C, S } = useTheme();
    const [name, setName] = useState('');
    const [, bump] = useState(0);
    const profiles = getProfiles();

    return (
        <div>
            <div style={{ ...S.section, color: C.muted, lineHeight: 1.6 }}>
                {standalone
                    ? <>A profile is a named, reusable set of launch arguments, saved from a game's launch
                        options manager. Use <b>Bulk apply</b> to write one to many games at once.
                        Profiles are copies — editing a game later doesn't change the profile.</>
                    : <>A profile is a named, reusable set of arguments. Build the set you like on the
                        <b> Arguments</b> tab, save it here, then <b>Load</b> it onto any other game (replacing its
                        arguments) or <b>+ Merge</b> it on top of them. <b>Bulk apply</b> writes a profile to many
                        games at once. Profiles are copies — editing a game later doesn't change the profile.</>}
            </div>
            {!standalone && <div style={S.section}>
                <div style={S.sectionTitle}>Save current arguments as a profile</div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                        style={{ ...S.input }}
                        placeholder="Profile name…"
                        value={name}
                        onChange={(e) => setName((e.target as HTMLInputElement).value)}
                    />
                    <DialogButton
                        style={{ width: 'auto', padding: '6px 16px' }}
                        disabled={!name.trim() || !items.length}
                        onClick={() => {
                            saveProfile(name.trim(), items);
                            flash(`Profile "${name.trim()}" saved`, 'green', true);
                            setName('');
                            bump((n) => n + 1);
                        }}
                    >Save</DialogButton>
                </div>
            </div>}
            <div style={S.section}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                    <div style={S.sectionTitle}>Profiles</div>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                        <button style={S.smallBtn} title="Save all profiles as a JSON file"
                            onClick={(e) => {
                                const text = serializeProfiles();
                                if (!text) {
                                    flash('Nothing to export', 'yellow');
                                    return;
                                }
                                downloadText((e.currentTarget as HTMLElement).ownerDocument, 'launch-options-profiles.json', text);
                                flash('Profiles exported', 'green', true);
                            }}>Export…</button>
                        <button style={S.smallBtn} title="Import profiles from a JSON file"
                            onClick={async (e) => {
                                const text = await pickTextFile((e.currentTarget as HTMLElement).ownerDocument);
                                if (text === null) return; // cancelled
                                const res = await importProfilesFromText(text);
                                if (!res.ok) flash(`Import failed: ${res.error}`, 'red');
                                else {
                                    flash(`Imported ${res.added + res.renamed} profile${res.added + res.renamed === 1 ? '' : 's'}`
                                        + `${res.renamed ? ` (${res.renamed} renamed)` : ''}${res.skipped ? `, ${res.skipped} already present` : ''}`, 'green');
                                    bump((n) => n + 1);
                                }
                            }}>Import…</button>
                    </div>
                </div>
                {!profiles.length && <div style={{ color: C.muted }}>
                    {standalone
                        ? "No profiles yet. Open a game's launch options manager and save one from its Profiles tab."
                        : 'No profiles yet. Save one above.'}
                </div>}
                {profiles.map((p) => (
                    <div key={p.name} style={S.row}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div>{p.name}</div>
                            <div style={{ color: C.muted, fontSize: '11px', fontFamily: C.mono, marginTop: '2px', wordBreak: 'break-all' }}>
                                {composeLaunchOptions(p.items) || '(empty)'}
                            </div>
                        </div>
                        {!standalone && <button style={S.smallBtn} title="Replace this game's arguments with the profile"
                            onClick={() => onLoad(p.items, true)}>Load</button>}
                        {!standalone && <button
                            style={{ ...S.smallBtn, ...(hasRaw ? { opacity: 0.4, cursor: 'default' } : {}) }}
                            disabled={hasRaw}
                            title={hasRaw
                                ? 'Unavailable in raw mode — merged items would be ignored by the raw string'
                                : "Add the profile's arguments on top of the current ones"}
                            onClick={() => { if (!hasRaw) onLoad(p.items, false); }}>+ Merge</button>}
                        <button style={{ ...S.iconBtn, color: C.red }} title="Delete profile"
                            onClick={() => { deleteProfile(p.name); bump((n) => n + 1); }}>✕</button>
                    </div>
                ))}
            </div>
        </div>
    );
}

function ProtonDBTab(props: {
    appid: number;
    flash: (msg: string, color?: keyof Palette, autoClear?: boolean) => void;
    onUse: (lo: string) => void;
}) {
    const { appid, flash, onUse } = props;
    const { C, S } = useTheme();
    const [result, setResult] = useState<PDBResult | null>(null);
    const [expanded, setExpanded] = useState<string | null>(null);
    const [sort, setSort] = useState<'popular' | 'newest'>('popular');

    useEffect(() => {
        fetchProtonDBReports(appid).then(setResult);
    }, [appid]);

    if (!result) {
        return <div style={{ color: C.muted }}>Fetching community reports from ProtonDB…</div>;
    }
    if (result.error) {
        return (
            <div style={{ color: C.muted, lineHeight: 1.6 }}>
                Could not load ProtonDB reports: {result.error}.
                <br />The reports are also browsable at protondb.com.
            </div>
        );
    }
    if (!result.groups.length) {
        return (
            <div style={{ color: C.muted }}>
                None of the {result.totalReports} ProtonDB report{result.totalReports === 1 ? '' : 's'} for this
                game include launch options.
            </div>
        );
    }

    const fmtDate = (ts: number) => {
        const d = new Date(ts * 1000);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };

    const sorted = [...result.groups].sort(sort === 'popular'
        ? (a, b) => b.count - a.count || b.latest - a.latest
        : (a, b) => b.latest - a.latest || b.count - a.count);

    return (
        <div>
            <div style={{ ...S.section, color: C.muted, lineHeight: 1.6 }}>
                Launch options used by ProtonDB reporters for this game ({result.totalReports} reports total,
                {' '}{result.groups.reduce((n, g) => n + g.count, 0)} with launch options).
                <b> Use</b> replaces your current arguments (undo ↶ reverts); disabled rows are kept.
            </div>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                <button style={{ ...S.pill, ...(sort === 'popular' ? S.pillActive : {}) }}
                    onClick={() => setSort('popular')}>Most used</button>
                <button style={{ ...S.pill, ...(sort === 'newest' ? S.pillActive : {}) }}
                    onClick={() => setSort('newest')}>Newest</button>
            </div>
            {sorted.slice(0, 40).map((g) => {
                const isOpen = expanded === g.lo;
                return (
                    <div key={g.lo} className="lom-preset-row"
                        style={{ ...S.presetRow, marginLeft: 0, flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}
                        onClick={() => setExpanded(isOpen ? null : g.lo)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ flex: 1, minWidth: 0, fontFamily: C.mono, fontSize: '12px', ...(isOpen ? {} : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }) }}>
                                {g.lo}
                            </div>
                            <span style={{ ...S.badge, flexShrink: 0 }} title="Reports using exactly this string">{g.count}×</span>
                            <span style={{ ...S.badge, flexShrink: 0 }} title="Most recent report">{fmtDate(g.latest)}</span>
                            <button style={{ ...S.smallBtn, flexShrink: 0 }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onUse(g.lo);
                                    flash('Community launch options applied', 'green', true);
                                }}>Use</button>
                        </div>
                        {isOpen && (
                            <div style={{ color: C.muted, fontSize: '11px' }} onClick={(e) => e.stopPropagation()}>
                                {g.protons.length > 0 && <>Proton versions: {g.protons.join(', ')}</>}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function BulkTab(props: {
    flash: (msg: string, color?: keyof Palette, autoClear?: boolean) => void;
    currentAppid: number;
    onAppliedToCurrent: (items: ArgItem[]) => void;
}) {
    const { flash, currentAppid, onAppliedToCurrent } = props;
    const { C, S } = useTheme();
    const [profileName, setProfileName] = useState('');
    const [filter, setFilter] = useState('');
    const [selected, setSelected] = useState<Set<number>>(new Set());
    // Pills that contributed to the selection; multiple can be active and the
    // selection is their union. Clicking an active pill removes its set.
    const [activeSources, setActiveSources] = useState<Set<string>>(new Set());
    const games = useMemo(() => getAllGames(), []);
    const collections = useMemo(() => getUserCollections(), []);
    const profiles = getProfiles();

    const sourceSets = useMemo(() => {
        const m = new Map<string, number[]>();
        m.set('all', games.map((g) => g.appid));
        m.set('installed', games.filter((g) => g.installed).map((g) => g.appid));
        for (const c of collections) m.set(c.id, c.appids);
        return m;
    }, [games, collections]);

    const lower = filter.toLowerCase();
    const visible = games.filter((g) => !lower || g.name.toLowerCase().includes(lower));

    const toggleGame = (appid: number) => {
        const next = new Set(selected);
        if (next.has(appid)) next.delete(appid);
        else next.add(appid);
        setSelected(next);
    };

    const togglePill = (id: string) => {
        const nextSources = new Set(activeSources);
        if (nextSources.has(id)) nextSources.delete(id);
        else nextSources.add(id);
        setActiveSources(nextSources);
        // recompute as the union of all active pills (manual tweaks reset)
        const union = new Set<number>();
        for (const sid of nextSources) for (const a of sourceSets.get(sid) ?? []) union.add(a);
        setSelected(union);
    };

    const apply = () => {
        const profile = profiles.find((p) => p.name === profileName);
        if (!profile) return;
        const composed = composeLaunchOptions(profile.items);
        let ok = 0;
        for (const appid of selected) {
            const copies = profile.items.map((it) => ({ ...makeItem(it.kind, it.text, it.enabled), note: it.note }));
            if (setLaunchOptions(appid, composed)) {
                setGameItems(appid, copies, composed);
                ok++;
                // The Arguments tab still holds this game's old items; sync it
                // or its next debounced apply would revert what we just wrote.
                if (appid === currentAppid) onAppliedToCurrent(copies);
            }
        }
        flushStore();
        flash(`Profile applied to ${ok} game${ok === 1 ? '' : 's'}`, 'green', true);
        setSelected(new Set());
        setActiveSources(new Set());
    };

    return (
        <div>
            <div style={S.section}>
                <div style={S.sectionTitle}>Profile to apply</div>
                <select
                    style={{ ...S.input, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' }}
                    value={profileName}
                    onChange={(e) => setProfileName((e.target as HTMLSelectElement).value)}
                >
                    <option value="">— select a profile —</option>
                    {profiles.map((p) => (
                        <option key={p.name} value={p.name}>{p.name} ({composeLaunchOptions(p.items) || 'empty'})</option>
                    ))}
                </select>
            </div>
            <div style={S.section}>
                <div style={S.sectionTitle}>
                    Games <span style={{ opacity: 0.6 }}>— {selected.size} selected; replaces their launch options</span>
                </div>
                <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>
                    <button style={{ ...S.pill, ...(activeSources.has('all') ? S.pillActive : {}) }}
                        onClick={() => togglePill('all')}>All games</button>
                    <button style={{ ...S.pill, ...(activeSources.has('installed') ? S.pillActive : {}) }}
                        onClick={() => togglePill('installed')}>All installed</button>
                    {collections.map((c) => (
                        <button key={c.id} style={{ ...S.pill, ...(activeSources.has(c.id) ? S.pillActive : {}) }}
                            title={`Toggle the "${c.name}" collection (${c.appids.length} games) in the selection`}
                            onClick={() => togglePill(c.id)}>{c.name}</button>
                    ))}
                    {selected.size > 0 && (
                        <button style={{ ...S.pill, color: C.muted }}
                            onClick={() => { setSelected(new Set()); setActiveSources(new Set()); }}>✕ Clear</button>
                    )}
                </div>
                <input
                    style={{ ...S.input, width: '100%', boxSizing: 'border-box', marginBottom: '8px' }}
                    placeholder="Filter games…"
                    value={filter}
                    onChange={(e) => setFilter((e.target as HTMLInputElement).value)}
                />
                <div style={{ maxHeight: '240px', overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: '3px' }}>
                    {visible.map((g: GameEntry) => (
                        <div key={g.appid}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 10px', cursor: 'pointer',
                                background: selected.has(g.appid) ? C.panelHover : 'transparent',
                            }}
                            onClick={() => toggleGame(g.appid)}>
                            <input type="checkbox" readOnly checked={selected.has(g.appid)} />
                            <span>{g.name}</span>
                            {!g.installed && <span style={{ color: C.muted, fontSize: '11px' }}>(not installed)</span>}
                        </div>
                    ))}
                    {!visible.length && <div style={{ padding: '10px', color: C.muted }}>No games match.</div>}
                </div>
            </div>
            <DialogButton
                style={{ width: 'auto', padding: '8px 20px' }}
                disabled={!profileName || !selected.size}
                onClick={apply}
            >Apply profile to {selected.size} game{selected.size === 1 ? '' : 's'}</DialogButton>
        </div>
    );
}
