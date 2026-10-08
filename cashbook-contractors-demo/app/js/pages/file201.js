"use strict";
// 201 File page. One script, two pages:
//   HR / Company 201  (body data-mode="company")  the main company's own people, kept in one company-wide list.
//   Project 201  (body data-mode="project")  the people on one project (its non-subcontracted workers), kept in that project.
(function () {
    const C = window.Cbc201;
    const mode = document.body.dataset.mode === "project" ? "project" : "company";
    const $ = (s) => document.querySelector(s);
    const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    let project = null;
    if (mode === "project") {
        const loaded = loadProjectFromUrl();
        if (!loaded) return;
        project = loaded.project;
    }

    // ---- Data access ------------------------------------------------------
    const people = () => (mode === "project" ? (project.workers || []) : loadCompany201());
    function savePerson(person) {
        if (mode === "company") {
            const list = loadCompany201();
            const i = list.findIndex((p) => p.id === person.id);
            if (i >= 0) list[i] = person; else list.push(person);
            saveCompany201(list);
        } else {
            const workers = [...(project.workers || [])];
            const i = workers.findIndex((w) => w.id === person.id);
            if (i >= 0) workers[i] = person; else workers.push(person);
            project = upsertProject({ ...project, workers });
        }
    }
    function removePerson(id) {
        if (mode === "company") {
            const gone = loadCompany201().find((p) => p.id === id);
            C.docsOf(gone).forEach((d) => deleteDocumentFile(d.id));
            saveCompany201(loadCompany201().filter((p) => p.id !== id));
            // Copies of this person inside projects stay as ordinary project workers (payroll history is kept), no longer linked to HR.
            const projects = loadProjects();
            let changed = false;
            const next = projects.map((pr) => {
                if (!(pr.workers || []).some((w) => w.companyId === id)) return pr;
                changed = true;
                return { ...pr, workers: pr.workers.map((w) => { if (w.companyId !== id) return w; const { companyId, ...rest } = w; return rest; }) };
            });
            if (changed) saveProjects(next);
        } else {
            // Past payroll entries stay in the log. Documents kept in HR stay in HR.
            const gone = (project.workers || []).find((w) => w.id === id);
            if (gone && !gone.companyId) C.docsOf(gone).forEach((d) => deleteDocumentFile(d.id));
            project = upsertProject({ ...project, workers: (project.workers || []).filter((w) => w.id !== id) });
        }
    }
    const find = (id) => people().find((p) => p.id === id);

    // HR is read once per screen draw instead of once per row.
    let companyCache = null;
    const companyList = () => companyCache || loadCompany201();

    // ---- List -------------------------------------------------------------
    let modalOpener = null;
    function render() {
        companyCache = mode === "project" ? loadCompany201() : null;
        try { renderList(); } finally { companyCache = null; }
    }
    // Project crew follows the roles hierarchy (top role first); HR and ties fall back to rank, then name.
    function sortedPeople() {
        const order = {};
        if (mode === "project") (project.roles || []).forEach((r, i) => { order[String(r.name).toLowerCase()] = i; });
        const pos = (p) => (order[String(p.role || "").toLowerCase()] ?? 9999);
        return people().sort((a, b) => pos(a) - pos(b) || String(a.rank || "").localeCompare(String(b.rank || ""), undefined, { numeric: true }) || String(a.name).localeCompare(String(b.name)));
    }
    const rateText = (p) => {
        const bits = [p.dailyRate ? formatMoney(p.dailyRate) + "/day" : "", p.hourlyRate ? formatMoney(p.hourlyRate) + "/hr" : "", p.otRate ? "OT " + formatMoney(p.otRate) : ""].filter(Boolean);
        return bits.length ? bits.map((b) => `<span class="f201-rate">${esc(b)}</span>`).join("") : `<span class="bn-chip warn">Set a rate</span>`;
    };
    function renderList() {
        const query = $("#f201Search").value.trim().toLowerCase();
        const all = sortedPeople();
        const list = all.filter((p) => !query || [p.name, p.rank, (p.file201 || {}).position, p.role].some((v) => String(v || "").toLowerCase().includes(query)));
        $("#f201Count").textContent = `${list.length} of ${all.length} ${mode === "company" ? "company employee" : "crew member"}${all.length === 1 ? "" : "s"}`;
        $("#f201Body").innerHTML = list.map((p) => {
            const f = p.file201 || {}, sub = mode === "project" && C.isSubcontracted(p);
            const actions = (sub ? "" : `<button type="button" class="primary-button" data-act="view" data-id="${esc(p.id)}">Open 201</button>`) +
                `<button type="button" class="secondary-button" data-act="edit" data-id="${esc(p.id)}">Edit</button>` +
                `<button type="button" class="secondary-button" data-act="delete" data-id="${esc(p.id)}">${mode === "company" ? "Delete" : "Remove"}</button>`;
            if (mode === "project") {
                return `<tr><td><strong>${esc(p.name)}</strong>${p.companyId ? '<span class="bn-chip info f201-tag">From HR</span>' : ""}</td><td>${esc(C.typeOf(p))}</td>` +
                    `<td>${esc(p.role || f.position || "-")}</td><td>${sub ? "-" : esc(p.rank || "-")}</td><td>${sub ? "-" : esc(C.statusOf(p))}</td>` +
                    `<td>${sub ? '<span class="f201-none">No 201 file</span>' : docPill(p)}</td><td class="num f201-rates">${rateText(p)}</td><td class="f201-actions">${actions}</td></tr>`;
            }
            return `<tr><td><strong>${esc(p.name)}</strong></td>` +
                `<td>${esc(f.position || p.role || "-")}</td><td>${esc(p.rank || "-")}</td><td>${esc(C.statusOf(p))}</td>` +
                `<td>${docPill(p)}</td>` +
                `<td>${esc(f.hireDate ? formatDate(f.hireDate) : "-")}</td><td>${esc(f.contact || "-")}</td>` +
                `<td class="f201-actions">${actions}</td></tr>`;
        }).join("");
        const empty = $("#f201Empty");
        empty.hidden = list.length > 0;
        empty.textContent = all.length ? "Nothing matches your search." : (mode === "company"
            ? "No company employees yet. Press \"Add Employee\" to create the first 201 file."
            : "No crew on this project yet. Press \"Add Person\", or copy people from Company 201.");
        if (mode === "company") renderTiles(all);
        if (mode === "project") { renderProjectTiles(all); renderRoles(); }
    }

    function renderProjectTiles(all) {
        const real = all.filter((p) => !C.isSubcontracted(p));
        const subs = all.length - real.length;
        const noRate = all.filter((p) => !p.dailyRate && !p.hourlyRate).length;
        const missing = real.reduce((n, p) => n + C.missingDocs(ownerOf(p).rec).length, 0);
        const complete = real.filter((p) => !C.missingDocs(ownerOf(p).rec).length).length;
        const tile = (cls, label, value, note) => `<div class="bn-tile ${cls}"><span class="bn-tile-label">${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div>`;
        $("#projTiles").innerHTML =
            tile("", "Crew", all.length, subs ? `${subs} subcontracted` : "On this project") +
            tile("teal", "Complete 201 files", `${complete} of ${real.length}`, "Subcontracted excluded") +
            tile(missing ? "warn" : "positive", "Missing documents", missing, missing ? "Open a 201 to upload" : "All on file") +
            tile(noRate ? "warn" : "positive", "Without a pay rate", noRate, noRate ? "Set before recording pay" : "Ready for Payroll");
    }

    // Roles hierarchy (moved here from Payroll)
    let dragRoleId = null;
    function saveRoles(roles) { project = upsertProject({ ...project, roles }); render(); }
    function renderRoles() {
        const roles = project.roles || [];
        $("#rolesEmptyState").hidden = roles.length > 0;
        $("#rolesList").innerHTML = roles.map((r, i) => {
            const n = people().filter((p) => String(p.role || "").toLowerCase() === String(r.name).toLowerCase()).length;
            return `<li class="rl-item" draggable="true" data-id="${esc(r.id)}"><span class="rl-grip" aria-hidden="true">&#8942;&#8942;</span><span class="rl-num">${i + 1}</span><span class="rl-name">${esc(r.name)}</span><span class="rl-count">${n}</span>` +
                `<button type="button" class="secondary-button" data-act="role-up" data-id="${esc(r.id)}" aria-label="Move ${esc(r.name)} up"${i === 0 ? " disabled" : ""}>&uarr;</button>` +
                `<button type="button" class="secondary-button" data-act="role-edit" data-id="${esc(r.id)}">Edit</button>` +
                `<button type="button" class="secondary-button" data-act="role-del" data-id="${esc(r.id)}" aria-label="Remove ${esc(r.name)}">&times;</button></li>`;
        }).join("");
    }
    function wireRoles() {
        const list = $("#rolesList");
        list.addEventListener("dragstart", (e) => { const li = e.target.closest(".rl-item"); if (li) { dragRoleId = li.dataset.id; li.classList.add("dragging"); } });
        list.addEventListener("dragend", (e) => { const li = e.target.closest(".rl-item"); if (li) li.classList.remove("dragging"); dragRoleId = null; });
        list.addEventListener("dragover", (e) => e.preventDefault());
        list.addEventListener("drop", (e) => {
            e.preventDefault();
            const li = e.target.closest(".rl-item");
            if (!li || !dragRoleId || dragRoleId === li.dataset.id) return;
            const roles = [...(project.roles || [])];
            const from = roles.findIndex((r) => r.id === dragRoleId), to = roles.findIndex((r) => r.id === li.dataset.id);
            if (from < 0 || to < 0) return;
            roles.splice(to, 0, roles.splice(from, 1)[0]);
            saveRoles(roles);
        });
        $("#addRoleBtn").addEventListener("click", async () => {
            const name = await window.CashbookDialogs.prompt("New role name (e.g. Foreman, Mason, Helper):", "", { title: "Add role", confirmText: "Add" });
            if (!name || !name.trim()) return;
            if ((project.roles || []).some((r) => String(r.name).toLowerCase() === name.trim().toLowerCase())) { window.CashbookDialogs.alert(`${name.trim()} is already a role.`, { title: "Role exists" }); return; }
            saveRoles([...(project.roles || []), { id: createId(), name: name.trim() }]);
        });
    }
    async function roleAction(act, id) {
        const roles = [...(project.roles || [])], i = roles.findIndex((r) => r.id === id);
        if (i < 0) return;
        if (act === "role-up" && i > 0) { roles.splice(i - 1, 0, roles.splice(i, 1)[0]); saveRoles(roles); }
        if (act === "role-edit") {
            const name = await window.CashbookDialogs.prompt("Role name:", roles[i].name, { title: "Rename role", confirmText: "Save" });
            if (!name || !name.trim()) return;
            const old = roles[i].name, workers = (project.workers || []).map((w) => (String(w.role || "").toLowerCase() === old.toLowerCase() ? { ...w, role: name.trim() } : w));
            roles[i] = { ...roles[i], name: name.trim() };
            appendProjectAudit(project, "UPDATE", "role", id, `Renamed role ${old} to ${name.trim()}`);
            project = upsertProject({ ...project, roles, workers }); render();
        }
        if (act === "role-del") {
            const inUse = people().filter((p) => String(p.role || "").toLowerCase() === String(roles[i].name).toLowerCase());
            if (inUse.length) { await window.CashbookDialogs.alert(`This role is assigned to ${inUse.length} person(s). Reassign them before removing it.`, { title: "Role is in use" }); return; }
            if (!await window.CashbookDialogs.confirm(`Remove the role ${roles[i].name}?`, { title: "Remove role", confirmText: "Remove", danger: true })) return;
            appendProjectAudit(project, "DELETE", "role", id, `Removed unused role ${roles[i].name}`);
            roles.splice(i, 1); saveRoles(roles);
        }
    }

    // A project worker linked to a company employee keeps its documents in HR (one copy, never two).
    function ownerOf(person) {
        if (mode === "project" && person.companyId) {
            const company = companyList().find((p) => p.id === person.companyId);
            if (company) return { rec: company, where: "company" };
        }
        return { rec: person, where: mode };
    }
    function saveOwner(o, rec) {
        if (o.where === "company") {
            const list = loadCompany201();
            const i = list.findIndex((p) => p.id === rec.id);
            if (i >= 0) { list[i] = rec; saveCompany201(list); }
        } else savePerson(rec);
    }
    function docPill(person) {
        const rec = ownerOf(person).rec, missing = C.missingDocs(rec), total = C.REQUIRED_DOCS.length;
        const done = total - missing.length;
        return `<span class="f201-pill ${missing.length ? "f201-pill-warn" : "f201-pill-ok"}" title="${missing.length ? "Missing: " + esc(missing.map(C.docLabel).join(", ")) : "All required documents on file"}">${done}/${total}</span>`;
    }
    function renderTiles(all) {
        const active = all.filter((p) => C.statusOf(p) === "Active");
        const complete = active.filter((p) => !C.missingDocs(p).length).length;
        const missing = active.reduce((n, p) => n + C.missingDocs(p).length, 0);
        const tiles = [["Active employees", active.length], ["Complete 201 files", `${complete} of ${active.length}`], ["Missing documents", missing], ["Inactive", all.length - active.length]];
        $("#hrTiles").innerHTML = tiles.map(([k, v]) => `<div class="pt-card"><small>${esc(k)}</small><strong>${esc(v)}</strong></div>`).join("");
    }

    // ---- Documents (PDF and pictures) ----
    const MAX_PDF = 4 * 1024 * 1024;
    const readAsDataUrl = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onerror = () => reject(new Error("That file could not be read.")); r.onload = () => resolve(r.result); r.readAsDataURL(file); });
    function loadImage(src) { return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("That picture could not be opened.")); img.src = src; }); }
    // Pictures are shrunk before saving so the data file stays small: the 2x2 photo is cropped square, scans are capped at 1600 px.
    async function prepareImage(file, square) {
        const img = await loadImage(await readAsDataUrl(file));
        const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
        if (square) {
            const side = Math.min(img.width, img.height), out = Math.min(600, side);
            canvas.width = canvas.height = out;
            ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, out, out);
        } else {
            const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
            canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
            ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        }
        return canvas.toDataURL("image/jpeg", 0.85);
    }
    async function addDocument(person, kind, file) {
        const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
        const isImage = /^image\/(png|jpe?g|webp)$/.test(file.type);
        if (kind === "photo" && !isImage) throw new Error("The 2x2 photo must be a picture (PNG, JPG or WebP).");
        if (!isPdf && !isImage) throw new Error("Choose a PDF or a picture (PNG, JPG, WebP).");
        let dataUrl, mime;
        if (isPdf) {
            if (file.size > MAX_PDF) throw new Error("That PDF is over 4 MB. Compress it or scan at a lower resolution.");
            dataUrl = await readAsDataUrl(file);
            // A real PDF starts with "%PDF-" (JVBERi0 in base64). The file name or type alone is not proof.
            const encoded = dataUrl.split("base64,")[1] || "";
            if (!encoded.startsWith("JVBERi0")) throw new Error("That file is not a valid PDF.");
            dataUrl = "data:application/pdf;base64," + encoded;
            mime = "application/pdf";
        } else {
            if (file.size > 15 * 1024 * 1024) throw new Error("Choose a picture under 15 MB.");
            dataUrl = await prepareImage(file, kind === "photo"); mime = "image/jpeg";
        }
        const o = ownerOf(person), rec = { ...o.rec };
        let docs = C.docsOf(rec).slice();
        if (kind === "photo") { docs.filter((d) => d.kind === "photo").forEach((d) => deleteDocumentFile(d.id)); docs = docs.filter((d) => d.kind !== "photo"); }
        const meta = { id: createId(), kind, name: file.name || C.docLabel(kind), mime, size: Math.round(dataUrl.length * 0.75), addedAt: new Date().toISOString() };
        saveDocumentFile(meta.id, dataUrl);
        rec.documents = [...docs, meta];
        rec.updatedAt = new Date().toISOString();
        saveOwner(o, rec);
        return rec;
    }
    function removeDocument(person, docId) {
        const o = ownerOf(person), rec = { ...o.rec };
        deleteDocumentFile(docId);
        rec.documents = C.docsOf(rec).filter((d) => d.id !== docId);
        rec.updatedAt = new Date().toISOString();
        saveOwner(o, rec);
    }
    const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");
    function downloadDocument(meta) {
        const url = loadDocumentFile(meta.id);
        if (!url) return;
        const bytes = atob(url.split("base64,")[1] || ""), arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        const blob = new Blob([arr], { type: meta.mime }), link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = /\.(pdf|jpe?g|png|webp)$/i.test(meta.name) ? meta.name : meta.name + (meta.mime === "application/pdf" ? ".pdf" : ".jpg");
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    }
    async function viewDocument(meta) {
        const url = loadDocumentFile(meta.id);
        const host = $("#f201Viewer");
        host.innerHTML = `<div class="modal-overlay f201-viewer" id="f201ViewerOverlay"><div class="modal-card f201-viewer-card"><div class="f201-bar"><strong>${esc(meta.name)}</strong><div><button type="button" class="secondary-button" data-act="doc-download" data-doc="${esc(meta.id)}">Download</button><button type="button" class="primary-button" data-act="viewer-close">Close</button></div></div><div id="f201ViewerBody" class="f201-viewer-body"></div></div></div>`;
        const body = $("#f201ViewerBody");
        if (!url) { body.innerHTML = `<p class="empty-state">This file is missing from the data folder.</p>`; return; }
        if (meta.mime !== "application/pdf") { body.innerHTML = `<img alt="${esc(meta.name)}" src="${esc(url)}">`; return; }
        try {
            if (!window.pdfjsLib) throw new Error("The PDF viewer could not be loaded. Use Download to open it.");
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("../../assets/vendor/pdf.worker.min.js", location.href).href;
            const raw = atob(url.split("base64,")[1]), data = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) data[i] = raw.charCodeAt(i);
            const pdf = await window.pdfjsLib.getDocument({ data }).promise;
            for (let n = 1; n <= Math.min(pdf.numPages, 20); n++) {
                const page = await pdf.getPage(n), viewport = page.getViewport({ scale: 1.4 });
                const canvas = document.createElement("canvas"); canvas.width = viewport.width; canvas.height = viewport.height;
                body.appendChild(canvas);
                await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
            }
            if (pdf.numPages > 20) body.insertAdjacentHTML("beforeend", `<p class="f201-hint">Showing the first 20 of ${pdf.numPages} pages. Use Download for the rest.</p>`);
        } catch (error) {
            body.innerHTML = `<p class="empty-state">${esc(error.message || "This PDF could not be shown.")} Use Download to open it.</p>`;
        }
    }
    function closeViewer() { $("#f201Viewer").innerHTML = ""; }

    // ---- Pop-ups ----------------------------------------------------------
    function openModal(html, opener) {
        modalOpener = opener || null;
        $("#f201Modal").innerHTML = `<div class="modal-overlay" id="f201Overlay"><div class="modal-card f201-modal" role="dialog" aria-modal="true">${html}</div></div>`;
        $("#f201Overlay").addEventListener("click", (e) => { if (e.target.id === "f201Overlay") closeModal(); });
        document.addEventListener("keydown", modalKey, true);
    }
    function closeModal() {
        $("#f201Modal").innerHTML = "";
        window.CashbookPrintTarget = null; window.CashbookPrintTitle = null;
        document.removeEventListener("keydown", modalKey, true);
        if (modalOpener && document.contains(modalOpener)) modalOpener.focus();
        modalOpener = null;
    }
    function modalKey(e) {
        if (e.key === "Escape" && !document.documentElement.classList.contains("cf-preview-open")) {
            e.stopPropagation();
            if ($("#f201Viewer").innerHTML) closeViewer(); else closeModal();
        }
    }

    const fieldDef = (key) => C.FIELDS.find(([k]) => k === key);
    const displayValue = (person, key) => {
        const f = person.file201 || {}, kind = (fieldDef(key) || [])[2];
        if (key === "status") return C.statusOf(person);
        return kind === "date" ? (f[key] ? formatDate(f[key]) : "") : (f[key] || "");
    };

    function openView(person, opener, message) {
        const o = ownerOf(person), docs = C.docsOf(o.rec), missing = C.missingDocs(o.rec);
        const row = (label, value) => `<div class="f201-row"><dt>${esc(label)}</dt><dd>${value ? esc(value) : "-"}</dd></div>`;
        const scope = mode === "company" ? "Human Resources \u2014 Company 201 File" : `Project 201 File \u2014 ${project.projectName}`;
        const photo = docs.find((d) => d.kind === "photo"), photoUrl = photo ? loadDocumentFile(photo.id) : "";
        const photoBox = photoUrl ? `<img class="f201-photo" src="${esc(photoUrl)}" alt="2x2 photo of ${esc(person.name)}">` : `<div class="f201-photo f201-photo-empty">No 2x2 photo</div>`;
        const position = (person.file201 || {}).position || person.role || "";
        const chips = [person.rank ? `Rank: ${person.rank}` : "", position, mode === "project" ? C.typeOf(person) : ""].filter(Boolean).map((t) => `<span class="f201-chip">${esc(t)}</span>`).join("");
        const sections = C.GROUPS.map(([title, keys]) => {
            const rows = keys.map((k) => row(fieldDef(k)[1], displayValue(person, k))).join("");
            return `<section class="f201-sec"><h4>${esc(title)}</h4><dl class="f201-dl${title === "Remarks" ? " f201-dl-one" : ""}">${title === "Employment" ? row("Rank", person.rank) : ""}${title === "Employment" && mode === "project" ? row("Role", person.role) : ""}${rows}</dl></section>`;
        }).join("");
        const done = C.REQUIRED_DOCS.length - missing.length;
        const fileRows = docs.filter((d) => d.kind !== "photo").map((d) => `<li><div class="f201-doc-main"><strong>${esc(C.docLabel(d.kind))}</strong><small title="${esc(d.name)}">${esc(d.name)} \u00B7 ${esc(fmtSize(d.size))} \u00B7 ${esc(formatDate(String(d.addedAt).slice(0, 10)))}</small></div>
            <div class="f201-doc-actions"><button type="button" class="secondary-button" data-act="doc-view" data-doc="${esc(d.id)}">View</button><button type="button" class="secondary-button" data-act="doc-download" data-doc="${esc(d.id)}">Download</button><button type="button" class="secondary-button f201-danger" data-act="doc-delete" data-doc="${esc(d.id)}">Delete</button></div></li>`).join("");
        const kindOptions = C.DOC_KINDS.map(([k, l]) => `<option value="${k}">${esc(l)}${k === "photo" && photo ? " (replace)" : ""}</option>`).join("");
        openModal(`<div class="f201-bar"><strong>${esc(scope)}</strong><div><button type="button" class="primary-button" data-act="print">Print</button>
            <button type="button" class="secondary-button" data-act="export-one" data-id="${esc(person.id)}">Export to Excel</button>
            <button type="button" class="secondary-button" data-act="edit" data-id="${esc(person.id)}">Edit</button>
            <button type="button" class="secondary-button" data-act="close">Close</button></div></div>
            <div id="f201Sheet" class="f201-sheet"><div class="f201-hero">${photoBox}<div class="f201-hero-text"><h3>${esc(person.name)}</h3><div class="f201-chips">${chips}<span class="f201-pill ${C.statusOf(person) === "Active" ? "f201-pill-ok" : "f201-pill-warn"}">${esc(C.statusOf(person))}</span></div><p class="f201-scope">${esc(scope)}</p></div></div>
            ${sections}
            <section class="f201-sec"><h4>Documents on file <span class="f201-pill ${missing.length ? "f201-pill-warn" : "f201-pill-ok"}">${done}/${C.REQUIRED_DOCS.length} required</span></h4>
            <p class="f201-check">${C.REQUIRED_DOCS.map((k) => `<span class="f201-pill ${missing.includes(k) ? "f201-pill-warn" : "f201-pill-ok"}">${missing.includes(k) ? "\u2717" : "\u2713"} ${esc(C.docLabel(k))}</span>`).join("")}</p>
            ${fileRows ? `<ul class="f201-docs">${fileRows}</ul>` : `<p class="f201-hint">No scanned documents yet.</p>`}</section></div>
            ${mode === "project" && person.companyId && o.where === "company" ? `<p class="f201-hint">Documents for this person are kept in Human Resources.</p>` : ""}
            <form id="f201DocForm" class="f201-upload" autocomplete="off"><h4>Add a document</h4>
                <div class="f201-upload-row"><select id="f201DocKind" aria-label="Document type">${kindOptions}</select><input id="f201DocFile" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required aria-label="File"><button type="submit" class="primary-button">Upload</button></div>
                <p class="f201-hint">PDF (up to 4 MB) or a picture. Pictures are shrunk automatically; the 2x2 photo is cropped square.</p>
                <p class="f201-error${message ? " f201-ok" : ""}" id="f201DocMsg" role="alert">${esc(message || "")}</p></form>`, opener);
        window.CashbookPrintTarget = () => $("#f201Sheet");
        window.CashbookPrintTitle = () => `201 File - ${person.name}`;
        $("#f201DocForm").addEventListener("submit", async (e) => {
            e.preventDefault();
            const file = $("#f201DocFile").files[0];
            if (!file) return;
            const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
            try { await addDocument(person, $("#f201DocKind").value, file); const fresh = find(person.id) || person; render(); openView(fresh, modalOpener, "Document saved."); }
            catch (error) { $("#f201DocMsg").classList.remove("f201-ok"); $("#f201DocMsg").textContent = error.message; btn.disabled = false; }
        });
    }

    function openForm(person, opener) {
        const p = person || { name: "", rank: "", workerType: "Employee", role: "", file201: { status: "Active" } };
        const f = p.file201 || {};
        const input = (key) => {
            const [, label, kind] = fieldDef(key), id = `f201f_${key}`;
            if (kind === "status") return `<label class="form-field"><span>${esc(label)}</span><select id="${id}">${C.STATUSES.map((s) => `<option${C.statusOf(p) === s ? " selected" : ""}>${s}</option>`).join("")}</select></label>`;
            const wide = key === "address" || key === "notes" ? ` style="grid-column:1/-1"` : "";
            return `<label class="form-field"${wide}><span>${esc(label)}</span><input id="${id}" type="${kind === "date" ? "date" : "text"}" autocomplete="off" value="${esc(f[key] || "")}"></label>`;
        };
        const projectBits = mode === "project"
            ? `<label class="form-field" data-keep><span>Type</span><select id="f201Type">${C.TYPES.map((t) => `<option${C.typeOf(p) === t ? " selected" : ""}>${t}</option>`).join("")}</select></label>
               <label class="form-field" data-keep><span>Role</span><select id="f201Role"><option value="">- Select role -</option>${(project.roles || []).map((r) => `<option${String(p.role || "").toLowerCase() === String(r.name).toLowerCase() ? " selected" : ""}>${esc(r.name)}</option>`).join("")}</select></label>
               <h4 class="f201-form-h" data-keep>Pay rates (used by Payroll)</h4>
               <label class="form-field" data-keep><span>Daily rate (\u20B1)</span><input id="f201Daily" type="number" min="0" step="0.01" value="${esc(p.dailyRate || "")}"></label>
               <label class="form-field" data-keep><span>Hourly rate (\u20B1) <small class="mp-hint">optional</small></span><input id="f201Hourly" type="number" min="0" step="0.01" value="${esc(p.hourlyRate || "")}"></label>
               <label class="form-field" data-keep><span>OT rate (\u20B1/hr)</span><input id="f201Ot" type="number" min="0" step="0.01" value="${esc(p.otRate || "")}"></label>`
            : "";
        const groups = C.GROUPS.map(([title, keys], i) => `<h4 class="f201-form-h">${esc(title)}</h4>${i === 0 ? `<label class="form-field" data-keep><span>Name *</span><input id="f201Name" required value="${esc(p.name)}"></label>
                <label class="form-field f201-rank"><span>Rank</span><input id="f201Rank" list="f201Ranks" placeholder="e.g. Skilled 1, Laborer" value="${esc(p.rank || "")}"><datalist id="f201Ranks">${[...new Set(people().map((x) => String(x.rank || "").trim()).filter(Boolean))].map((r) => `<option value="${esc(r)}"></option>`).join("")}</datalist></label>${projectBits}` : ""}${keys.map(input).join("")}`).join("");
        openModal(`<h3>${person ? "Edit 201 file" : (mode === "company" ? "Add employee" : "Add person")}</h3>
            <form id="f201Form" autocomplete="off"><div class="form-grid f201-form-grid">${groups}</div>
            <p class="f201-error" id="f201Msg" role="alert"></p>
            <div class="form-actions"><button type="submit" class="primary-button">Save 201 file</button><button type="button" class="secondary-button" data-act="close">Cancel</button></div></form>`, opener);
        $("#f201Form").addEventListener("submit", (e) => { e.preventDefault(); submitForm(person); });
        if (mode === "project") {
            const sync = () => {
                const sub = $("#f201Type").value === "Subcontracted";
                [...document.querySelectorAll(".f201-form-grid > *")].forEach((el) => { if (!el.hasAttribute("data-keep")) el.hidden = sub; });
            };
            $("#f201Type").addEventListener("change", sync); sync();
        }
        $("#f201Name").focus();
    }

    // ---- Excel export (hard copy) ----
    const stamp = () => new Date().toISOString().slice(0, 10);
    const safeName = (t) => String(t || "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "file";
    function scopeTitle() { return mode === "company" ? "Human Resources - Company 201 Files" : `Project 201 Files - ${project.projectName}`; }
    function exportList() {
        const keys = C.GROUPS.flatMap(([, k]) => k).filter((k) => k !== "status");
        const head = ["No.", "Name", ...(mode === "project" ? ["Type", "Role"] : []), "Rank", "Status", ...keys.map((k) => fieldDef(k)[1]), ...C.REQUIRED_DOCS.map((k) => C.docLabel(k)), "Other documents", "Missing documents"];
        const list = sortedPeople().filter((p) => !(mode === "project" && C.isSubcontracted(p)));
        const rows = list.map((p, i) => {
            const docs = C.docsOf(ownerOf(p).rec), miss = C.missingDocs(ownerOf(p).rec);
            const others = docs.filter((d) => !C.REQUIRED_DOCS.includes(d.kind)).map((d) => `${C.docLabel(d.kind)} (${d.name})`).join("; ");
            return [i + 1, p.name, ...(mode === "project" ? [C.typeOf(p), p.role || ""] : []), p.rank || "", C.statusOf(p), ...keys.map((k) => displayValue(p, k)),
                ...C.REQUIRED_DOCS.map((k) => (docs.some((d) => d.kind === k) ? "Yes" : "MISSING")), others, miss.map(C.docLabel).join(", ")];
        });
        const widths = head.map((h) => (h === "No." ? 6 : h === "Name" ? 28 : /Address|Notes|Other|Missing/.test(h) ? 34 : /Position|Role|Emergency contact/.test(h) ? 24 : 16));
        const info = [[{ v: scopeTitle(), s: "title" }], [`Exported ${formatDate(stamp())} \u00B7 ${list.length} record${list.length === 1 ? "" : "s"} \u00B7 contains personal information, keep this file private`]];
        window.CbcXlsx.download(window.CbcXlsx.build([
            { name: "201 Files", header: true, widths, rows: [head, ...rows], landscape: true },
            { name: "About", widths: [90], rows: info.map((r) => r) },
        ]), `${mode === "company" ? "HR-201-Files" : "Project-201-" + safeName(project.projectName)}-${stamp()}.xlsx`);
    }
    function exportOne(person) {
        const o = ownerOf(person), docs = C.docsOf(o.rec), miss = C.missingDocs(o.rec);
        const rows = [[{ v: "201 FILE", s: "title" }, ""], [{ v: scopeTitle(), s: "label" }, ""], [{ v: "Name", s: "label" }, person.name], [{ v: "Rank", s: "label" }, person.rank || ""]];
        if (mode === "project") rows.push([{ v: "Type", s: "label" }, C.typeOf(person)], [{ v: "Role", s: "label" }, person.role || ""]);
        C.GROUPS.forEach(([title, keys]) => { rows.push([{ v: title, s: "section" }, { v: "", s: "section" }]); keys.forEach((k) => rows.push([{ v: fieldDef(k)[1], s: "label" }, displayValue(person, k)])); });
        rows.push([{ v: "Documents", s: "section" }, { v: "", s: "section" }]);
        C.REQUIRED_DOCS.forEach((k) => rows.push([{ v: C.docLabel(k) + " (required)", s: "label" }, miss.includes(k) ? "MISSING" : docs.filter((d) => d.kind === k).map((d) => d.name).join("; ")]));
        docs.filter((d) => !C.REQUIRED_DOCS.includes(d.kind)).forEach((d) => rows.push([{ v: C.docLabel(d.kind), s: "label" }, d.name]));
        rows.push([{ v: "Exported", s: "label" }, formatDate(stamp())]);
        window.CbcXlsx.download(window.CbcXlsx.build([{ name: "201 File", widths: [30, 56], rows, merges: ["A1:B1"] }]), `201-${safeName(person.name)}-${stamp()}.xlsx`);
    }

    function submitForm(existing) {
        const name = $("#f201Name").value.trim();
        if (!name) { $("#f201Msg").textContent = "Name is required."; return; }
        const clash = people().find((p) => p.id !== (existing && existing.id) && String(p.name).trim().toLowerCase() === name.toLowerCase());
        // An existing person keeps their name untouched when edited, even if an old duplicate pair exists.
        const renamed = !existing || String(existing.name).trim().toLowerCase() !== name.toLowerCase();
        if (clash && renamed) { $("#f201Msg").textContent = `${name} already has a 201 file here.`; return; }
        const file201 = {};
        C.FIELDS.forEach(([key]) => { file201[key] = $(`#f201f_${key}`).value.trim(); });
        const person = { ...(existing || { id: createId(), createdAt: new Date().toISOString() }), name, rank: $("#f201Rank").value.trim(), file201, updatedAt: new Date().toISOString() };
        if (mode === "project") {
            person.workerType = $("#f201Type").value;
            person.role = $("#f201Role").value;
            person.dailyRate = Number($("#f201Daily").value) || 0;
            person.hourlyRate = Number($("#f201Hourly").value) || 0;
            person.otRate = Number($("#f201Ot").value) || 0;
            if (person.workerType === "Subcontracted") person.rank = "";
        }
        savePerson(person);
        // One person, one truth: a change made in HR reaches the copies in projects, and a change made to a project
        // copy that came from HR reaches HR (and from there the person's other projects).
        if (mode === "company") syncLinkedProjects(person);
        else if (person.companyId && person.workerType !== "Subcontracted") {
            const list = loadCompany201(), i = list.findIndex((c) => c.id === person.companyId);
            if (i >= 0) { list[i] = { ...list[i], name, rank: person.rank, file201: { ...file201 }, updatedAt: person.updatedAt }; saveCompany201(list); syncLinkedProjects(list[i]); }
        }
        closeModal();
        render();
    }
    function syncLinkedProjects(company) {
        const projects = loadProjects();
        let changed = false;
        const next = projects.map((pr) => {
            if (!(pr.workers || []).some((w) => w.companyId === company.id)) return pr;
            changed = true;
            return { ...pr, workers: pr.workers.map((w) => (w.companyId === company.id ? { ...w, name: company.name, rank: company.rank || "", file201: { ...(company.file201 || {}) } } : w)) };
        });
        if (changed) saveProjects(next);
        if (mode === "project") { const fresh = getProjectById(project.id); if (fresh) project = fresh; }
    }

    // Project mode: copy a person from the Company 201 into this project.
    function openCompanyPicker(opener) {
        const used = new Set((project.workers || []).map((w) => w.companyId).filter(Boolean));
        const available = loadCompany201().filter((p) => !used.has(p.id) && C.statusOf(p) === "Active");
        openModal(`<h3>Add from Company 201</h3>${available.length
            ? `<p class="f201-hint">Choose who joins this project. Their 201 details are copied; set their pay rates in Payroll.</p><ul class="f201-pick">${available.map((p) => `<li><label><input type="checkbox" value="${esc(p.id)}"> <strong>${esc(p.name)}</strong> <small>${esc([p.rank, (p.file201 || {}).position].filter(Boolean).join(" · "))}</small></label></li>`).join("")}</ul>
               <div class="form-actions"><button type="button" class="primary-button" data-act="pick-add">Add to project</button><button type="button" class="secondary-button" data-act="close">Cancel</button></div>`
            : `<p class="empty-state">No active company employees left to add. Create them in Company 201 first.</p><div class="form-actions"><button type="button" class="secondary-button" data-act="close">Close</button></div>`}`, opener);
    }
    function addPicked() {
        const ids = [...document.querySelectorAll(".f201-pick input:checked")].map((i) => i.value);
        if (!ids.length) { closeModal(); return; }
        const workers = [...(project.workers || [])];
        const lowerNames = new Set(workers.map((w) => String(w.name).trim().toLowerCase()));
        const skipped = [];
        loadCompany201().filter((p) => ids.includes(p.id)).forEach((p) => {
            if (lowerNames.has(String(p.name).trim().toLowerCase())) { skipped.push(p.name); return; }
            lowerNames.add(String(p.name).trim().toLowerCase());
            const role = (project.roles || []).find((r) => String(r.name).toLowerCase() === String((p.file201 || {}).position || "").toLowerCase());
            workers.push({ id: createId(), companyId: p.id, name: p.name, workerType: "Employee", role: role ? role.name : "", rank: p.rank || "", file201: { ...(p.file201 || {}) }, dailyRate: 0, hourlyRate: 0, otRate: 0, createdAt: new Date().toISOString() });
        });
        project = upsertProject({ ...project, workers });
        closeModal();
        render();
        if (skipped.length) {
            window.CashbookDialogs.alert(`${skipped.length === 1 ? "This person was" : "These people were"} not added because a worker with the same name is already in this project: ${skipped.join(", ")}. Open the existing worker and link or rename them if they are the same person.`, { title: "Some people were skipped" });
        }
    }

    let currentView = null;
    function docMeta(id) {
        if (!currentView) return null;
        const fresh = find(currentView.id) || currentView;
        return C.docsOf(ownerOf(fresh).rec).find((d) => d.id === id) || null;
    }

    // ---- Wiring -----------------------------------------------------------
    document.addEventListener("click", async (e) => {
        const el = e.target.closest("[data-act]");
        if (!el) return;
        const person = el.dataset.id ? find(el.dataset.id) : null;
        switch (el.dataset.act) {
            case "add": openForm(null, el); break;
            case "add-company": openCompanyPicker(el); break;
            case "view": if (person) { currentView = person; openView(person, el); } break;
            case "edit": if (person) openForm(person, modalOpener || el); break;
            case "delete": {
                if (!person) break;
                const msg = mode === "company"
                    ? `Delete the 201 file of ${person.name}, including scanned documents? Copies in projects stay as project workers. Mark them Inactive instead if you want to keep the record.`
                    : `Remove ${person.name} from this project? Their past payroll entries stay in the Payroll Log.${person.companyId ? " Their documents stay in Human Resources." : " Any scanned documents kept only here are deleted."}`;
                if (await window.CashbookDialogs.confirm(msg, { title: mode === "company" ? "Delete 201 file" : "Remove from project", confirmText: mode === "company" ? "Delete" : "Remove", danger: true })) { removePerson(person.id); render(); }
                break;
            }
            case "role-up": case "role-edit": case "role-del": roleAction(el.dataset.act, el.dataset.id); break;
            case "doc-view": { const m = docMeta(el.dataset.doc); if (m) viewDocument(m); break; }
            case "doc-download": { const m = docMeta(el.dataset.doc); if (m) downloadDocument(m); break; }
            case "viewer-close": closeViewer(); break;
            case "doc-delete": {
                const m = docMeta(el.dataset.doc);
                if (m && currentView && await window.CashbookDialogs.confirm(`Delete "${m.name}"? This removes the scanned file.`, { title: "Delete document", confirmText: "Delete", danger: true })) {
                    removeDocument(currentView, m.id); render(); openView(find(currentView.id) || currentView, modalOpener, "Document deleted.");
                }
                break;
            }
            case "export-all": exportList(); break;
            case "export-one": if (person) exportOne(person); break;
            case "print": { const v = window.CashbookPrintPreviewV3 || window.CashbookPrintPreview; if (v) v.open(); break; }
            case "pick-add": addPicked(); break;
            case "close": closeModal(); break;
        }
    });
    let searchTimer = null;
    $("#f201Search").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(render, 120); });
    if (mode === "project") wireRoles();
    render();
})();
