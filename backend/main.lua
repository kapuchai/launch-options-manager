local logger = require("logger")
local millennium = require("millennium")
local fs = require("fs")
local utils = require("utils")
local http = require("http")
local json = require("json")

STORE_PATH = fs.parent_path(utils.get_backend_path()) .. "/lom-store.json"
BAK_PATH = STORE_PATH .. ".bak"

-- All RPC functions return non-empty JSON strings: Millennium's IPC mangles
-- nil/empty/boolean returns (observed: empty string arrives at the frontend
-- as a non-string), so sentinels are encoded explicitly.

-- Returns content, err. nil content with nil err = missing or empty (a
-- crash after rename-without-fsync can leave a zero-length file, which must
-- fall through to the backup, NOT count as first run).
local function read_store_file(path)
    if not fs.exists(path) then
        return nil, nil
    end
    local file, err = io.open(path, "r")
    if not file then
        return nil, tostring(err)
    end
    local content = file:read("*a")
    file:close()
    if content == nil or content == "" then
        return nil, nil
    end
    return content, nil
end

function GetStore()
    local content, err = read_store_file(STORE_PATH)
    if content then
        return content
    end
    if err then
        logger:error("Failed to open store: " .. err)
    end
    local bak, bak_err = read_store_file(BAK_PATH)
    if bak then
        logger:warn("Store file missing or empty, recovering from backup")
        return bak
    end
    if err or bak_err then
        return '{"__readError":true}'
    end
    return '{"__firstRun":true}'
end

function SetStore(a_json)
    local temp_path = STORE_PATH .. ".tmp"
    local ok, err = utils.write_file(temp_path, a_json)
    if not ok then
        logger:error("Failed to write store temp file: " .. tostring(err))
        return '{"ok":false}'
    end
    -- keep the previous generation as a backup before replacing
    if fs.exists(STORE_PATH) then
        if fs.exists(BAK_PATH) then
            fs.remove(BAK_PATH)
        end
        fs.rename(STORE_PATH, BAK_PATH)
    end
    local renamed = fs.rename(temp_path, STORE_PATH)
    if not renamed then
        logger:error("Failed to atomically replace store file")
        fs.remove(temp_path)
        return '{"ok":false}'
    end
    return '{"ok":true}'
end

EXPORT_PATH = fs.parent_path(utils.get_backend_path()) .. "/lom-profiles.json"

-- Profile export/import goes through a fixed file next to the store, so no
-- file dialogs are needed: export writes it, import reads whatever the user
-- placed there.
function ExportProfiles(a_json)
    local ok, err = utils.write_file(EXPORT_PATH, a_json)
    if not ok then
        logger:error("Failed to write profiles export: " .. tostring(err))
        return '{"ok":false}'
    end
    return string.format('{"ok":true,"path":%q}', EXPORT_PATH)
end

function ReadProfilesFile()
    if not fs.exists(EXPORT_PATH) then
        return string.format('{"__missing":true,"path":%q}', EXPORT_PATH)
    end
    local file, err = io.open(EXPORT_PATH, "r")
    if not file then
        logger:error("Failed to open profiles file: " .. tostring(err))
        return '{"__readError":true}'
    end
    local content = file:read("*a")
    file:close()
    if content == nil or content == "" then
        return string.format('{"__missing":true,"path":%q}', EXPORT_PATH)
    end
    return content
end

-- Swap the live store with its previous generation (.bak). Reversible:
-- running it twice restores the original state.
function RestoreBackup()
    if not fs.exists(BAK_PATH) then
        return '{"ok":false,"reason":"no backup file"}'
    end
    local swap = STORE_PATH .. ".swap"
    if fs.exists(swap) then
        fs.remove(swap)
    end
    if fs.exists(STORE_PATH) then
        local moved = fs.rename(STORE_PATH, swap)
        if not moved then
            return '{"ok":false,"reason":"could not move current store"}'
        end
    end
    local restored = fs.rename(BAK_PATH, STORE_PATH)
    if not restored then
        fs.rename(swap, STORE_PATH)
        return '{"ok":false,"reason":"could not move backup into place"}'
    end
    if fs.exists(swap) then
        fs.rename(swap, BAK_PATH)
    end
    logger:info("Store restored from backup (swapped with previous state)")
    return '{"ok":true}'
end

-- Which wrapper binaries exist on this system, and what GPU drivers are
-- present — used by the frontend to flag presets that can't work here.
local PROBE_BINS = {
    "gamemoderun", "mangohud", "gamescope", "game-performance", "prime-run",
    "obs-gamecapture", "strangle", "taskset", "firejail", "scb",
}

