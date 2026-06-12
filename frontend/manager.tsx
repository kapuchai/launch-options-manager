import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DialogButton } from '@steambrew/client';
import { ArgItem, ArgKind, composeLaunchOptions, makeItem, tokenize } from './model';
import { PRESETS, Preset } from './presets';
import {
    Capabilities,
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
    isShortcut,
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
}

interface PaletteExtra {
    input: string;
    header: string;
    accentHover: string;
}

const FALLBACK: Palette & PaletteExtra = {
    bg: '#171d25',
    panel: '#1f2630',
    panelHover: '#252d39',
    border: '#2e3744',
    text: '#dcdedf',
    muted: '#8b929a',
    accent: '#1a9fff',
    green: '#5ba32b',
    red: '#d94126',
    yellow: '#e8a33d',
    mono: '"DejaVu Sans Mono", Consolas, monospace',
    input: 'rgba(0,0,0,0.35)',
    header: '#252d39',
    accentHover: '#3eb1ff',
};

// Adapt to the active Millennium theme: SpaceTheme (and themes following its
// convention) define --st-* RGB-triplet variables; Millennium itself injects
// --SystemAccentColor*. Anything missing falls back to a Steam-like dark look.
function readPalette(doc: Document): Palette {
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
        if (!themed) return FALLBACK;
        const bodyColor = getComputedStyle(doc.body).color;
        // SpaceTheme layering: background (10,10,10) sits behind everything;
        // visible surfaces are the grays color-1..6. Using the grays — not the
        // near-black background — matches how the rest of the theme looks.
        return {
            bg: rgb('--st-color-1', FALLBACK.bg),
            panel: rgb('--st-color-2', FALLBACK.panel),
            panelHover: rgb('--st-color-5', FALLBACK.panelHover),
            border: rgb('--st-color-6', FALLBACK.border),
            text: bodyColor && bodyColor !== 'rgba(0, 0, 0, 0)' ? bodyColor : FALLBACK.text,
            muted: FALLBACK.muted,
            accent: rgb('--st-accent-1', rgb('--SystemAccentColor-RGB', FALLBACK.accent)),
            accentHover: rgb('--st-accent-2', rgb('--st-accent-1', FALLBACK.accentHover)),
            green: rgb('--st-green', FALLBACK.green),
            red: rgb('--st-red', FALLBACK.red),
            yellow: rgb('--st-yellow', FALLBACK.yellow),
            mono: FALLBACK.mono,
            input: rgb('--st-color-3', FALLBACK.input),
            header: rgb('--st-color-5', FALLBACK.header),
        };
    } catch {
        return FALLBACK;
    }
}

