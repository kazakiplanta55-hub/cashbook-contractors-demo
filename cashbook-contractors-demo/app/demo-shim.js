"use strict";
// Demo storage layer. Replaces the Electron bridge (window.cbStorage) with the in-memory store that lives in the
// demo frame (index.html). Nothing is written to disk, localStorage or cookies: closing or refreshing the tab,
// or pressing "Reset demo", brings back the original sample data.
(function () {
    var host = null;
    try { host = window.parent !== window ? window.parent : null; } catch (e) { host = null; }
    var D = host && host.__CBDEMO;
    if (!D) {
        // Opened on its own (not inside the demo frame): send the visitor to the demo page.
        var root = (document.currentScript && document.currentScript.src || location.href).replace(/\/app\/.*$/, "/");
        location.replace(root + "index.html");
        throw new Error("Cashbook demo: open index.html");
    }
    var clone = function (v) { return v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)); };
    window.cbStorage = Object.freeze({
        readSync: function (key) { return { value: clone(D.data[key]), recovered: false, corrupted: false, engine: "Demo (memory)" }; },
        writeSync: function (key, value) {
            if (value === null || value === undefined) delete D.data[key]; else D.data[key] = clone(value);
            D.touch(); return { ok: true, engine: "Demo (memory)", backedUp: false };
        },
        backupNow: function () { return { ok: true, engine: "Demo (memory)", backedUpKeys: 0 }; },
        listBackups: function () { return { ok: true, engine: "Demo (memory)", backups: [] }; },
        restoreBackup: function () { return { ok: false, error: "Restore points are not available in the demo." }; },
        getDataDir: function () { return "Demo mode (memory only, nothing is saved)"; }
    });
    // Browser preferences (theme, filters, print signature choices) also stay in memory only.
    try {
        Object.defineProperty(window, "localStorage", { configurable: true, get: function () { return D.local; } });
        Object.defineProperty(window, "sessionStorage", { configurable: true, get: function () { return D.session; } });
    } catch (e) { /* the app falls back to its defaults */ }
    // Tell the frame which page is open (keeps the top bar in sync).
    window.addEventListener("DOMContentLoaded", function () { try { D.onPage && D.onPage(location.pathname); } catch (e) { /* ignore */ } });
})();
