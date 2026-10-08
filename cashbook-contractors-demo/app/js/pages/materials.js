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

    function actualMaterialCost() {
        return sumMoney((project.materialEntries || []).filter((entry) => entry.direction === "in"), (entry) => entry.amount);
    }

    function uniqueMaterialCount() {
        const set = new Set();
        (project.materialEntries || []).forEach((e) => {
            set.add(CbcStock.key(e.materialName));
        });
        set.delete("");
        return set.size;
    }

    function refreshCards() {
        const budget = money(project.materialsBudget);
        const actual = actualMaterialCost();
        const variance = centavosToMoney(moneyToCentavos(budget) - moneyToCentavos(actual));

        get("#cardMaterialsBudget").textContent = formatMoney(budget);
        get("#cardActualCost").textContent = formatMoney(actual);
        get("#cardMaterialCount").textContent = uniqueMaterialCount();

        get("#cardBudgetVsActual").textContent = formatMoney(Math.abs(variance));
        get("#cardBudgetVsActualTile").className = "mp-tile " + (variance >= 0 ? "positive" : "negative");
        get("#cardBudgetVsActualNote").textContent = budget <= 0 ? "No budget set yet" : variance >= 0 ? "Left in the budget" : "Over the budget";

        get("#materialsBudgetInput").value = project.materialsBudget || "";
        const used = budget > 0 ? Math.round((actual / budget) * 100) : 0;
        const bar = get("#budgetBar");
        bar.className = "mp-bar" + (used > 100 ? " over" : used >= 80 ? " warn" : "");
        bar.firstElementChild.style.width = Math.min(100, used) + "%";
        get("#budgetBarLabel").textContent = budget <= 0
            ? "Set a materials budget to see how much of it has been used."
            : used > 100 ? `${used}% of the budget used — over by ${formatMoney(-variance)}`
                : `${used}% of the budget used — ${formatMoney(variance)} left`;
    }

    let movFilter = "all";
    const qty = (n) => Number(Number(n).toFixed(2));

    function poOf(entry) {
        return entry.poId ? (project.purchaseOrders || []).find((po) => po.id === entry.poId) : null;
    }

    function renderStock(entries) {
        const byMaterial = {};
        entries.forEach((entry) => {
            const key = CbcStock.key(entry.materialName);
            if (!key) return;
            const row = byMaterial[key] || (byMaterial[key] = { materialName: entry.materialName, unit: entry.unit, totalIn: 0, totalOut: 0, totalCost: 0 });
            const quantity = money(entry.quantity);
            if (entry.direction === "in") { row.totalIn += quantity; row.totalCost += money(entry.amount); } else { row.totalOut += quantity; }
        });
        const rows = Object.values(byMaterial).sort((x, y) => x.materialName.localeCompare(y.materialName));
        get("#materialSummaryEmptyState").hidden = rows.length > 0;
        // One table, one row per material: easy to scan down a column. The bar shows how much of what came in is still left.
        get("#stockGrid").innerHTML = rows.length ? `
            <table class="mp-table stock-table">
                <thead><tr><th>Material</th><th>Remaining</th><th class="mp-num">In</th><th class="mp-num">Used</th><th class="mp-num">Cost</th><th></th></tr></thead>
                <tbody>${rows.map((row) => {
                    const left = qty(row.totalIn - row.totalOut);
                    const percent = row.totalIn > 0 ? Math.max(0, Math.min(100, Math.round((left / row.totalIn) * 100))) : 0;
                    const level = left < 0 ? "short" : row.totalIn > 0 && percent <= 10 ? "low" : "ok";
                    const unit = escapeHtml(row.unit);
                    return `
                    <tr>
                        <td class="stock-name"><strong>${escapeHtml(row.materialName)}</strong></td>
                        <td class="stock-left-cell">
                            <span class="stock-left ${level}">${left} <small>${unit}</small></span>
                            <span class="stock-level ${level}" role="img" aria-label="${percent}% left"><i style="width:${percent}%"></i></span>
                        </td>
                        <td class="mp-num">${qty(row.totalIn)} <small class="stock-unit">${unit}</small></td>
                        <td class="mp-num">${qty(row.totalOut)} <small class="stock-unit">${unit}</small></td>
                        <td class="mp-num">${formatMoney(row.totalCost)}</td>
                        <td><div class="mp-row-actions">
                            <button type="button" class="primary-button stock-use" data-material="${escapeHtml(row.materialName)}" ${left <= 0 ? "disabled title=\"Nothing left to use\"" : ""}>Use</button>
                            <button type="button" class="secondary-button stock-receive" data-material="${escapeHtml(row.materialName)}">Receive</button>
                        </div></td>
                    </tr>`;
                }).join("")}</tbody>
            </table>` : "";
    }

    function renderMaterials() {
        const entries = project.materialEntries || [];
        renderStock(entries);

        const matches = (entry, key) => key === "all" || entry.direction === key;
        const count = (key) => entries.filter((entry) => matches(entry, key)).length;
        get("#movFilters").innerHTML = entries.length
            ? [["all", "All"], ["in", "In"], ["out", "Out"]].map(([key, label]) =>
                `<button type="button" class="po-filter${movFilter === key ? " active" : ""}" data-filter="${key}" aria-pressed="${movFilter === key}">${label} <b>${count(key)}</b></button>`).join("")
            : "";

        const balances = CbcStock.runningBalances(entries);
        get("#materialNameList").innerHTML = CbcStock.materialNames(entries).map((name) => `<option value="${escapeHtml(name)}"></option>`).join("");
        const sortedEntries = entries.filter((entry) => matches(entry, movFilter))
            .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
        get("#materialLogEmptyState").hidden = entries.length > 0;
        document.querySelector(".mp-table-wrap").hidden = entries.length === 0;

        get("#materialLogBody").innerHTML = sortedEntries
            .map((entry) => {
                const po = poOf(entry);
                const posted = entry.direction === "in" && !entry.poId && Boolean(findPostedSourceEntry(project, "expense", "material-batch", entry.id));
                const locked = posted || Boolean(entry.poId);
                const lockedWhy = entry.poId ? `Managed by ${po ? po.poNumber : "its purchase order"} — use Undo delivery there` : "Reverse its Cash Out first";
                const people = [entry.handledBy ? `Handled: ${escapeHtml(entry.handledBy)}` : "", entry.receivedBy ? `Received: ${escapeHtml(entry.receivedBy)}` : ""].filter(Boolean);
                return `
                    <tr>
                        <td class="mp-check">${entry.direction === "in" && !entry.poId
                            ? `<input type="checkbox" class="mat-select" data-id="${entry.id}" ${posted ? "disabled" : ""} title="${posted ? "Already posted to Cash Out" : "Select to post"}">` : ""}</td>
                        <td>${formatDate(entry.date)}${entry.deliveryDate && entry.deliveryDate !== entry.date ? `<small>Delivered ${formatDate(entry.deliveryDate)}</small>` : ""}</td>
                        <td><strong>${escapeHtml(entry.materialName)}</strong></td>
                        <td><span class="mp-chip ${entry.direction === "in" ? "in" : "out"}">${entry.direction === "in" ? "In" : "Out"}</span>${entry.direction === "out" && entry.reason ? `<small>${escapeHtml(entry.reason)}</small>` : ""}</td>
                        <td class="mp-num">${entry.direction === "in" ? "+" : "−"}${qty(entry.quantity)} ${escapeHtml(entry.unit)}</td>
                        <td class="mp-num"><strong>${qty(balances[entry.id])}</strong> <small class="stock-unit">${escapeHtml(entry.unit)}</small></td>
                        <td class="mp-num">${entry.direction === "in" ? formatMoney(entry.amount) : "—"}</td>
                        <td>${people.length ? people.map((line) => `<small>${line}</small>`).join("") : "—"}</td>
                        <td class="mp-notes">${escapeHtml(entry.notes) || "—"}${entry.poId ? `<br><span class="mp-tag" title="The purchase order's payments are the cash-out for this delivery">Paid via ${escapeHtml(po ? po.poNumber : "PO")}</span>` : ""}${posted ? '<br><span class="mp-tag posted">Posted to Cash Out</span>' : ""}</td>
                        <td><div class="mp-row-actions">
                            <button type="button" class="secondary-button edit-material" data-id="${entry.id}" ${locked ? `disabled title="${lockedWhy}"` : ""}>Edit</button>
                            <button type="button" class="secondary-button delete-material" data-id="${entry.id}" ${locked ? `disabled title="${lockedWhy}"` : ""}>Delete</button>
                        </div></td>
                    </tr>
                `;
            })
            .join("");

        refreshCards();
    }

    // Edit / Delete / filter clicks are handled once here instead of re-binding after every redraw.
    get("#materialLogBody").addEventListener("click", async (event) => {
        const del = event.target.closest(".delete-material");
        const edit = event.target.closest(".edit-material");
        if (del && !del.disabled) {
            const removed = (project.materialEntries || []).find((entry) => entry.id === del.dataset.id);
            if (!removed || removed.poId) return;
            const blocked = CbcStock.checkRemoval(project.materialEntries, removed.id);
            if (blocked) { await window.CashbookDialogs.alert(blocked, { title: "Can't delete this movement" }); return; }
            project.materialEntries = (project.materialEntries || []).filter((entry) => entry.id !== del.dataset.id);
            appendProjectAudit(project, "DELETE", "material", removed.id, `Deleted unposted material movement: ${removed.materialName}`);
            project = upsertProject(project);
            renderMaterials();
            renderPoSection();
        } else if (edit && !edit.disabled) {
            const entry = project.materialEntries.find((e) => e.id === edit.dataset.id);
            if (!entry || entry.poId) return;
            get("#materialEditId").value = entry.id;
            get("#materialName").value = entry.materialName;
            get("#materialDirection").value = entry.direction;
            get("#materialDate").value = entry.date;
            get("#materialDeliveryDate").value = entry.deliveryDate || "";
            get("#materialQuantity").value = entry.quantity;
            get("#materialUnit").value = entry.unit;
            get("#materialUnitCost").value = entry.unitCost || "";
            get("#materialHandledBy").value = entry.handledBy || "";
            get("#materialReceivedBy").value = entry.receivedBy || "";
            get("#materialNotes").value = entry.notes || "";
            applyDirection(entry.direction);
            if (entry.direction === "out") get("#materialReason").value = entry.reason || CbcStock.OUT_REASONS[0];
            updateOnHand();
            get("#materialFormTitle").textContent = "Edit Material Movement";
            get("#materialFormSubmit").textContent = "Save Changes";
            showMovementForm(true);
        }
    });

    get("#movFilters").addEventListener("click", (event) => {
        const button = event.target.closest("[data-filter]");
        if (!button) return;
        movFilter = button.dataset.filter;
        renderMaterials();
    });

    // The movements section can be collapsed; the choice is remembered on this device.
    const MOV_COLLAPSE_KEY = "cbc.materials.movementsCollapsed";
    function setMovementsCollapsed(collapsed, remember) {
        get("#mpMovements").classList.toggle("is-collapsed", collapsed);
        get("#movToggle").setAttribute("aria-expanded", String(!collapsed));
        if (remember) {
            try { localStorage.setItem(MOV_COLLAPSE_KEY, collapsed ? "1" : "0"); } catch (error) { /* storage unavailable */ }
        }
    }
    try { setMovementsCollapsed(localStorage.getItem(MOV_COLLAPSE_KEY) === "1", false); } catch (error) { /* keep expanded */ }
    get("#movToggle").addEventListener("click", () => {
        setMovementsCollapsed(!get("#mpMovements").classList.contains("is-collapsed"), true);
    });
    // Jumping to the section from the top bar opens it.
    document.querySelector('.mp-nav a[href="#mpMovements"]').addEventListener("click", () => setMovementsCollapsed(false, true));

    // The movement form stays out of the way until it is needed.
    function showMovementForm(show) {
        if (show) setMovementsCollapsed(false, false);
        get("#materialFormCard").hidden = !show;
        if (show) {
            if (get("#materialFormCard").scrollIntoView) get("#materialFormCard").scrollIntoView({ behavior: "smooth", block: "center" });
            get("#materialName").focus({ preventScroll: true });
        }
    }

    function resetMovementForm() {
        get("#materialForm").reset();
        get("#materialEditId").value = "";
        get("#materialFormTitle").textContent = "Add Material Movement";
        get("#materialFormSubmit").textContent = "Save Movement";
        get("#materialFormMessage").textContent = "";
        applyDirection("in");
        get("#materialOnHand").textContent = "";
        get("#materialDate").value = getTodayValue();
    }

    get("#openMovementForm").addEventListener("click", () => {
        resetMovementForm();
        showMovementForm(true);
    });

    get("#materialReason").innerHTML = CbcStock.OUT_REASONS.map((reason) => `<option>${escapeHtml(reason)}</option>`).join("");

    // In needs a cost and a delivery date; Out needs a reason instead.
    function applyDirection(direction) {
        get("#materialDirection").value = direction;
        get("#materialUnitCostField").hidden = direction !== "in";
        get("#materialDeliveryField").hidden = direction !== "in";
        get("#materialReasonField").hidden = direction !== "out";
    }

    // Shows how much is on hand while the person types, so they know before they save.
    function updateOnHand() {
        const name = get("#materialName").value.trim();
        const note = get("#materialOnHand");
        if (!name || !CbcStock.unitOf(project.materialEntries, name)) { note.textContent = ""; return; }
        const have = CbcStock.onHand(project.materialEntries, name, get("#materialEditId").value || undefined);
        note.textContent = `On hand: ${have} ${CbcStock.unitOf(project.materialEntries, name)}`;
    }

    // Picking an existing material fills in its unit (and last price for a new delivery).
    function fillKnownMaterial() {
        const name = get("#materialName").value.trim();
        const unit = CbcStock.unitOf(project.materialEntries, name);
        if (unit && !get("#materialEditId").value) {
            get("#materialUnit").value = unit;
            if (get("#materialDirection").value === "in" && !get("#materialUnitCost").value) {
                const last = CbcStock.lastUnitCost(project.materialEntries, name);
                if (last) get("#materialUnitCost").value = last;
            }
        }
        updateOnHand();
    }
    get("#materialName").addEventListener("input", fillKnownMaterial);
    get("#materialName").addEventListener("change", fillKnownMaterial);

    get("#materialDirection").addEventListener("change", (event) => {
        applyDirection(event.target.value);
        fillKnownMaterial();
    });

    // "Use" / "Receive" beside a material in Stock on hand: opens the form with the material already filled in.
    get("#stockGrid").addEventListener("click", (event) => {
        const use = event.target.closest(".stock-use");
        const receive = event.target.closest(".stock-receive");
        const button = use || receive;
        if (!button || button.disabled) return;
        resetMovementForm();
        get("#materialName").value = button.dataset.material;
        applyDirection(use ? "out" : "in");
        fillKnownMaterial();
        showMovementForm(true);
        get("#materialQuantity").focus({ preventScroll: true });
    });

    get("#materialFormCancel").addEventListener("click", () => {
        resetMovementForm();
        showMovementForm(false);
    });

    get("#materialForm").addEventListener("submit", (event) => {
        event.preventDefault();

        const materialName = get("#materialName").value.trim();
        const direction = get("#materialDirection").value;
        const date = get("#materialDate").value;
        const quantity = get("#materialQuantity").value;
        const unit = get("#materialUnit").value.trim();

        if (!materialName || !date || Number(quantity) <= 0 || !unit) {
            get("#materialFormMessage").textContent =
                "Material name, date, quantity, and unit are required.";
            return;
        }

        const unitCost = direction === "in" ? get("#materialUnitCost").value || 0 : 0;
        if (direction === "in" && Number(unitCost) <= 0) {
            get("#materialFormMessage").textContent = "Purchased or received materials require a positive unit cost.";
            return;
        }

        const data = {
            materialName,
            direction,
            date,
            deliveryDate: direction === "in" ? get("#materialDeliveryDate").value || "" : "",
            reason: direction === "out" ? get("#materialReason").value : "",
            quantity: Number(quantity) || 0,
            unit,
            unitCost: Number(unitCost) || 0,
            amount: direction === "in" ? (Number(quantity) || 0) * (Number(unitCost) || 0) : 0,
            handledBy: get("#materialHandledBy").value.trim(),
            receivedBy: get("#materialReceivedBy").value.trim(),
            notes: get("#materialNotes").value.trim(),
        };

        const editId = get("#materialEditId").value;
        if (date > getTodayValue()) {
            get("#materialFormMessage").textContent = "The date can't be in the future.";
            return;
        }
        const stockProblem = CbcStock.checkMovement(project.materialEntries, data, editId);
        if (stockProblem) {
            get("#materialFormMessage").textContent = stockProblem;
            return;
        }
        if (editId) {
            const existing = project.materialEntries.find((e) => e.id === editId);
            if (existing) {
                // The stored centavo copies win over the plain fields, so they must go or the edited cost would be ignored.
                delete existing.amountCentavos;
                delete existing.unitCostCentavos;
                Object.assign(existing, data);
                appendProjectAudit(project, "UPDATE", "material", existing.id, `Updated material movement: ${data.materialName}`);
            }
        } else {
            // Only deliveries are checked for duplicates: taking out the same quantity twice in a day is normal, and the stock check guards it.
            const duplicate = data.direction !== "in" ? null : (project.materialEntries || []).find((entry) =>
                String(entry.materialName || "").toLowerCase() === materialName.toLowerCase() &&
                entry.direction === data.direction &&
                entry.date === data.date &&
                Number(entry.quantity) === data.quantity &&
                String(entry.unit || "").toLowerCase() === unit.toLowerCase() &&
                Number(entry.unitCost) === data.unitCost &&
                String(entry.handledBy || "").toLowerCase() === data.handledBy.toLowerCase()
            );
            if (duplicate) {
                get("#materialFormMessage").textContent = "An identical material movement was already recorded for this date. Adjust a detail if this is a separate entry.";
                return;
            }
            const id = createId();
            project.materialEntries = [
                ...(project.materialEntries || []),
                { id, ...data, createdAt: new Date().toISOString() },
            ];
            appendProjectAudit(project, "CREATE", "material", id, `${data.direction === "in" ? "Stock in" : "Stock out"} ${data.quantity} ${data.unit} of ${data.materialName}${data.reason ? " (" + data.reason + ")" : ""}`);
        }

        project = upsertProject(project);
        resetMovementForm();
        showMovementForm(false);
        renderMaterials();
    });

    get("#budgetForm").addEventListener("submit", (e) => {
        e.preventDefault();
        project.materialsBudget = money(get("#materialsBudgetInput").value);
        appendProjectAudit(project, "UPDATE", "materials-budget", project.id, `Set materials budget to ${formatMoney(project.materialsBudget)}`);
        project = upsertProject(project);
        refreshCards();
    });

    get("#generateMaterialCashOutBtn").addEventListener("click", async () => {
        const selected = [...document.querySelectorAll(".mat-select:checked")].map(
            (cb) => cb.dataset.id
        );
        if (selected.length === 0) {
            await window.CashbookDialogs.alert("Select one or more 'In' material entries to generate cash out.");
            return;
        }

        // Stock delivered under a purchase order is paid by that order's installments, so it is never posted here.
        const entries = (project.materialEntries || []).filter((e) => selected.includes(e.id) && !e.poId);
        if (entries.length === 0) {
            await window.CashbookDialogs.alert("The selected entries belong to purchase orders. Their payments are posted from the purchase order itself.");
            return;
        }
        const total = sumMoney(entries, (entry) => entry.amount);
        const names = [...new Set(entries.map((e) => e.materialName))].join(", ");

        const posting = postProjectTransaction(project, "expense", {
            sourceType: "material-batch", sourceIds: entries.map((e) => e.id), date: getTodayValue(), amount: total,
            description: `Materials: ${names} (${entries.length} entries)`, category: "Materials",
            auditSummary: `Posted ${entries.length} material receipt(s) to Cash Out`,
        });
        if (!posting.ok) {
            await window.CashbookDialogs.alert("One or more selected material receipts are already posted. Reverse the existing Cash Out before posting them again.", { title: "Duplicate posting blocked" });
            renderMaterials();
            return;
        }
        project = upsertProject(project);
        await window.CashbookDialogs.alert(`Created cash-out of ${formatMoney(total)} for selected materials.`, { title: "Cash-out created" });
        document.querySelectorAll(".mat-select").forEach((cb) => (cb.checked = false));
    });

    // The purchase order script (materials-po.js) works on the same in-memory project, so the two never overwrite each other.
    function renderPoSection() {
        if (window.CbcMaterialsPage && typeof window.CbcMaterialsPage.renderPo === "function") window.CbcMaterialsPage.renderPo();
    }
    window.CbcMaterialsPage = {
        getProject: () => project,
        setProject: (next) => { project = next; },
        renderMaterials: () => renderMaterials(),
        renderPo: null,
    };

    get("#materialDate").value = getTodayValue();
    renderMaterials();
})();
