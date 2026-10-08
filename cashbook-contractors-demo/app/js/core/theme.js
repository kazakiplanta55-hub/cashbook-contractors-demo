"use strict";

(function () {
    var THEME_KEY = "contractors_theme";

    function apply(theme) {
        if (theme === "dark") {
            document.documentElement.setAttribute("data-theme", "dark");
        } else {
            document.documentElement.removeAttribute("data-theme");
        }
    }

    var saved = "light";
    try {
        saved = localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
    } catch (error) {
        saved = "light";
    }
    apply(saved);

    // Remember whether the sidebar was collapsed, applied before the first paint so every page opens the same way.
    var NAV_KEY = "contractors_nav_collapsed";
    try {
        if (localStorage.getItem(NAV_KEY) === "1") document.documentElement.classList.add("cbc-nav-collapsed");
    } catch (error) { /* ignore storage errors */ }
    window.CashbookNav = {
        toggle: function () {
            var collapsed = document.documentElement.classList.toggle("cbc-nav-collapsed");
            try { localStorage.setItem(NAV_KEY, collapsed ? "1" : "0"); } catch (error) { /* ignore */ }
            return collapsed;
        },
    };

    window.CashbookTheme = {
        get: function () {
            return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
        },
        set: function (theme) {
            var next = theme === "dark" ? "dark" : "light";
            apply(next);
            try {
                localStorage.setItem(THEME_KEY, next);
            } catch (error) {
                /* ignore storage errors */
            }
            return next;
        },
        toggle: function () {
            return window.CashbookTheme.set(
                window.CashbookTheme.get() === "dark" ? "light" : "dark"
            );
        },
    };
})();
