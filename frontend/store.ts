import { callable } from '@steambrew/client';
import { ArgItem, GameConfig, Profile, Store, UISettings, defaultUISettings, emptyStore, makeItem, reconcile } from './model';

declare const SteamClient: any;
declare const appStore: any;
declare const appDetailsStore: any;
declare const collectionStore: any;

const backendGetStore = callable<[], string>('GetStore');
const backendSetStore = callable<[{ a_json: string }], string>('SetStore');
const backendGetCapabilities = callable<[], string>('GetCapabilities');

let store: Store = emptyStore();
// When the existing store file couldn't be read/understood, refuse all writes:
// otherwise the first routine save would replace the user's real data with an
// empty store plus one edit.
let loadFailed = false;

export function persistenceBlocked(): boolean {
    return loadFailed;
}

// Surfaced in the manager UI; console-only errors go unseen by most users.
let saveFailureHandler: ((reason: 'loadFailed' | 'backend') => void) | null = null;
export function onSaveFailure(cb: ((reason: 'loadFailed' | 'backend') => void) | null): void {
    saveFailureHandler = cb;
}

// Memoized so concurrent callers (startup preload + an early manager window)
// share one load — a second concurrent run would re-derive the store and
// double-seed the Default profile.
let loadPromise: Promise<Store> | null = null;

export function loadStore(): Promise<Store> {
    if (!loadPromise) loadPromise = doLoadStore();
    return loadPromise;
}

async function doLoadStore(): Promise<Store> {
    try {
        const raw = String((await backendGetStore()) ?? '');
        const parsed = raw.trim() ? JSON.parse(raw) : null;
        if (parsed && parsed.__firstRun) {
            // no file yet — fresh writable store
        } else if (parsed && parsed.__readError) {
            console.error('[launch-options-manager] Backend could not read the store file — persistence disabled');
            loadFailed = true;
        } else if (parsed && parsed.version === 1) {
            store = {
                version: 1,
                games: parsed.games && typeof parsed.games === 'object' && !Array.isArray(parsed.games) ? parsed.games : {},
                profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
                ui: { ...defaultUISettings(), ...(parsed.ui && typeof parsed.ui === 'object' ? parsed.ui : {}) },
            };
        } else {
            console.error('[launch-options-manager] Store has unexpected content — refusing to overwrite it', parsed?.version);
            loadFailed = true;
        }
    } catch (e) {
        console.error('[launch-options-manager] Failed to load store — persistence disabled to protect the file', e);
        loadFailed = true;
    }
    if (!loadFailed) seedDefaultProfile();
    return store;
}

// First-run convenience: a starter profile so the Profiles tab demonstrates
// the workflow. Created once; deleting it is respected. The seeded flag is
// set in the same step that pushes the profile, so a flush in between can
// never persist the flag without the profile.
function seedDefaultProfile(): void {
    if (store.ui.defaultProfileSeeded || store.profiles.length) {
        store.ui.defaultProfileSeeded = true;
        return;
    }
    getCapabilities().then((caps) => {
        if (store.ui.defaultProfileSeeded || store.profiles.length) {
            store.ui.defaultProfileSeeded = true;
            return;
        }
        const has = (bin: string) => Boolean(caps?.bins?.[bin]);
        const wrapper = has('game-performance') ? 'game-performance' : 'gamemoderun';
        store.ui.defaultProfileSeeded = true;
        store.profiles.push({
            name: 'Default',
            items: [
                // enabled only when the binary actually exists — an enabled
                // wrapper pointing at a missing binary breaks game launches
                makeItem('wrapper', wrapper, has(wrapper)),
                makeItem('wrapper', 'mangohud', has('mangohud')),
            ],
        });
        saveStore();
    });
}

// ── System capabilities (for preset usability hints) ───────────────────────

export interface Capabilities {
    bins: Record<string, boolean>;
    nvidia: boolean;
    amd: boolean;
    intel: boolean;
}

let capsPromise: Promise<Capabilities | null> | null = null;

export function getCapabilities(): Promise<Capabilities | null> {
    if (!capsPromise) {
        capsPromise = backendGetCapabilities()
            .then((raw) => {
                const parsed = JSON.parse(String(raw));
                return parsed && parsed.bins ? (parsed as Capabilities) : null;
            })
            .catch((e) => {
                console.error('[launch-options-manager] capability probe failed', e);
                return null;
            })
            .then((caps) => {
                // don't memoize a transient failure for the whole session
                if (caps === null) capsPromise = null;
                return caps;
            });
    }
    return capsPromise;
}

