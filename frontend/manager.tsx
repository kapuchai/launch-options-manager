import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DialogButton } from '@steambrew/client';
import { ArgItem, ArgKind, composeLaunchOptions, makeItem, parseLaunchOptions } from './model';
import { PRESETS, Preset } from './presets';
import {
    GameEntry,
    flushStore,
    getAllGames,
    getGameItems,
    getGameName,
    getProfiles,
    deleteProfile,
    isShortcut,
    saveProfile,
    setAndVerifyLaunchOptions,
    setGameItems,
    setLaunchOptions,
} from './store';

// ── styles ──────────────────────────────────────────────────────────────────

const C = {
    bg: '#171d25',
    panel: '#1f2630',
    panelHover: '#252d39',
    border: '#2e3744',
    text: '#dcdedf',
    muted: '#8b929a',
    accent: '#1a9fff',
    green: '#5ba32b',
    red: '#d94126',
    mono: '"DejaVu Sans Mono", Consolas, monospace',
};

const S: Record<string, React.CSSProperties> = {
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
        flex: 1, background: '#10141a', color: C.text, border: `1px solid ${C.border}`,
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
        flexShrink: 0, borderTop: `1px solid ${C.border}`, padding: '10px 16px',
        display: 'flex', flexDirection: 'column', gap: '6px', background: '#12161c',
    },
    previewText: {
        fontFamily: C.mono, fontSize: '12px', color: '#9fd3ff', wordBreak: 'break-all',
        whiteSpace: 'pre-wrap', minHeight: '16px', userSelect: 'text',
    },
    toggle: { cursor: 'pointer', width: '30px', height: '16px', borderRadius: '8px', position: 'relative', flexShrink: 0, transition: 'background 0.15s' },
    knob: { position: 'absolute', top: '2px', width: '12px', height: '12px', borderRadius: '50%', background: '#fff', transition: 'left 0.15s' },
    smallBtn: {
        background: C.panel, color: C.text, border: `1px solid ${C.border}`, cursor: 'pointer',
        padding: '4px 10px', borderRadius: '2px', fontSize: '12px',
    },
};

// ── small components ────────────────────────────────────────────────────────

function MiniToggle(props: { value: boolean; onChange: (v: boolean) => void }) {
    return (
        <div
            style={{ ...S.toggle, background: props.value ? C.accent : '#3a4350' }}
            onClick={() => props.onChange(!props.value)}
            title={props.value ? 'Enabled — click to disable (kept, not deleted)' : 'Disabled — click to enable'}
        >
            <div style={{ ...S.knob, left: props.value ? '16px' : '2px' }} />
        </div>
    );
}

interface RowProps {
    item: ArgItem;
    onChange: (text: string) => void;
    onToggle: (enabled: boolean) => void;
    onDelete: () => void;
    onMove: (dir: -1 | 1) => void;
}

function ItemRow({ item, onChange, onToggle, onDelete, onMove }: RowProps) {
    return (
        <div style={{ ...S.row, ...(item.enabled ? {} : S.rowDisabled) }}>
            <MiniToggle value={item.enabled} onChange={onToggle} />
            <input
                style={S.input}
                value={item.text}
                spellCheck={false}
                onChange={(e) => onChange((e.target as HTMLInputElement).value)}
            />
            <button style={S.iconBtn} title="Move up" onClick={() => onMove(-1)}>▲</button>
            <button style={S.iconBtn} title="Move down" onClick={() => onMove(1)}>▼</button>
            <button style={{ ...S.iconBtn, color: C.red }} title="Remove" onClick={onDelete}>✕</button>
        </div>
    );
}

const KIND_SECTIONS: { kind: ArgKind; title: string; hint: string; placeholder: string }[] = [
    { kind: 'env', title: 'Environment variables', hint: 'VAR=value, set before the game starts', placeholder: 'PROTON_LOG=1' },
    { kind: 'wrapper', title: 'Wrappers (run before %command%)', hint: 'commands that wrap the game process', placeholder: 'gamemoderun' },
    { kind: 'flag', title: 'Game arguments (after %command%)', hint: 'passed to the game itself', placeholder: '-novid' },
];

