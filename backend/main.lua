local logger = require("logger")
local millennium = require("millennium")
local fs = require("fs")
local utils = require("utils")

STORE_PATH = fs.parent_path(utils.get_backend_path()) .. "/lom-store.json"
BAK_PATH = STORE_PATH .. ".bak"

-- Backend RPC: the frontend reads/writes the whole store as an opaque JSON
-- string; all merging logic lives in the frontend so the two sides never
-- disagree about the schema.
function GetStore()
    local path = STORE_PATH
    if not fs.exists(path) then
        -- a crash between the two renames in SetStore can leave only the .bak
        if fs.exists(BAK_PATH) then
            path = BAK_PATH
            logger:warn("Store file missing, recovering from backup")
        else
            return ""
        end
    end
    local file, err = io.open(path, "r")
    if not file then
        logger:error("Failed to open store: " .. tostring(err))
        return ""
    end
    local content = file:read("*a")
    file:close()
    return content
end

function SetStore(a_json)
    local temp_path = STORE_PATH .. ".tmp"
    local ok, err = utils.write_file(temp_path, a_json)
    if not ok then
        logger:error("Failed to write store temp file: " .. tostring(err))
        return false
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
        return false
    end
    return true
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
