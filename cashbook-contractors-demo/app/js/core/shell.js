"use strict";

// Shared persistent navigation shell: one sidebar, header, and status
// bar on every page, so switching sections never requires backtracking
// through the Project hub first. Same look/behavior as Cashbook for
// Business's shell, adapted for Contractors' separate-HTML-page
// architecture (project context travels via a ?id= query param
// instead of a shared iframe host).
(function () {
    if (document.querySelector(".cbc-sidebar")) return;

    const path = location.pathname.replaceAll("\\", "/");
    const query = new URLSearchParams(location.search);
    const WS_KEY = "cbc.workspace";
    try { if (typeof ensureProjectCodes === "function") ensureProjectCodes(); } catch (e) { /* codes are saved on the next page */ }
    let ws = null;
    try { ws = JSON.parse(sessionStorage.getItem(WS_KEY) || "null"); } catch (e) { ws = null; }

    // Match only the page's own folder (pages/<folder>/<file>.html), never the install path:
    // a parent folder such as ".../project-files/" must not turn every page into a project page.
    const PROJECT_PAGE_DIRS = ["project-detail", "project-income-expense", "project-materials", "project-payroll", "project-progress", "project-cheques", "project-scurve", "project-201"];
    // Shared pages are master pages normally, but they stay INSIDE the workspace when they are opened
    // for the very project the workspace belongs to (Activity Log, and Edit project details).
    const SHARED_PAGE_DIRS = ["activity-log", "projects"];
    const pageDir = path.split("/").filter(Boolean).slice(-2, -1)[0] || "";
    const isProjectPage = PROJECT_PAGE_DIRS.includes(pageDir);
    const sharedId = query.get("id") || (pageDir === "projects" ? query.get("edit") : "") || "";
    const isSharedWorkspacePage = SHARED_PAGE_DIRS.includes(pageDir) && Boolean(ws) && Boolean(sharedId) &&
        ws.projectId === sharedId && typeof getProjectById === "function" && Boolean(getProjectById(sharedId));
    const inWorkspace = isProjectPage || isSharedWorkspacePage;
    const projectId = query.get("id") || (isSharedWorkspacePage ? sharedId : "");
    const withId = (url) => (projectId ? `${url}?id=${encodeURIComponent(projectId)}` : url);
    const isActive = (url) => path.endsWith(url.replace(/^\.\.\//, "/"));

    let project = null;
    let client = null;
    if (projectId && typeof getProjectById === "function") {
        project = getProjectById(projectId);
        if (project && typeof getClientById === "function") client = getClientById(project.clientId);
    }

    // Workspace guard: project pages open only inside a workspace for that exact project, and a workspace is
    // started from the client's Client Portal. Anyone arriving without one (an old bookmark, a link from a
    // master page) is sent to that client's portal, or to the portal login when the project is unknown.
    // Every other (master) page ends the workspace, except the shared pages described above.
    if (isProjectPage) {
        if (!project || !ws || ws.projectId !== projectId) {
            location.replace(window.CbcWorkspaceCore ? window.CbcWorkspaceCore.portalLink(project) : "../client-portal/client-portal.html");
            return;
        }
    } else if (!isSharedWorkspacePage) {
        try { sessionStorage.removeItem(WS_KEY); } catch (e) { /* ignore */ }
    }

    const allProjects = typeof loadProjects === "function" ? loadProjects() : [];

    const projectSection = project ? [
        "Current Project",
        [
            ["Project Overview", withId("../project-detail/project-detail.html")],
            ["Income & Expenses", withId("../project-income-expense/income-expense.html")],
            ["Materials & Procurement", withId("../project-materials/materials.html")],
            ["Payroll", withId("../project-payroll/payroll.html")],
            ["Project 201 Files", withId("../project-201/project-201.html")],
            ["Progress & Timeline", withId("../project-progress/progress.html")],
            ["S-Curve & Forecast", withId("../project-scurve/scurve.html")],
            ["Cheque Register", withId("../project-cheques/cheques.html")],
        ],
    ] : null;

    const renderSection = ([group, links]) =>
        `<section><strong>${escapeText(group)}</strong>${links
            .map(([label, url]) => `<a href="${url}" class="${isActive(url.split("?")[0]) || (url.includes("client-portal.html") && path.endsWith("/client-status/client-status.html")) ? "active" : ""}">${escapeText(label)}</a>`)
            .join("")}</section>`;

    const sidebar = document.createElement("aside");
    sidebar.className = "cbc-sidebar";
    const masterSections = [
        ["Overview", [["Dashboard", "../dashboard/dashboard.html"], ["Portfolio", "../portfolio/portfolio.html"]]],
        ["Records", [["Master Data", "../master-data/master-data.html"], ["Client Portal", "../client-portal/client-portal.html"], ["Human Resources", "../hr/hr.html"]]],
        ["Tools", [["Settings", "../settings/settings.html"], ["Data Transfer", "../transfer/transfer.html"], ["User Guide", "../guide/guide.html"], ["About", "../about/about.html"]]],
    ];
    sidebar.innerHTML =
        `<div class="cbc-sidebar-brand"><img src="../../assets/logo/logo.png" alt=""><span>Cashbook<br><small>for Contractors</small></span></div>` +
        `<nav>${masterSections.map(renderSection).join("")}</nav>`;
    document.body.prepend(sidebar);

    if (inWorkspace && client && window.CbcWorkspaceCore) {
        const hue = [...String(client.clientName)].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 360;
        const brandColor = /^#[0-9a-f]{6}$/i.test(client.brandColor || "") ? client.brandColor : "";
        const fg = brandColor && window.CbcBrand ? window.CbcBrand.readableText(brandColor) : "#fff";
        const cardStyle = brandColor ? `background:${brandColor};color:${fg};border-left-color:rgba(0,0,0,.25)` : `--ws-hue:${hue}`;
        // The client's logo heads the card; a client without a logo gets an initials badge instead.
        const initials = String(client.clientName || "?").split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase() || "?";
        const logoImg = /^data:image\//.test(client.logo || "")
            ? `<img class="cbc-ws-logo" src="${escapeText(client.logo)}" alt="${escapeText(client.clientName)} logo">`
            : `<div class="cbc-ws-initials" aria-hidden="true">${escapeText(initials)}</div>`;
        sidebar.innerHTML =
            `<div class="cbc-sidebar-brand"><img src="../../assets/logo/logo.png" alt=""><span>Cashbook<br><small>for Contractors</small></span></div>` +
            `<div class="cbc-workspace-card" style="${cardStyle}">${logoImg}<small>Working in</small><strong>${escapeText(client.clientName)}</strong>` +
            `<span>${escapeText(project.projectName)}</span><code>${escapeText(window.CbcWorkspaceCore.projectCode(project, allProjects))}</code>` +
            // Close Project ends the workspace and returns to where the person signed in from.
            `<a href="${ws && ws.from === "portal" ? "../client-portal/client-portal.html" : "../dashboard/dashboard.html"}" class="cbc-ws-exit" id="cbcWsLogout">Close Project</a></div>` +
            `<nav>${renderSection(projectSection)}</nav>`;
    }

    // Keep the sidebar's scroll position between pages, so a long project menu does not snap back to the top
    // every time a page changes.
    const NAV_SCROLL_KEY = "cbc.navScroll";
    try { sidebar.scrollTop = Number(sessionStorage.getItem(NAV_SCROLL_KEY)) || 0; } catch (e) { /* ignore */ }
    const saveNavScroll = () => { try { sessionStorage.setItem(NAV_SCROLL_KEY, String(sidebar.scrollTop)); } catch (e) { /* ignore */ } };
    sidebar.addEventListener("scroll", saveNavScroll, { passive: true });
    sidebar.addEventListener("click", saveNavScroll);

    const logoutLink = document.getElementById("cbcWsLogout");
    if (logoutLink) logoutLink.addEventListener("click", () => { try { sessionStorage.removeItem(WS_KEY); } catch (e) { /* ignore */ } });

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "cbc-nav-toggle";
    toggle.setAttribute("aria-label", "Collapse navigation");
    toggle.textContent = "\u2630";
    toggle.addEventListener("click", () => { if (window.CashbookNav) window.CashbookNav.toggle(); else document.documentElement.classList.toggle("cbc-nav-collapsed"); });
    document.body.appendChild(toggle);

    const header = document.createElement("header");
    header.className = "cbc-global-header";
    const subtitle = project ? `${project.projectName}${client ? " \u00B7 " + client.clientName : ""}` : "Contractor Workspace";
    header.innerHTML = `<div><strong>Cashbook for Contractors</strong><span>${escapeText(subtitle)}</span></div><span id="cbcClock"></span>`;
    document.body.appendChild(header);

    // Inside a project workspace the page's own heading used to show the client or project name. The title bar now
    // names the page (the project and client are already in the header above and the workspace card), so every
    // page reads the same way. css/design-system.css shows this attribute as the heading.
    const pageBrand = document.querySelector(".topbar .brand");
    const activeLink = document.querySelector(".cbc-sidebar nav a.active");
    if (pageBrand && inWorkspace && activeLink) pageBrand.setAttribute("data-page-title", activeLink.textContent.trim());

    const status = document.createElement("footer");
    status.className = "cbc-status-bar";
    const clientCount = typeof loadClients === "function" ? loadClients().filter((c) => !c.archivedAt).length : 0;
    const projectCount = typeof loadProjects === "function" ? loadProjects().filter((p) => !p.archivedAt).length : 0;
    status.innerHTML = `<span>Beta 1.9</span><span>${clientCount} client${clientCount === 1 ? "" : "s"}</span><span>${projectCount} active project${projectCount === 1 ? "" : "s"}</span><span class="ready">Ready</span>`;
    document.body.appendChild(status);

    function tick() {
        const now = new Date();
        const clock = document.getElementById("cbcClock");
        if (clock) clock.textContent = `${now.toLocaleDateString("en-PH", { weekday: "short", year: "numeric", month: "short", day: "numeric" })} \u00B7 ${now.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })}`;
    }
    tick();
    const timer = setInterval(tick, 30000);
    addEventListener("beforeunload", () => clearInterval(timer), { once: true });

    function escapeText(value) {
        return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
    }
})();