// ── main window ─────────────────────────────────────────────────────────────

type Tab = 'args' | 'presets' | 'profiles' | 'bulk';

export function ManagerWindow({ appid }: { appid: number }) {
    const [items, setItems] = useState<ArgItem[] | null>(null);
    const [tab, setTab] = useState<Tab>('args');
    const [status, setStatus] = useState<string>('');
    const [statusColor, setStatusColor] = useState<string>(C.muted);
    const applyTimer = useRef<any>(null);
    // Items waiting in the debounce window; flushed (not discarded) on unmount
    // so closing the window right after typing doesn't lose the edit.
    const pendingItems = useRef<ArgItem[] | null>(null);
    // Monotonic apply counter — a superseded verification must not flash its
    // (stale) result over a newer apply's.
    const runSeq = useRef(0);
    const gameName = useMemo(() => getGameName(appid), [appid]);

    useEffect(() => {
        getGameItems(appid).then(({ items: loadedItems, liveUnknown }) => {
            setItems(loadedItems);
            if (liveUnknown) {
                flash('Steam did not report current options — showing saved state', '#e8a33d');
            }
        }).catch((e) => {
            console.error('[launch-options-manager] load failed', e);
            setItems([]);
            flash('Failed to read launch options', C.red);
        });
        return () => {
            if (applyTimer.current) clearTimeout(applyTimer.current);
            applyTimer.current = null;
            if (pendingItems.current) {
                const next = pendingItems.current;
                pendingItems.current = null;
                const composed = composeLaunchOptions(next);
                setGameItems(appid, next, composed);
                setLaunchOptions(appid, composed);
            }
            flushStore();
        };
    }, [appid]);

    const flash = (msg: string, color = C.muted) => {
        setStatus(msg);
        setStatusColor(color);
    };

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
            flash('Applying…', C.muted);
            try {
                const verified = await setAndVerifyLaunchOptions(appid, composed);
                if (seq !== runSeq.current) return; // superseded by a newer apply
                if (verified) flash('✓ Applied', C.green);
                else flash('Sent, but Steam did not confirm — check the Properties dialog', '#e8a33d');
            } catch (e) {
                console.error('[launch-options-manager] apply failed', e);
                if (seq === runSeq.current) flash('Could not apply — SteamClient API unavailable', C.red);
            }
        };
        if (immediate) run();
        else {
            flash('…', C.muted);
            applyTimer.current = setTimeout(run, 600);
        }
    };

    // Replace the editor state without re-applying (the caller already wrote
    // to Steam) — used when bulk apply targets the game that is open here.
    const adoptItems = (next: ArgItem[]) => {
        if (applyTimer.current) clearTimeout(applyTimer.current);
        applyTimer.current = null;
        pendingItems.current = null;
        runSeq.current++;
        setItems(next);
    };

    if (items === null) {
        return <div style={{ ...S.root, alignItems: 'center', justifyContent: 'center' }}>Loading…</div>;
    }

    const composed = composeLaunchOptions(items);
    const hasRaw = items.some((it) => it.kind === 'raw');

    const changeItem = (id: string, patch: Partial<ArgItem>, immediate = false) =>
        update(items.map((it) => (it.id === id ? { ...it, ...patch } : it)), immediate);

    const deleteItem = (id: string) => update(items.filter((it) => it.id !== id), true);

    const moveItem = (id: string, dir: -1 | 1) => {
        const item = items.find((it) => it.id === id);
        if (!item) return;
        const siblings = items.filter((it) => it.kind === item.kind);
        const pos = siblings.indexOf(item);
        const target = siblings[pos + dir];
        if (!target) return;
        const next = items.slice();
        const i = next.indexOf(item);
        const j = next.indexOf(target);
        next[i] = target;
        next[j] = item;
        update(next, true);
    };

    const addItem = (kind: ArgKind, text = '') => {
        const it = makeItem(kind, text);
        it.text = text; // keep untrimmed while the user is still typing
        update([...items, it], text !== '');
    };

    const tabs: { id: Tab; label: string }[] = [
        { id: 'args', label: 'Arguments' },
        { id: 'presets', label: 'Presets' },
        { id: 'profiles', label: 'Profiles' },
        { id: 'bulk', label: 'Bulk apply' },
    ];

    return (
        <div style={S.root}>
            <div style={{ padding: '12px 16px 6px 16px', display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                <div style={{ fontSize: '17px', fontWeight: 600 }}>{gameName}</div>
                {isShortcut(appid) && (
                    <div style={{ color: '#e8a33d', fontSize: '11px' }} title="Steam may not substitute %command% for non-Steam games — wrappers and env vars can be unreliable here.">
                        non-Steam shortcut
                    </div>
                )}
                <div style={{ color: statusColor, fontSize: '12px', marginLeft: 'auto' }}>{status}</div>
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
                        onChange={changeItem} onDelete={deleteItem} onMove={moveItem} onAdd={addItem} />
                )}
                {tab === 'presets' && (
                    <PresetsTab hasRaw={hasRaw}
                        onAdd={(p) => { addItem(p.kind, p.text); flash(`Added: ${p.text}`, C.green); }} />
                )}
                {tab === 'profiles' && (
                    <ProfilesTab items={items} flash={flash} hasRaw={hasRaw}
                        onLoad={(profileItems, replace) => {
                            const copies = profileItems.map((it) => ({ ...makeItem(it.kind, it.text, it.enabled) }));
                            update(replace ? copies : [...items, ...copies], true);
                            setTab('args');
                        }} />
                )}
                {tab === 'bulk' && <BulkTab flash={flash} currentAppid={appid} onAppliedToCurrent={adoptItems} />}
            </div>
            <div style={S.preview}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '11px', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        Launch options
                    </span>
                    <button
                        style={{ ...S.iconBtn, marginLeft: 'auto' }}
                        title="Copy to clipboard"
                        onClick={(e) => {
                            // Must use the popout window's navigator: the
                            // SharedJSContext global has no document focus and
                            // its clipboard writes are rejected.
                            const win = (e.currentTarget as HTMLElement).ownerDocument?.defaultView;
                            const clipboard = win?.navigator?.clipboard;
                            if (!clipboard) {
                                flash('Copy failed — select the text manually', C.red);
                                return;
                            }
                            clipboard.writeText(composed).then(
                                () => flash('Copied', C.green),
                                () => flash('Copy failed — select the text manually', C.red),
                            );
                        }}
                    >⧉ copy</button>
                </div>
                <div style={S.previewText}>{composed || <span style={{ color: C.muted }}>(empty)</span>}</div>
            </div>
        </div>
    );
}

