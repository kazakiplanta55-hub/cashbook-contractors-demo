"use strict";

(function () {
    function get(selector) {
        return document.querySelector(selector);
    }

    function escapeHtml(value) {
        const div = document.createElement("div");
        div.textContent = String(value ?? "");
        return div.innerHTML;
    }

    const params = new URLSearchParams(window.location.search);
    const projectId = params.get("id");

    if (!projectId) {
        renderProjectPicker();
        return;
    }

    const project = getProjectById(projectId);
    if (!project) {
        get("#projectPickerSection").hidden = true;
        get("#activityLogSection").hidden = true;
        get("#notFoundState").hidden = false;
        return;
    }

    renderActivityLog(project);

    // --------------------------------------

    function renderProjectPicker() {
        const clients = loadClients();
        const projects = loadProjects()
            .filter((item) => !item.archivedAt)
            .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

        get("#projectPickerSection").hidden = false;
        get("#projectPickerEmpty").hidden = projects.length > 0;

        get("#projectPickerList").innerHTML = projects
            .map((item) => {
                const client = clients.find((entry) => entry.id === item.clientId);
                return `
                    <a href="?id=${item.id}" class="due-item" style="text-decoration:none; color:inherit; cursor:pointer;">
                        <div class="due-item-info">
                            <h4>${escapeHtml(item.projectName)}</h4>
                            <p>${escapeHtml(client ? client.clientName : "Unknown client")}</p>
                        </div>
                        <div class="due-item-amount">
                            <span>${escapeHtml(item.status)}</span>
                        </div>
                    </a>
                `;
            })
            .join("");
    }

    function currentEntityIds(project) {
        const ids = new Set([`project:${project.id}`, `progress:${project.id}`, `materials-budget:${project.id}`]);
        const add = (type, records) => (records || []).forEach((record) => {
            if (record?.id) ids.add(`${type}:${record.id}`);
        });
        add("material", project.materialEntries);
        add("payroll", project.payrollEntries);
        add("cheque", project.chequeEntries);
        add("role", project.roles);
        add("worker", project.workers);
        add("manual", [...(project.incomeEntries || []), ...(project.expenseEntries || [])]);
        (project.programsOfWork || []).forEach((program) => {
            if (program.id) ids.add(`program:${program.id}`);
            add("program-item", program.items);
        });
        return ids;
    }

    function recentCurrentActivity(project) {
        const currentIds = currentEntityIds(project);
        const latestByEntity = new Map();
        [...(project.auditTrail || [])]
            .sort((a, b) => new Date(b.at) - new Date(a.at))
            .forEach((entry, index) => {
                if (entry.action === "DELETE") return;
                const type = entry.entityType || "activity";
                const entityId = entry.entityId || `unidentified-${index}`;
                const key = `${type}:${entityId}`;
                const requiresCurrentRecord = ["material", "payroll", "cheque", "role", "worker", "manual", "program", "program-item"].includes(type);
                if (requiresCurrentRecord && !currentIds.has(key)) return;
                if (!latestByEntity.has(key)) latestByEntity.set(key, entry);
            });
        return [...latestByEntity.values()]
            .sort((a, b) => new Date(b.at) - new Date(a.at))
            .slice(0, 100);
    }

    function renderActivityLog(project) {
        get("#activityLogSection").hidden = false;
        get("#activityLogTitle").textContent = `Activity Log — ${project.projectName}`;
        // Inside a workspace for this project the link returns to the project; opened from a master page it
        // goes to the client's portal (the shell keeps the workspace session only for the project's own pages).
        let inWorkspace = false;
        try { inWorkspace = Boolean(sessionStorage.getItem("cbc.workspace")); } catch (e) { inWorkspace = false; }
        get("#backToProjectLink").href = inWorkspace
            ? `../project-detail/project-detail.html?id=${encodeURIComponent(project.id)}`
            : window.CbcWorkspaceCore.portalLink(project);

        const activity = recentCurrentActivity(project);
        get("#auditTrailEmpty").hidden = activity.length > 0;
        get("#auditTrailBody").innerHTML = activity
            .map(
                (entry) => `
                    <tr>
                        <td>${escapeHtml(new Date(entry.at).toLocaleString("en-PH"))}</td>
                        <td><strong>${escapeHtml(entry.action)}</strong></td>
                        <td>${escapeHtml(entry.entityType || "—")}</td>
                        <td>${escapeHtml(entry.summary || "—")}</td>
                    </tr>
                `
            )
            .join("");
    }
})();
