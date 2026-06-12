import { callable } from '@steambrew/client';
import { ArgItem, GameConfig, Profile, Store, emptyStore, reconcile } from './model';

declare const SteamClient: any;
declare const appStore: any;
declare const appDetailsStore: any;

const backendGetStore = callable<[], string>('GetStore');
const backendSetStore = callable<[{ a_json: string }], boolean>('SetStore');

let store: Store = emptyStore();
let loaded = false;
// When the existing store file couldn't be read/understood, refuse all writes:
// otherwise the first routine save would replace the user's real data with an
// empty store plus one edit.
let loadFailed = false;

export async function loadStore(): Promise<Store> {
    if (loaded) return store;
    try {
        const raw = await backendGetStore();
        if (raw && raw.trim()) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.version === 1) {
                store = {
                    version: 1,
                    games: parsed.games && typeof parsed.games === 'object' && !Array.isArray(parsed.games) ? parsed.games : {},
                    profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
                };
            } else {
                console.error('[launch-options-manager] Store has unknown version — refusing to overwrite it', parsed?.version);
                loadFailed = true;
            }
        }
    } catch (e) {
        console.error('[launch-options-manager] Failed to load store — persistence disabled to protect the file', e);
        loadFailed = true;
    }
    loaded = true;
    return store;
}

let saveTimer: any = null;

async function doSave(): Promise<boolean> {
    if (loadFailed) {
        console.error('[launch-options-manager] Not persisting: the store failed to load this session');
        return false;
    }
    try {
        const res: any = await backendSetStore({ a_json: JSON.stringify(store, null, 2) });
        const ok = res === true || res === 'true';
        if (!ok) console.error('[launch-options-manager] Backend failed to persist the store (disk full / permissions?)');
        return ok;
    } catch (e) {
        console.error('[launch-options-manager] Failed to save store', e);
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

// null = the read failed (details never loaded) — distinct from a confirmed
// empty launch-options string.
export async function getLiveLaunchOptions(appid: number): Promise<string | null> {
    const details = await waitForAppDetails(appid, 1500);
    return details ? readOptionsFromDetails(details) : null;
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
}

// Load the item list for a game, reconciling stored state with whatever is
// currently set in Steam (the user may have edited options in the vanilla UI).
export async function getGameItems(appid: number): Promise<GameLoad> {
    await loadStore();
    const key = String(appid);
    const cfg = store.games[key];
    const live = await getLiveLaunchOptions(appid);
    if (live === null) {
        return { items: cfg?.items ?? [], liveUnknown: true };
    }
    return { items: reconcile(cfg?.items, cfg?.lastApplied, live), liveUnknown: false };
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
