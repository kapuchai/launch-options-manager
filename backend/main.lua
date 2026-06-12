local logger = require("logger")
local millennium = require("millennium")
local fs = require("fs")
local utils = require("utils")

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
