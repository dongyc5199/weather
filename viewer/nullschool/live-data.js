/* Local NOAA GFS data adapter. The upstream renderer remains responsible for drawing. */
var earthData = (function () {
    "use strict";

    var manifest = null;
    var server = null;
    var displayed = null;
    var lastClientError = null;
    var checking = false;
    var ready = false;
    var timer = null;
    var pressureLevels = [1000, 850, 700, 500, 250, 70, 10];
    var layerKeys = ["surface"].concat(pressureLevels.map(function (level) { return level + "hPa"; }));
    var selected = {param: "wind", date: "current", surface: "surface", level: "level"};
    var waitingLayers = {};

    function text(id, value) {
        var node = document.getElementById(id);
        if (node) node.textContent = value;
    }

    function formatTime(value, local) {
        var date = new Date(value);
        return (local ? µ.toLocalISO(date) + " Local" : µ.toUTCISO(date) + " UTC");
    }

    function validManifest(value) {
        if (!value || (value.schema !== 1 && value.schema !== 2)) return false;
        var pattern = value.schema === 2 ? /^\d{8}T\d{2}Z-f\d{3}-\d+p\d+-v2$/ : /^\d{8}T\d{2}Z-f\d{3}-\d+p\d+$/;
        if (!pattern.test(value.id)) return false;
        if (!Number.isFinite(Date.parse(value.run_time)) || !Number.isFinite(Date.parse(value.valid_time))) return false;
        if (value.schema === 2 && (!value.layers || Object.keys(value.layers).length !== 8 ||
                JSON.stringify(value.pressure_levels_hpa) !== JSON.stringify(pressureLevels))) return false;
        return (value.schema === 2 ? layerKeys : ["surface"]).every(function (key) {
            return ["wind", "temp"].every(function (kind) {
                var fileKey = key === "surface" ? kind : key + "/" + kind;
                var expected = "data/live/" + value.id + "/" + fileKey + ".json";
                return value.files && value.files[fileKey] === expected &&
                    (value.schema === 1 || value.layers[key] && value.layers[key].files && value.layers[key].files[kind] === expected);
            });
        });
    }

    function layerKey(attr) {
        if (attr.surface === "surface" && attr.level === "level") return "surface";
        return attr.surface === "isobaric" && layerKeys.indexOf(attr.level) > 0 ? attr.level : null;
    }

    function layer(key) {
        if (!manifest || !key) return null;
        return manifest.schema === 1 ? (key === "surface" ? {files: manifest.files} : null) : manifest.layers[key];
    }

    function dataPath(type, attr) {
        var data = attr.date === "current" && layer(layerKey(attr));
        return data && data.files[type] ? µ.assetUrl(data.files[type]) : null;
    }

    function waitForPath(type, attr) {
        var key = layerKey(attr);
        if (!key) return Promise.reject(new Error("Unsupported pressure level"));
        if (!waitingLayers[key]) {
            waitingLayers[key] = new Promise(function (resolve, reject) {
                var deadline = Date.now() + 180000;
                function poll() {
                    var available = layer(key);
                    if (available) return resolve(available);
                    if ((!server && ready) || (server && !server.updating && server.last_error) || Date.now() > deadline) {
                        return reject(new Error(key + " data is not available yet"));
                    }
                    setTimeout(poll, 300);
                }
                poll();
            }).finally(function () { delete waitingLayers[key]; });
        }
        return waitingLayers[key].then(function (available) { return µ.assetUrl(available.files[type]); });
    }

    function render() {
        var live = displayed && displayed.header && displayed.header.earthSource === "noaa-gfs";
        var ocean = displayed && displayed.mode === "ocean";
        var busy = checking || (server && server.updating);
        var failed = lastClientError || (server && server.last_error);
        var stale = live && Date.now() - displayed.date.getTime() > 3 * 3600000;
        var requestedLayer = layerKey(selected);
        document.querySelectorAll(".surface").forEach(function (button) {
            var key = button.id === "surface-level" ? "surface" : button.id.replace("isobaric-", "");
            var available = key === "surface" || !!layer(key);
            button.classList.toggle("disabled", !available);
            button.disabled = !available;
            button.setAttribute("aria-disabled", String(!available));
        });
        var temp = document.getElementById("overlay-temp");
        if (temp) {
            var available = !!layer(requestedLayer);
            temp.classList.toggle("disabled", !available);
            temp.setAttribute("aria-disabled", String(!available));
            temp.title = available ? (requestedLayer === "surface" ? "Temperature at 2 m" : "Temperature at " + requestedLayer) :
                "Temperature is available after this GFS layer loads";
        }
        if (live) {
            var actualLayer = displayed.header.layer || "surface";
            var label = displayed.header.pressureLevelHpa ? displayed.header.pressureLevelHpa + " hPa" : "Surface";
            text("data-status", "NOAA GFS · " + label + " · " + displayed.header.dx + "°");
            text("data-validity", "Forecast · " + formatTime(displayed.date, true));
            text("data-update-status", failed ? "Update failed · showing cached forecast" :
                requestedLayer && actualLayer !== requestedLayer ? "Loading " + requestedLayer + "…" :
                busy ? "Checking latest data…" : !server ? "Cached forecast · auto-update unavailable" :
                stale ? "Cached forecast · check its valid time" : "Latest downloaded forecast");
        } else if (displayed) {
            text("data-status", (ocean ? "OSCAR" : "GFS") + " · historical sample");
            text("data-validity", formatTime(displayed.date, true));
            text("data-update-status", ocean ? "Ocean data is the bundled 2014 sample" :
                busy ? "Downloading GFS · sample shown temporarily" : "Latest GFS unavailable · sample shown");
        } else {
            text("data-status", "Connecting to NOAA GFS…");
            text("data-validity", "");
            text("data-update-status", failed ? "Could not check for new data" : "Loading data…");
        }
        var button = document.getElementById("nav-now");
        if (button) {
            button.textContent = busy ? "Checking…" : "Latest";
            button.classList.toggle("disabled", !!busy);
            button.classList.toggle("invisible", !!ocean);
        }
    }

    async function json(url, options) {
        var response = await fetch(url, Object.assign({cache: "no-store", signal: AbortSignal.timeout(15000)}, options));
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
    }

    function accept(value) {
        if (!validManifest(value)) return;
        var changed = !manifest || manifest.id !== value.id;
        manifest = value;
        if (changed && ready) window.dispatchEvent(new CustomEvent("earth-data-updated"));
    }

    async function check() {
        if (checking) return;
        checking = true;
        render();
        try {
            try {
                server = await json(µ.assetUrl("api/earth/status"));
                accept(server.manifest);
            } catch (error) {
                if (server) throw error;
                // Static hosting can still display the last explicitly downloaded snapshot.
                accept(await json(µ.assetUrl("data/live/manifest.json")));
            }
            lastClientError = null;
        } catch (error) {
            lastClientError = error.message;
        } finally {
            checking = false;
            render();
            clearTimeout(timer);
            timer = setTimeout(check, server && server.updating ? 3000 : 60000);
        }
    }

    async function refresh() {
        if (checking || (server && server.updating)) return;
        if (server) {
            checking = true;
            render();
            try {
                server = await json(µ.assetUrl("api/earth/refresh"), {method: "POST"});
                lastClientError = null;
            } catch (error) {
                lastClientError = error.message;
            } finally {
                checking = false;
            }
        }
        await check();
    }

    var initial = check().then(function () { ready = true; });
    document.addEventListener("visibilitychange", function () {
        if (!document.hidden) check();
    });

    return {
        ready: initial,
        snapshot: function () { return manifest; },
        path: dataPath,
        waitForPath: waitForPath,
        supports: function (attr) { return !!layerKey(attr); },
        select: function (attr) { selected = Object.assign({}, attr); render(); },
        refresh: refresh,
        show: function (grids, mode, local) {
            if (grids) {
                displayed = {header: grids.primaryGrid.header, date: grids.primaryGrid.date, mode: mode};
                var header = displayed.header;
                text("data-run", header && header.earthSource === "noaa-gfs" ? formatTime(header.refTime, local) : "Historical sample");
            } else {
                text("data-run", "Loading…");
            }
            render();
        }
    };
})();
