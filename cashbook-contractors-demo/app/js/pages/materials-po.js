"use strict";

// Purchase Orders section of the Materials & Procurement page: cards, status changes and the pop-up forms.
// The rules live in js/core/po-core.js; this file only draws the screen and calls them.
(function () {
    const page = window.CbcMaterialsPage;
    if (!page || !window.CbcPo) return;

    const $ = (selector) => document.querySelector(selector);
    const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const project = () => page.getProject();
    const FILTERS = [["all", "All"], ["unpaid", "Unpaid"], ["overdue", "Overdue"], ["paid", "Paid"]];
    const STATE_LABEL = { paid: "Paid", overdue: "Overdue", partial: "Partly paid", unpaid: "Unpaid", noschedule: "No payment schedule" };
    let filter = "all";

    // Orders from older builds or imported packages may lack ids; give them ones once so every button can find its order.
    if (CbcPo.ensureIds(project())) page.setProject(upsertProject(project()));

    function niceDate(dateText) {
        const time = Date.parse(dateText);
        return Number.isNaN(time) ? "No date" : new Date(time).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    }

    // ---- Saving -------------------------------------------------------------
    // The rules functions change the project in memory; this saves it and redraws both sections.
    function commit(result) {
        if (!result.ok) return result;
        page.setProject(upsertProject(project()));
        page.renderMaterials();
        render();
        return result;
    }

    async function complain(message) {
        await window.CashbookDialogs.alert(message, { title: "Couldn't do that" });
    }

    // ---- Pop-up form --------------------------------------------------------
    let opener = null;
    function closeModal() {
        $("#poModal").hidden = true;
        $("#poModalBody").innerHTML = "";
        if (opener && opener.focus) opener.focus();
        opener = null;
    }

    // onSubmit(form) returns an error message to keep the pop-up open, or nothing to close it.
    function openModal(title, fieldsHtml, onSubmit, submitText) {
        opener = document.activeElement;
        $("#poModalTitle").textContent = title;
        $("#poModalBody").innerHTML = `
            <form id="poModalForm" novalidate>
                ${fieldsHtml}
                <p class="mp-error" id="poModalError" role="alert"></p>
                <div class="form-actions">
                    <button type="submit" class="primary-button">${submitText || "Save"}</button>
                    <button type="button" class="secondary-button" data-close>Cancel</button>
                </div>
            </form>`;
        const form = $("#poModalForm");
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            const problem = onSubmit(form);
            if (problem) $("#poModalError").textContent = problem;
            else closeModal();
        });
        $("#poModal").hidden = false;
        const first = form.querySelector("input:not([disabled]), select");
        if (first) first.focus();
        return form;
    }

    $("#poModal").addEventListener("click", (event) => {
        if (event.target === $("#poModal") || event.target.closest("[data-close]")) closeModal();
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !$("#poModal").hidden) closeModal();
    });

    const field = (id, label, input, extra = "") => `<label class="form-field ${extra}"><span>${label}</span>${input}</label>`;
    const opt = (list) => list.map((value) => `<option value="${escapeHtml(value)}"></option>`).join("");

    // ---- New / edit order ---------------------------------------------------
    function installmentRow(row = {}) {
        return `
            <div class="po-rowform">
                <input type="date" data-r="date" value="${escapeHtml(row.dueDate || "")}" aria-label="Due date">
                <input type="number" data-r="amount" min="0" step="0.01" value="${row.amount || ""}" placeholder="Amount" aria-label="Amount">
                <button type="button" class="secondary-button" data-remove-row title="Remove this installment">&times;</button>
            </div>`;
    }

    function detailFields(po, locked) {
        const suppliers = [...new Set((project().purchaseOrders || []).map((p) => p.supplier).filter(Boolean))];
        const materials = [...new Set([...CbcStock.materialNames(project().materialEntries), ...(project().purchaseOrders || []).map((p) => p.materialName)].filter(Boolean))];
        const lock = locked ? "disabled" : "";
        return `
            <datalist id="pfSuppliers">${opt(suppliers)}</datalist>
            <datalist id="pfMaterials">${opt(materials)}</datalist>
            <div class="form-grid">
                ${field("pfNumber", "PO number *", `<input id="pfNumber" type="text" value="${escapeHtml(po.poNumber)}" autocomplete="off">`)}
                ${field("pfDate", "Order date", `<input id="pfDate" type="date" value="${escapeHtml(po.orderDate || "")}">`)}
                ${field("pfSupplier", "Supplier *", `<input id="pfSupplier" list="pfSuppliers" type="text" value="${escapeHtml(po.supplier || "")}" autocomplete="off">`)}
                ${field("pfMaterial", "Material *", `<input id="pfMaterial" list="pfMaterials" type="text" value="${escapeHtml(po.materialName || "")}" autocomplete="off" ${lock}>`)}
                <div class="mp-span po-stockinfo" id="pfStockInfo" aria-live="polite"></div>
                ${field("pfQty", "Quantity *", `<input id="pfQty" type="number" min="0" step="0.01" value="${po.quantity || ""}" ${lock}>`)}
                ${field("pfUnit", "Unit *", `<input id="pfUnit" type="text" value="${escapeHtml(po.unit || "")}" placeholder="bags, pcs, kg" autocomplete="off" ${lock}>`)}
                ${field("pfPrice", "Price per unit (₱) <small class=\"mp-hint\">(fills the total)</small>", `<input id="pfPrice" type="number" min="0" step="0.01" value="${po.quantity > 0 && po.totalAmount > 0 ? Number((po.totalAmount / po.quantity).toFixed(2)) : ""}" ${lock}>`)}
                ${field("pfTotal", "PO total (₱) *", `<input id="pfTotal" type="number" min="0" step="0.01" value="${po.totalAmount || ""}" ${lock}>`)}
                ${field("pfNotes", "Notes", `<input id="pfNotes" type="text" value="${escapeHtml(po.notes || "")}" autocomplete="off">`)}
            </div>
            ${locked ? '<p class="mp-sub">This order was delivered, so material, quantity, unit and total are locked. Undo the delivery to change them.</p>' : ""}`;
    }

    // Ties the form to the stock already on the page: shows what is on hand, fills the unit and last price,
    // and keeps quantity x price = total in step. Works for a new order; a delivered order is locked, so it only shows the info.
    function wireStockHelper(form, locked) {
        const entries = () => project().materialEntries;
        const num = (selector) => Number($(selector).value) || 0;
        let lastEdited = "";   // "price" or "total": which one the person typed last decides which is recalculated
        const info = () => {
            const box = $("#pfStockInfo"), name = $("#pfMaterial").value.trim();
            if (!name) { box.textContent = ""; box.className = "mp-span po-stockinfo"; return; }
            const unit = CbcStock.unitOf(entries(), name);
            if (unit) {
                const have = CbcStock.onHand(entries(), name), last = CbcStock.lastUnitCost(entries(), name), qty = num("#pfQty");
                const after = qty > 0 && CbcStock.sameUnit(unit, $("#pfUnit").value) ? ` Once this order is delivered: <strong>${CbcStock.round(have + qty)} ${escapeHtml(unit)}</strong>.` : "";
                box.className = "mp-span po-stockinfo found";
                box.innerHTML = `Already in your stock: <strong>${have} ${escapeHtml(unit)}</strong>${last ? ` · last price <strong>${formatMoney(last)}</strong> each` : ""}. This order is <strong>added to it</strong> when you mark it delivered.${after}`;
            } else {
                const near = CbcStock.similar(entries(), name);
                box.className = "mp-span po-stockinfo" + (near.length ? " near" : "");
                box.innerHTML = near.length
                    ? `No stock named "${escapeHtml(name)}". Did you mean ${near.slice(0, 3).map((n) => `<button type="button" class="po-link" data-pick="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join(" or ")}? A different name starts a separate material.`
                    : `New material: it appears in Stock on Hand once this order is delivered.`;
            }
        };
        const pick = () => {
            if (locked) return info();
            const name = $("#pfMaterial").value.trim(), unit = CbcStock.unitOf(entries(), name);
            if (unit) {
                $("#pfUnit").value = unit;
                const last = CbcStock.lastUnitCost(entries(), name);
                if (last && !$("#pfPrice").value && !$("#pfTotal").value) { $("#pfPrice").value = last; lastEdited = "price"; recalc(); }
            }
            info();
        };
        const recalc = () => {
            const qty = num("#pfQty");
            if (lastEdited === "price" && qty > 0) { const total = Number((qty * num("#pfPrice")).toFixed(2)); $("#pfTotal").value = total || ""; }
            else if (lastEdited === "total" && qty > 0 && num("#pfTotal") > 0) $("#pfPrice").value = Number((num("#pfTotal") / qty).toFixed(2));
        };
        $("#pfMaterial").addEventListener("input", pick);
        $("#pfMaterial").addEventListener("change", pick);
        $("#pfUnit").addEventListener("input", info);
        $("#pfPrice").addEventListener("input", () => { lastEdited = "price"; recalc(); form.dispatchEvent(new Event("input")); });
        $("#pfTotal").addEventListener("input", () => { lastEdited = "total"; recalc(); });
        $("#pfQty").addEventListener("input", () => { recalc(); info(); form.dispatchEvent(new Event("input")); });
        // mousedown (not just click): the material box's own "change" redraws this hint when focus leaves it, which would swallow the click.
        const choose = (event) => {
            const choice = event.target.closest("[data-pick]");
            if (!choice) return;
            event.preventDefault();
            $("#pfMaterial").value = choice.dataset.pick; pick();
        };
        form.addEventListener("mousedown", choose);
        form.addEventListener("click", choose);
        info();
    }

    const readDetails = () => ({
        poNumber: $("#pfNumber").value, orderDate: $("#pfDate").value, supplier: $("#pfSupplier").value,
        materialName: $("#pfMaterial").value, quantity: $("#pfQty").value, unit: $("#pfUnit").value,
        totalAmount: $("#pfTotal").value, notes: $("#pfNotes").value,
    });

    function newOrder() {
        const blank = { poNumber: CbcPo.nextNumber(project(), getTodayValue()), orderDate: getTodayValue() };
        const form = openModal("New purchase order", `
            ${detailFields(blank, false)}
            <div class="po-sched-edit">
                <div class="po-sched-head"><strong>Payment schedule</strong><span class="mp-sub">Optional. You can also add payments later.</span></div>
                <div id="pfRows">${installmentRow()}</div>
                <div class="po-sched-foot">
                    <button type="button" class="secondary-button" id="pfAddRow">+ Add installment</button>
                    <span id="pfHint" class="mp-sub"></span>
                </div>
            </div>`, (f) => {
            const rows = [...f.querySelectorAll(".po-rowform")].map((row) => ({ dueDate: row.querySelector('[data-r="date"]').value, amount: row.querySelector('[data-r="amount"]').value }));
            const result = commit(CbcPo.create(project(), readDetails(), rows));
            return result.ok ? "" : result.message;
        }, "Create order");
        const hint = () => {
            const total = Number($("#pfTotal").value) || 0;
            const rows = [...form.querySelectorAll('[data-r="amount"]')].map((i) => i.value);
            const scheduled = sumMoney(rows, (v) => v);
            const left = centavosToMoney(moneyToCentavos(total) - moneyToCentavos(scheduled));
            $("#pfHint").textContent = total > 0 ? `Scheduled ${formatMoney(scheduled)} of ${formatMoney(total)} · ${left >= 0 ? formatMoney(left) + " left" : formatMoney(-left) + " too much"}` : "";
            $("#pfHint").style.color = left < 0 ? "var(--negative)" : "";
        };
        form.addEventListener("input", hint);
        wireStockHelper(form, false);
        $("#pfAddRow").addEventListener("click", () => { $("#pfRows").insertAdjacentHTML("beforeend", installmentRow()); });
        form.addEventListener("click", (event) => {
            const remove = event.target.closest("[data-remove-row]");
            if (remove) { remove.closest(".po-rowform").remove(); hint(); }
        });
    }

    function editOrder(po) {
        const locked = po.deliveryStatus === "Delivered";
        const form = openModal(`Edit ${po.poNumber}`, detailFields(po, locked), () => {
            const result = commit(CbcPo.update(project(), po.id, readDetails()));
            return result.ok ? "" : result.message;
        }, "Save changes");
        wireStockHelper(form, locked);
    }

    // ---- Status changes -----------------------------------------------------
    function payInstallment(po, item) {
        openModal(`Mark payment as paid`, `
            <p class="mp-sub">${escapeHtml(po.poNumber)} · ${escapeHtml(po.supplier || "")} · <strong>${formatMoney(item.amount)}</strong> (due ${niceDate(item.dueDate)})</p>
            <div class="form-grid">
                ${field("payDate", "Date paid *", `<input id="payDate" type="date" max="${getTodayValue()}" value="${getTodayValue()}">`)}
                ${field("payRef", "Reference <small class=\"mp-hint\">(OR / cheque no.)</small>", `<input id="payRef" type="text" autocomplete="off">`)}
            </div>
            <p class="mp-sub">This posts ${formatMoney(item.amount)} to Cash Out as a Materials expense. You can undo it later.</p>`, () => {
            const result = commit(CbcPo.markPaid(project(), po.id, item.id, { date: $("#payDate").value, reference: $("#payRef").value }));
            return result.ok ? "" : result.message;
        }, "Mark as paid");
    }

    async function undoPayment(po, item) {
        const ok = await window.CashbookDialogs.confirm(
            `Undo the ${formatMoney(item.amount)} payment on ${po.poNumber}? The Cash Out entry is reversed (not deleted), so the history stays in the audit trail.`,
            { title: "Undo payment", confirmText: "Undo payment", danger: true });
        if (!ok) return;
        const result = commit(CbcPo.undoPaid(project(), po.id, item.id));
        if (!result.ok) await complain(result.message);
    }

    function deliver(po) {
        openModal("Mark as delivered", `
            <p class="mp-sub">${escapeHtml(po.poNumber)} · <strong>${po.quantity} ${escapeHtml(po.unit || "")}</strong> of ${escapeHtml(po.materialName || "")}</p>
            <div class="form-grid">
                ${field("delDate", "Date delivered *", `<input id="delDate" type="date" max="${getTodayValue()}" value="${getTodayValue()}">`)}
                ${field("delBy", "Received by", `<input id="delBy" type="text" autocomplete="off" placeholder="Who accepted the delivery">`)}
            </div>
            <p class="mp-sub">${(() => { const unit = CbcStock.unitOf(project().materialEntries, po.materialName), have = CbcStock.onHand(project().materialEntries, po.materialName); return unit ? `Stock of ${escapeHtml(po.materialName)}: <strong>${have} ${escapeHtml(unit)}</strong> now → <strong>${CbcStock.round(have + Number(po.quantity))} ${escapeHtml(unit)}</strong> after this delivery.` : `This is a new material in your stock.`; })()}</p>
            <p class="mp-sub">The quantity is added to your stock on hand and its cost to the materials budget. It is <strong>not</strong> posted to Cash Out again, because this order's payments already are.</p>`, () => {
            const result = commit(CbcPo.markDelivered(project(), po.id, { date: $("#delDate").value, receivedBy: $("#delBy").value }));
            return result.ok ? "" : result.message;
        }, "Mark as delivered");
    }

    async function undoDelivery(po) {
        const ok = await window.CashbookDialogs.confirm(
            `Undo the delivery of ${po.poNumber}? The ${po.quantity} ${po.unit} is taken out of your stock again. Payments are not affected.`,
            { title: "Undo delivery", confirmText: "Undo delivery", danger: true });
        if (!ok) return;
        const result = commit(CbcPo.undoDelivered(project(), po.id));
        if (!result.ok) await complain(result.message);
    }

    function installmentForm(po, item) {
        const stats = CbcPo.stats(po, getTodayValue());
        const room = item ? centavosToMoney(moneyToCentavos(stats.unscheduled) + moneyToCentavos(item.amount)) : stats.unscheduled;
        openModal(item ? "Edit installment" : "Add installment", `
            <p class="mp-sub">${escapeHtml(po.poNumber)} · ${formatMoney(room)} left to schedule</p>
            <div class="form-grid">
                ${field("instDate", "Due date *", `<input id="instDate" type="date" value="${escapeHtml(item ? item.dueDate : "")}">`)}
                ${field("instAmount", "Amount (₱) *", `<input id="instAmount" type="number" min="0" step="0.01" value="${item ? item.amount : room > 0 ? room : ""}">`)}
            </div>`, () => {
            const data = { dueDate: $("#instDate").value, amount: $("#instAmount").value };
            const result = commit(item ? CbcPo.updateInstallment(project(), po.id, item.id, data) : CbcPo.addInstallment(project(), po.id, data));
            return result.ok ? "" : result.message;
        }, item ? "Save installment" : "Add installment");
    }

    async function removeInstallment(po, item) {
        const ok = await window.CashbookDialogs.confirm(`Remove the ${formatMoney(item.amount)} installment due ${niceDate(item.dueDate)} from ${po.poNumber}?`,
            { title: "Remove installment", confirmText: "Remove", danger: true });
        if (!ok) return;
        const result = commit(CbcPo.removeInstallment(project(), po.id, item.id));
        if (!result.ok) await complain(result.message);
    }

    async function deleteOrder(po) {
        const ok = await window.CashbookDialogs.confirm(`Delete ${po.poNumber} (${po.materialName || "purchase order"})? This removes the order and its payment schedule.`,
            { title: "Delete purchase order", confirmText: "Delete order", danger: true });
        if (!ok) return;
        const result = commit(CbcPo.remove(project(), po.id));
        if (!result.ok) await complain(result.message);
    }

    // ---- Drawing the cards --------------------------------------------------
    function installmentChip(item) {
        if (item.paid) return '<span class="po-chip paid">Paid</span>';
        if (item.days === null) return '<span class="po-chip">No date</span>';
        if (item.days < 0) return `<span class="po-chip overdue">Overdue ${-item.days} day${item.days === -1 ? "" : "s"}</span>`;
        if (item.days === 0) return '<span class="po-chip soon">Due today</span>';
        return `<span class="po-chip ${item.days <= 7 ? "soon" : ""}">Due in ${item.days} day${item.days === 1 ? "" : "s"}</span>`;
    }

    // One compact row per order. The payment schedule and the buttons sit in a panel that opens when the row is clicked,
    // so a long list stays easy to scan. The panel is always in the page (just hidden), so printing can show it.
    const PAGE = 10;
    let limit = PAGE, query = "";
    const open = new Set();

    function poCard(po, st) {
        const id = escapeHtml(po.id), isOpen = open.has(po.id);
        const title = po.poNumber ? escapeHtml(po.poNumber) : "Purchase order";
        const material = po.materialName ? escapeHtml(po.materialName) : "&mdash;";
        const qty = po.quantity !== undefined && po.quantity !== "" && po.quantity !== null ? `${escapeHtml(po.quantity)} ${escapeHtml(po.unit || "")}`.trim() : "&mdash;";
        const rows = st.schedule.map((item, index) => `
            <tr class="${item.overdue ? "po-row-overdue" : ""}" data-inst="${escapeHtml(item.id)}">
                <td>${index + 1}</td>
                <td>${niceDate(item.dueDate)}</td>
                <td class="po-num">${formatMoney(item.amount)}</td>
                <td>${installmentChip(item)}${item.paid && (item.paidDate || item.reference) ? `<small class="po-paidnote">${item.paidDate ? niceDate(item.paidDate) : ""}${item.reference ? ` · ${escapeHtml(item.reference)}` : ""}</small>` : ""}</td>
                <td class="po-rowactions">${item.paid
                    ? '<button type="button" class="po-link" data-act="undo-pay">Undo</button>'
                    : '<button type="button" class="po-link strong" data-act="pay">Mark paid</button><button type="button" class="po-link" data-act="edit-inst">Edit</button><button type="button" class="po-link danger" data-act="del-inst">Remove</button>'}</td>
            </tr>`).join("");
        const schedule = st.schedule.length ? `
                <div class="po-table-wrap">
                    <table class="po-sched">
                        <thead><tr><th>#</th><th>Due date</th><th class="po-num">Amount</th><th>Status</th><th></th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>` : '<p class="po-noschedule">No payment schedule yet. Add an installment to start tracking payments.</p>';
        const delivery = st.delivered ? `<span class="po-delivery done" title="Delivered ${niceDate(po.deliveredDate)}">&#10003; Delivered</span>` : '<span class="po-delivery">To deliver</span>';
        return `
            <article class="po-card ${st.state}${isOpen ? " open" : ""}" data-po="${id}">
                <div class="po-row">
                    <h3 class="po-name"><button type="button" class="po-toggle" data-toggle aria-expanded="${isOpen}" aria-controls="po-detail-${id}"><span class="po-caret" aria-hidden="true"></span>${title}</button></h3>
                    <div class="po-what" data-label="Material"><strong>${material}</strong>${po.supplier ? `<small>${escapeHtml(po.supplier)}</small>` : ""}</div>
                    <div class="po-cell" data-label="Quantity">${qty}</div>
                    <div class="po-cell po-r" data-label="Total">${formatMoney(st.total)}</div>
                    <div class="po-cell po-r ${st.balance > 0 ? "warn" : ""}" data-label="Balance">${formatMoney(st.balance)}</div>
                    <div class="po-cell po-prog" data-label="Paid">${st.schedule.length ? `<span class="po-bar" role="img" aria-label="${st.percent}% paid"><span style="width:${st.percent}%"></span></span><small>${st.percent}% paid</small>` : "&mdash;"}</div>
                    <div class="po-cell po-tags" data-label="Status"><span class="po-badge ${st.state}">${STATE_LABEL[st.state]}</span>${delivery}</div>
                </div>
                <div class="po-detail" id="po-detail-${id}" ${isOpen ? "" : "hidden"}>
                    ${st.schedule.length && st.nextDue && st.state !== "paid" ? `<p class="po-barlabel">Next payment ${niceDate(st.nextDue)}</p>` : ""}
                    ${schedule}
                    ${st.unscheduled > 0.005 && st.schedule.length ? `<p class="po-unsched">${formatMoney(st.unscheduled)} of the total is not scheduled yet.</p>` : ""}
                    <div class="po-cardactions">
                        ${st.delivered ? '<button type="button" class="secondary-button" data-act="undo-deliver">Undo delivery</button>' : '<button type="button" class="primary-button" data-act="deliver">Mark delivered</button>'}
                        <button type="button" class="secondary-button" data-act="add-inst">+ Installment</button>
                        <button type="button" class="secondary-button" data-act="edit-po">Edit</button>
                        <button type="button" class="secondary-button po-danger" data-act="del-po">Delete</button>
                    </div>
                </div>
            </article>`;
    }

    function render() {
        const orders = Array.isArray(project().purchaseOrders) ? project().purchaseOrders : [];
        const today = getTodayValue();
        const items = orders.map((po) => ({ po, st: CbcPo.stats(po, today) }));
        const list = $("#poList"), empty = $("#poEmptyState"), more = $("#poMore");

        const total = sumMoney(items, (x) => x.st.total), paid = sumMoney(items, (x) => x.st.paid);
        const overdueAmount = sumMoney(items, (x) => x.st.overdueAmount), overdueCount = items.reduce((n, x) => n + x.st.overdueCount, 0);
        $("#poTotals").innerHTML = items.length ? `
            <div class="po-total"><span>Total ordered</span><strong>${formatMoney(total)}</strong><small>${items.length} order${items.length === 1 ? "" : "s"}</small></div>
            <div class="po-total good"><span>Paid</span><strong>${formatMoney(paid)}</strong></div>
            <div class="po-total warn"><span>Still to pay</span><strong>${formatMoney(CbcPo.minus(total, paid))}</strong></div>
            <div class="po-total ${overdueCount ? "bad" : ""}"><span>Overdue</span><strong>${formatMoney(overdueAmount)}</strong><small>${overdueCount} installment${overdueCount === 1 ? "" : "s"}</small></div>` : "";

        const matches = (x, key) => key === "all" || (key === "unpaid" && x.st.balance > 0.005) || (key === "overdue" && x.st.overdueCount > 0) || (key === "paid" && x.st.state === "paid");
        const count = (key) => items.filter((x) => matches(x, key)).length;
        $("#poFilters").innerHTML = items.length
            ? FILTERS.map(([key, label]) => `<button type="button" class="po-filter${filter === key ? " active" : ""}" data-filter="${key}" aria-pressed="${filter === key}">${label} <b>${count(key)}</b></button>`).join("")
            : "";
        // Searching only becomes useful once the list is long enough to need it.
        $("#poSearch").hidden = items.length < 6;
        $("#poColHead").hidden = !items.length;

        if (!items.length) {
            list.innerHTML = ""; more.innerHTML = "";
            empty.hidden = false;
            empty.innerHTML = "<strong>No purchase orders for this project yet.</strong><br>Press <b>New Purchase Order</b> to record one, with its payment schedule.";
            return;
        }

        // Most urgent first: overdue, then the soonest next payment, then settled orders last.
        const rank = { overdue: 0, partial: 1, unpaid: 1, noschedule: 2, paid: 3 };
        const q = (items.length >= 6 ? query : "").trim().toLowerCase();
        const found = (x) => !q || [x.po.poNumber, x.po.materialName, x.po.supplier].some((v) => String(v || "").toLowerCase().includes(q));
        const shown = items.filter((x) => matches(x, filter) && found(x))
            .sort((x, y) => rank[x.st.state] - rank[y.st.state] || (Date.parse(x.st.nextDue) || Infinity) - (Date.parse(y.st.nextDue) || Infinity) || String(x.po.poNumber).localeCompare(String(y.po.poNumber)));
        empty.hidden = shown.length > 0;
        if (!shown.length) empty.textContent = q ? `No purchase orders match "${query.trim()}".` : "No purchase orders match this filter.";
        list.innerHTML = shown.slice(0, limit).map((x) => poCard(x.po, x.st)).join("");
        more.innerHTML = shown.length > limit
            ? `<span class="po-count">Showing ${limit} of ${shown.length}</span><button type="button" class="secondary-button" data-more>Show ${Math.min(PAGE, shown.length - limit)} more</button><button type="button" class="po-link" data-more-all>Show all</button>`
            : (shown.length > PAGE ? `<span class="po-count">Showing all ${shown.length}</span><button type="button" class="po-link" data-less>Show fewer</button>` : "");
    }

    // ---- Clicks ---------------------------------------------------------------
    $("#poFilters").addEventListener("click", (event) => {
        const button = event.target.closest("[data-filter]");
        if (!button) return;
        filter = button.dataset.filter;
        limit = PAGE;
        render();
    });

    let searchTimer = null;
    $("#poSearch").addEventListener("input", (event) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => { query = event.target.value; limit = PAGE; render(); }, 120);
    });

    $("#poMore").addEventListener("click", (event) => {
        if (event.target.closest("[data-more]")) limit += PAGE;
        else if (event.target.closest("[data-more-all]")) limit = Infinity;
        else if (event.target.closest("[data-less]")) limit = PAGE;
        else return;
        render();
    });

    // Open / close one order. Clicking anywhere on its row works, not just the PO number.
    function toggleOrder(card) {
        const id = card.dataset.po, willOpen = !open.has(id);
        if (willOpen) open.add(id); else open.delete(id);
        card.classList.toggle("open", willOpen);
        card.querySelector("[data-toggle]").setAttribute("aria-expanded", String(willOpen));
        card.querySelector(".po-detail").hidden = !willOpen;
    }

    $("#newPoBtn").addEventListener("click", newOrder);

    $("#poList").addEventListener("click", (event) => {
        const button = event.target.closest("[data-act]");
        if (!button) {
            const row = event.target.closest(".po-row");
            if (row) toggleOrder(row.closest("[data-po]"));
            return;
        }
        const card = button.closest("[data-po]");
        const po = card && CbcPo.findPo(project(), card.dataset.po);
        if (!po) return;
        const row = button.closest("[data-inst]");
        const item = row && (po.installments || []).find((i) => i.id === row.dataset.inst);
        const act = button.dataset.act;
        open.add(po.id);
        if (act === "pay" && item) payInstallment(po, item);
        else if (act === "undo-pay" && item) undoPayment(po, item);
        else if (act === "edit-inst" && item) installmentForm(po, item);
        else if (act === "del-inst" && item) removeInstallment(po, item);
        else if (act === "add-inst") installmentForm(po, null);
        else if (act === "deliver") deliver(po);
        else if (act === "undo-deliver") undoDelivery(po);
        else if (act === "edit-po") editOrder(po);
        else if (act === "del-po") deleteOrder(po);
    });

    page.renderPo = render;
    render();
})();