let saveTimer: any = null;

let loggedLoadFailedRefusal = false;

async function doSave(): Promise<boolean> {
    if (loadFailed) {
        if (!loggedLoadFailedRefusal) {
            loggedLoadFailedRefusal = true;
            console.error('[launch-options-manager] Not persisting: the store failed to load this session');
        }
        saveFailureHandler?.('loadFailed');
        return false;
    }
    try {
        const res: any = await backendSetStore({ a_json: JSON.stringify(store, null, 2) });
        let ok = false;
        try { ok = JSON.parse(String(res))?.ok === true; } catch { /* not the sentinel */ }
        if (!ok) {
            console.error('[launch-options-manager] Backend failed to persist the store (disk full / permissions?)');
            saveFailureHandler?.('backend');
        }
        return ok;
    } catch (e) {
        console.error('[launch-options-manager] Failed to save store', e);
        saveFailureHandler?.('backend');
        return false;
    }
}

export function saveStore(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        doSave();
    }, 400);
}

// Immediate write, used for discrete actions (profile save/delete, bulk apply)
// and teardown paths where the debounce window would lose data.
export function flushStore(): void {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    doSave();
}

export function getStore(): Store {
    return store;
}

// ── Steam client access ─────────────────────────────────────────────────────

export function isShortcut(appid: number): boolean {
    try {
        const app = appStore.GetAppOverviewByAppID?.(appid) ?? appStore.allApps?.find((a: any) => a.appid === appid);
        return Boolean(app?.BIsShortcut?.());
    } catch {
        return false;
    }
}

// Registering for app details triggers Steam to actually load them;
// GetAppDetails alone returns null for apps it hasn't loaded yet.
function waitForAppDetails(appid: number, timeoutMs: number, predicate?: (d: any) => boolean): Promise<any | null> {
    return new Promise((resolve) => {
        let reg: any = null;
        let done = false;
        const finish = (details: any) => {
            if (done) return;
            done = true;
            try { reg?.unregister?.(); } catch { /* ignore */ }
            resolve(details);
        };
        try {
            reg = SteamClient.Apps.RegisterForAppDetails(appid, (details: any) => {
                if (details && Object.keys(details).length > 0 && (!predicate || predicate(details))) {
                    finish(details);
                }
            });
            // If the callback fired synchronously, finish() ran before reg was
            // assigned and could not unregister — release it now.
            if (done) {
                try { reg?.unregister?.(); } catch { /* ignore */ }
            }
        } catch (e) {
            console.error('[launch-options-manager] RegisterForAppDetails failed', e);
            finish(appDetailsStore?.GetAppDetails?.(appid) ?? null);
            return;
        }
        setTimeout(() => finish(appDetailsStore?.GetAppDetails?.(appid) ?? null), timeoutMs);
    });
}

function readOptionsFromDetails(details: any): string {
    if (!details) return '';
    // Non-Steam shortcuts keep their options in a separate field.
    if (typeof details.strShortcutLaunchOptions === 'string' && 'strShortcutExe' in details) {
        return details.strShortcutLaunchOptions ?? '';
    }
    return details.strLaunchOptions ?? '';
}


export function setLaunchOptions(appid: number, options: string): boolean {
    const apps = SteamClient?.Apps;
    try {
        if (isShortcut(appid) && typeof apps?.SetShortcutLaunchOptions === 'function') {
            apps.SetShortcutLaunchOptions(appid, options);
            return true;
        }
        if (typeof apps?.SetAppLaunchOptions === 'function') {
            apps.SetAppLaunchOptions(appid, options);
            return true;
        }
    } catch (e) {
        console.error('[launch-options-manager] Setting launch options failed', e);
        return false;
    }
    console.error('[launch-options-manager] SteamClient.Apps.SetAppLaunchOptions is unavailable');
    return false;
}

// Set + confirm the value propagated back into app details (the setter is
// fire-and-forget; moondeck-style verification).
export async function setAndVerifyLaunchOptions(appid: number, options: string): Promise<boolean> {
    if (!setLaunchOptions(appid, options)) return false;
    const details = await waitForAppDetails(appid, 1200, (d) => readOptionsFromDetails(d).trim() === options.trim());
    return details !== null && readOptionsFromDetails(details).trim() === options.trim();
}

