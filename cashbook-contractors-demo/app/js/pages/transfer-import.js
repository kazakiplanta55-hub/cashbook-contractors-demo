"use strict";

(function () {
    const $ = (s) => document.querySelector(s);
    const ex = window.CashbookExchange;
    const INCOME = ["Billed", "Down Payment", "Progress Payment", "Final Payment", "Other"];
    const EXPENSE = ["Labor", "Materials", "Equipment", "Permits", "Subcontractor", "Other"];
    const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const pick = (v, list) => list.find((c) => c.toLowerCase() === String(v || "").toLowerCase()) || "Other";
    const ask = (message, title, ok) => window.CashbookDialogs?.confirm
        ? window.CashbookDialogs.confirm(message, { title, confirmText: ok })
        : Promise.resolve(window.confirm(message));
    const safetyBackup = () => { try { window.cbStorage?.backupNow?.(); } catch (e) { /* ignore */ } };

    // ---------- 1. Bridge package (.cftransfer) import ----------
    let plan = [];

    function existingKeys(project) {
        const keys = new Set();
        [["in", project.incomeEntries], ["out", project.expenseEntries]].forEach(([kind, list]) => (list || []).forEach((e) => {
            keys.add(ex.transactionSignature(e, kind));
            keys.add("id:" + e.id);
            if (e.transferEntryId) keys.add("id:" + e.transferEntryId);
        }));
        return keys;
    }

    function freshEntries(row, projectId) {
        const project = projectId ? getProjectById(projectId) : null;
        const keys = project ? existingKeys(project) : new Set();
        const take = (list, kind) => (list || []).filter((e) => {
            const sig = ex.transactionSignature(e, kind);
            if (keys.has(sig) || keys.has("id:" + e.id)) return false;
            keys.add(sig); keys.add("id:" + e.id);
            return true;
        });
        return { cashIn: take(row.payload.cashInEntries, "in"), cashOut: take(row.payload.cashOutEntries, "out") };
    }

    // ---- Full project packages: a client row may carry complete "projects" (materials, purchase orders,
    // cheques, payroll, programs of work ...) next to, or instead of, plain Cash In / Cash Out lists.
    // Files can come from another app, so treat anything that is not a list as empty and skip empty rows.
    const rows = (list) => (Array.isArray(list) ? list.filter(Boolean) : []);
    const live = (list) => rows(list).filter((e) => e.postingStatus !== "reversed" && !e.reversalOf);
    const countOf = (n, word) => `${n} ${word}`;
    function describeProject(p) {
        const items = rows(p.programsOfWork).reduce((n, g) => n + rows(g.items).length, 0);
        return [countOf(live(p.incomeEntries).length, "cash in"), countOf(live(p.expenseEntries).length, "cash out"),
            countOf(rows(p.materialEntries).length, "material movements"), countOf(rows(p.purchaseOrders).length, "POs"),
            countOf(rows(p.chequeEntries).length, "cheques"), countOf(rows(p.payrollEntries).length, "payroll"),
            countOf(items, "program items")].join(" · ");
    }
    // Cash In / Cash Out lists that sit next to a client's projects but are not already inside them.
    // They are not imported by the project step, so the plan tells the person instead of dropping them silently.
    function looseCashCount(row) {
        const known = new Set();
        row.incoming.forEach((p) => { rows(p && p.incomeEntries).forEach((e) => known.add(ex.transactionSignature(e, "in"))); rows(p && p.expenseEntries).forEach((e) => known.add(ex.transactionSignature(e, "out"))); });
        return live(row.payload.cashInEntries).filter((e) => !known.has(ex.transactionSignature(e, "in"))).length +
            live(row.payload.cashOutEntries).filter((e) => !known.has(ex.transactionSignature(e, "out"))).length;
    }
    function projectState(row, p) {
        if (row.blocked) return { add: false, label: "Client is archived. Restore it first." };
        const all = loadProjects();
        const exists = (p.id && all.some((x) => x.id === p.id)) ||
            (row.local && all.some((x) => x.clientId === row.local.id && ex.normalizeText(x.projectName) === ex.normalizeText(p.projectName)));
        return exists ? { add: false, label: "Already in this app: skipped" } : { add: true, label: "Will be added" };
    }
    function clientFromProfile(profile) {
        const now = new Date().toISOString();
        return {
            id: profile.id || createId(), clientName: profile.name || "Imported client", businessName: profile.business || profile.name || "",
            userName: profile.userName || "", contactPerson: profile.contactPerson || "", contactNumber: profile.contactNumber || "",
            clientEmail: profile.email || "", tin: profile.tin || "", clientAddress: profile.address || "",
            brandColor: /^#[0-9a-f]{6}$/i.test(profile.brandColor || "") ? profile.brandColor : "",
            logo: /^data:image\//.test(profile.logo || "") ? profile.logo : "",
            archivedAt: "", auditTrail: [], createdAt: now, updatedAt: now,
        };
    }

    function findClient(profile, locals) {
        const tin = ex.normalizeTin(profile.tin);
        return locals.find((c) => c.id === profile.id)
            || (tin && locals.find((c) => ex.normalizeTin(c.tin) === tin))
            || locals.find((c) => ex.normalizeText(c.clientName) === ex.normalizeText(profile.name))
            || null;
    }

    function renderPlan() {
        const message = $("#importPackageMessage");
        const cashRows = plan.map((row, i) => ({ row, i })).filter(({ row }) => !row.full);
        const fullRows = plan.filter((row) => row.full);
        let html = "";
        if (fullRows.length) {
            html += `<table><thead><tr><th>Client in file</th><th>Matches</th><th>Project</th><th>What it contains</th><th>Result</th></tr></thead><tbody>${
                fullRows.map((row) => row.incoming.map((p) => `<tr><td>${esc(row.payload.profile.name)}</td><td>${row.local ? esc(row.local.clientName) : row.blocked ? `${esc(row.archived.clientName)} (archived)` : "New client: will be added"}</td>
                    <td>${esc(p.projectName)} <small>(${esc(p.status || "Ongoing")})</small></td><td>${esc(describeProject(p))}</td><td>${esc(projectState(row, p).label)}</td></tr>`).join("")).join("")}</tbody></table>`;
            fullRows.forEach((row) => {
                const loose = looseCashCount(row);
                if (loose) html += `<p class="aset-message">${esc(row.payload.profile.name)}: the file also lists ${loose} Cash In / Cash Out entr${loose === 1 ? "y" : "ies"} that are not inside any of its projects. Those are not imported here. Use a Cash In / Cash Out package for them.</p>`;
            });
        }
        if (cashRows.length) {
            html += `<table><thead><tr><th>Client in file</th><th>Matches</th><th>Import into project</th><th>New Cash In</th><th>New Cash Out</th></tr></thead><tbody>${
                cashRows.map(({ row, i }) => {
                    const options = row.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.projectName)}</option>`).join("");
                    const counts = freshEntries(row, row.projects.length ? row.projectId : "");
                    return `<tr><td>${esc(row.payload.profile.name)}</td><td>${row.local ? esc(row.local.clientName) : "No match"}</td>
                        <td>${row.projects.length ? `<select data-plan="${i}">${options}</select>` : "Add this client and a project first, then import again"}</td>
                        <td>${row.projects.length ? counts.cashIn.length : 0}</td><td>${row.projects.length ? counts.cashOut.length : 0}</td></tr>`;
                }).join("")}</tbody></table>`;
        }
        $("#importPackagePlan").innerHTML = html;
        plan.forEach((row, i) => { const s = document.querySelector(`select[data-plan="${i}"]`); if (s) { s.value = row.projectId; s.addEventListener("change", () => { row.projectId = s.value; renderPlan(); }); } });
        const newProjects = fullRows.reduce((n, row) => n + row.incoming.filter((p) => projectState(row, p).add).length, 0);
        const cashTotal = cashRows.reduce((n, { row }) => { if (!row.projects.length) return n; const f = freshEntries(row, row.projectId); return n + f.cashIn.length + f.cashOut.length; }, 0);
        const parts = [];
        if (newProjects) parts.push(`${newProjects} new project${newProjects === 1 ? "" : "s"} with all their records`);
        if (cashTotal) parts.push(`${cashTotal} new Cash In / Cash Out entries`);
        message.textContent = parts.length ? `Ready to import: ${parts.join(" and ")}. Anything already recorded is skipped.` : "Nothing new to import from this file.";
        $("#importPackageConfirm").hidden = parts.length === 0;
    }

    $("#importPackageFile").addEventListener("change", async (event) => {
        const file = event.target.files[0];
        plan = []; $("#importPackagePlan").innerHTML = ""; $("#importPackageConfirm").hidden = true;
        if (!file) return;
        try {
            const pkg = await ex.validatePackage(await ex.readJsonFile(file));
            const locals = loadClients().filter((c) => !c.archivedAt);
            const projects = loadProjects().filter((p) => !p.archivedAt);
            const everyClient = loadClients();
            plan = (pkg.payload.clients || []).map((payload) => {
                if (rows(payload.projects).length) {
                    const any = findClient(payload.profile || {}, everyClient);
                    const local = any && !any.archivedAt ? any : null;
                    return { full: true, payload: { ...payload, profile: payload.profile || {} }, local, archived: any && any.archivedAt ? any : null, blocked: Boolean(any && any.archivedAt), incoming: rows(payload.projects), packageId: pkg.packageId, source: pkg.source?.application || "another Cashbook app", projects: [], projectId: "" };
                }
                const local = findClient(payload.profile || {}, locals);
                const mine = local ? projects.filter((p) => p.clientId === local.id) : [];
                return { payload, local, projects: mine, projectId: mine[0]?.id || "", packageId: pkg.packageId, source: pkg.source?.application || "another Cashbook app" };
            });
            renderPlan();
        } catch (error) { $("#importPackageMessage").textContent = error.message; }
    });

    $("#importPackageConfirm").addEventListener("click", async () => {
        const hasProjects = plan.some((row) => row.full && !row.blocked);
        if (!(await ask(hasProjects ? "Import the new projects and entries from this file? Your current data is backed up first." : "Import the new entries into the selected projects? Your current data is backed up first.", "Import transfer package", "Import"))) return;
        safetyBackup();
        let added = 0, addedProjects = 0;
        let recoded = 0;
        plan.filter((row) => row.full && !row.blocked).forEach((row) => {
            const toAdd = row.incoming.filter((p) => projectState(row, p).add);
            if (!toAdd.length) return;
            // The same client may already have been added earlier in this same import (two rows, one TIN).
            if (!row.local) row.local = findClient(row.payload.profile || {}, loadClients().filter((c) => !c.archivedAt));
            if (!row.local) { row.local = clientFromProfile(row.payload.profile || {}); upsertClient(row.local); }
            const everything = loadProjects();
            const built = [];
            toAdd.forEach((p) => {
                // Same clean-up every other save path applies: an id, 0-100 progress, a status, empty lists, centavo amounts.
                const project = normalizeProject({ ...p, clientId: row.local.id });
                // A workspace logs in by client + project code, so a code must be unique within its client.
                const taken = [...everything, ...built].filter((x) => x.clientId === row.local.id);
                if (project.projectCode && taken.some((x) => window.CbcWorkspaceCore.projectCode(x, taken) === project.projectCode.trim().toUpperCase())) {
                    project.projectCode = ""; recoded++;
                }
                appendProjectAudit(project, "CREATE", "project", project.id, `Imported project from ${row.source}`, { packageId: row.packageId });
                project.importedAt = new Date().toISOString();
                project.transferPackageId = row.packageId;
                built.push(project);
            });
            saveProjects([...loadProjects(), ...built]);
            addedProjects += built.length;
        });
        plan.filter((row) => !row.full && row.projects.length).forEach((row) => {
            const project = getProjectById(row.projectId);
            const fresh = freshEntries(row, row.projectId);
            [["income", fresh.cashIn, "incomeEntries", INCOME], ["expense", fresh.cashOut, "expenseEntries", EXPENSE]].forEach(([dir, list, key, cats]) => {
                list.forEach((e) => {
                    const id = createId();
                    const entry = { id, date: e.date, amount: money(e.amount || e.totalAmount), description: e.description || "", referenceNo: e.referenceNumber || "",
                        category: pick(e.transactionType || e.expenseType, cats), sourceType: "manual", sourceId: id, sourceIds: [id], sourceKey: transactionSourceKey("manual", id),
                        postingStatus: "posted", postedAt: new Date().toISOString(), createdAt: new Date().toISOString(), importedAt: new Date().toISOString(),
                        transferEntryId: e.id, transferPackageId: row.packageId };
                    project[key] = [...(project[key] || []), entry]; added++;
                    appendProjectAudit(project, "POST", "manual", id, `Imported ${dir} from ${row.source}: ${entry.description}`, { direction: dir, amountCentavos: moneyToCentavos(entry.amount), referenceNo: entry.referenceNo });
                });
            });
            upsertProject(project);
        });
        $("#importPackageMessage").textContent = addedProjects ? `Imported ${addedProjects} project${addedProjects === 1 ? "" : "s"} with all their records${added ? ` and ${added} Cash In / Cash Out entries` : ""}.${recoded ? ` ${recoded} project code${recoded === 1 ? " was" : "s were"} already used by this client, so ${recoded === 1 ? "a new one was" : "new ones were"} assigned.` : ""}` : `Imported ${added} entries.`;
        $("#importPackagePlan").innerHTML = ""; $("#importPackageConfirm").hidden = true; plan = [];
    });

    // ---------- 2. Full data package ----------
    function mergeById(current, incoming) {
        const byId = new Map(current.map((r) => [r.id, r]));
        let added = 0, updated = 0, kept = 0;
        incoming.forEach((r) => {
            const mine = byId.get(r.id);
            if (!mine) { byId.set(r.id, r); added++; }
            else if (String(r.updatedAt || "") > String(mine.updatedAt || "")) { byId.set(r.id, r); updated++; }
            else kept++;
        });
        return { list: [...byId.values()], added, updated, kept };
    }
    window.CashbookFullMerge = { mergeById };

    $("#fullExportButton").addEventListener("click", () => { exportAllDataAsFile(); $("#fullMessage").textContent = "Full data file saved. Keep it somewhere safe."; });

    $("#fullImportButton").addEventListener("click", async () => {
        const file = $("#fullImportFile").files[0], msg = $("#fullMessage");
        if (!file) { msg.textContent = "Choose a full data file first."; return; }
        const replace = $("#fullMode").value === "replace";
        if (replace && !(await ask("Replace everything in this app with the file's data? Your current data is backed up first.", "Replace all data", "Replace"))) return;
        if (replace) { restoreAllDataFromFile(file, (ok, text) => { msg.textContent = text; if (ok) setTimeout(() => location.reload(), 900); }); return; }
        try {
            const payload = JSON.parse(await file.text());
            if (!payload || !Array.isArray(payload.clients) || !Array.isArray(payload.projects)) { msg.textContent = "That file doesn't look like a valid full data file."; return; }
            const failed = () => { msg.textContent = "This file failed its checksum check. Nothing was changed."; };
            if (payload.checksum && simpleChecksum(JSON.stringify({ clients: payload.clients, projects: payload.projects })) !== payload.checksum) { failed(); return; }
            const hasHr = Array.isArray(payload.company201), hrDocs = Array.isArray(payload.hrDocuments) ? payload.hrDocuments : [];
            if (hasHr && payload.hrChecksum && hrChecksumOf(payload.company201, hrDocs) !== payload.hrChecksum) { failed(); return; }
            safetyBackup();
            const c = mergeById(loadClients(), payload.clients), p = mergeById(loadProjects(), payload.projects);
            saveClients(c.list); saveProjects(p.list);
            let hrText = "";
            if (hasHr) {
                // HR files merge the same way, and a scanned document is copied only when this computer does not have it yet.
                const h = mergeById(loadCompany201(), payload.company201);
                saveCompany201(h.list);
                const referenced = new Set(allDocumentIds());
                hrDocs.forEach((d) => { if (d && d.id && d.dataUrl && referenced.has(d.id) && !loadDocumentFile(d.id)) saveDocumentFile(d.id, d.dataUrl); });
                hrText = ` HR files: ${h.added} added, ${h.updated} updated, ${h.kept} kept.`;
            }
            msg.textContent = `Merged. Clients: ${c.added} added, ${c.updated} updated, ${c.kept} kept. Projects: ${p.added} added, ${p.updated} updated, ${p.kept} kept.${hrText}`;
        } catch (error) { msg.textContent = "The selected file is not valid JSON."; }
    });
})();
