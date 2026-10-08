"use strict";

// Purchase order rules for the Materials & Procurement page.
//
// Every function changes the project record it is given and returns { ok, message?, ... }. The page saves afterwards
// with upsertProject(). Nothing here touches the screen.
//
// How money moves (so a purchase is never counted twice):
//   - Paying an installment posts ONE cash-out ("po-installment"). Undoing it posts a reversal.
//   - Marking an order delivered adds a "Material In" stock entry linked to the PO (poId). That entry carries the
//     cost for the materials budget, but it is NOT offered for "Post to Cash Out", because the installments are
//     the cash-out for that purchase.
const CbcPo = (() => {
    const arr = (value) => (Array.isArray(value) ? value : []);
    const text = (value) => String(value ?? "").trim();
    const cents = (value) => moneyToCentavos(value);
    const fail = (message) => ({ ok: false, message });
    const peso = (value) => formatMoney(value);
    const findPo = (project, poId) => arr(project.purchaseOrders).find((po) => po.id === poId);
    const findInstallment = (po, id) => arr(po.installments).find((item) => item.id === id);

    // A stored centavo field wins over the plain field when the project is loaded, so both are always written together.
    function setMoney(record, field, value) {
        record[field] = money(value);
        record[`${field}Centavos`] = moneyToCentavos(value);
    }

    // Orders saved by older builds or imported from a package may have no ids or no installment status.
    function ensureIds(project) {
        let changed = false;
        arr(project.purchaseOrders).forEach((po) => {
            if (!po.id) { po.id = createId(); changed = true; }
            if (Array.isArray(po.installments)) {
                po.installments.forEach((item) => {
                    if (!item.id) { item.id = createId(); changed = true; }
                    if (!item.status) { item.status = "Due"; changed = true; }
                });
            }
        });
        return changed;
    }

    function daysUntil(dateText, today) {
        const due = Date.parse(dateText);
        const base = Date.parse(today);
        return Number.isNaN(due) || Number.isNaN(base) ? null : Math.round((due - base) / 86400000);
    }

    const minus = (a, b) => Math.max(0, centavosToMoney(cents(a) - cents(b)));

    // Numbers and status for one order. Works for old records with no schedule or no total.
    function stats(po, today) {
        const schedule = arr(po.installments).map((item) => {
            const paid = item.status === "Paid";
            const days = paid ? null : daysUntil(item.dueDate, today);
            return { ...item, paid, days, overdue: !paid && days !== null && days < 0 };
        });
        schedule.sort((x, y) => (Date.parse(x.dueDate) || Infinity) - (Date.parse(y.dueDate) || Infinity));
        const paid = sumMoney(schedule.filter((i) => i.paid), (i) => i.amount);
        const open = sumMoney(schedule.filter((i) => !i.paid), (i) => i.amount);
        const scheduled = sumMoney(schedule, (i) => i.amount);
        const total = Number(po.totalAmount) > 0 ? money(po.totalAmount) : scheduled;
        const balance = minus(total, paid);
        const overdueCount = schedule.filter((i) => i.overdue).length;
        const overdueAmount = sumMoney(schedule.filter((i) => i.overdue), (i) => i.amount);
        const next = schedule.find((i) => !i.paid);
        let state = "unpaid";
        if (!schedule.length) state = "noschedule";
        else if (total > 0 && balance <= 0.005) state = "paid";
        else if (overdueCount) state = "overdue";
        else if (paid > 0) state = "partial";
        return {
            schedule, paid, total, balance, scheduled, open, state, overdueCount, overdueAmount,
            unscheduled: minus(total, scheduled),
            nextDue: next ? next.dueDate : "",
            percent: total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0,
            delivered: po.deliveryStatus === "Delivered",
        };
    }

    // PO-<year>-<next number>, continuing from the highest number already used that year.
    function nextNumber(project, today) {
        const year = String(today || getTodayValue()).slice(0, 4);
        let highest = 0;
        arr(project.purchaseOrders).forEach((po) => {
            const match = /^PO-(\d{4})-(\d+)$/i.exec(text(po.poNumber));
            if (match && match[1] === year) highest = Math.max(highest, Number(match[2]));
        });
        return `PO-${year}-${String(highest + 1).padStart(3, "0")}`;
    }

    // A material must keep one unit, otherwise "100 bags" and "50 pcs" would be added together as 150.
    function unitProblem(project, materialName, unit, ignorePoId) {
        const stockUnit = window.CbcStock ? CbcStock.unitOf(project.materialEntries, materialName) : "";
        const key = text(materialName).replace(/\s+/g, " ").toLowerCase();
        const poUnit = (arr(project.purchaseOrders).find((po) => po.id !== ignorePoId && text(po.unit)
            && text(po.materialName).replace(/\s+/g, " ").toLowerCase() === key) || {}).unit || "";
        const known = stockUnit || text(poUnit);
        if (known && window.CbcStock && !CbcStock.sameUnit(known, unit)) {
            return `${text(materialName)} is already recorded in ${known}. Use the same unit (not ${text(unit)}) so the stock adds up.`;
        }
        return "";
    }

    function checkDetails(project, data, ignoreId, skipUnit) {
        const poNumber = text(data.poNumber);
        if (!poNumber) return "Enter a PO number.";
        if (arr(project.purchaseOrders).some((po) => po.id !== ignoreId && text(po.poNumber).toLowerCase() === poNumber.toLowerCase())) {
            return `${poNumber} is already used in this project. Use a different PO number.`;
        }
        if (!text(data.supplier)) return "Enter the supplier.";
        if (!text(data.materialName)) return "Enter the material.";
        if (!(Number(data.quantity) > 0)) return "Quantity must be more than zero.";
        if (!text(data.unit)) return "Enter the unit (bags, pcs, kg ...).";
        if (!skipUnit) { const bad = unitProblem(project, data.materialName, data.unit, ignoreId); if (bad) return bad; }
        if (!(cents(data.totalAmount) > 0)) return "PO total must be more than zero.";
        return "";
    }

    function checkInstallment(dateText, amount) {
        if (!text(dateText) || Number.isNaN(Date.parse(dateText))) return "Pick a due date.";
        if (!(cents(amount) > 0)) return "Amount must be more than zero.";
        return "";
    }

    function applyDetails(po, data) {
        po.poNumber = text(data.poNumber);
        po.supplier = text(data.supplier);
        po.materialName = text(data.materialName);
        po.quantity = Number(data.quantity);
        po.unit = text(data.unit);
        po.orderDate = text(data.orderDate);
        po.notes = text(data.notes);
        setMoney(po, "totalAmount", data.totalAmount);
    }

    function create(project, data, installments) {
        const problem = checkDetails(project, data, null);
        if (problem) return fail(problem);
        const rows = arr(installments).filter((row) => text(row.dueDate) || cents(row.amount) > 0);
        for (const row of rows) {
            const bad = checkInstallment(row.dueDate, row.amount);
            if (bad) return fail(`Installment: ${bad}`);
        }
        const scheduled = sumMoney(rows, (row) => row.amount);
        if (cents(scheduled) > cents(data.totalAmount)) {
            return fail(`The installments add up to ${peso(scheduled)}, which is more than the PO total of ${peso(data.totalAmount)}.`);
        }
        const po = { id: createId(), deliveryStatus: "Ordered", createdAt: new Date().toISOString(), installments: [] };
        applyDetails(po, data);
        po.installments = rows.map((row) => ({ id: createId(), dueDate: row.dueDate, amount: money(row.amount), status: "Due" }));
        project.purchaseOrders = [...arr(project.purchaseOrders), po];
        appendProjectAudit(project, "CREATE", "purchase-order", po.id, `Created ${po.poNumber}: ${po.materialName} from ${po.supplier} (${peso(po.totalAmount)})`);
        return { ok: true, po };
    }

    function update(project, poId, data) {
        const po = findPo(project, poId);
        if (!po) return fail("That purchase order no longer exists.");
        const problem = checkDetails(project, data, poId, po.deliveryStatus === "Delivered");
        if (problem) return fail(problem);
        const stats_ = stats(po, getTodayValue());
        if (cents(data.totalAmount) < cents(stats_.scheduled)) {
            return fail(`The PO total can't be lower than the ${peso(stats_.scheduled)} already scheduled in installments. Change or remove an installment first.`);
        }
        if (po.deliveryStatus === "Delivered") {
            const locked = text(data.materialName) !== text(po.materialName) || Number(data.quantity) !== Number(po.quantity)
                || text(data.unit) !== text(po.unit) || cents(data.totalAmount) !== cents(po.totalAmount);
            if (locked) return fail("This order has been delivered, so its material, quantity, unit and total are locked. Undo the delivery first to change them.");
        }
        applyDetails(po, data);
        appendProjectAudit(project, "UPDATE", "purchase-order", po.id, `Updated ${po.poNumber}`);
        return { ok: true, po };
    }

    function remove(project, poId) {
        const po = findPo(project, poId);
        if (!po) return fail("That purchase order no longer exists.");
        if (po.deliveryStatus === "Delivered") return fail("This order has been delivered. Undo the delivery before deleting it.");
        if (arr(po.installments).some((item) => item.status === "Paid")) return fail("This order has payments. Undo each payment before deleting it.");
        project.purchaseOrders = arr(project.purchaseOrders).filter((item) => item.id !== poId);
        appendProjectAudit(project, "DELETE", "purchase-order", po.id, `Deleted ${po.poNumber}: ${po.materialName}`);
        return { ok: true };
    }

    function scheduledWithout(po, ignoreInstallmentId) {
        return sumMoney(arr(po.installments).filter((item) => item.id !== ignoreInstallmentId), (item) => item.amount);
    }

    function checkRoom(po, ignoreInstallmentId, amount) {
        const used = scheduledWithout(po, ignoreInstallmentId);
        const room = centavosToMoney(cents(po.totalAmount) - cents(used));
        if (cents(amount) > cents(room)) {
            return `That would schedule more than the PO total. Only ${peso(Math.max(0, room))} is left to schedule.`;
        }
        return "";
    }

    function addInstallment(project, poId, data) {
        const po = findPo(project, poId);
        if (!po) return fail("That purchase order no longer exists.");
        const bad = checkInstallment(data.dueDate, data.amount) || checkRoom(po, null, data.amount);
        if (bad) return fail(bad);
        const item = { id: createId(), dueDate: data.dueDate, amount: money(data.amount), status: "Due" };
        po.installments = [...arr(po.installments), item];
        appendProjectAudit(project, "CREATE", "po-installment", item.id, `${po.poNumber}: added installment ${peso(item.amount)} due ${item.dueDate}`);
        return { ok: true, item };
    }

    function updateInstallment(project, poId, installmentId, data) {
        const po = findPo(project, poId);
        const item = po && findInstallment(po, installmentId);
        if (!item) return fail("That installment no longer exists.");
        if (item.status === "Paid") return fail("A paid installment can't be edited. Undo the payment first.");
        const bad = checkInstallment(data.dueDate, data.amount) || checkRoom(po, installmentId, data.amount);
        if (bad) return fail(bad);
        item.dueDate = data.dueDate;
        item.amount = money(data.amount);
        appendProjectAudit(project, "UPDATE", "po-installment", item.id, `${po.poNumber}: installment is now ${peso(item.amount)} due ${item.dueDate}`);
        return { ok: true, item };
    }

    function removeInstallment(project, poId, installmentId) {
        const po = findPo(project, poId);
        const item = po && findInstallment(po, installmentId);
        if (!item) return fail("That installment no longer exists.");
        if (item.status === "Paid") return fail("A paid installment can't be removed. Undo the payment first.");
        po.installments = arr(po.installments).filter((row) => row.id !== installmentId);
        appendProjectAudit(project, "DELETE", "po-installment", item.id, `${po.poNumber}: removed installment ${peso(item.amount)} due ${item.dueDate}`);
        return { ok: true };
    }

    function markPaid(project, poId, installmentId, data) {
        const po = findPo(project, poId);
        const item = po && findInstallment(po, installmentId);
        if (!item) return fail("That installment no longer exists.");
        if (item.status === "Paid") return fail("This installment is already marked paid.");
        const date = text(data.date);
        if (!date || Number.isNaN(Date.parse(date))) return fail("Pick the date it was paid.");
        if (date > getTodayValue()) return fail("The payment date can't be in the future.");
        const posting = postProjectTransaction(project, "expense", {
            sourceType: "po-installment", sourceId: item.id, date, amount: item.amount,
            description: `${po.poNumber} — ${po.materialName} (${po.supplier}) payment`,
            referenceNo: text(data.reference), category: "Materials",
            auditSummary: `Paid ${peso(item.amount)} on ${po.poNumber}`,
        });
        if (!posting.ok) return fail("This payment is already in Cash Out, so it was not posted twice.");
        item.status = "Paid";
        item.paidDate = date;
        item.reference = text(data.reference);
        item.expenseEntryId = posting.entry.id;
        appendProjectAudit(project, "STATUS", "po-installment", item.id, `${po.poNumber}: installment ${peso(item.amount)} Due to Paid`);
        return { ok: true, entry: posting.entry };
    }

    function undoPaid(project, poId, installmentId) {
        const po = findPo(project, poId);
        const item = po && findInstallment(po, installmentId);
        if (!item) return fail("That installment no longer exists.");
        if (item.status !== "Paid") return fail("This installment isn't marked paid.");
        // Payments marked paid by an older build have no cash-out behind them; those simply go back to Due.
        const reversal = reverseProjectTransaction(project, "expense", "po-installment", item.id, `${po.poNumber} payment undone`);
        item.status = "Due";
        delete item.paidDate; delete item.reference; delete item.expenseEntryId;
        appendProjectAudit(project, "STATUS", "po-installment", item.id, `${po.poNumber}: installment ${peso(item.amount)} Paid to Due`);
        return { ok: true, reversed: reversal.ok };
    }

    function markDelivered(project, poId, data) {
        const po = findPo(project, poId);
        if (!po) return fail("That purchase order no longer exists.");
        if (po.deliveryStatus === "Delivered") return fail("This order is already marked delivered.");
        if (!text(po.materialName) || !(Number(po.quantity) > 0) || !text(po.unit) || !(cents(po.totalAmount) > 0)) {
            return fail("Edit the order first: delivery needs a material, quantity, unit and total.");
        }
        const stockUnit = window.CbcStock ? CbcStock.unitOf(project.materialEntries, po.materialName) : "";
        if (stockUnit && !CbcStock.sameUnit(stockUnit, po.unit)) {
            return fail(`${po.materialName} is in stock as ${stockUnit}, but this order is in ${po.unit}. Edit the order to use ${stockUnit} (change the quantity if needed), then deliver it.`);
        }
        const date = text(data.date);
        if (!date || Number.isNaN(Date.parse(date))) return fail("Pick the delivery date.");
        if (date > getTodayValue()) return fail("The delivery date can't be in the future.");
        const entry = {
            id: createId(), materialName: po.materialName, direction: "in", date, deliveryDate: date,
            quantity: Number(po.quantity), unit: po.unit, handledBy: "", receivedBy: text(data.receivedBy),
            notes: `Delivered under ${po.poNumber}`, poId: po.id, createdAt: new Date().toISOString(),
        };
        setMoney(entry, "amount", po.totalAmount);
        setMoney(entry, "unitCost", Number(po.totalAmount) / Number(po.quantity));
        project.materialEntries = [...arr(project.materialEntries), entry];
        po.deliveryStatus = "Delivered";
        po.deliveredDate = date;
        po.deliveryEntryId = entry.id;
        appendProjectAudit(project, "STATUS", "purchase-order", po.id, `${po.poNumber}: delivered ${po.quantity} ${po.unit} of ${po.materialName}`);
        return { ok: true, entry };
    }

    function undoDelivered(project, poId) {
        const po = findPo(project, poId);
        if (!po) return fail("That purchase order no longer exists.");
        if (po.deliveryStatus !== "Delivered") return fail("This order isn't marked delivered.");
        project.materialEntries = arr(project.materialEntries).filter((entry) => entry.id !== po.deliveryEntryId && entry.poId !== po.id);
        po.deliveryStatus = "Ordered";
        delete po.deliveredDate; delete po.deliveryEntryId;
        appendProjectAudit(project, "STATUS", "purchase-order", po.id, `${po.poNumber}: delivery undone`);
        return { ok: true };
    }

    return { ensureIds, stats, nextNumber, create, update, remove, addInstallment, updateInstallment, removeInstallment, markPaid, undoPaid, markDelivered, undoDelivered, daysUntil, findPo, minus };
})();
window.CbcPo = CbcPo;
