import React, { useEffect, useState } from 'react';
import { Field, IconsModule, Millennium, Toggle, definePlugin, findModule, showModal, sleep } from '@steambrew/client';
import { ManagerWindow } from './manager';
import { composeLaunchOptions } from './model';
import { flushStore, getGameName, getStore, getUISettings, loadStore, persistenceBlocked, restoreBackup, updateUISettings } from './store';
import { getMainWindowPopup, setMainWindowPopup } from './windows';

declare const uiStore: any;
// Steam global that materializes after the main window boots. Accessed as a
// bare identifier inside try/catch (the proven steam-librarian pattern):
// plugins run in an isolated context where `window.MainWindowBrowserManager`
// stays undefined even once the global is reachable by name.
declare const MainWindowBrowserManager: any;

const WaitForElementTimeout = async (sel: string, parent: any = document, timeOut = 2000) =>
    [...(await Millennium.findElement(parent, sel, timeOut))][0] as HTMLElement;

const WaitForElementList = async (sel: string, parent: any = document, timeOut = 3000) =>
    [...(await Millennium.findElement(parent, sel, timeOut))] as HTMLElement[];

let openModal: { Close: () => void } | null = null;

function openManager(triggerPopup: any, appid: number) {
    const parentWindow = (getMainWindowPopup() ?? triggerPopup)?.m_popup?.window;
    try { openModal?.Close(); } catch { /* already closed */ }
    openModal = showModal(<ManagerWindow appid={appid} />, parentWindow, {
        strTitle: appid ? `Launch Options — ${getGameName(appid)}` : 'Launch Options — Profiles & Bulk apply',
        bForcePopOut: true,
        bHideMainWindowForPopouts: false,
        popupWidth: 980,
        popupHeight: 720,
    });
}

// ── app page: small button next to the ⚙ in the action row ─────────────────

// Synchronous, idempotent injection — called from a document-wide observer,
// so it must be cheap and never wait.
function maybeInjectAppButton(popup: any): void {
    const doc = popup?.m_popup?.document;
    if (!doc) return;
    const existing = doc.querySelector('div.lom-button');
    if (!getUISettings().showAppButton) {
        existing?.remove();
        return;
    }
    if (existing) return;

    let selector: string;
    try {
        selector = `div.${findModule((e: any) => e.InPage).InPage} div.${findModule((e: any) => e.AppButtonsContainer).AppButtonsContainer} > div.${findModule((e: any) => e.MenuButtonContainer).MenuButtonContainer}:not([role="button"])`;
    } catch (e) {
        console.error('[launch-options-manager] app button class lookup failed', e);
        return;
    }
    const gameSettingsButton = doc.querySelector(selector) as HTMLElement | null;
    if (!gameSettingsButton) return; // not on an app page right now

    const lomButton = gameSettingsButton.cloneNode(true) as HTMLElement;
    lomButton.classList.add('lom-button');
    (lomButton.firstChild as HTMLElement).innerHTML = '🔧';
    lomButton.title = 'Launch Options Manager';
    gameSettingsButton.parentNode!.insertBefore(lomButton, gameSettingsButton.nextSibling);
    console.error('[launch-options-manager] app page button injected (diagnostic, not an error)');

    lomButton.addEventListener('click', () => {
        const appid = uiStore.currentGameListSelection.nAppId;
        if (appid) openManager(popup, appid);
    });
}

// Steam re-renders the app page header freely (and the navigation-event path
// has proven unreliable here), so a debounced document observer is the source
// of truth: whenever the action row exists without our button, inject it.
function watchAppPage(popup: any): void {
    const doc = popup?.m_popup?.document;
    if (!doc?.body || doc.body.dataset.lomWatched) return;
    doc.body.dataset.lomWatched = '1';
    let scheduled = false;
    const observer = new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        setTimeout(() => {
            scheduled = false;
            try { maybeInjectAppButton(popup); } catch (e) {
                console.error('[launch-options-manager] app page inject failed', e);
            }
        }, 300);
    });
    observer.observe(doc.body, { childList: true, subtree: true });
    console.error('[launch-options-manager] app page watcher attached (diagnostic, not an error)');
    maybeInjectAppButton(popup);
}

// ── properties dialog: icon inside the launch-options field ─────────────────

