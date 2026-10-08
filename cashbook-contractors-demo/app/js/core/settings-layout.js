"use strict";
// Section switching for the Adobe-style settings layout (Settings and Transfer).
// Every panel stays in the page; only the selected one is shown, so each
// control keeps its id and its existing script keeps working.
(function () {
    const root = document.querySelector(".aset");
    if (!root) return;
    const tabs = Array.from(root.querySelectorAll(".aset-tab"));
    const panels = Array.from(root.querySelectorAll(".aset-panel"));

    function show(id, focus) {
        const target = panels.find((panel) => panel.id === id) || panels[0];
        panels.forEach((panel) => { panel.hidden = panel !== target; });
        tabs.forEach((tab) => {
            const on = tab.dataset.panel === target.id;
            tab.classList.toggle("active", on);
            if (on) tab.setAttribute("aria-current", "page"); else tab.removeAttribute("aria-current");
            if (on && focus) tab.focus();
        });
    }

    tabs.forEach((tab, index) => {
        tab.addEventListener("click", () => {
            show(tab.dataset.panel);
            history.replaceState(null, "", "#" + tab.dataset.panel);
        });
        tab.addEventListener("keydown", (event) => {
            const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
            if (!step) return;
            event.preventDefault();
            const next = tabs[(index + step + tabs.length) % tabs.length];
            show(next.dataset.panel, true);
        });
    });

    show(location.hash.replace("#", ""));
})();
