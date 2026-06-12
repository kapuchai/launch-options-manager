import { ArgKind } from './model';

export interface Preset {
    text: string;
    kind: ArgKind;
    category: string;
    description: string;
    // Usability requirements, surfaced as hints in the catalog:
    bin?: string;              // wrapper binary that must exist on the system
    proton?: boolean;          // only meaningful for games run through Proton
    gpu?: 'nvidia' | 'amd' | 'mesa';  // vendor-specific (mesa = any Mesa-driven GPU)
}

// Built-in catalog of commonly used launch options on Linux/Proton.
// kind 'env' items go before %command%, 'wrapper' items wrap the command,
// 'flag' items are appended to the game's own command line.
export const PRESETS: Preset[] = [
    // ── Wrappers ────────────────────────────────────────────────────────────
    { kind: 'wrapper', category: 'Wrappers', text: 'gamemoderun', description: 'Feral GameMode: CPU governor → performance, priority tweaks while the game runs', bin: 'gamemoderun' },
    { kind: 'wrapper', category: 'Wrappers', text: 'game-performance', description: 'CachyOS: switch power profile to performance while the game runs', bin: 'game-performance' },
    { kind: 'wrapper', category: 'Wrappers', text: 'mangohud', description: 'MangoHud FPS/frametime/temps overlay (Vulkan; do not use under gamescope — use --mangoapp there)', bin: 'mangohud' },
    { kind: 'wrapper', category: 'Wrappers', text: 'mangohud --dlsym', description: 'MangoHud for OpenGL games that misbehave with default hooking', bin: 'mangohud' },
    { kind: 'wrapper', category: 'Wrappers', text: 'gamescope -f --', description: 'Gamescope micro-compositor, fullscreen (the -- must stay last)', bin: 'gamescope' },
    { kind: 'wrapper', category: 'Wrappers', text: 'gamescope -W 2560 -H 1440 -f --', description: 'Gamescope at a fixed output resolution (edit -W/-H)', bin: 'gamescope' },
    { kind: 'wrapper', category: 'Wrappers', text: 'gamescope -w 1280 -h 720 -W 1920 -H 1080 -F fsr --', description: 'Gamescope: render low (-w/-h), FSR-upscale to output (-W/-H); --fsr-sharpness 0-20', bin: 'gamescope' },
    { kind: 'wrapper', category: 'Wrappers', text: 'gamescope -f --mangoapp --', description: 'Gamescope with MangoHud inside (plain mangohud is unsupported under gamescope)', bin: 'gamescope' },
    { kind: 'wrapper', category: 'Wrappers', text: 'gamescope -f -r 144 --adaptive-sync --', description: 'Gamescope fullscreen with refresh-rate hint + VRR', bin: 'gamescope' },
    { kind: 'wrapper', category: 'Wrappers', text: 'gamescope -f --hdr-enabled --', description: 'HDR passthrough via gamescope (Wayland + supporting GPU)', bin: 'gamescope' },
    { kind: 'wrapper', category: 'Wrappers', text: 'gamescope --force-grab-cursor --', description: 'Fix mouse escaping the window / wrong sensitivity', bin: 'gamescope' },
    { kind: 'wrapper', category: 'Wrappers', text: 'prime-run', description: 'NVIDIA PRIME render offload (hybrid-GPU laptops)', bin: 'prime-run' },
    { kind: 'wrapper', category: 'Wrappers', text: 'obs-gamecapture', description: 'Hook game for OBS vkcapture (capture without window grab)', bin: 'obs-gamecapture' },
    { kind: 'wrapper', category: 'Wrappers', text: 'strangle 60', description: 'libstrangle FPS cap (edit the number; OpenGL/Vulkan)', bin: 'strangle' },
    { kind: 'wrapper', category: 'Wrappers', text: 'taskset -c 0-7', description: 'Pin the game to specific CPU cores (P/E-core or CCD tuning)', bin: 'taskset' },

    // ── Proton behavior ─────────────────────────────────────────────────────
    { kind: 'env', category: 'Proton', text: 'PROTON_LOG=1', description: 'Write Proton debug log to ~/steam-<appid>.log', proton: true },
    { kind: 'env', category: 'Proton', text: 'PROTON_ENABLE_WAYLAND=1', description: 'Native Wayland Wine driver — better latency; experimental, breaks Steam Overlay/Input', proton: true },
    { kind: 'env', category: 'Proton', text: 'PROTON_ENABLE_HDR=1', description: 'HDR via Wine-Wayland (requires PROTON_ENABLE_WAYLAND=1 too)', proton: true },
    { kind: 'env', category: 'Proton', text: 'PROTON_NO_ESYNC=1', description: 'Disable esync — try if a game crashes or behaves oddly', proton: true },
    { kind: 'env', category: 'Proton', text: 'PROTON_NO_FSYNC=1', description: 'Disable fsync (falls back to esync)', proton: true },
    { kind: 'env', category: 'Proton', text: 'PROTON_USE_NTSYNC=1', description: 'Kernel NTSYNC sync primitives (kernel 6.14+, GE-Proton 10-9+)', proton: true },
    { kind: 'env', category: 'Proton', text: 'PROTON_USE_WOW64=1', description: 'New WoW64 mode for 32-bit games (pairs well with ntsync)', proton: true },
    { kind: 'env', category: 'Proton', text: 'PROTON_USE_WINED3D=1', description: 'OpenGL wined3d instead of DXVK (old GPUs without Vulkan)', proton: true },
    { kind: 'env', category: 'Proton', text: 'PROTON_FSR4_UPGRADE=1', description: 'GE-Proton: swap FSR2/3 DLLs to FSR4 (RDNA3/4)', proton: true },
    { kind: 'env', category: 'Proton', text: 'PROTON_DLSS_UPGRADE=1', description: 'GE-Proton: upgrade DLSS DLLs to latest', proton: true },
    { kind: 'env', category: 'Proton', text: 'PROTON_HIDE_NVIDIA_GPU=1', description: 'Report NVIDIA GPU as AMD (games that block NV features under Wine)', proton: true },
    { kind: 'env', category: 'Proton', text: 'PROTON_FORCE_LARGE_ADDRESS_AWARE=1', description: 'Let 32-bit games use more than 2 GB RAM', proton: true },
    { kind: 'env', category: 'Proton', text: 'PROTON_SET_GAME_DRIVE=1', description: 'Create an S: drive pointing at the game’s Steam library', proton: true },
    { kind: 'env', category: 'Proton', text: 'STEAM_COMPAT_DATA_PATH=/path/to/prefix', description: 'Custom Proton prefix location (edit the path; saves live inside it)', proton: true },
    { kind: 'env', category: 'Proton', text: 'STEAM_COMPAT_MOUNTS=/path1:/path2', description: 'Bind extra host paths into the pressure-vessel container (mods on other drives)', proton: true },
    { kind: 'env', category: 'Proton', text: 'WINEDLLOVERRIDES=dinput8=n,b', description: 'DLL override (native,builtin) — needed by many mod loaders (edit DLL name)', proton: true },
    { kind: 'env', category: 'Proton', text: 'WINEDEBUG=-all', description: 'Silence Wine debug output', proton: true },
    { kind: 'env', category: 'Proton', text: 'WINE_FULLSCREEN_INTEGER_SCALING=1', description: 'Sharp integer scaling when upscaling', proton: true },
    { kind: 'env', category: 'Proton', text: 'LANG=ja_JP.UTF-8', description: 'Force locale — region-locked content / mojibake fixes (edit locale)' },
    { kind: 'env', category: 'Proton', text: 'PULSE_LATENCY_MSEC=60', description: 'Fix crackling audio in Wine/Proton games' },
    { kind: 'env', category: 'Proton', text: 'LD_PRELOAD=', description: 'Strip Steam overlay preload — fixes crashes/stutter in some titles (disables overlay)' },

    // ── Graphics / DXVK / VKD3D / Mesa / NVIDIA ─────────────────────────────
    { kind: 'env', category: 'Graphics', text: 'DXVK_HUD=fps,frametimes', description: 'DXVK overlay with FPS + frametime graph (or DXVK_HUD=full)', proton: true },
    { kind: 'env', category: 'Graphics', text: 'DXVK_FRAME_RATE=60', description: 'DXVK-level FPS cap for D3D9/10/11 games (edit the number)', proton: true },
    { kind: 'env', category: 'Graphics', text: 'DXVK_ASYNC=1', description: 'Legacy: async shader compile — only dxvk-gplasync builds; no-op on modern DXVK', proton: true },
    { kind: 'env', category: 'Graphics', text: 'VKD3D_CONFIG=dxr', description: 'Enable DirectX Raytracing in vkd3d-proton', proton: true },
    { kind: 'env', category: 'Graphics', text: 'RADV_PERFTEST=gpl', description: 'RADV experimental features (value varies by Mesa version)', gpu: 'amd' },
    { kind: 'env', category: 'Graphics', text: 'AMD_VULKAN_ICD=RADV', description: 'Force RADV when AMDVLK/PRO is also installed', gpu: 'amd' },
    { kind: 'env', category: 'Graphics', text: 'MESA_VK_WSI_PRESENT_MODE=immediate', description: 'Mesa Vulkan: no VSync (mailbox / fifo = vsync)', gpu: 'mesa' },
    { kind: 'env', category: 'Graphics', text: 'mesa_glthread=true', description: 'Mesa OpenGL threaded dispatch (boosts some GL games)', gpu: 'mesa' },
    { kind: 'env', category: 'Graphics', text: 'vblank_mode=0', description: 'Mesa OpenGL: disable VSync', gpu: 'mesa' },
    { kind: 'env', category: 'Graphics', text: '__GL_THREADED_OPTIMIZATIONS=1', description: 'NVIDIA: threaded OpenGL optimizations', gpu: 'nvidia' },
    { kind: 'env', category: 'Graphics', text: '__GL_SYNC_TO_VBLANK=0', description: 'NVIDIA OpenGL: VSync off', gpu: 'nvidia' },
    { kind: 'env', category: 'Graphics', text: '__NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia', description: 'NVIDIA PRIME offload without the prime-run script', gpu: 'nvidia' },
    { kind: 'env', category: 'Graphics', text: 'DRI_PRIME=1', description: 'Mesa dGPU offload (AMD/Intel hybrid systems)' },
    { kind: 'env', category: 'Graphics', text: 'ENABLE_VKBASALT=1', description: 'vkBasalt post-processing (CAS sharpening, ReShade FX)', bin: 'vkBasalt' },
    { kind: 'env', category: 'Graphics', text: 'MANGOHUD=1', description: 'MangoHud via Vulkan layer env (alternative to the wrapper)', bin: 'mangohud' },
    { kind: 'env', category: 'Graphics', text: 'MANGOHUD_CONFIG=fps_limit=60', description: 'Inline MangoHud config (e.g. no_display, cpu_temp,gpu_temp)', bin: 'mangohud' },
    { kind: 'env', category: 'Graphics', text: 'SDL_VIDEODRIVER=wayland', description: 'Native Wayland for SDL games (x11 forces XWayland instead)' },

    // ── Common game flags ───────────────────────────────────────────────────
    { kind: 'flag', category: 'Game flags', text: '-novid', description: 'Skip intro videos (Source engine: CS2, TF2, …)' },
    { kind: 'flag', category: 'Game flags', text: '-skipintro', description: 'Skip intro movies (many engines; name varies)' },
    { kind: 'flag', category: 'Game flags', text: '-nosplash', description: 'Disable splash screen (UE, Arma, others)' },
    { kind: 'flag', category: 'Game flags', text: '-nolauncher', description: 'Bypass the game’s own launcher where supported' },
    { kind: 'flag', category: 'Game flags', text: '-fullscreen', description: 'Force fullscreen' },
    { kind: 'flag', category: 'Game flags', text: '-windowed -noborder', description: 'Borderless windowed' },
    { kind: 'flag', category: 'Game flags', text: '-w 1920 -h 1080', description: 'Force resolution (edit values)' },
    { kind: 'flag', category: 'Game flags', text: '-vulkan', description: 'Use the Vulkan renderer where supported (CS2, BG3, …)' },
    { kind: 'flag', category: 'Game flags', text: '-dx11', description: 'Force DirectX 11 (Unreal Engine and others)' },
    { kind: 'flag', category: 'Game flags', text: '-dx12', description: 'Force DirectX 12 (Unreal Engine and others)' },
    { kind: 'flag', category: 'Game flags', text: '-nojoy', description: 'Disable joystick support — faster startup, fixes input bugs (Source)' },
    { kind: 'flag', category: 'Game flags', text: '-high', description: 'High CPU priority (Source)' },
    { kind: 'flag', category: 'Game flags', text: '-useallavailablecores', description: 'Hint to use all CPU cores (UE3/4-era titles)' },
    { kind: 'flag', category: 'Game flags', text: '-console', description: 'Enable developer console (Source)' },
    { kind: 'flag', category: 'Game flags', text: '-language english', description: 'Force game language (Source; edit language)' },
    { kind: 'flag', category: 'Game flags', text: '-autoconfig', description: 'Reset video settings to defaults (Source recovery)' },
    { kind: 'flag', category: 'Game flags', text: '-force-vulkan', description: 'Unity: force the Vulkan renderer' },
    { kind: 'flag', category: 'Game flags', text: '-screen-fullscreen 0 -popupwindow', description: 'Unity: windowed/borderless' },
];

export const PRESET_CATEGORIES: string[] = [...new Set(PRESETS.map((p) => p.category))];
