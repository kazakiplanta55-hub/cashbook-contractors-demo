"use strict";

document.addEventListener("DOMContentLoaded", function () {
    var host = document.querySelector(".topbar");
    if (!host) {
        return;
    }

    var CONTACT_EMAIL = "Rosenitoplanta24@gmail.com";

    var wrapper = document.createElement("div");
    wrapper.className = "header-menu";

    var button = document.createElement("button");
    button.type = "button";
    button.className = "header-menu-button";
    button.setAttribute("aria-haspopup", "true");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", "Settings");
    button.title = "Settings";
    button.textContent = "\u2699\uFE0F";

    var panel = document.createElement("div");
    panel.className = "header-menu-panel";
    panel.setAttribute("role", "menu");

    var backupItem = document.createElement("button");
    backupItem.type = "button";
    backupItem.className = "header-menu-item";
    backupItem.setAttribute("role", "menuitem");
    backupItem.innerHTML = '<span class="header-menu-icon">\uD83D\uDCBE</span><span>Export Backup File</span>';
    backupItem.addEventListener("click", function () {
        exportAllDataAsFile();
        closePanel();
    });

    var restoreItem = document.createElement("button");
    restoreItem.type = "button";
    restoreItem.className = "header-menu-item";
    restoreItem.setAttribute("role", "menuitem");
    restoreItem.innerHTML = '<span class="header-menu-icon">\u267B\uFE0F</span><span>Restore Exported Backup</span>';

    var restoreInput = document.createElement("input");
    restoreInput.type = "file";
    restoreInput.accept = "application/json";
    restoreInput.style.display = "none";

    restoreItem.addEventListener("click", function () {
        restoreInput.click();
    });

    // Shared with the Settings page (window.CbcSettingsActions) so there is only one copy of this flow.
    async function handleRestoreFile(file, done) {
        if (!file) return;

        var confirmed = await window.CashbookDialogs.confirm(
            "Restoring a backup will replace all current clients and projects in this app. Continue?"
            , { title: "Restore backup", confirmText: "Restore", danger: true }
        );
        if (!confirmed) {
            if (done) done();
            return;
        }

        restoreAllDataFromFile(file, async function (success, message) {
            await window.CashbookDialogs.alert(message, { title: success ? "Restore completed" : "Restore failed" });
            if (success) {
                window.location.reload();
            }
            if (done) done();
        });
    }

    restoreInput.addEventListener("change", function () {
        handleRestoreFile(restoreInput.files[0], function () { restoreInput.value = ""; });
    });

    var printItem = document.createElement("button");
    printItem.type = "button";
    printItem.className = "header-menu-item";
    printItem.setAttribute("role", "menuitem");
    printItem.innerHTML = '<span class="header-menu-icon">\uD83D\uDDA8\uFE0F</span><span>Print</span>';
    printItem.addEventListener("click", function () {
        closePanel();
        const preview = window.CashbookPrintPreviewV3 || window.CashbookPrintPreview;
        if (preview) preview.open();
    });

    var activityLogItem = document.createElement("button");
    activityLogItem.type = "button";
    activityLogItem.className = "header-menu-item";
    activityLogItem.setAttribute("role", "menuitem");
    activityLogItem.innerHTML = '<span class="header-menu-icon">\uD83D\uDCCB</span><span>Activity Log</span>';
    activityLogItem.addEventListener("click", function () {
        closePanel();
        // If the current page is a specific project (most project sub-pages
        // carry ?id=), jump straight to that project's log. Otherwise land
        // on the picker so the user can choose one.
        var currentId = new URLSearchParams(window.location.search).get("id");
        var target = "../activity-log/activity-log.html";
        if (currentId && !window.location.pathname.includes("/activity-log/")) {
            target += "?id=" + encodeURIComponent(currentId);
        }
        window.location.href = target;
    });

    var divider1 = document.createElement("div");
    divider1.className = "header-menu-divider";

    var themeRow = document.createElement("div");
    themeRow.className = "header-menu-theme-row";

    var themeLabel = document.createElement("span");

    var themeSwitch = document.createElement("button");
    themeSwitch.type = "button";
    themeSwitch.className = "theme-switch";
    themeSwitch.setAttribute("role", "switch");
    themeSwitch.setAttribute("aria-label", "Toggle dark mode");

    function refreshThemeUI() {
        var isDark = window.CashbookTheme && window.CashbookTheme.get() === "dark";
        themeLabel.textContent = isDark ? "Dark Mode" : "Light Mode";
        themeSwitch.classList.toggle("on", !!isDark);
        themeSwitch.setAttribute("aria-checked", isDark ? "true" : "false");
    }

    themeSwitch.addEventListener("click", function () {
        if (window.CashbookTheme) {
            window.CashbookTheme.toggle();
        }
        refreshThemeUI();
    });

    themeRow.appendChild(themeLabel);
    themeRow.appendChild(themeSwitch);

    var divider2 = document.createElement("div");
    divider2.className = "header-menu-divider";

    var contact = document.createElement("div");
    contact.className = "header-menu-contact";
    contact.innerHTML =
        '<div style="margin-bottom:6px;"><span class="header-menu-icon">\u2709\uFE0F</span> Contact Me</div>' +
        '<a href="mailto:' + CONTACT_EMAIL + '">' + CONTACT_EMAIL + "</a>";

    var divider3 = document.createElement("div");
    divider3.className = "header-menu-divider";

    var factoryResetItem = document.createElement("button");
    factoryResetItem.type = "button";
    factoryResetItem.className = "header-menu-item danger";
    factoryResetItem.setAttribute("role", "menuitem");
    factoryResetItem.innerHTML = '<span class="header-menu-icon">\u26A0\uFE0F</span><span>Factory Reset</span>';
    factoryResetItem.addEventListener("click", function () {
        closePanel();
        handleFactoryReset();
    });

    async function handleFactoryReset() {
        var step1 = await window.CashbookDialogs.confirm(
            "This permanently deletes every client, project, financial record, HR 201 file and scanned document in this app. " +
                "A backup file is saved to your Downloads folder first, and nothing is erased until you confirm that it was saved. " +
                "Automatic restore points stay in the app's data folder on this computer. Continue?",
            { title: "Factory Reset", confirmText: "Continue", danger: true }
        );
        if (!step1) return;

        var typed = await window.CashbookDialogs.prompt(
            'Type RESET (all caps) to confirm. This is your last chance to back out.',
            "",
            { title: "Confirm Factory Reset", confirmText: "Erase Everything", danger: true }
        );
        if (typed === false) return;
        if (typed !== "RESET") {
            await window.CashbookDialogs.alert('That didn\'t match "RESET", so nothing was deleted.', { title: "Factory Reset Cancelled" });
            return;
        }

        // 1) Automatic backup first -- downloads a JSON file and, when the
        // desktop storage bridge is available, also drops a timestamped
        // on-disk backup copy.
        const backup = exportAllDataAsFile();
        if (!backup.internalBackupOk) {
            await window.CashbookDialogs.alert(
                "The safety copy on this computer could not be saved, so nothing was erased. Use Export Backup File, check that it saved, and try again.",
                { title: "Factory Reset stopped" }
            );
            return;
        }
        const saved = await window.CashbookDialogs.confirm(
            "The backup file " + backup.fileName + " should now be in your Downloads folder. Open the folder and check that it is there. " +
                "Erase everything only if you can see it.",
            { title: "Is the backup saved?", confirmText: "Yes, erase everything", cancelText: "Stop, do not erase", danger: true }
        );
        if (!saved) return;

        // 2) Wipe through the same read/write path the rest of the app
        // uses (writeJson), so this is correctly persisted whether running
        // through the storage bridge or the browser localStorage fallback.
        writeJson(CLIENTS_KEY, []);
        allDocumentIds().forEach(deleteDocumentFile);
        writeJson(PROJECTS_KEY, []);
        writeJson(COMPANY_201_KEY, []);
        writeJson(SELECTED_CLIENT_KEY, null);
        writeJson(SELECTED_PROJECT_KEY, null);

        // 3) Clear UI-only preferences too, for a genuine fresh-install feel.
        localStorage.removeItem("contractors_theme");
        localStorage.removeItem("cbc_dashboard_client_filter");
        localStorage.removeItem("cbc_dashboard_project_filter");

        await window.CashbookDialogs.alert(
            "All data has been erased. Keep the backup file safe: it is the only copy that includes scanned HR documents. The app will now return to the Dashboard.",
            { title: "Factory Reset Complete" }
        );
        window.location.href = "../dashboard/dashboard.html";
    }

    window.CbcSettingsActions = { restoreFile: handleRestoreFile, factoryReset: handleFactoryReset };

    // Export Backup, Restore, Factory Reset and Contact live only under NAV > Tools > Settings.
    // Their code stays in this file because the Settings page shares it (window.CbcSettingsActions).
    panel.appendChild(printItem);
    panel.appendChild(activityLogItem);
    panel.appendChild(divider1);
    panel.appendChild(themeRow);

    wrapper.appendChild(button);
    wrapper.appendChild(panel);
    host.appendChild(wrapper);

    function closePanel() {
        panel.classList.remove("open");
        button.setAttribute("aria-expanded", "false");
    }

    function togglePanel(event) {
        event.stopPropagation();
        var isOpen = panel.classList.toggle("open");
        button.setAttribute("aria-expanded", isOpen ? "true" : "false");
        if (isOpen) {
            refreshThemeUI();
        }
    }

    button.addEventListener("click", togglePanel);
    document.addEventListener("click", function (event) {
        if (!wrapper.contains(event.target)) {
            closePanel();
        }
    });
    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
            closePanel();
        }
    });

    refreshThemeUI();
});
