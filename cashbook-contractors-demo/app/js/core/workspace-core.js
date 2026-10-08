"use strict";
(function (root) {
    const alnum = (s) => String(s || "").replace(/[^a-z0-9]/gi, "").toUpperCase();

    // Client code: a saved userName if there is one, otherwise the first 10 letters/digits of the client name.
    function clientCode(client) {
        return (client.userName ? alnum(client.userName) : alnum(client.clientName).slice(0, 10)) || "CLIENT";
    }

    // Project code: a saved projectCode if there is one, otherwise PRJ-<start year>-<running number>.
    function projectCode(project, allProjects) {
        if (project.projectCode) return String(project.projectCode).trim().toUpperCase();
        // Oldest first; records without a created date keep their saved order (the sort is stable).
        const sorted = [...(allProjects || [project])].sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
        const n = sorted.findIndex((p) => p.id === project.id) + 1;
        const year = String(project.startDate || project.createdAt || "").slice(0, 4) || "0000";
        return `PRJ-${year}-${String(n).padStart(3, "0")}`;
    }

    // Where a project is opened from. Project pages only open inside a client workspace, and a workspace
    // starts in that client's Client Portal, so every master page (Dashboard, lists) links here.
    // The page names are all one folder deep (pages/<folder>/<file>.html), so the relative link works from any of them.
    function portalLink(project) {
        if (!project || !project.clientId) return "../client-portal/client-portal.html";
        const id = encodeURIComponent;
        return `../client-status/client-status.html?client=${id(project.clientId)}&tab=projects${project.id ? `&project=${id(project.id)}` : ""}`;
    }

    const api = { alnum, clientCode, projectCode, portalLink };
    if (typeof module !== "undefined" && module.exports) module.exports = api; else root.CbcWorkspaceCore = api;
})(typeof window !== "undefined" ? window : globalThis);
