import React from 'react';
import { createRoot } from 'react-dom/client';
import { DialogButton, IconsModule, Millennium, definePlugin, findModule, showModal } from '@steambrew/client';
import { ManagerWindow } from './manager';
import { composeLaunchOptions } from './model';
import { flushStore, getGameName, getStore, loadStore } from './store';

declare const uiStore: any;

const WaitForElement = async (sel: string, parent: any = document) =>
    [...(await Millennium.findElement(parent, sel))][0] as HTMLElement;

const WaitForElementTimeout = async (sel: string, parent: any = document, timeOut = 2000) =>
    [...(await Millennium.findElement(parent, sel, timeOut))][0] as HTMLElement;

// The main desktop window's popup object; preferred parent for pop-outs so
// the manager survives the window it was opened from.
let mainWindowPopup: any = null;
let openModal: { Close: () => void } | null = null;

function openManager(triggerPopup: any, appid: number) {
    const parentWindow = (mainWindowPopup ?? triggerPopup)?.m_popup?.window;
    try { openModal?.Close(); } catch { /* already closed */ }
    openModal = showModal(<ManagerWindow appid={appid} />, parentWindow, {
        strTitle: `Launch Options — ${getGameName(appid)}`,
        bForcePopOut: true,
        bHideMainWindowForPopouts: false,
        popupWidth: 980,
        popupHeight: 720,
    });
}

// ── app page: button next to the ⚙ settings button ─────────────────────────

async function injectAppPageButton(popup: any) {
    const gameSettingsButton = await WaitForElement(
        `div.${findModule((e: any) => e.InPage).InPage} div.${findModule((e: any) => e.AppButtonsContainer).AppButtonsContainer} > div.${findModule((e: any) => e.MenuButtonContainer).MenuButtonContainer}:not([role="button"])`,
        popup.m_popup.document,
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

// ── properties dialog: button on the General page ───────────────────────────

async function injectPropertiesButton(popup: any, panel: HTMLElement, appid: number) {
    if (panel.querySelector('.lom-props-button')) return;
    const dialogBody = await WaitForElement('div.DialogBody', panel);

    const container = popup.m_popup.document.createElement('div');
    container.classList.add('lom-props-button');
    container.style.marginTop = '12px';
    dialogBody.appendChild(container);
    createRoot(container).render(
        <DialogButton style={{ width: '100%' }} onClick={() => openManager(popup, appid)}>
            ⚡ Open Launch Options Manager
        </DialogButton>,
    );
}

async function watchPropertiesDialog(popup: any) {
    const panel = await WaitForElementTimeout(`div.DialogContent[id*='/properties/']`, popup.m_popup.document, 2000);
    if (!panel) return;
    const match = panel.id.match(/\/app\/(\d+)\/properties\//);
    if (!match) return;
    const appid = parseInt(match[1], 10);

    const tryInject = () => {
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
        mainWindowPopup = popup;
        // MainWindowBrowserManager is a SharedJSContext global that only
        // exists once the main window finished booting — poll for it.
        let mwbm: any = undefined;
        while (!mwbm) {
            mwbm = (window as any).MainWindowBrowserManager;
            if (!mwbm) await new Promise((r) => setTimeout(r, 200));
        }
        if (boundBrowsers.has(mwbm.m_browser)) return;
        boundBrowsers.add(mwbm.m_browser);
        mwbm.m_browser.on('finished-request', () => {
            if (mwbm.m_lastLocation.pathname.startsWith('/library/app/')) {
                // use the current main window popup, not the captured one —
                // the listener can outlive a re-created window
                injectAppPageButton(mainWindowPopup ?? popup).catch((e) =>
                    console.error('[launch-options-manager] app page inject failed', e));
            }
        });
    } else if (popup.m_strName?.startsWith('PopupWindow_')) {
        watchPropertiesDialog(popup).catch(() => { /* not a game properties dialog */ });
    }
}

// ── Millennium settings panel ───────────────────────────────────────────────

function SettingsContent() {
    const store = getStore();
    const games = Object.keys(store.games);
    return (
        <div style={{ lineHeight: 1.6 }}>
            <p>
                Open a game's library page and click the <b>⚡</b> button next to the settings (⚙) button,
                or use the button at the bottom of <i>Properties → General</i>.
            </p>
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
