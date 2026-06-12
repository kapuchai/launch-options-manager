// Shared window plumbing: index.tsx records the main desktop window popup,
// the manager uses it for theming probes and as a pop-out parent.

let mainWindowPopup: any = null;

export function setMainWindowPopup(popup: any): void {
    mainWindowPopup = popup;
}

export function getMainWindowPopup(): any {
    return mainWindowPopup;
}

export function getMainWindowDocument(): Document | null {
    try {
        return mainWindowPopup?.m_popup?.document ?? null;
    } catch {
        return null;
    }
}