export interface GameEntry {
    appid: number;
    name: string;
    installed: boolean;
    shortcut: boolean;
}

export function getAllGames(): GameEntry[] {
    const apps = (appStore?.allApps ?? []) as any[];
    return apps
        .filter((a) => {
            try {
                // EAppType: 1 = game; shortcuts are non-Steam games.
                return a.app_type === 1 || a.BIsShortcut?.();
            } catch {
                return false;
            }
        })
        .map((a) => ({
            appid: a.appid as number,
            name: (a.display_name ?? `App ${a.appid}`) as string,
            installed: Boolean(a.installed ?? a.size_on_disk),
            shortcut: Boolean(a.BIsShortcut?.()),
        }))
        .sort((x, y) => Number(y.installed) - Number(x.installed) || x.name.localeCompare(y.name));
}

export function getGameName(appid: number): string {
    try {
        const app = appStore.GetAppOverviewByAppID?.(appid) ?? appStore.allApps.find((a: any) => a.appid === appid);
        return app?.display_name ?? `App ${appid}`;
    } catch {
        return `App ${appid}`;
    }
}

// ── Per-game config ─────────────────────────────────────────────────────────

export interface GameLoad {
    items: ArgItem[];
    // True when Steam never delivered app details — the items come from the
    // plugin store alone and must not be reconciled against a phantom ''.
    liveUnknown: boolean;
    // null = unknown (details unavailable); true = runs through a compat tool
    // (Proton & friends), so PROTON_*/WINE* options are meaningful.
    proton: boolean | null;
    compatTool: string;
}

// Load the item list for a game, reconciling stored state with whatever is
// currently set in Steam (the user may have edited options in the vanilla UI).
export async function getGameItems(appid: number): Promise<GameLoad> {
    await loadStore();
    const key = String(appid);
    const cfg = store.games[key];
    const details = await waitForAppDetails(appid, 1500);
    if (!details) {
        return { items: cfg?.items ?? [], liveUnknown: true, proton: null, compatTool: '' };
    }
    const compatTool = (details.strCompatToolName ?? '') as string;
    const live = readOptionsFromDetails(details);
    return {
        items: reconcile(cfg?.items, cfg?.lastApplied, live),
        liveUnknown: false,
        proton: Boolean(compatTool),
        compatTool,
    };
}

export function setGameItems(appid: number, items: ArgItem[], applied: string): void {
    const key = String(appid);
    const cfg: GameConfig = { items, lastApplied: applied, updatedAt: Date.now() };
    if (!items.length) {
        delete store.games[key];
    } else {
        store.games[key] = cfg;
    }
    saveStore();
}

// ── Profiles ────────────────────────────────────────────────────────────────

export function getProfiles(): Profile[] {
    return store.profiles;
}

export function saveProfile(name: string, items: ArgItem[]): void {
    const existing = store.profiles.find((p) => p.name === name);
    const copy = items.map((it) => ({ ...it }));
    if (existing) {
        existing.items = copy;
    } else {
        store.profiles.push({ name, items: copy });
    }
    flushStore();
}

export function deleteProfile(name: string): void {
    store.profiles = store.profiles.filter((p) => p.name !== name);
    flushStore();
}

// ── UI settings ─────────────────────────────────────────────────────────────

export function getUISettings(): UISettings {
    return store.ui;
}

export function updateUISettings(patch: Partial<UISettings>): void {
    store.ui = { ...store.ui, ...patch };
    saveStore();
}

// ── Collections (for bulk-apply selection helpers) ──────────────────────────

export interface CollectionEntry {
    id: string;
    name: string;
    appids: number[];
}

export function getUserCollections(): CollectionEntry[] {
    try {
        const userCollections = (collectionStore?.userCollections ?? []) as any[];
        return userCollections
            .map((c) => ({
                id: String(c.id),
                name: String(c.displayName ?? c.id),
                // same predicate as getAllGames — collections may also hold
                // soundtracks/tools that must not receive launch options
                appids: (c.allApps ?? [])
                    .filter((a: any) => {
                        try { return a.app_type === 1 || a.BIsShortcut?.(); } catch { return false; }
                    })
                    .map((a: any) => a.appid as number),
            }))
            .filter((c) => c.appids.length > 0);
    } catch (e) {
        console.error('[launch-options-manager] reading collections failed', e);
        return [];
    }
}