function makeStyles(C: Palette): Record<string, React.CSSProperties> {
    return {
        root: {
            display: 'flex', flexDirection: 'column', height: '100%', minHeight: '560px',
            background: C.bg, color: C.text, fontSize: '13px',
        },
        tabBar: { display: 'flex', gap: '2px', padding: '8px 12px 0 12px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 },
        tab: { padding: '7px 14px', cursor: 'pointer', borderRadius: '3px 3px 0 0', color: C.muted, userSelect: 'none' },
        tabActive: { background: C.panel, color: C.text, boxShadow: `inset 0 2px 0 ${C.accent}` },
        body: { flex: 1, overflowY: 'auto', padding: '12px 16px' },
        section: { marginBottom: '16px' },
        sectionTitle: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', color: C.muted, margin: '0 0 6px 2px' },
        row: {
            display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 8px',
            background: C.panel, borderRadius: '3px', marginBottom: '4px', border: `1px solid ${C.border}`,
        },
        rowDisabled: { opacity: 0.55 },
        input: {
            flex: 1, background: C.input, color: C.text, border: `1px solid ${C.border}`,
            borderRadius: '2px', padding: '5px 8px', fontFamily: C.mono, fontSize: '12px', outline: 'none', minWidth: 0,
        },
        iconBtn: {
            background: 'transparent', color: C.muted, border: 'none', cursor: 'pointer',
            padding: '2px 5px', fontSize: '13px', lineHeight: 1, borderRadius: '2px',
        },
        addBtn: {
            background: 'transparent', color: C.accent, border: `1px dashed ${C.border}`, cursor: 'pointer',
            padding: '5px 10px', borderRadius: '3px', fontSize: '12px', width: '100%', textAlign: 'left',
        },
        preview: {
            flexShrink: 0, borderTop: `2px solid ${C.accent}`, padding: '10px 16px 12px 16px',
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
            padding: '4px 10px', borderRadius: '2px', fontSize: '12px',
        },
        badge: {
            fontSize: '10px', padding: '1px 6px', borderRadius: '8px', whiteSpace: 'nowrap',
            border: `1px solid ${C.border}`, color: C.muted,
        },
        catHeader: {
            display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none',
            padding: '8px 12px', background: C.header, borderLeft: `3px solid ${C.accent}`,
            borderRadius: '3px', marginBottom: '4px', fontWeight: 600,
        },
        presetRow: {
            display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px',
            background: 'transparent', borderRadius: '3px', marginBottom: '2px', marginLeft: '12px',
            border: `1px solid ${C.border}`, cursor: 'pointer',
        },
        pill: {
            background: C.panel, color: C.text, border: `1px solid ${C.border}`, cursor: 'pointer',
            padding: '4px 12px', borderRadius: '12px', fontSize: '12px',
        },
        pillActive: {
            background: C.accent, color: '#fff', border: `1px solid ${C.accent}`,
        },
    };
}

// :hover and friends can't be expressed inline; a small stylesheet derived
// from the palette is injected into the pop-out document. Also styles native
// <select>/<option>, whose dropdown list ignores inline colors.
function paletteCss(C: Palette): string {
    return `
.lom-root button:hover { filter: brightness(1.3); }
.lom-root .lom-preset-row:hover { background: ${C.panel} !important; }
.lom-root .lom-cat-header:hover { filter: brightness(1.15); }
.lom-root select { background: ${C.input}; color: ${C.text}; border: 1px solid ${C.border}; }
.lom-root select option { background-color: ${C.panel}; color: ${C.text}; }
.lom-root input::placeholder, .lom-root textarea::placeholder { color: ${C.muted}; }
.lom-root .lom-drag-over { box-shadow: inset 0 2px 0 ${C.accent}; }
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

const ThemeCtx = createContext<{ C: Palette; S: Record<string, React.CSSProperties> }>({ C: FALLBACK, S: makeStyles(FALLBACK) });
const useTheme = () => useContext(ThemeCtx);

// ── small components ────────────────────────────────────────────────────────

function MiniToggle(props: { value: boolean; onChange: (v: boolean) => void }) {
    const { C, S } = useTheme();
    return (
        <div
            style={{ ...S.toggle, background: props.value ? C.accent : 'rgba(128,128,128,0.35)' }}
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
    dragOver: boolean;
    canDrop: boolean;
    onChange: (patch: Partial<ArgItem>, immediate?: boolean) => void;
    onDelete: () => void;
    onDragStart: () => void;
    onDragEnd: () => void;
    onDragOverRow: () => void;
    onDropOnRow: (dataId: string | null) => void;
}

function ItemRow(props: RowProps) {
    const { item, dragging, dragOver, canDrop } = props;
    const { C, S } = useTheme();
    const [noteOpen, setNoteOpen] = useState(false);
    // The row is draggable only while the ⠿ grip is pressed: a permanently
    // draggable row hijacks mouse text selection inside its inputs (Chromium
    // starts a row drag instead of a selection).
    const [dragArmed, setDragArmed] = useState(false);
    const showNote = noteOpen || Boolean(item.note);

    return (
        <div
            className={`${dragging ? 'lom-dragging' : ''} ${dragOver ? 'lom-drag-over' : ''}`}
            style={{ ...S.row, flexDirection: 'column', alignItems: 'stretch', gap: '4px', ...(item.enabled ? {} : S.rowDisabled) }}
            draggable={dragArmed}
            onMouseUp={() => setDragArmed(false)}
            onDragStart={(e) => { (e as any).dataTransfer?.setData('text/plain', item.id); props.onDragStart(); }}
            onDragEnd={() => { setDragArmed(false); props.onDragEnd(); }}
            onDragOver={(e) => {
                if (!canDrop) return; // no preventDefault → browser shows not-allowed
                e.preventDefault();
                props.onDragOverRow();
            }}
            onDrop={(e) => { e.preventDefault(); props.onDropOnRow((e as any).dataTransfer?.getData('text/plain') || null); }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                    style={{ color: C.muted, cursor: 'grab', fontSize: '14px', lineHeight: 1, userSelect: 'none' }}
                    title="Drag to reorder"
                    onMouseDown={() => setDragArmed(true)}
                >⠿</span>
                <MiniToggle value={item.enabled} onChange={(enabled) => props.onChange({ enabled }, true)} />
                <input
                    style={S.input}
                    value={item.text}
                    spellCheck={false}
                    draggable={false}
                    onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onChange={(e) => props.onChange({ text: (e.target as HTMLInputElement).value })}
                />
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
                        draggable={false}
                        onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
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

type Tab = 'args' | 'presets' | 'profiles' | 'bulk';

export function ManagerWindow({ appid }: { appid: number }) {
    const [items, setItems] = useState<ArgItem[] | null>(null);
    const [tab, setTab] = useState<Tab>('args');
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
    const gameName = useMemo(() => getGameName(appid), [appid]);
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
        // theme probe: own popout document first, falling back to defaults
        const doc = rootRef.current?.ownerDocument;
        if (doc) {
            const palette = readPalette(doc);
            setTheme({ C: palette, S: makeStyles(palette) });
            injectStylesheet(doc, palette);
        }
    }, []);

    useEffect(() => {
        getCapabilities().then(setCaps);
        onSaveFailure((reason) => {
            flash(reason === 'loadFailed'
                ? 'Changes are NOT saved — the plugin store file could not be read'
                : 'Failed to save plugin data to disk', 'red');
        });
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
            if (pendingItems.current) {
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
    const update = (next: ArgItem[], immediate = false) => {
        setItems(next);
        pendingItems.current = next;
        if (applyTimer.current) clearTimeout(applyTimer.current);
        const run = async () => {
            applyTimer.current = null;
            pendingItems.current = null;
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

    // Replace the editor state without re-applying (the caller already wrote
    // to Steam) — used when bulk apply targets the game that is open here.
    const adoptItems = (next: ArgItem[]) => {
        if (applyTimer.current) clearTimeout(applyTimer.current);
        applyTimer.current = null;
        pendingItems.current = null;
        runSeq.current++;
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

    // Drag & drop within a section; cross-kind drops are ignored (order
    // across kinds is fixed). Dragging downward lands BELOW the target so the
    // last position is reachable; upward lands above it.
    const reorderItem = (dragId: string, targetId: string) => {
        if (dragId === targetId) return;
        const dragged = items.find((it) => it.id === dragId);
        const target = items.find((it) => it.id === targetId);
        if (!dragged || !target || dragged.kind !== target.kind) return;
        const from = items.indexOf(dragged);
        const to = items.indexOf(target);
        const next = items.filter((it) => it.id !== dragId);
        next.splice(next.indexOf(target) + (from < to ? 1 : 0), 0, dragged);
        if (next.every((it, i) => it === items[i])) return;
        update(next, true);
    };

    const addItem = (kind: ArgKind, text = '') => {
        const it = makeItem(kind, text);
        it.text = text; // keep untrimmed while the user is still typing
        update([...items, it], text !== '');
    };

    // %command% highlighted so the structure of the final string stands out
    const previewParts = (composed || '').split('%command%');

    const tabs: { id: Tab; label: string }[] = [
        { id: 'args', label: 'Arguments' },
        { id: 'presets', label: 'Presets' },
        { id: 'profiles', label: 'Profiles' },
        { id: 'bulk', label: 'Bulk apply' },
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
                </div>
                <div style={S.tabBar}>
                    {tabs.map((t) => (
                        <div key={t.id} style={{ ...S.tab, ...(tab === t.id ? S.tabActive : {}) }} onClick={() => setTab(t.id)}>
                            {t.label}
                        </div>
                    ))}
                </div>
                <div style={S.body}>
                    {tab === 'args' && (
                        <ArgsTab items={items} hasRaw={hasRaw}
                            onChange={changeItem} onDelete={deleteItem} onReorder={reorderItem} onAdd={addItem} />
                    )}
                    {tab === 'presets' && (
                        <PresetsTab hasRaw={hasRaw} caps={caps} proton={proton}
                            addedExact={addedExact} addedSignatures={addedSignatures}
                            onAdd={(p) => { addItem(p.kind, p.text); flash(`Added: ${p.text}`, 'green', true); }} />
                    )}
                    {tab === 'profiles' && (
                        <ProfilesTab items={items} flash={flash} hasRaw={hasRaw}
                            onLoad={(profileItems, replace) => {
                                const copies = profileItems.map((it) => ({ ...makeItem(it.kind, it.text, it.enabled), note: it.note }));
                                update(replace ? copies : [...items, ...copies], true);
                                setTab('args');
                            }} />
                    )}
                    {tab === 'bulk' && <BulkTab flash={flash} currentAppid={appid} onAppliedToCurrent={adoptItems} />}
                </div>
                <div style={S.preview} className="lom-preview">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '11px', color: C.accent, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>
                            Current launch options
                        </span>
                        <span style={{ color: C[statusColor] as string, fontSize: '12px', marginLeft: 'auto' }}>{status}</span>
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
                </div>
            </div>
        </ThemeCtx.Provider>
    );
}

// ── tabs ────────────────────────────────────────────────────────────────────

function ArgsTab(props: {
    items: ArgItem[]; hasRaw: boolean;
    onChange: (id: string, patch: Partial<ArgItem>, immediate?: boolean) => void;
    onDelete: (id: string) => void;
    onReorder: (dragId: string, targetId: string) => void;
    onAdd: (kind: ArgKind, text?: string) => void;
}) {
    const { items, hasRaw, onChange, onDelete, onReorder, onAdd } = props;
    const { C, S } = useTheme();
    const [dragId, setDragId] = useState<string | null>(null);
    const [overId, setOverId] = useState<string | null>(null);
    const dragKind = dragId ? items.find((it) => it.id === dragId)?.kind ?? null : null;

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

    return (
        <div>
            {KIND_SECTIONS.map((sec) => {
                const sectionItems = items.filter((it) => it.kind === sec.kind);
                return (
                    <div key={sec.kind} style={S.section}>
                        <div style={S.sectionTitle}>{sec.title} <span style={{ opacity: 0.6 }}>— {sec.hint}</span></div>
                        {sectionItems.map((it) => (
                            <ItemRow key={it.id} item={it}
                                dragging={dragId === it.id}
                                dragOver={overId === it.id && dragId !== null && dragId !== it.id}
                                canDrop={dragId === null || dragKind === sec.kind}
                                onChange={(patch, immediate) => onChange(it.id, patch, immediate)}
                                onDelete={() => onDelete(it.id)}
                                onDragStart={() => setDragId(it.id)}
                                onDragEnd={() => { setDragId(null); setOverId(null); }}
                                onDragOverRow={() => setOverId(it.id)}
                                onDropOnRow={(dataId) => {
                                    // dataTransfer payload must corroborate our
                                    // state — guards against stale dragIds from
                                    // cancelled selection-drags
                                    if (dragId && dataId === dragId) onReorder(dragId, it.id);
                                    setDragId(null);
                                    setOverId(null);
                                }} />
                        ))}
                        <button style={S.addBtn} onClick={() => onAdd(sec.kind)}>+ add (e.g. {sec.placeholder})</button>
                    </div>
                );
            })}
        </div>
    );
}

// Why a preset may not work here; null = no objection.
function presetIssue(p: Preset, caps: Capabilities | null, proton: boolean | null): string | null {
    if (p.bin && caps && caps.bins[p.bin] === false) return `${p.bin} is not installed`;
    if (p.proton && proton === false) return 'Proton games only — this game runs natively';
    if (p.gpu === 'nvidia' && caps && !caps.nvidia) return 'NVIDIA driver not detected';
    if (p.gpu === 'amd' && caps && caps.nvidia && !caps.amd) return 'AMD-only option';
    // Mesa drives AMD and Intel GPUs; only flag when neither is present
    if (p.gpu === 'mesa' && caps && caps.nvidia && !caps.amd && !caps.intel) return 'Mesa option — no Mesa GPU detected';
    return null;
}

function PresetsTab(props: {
    onAdd: (p: Preset) => void;
    hasRaw: boolean;
    caps: Capabilities | null;
    proton: boolean | null;
    addedExact: Set<string>;
    addedSignatures: Set<string>;
}) {
    const { onAdd, hasRaw, caps, proton, addedExact, addedSignatures } = props;
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
                            const issue = presetIssue(p, caps, proton);
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
    flash: (msg: string, color?: keyof Palette, autoClear?: boolean) => void;
    onLoad: (items: ArgItem[], replace: boolean) => void;
}) {
    const { items, hasRaw, flash, onLoad } = props;
    const { C, S } = useTheme();
    const [name, setName] = useState('');
    const [, bump] = useState(0);
    const profiles = getProfiles();

    return (
        <div>
            <div style={{ ...S.section, color: C.muted, lineHeight: 1.6 }}>
                A profile is a named, reusable set of arguments. Build the set you like on the
                <b> Arguments</b> tab, save it here, then <b>Load</b> it onto any other game (replacing its
                arguments) or <b>+ Merge</b> it on top of them. <b>Bulk apply</b> writes a profile to many
                games at once. Profiles are copies — editing a game later doesn't change the profile.
            </div>
            <div style={S.section}>
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
            </div>
            <div style={S.section}>
                <div style={S.sectionTitle}>Profiles</div>
                {!profiles.length && <div style={{ color: C.muted }}>No profiles yet. Save one above.</div>}
                {profiles.map((p) => (
                    <div key={p.name} style={S.row}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div>{p.name}</div>
                            <div style={{ color: C.muted, fontSize: '11px', fontFamily: C.mono, marginTop: '2px', wordBreak: 'break-all' }}>
                                {composeLaunchOptions(p.items) || '(empty)'}
                            </div>
                        </div>
                        <button style={S.smallBtn} title="Replace this game's arguments with the profile"
                            onClick={() => onLoad(p.items, true)}>Load</button>
                        <button
                            style={{ ...S.smallBtn, ...(hasRaw ? { opacity: 0.4, cursor: 'default' } : {}) }}
                            disabled={hasRaw}
                            title={hasRaw
                                ? 'Unavailable in raw mode — merged items would be ignored by the raw string'
                                : "Add the profile's arguments on top of the current ones"}
                            onClick={() => { if (!hasRaw) onLoad(p.items, false); }}>+ Merge</button>
                        <button style={{ ...S.iconBtn, color: C.red }} title="Delete profile"
                            onClick={() => { deleteProfile(p.name); bump((n) => n + 1); }}>✕</button>
                    </div>
                ))}
            </div>
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
    // Which pill made the current selection; clicking it again clears it.
    const [activeSource, setActiveSource] = useState<string | null>(null);
    const games = useMemo(() => getAllGames(), []);
    const collections = useMemo(() => getUserCollections(), []);
    const profiles = getProfiles();

    const lower = filter.toLowerCase();
    const visible = games.filter((g) => !lower || g.name.toLowerCase().includes(lower));

    const toggleGame = (appid: number) => {
        const next = new Set(selected);
        if (next.has(appid)) next.delete(appid);
        else next.add(appid);
        setSelected(next);
        // manual edits mean the selection no longer equals the pill's set
        setActiveSource(null);
    };

    const togglePill = (id: string, appids: number[]) => {
        if (activeSource === id) {
            setSelected(new Set());
            setActiveSource(null);
        } else {
            setSelected(new Set(appids));
            setActiveSource(id);
        }
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
        setActiveSource(null);
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
                    <button style={{ ...S.pill, ...(activeSource === 'all' ? S.pillActive : {}) }}
                        onClick={() => togglePill('all', games.map((g) => g.appid))}>All games</button>
                    <button style={{ ...S.pill, ...(activeSource === 'installed' ? S.pillActive : {}) }}
                        onClick={() => togglePill('installed', games.filter((g) => g.installed).map((g) => g.appid))}>All installed</button>
                    {collections.map((c) => (
                        <button key={c.id} style={{ ...S.pill, ...(activeSource === c.id ? S.pillActive : {}) }}
                            title={`Select the "${c.name}" collection (${c.appids.length} games); click again to clear`}
                            onClick={() => togglePill(c.id, c.appids)}>{c.name}</button>
                    ))}
                    {selected.size > 0 && (
                        <button style={{ ...S.pill, color: C.muted }}
                            onClick={() => { setSelected(new Set()); setActiveSource(null); }}>✕ Clear</button>
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