// Overlaid on the input's right edge — zero layout impact on the dialog (an
// appended block element made Steam's flex layout squeeze the other rows).
async function injectPropertiesButton(popup: any, panel: HTMLElement, appid: number) {
    if (panel.querySelector('.lom-props-button')) return;
    const dialogBody = await WaitForElementTimeout('div.DialogBody', panel, 3000);
    if (!dialogBody || panel.querySelector('.lom-props-button')) return;
    const doc: Document = popup.m_popup.document;

    // The launch-options field is the last text input on the General page
    // (and on the non-Steam shortcut page).
    const inputs = dialogBody.querySelectorAll('input[type="text"]');
    const input = inputs[inputs.length - 1] as HTMLInputElement | undefined;

    const button = doc.createElement('button');
    button.className = 'lom-props-button';
    button.textContent = '🔧';
    button.title = 'Open Launch Options Manager';
    button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openManager(popup, appid);
    });
    button.addEventListener('mouseenter', () => { button.style.opacity = '1'; });
    button.addEventListener('mouseleave', () => { button.style.opacity = '0.55'; });

    if (input && input.parentElement) {
        const holder = input.parentElement as HTMLElement;
        if (getComputedStyle(holder).position === 'static') holder.style.position = 'relative';
        input.style.paddingRight = '32px';
        button.style.cssText =
            'position:absolute;right:2px;top:50%;transform:translateY(-50%);background:transparent;'
            + 'border:none;color:inherit;opacity:0.55;cursor:pointer;font-size:14px;padding:2px 7px;line-height:1;';
        holder.appendChild(button);
    } else {
        // fallback: minimal inline link at the end of the dialog body
        button.style.cssText =
            'align-self:flex-end;background:transparent;border:none;color:inherit;opacity:0.55;'
            + 'cursor:pointer;font-size:12px;padding:0;line-height:1.4;text-decoration:underline;';
        button.textContent = '🔧 Launch Options Manager…';
        dialogBody.appendChild(button);
    }
}

