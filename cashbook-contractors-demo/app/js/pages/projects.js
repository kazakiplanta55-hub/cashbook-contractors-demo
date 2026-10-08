"use strict";

(function () {
    // Inside a client workspace ("Edit project details" from the project page) this page shows and
    // edits only that one project, then returns to it, so the workspace is never lost.
    const wsProjectId = (() => {
        try {
            const ws = JSON.parse(sessionStorage.getItem("cbc.workspace") || "null");
            const edit = new URLSearchParams(window.location.search).get("edit");
            return ws && edit && ws.projectId === edit ? edit : "";
        } catch (e) { return ""; }
    })();
    const backToWorkspaceProject = () => {
        window.location.href = "../project-detail/project-detail.html?id=" + encodeURIComponent(wsProjectId);
    };

    function get(selector) {
        return document.querySelector(selector);
    }

    function escapeHtml(value) {
        const div = document.createElement("div");
        div.textContent = String(value ?? "");
        return div.innerHTML;
    }

    function populateClientSelect() {
        const clients = loadClients().filter((client) => !client.archivedAt);
        const select = get("#clientId");

        if (clients.length === 0) {
            select.innerHTML = `<option value="">No clients yet — add one first</option>`;
            get("#projectForm").querySelector(
                "button[type=submit]"
            ).disabled = true;
            return;
        }

        select.innerHTML =
            `<option value="">Select client</option>` +
            clients
                .map((client) => {
                    return `<option value="${client.id}">${escapeHtml(
                        client.clientName
                    )}${
                        client.businessName
                            ? " — " + escapeHtml(client.businessName)
                            : ""
                    }</option>`;
                })
                .join("");
    }

    function statusClass(status) {
        if (status === "Completed") return "completed";
        if (status === "On Hold") return "on-hold";
        return "ongoing";
    }

    function resetForm() {
        get("#projectForm").reset();
        get("#projectId").value = "";
        get("#formTitle").textContent = "Add Project";
        get("#cancelEditButton").hidden = true;
        get("#formMessage").textContent = "";
        get("#startDate").value = getTodayValue();
    }

    function populateForm(project) {
        get("#projectId").value = project.id;
        get("#clientId").value = project.clientId;
        get("#projectName").value = project.projectName;
        get("#siteAddress").value = project.siteAddress;
        get("#budget").value = project.budget;
        get("#status").value = project.status;
        get("#startDate").value = project.startDate;
        get("#targetEndDate").value = project.targetEndDate;
        get("#notes").value = project.notes;
        get("#formTitle").textContent = "Edit Project";
        get("#cancelEditButton").hidden = false;
    }

    function projectTotals(project) {
        const income = sumMoney(project.incomeEntries || [], (entry) => entry.amount);
        const expense = sumMoney(project.expenseEntries || [], (entry) => entry.amount);
        return { income, expense };
    }

    function projectCardHtml(project, client) {
        const totals = projectTotals(project);
        const net = totals.income - totals.expense;

        return `
            <div class="project-card" data-project-id="${project.id}" style="cursor: pointer;">
                <div class="project-card-header">
                    <div>
                        <h3>${escapeHtml(project.projectName)}</h3>
                        <p>${escapeHtml(
                            client ? client.clientName : "Unknown client"
                        )} · Budget ${formatMoney(project.budget)}</p>
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span class="status-badge ${statusClass(
                            project.status
                        )}">${escapeHtml(project.status)}</span>
                        <button type="button" class="secondary-button edit-project" data-id="${project.id}">
                            Edit
                        </button>
                        ${wsProjectId ? "" : `<button type="button" class="secondary-button ${project.archivedAt ? "restore-project" : "archive-project"}" data-id="${project.id}">
                            ${project.archivedAt ? "Restore" : "Archive"}
                        </button>`}
                    </div>
                </div>

                <div class="progress-track">
                    <div class="progress-fill" style="width: ${
                        project.percentComplete
                    }%;"></div>
                </div>
                <div class="progress-label">
                    <span>${project.percentComplete}% complete</span>
                    <span>${formatDate(
                        project.startDate
                    )} → ${
            project.targetEndDate
                ? formatDate(project.targetEndDate)
                : "No target date"
        }</span>
                </div>

                <div class="project-meta">
                    <span>Income: ${formatMoney(totals.income)}</span>
                    <span>Expenses: ${formatMoney(totals.expense)}</span>
                    <span>Net: ${formatMoney(net)}</span>
                </div>
            </div>
        `;
    }

    function renderProjects() {
        const allProjects = wsProjectId ? loadProjects().filter((project) => project.id === wsProjectId) : loadProjects();
        const clients = loadClients();
        const statusValue = get("#statusFilter").value;

        const projects = statusValue === "Archived"
            ? allProjects.filter((project) => project.archivedAt)
            : allProjects.filter((project) => !project.archivedAt && (statusValue === "all" || project.status === statusValue));

        get("#projectEmptyState").hidden = projects.length > 0;

        const openGroups = new Set(
            Array.from(
                document.querySelectorAll(".client-group.open")
            ).map((el) => el.dataset.clientId)
        );

        const groups = clients
            .map((client) => {
                return {
                    client,
                    projects: projects.filter(
                        (project) => project.clientId === client.id
                    ),
                };
            })
            .filter((group) => group.projects.length > 0);

        const unassigned = projects.filter((project) => {
            return !clients.some(
                (client) => client.id === project.clientId
            );
        });

        if (unassigned.length > 0) {
            groups.push({ client: null, projects: unassigned });
        }

        get("#projectList").innerHTML = groups
            .map((group) => {
                const clientId = group.client
                    ? group.client.id
                    : "unassigned";
                const isOpen =
                    openGroups.has(clientId) || openGroups.size === 0;

                const totalBudget = group.projects.reduce(
                    (sum, project) => sum + money(project.budget),
                    0
                );

                return `
                    <div class="client-group ${
                        isOpen ? "open" : ""
                    }" data-client-id="${clientId}">
                        <div class="client-group-header">
                            <div>
                                <h3>${escapeHtml(
                                    group.client
                                        ? group.client.clientName
                                        : "No Client Assigned"
                                )}</h3>
                                <p>${
                                    group.client &&
                                    group.client.businessName
                                        ? escapeHtml(
                                              group.client.businessName
                                          ) + " · "
                                        : ""
                                }Total Budget ${formatMoney(totalBudget)}</p>
                            </div>
                            <div class="client-group-meta">
                                <span class="client-group-count">${
                                    group.projects.length
                                } project${
                    group.projects.length === 1 ? "" : "s"
                }</span>
                                <span class="client-group-chevron">▼</span>
                            </div>
                        </div>
                        <div class="client-group-body">
                            ${group.projects
                                .map((project) =>
                                    projectCardHtml(project, group.client)
                                )
                                .join("")}
                        </div>
                    </div>
                `;
            })
            .join("");

        document.querySelectorAll(".client-group-header").forEach(
            (header) => {
                header.addEventListener("click", () => {
                    header.closest(".client-group").classList.toggle(
                        "open"
                    );
                });
            }
        );

        document.querySelectorAll(".project-card").forEach((card) => {
            card.addEventListener("click", (event) => {
                if (event.target.closest(".edit-project, .archive-project, .restore-project")) {
                    return;
                }
                window.location.href = window.CbcWorkspaceCore.portalLink(
                    getProjectById(card.dataset.projectId)
                );
            });
        });

        document.querySelectorAll(".edit-project").forEach((button) => {
            button.addEventListener("click", async (event) => {
                event.stopPropagation();
                const project = getProjectById(button.dataset.id);
                if (project) {
                    populateForm(project);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                }
            });
        });

        document.querySelectorAll(".archive-project").forEach((button) => {
            button.addEventListener("click", async (event) => {
                event.stopPropagation();

                const project = getProjectById(button.dataset.id);
                if (!project) {
                    return;
                }

                const confirmed = await window.CashbookDialogs.confirm(
                    `Archive "${project.projectName}"? Its records will be preserved and can be restored.`
                    , { title: "Archive project", confirmText: "Archive" });
                if (!confirmed) {
                    return;
                }

                archiveProject(button.dataset.id);
                renderProjects();
            });
        });

        document.querySelectorAll(".restore-project").forEach((button) => {
            button.addEventListener("click", (event) => {
                event.stopPropagation();
                restoreProject(button.dataset.id);
                renderProjects();
            });
        });
    }

    get("#statusFilter").addEventListener("change", renderProjects);

    get("#projectForm").addEventListener("submit", (event) => {
        event.preventDefault();

        const clientId = get("#clientId").value;
        const projectName = get("#projectName").value.trim();
        const budget = get("#budget").value;
        const startDate = get("#startDate").value;

        if (!clientId || !projectName || money(budget) <= 0 || !startDate) {
            get("#formMessage").textContent =
                "Client, project name, budget, and start date are required.";
            return;
        }

        const targetEndDate = get("#targetEndDate").value;
        if (targetEndDate && targetEndDate < startDate) {
            get("#formMessage").textContent = "Target end date cannot be earlier than the start date.";
            return;
        }

        const existingId = get("#projectId").value;
        const existing = existingId
            ? getProjectById(existingId)
            : null;
        const duplicateName = loadProjects().find((item) => !item.archivedAt && item.id !== existingId && item.clientId === clientId && String(item.projectName || "").toLowerCase() === projectName.toLowerCase());
        if (duplicateName) {
            get("#formMessage").textContent = "This client already has an active project with that name.";
            return;
        }

        const project = {
            ...(existing || {}),
            id: existingId || undefined,
            clientId,
            projectName,
            siteAddress: get("#siteAddress").value.trim(),
            budget,
            status: get("#status").value,
            startDate,
            targetEndDate,
            percentComplete: existing ? existing.percentComplete : 0,
            notes: get("#notes").value.trim(),
        };

        appendProjectAudit(project, existing ? "UPDATE" : "CREATE", "project", project.id || "", `${existing ? "Updated" : "Created"} project ${projectName}`);
        upsertProject(project);
        if (wsProjectId) { backToWorkspaceProject(); return; }
        resetForm();
        renderProjects();
    });

    get("#cancelEditButton").addEventListener("click", () => { if (wsProjectId) backToWorkspaceProject(); else resetForm(); });

    populateClientSelect();
    resetForm();
    renderProjects();

    const editId = new URLSearchParams(window.location.search).get(
        "edit"
    );
    if (editId) {
        const projectToEdit = getProjectById(editId);
        if (projectToEdit) {
            populateForm(projectToEdit);
            if (wsProjectId) get("#clientId").disabled = true; // a workspace project cannot be moved to another client
            window.scrollTo({ top: 0, behavior: "smooth" });
        }
    }
})();
