"use strict";

// Stock rules for the Materials page. Nothing here touches the screen or storage.
//
// A material's stock is the sum of its "in" movements minus the sum of its "out" movements.
// Materials are matched by name, ignoring capital letters and extra spaces ("Shovel" = " shovel ").
const CbcStock = (() => {
    const arr = (value) => (Array.isArray(value) ? value : []);
    const text = (value) => String(value ?? "").trim();
    const key = (name) => text(name).replace(/\s+/g, " ").toLowerCase();
    const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

    // "bag" and "Bags." are the same unit; "bags" and "pcs" are not.
    const unitKey = (unit) => text(unit).toLowerCase().replace(/\./g, "").replace(/s$/, "");
    const sameUnit = (a, b) => unitKey(a) === unitKey(b);

    // Why stock goes out. "Used on site" is the normal one; the others keep losses and transfers visible.
    const OUT_REASONS = ["Used on site", "Transferred to another site", "Damaged / lost", "Other"];

    function signed(entry) {
        return (entry.direction === "in" ? 1 : -1) * (Number(entry.quantity) || 0);
    }

    // Quantity on hand for one material. `ignoreId` leaves one movement out (used while editing it).
    function onHand(entries, materialName, ignoreId) {
        const k = key(materialName);
        return round(arr(entries)
            .filter((entry) => key(entry.materialName) === k && entry.id !== ignoreId)
            .reduce((sum, entry) => sum + signed(entry), 0));
    }

    // The unit a material is already recorded in, so one material is never counted in two units.
    function unitOf(entries, materialName) {
        const k = key(materialName);
        const found = arr(entries).find((entry) => key(entry.materialName) === k && text(entry.unit));
        return found ? text(found.unit) : "";
    }

    // Most recent unit cost paid for a material, to pre-fill the next "In".
    function lastUnitCost(entries, materialName) {
        const k = key(materialName);
        const ins = arr(entries).filter((entry) => key(entry.materialName) === k && entry.direction === "in" && Number(entry.unitCost) > 0);
        ins.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
        return ins.length ? Number(ins[0].unitCost) : 0;
    }

    // Names that look like the typed one ("Cement" -> "Portland cement") so a near-miss is noticed before it makes a second material.
    function similar(entries, materialName) {
        const k = key(materialName);
        if (k.length < 3) return [];
        return materialNames(entries).filter((name) => { const n = key(name); return n !== k && (n.includes(k) || k.includes(n)); });
    }

    function materialNames(entries) {
        const seen = new Map();
        arr(entries).forEach((entry) => { const k = key(entry.materialName); if (k && !seen.has(k)) seen.set(k, text(entry.materialName)); });
        return [...seen.values()].sort((a, b) => a.localeCompare(b));
    }

    // Order movements oldest to newest. On the same day a delivery counts before a use (stock arrives, then is taken out);
    // otherwise movements keep the order they were recorded in.
    function chronological(entries) {
        return arr(entries).map((entry, index) => ({ entry, index }))
            .sort((a, b) => String(a.entry.date).localeCompare(String(b.entry.date))
                || (a.entry.direction === "in" ? 0 : 1) - (b.entry.direction === "in" ? 0 : 1)
                || String(a.entry.createdAt || "").localeCompare(String(b.entry.createdAt || ""))
                || a.index - b.index)
            .map((item) => item.entry);
    }

    // { movementId: balance after that movement } for every movement of every material.
    function runningBalances(entries) {
        const totals = {};
        const result = {};
        chronological(entries).forEach((entry) => {
            const k = key(entry.materialName);
            totals[k] = round((totals[k] || 0) + signed(entry));
            result[entry.id] = totals[k];
        });
        return result;
    }

    // Would the stock ever dip below zero if the movements were replayed in date order?
    // Returns the first offending { materialName, date, balance } or null.
    function firstShortage(entries, materialName) {
        const totals = {};
        const only = materialName === undefined ? null : key(materialName);
        for (const entry of chronological(entries)) {
            if (only !== null && key(entry.materialName) !== only) continue;
            const k = key(entry.materialName);
            totals[k] = round((totals[k] || 0) + signed(entry));
            if (totals[k] < 0) return { materialName: text(entry.materialName), date: entry.date, balance: totals[k], unit: text(entry.unit) };
        }
        return null;
    }

    // Check a movement BEFORE it is saved. `entries` is the current list, `data` the new or edited movement,
    // `editId` the movement being edited (if any). Returns an error message or "" when it is fine.
    function checkMovement(entries, data, editId) {
        const others = arr(entries).filter((entry) => entry.id !== editId);
        const knownUnit = unitOf(others, data.materialName);
        if (knownUnit && !sameUnit(knownUnit, data.unit)) {
            return `${text(data.materialName)} is already recorded in ${knownUnit}. Use the same unit so the stock adds up.`;
        }
        const trial = [...others, { id: editId || "__new__", ...data }];
        if (data.direction === "out") {
            const have = onHand(others, data.materialName);
            if (Number(data.quantity) > have) {
                return have > 0
                    ? `Only ${have} ${text(data.unit)} of ${text(data.materialName)} on hand. You can't take out ${round(data.quantity)}.`
                    : `There is no ${text(data.materialName)} in stock. Record the delivery (In) first.`;
            }
        }
        // An edit or a back-dated movement can also break a later balance.
        // Old data that was already short is left alone; only a NEW shortage is refused.
        const bad = firstShortage(others, data.materialName) ? null : firstShortage(trial, data.materialName);
        if (bad) return `This would leave ${bad.materialName} below zero on ${bad.date} (${bad.balance} ${bad.unit}). Check the dates and quantities.`;
        return "";
    }

    // Check removing a movement: deleting a delivery that was already partly used would make the stock negative.
    function checkRemoval(entries, id) {
        const rest = arr(entries).filter((entry) => entry.id !== id);
        const target = arr(entries).find((entry) => entry.id === id);
        const bad = target && !firstShortage(entries, target.materialName) ? firstShortage(rest, target.materialName) : null;
        return bad ? `Removing this would leave ${bad.materialName} below zero on ${bad.date}. Remove or lower the later "Out" movements first.` : "";
    }

    return { OUT_REASONS, key, sameUnit, similar, onHand, unitOf, lastUnitCost, materialNames, runningBalances, firstShortage, checkMovement, checkRemoval, round };
})();
if (typeof window !== "undefined") window.CbcStock = CbcStock;
if (typeof module !== "undefined" && module.exports) module.exports = CbcStock;