async function watchPropertiesDialog(popup: any) {
    const panel = await WaitForElementTimeout(`div.DialogContent[id*='/properties/']`, popup.m_popup.document, 2000);
    if (!panel) return;
    const match = panel.id.match(/\/app\/(\d+)\/properties\//);
    if (!match) return;
    const appid = parseInt(match[1], 10);

    const tryInject = () => {
        if (!getUISettings().showPropsButton) return;
        // general = regular games; shortcut = non-Steam games' equivalent page
        if (/\/properties\/(general|shortcut)_Content$/.test(panel.id)) {
            injectPropertiesButton(popup, panel, appid).catch((e) =>
                console.error('[launch-options-manager] properties inject failed', e));
        }
    };
    tryInject();
    new MutationObserver(tryInject).observe(panel, { attributes: true, attributeFilter: ['id'] });
}

// ── window plumbing ─────────────────────────────────────────────────────────

// Browsers we already attached a navigation listener to; the main window can
// be re-created (close to tray → reopen), re-firing the create hook.
const boundBrowsers = new WeakSet<object>();

async function OnPopupCreation(popup: any) {
    if (popup.m_strName === 'SP Desktop_uid0') {
        setMainWindowPopup(popup);
        // Primary: document observer (cannot miss; survives re-renders).
        watchAppPage(popup);
        // Secondary: navigation events give an immediate trigger without the
        // observer debounce, when MainWindowBrowserManager is reachable.
        // On window re-creation the global may still point at the OLD browser
        // for a while — only accept one we haven't bound yet, bounded retry.
        let mwbm: any = undefined;
        for (let i = 0; i < 150 && !mwbm; i++) {
            try {
                const candidate = MainWindowBrowserManager;
                if (candidate?.m_browser && !boundBrowsers.has(candidate.m_browser)) {
                    mwbm = candidate;
                    break;
                }
            } catch { /* global not defined yet */ }
            await sleep(200);
        }
        if (!mwbm) return; // the document observer still covers injection
        boundBrowsers.add(mwbm.m_browser);
        mwbm.m_browser.on('finished-request', () => {
            if (mwbm.m_lastLocation.pathname.startsWith('/library/app/')) {
                try { maybeInjectAppButton(getMainWindowPopup() ?? popup); } catch (e) {
                    console.error('[launch-options-manager] app page inject failed', e);
                }
            }
        });
    } else if (popup.m_strName?.startsWith('PopupWindow_')) {
        watchPropertiesDialog(popup).catch(() => { /* not a game properties dialog */ });
    } else if (popup.m_strTitle === 'Steam Root Menu') {
        rootMenuPopup = popup;
        applySteamMenuItem(popup).catch((e) =>
            console.error('[launch-options-manager] steam menu inject failed', e));
    }
}

// The root menu popup is created hidden ONCE per session and retained
// (show/hide), so it's remembered for live add/remove when the setting flips.
let rootMenuPopup: any = null;

// Text entry in the top-left Steam menu, opening the standalone manager
// (profiles + bulk apply). Same clone pattern as steam-librarian's
// restart entry. Idempotent: also removes the item when the setting is off.
async function applySteamMenuItem(popup: any) {
    if (!popup?.m_popup?.document) return;
    // the settings must come from the real store, not pre-load defaults — the
    // menu popup is created during the same startup burst as plugin init
    await loadStore();
    const doc = popup.m_popup.document;
    const existing = doc.querySelector('.lom-menu-item');
    if (!getUISettings().showSteamMenuItem) {
        existing?.remove();
        return;
    }
    if (existing) return;
    // NO timeout here: the popup is created hidden at boot and its menu items
    // only render when the menu is first opened — a timed wait expires hours
    // before that. (This exact mistake shipped once; librarian waits forever.)
    const menuItems = [...(await Millennium.findElement(doc, "div#popup_target div[role='menuitem']"))] as HTMLElement[];
    // the boot-time waiter can resolve hours later — the setting may have
    // been turned off in the meantime
    if (!getUISettings().showSteamMenuItem || !menuItems.length || doc.querySelector('.lom-menu-item')) return;
    // prefer sitting right below the Settings entry; fall back to above Exit
    const settingsItem = menuItems.find((el) => /^settings$/i.test(el.textContent?.trim() ?? ''));
    const exitItem = menuItems[menuItems.length - 1];
    const template = settingsItem ?? exitItem;
    const item = template.cloneNode(true) as HTMLElement;
    item.classList.add('lom-menu-item');
    item.textContent = 'Launch Options';
    if (settingsItem?.parentNode) {
        settingsItem.parentNode.insertBefore(item, settingsItem.nextSibling);
    } else {
        exitItem.parentNode!.insertBefore(item, exitItem);
    }
    item.addEventListener('click', () => openManager(getMainWindowPopup(), 0));
}

// ── Millennium settings panel ───────────────────────────────────────────────

function SettingsContent() {
    const [ready, setReady] = useState(false);
    const [accentDraft, setAccentDraft] = useState('');
    const [restoreState, setRestoreState] = useState<'idle' | 'confirm' | 'working' | 'done' | 'failed'>('idle');
    const [restoreMsg, setRestoreMsg] = useState('');
    const [, bump] = useState(0);
    useEffect(() => {
        loadStore().then(() => {
            setAccentDraft(getUISettings().accentColor);
            setReady(true);
        });
    }, []);
    if (!ready) return <div>Loading…</div>;

    const ui = getUISettings();
    const store = getStore();
    const games = Object.keys(store.games);
    const setUI = (patch: Partial<typeof ui>) => {
        updateUISettings(patch);
        flushStore();
        // the root-menu popup is retained for the whole session, so the menu
        // entry has to be added/removed live
        if ('showSteamMenuItem' in patch) {
            applySteamMenuItem(rootMenuPopup).catch(() => { /* popup not seen yet */ });
        }
        bump((n) => n + 1);
    };

    // accept '666cff' as '#666cff'; '' clears the override
    const normalizedAccent = /^[0-9a-f]{6}$/i.test(accentDraft) ? `#${accentDraft}` : accentDraft;
    const accentValid = normalizedAccent === '' || /^#[0-9a-f]{6}$/i.test(normalizedAccent);

    const pillStyle = (active: boolean): React.CSSProperties => ({
        padding: '4px 14px', borderRadius: '12px', cursor: 'pointer', fontSize: '13px',
        border: `1px solid ${active ? '#666cff' : 'rgba(255,255,255,0.2)'}`,
        background: active ? '#666cff' : 'transparent',
        color: active ? '#fff' : 'inherit',
    });

    return (
        <div style={{ lineHeight: 1.6 }}>
            {persistenceBlocked() && (
                <div style={{ color: '#f04a4a', border: '1px solid #f04a4a', borderRadius: '3px', padding: '8px 12px', marginBottom: '10px' }}>
                    The plugin store file could not be read — settings and argument changes will NOT be saved.
                    Check <code>lom-store.json</code> in the plugin directory (a backup may exist as <code>lom-store.json.bak</code>).
                </div>
            )}
            <Field label="Game page button" description="Show the 🔧 button next to the ⚙ button on every game's library page" bottomSeparator="standard" focusable>
                <Toggle value={ui.showAppButton} onChange={(v: boolean) => setUI({ showAppButton: v })} />
            </Field>
            <Field label="Properties dialog button" description="Show the small 🔧 inside the launch options field in game Properties" bottomSeparator="standard" focusable>
                <Toggle value={ui.showPropsButton} onChange={(v: boolean) => setUI({ showPropsButton: v })} />
            </Field>
            <Field label="Steam menu entry" description="Add 'Launch Options' to the top-left Steam menu (opens profiles & bulk apply)" bottomSeparator="standard" focusable>
                <Toggle value={ui.showSteamMenuItem} onChange={(v: boolean) => setUI({ showSteamMenuItem: v })} />
            </Field>
            <Field label="GPU vendor" description="Grays out presets meant for the other vendor; Auto probes the drivers, Disabled turns the hints off" bottomSeparator="standard" focusable>
                <div style={{ display: 'flex', gap: '6px' }}>
                    {([['auto', 'Auto-detect'], ['amd', 'AMD'], ['nvidia', 'NVIDIA'], ['off', 'Disabled']] as const).map(([value, label]) => (
                        <button key={value} style={pillStyle(ui.gpuVendor === value)}
                            onClick={() => setUI({ gpuVendor: value })}>{label}</button>
                    ))}
                </div>
            </Field>
            <Field label="Accent color" description="Hex color for the manager's interactive elements (e.g. #666cff); leave empty to follow the theme" bottomSeparator="standard" focusable>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                        width: '18px', height: '18px', borderRadius: '4px', flexShrink: 0,
                        background: /^#[0-9a-f]{6}$/i.test(normalizedAccent) ? normalizedAccent : 'transparent',
                        border: '1px solid rgba(255,255,255,0.25)',
                    }} />
                    <input
                        value={accentDraft}
                        placeholder="#666cff"
                        spellCheck={false}
                        style={{
                            width: '90px', padding: '4px 8px', fontFamily: 'monospace', borderRadius: '6px',
                            background: '#161b21', color: '#dcdedf', border: '1px solid rgba(255,255,255,0.2)',
                        }}
                        onChange={(e) => {
                            const v = (e.target as HTMLInputElement).value.trim();
                            setAccentDraft(v);
                            const norm = /^[0-9a-f]{6}$/i.test(v) ? `#${v}` : v;
                            if (norm === '' || /^#[0-9a-f]{6}$/i.test(norm)) setUI({ accentColor: norm });
                        }}
                    />
                    {!accentValid && <span style={{ color: '#f04a4a', fontSize: '11px' }}>invalid hex</span>}
                </div>
            </Field>
            <Field label="Restore from backup" description="Swap the plugin's data file with its previous generation (lom-store.json.bak). Running it again swaps back." bottomSeparator="standard" focusable>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                        style={pillStyle(restoreState === 'confirm')}
                        onClick={async () => {
                            if (restoreState === 'working') return;
                            if (restoreState !== 'confirm') {
                                setRestoreState('confirm');
                                setRestoreMsg('');
                                setTimeout(() => setRestoreState((st) => (st === 'confirm' ? 'idle' : st)), 4000);
                                return;
                            }
                            setRestoreState('working');
                            const res = await restoreBackup();
                            setRestoreState(res.ok ? 'done' : 'failed');
                            setRestoreMsg(res.ok ? 'Restored — previous state is now the backup' : `Failed: ${res.reason}`);
                            bump((n) => n + 1);
                        }}
                    >{restoreState === 'confirm' ? 'Click again to confirm' : restoreState === 'working' ? 'Restoring…' : 'Restore'}</button>
                    {restoreMsg && <span style={{ fontSize: '12px', color: restoreState === 'failed' ? '#f04a4a' : '#24a65a' }}>{restoreMsg}</span>}
                </div>
            </Field>
            <p style={{ opacity: 0.7 }}>
                {games.length} game{games.length === 1 ? '' : 's'} with managed options · {store.profiles.length} profile{store.profiles.length === 1 ? '' : 's'}
            </p>
            {games.map((key) => (
                <div key={key} style={{ fontSize: '12px', opacity: 0.8, marginBottom: '4px' }}>
                    <b>{getGameName(parseInt(key, 10))}</b>
                    <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                        {composeLaunchOptions(store.games[key].items) || '(all disabled)'}
                    </div>
                </div>
            ))}
        </div>
    );
}

export default definePlugin(() => {
    console.log('[launch-options-manager] frontend startup');
    loadStore().catch((e) => console.error('[launch-options-manager] store preload failed', e));
    Millennium.AddWindowCreateHook!(OnPopupCreation);
    // Flush any debounced store write on Steam shutdown; the IPC message is
    // posted synchronously, so it survives teardown without awaiting.
    window.addEventListener('beforeunload', () => flushStore());

    return {
        title: 'Launch Options Manager',
        icon: <IconsModule.Settings />,
        content: <SettingsContent />,
        onDismount: () => flushStore(),
    };
});