local function bin_exists(name)
    local path_env = utils.getenv("PATH") or ""
    for dir in string.gmatch(path_env, "[^:]+") do
        if fs.exists(dir .. "/" .. name) then
            return true
        end
    end
    return false
end

function GetCapabilities()
    local parts = {}
    for _, bin in ipairs(PROBE_BINS) do
        table.insert(parts, string.format('"%s":%s', bin, bin_exists(bin) and "true" or "false"))
    end
    local nvidia = fs.exists("/proc/driver/nvidia") and "true" or "false"
    local amd = fs.exists("/sys/module/amdgpu") and "true" or "false"
    local intel = (fs.exists("/sys/module/i915") or fs.exists("/sys/module/xe")) and "true" or "false"
    return string.format('{"bins":{%s},"nvidia":%s,"amd":%s,"intel":%s}', table.concat(parts, ","), nvidia, amd, intel)
end

-- ── ProtonDB community reports ──────────────────────────────────────────────
-- ProtonDB serves full report shards from hash-addressed URLs; the hash is a
-- JS string hash over values from counts.json (scheme used by the site itself
-- and by decky-proton-pulse). The shard is megabytes, so it's filtered down
-- to launch-options-bearing reports here and cached per appid.

local function intstr(n)
    return string.format("%.0f", n)
end

-- JS: for c of seed+"m": h = ((h<<5) - h + c) | 0; return abs(h)
local function js_hash(seed)
    local h = 0
    for ch in (seed .. "m"):gmatch(".") do
        h = (h * 31 + ch:byte()) % 4294967296
    end
    if h >= 2147483648 then
        h = h - 4294967296
    end
    return math.abs(h)
end

local pdb_cache = {}

function GetProtonDBReports(a_appid)
    local appid = tonumber(a_appid)
    if not appid then
        return '{"__error":"bad appid"}'
    end

    local counts_resp, cerr = http.get("https://www.protondb.com/data/counts.json", { timeout = 15 })
    if not counts_resp or counts_resp.status ~= 200 then
        logger:error("ProtonDB counts fetch failed: " .. tostring(cerr or (counts_resp and counts_resp.status)))
        return '{"__error":"could not reach ProtonDB"}'
    end
    local ok_counts, counts = pcall(json.decode, counts_resp.body)
    if not ok_counts or type(counts) ~= "table" or not counts.reports or not counts.timestamp then
        return '{"__error":"unexpected ProtonDB counts payload"}'
    end

    local cached = pdb_cache[appid]
    if cached and cached.ts == counts.timestamp then
        return cached.payload
    end

    local left = intstr(counts.reports) .. "p" .. intstr(appid * (counts.reports % counts.timestamp))
    local seed = "p" .. left .. "*vRT" .. intstr(appid) .. "pNaN" .. "undefined"
    local url = "https://www.protondb.com/data/reports/all-devices/app/" .. intstr(js_hash(seed)) .. ".json"

    local resp, rerr = http.get(url, { timeout = 30 })
    if not resp or resp.status ~= 200 then
        logger:error("ProtonDB shard fetch failed: " .. tostring(rerr or (resp and resp.status)))
        return '{"__error":"no report data for this game (or the ProtonDB URL scheme changed)"}'
    end
    local ok_data, data = pcall(json.decode, resp.body)
    if not ok_data or type(data) ~= "table" or type(data.reports) ~= "table" then
        return '{"__error":"unexpected ProtonDB report payload"}'
    end

    local compact = {}
    for _, report in ipairs(data.reports) do
        local responses = report.responses
        local lo = responses and responses.launchOptions
        if type(lo) == "string" and lo ~= "" then
            table.insert(compact, {
                lo = lo,
                ts = report.timestamp or 0,
                proton = (responses.protonVersion ~= nil and tostring(responses.protonVersion)) or "",
                verdict = (responses.verdict ~= nil and tostring(responses.verdict)) or "",
            })
        end
    end

    local payload = json.encode({ reports = compact, total = #data.reports })
    if #compact == 0 then
        payload = json.encode({ reports = {}, total = #data.reports })
    end
    pdb_cache[appid] = { ts = counts.timestamp, payload = payload }
    return payload
end

local function on_load()
    millennium.ready()
    logger:info("Launch Options Manager backend loaded")
end

local function on_frontend_loaded()
    logger:info("Launch Options Manager frontend loaded")
end

local function on_unload()
end

return {
    on_load = on_load,
    on_frontend_loaded = on_frontend_loaded,
    on_unload = on_unload,
}