// ── tabs ────────────────────────────────────────────────────────────────────

function ArgsTab(props: {
    items: ArgItem[]; hasRaw: boolean;
    onChange: (id: string, patch: Partial<ArgItem>, immediate?: boolean) => void;
    onDelete: (id: string) => void;
    onMove: (id: string, dir: -1 | 1) => void;
    onAdd: (kind: ArgKind, text?: string) => void;
}) {
    const { items, hasRaw, onChange, onDelete, onMove, onAdd } = props;

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
                                onChange={(text) => onChange(it.id, { text })}
                                onToggle={(enabled) => onChange(it.id, { enabled }, true)}
                                onDelete={() => onDelete(it.id)}
                                onMove={(dir) => onMove(it.id, dir)} />
                        ))}
                        <button style={S.addBtn} onClick={() => onAdd(sec.kind)}>+ add (e.g. {sec.placeholder})</button>
                    </div>
                );
            })}
        </div>
    );
}

function PresetsTab({ onAdd, hasRaw }: { onAdd: (p: Preset) => void; hasRaw: boolean }) {
    const [filter, setFilter] = useState('');
    const lower = filter.toLowerCase();
    const visible = PRESETS.filter(
        (p) => !lower || p.text.toLowerCase().includes(lower) || p.description.toLowerCase().includes(lower),
    );
    const categories = [...new Set(visible.map((p) => p.category))];

    if (hasRaw) {
        return (
            <div style={{ color: C.muted, lineHeight: 1.6 }}>
                This game's launch options are in raw mode (shell constructs that can't be split into toggles), so
                presets can't be added — they would be ignored by the raw string. Switch to structured editing on
                the Arguments tab first.
            </div>
        );
    }

    return (
        <div>
            <input
                style={{ ...S.input, width: '100%', boxSizing: 'border-box', marginBottom: '12px' }}
                placeholder="Filter presets…"
                value={filter}
                spellCheck={false}
                onChange={(e) => setFilter((e.target as HTMLInputElement).value)}
            />
            {categories.map((cat) => (
                <div key={cat} style={S.section}>
                    <div style={S.sectionTitle}>{cat}</div>
                    {visible.filter((p) => p.category === cat).map((p) => (
                        <div key={p.text} style={S.row}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontFamily: C.mono, fontSize: '12px' }}>{p.text}</div>
                                <div style={{ color: C.muted, fontSize: '11px', marginTop: '2px' }}>{p.description}</div>
                            </div>
                            <button style={S.smallBtn} onClick={() => onAdd(p)}>+ Add</button>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}

function ProfilesTab(props: {
    items: ArgItem[];
    hasRaw: boolean;
    flash: (msg: string, color?: string) => void;
    onLoad: (items: ArgItem[], replace: boolean) => void;
}) {
    const { items, hasRaw, flash, onLoad } = props;
    const [name, setName] = useState('');
    const [, bump] = useState(0);
    const profiles = getProfiles();

    return (
        <div>
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
                            flash(`Profile "${name.trim()}" saved`, C.green);
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
    flash: (msg: string, color?: string) => void;
    currentAppid: number;
    onAppliedToCurrent: (items: ArgItem[]) => void;
}) {
    const { flash, currentAppid, onAppliedToCurrent } = props;
    const [profileName, setProfileName] = useState('');
    const [filter, setFilter] = useState('');
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const games = useMemo(() => getAllGames(), []);
    const profiles = getProfiles();

    const lower = filter.toLowerCase();
    const visible = games.filter((g) => !lower || g.name.toLowerCase().includes(lower));

    const toggleGame = (appid: number) => {
        const next = new Set(selected);
        if (next.has(appid)) next.delete(appid);
        else next.add(appid);
        setSelected(next);
    };

    const apply = () => {
        const profile = profiles.find((p) => p.name === profileName);
        if (!profile) return;
        const composed = composeLaunchOptions(profile.items);
        let ok = 0;
        for (const appid of selected) {
            const copies = profile.items.map((it) => makeItem(it.kind, it.text, it.enabled));
            if (setLaunchOptions(appid, composed)) {
                setGameItems(appid, copies, composed);
                ok++;
                // The Arguments tab still holds this game's old items; sync it
                // or its next debounced apply would revert what we just wrote.
                if (appid === currentAppid) onAppliedToCurrent(copies);
            }
        }
        flushStore();
        flash(`Profile applied to ${ok} game${ok === 1 ? '' : 's'}`, C.green);
        setSelected(new Set());
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
                <input
                    style={{ ...S.input, width: '100%', boxSizing: 'border-box', marginBottom: '8px' }}
                    placeholder="Filter games…"
                    value={filter}
                    onChange={(e) => setFilter((e.target as HTMLInputElement).value)}
                />
                <div style={{ maxHeight: '260px', overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: '3px' }}>
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
