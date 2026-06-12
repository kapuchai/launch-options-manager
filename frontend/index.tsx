import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Field, IconsModule, Millennium, Toggle, definePlugin, findModule, showModal, sleep } from '@steambrew/client';
import { ManagerWindow } from './manager';
import { composeLaunchOptions } from './model';
import { flushStore, getGameName, getStore, getUISettings, loadStore, persistenceBlocked, updateUISettings } from './store';
import { getMainWindowPopup, setMainWindowPopup } from './windows';

declare const uiStore: any;
// Steam global that materializes after the main window boots. Accessed as a
// bare identifier inside try/catch (the proven steam-librarian pattern):
// plugins run in an isolated context where `window.MainWindowBrowserManager`
// stays undefined even once the global is reachable by name.
declare const MainWindowBrowserManager: any;

const WaitForElement = async (sel: string, parent: any = document) =>
    [...(await Millennium.findElement(parent, sel))][0] as HTMLElement;

const WaitForElementTimeout = async (sel: string, parent: any = document, timeOut = 2000) =>
    [...(await Millennium.findElement(parent, sel, timeOut))][0] as HTMLElement;

let openModal: { Close: () => void } | null = null;

function openManager(triggerPopup: any, appid: number) {
    const parentWindow = (getMainWindowPopup() ?? triggerPopup)?.m_popup?.window;
    try { openModal?.Close(); } catch { /* already closed */ }
    openModal = showModal(<ManagerWindow appid={appid} />, parentWindow, {
        strTitle: `Launch Options — ${getGameName(appid)}`,
        bForcePopOut: true,
        bHideMainWindowForPopouts: false,
        popupWidth: 980,
        popupHeight: 720,
    });
}

// ── app page: small button next to the ⚙ in the action row ─────────────────

async function injectAppPageButton(popup: any) {
    const doc = popup?.m_popup?.document;
    if (!doc) return;
    const existing = doc.querySelector('div.lom-button');
    if (!getUISettings().showAppButton) {
        existing?.remove();
        return;
    }
    if (existing) return;

    const gameSettingsButton = await WaitForElement(
        `div.${findModule((e: any) => e.InPage).InPage} div.${findModule((e: any) => e.AppButtonsContainer).AppButtonsContainer} > div.${findModule((e: any) => e.MenuButtonContainer).MenuButtonContainer}:not([role="button"])`,
        doc,
    );
    if (gameSettingsButton.parentNode!.querySelector('div.lom-button')) return;

    const lomButton = gameSettingsButton.cloneNode(true) as HTMLElement;
    lomButton.classList.add('lom-button');
    (lomButton.firstChild as HTMLElement).innerHTML = '⚡';
    lomButton.title = 'Launch Options Manager';
    gameSettingsButton.parentNode!.insertBefore(lomButton, gameSettingsButton.nextSibling);

    lomButton.addEventListener('click', () => {
        const appid = uiStore.currentGameListSelection.nAppId;
        if (appid) openManager(popup, appid);
    });
}

// ── properties dialog: compact link on the General/Shortcut page ────────────

async function injectPropertiesButton(popup: any, panel: HTMLElement, appid: number) {
    if (panel.querySelector('.lom-props-button')) return;
    const dialogBody = await WaitForElement('div.DialogBody', panel);

    const container = popup.m_popup.document.createElement('div');
    container.classList.add('lom-props-button');
    container.style.cssText = 'display:flex;justify-content:flex-end;margin-top:4px;';
    dialogBody.appendChild(container);
    createRoot(container).render(
        <a
            style={{ fontSize: '12px', cursor: 'pointer', opacity: 0.75, textDecoration: 'underline' }}
            onClick={() => openManager(popup, appid)}
        >⚡ Launch Options Manager…</a>,
    );
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
        let mwbm: any = undefined;
        while (!mwbm) {
            try {
                mwbm = MainWindowBrowserManager;
            } catch {
                await sleep(200);
            }
        }
        if (boundBrowsers.has(mwbm.m_browser)) return;
        boundBrowsers.add(mwbm.m_browser);
        mwbm.m_browser.on('finished-request', () => {
            if (mwbm.m_lastLocation.pathname.startsWith('/library/app/')) {
                injectAppPageButton(getMainWindowPopup() ?? popup).catch((e) =>
                    console.error('[launch-options-manager] app page inject failed', e));
            }
        });
        console.log('[launch-options-manager] navigation listener attached');
    } else if (popup.m_strName?.startsWith('PopupWindow_')) {
        watchPropertiesDialog(popup).catch(() => { /* not a game properties dialog */ });
    }
}

// ── Millennium settings panel ───────────────────────────────────────────────

function SettingsContent() {
    const [ready, setReady] = useState(false);
    const [, bump] = useState(0);
    useEffect(() => { loadStore().then(() => setReady(true)); }, []);
    if (!ready) return <div>Loading…</div>;

    const ui = getUISettings();
    const store = getStore();
    const games = Object.keys(store.games);
    const setUI = (patch: Partial<typeof ui>) => {
        updateUISettings(patch);
        flushStore();
        bump((n) => n + 1);
    };

    return (
        <div style={{ lineHeight: 1.6 }}>
            {persistenceBlocked() && (
                <div style={{ color: '#f04a4a', border: '1px solid #f04a4a', borderRadius: '3px', padding: '8px 12px', marginBottom: '10px' }}>
                    The plugin store file could not be read — settings and argument changes will NOT be saved.
                    Check <code>lom-store.json</code> in the plugin directory (a backup may exist as <code>lom-store.json.bak</code>).
                </div>
            )}
            <Field label="Game page button" description="Show the ⚡ button next to the ⚙ button on every game's library page" bottomSeparator="standard" focusable>
                <Toggle value={ui.showAppButton} onChange={(v: boolean) => setUI({ showAppButton: v })} />
            </Field>
            <Field label="Properties dialog link" description="Show the small 'Launch Options Manager…' link in game Properties → General" bottomSeparator="standard" focusable>
                <Toggle value={ui.showPropsButton} onChange={(v: boolean) => setUI({ showPropsButton: v })} />
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
