"use strict";
// Client Portal workspace. You get here by choosing a client on the Client Portal page.
// Everything on this page belongs to that ONE client: the client-facing Status view,
// the client's Profile (view and edit) and all of the client's Projects (add, edit,
// archive, and open a project's full workspace). Costs never appear on the Status tab.
(function () {
    const S = window.CbcProjectSummary, core = window.CbcWorkspaceCore, brand = window.CbcBrand;
    const $ = (s) => document.querySelector(s);
    const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const params = new URLSearchParams(location.search);
    const clientId = params.get("client") || "";
    const TABS = [["status", "Status"], ["profile", "Profile"], ["projects", "Projects"]];
    const WS_KEY = "cbc.workspace";
    const DEFAULT_COLOR = brand.DEFAULT;

    let tab = TABS.some(([key]) => key === params.get("tab")) ? params.get("tab") : "status";
    // Arriving from a project link (Due This Week ...): show that project on the Projects tab.
    let focusProject = params.get("project") || "";
    let editingProfile = false, showArchived = false, showArchivedInit = false;
    let logoChange; // undefined = unchanged, "" = removed, data URL = new logo
    let notice = "";

    const currentClient = () => {
        const client = getClientById(clientId);
        return client && !client.archivedAt ? client : null;
    };
    if (!currentClient()) { location.replace("../client-portal/client-portal.html"); return; }

    {
        const wanted = focusProject ? getProjectById(focusProject) : null;
        if (wanted && wanted.clientId === clientId) { tab = "projects"; if (wanted.archivedAt) showArchivedInit = true; }
        else focusProject = "";
    }

    const colorOf = (client) => (/^#[0-9a-f]{6}$/i.test(client.brandColor || "") ? client.brandColor : DEFAULT_COLOR);
    const initialsOf = (name) => String(name || "?").split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase() || "?";
    const statusClass = (s) => (s === "Completed" ? "completed" : s === "On Hold" ? "on-hold" : "ongoing");
    const peso = (n) => esc(formatMoney(n));
    const pctOf = (p) => Math.max(0, Math.min(100, Number(p.percentComplete) || 0));

    // ---- Head, tabs --------------------------------------------------------
    let headKey = "";
    function renderHead(client) {
        // The header is only redrawn when it changed: redrawing it on every tab switch reloads the logo and flickers.
        const key = [client.clientName, client.businessName, client.logo, client.brandColor, getTodayValue()].join("|");
        if (key === headKey) return;
        headKey = key;
        const color = colorOf(client);
        const root = $("#portalRoot");
        root.style.setProperty("--brand", color);
        root.style.setProperty("--brand-text", brand.readableText(color));
        const mark = /^data:image\//.test(client.logo || "") ? `<img class="pt-logo" src="${esc(client.logo)}" alt="">` : `<div class="pt-initials">${esc(initialsOf(client.clientName))}</div>`;
        $("#portalHead").innerHTML = `<div class="pt-head">${mark}<div><h2>${esc(client.clientName)}</h2><p>${esc(client.businessName || "")}</p><p>Project status as of ${esc(getTodayValue())}</p></div></div>`;
    }

    function renderTabs() {
        $("#portalTabs").innerHTML = TABS.map(([key, label]) =>
            `<button type="button" role="tab" id="tab-${key}" class="pt-tab${tab === key ? " active" : ""}" aria-selected="${tab === key}" data-tab="${key}">${label}</button>`).join("");
    }

    // ---- Status tab (client-facing: progress and payments only) -------------------
    function renderStatus(client, projects) {
        const group = S.groupByClient([client], projects, (p) => core.projectCode(p, projects), { keepEmpty: true })[0];
        const t = group.totals;
        const cards = [["Projects", String(group.projects.length)], ["Total project budget", formatMoney(t.budget)], ["Received to date", formatMoney(t.income)], ["Remaining", formatMoney(Math.max(t.remaining, 0))]]
            .map(([k, v]) => `<div class="pt-card"><small>${k}</small><strong>${esc(v)}</strong></div>`).join("");
        const list = group.projects.map(({ project: p, code, totals: x }) => {
            const pct = pctOf(p);
            return `<article class="pt-card pt-project"><h3>${esc(p.projectName)} <span class="pt-pill">${esc(p.status || "")}</span></h3>
                <div class="pt-meta"><span>Code: ${esc(code)}</span>${p.siteAddress ? `<span>Site: ${esc(p.siteAddress)}</span>` : ""}<span>Start: ${esc(p.startDate || "-")}</span><span>Target end: ${esc(p.targetEndDate || "-")}</span></div>
                <div class="pt-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
                <div class="pt-meta"><strong>${pct}% complete</strong><span>Budget: ${peso(x.budget)}</span><span>Received: ${peso(x.income)}</span><span>Remaining: ${peso(Math.max(x.remaining, 0))}</span></div></article>`;
        }).join("") || `<p class="empty-state">No projects for this client yet. Add one in the Projects tab.</p>`;
        return `<div class="ledger-toolbar pt-actions"><button type="button" class="secondary-button" data-action="print">Print status</button></div>
            <div class="pt-cards">${cards}</div>${list}
            <p class="pt-note">Remaining = project budget minus payments received. Progress is the percent complete recorded for each project.</p>`;
    }

    // ---- Profile tab (view and edit) -----------------------------------------
    function renderProfile(client) {
        if (!editingProfile) {
            const row = (label, value) => `<div class="pt-field"><small>${label}</small><span>${value ? esc(value) : "-"}</span></div>`;
            return `${notice ? `<p class="pt-notice" role="status">${esc(notice)}</p>` : ""}
                <section class="form-card pt-profile"><div class="pt-section-head"><h2>Client profile</h2>
                    <div><button type="button" class="primary-button" data-action="edit-profile">Edit profile</button>
                    <button type="button" class="secondary-button" data-action="archive-client">Archive client</button></div></div>
                <div class="pt-fields">${row("Client name", client.clientName)}${row("Business name", client.businessName)}${row("Contact number", client.contactNumber)}${row("Email", client.clientEmail)}
                    ${row("TIN", client.tin)}${row("Client code", core.clientCode(client))}${row("Address", client.clientAddress)}
                    <div class="pt-field"><small>Brand color</small><span><i class="pt-swatch" style="background:${esc(colorOf(client))}"></i>${esc(colorOf(client))}</span></div></div></section>`;
        }
        const hasLogo = /^data:image\//.test(client.logo || "");
        return `<section class="form-card"><h2>Edit client profile</h2>
            <form id="profileForm" autocomplete="off"><div class="form-grid">
                <label class="form-field"><span>Client Name *</span><input id="pfName" required value="${esc(client.clientName)}"></label>
                <label class="form-field"><span>Business Name</span><input id="pfBusiness" value="${esc(client.businessName || "")}"></label>
                <label class="form-field"><span>Contact Number</span><input id="pfContact" value="${esc(client.contactNumber || "")}"></label>
                <label class="form-field"><span>Email</span><input id="pfEmail" type="email" value="${esc(client.clientEmail || "")}"></label>
                <label class="form-field"><span>TIN (for Accountant Edition transfer)</span><input id="pfTin" value="${esc(client.tin || "")}" placeholder="000-000-000-000"></label>
                <label class="form-field"><span>Brand color</span><input id="pfColor" type="color" value="${esc(colorOf(client))}"></label>
                <label class="form-field" style="grid-column:1/-1"><span>Address</span><input id="pfAddress" value="${esc(client.clientAddress || "")}"></label>
                <label class="form-field"><span>Client logo (optional)</span><input id="pfLogo" type="file" accept="image/png,image/jpeg,image/webp"></label>
                <div class="form-field" id="pfLogoBox" ${hasLogo ? "" : "hidden"}><img id="pfLogoPreview" alt="" style="max-height:56px;max-width:160px" ${hasLogo ? `src="${esc(client.logo)}"` : ""}>
                    <button type="button" class="secondary-button" data-action="remove-logo">Remove Logo</button></div>
            </div>
            <div class="form-actions"><button type="submit" class="primary-button">Save changes</button><button type="button" class="secondary-button" data-action="cancel-profile">Cancel</button></div>
            <p id="pfMessage" class="pt-error" role="alert"></p></form></section>`;
    }

    function saveProfile() {
        const client = currentClient();
        const name = $("#pfName").value.trim(), tin = $("#pfTin").value.trim(), msg = $("#pfMessage");
        if (!name) { msg.textContent = "Client name is required."; return; }
        const others = loadClients().filter((c) => c.id !== client.id);
        if (others.some((c) => String(c.clientName || "").toLowerCase() === name.toLowerCase())) { msg.textContent = `A client named "${name}" already exists.`; return; }
        if (tin && others.some((c) => String(c.tin || "").toLowerCase() === tin.toLowerCase())) { msg.textContent = `TIN ${tin} is already used by another client.`; return; }
        const logo = logoChange === undefined ? (client.logo || "") : logoChange;
        const color = $("#pfColor").value;
        const updated = {
            ...client, clientName: name, businessName: $("#pfBusiness").value.trim(), contactNumber: $("#pfContact").value.trim(),
            clientEmail: $("#pfEmail").value.trim(), tin, clientAddress: $("#pfAddress").value.trim(), logo,
            brandColor: logo || color !== DEFAULT_COLOR ? color : "",
            auditTrail: [...(client.auditTrail || []), { id: createId(), at: new Date().toISOString(), action: "UPDATE", entityType: "client", entityId: client.id, summary: `Updated client profile ${name}` }].slice(-2000),
        };
        upsertClient(updated);
        editingProfile = false; logoChange = undefined; notice = "Profile saved.";
        render();
    }

    async function archiveThisClient() {
        const client = currentClient();
        const active = loadProjects().filter((p) => p.clientId === client.id && !p.archivedAt);
        if (active.length) {
            await window.CashbookDialogs.alert(`${client.clientName} still has ${active.length} project${active.length === 1 ? "" : "s"}. Archive those in the Projects tab first, then archive the client.`, { title: "Cannot archive yet" });
            return;
        }
        const ok = await window.CashbookDialogs.confirm(`Archive "${client.clientName}"? Their records are kept and can be restored later.`, { title: "Archive client", confirmText: "Archive" });
        if (!ok) return;
        archiveClient(client.id);
        location.href = "../client-portal/client-portal.html";
    }

    // ---- Projects tab -------------------------------------------------------
    function renderProjects(client, projects) {
        const group = S.groupByClient([client], projects, (p) => core.projectCode(p, projects), { keepEmpty: true, includeArchived: showArchived })[0];
        const rows = group.projects.map(({ project: p, code, totals: x }) => {
            const pct = pctOf(p), archived = Boolean(p.archivedAt);
            return `<tr data-project-row="${esc(p.id)}" class="${archived ? "pt-archived" : ""}${p.id === focusProject ? " pt-focus" : ""}"><td><strong>${esc(p.projectName)}</strong><br><small>${esc(code)}${p.siteAddress ? " · " + esc(p.siteAddress) : ""}</small></td>
                <td>${archived ? "Archived" : `<span class="pt-pill ${statusClass(p.status)}">${esc(p.status || "Ongoing")}</span>`}</td>
                <td><span class="pt-minibar"><span style="width:${pct}%"></span></span> ${pct}%</td>
                <td>${esc(p.startDate ? formatDate(p.startDate) : "-")}</td><td>${esc(p.targetEndDate ? formatDate(p.targetEndDate) : "-")}</td>
                <td class="num">${peso(x.budget)}</td><td class="num">${peso(x.income)}</td><td class="num">${peso(x.expense)}</td><td class="num${x.net < 0 ? " neg" : ""}">${peso(x.net)}</td>
                <td class="pt-row-actions">${archived
                    ? `<button type="button" class="secondary-button" data-action="restore-project" data-id="${esc(p.id)}">Restore</button>`
                    : `<button type="button" class="primary-button" data-action="open-project" data-id="${esc(p.id)}">Open</button>
                       <button type="button" class="secondary-button" data-action="edit-project" data-id="${esc(p.id)}">Edit</button>
                       <button type="button" class="secondary-button" data-action="archive-project" data-id="${esc(p.id)}">Archive</button>`}</td></tr>`;
        }).join("");
        return `<section class="form-card pt-projects"><div class="pt-section-head"><h2>Projects of ${esc(client.clientName)}</h2>
                <div><label class="pt-check"><input type="checkbox" id="showArchived" ${showArchived ? "checked" : ""}> Show archived</label>
                <button type="button" class="primary-button" data-action="add-project">+ Add project</button></div></div>
            ${group.projects.length ? `<div class="ledger-wrap"><table class="ledger-table"><thead><tr><th>Project</th><th>Status</th><th>Progress</th><th>Start</th><th>Target end</th><th class="num">Budget</th><th class="num">Received</th><th class="num">Expenses</th><th class="num">Net</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
            <p class="pt-note">Open takes you into the project's full workspace: income and expense, materials, payroll, progress and cheques.</p>`
                : `<p class="empty-state">No projects yet. Press "+ Add project" to create the first one for ${esc(client.clientName)}.</p>`}</section>`;
    }

    function openProject(id) {
        const project = getProjectById(id);
        if (!project || project.clientId !== clientId) return;
        sessionStorage.setItem(WS_KEY, JSON.stringify({ projectId: project.id, clientId, from: "portal" }));
        location.href = `../project-detail/project-detail.html?id=${encodeURIComponent(project.id)}`;
    }

    // ---- Add / edit project (pop-up form) -------------------------------------
    let modalOpener = null;
    function closeModal() {
        $("#portalModalHost").innerHTML = "";
        document.removeEventListener("keydown", modalKey, true);
        if (modalOpener && document.contains(modalOpener)) modalOpener.focus();
        modalOpener = null;
    }
    function modalKey(event) {
        if (event.key === "Escape") { event.stopPropagation(); closeModal(); }
    }
    function openProjectModal(project, trigger) {
        modalOpener = trigger || null;
        const p = project || { projectName: "", siteAddress: "", budget: "", status: "Ongoing", startDate: getTodayValue(), targetEndDate: "", notes: "" };
        const opt = (v) => `<option value="${v}"${p.status === v ? " selected" : ""}>${v}</option>`;
        $("#portalModalHost").innerHTML = `<div class="modal-overlay" id="pmOverlay"><div class="modal-card pt-modal" role="dialog" aria-modal="true" aria-labelledby="pmTitle">
            <h3 id="pmTitle">${project ? "Edit project" : "Add project"}</h3>
            <form id="projectForm" autocomplete="off"><div class="form-grid">
                <label class="form-field" style="grid-column:1/-1"><span>Project Name *</span><input id="pmName" required value="${esc(p.projectName)}"></label>
                <label class="form-field" style="grid-column:1/-1"><span>Site Address</span><input id="pmSite" value="${esc(p.siteAddress || "")}"></label>
                <label class="form-field"><span>Budget (₱) *</span><input id="pmBudget" type="number" min="0" step="0.01" required value="${esc(p.budget)}"></label>
                <label class="form-field"><span>Status</span><select id="pmStatus">${opt("Ongoing")}${opt("On Hold")}${opt("Completed")}</select></label>
                <label class="form-field"><span>Start Date *</span><input id="pmStart" type="date" required value="${esc(p.startDate || "")}"></label>
                <label class="form-field"><span>Target End Date</span><input id="pmEnd" type="date" value="${esc(p.targetEndDate || "")}"></label>
                <label class="form-field" style="grid-column:1/-1"><span>Notes</span><textarea id="pmNotes" rows="3">${esc(p.notes || "")}</textarea></label>
            </div>
            <p class="pt-error" id="pmMessage" role="alert"></p>
            <div class="form-actions"><button type="submit" class="primary-button">Save project</button><button type="button" class="secondary-button" data-action="close-modal">Cancel</button></div></form></div></div>`;
        document.addEventListener("keydown", modalKey, true);
        $("#pmOverlay").addEventListener("click", (event) => { if (event.target.id === "pmOverlay") closeModal(); });
        $("#projectForm").addEventListener("submit", (event) => { event.preventDefault(); saveProject(project); });
        $("#pmName").focus();
    }

    function saveProject(existing) {
        const msg = $("#pmMessage");
        const projectName = $("#pmName").value.trim(), budget = $("#pmBudget").value, startDate = $("#pmStart").value, targetEndDate = $("#pmEnd").value;
        if (!projectName || money(budget) <= 0 || !startDate) { msg.textContent = "Project name, budget, and start date are required."; return; }
        if (targetEndDate && targetEndDate < startDate) { msg.textContent = "Target end date cannot be earlier than the start date."; return; }
        const dup = loadProjects().find((i) => !i.archivedAt && (!existing || i.id !== existing.id) && i.clientId === clientId && String(i.projectName || "").toLowerCase() === projectName.toLowerCase());
        if (dup) { msg.textContent = "This client already has an active project with that name."; return; }
        const project = {
            ...(existing || {}), id: existing ? existing.id : createId(), clientId, projectName, siteAddress: $("#pmSite").value.trim(), budget,
            status: $("#pmStatus").value, startDate, targetEndDate, percentComplete: existing ? existing.percentComplete : 0, notes: $("#pmNotes").value.trim(),
        };
        appendProjectAudit(project, existing ? "UPDATE" : "CREATE", "project", project.id, `${existing ? "Updated" : "Created"} project ${projectName}`);
        upsertProject(project);
        closeModal();
        notice = "";
        render();
    }

    // ---- Wiring ------------------------------------------------------------
    function render() {
        const client = currentClient();
        if (!client) { location.replace("../client-portal/client-portal.html"); return; }
        const projects = loadProjects();
        document.body.dataset.tab = tab;
        renderHead(client);
        renderTabs();
        const panel = $("#portalPanel");
        panel.setAttribute("aria-labelledby", `tab-${tab}`);
        panel.innerHTML = tab === "profile" ? renderProfile(client) : tab === "projects" ? renderProjects(client, projects) : renderStatus(client, projects);
        if (tab === "profile" && editingProfile) {
            $("#profileForm").addEventListener("submit", (event) => { event.preventDefault(); saveProfile(); });
            $("#pfLogo").addEventListener("change", async (event) => {
                const file = event.target.files[0];
                if (!file) return;
                try {
                    const result = await brand.processLogo(file);
                    logoChange = result.dataUrl;
                    $("#pfColor").value = result.color;
                    $("#pfLogoPreview").src = result.dataUrl;
                    $("#pfLogoBox").hidden = false;
                } catch (error) { $("#pfMessage").textContent = error.message; }
            });
        }
        const archivedBox = $("#showArchived");
        if (archivedBox) archivedBox.addEventListener("change", () => { showArchived = archivedBox.checked; render(); });
        applyFocus();
    }

    // Bring the linked project into view and put the keyboard on its Open button, once.
    function applyFocus() {
        if (!focusProject || tab !== "projects") return;
        const row = [...document.querySelectorAll("[data-project-row]")].find((r) => r.dataset.projectRow === focusProject);
        focusProject = "";
        const url = new URL(location.href);
        url.searchParams.delete("project");
        history.replaceState(null, "", url);
        if (!row) return;
        if (row.scrollIntoView) row.scrollIntoView({ block: "center" });
        const open = row.querySelector('[data-action="open-project"]');
        if (open) open.focus();
    }

    function setTab(next) {
        if (next === tab) return;
        tab = next; editingProfile = false; logoChange = undefined; notice = "";
        const url = new URL(location.href);
        url.searchParams.set("tab", tab);
        history.replaceState(null, "", url);
        render();
    }

    document.addEventListener("click", async (event) => {
        const tabButton = event.target.closest("#portalTabs [data-tab]");
        if (tabButton) { setTab(tabButton.dataset.tab); return; }
        const el = event.target.closest("#portalRoot [data-action], #portalModalHost [data-action]");
        if (!el) return;
        const id = el.dataset.id;
        switch (el.dataset.action) {
            case "print": window.print(); break;
            case "edit-profile": editingProfile = true; notice = ""; render(); break;
            case "cancel-profile": editingProfile = false; logoChange = undefined; render(); break;
            case "remove-logo": logoChange = ""; $("#pfLogo").value = ""; $("#pfLogoBox").hidden = true; break;
            case "archive-client": await archiveThisClient(); break;
            case "add-project": openProjectModal(null, el); break;
            case "edit-project": { const p = getProjectById(id); if (p && p.clientId === clientId) openProjectModal(p, el); break; }
            case "open-project": openProject(id); break;
            case "close-modal": closeModal(); break;
            case "archive-project": {
                const p = getProjectById(id);
                if (!p || p.clientId !== clientId) break;
                const ok = await window.CashbookDialogs.confirm(`Archive "${p.projectName}"? Its records are preserved and can be restored.`, { title: "Archive project", confirmText: "Archive" });
                if (ok) { archiveProject(id); render(); }
                break;
            }
            case "restore-project": { const p = getProjectById(id); if (p && p.clientId === clientId) { restoreProject(id); render(); } break; }
        }
    });

    showArchived = showArchivedInit;
    render();
})();
