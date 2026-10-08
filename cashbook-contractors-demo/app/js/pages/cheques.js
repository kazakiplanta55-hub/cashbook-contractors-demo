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

    const loaded = loadProjectFromUrl();
    if (!loaded) {
        return;
    }

    let project = loaded.project;
    let openStatusMenu = null;
    const view = { filter: "all", query: "" };
    const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + "s")}`;
    function toView(selector, options) { const el = get(selector); if (el && el.scrollIntoView) el.scrollIntoView(options); }

    function daysUntil(dateStr) {
        if (!dateStr) return null;
        const today = new Date(getTodayValue() + "T00:00:00");
        const d = new Date(dateStr + "T00:00:00");
        return Math.round((d - today) / 86400000);
    }

    function resolveStatus(cheque) {
        // Explicit statuses take priority
        if (cheque.status === "Cleared" || cheque.status === "Completed") return "Cleared";
        if (cheque.status === "Bounced") return "Bounced";

        const days = daysUntil(cheque.maturityDate || cheque.dueDate);
        if (days === null) return "Pending";
        if (days < 0) return "Matured";
        if (days <= 7) return "Near Matured";
        return "Pending";
    }

    function statusClass(status) {
        const map = {
            Cleared: "cleared",
            Completed: "cleared",
            Bounced: "bounced",
            Matured: "matured",
            "Near Matured": "near-matured",
            Pending: "pending",
        };
        return map[status] || "pending";
    }

    const isOpen = (cheque) => { const s = resolveStatus(cheque); return s !== "Cleared" && s !== "Bounced"; };
    const maturityOf = (cheque) => cheque.maturityDate || cheque.dueDate || "";

    // ---- Summary tiles ----
    function refreshSummary() {
        const cheques = project.chequeEntries || [];
        const issuedOpen = cheques.filter((c) => c.type === "issued" && isOpen(c));
        const receivedOpen = cheques.filter((c) => c.type === "received" && isOpen(c));
        const matured = cheques.filter((c) => resolveStatus(c) === "Matured");
        const soon = cheques.filter((c) => resolveStatus(c) === "Near Matured");

        get("#pendingIssuedTotal").textContent = formatMoney(sumMoney(issuedOpen, (c) => c.amount));
        get("#pendingIssuedNote").textContent = issuedOpen.length ? `${plural(issuedOpen.length, "cheque")} you still pay` : "Nothing outstanding";
        get("#pendingReceivedTotal").textContent = formatMoney(sumMoney(receivedOpen, (c) => c.amount));
        get("#pendingReceivedNote").textContent = receivedOpen.length ? `${plural(receivedOpen.length, "cheque")} still to come in` : "Nothing outstanding";

        get("#overdueCount").textContent = matured.length;
        get("#maturedNote").textContent = matured.length ? `${formatMoney(sumMoney(matured, (c) => c.amount))} past maturity, not cleared` : "None past maturity";
        get("#maturedTile").classList.toggle("warn", matured.length > 0);

        get("#dueSoonCount").textContent = soon.length;
        get("#dueSoonNote").textContent = soon.length ? `${formatMoney(sumMoney(soon, (c) => c.amount))} maturing soon` : "Nothing coming up";
        get("#soonTile").classList.toggle("warn", soon.length > 0);
    }

    // ---- Status menu ----
    function closeStatusMenus() {
        document.querySelectorAll(".status-menu").forEach((m) => m.remove());
        openStatusMenu = null;
    }

    function showStatusMenu(btn, chequeId) {
        closeStatusMenus();
        const menu = document.createElement("div");
        menu.className = "status-menu";
        const statuses = ["Pending", "Cleared", "Bounced"];
        menu.innerHTML = statuses
            .map(
                (s) =>
                    `<button type="button" data-status="${s}">
                        <span class="status-badge-btn ${statusClass(s)}" style="pointer-events:none; margin-right:6px;">${s}</span>
                     </button>`
            )
            .join("");

        const rect = btn.getBoundingClientRect();
        menu.style.position = "fixed";
        menu.style.visibility = "hidden";
        document.body.appendChild(menu);
        openStatusMenu = menu;

        // Position after appending so we can measure the menu's real size,
        // then flip above the button (or clamp horizontally) if it would
        // otherwise run off the edge of the window.
        const menuRect = menu.getBoundingClientRect();
        const margin = 8;
        let top = rect.bottom + 4;
        if (top + menuRect.height > window.innerHeight - margin) {
            top = rect.top - menuRect.height - 4;
        }
        top = Math.max(margin, Math.min(top, window.innerHeight - menuRect.height - margin));

        let left = rect.left;
        left = Math.max(margin, Math.min(left, window.innerWidth - menuRect.width - margin));

        menu.style.top = top + "px";
        menu.style.left = left + "px";
        menu.style.visibility = "visible";

        menu.querySelectorAll("button").forEach((b) => {
            b.addEventListener("click", async () => {
                const cheque = project.chequeEntries.find((c) => c.id === chequeId);
                if (!cheque) return;
                const newStatus = b.dataset.status;
                const prev = cheque.status;

                cheque.status = newStatus;
                if (newStatus === "Cleared" || newStatus === "Completed") {
                    cheque.status = "Cleared";
                    cheque.clearedDate = getTodayValue();
                    if (prev !== "Cleared") {
                        const direction = cheque.type === "issued" ? "expense" : "income";
                        const posting = postProjectTransaction(project, direction, {
                            sourceType: "cheque", sourceId: cheque.id, date: cheque.clearedDate,
                            amount: cheque.amount,
                            description: `Cheque #${cheque.chequeNumber} (${cheque.bankName}) — ${cheque.partyName}`,
                            referenceNo: cheque.chequeNumber, category: "Other",
                            auditSummary: `Cleared and posted cheque #${cheque.chequeNumber}`,
                        });
                        if (!posting.ok) {
                            await window.CashbookDialogs.alert("This cheque is already posted. Its financial transaction was not duplicated.", { title: "Duplicate posting blocked" });
                        }
                    }
                } else if (newStatus === "Bounced") {
                    cheque.status = "Bounced";
                } else {
                    cheque.status = "Pending";
                }

                if (prev === "Cleared" && newStatus !== "Cleared") {
                    const direction = cheque.type === "issued" ? "expense" : "income";
                    reverseProjectTransaction(project, direction, "cheque", cheque.id, `Cheque changed from Cleared to ${newStatus}`);
                    cheque.clearedDate = "";
                }
                appendProjectAudit(project, "STATUS", "cheque", cheque.id, `Cheque #${cheque.chequeNumber}: ${prev || "Pending"} to ${newStatus}`);

                project = upsertProject(project);
                closeStatusMenus();
                refreshSummary();
                renderCheques();
            });
        });
    }

    // The menu is positioned against the window, so it must not stay behind when the page moves.
    document.addEventListener("click", (e) => {
        if (openStatusMenu && !openStatusMenu.contains(e.target) && !e.target.closest(".status-badge-btn")) {
            closeStatusMenus();
        }
    });
    document.addEventListener("scroll", closeStatusMenus, true);
    window.addEventListener("resize", closeStatusMenus);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeStatusMenus(); });

    // ---- Lists ----
    function dueText(cheque, status) {
        if (status === "Cleared") return { text: cheque.clearedDate ? `Cleared ${formatDate(cheque.clearedDate)}` : "Cleared", cls: "ok" };
        if (status === "Bounced") return { text: "Bounced", cls: "bad" };
        const days = daysUntil(maturityOf(cheque));
        if (days === null) return { text: "", cls: "" };
        if (days < 0) return { text: `Matured ${plural(-days, "day")} ago`, cls: "bad" };
        if (days === 0) return { text: "Matures today", cls: "warn" };
        if (days <= 7) return { text: `Matures in ${plural(days, "day")}`, cls: "warn" };
        return { text: `In ${plural(days, "day")}`, cls: "" };
    }

    function chequeRow(cheque) {
        const status = resolveStatus(cheque);
        const maturity = maturityOf(cheque);
        const due = dueText(cheque, status);
        const rowClass = { Matured: "is-matured", "Near Matured": "is-near", Bounced: "is-bounced", Cleared: "is-cleared" }[status] || "";
        const locked = status === "Cleared";
        return `
            <article class="cq-item ${rowClass}" data-id="${escapeHtml(cheque.id)}">
                <div class="cq-main">
                    <div class="cq-top"><strong class="cq-party">${escapeHtml(cheque.partyName)}</strong><span class="cq-amt amount-cell">${formatMoney(cheque.amount)}</span></div>
                    <div class="cq-sub">${escapeHtml(cheque.bankName)} · #${escapeHtml(cheque.chequeNumber)} · ${escapeHtml(formatDate(maturity))}${due.text ? `<span class="cq-due ${due.cls}">${escapeHtml(due.text)}</span>` : ""}</div>
                    ${cheque.notes ? `<div class="cq-note">${escapeHtml(cheque.notes)}</div>` : ""}
                </div>
                <div class="cq-side">
                    <button type="button" class="status-badge-btn ${statusClass(status)} status-toggle" data-id="${escapeHtml(cheque.id)}" aria-haspopup="menu" title="Change status">${escapeHtml(status)}</button>
                    <div class="cq-acts">
                        <button type="button" class="secondary-button edit-cheque" data-id="${escapeHtml(cheque.id)}" ${locked ? 'disabled title="Change status before editing"' : ""}>Edit</button>
                        <button type="button" class="secondary-button delete-cheque" data-id="${escapeHtml(cheque.id)}" ${locked ? 'disabled title="Change status before deleting"' : ""}>Delete</button>
                    </div>
                </div>
            </article>
        `;
    }

    function matchesFilter(cheque) {
        const status = resolveStatus(cheque);
        if (view.filter === "attention" && !(status === "Matured" || status === "Near Matured" || status === "Bounced")) return false;
        if (view.filter === "pending" && !isOpen(cheque)) return false;
        if (view.filter === "cleared" && status !== "Cleared") return false;
        if (view.filter === "bounced" && status !== "Bounced") return false;
        const q = view.query.trim().toLowerCase();
        if (!q) return true;
        return [cheque.partyName, cheque.chequeNumber, cheque.bankName, cheque.notes, String(cheque.amount), formatMoney(cheque.amount)]
            .some((v) => String(v || "").toLowerCase().includes(q));
    }

    // Open cheques first (soonest maturity at the top), then bounced, then cleared (latest first).
    function sortCheques(list) {
        const rank = (c) => { const s = resolveStatus(c); return s === "Cleared" ? 2 : s === "Bounced" ? 1 : 0; };
        return [...list].sort((a, b) => {
            const ra = rank(a), rb = rank(b);
            if (ra !== rb) return ra - rb;
            const da = maturityOf(a), db = maturityOf(b);
            if (da === db) return 0;
            return ra === 2 ? (da < db ? 1 : -1) : (da < db ? -1 : 1);
        });
    }

    function renderList(type, bodySel, emptySel, summarySel, emptyText) {
        const all = (project.chequeEntries || []).filter((c) => c.type === type);
        const shown = sortCheques(all.filter(matchesFilter));
        const open = all.filter(isOpen);
        get(summarySel).textContent = all.length
            ? `${plural(all.length, "cheque")} · ${formatMoney(sumMoney(open, (c) => c.amount))} still pending${shown.length !== all.length ? ` · showing ${shown.length}` : ""}`
            : (type === "issued" ? "You pay" : "They pay you");
        const empty = get(emptySel);
        empty.hidden = shown.length > 0;
        empty.textContent = all.length === 0 ? emptyText : "No cheques match this filter.";
        get(bodySel).innerHTML = shown.map(chequeRow).join("");
    }

    function renderCheques() {
        renderList("issued", "#issuedTableBody", "#issuedEmptyState", "#issuedSummary", "No cheques issued yet.");
        renderList("received", "#receivedTableBody", "#receivedEmptyState", "#receivedSummary", "No cheques received yet.");
    }

    // One set of listeners for both lists (rows are redrawn often).
    get("#chequeLists").addEventListener("click", async (e) => {
        const toggle = e.target.closest(".status-toggle");
        const del = e.target.closest(".delete-cheque");
        const edit = e.target.closest(".edit-cheque");
        if (toggle) { e.stopPropagation(); showStatusMenu(toggle, toggle.dataset.id); return; }
        if (del && !del.disabled) {
            if (!await window.CashbookDialogs.confirm("Delete this cheque?", { title: "Delete cheque", confirmText: "Delete", danger: true })) return;
            const cheque = project.chequeEntries.find((c) => c.id === del.dataset.id);
            if (cheque) appendProjectAudit(project, "DELETE", "cheque", cheque.id, `Deleted pending cheque #${cheque.chequeNumber}`);
            project.chequeEntries = project.chequeEntries.filter((c) => c.id !== del.dataset.id);
            if (get("#chequeForm").dataset.editId === del.dataset.id) closeForm();
            project = upsertProject(project);
            refreshSummary();
            renderCheques();
            return;
        }
        if (edit && !edit.disabled) {
            const cheque = project.chequeEntries.find((c) => c.id === edit.dataset.id);
            if (!cheque) return;
            openForm();
            get("#chequeType").value = cheque.type;
            get("#chequeNumber").value = cheque.chequeNumber;
            get("#bankName").value = cheque.bankName;
            get("#partyName").value = cheque.partyName;
            get("#chequeAmount").value = cheque.amount;
            get("#chequeDueDate").value = maturityOf(cheque);
            get("#chequeNotes").value = cheque.notes || "";
            get("#chequeForm").dataset.editId = cheque.id;
            get("#chequeForm").querySelector("button[type=submit]").textContent = "Update Cheque";
            get("#chequeFormTitle").textContent = `Edit cheque #${cheque.chequeNumber}`;
            updatePartyLabel();
            toView("#chequeFormCard", { behavior: "smooth", block: "start" });
        }
    });

    // ---- Filter and search ----
    get("#chequeFilter").addEventListener("click", (e) => {
        const b = e.target.closest("[data-filter]");
        if (!b) return;
        view.filter = b.dataset.filter;
        get("#chequeFilter").querySelectorAll("[data-filter]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        renderCheques();
    });
    let searchTimer = null;
    get("#chequeSearch").addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => { view.query = get("#chequeSearch").value; renderCheques(); }, 120);
    });

    // ---- Add / edit form ----
    function updatePartyLabel() {
        const type = get("#chequeType").value;
        const label = get("#partyLabelField").querySelector("span");
        label.textContent =
            type === "issued" ? "Payee (who you're paying) *" : "Payer (who's paying you) *";
    }

    function openForm() {
        get("#chequeFormCard").hidden = false;
        get("#chequeAddToggle").textContent = "Close form";
    }
    function closeForm() {
        const form = get("#chequeForm");
        form.reset();
        delete form.dataset.editId;
        form.querySelector("button[type=submit]").textContent = "Save Cheque";
        get("#chequeFormTitle").textContent = "Add Cheque";
        get("#chequeDueDate").value = getTodayValue();
        get("#chequeFormMessage").textContent = "";
        updatePartyLabel();
        get("#chequeFormCard").hidden = true;
        get("#chequeAddToggle").textContent = "Add Cheque";
    }

    get("#chequeAddToggle").addEventListener("click", () => {
        if (get("#chequeFormCard").hidden) { openForm(); get("#chequeType").focus({ preventScroll: true }); toView("#chequeFormCard", { behavior: "smooth", block: "start" }); }
        else closeForm();
    });
    get("#chequeCancel").addEventListener("click", closeForm);
    get("#chequeType").addEventListener("change", updatePartyLabel);

    get("#chequeForm").addEventListener("submit", (event) => {
        event.preventDefault();

        const data = {
            type: get("#chequeType").value,
            chequeNumber: get("#chequeNumber").value.trim(),
            bankName: get("#bankName").value.trim(),
            partyName: get("#partyName").value.trim(),
            amount: money(get("#chequeAmount").value),
            dueDate: get("#chequeDueDate").value,
            maturityDate: get("#chequeDueDate").value,
            notes: get("#chequeNotes").value.trim(),
        };

        if (!data.chequeNumber || !data.bankName || !data.partyName || !data.dueDate || data.amount <= 0) {
            get("#chequeFormMessage").textContent = "Please fill all required fields and enter a positive amount.";
            return;
        }

        const editId = get("#chequeForm").dataset.editId;
        const duplicate = (project.chequeEntries || []).find((cheque) =>
            cheque.id !== editId && cheque.type === data.type &&
            String(cheque.bankName || "").toLowerCase() === data.bankName.toLowerCase() &&
            String(cheque.chequeNumber || "").toLowerCase() === data.chequeNumber.toLowerCase()
        );
        if (duplicate) {
            get("#chequeFormMessage").textContent = "That cheque number is already recorded for the same bank and direction.";
            return;
        }
        if (editId) {
            const existing = project.chequeEntries.find((c) => c.id === editId);
            if (existing) {
                Object.assign(existing, data);
                appendProjectAudit(project, "UPDATE", "cheque", existing.id, `Updated pending cheque #${data.chequeNumber}`);
            }
        } else {
            project.chequeEntries = [
                ...(project.chequeEntries || []),
                {
                    id: createId(),
                    ...data,
                    status: "Pending",
                    createdAt: new Date().toISOString(),
                },
            ];
            appendProjectAudit(project, "CREATE", "cheque", project.chequeEntries.at(-1).id, `Recorded cheque #${data.chequeNumber}`);
        }

        project = upsertProject(project);
        closeForm();
        refreshSummary();
        renderCheques();
    });

    get("#chequeDueDate").value = getTodayValue();
    updatePartyLabel();
    refreshSummary();
    renderCheques();
})();
