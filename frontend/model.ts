// Data model + parsing/composing of Steam launch options strings.
//
// A launch options string has the shell-like shape:
//   ENV=VAL ENV2=VAL wrapper --wrapper-args -- %command% -gameflag value +cvar 1
// Steam substitutes %command% with the full game command line. Env vars must
// precede everything, wrappers run the substituted command, and anything after
// %command% is passed to the game. Without %command%, the whole string is
// appended to the game command line as arguments.

export type ArgKind = 'env' | 'wrapper' | 'flag' | 'raw';

export interface ArgItem {
    id: string;
    kind: ArgKind;
    text: string;
    enabled: boolean;
}

export interface GameConfig {
    items: ArgItem[];
    // Composed string we last wrote via SetAppLaunchOptions; used to detect
    // out-of-band edits made through the vanilla properties dialog.
    lastApplied: string;
    updatedAt: number;
}

export interface Profile {
    name: string;
    items: ArgItem[];
}

export interface UISettings {
    showAppButton: boolean;
    showPropsButton: boolean;
    openCategories: string[];
    defaultProfileSeeded: boolean;
}

export const defaultUISettings = (): UISettings => ({
    showAppButton: true,
    showPropsButton: true,
    openCategories: [],
    defaultProfileSeeded: false,
});

export interface Store {
    version: 1;
    games: Record<string, GameConfig>;
    profiles: Profile[];
    ui: UISettings;
}

export const emptyStore = (): Store => ({ version: 1, games: {}, profiles: [], ui: defaultUISettings() });

let idCounter = 0;
export const newId = (): string => `${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

export const makeItem = (kind: ArgKind, text: string, enabled = true): ArgItem => ({
    id: newId(),
    kind,
    text: text.trim(),
    enabled,
});

// Wrapper commands that start a new wrapper item during parsing. Anything not
// recognized is appended to the previous wrapper item as its arguments.
const KNOWN_WRAPPERS = new Set([
    'gamemoderun',
    'mangohud',
    'gamescope',
    'game-performance',
    'prime-run',
    'primusrun',
    'optirun',
    'obs-gamecapture',
    'strangle',
    'nice',
    'taskset',
    'firejail',
    'env',
]);

const ENV_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const COMMAND_TOKEN = '%command%';

// Constructs we don't try to model structurally; the string is kept as one
// opaque "raw" item the user edits as plain text. Backslashes are included
// because tokenize() has no escape handling — splitting "My\ Path" tokens
// apart would compose broken strings when individual items are toggled.
const COMPLEX_RE = /(;|&&|\|\||\||\$\(|`|\\|\n)/;

export function tokenize(input: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let quote: string | null = null;
    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (quote) {
            current += ch;
            if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") {
            current += ch;
            quote = ch;
        } else if (ch === ' ' || ch === '\t') {
            if (current) {
                tokens.push(current);
                current = '';
            }
        } else {
            current += ch;
        }
    }
    if (current) tokens.push(current);
    return tokens;
}

export function parseLaunchOptions(raw: string): ArgItem[] {
    const trimmed = raw.trim();
    if (!trimmed) return [];

    const commandCount = (trimmed.match(/%command%/g) || []).length;
    if (COMPLEX_RE.test(trimmed) || commandCount > 1) {
        return [makeItem('raw', trimmed)];
    }

    const tokens = tokenize(trimmed);
    // %command% hidden inside a quoted token (e.g. sh -c '... %command% ...')
    // is also beyond structural editing.
    if (commandCount === 1 && !tokens.includes(COMMAND_TOKEN)) {
        return [makeItem('raw', trimmed)];
    }

    const cmdIndex = tokens.indexOf(COMMAND_TOKEN);
    const before = cmdIndex >= 0 ? tokens.slice(0, cmdIndex) : [];
    const after = cmdIndex >= 0 ? tokens.slice(cmdIndex + 1) : tokens;

    const items: ArgItem[] = [];

    // Leading VAR=VAL tokens are environment variables; once a non-env token
    // appears, the rest of the prefix belongs to wrapper commands.
    let i = 0;
    while (i < before.length && ENV_RE.test(before[i])) {
        items.push(makeItem('env', before[i]));
        i++;
    }
    let wrapperParts: string[] = [];
    const flushWrapper = () => {
        if (wrapperParts.length) {
            items.push(makeItem('wrapper', wrapperParts.join(' ')));
            wrapperParts = [];
        }
    };
    for (; i < before.length; i++) {
        if (KNOWN_WRAPPERS.has(before[i]) && wrapperParts.length) flushWrapper();
        wrapperParts.push(before[i]);
    }
    flushWrapper();

    // After %command%: a new flag item starts at each -flag/+cvar token; bare
    // tokens attach to the previous item as values (covers "-w 1920").
    let flagParts: string[] = [];
    const flushFlag = () => {
        if (flagParts.length) {
            items.push(makeItem('flag', flagParts.join(' ')));
            flagParts = [];
        }
    };
    for (const tok of after) {
        if ((tok.startsWith('-') || tok.startsWith('+')) && flagParts.length) flushFlag();
        flagParts.push(tok);
    }
    flushFlag();

    return items;
}

export function composeLaunchOptions(items: ArgItem[]): string {
    // Any raw item — even disabled or empty — keeps the config in raw mode, so
    // structured items can never leak into Steam invisibly alongside it.
    const rawItem = items.find((it) => it.kind === 'raw');
    if (rawItem) return rawItem.enabled ? rawItem.text.trim() : '';

    const enabled = items.filter((it) => it.enabled && it.text.trim());
    const env = enabled.filter((it) => it.kind === 'env').map((it) => it.text.trim());
    const wrappers = enabled.filter((it) => it.kind === 'wrapper').map((it) => it.text.trim());
    const flags = enabled.filter((it) => it.kind === 'flag').map((it) => it.text.trim());

    const parts: string[] = [...env, ...wrappers];
    if (parts.length) parts.push(COMMAND_TOKEN);
    parts.push(...flags);
    return parts.join(' ');
}

// Reconcile stored items with the launch options string currently in Steam.
// If they were edited outside the plugin, re-parse the live string but keep
// our disabled items (that's state Steam doesn't know about).
export function reconcile(stored: ArgItem[] | undefined, lastApplied: string | undefined, live: string): ArgItem[] {
    if (!stored) return parseLaunchOptions(live);
    if (composeLaunchOptions(stored) === live.trim() || (lastApplied ?? '') === live.trim()) {
        return stored;
    }
    const parsed = parseLaunchOptions(live);
    const liveTexts = new Set(parsed.map((it) => it.text));
    // Token-level containment too: a disabled "-w 1920 -h 1080" re-added
    // outside the plugin parses as two separate items, not one equal text.
    const liveTokens = new Set(parsed.flatMap((it) => tokenize(it.text)));
    const keptDisabled = stored.filter((it) =>
        !it.enabled
        && it.text.trim()
        && !liveTexts.has(it.text)
        && !tokenize(it.text).every((t) => liveTokens.has(t)));
    return [...parsed, ...keptDisabled];
}
