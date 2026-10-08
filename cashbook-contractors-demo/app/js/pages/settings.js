"use strict";
// Settings page. The Backup, Restore and Factory Reset steps are the same ones as the gear menu (header-menu.js).
document.addEventListener("DOMContentLoaded", function () {
    const $ = (id) => document.getElementById(id);
    const actions = window.CbcSettingsActions;

    $("setBackup").addEventListener("click", () => exportAllDataAsFile());

    $("setRestore").addEventListener("click", () => $("setRestoreFile").click());
    $("setRestoreFile").addEventListener("change", () => {
        actions.restoreFile($("setRestoreFile").files[0], () => { $("setRestoreFile").value = ""; });
    });
    $("setReset").addEventListener("click", () => actions.factoryReset());

    function showTheme() {
        const dark = window.CashbookTheme && window.CashbookTheme.get() === "dark";
        $("setThemeLabel").textContent = dark ? "Dark Mode" : "Light Mode";
        $("setTheme").classList.toggle("on", Boolean(dark));
        $("setTheme").setAttribute("aria-checked", dark ? "true" : "false");
    }
    $("setTheme").addEventListener("click", () => { if (window.CashbookTheme) window.CashbookTheme.toggle(); showTheme(); });
    showTheme();
});
