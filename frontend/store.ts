import { callable } from '@steambrew/client';
import { ArgItem, GameConfig, Profile, Store, emptyStore, reconcile } from './model';

declare const SteamClient: any;
declare const appStore: any;
declare const appDetailsStore: any;

const backendGetStore = callable<[], string>('GetStore');
const backendSetStore = callable<[{ a_json: string }], boolean>('SetStore');

let store: Store = emptyStore();
let loaded = false;

export async function loadStore(): Promise<Store> {
    if (loaded) return store;
    try {
        const raw = await backendGetStore();
        if (raw && raw.trim()) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.version === 1) store = parsed;
        }
    } catch (e) {
        console.error('[launch-options-manager] Failed to load store, starting empty', e);
    }
    loaded = true;
    return store;
}

let saveTimer: any = null;
export function saveStore(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
        saveTimer = null;
        try {
            await backendSetStore({ a_json: JSON.stringify(store, null, 2) });
        } catch (e) {
            console.error('[launch-options-manager] Failed to save store', e);
        }
    }, 400);
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

export async function getLiveLaunchOptions(appid: number): Promise<string> {
    const details = await waitForAppDetails(appid, 1500);
    return readOptionsFromDetails(details);
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
    return readOptionsFromDetails(details).trim() === options.trim();
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

// Load the item list for a game, reconciling stored state with whatever is
// currently set in Steam (the user may have edited options in the vanilla UI).
export async function getGameItems(appid: number): Promise<ArgItem[]> {
    await loadStore();
    const key = String(appid);
    const cfg = store.games[key];
    const live = await getLiveLaunchOptions(appid);
    return reconcile(cfg?.items, cfg?.lastApplied, live);
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
    saveStore();
}

export function deleteProfile(name: string): void {
    store.profiles = store.profiles.filter((p) => p.name !== name);
    saveStore();
}
