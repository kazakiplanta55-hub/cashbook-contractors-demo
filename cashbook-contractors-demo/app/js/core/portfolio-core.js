"use strict";
// Calculations behind the three Dashboard popups: View Projects, Budget Summary
// (Cash In / Cash Out / Collectibles / Payables) and Timeline Status (Real vs
// Contract). Pure functions: they read project records and never change them.
(function (root) {
    const round2 = (n) => Math.round(n * 100) / 100;
    const live = (e) => e && e.postingStatus !== "reversed" && !e.reversalOf;
    const sum = (list) => round2(arr(list).filter(live).reduce((s, e) => s + (Number(e.amount) || 0), 0));
    const CHEQUE_DONE = new Set(["Cleared", "Completed", "Bounced"]);

    const dayNum = (d) => {
        const t = Date.parse(String(d || "").slice(0, 10));
        return Number.isFinite(t) ? Math.round(t / 86400000) : null;
    };
    const diffDays = (from, to) => {
        const a = dayNum(from), b = dayNum(to);
        return a === null || b === null ? null : b - a;
    };
    const addDays = (d, n) => {
        const x = dayNum(d);
        return x === null ? "" : new Date((x + n) * 86400000).toISOString().slice(0, 10);
    };
    // Saved data can be imperfect (null rows, a list stored as text). Treat anything
    // that is not a list as empty and skip empty rows, so one bad record cannot
    // stop a whole popup from opening.
    const arr = (x) => (Array.isArray(x) ? x.filter(Boolean) : []);
    const MAX_PROJECTION_DAYS = 3650;
    const pctOf = (p) => Math.max(0, Math.min(100, Number(p && p.percentComplete) || 0));

    // ---- View Projects popup ------------------------------------------------
    // One row per project with its status and progress, ongoing first.
    function projectRows(projects, clients) {
        const nameOf = (id) => (arr(clients).find((c) => c.id === id) || {}).clientName || "Unknown client";
        const order = { "Ongoing": 0, "On Hold": 1, "Completed": 2 };
        return arr(projects)
            .filter((p) => !p.archivedAt)
            .map((p) => ({
                id: p.id, name: p.projectName || "(unnamed)", clientId: p.clientId, clientName: nameOf(p.clientId),
                status: p.status || "Ongoing", pct: pctOf(p), startDate: p.startDate || "", targetEndDate: p.targetEndDate || "",
            }))
            .sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || a.clientName.localeCompare(b.clientName) || a.name.localeCompare(b.name));
    }

    // ---- Budget Summary popup -----------------------------------------------
    // Cash In / Cash Out: recorded income and expense entries (reversed ones ignored).
    // Collectibles: contract amount not yet received (budget minus cash in).
    // Payables: unpaid PO installments plus issued cheques not yet cleared.
    function cashSummary(projects) {
        const rows = arr(projects).map((p) => {
            const cashIn = sum(p.incomeEntries), cashOut = sum(p.expenseEntries);
            const budget = Number(p.budget) || 0;
            let poDue = 0, chequesIssued = 0, chequesReceived = 0;
            arr(p.purchaseOrders).forEach((po) => arr(po.installments).forEach((i) => {
                if (i.status === "Due") poDue += Number(i.amount) || 0;
            }));
            arr(p.chequeEntries).forEach((c) => {
                if (CHEQUE_DONE.has(c.status)) return;
                if (c.type === "issued") chequesIssued += Number(c.amount) || 0;
                else chequesReceived += Number(c.amount) || 0;
            });
            return {
                id: p.id, name: p.projectName || "(unnamed)", budget: round2(budget), cashIn, cashOut, net: round2(cashIn - cashOut),
                collectibles: round2(Math.max(0, budget - cashIn)), poDue: round2(poDue), chequesIssued: round2(chequesIssued),
                payables: round2(poDue + chequesIssued), chequesReceived: round2(chequesReceived),
            };
        });
        const total = (k) => round2(rows.reduce((s, r) => s + r[k], 0));
        const totals = {};
        ["budget", "cashIn", "cashOut", "net", "collectibles", "poDue", "chequesIssued", "payables", "chequesReceived"].forEach((k) => { totals[k] = total(k); });
        return { rows, totals };
    }

    // ---- Timeline Status popup ----------------------------------------------
    // Contract timeline = the project's start and target end dates.
    // Real timeline = when progress really began, today's actual progress, and the
    // finish date (actual if finished, otherwise projected from the pace so far).
    function timelineRow(project, today, plannedPct) {
        const actual = pctOf(project);
        const contractStart = project.startDate || "", contractEnd = project.targetEndDate || "";
        const contractDays = diffDays(contractStart, contractEnd);
        const hasContract = contractDays !== null && contractDays > 0;
        const points = arr(project.progressHistory).filter((x) => x.date)
            .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.recordedAt || "").localeCompare(String(b.recordedAt || "")));
        const firstProgress = points.find((x) => Number(x.percentComplete) > 0);
        const firstDone = points.find((x) => Number(x.percentComplete) >= 100);
        const done = actual >= 100 || project.status === "Completed";
        // Real start: the first logged progress above 0%. Projects whose percent was set
        // directly (imports, older data) have no log, so fall back to the first sign of
        // work (a completed Program of Works item, or the first cost recorded), and
        // finally to the contract start, marked as an estimate.
        let realStart = firstProgress ? String(firstProgress.date).slice(0, 10) : "", startEstimated = false;
        if (!realStart && (actual > 0 || done)) {
            const evidence = [];
            arr(project.programsOfWork).forEach((pw) => arr(pw.items).forEach((i) => { if (i.completedAt) evidence.push(String(i.completedAt).slice(0, 10)); }));
            ["expenseEntries", "payrollEntries", "materialEntries"].forEach((k) => arr(project[k]).forEach((e) => { if (live(e) && e.date) evidence.push(String(e.date).slice(0, 10)); }));
            const valid = evidence.filter((d) => dayNum(d) !== null).sort();
            realStart = valid[0] || (dayNum(contractStart) !== null ? contractStart : "");
            startEstimated = Boolean(realStart);
        }
        let realEnd = "", projectedEnd = "", varianceDays = null, tone = "unknown", label = "";

        if (done) {
            realEnd = project.actualEndDate || (firstDone ? String(firstDone.date).slice(0, 10) : "");
            varianceDays = hasContract && realEnd ? diffDays(contractEnd, realEnd) : null;
            if (varianceDays === null) { label = "Finished"; tone = "ok"; }
            else if (varianceDays > 0) { label = `Finished ${varianceDays} day${varianceDays === 1 ? "" : "s"} late`; tone = "late"; }
            else if (varianceDays < 0) { label = `Finished ${-varianceDays} day${varianceDays === -1 ? "" : "s"} early`; tone = "ok"; }
            else { label = "Finished on the contract date"; tone = "ok"; }
        } else if (!realStart) {
            const late = hasContract ? diffDays(contractStart, today) : null;
            label = late !== null && late > 0 ? `Not started: ${late} day${late === 1 ? "" : "s"} past the contract start` : "Not started yet";
            tone = late !== null && late > 0 ? "late" : "unknown";
        } else {
            const elapsedReal = Math.max(diffDays(realStart, today) ?? 0, 0);
            if (actual <= 0) {
                label = "No current progress to project from";
            } else if (elapsedReal < 1) {
                label = "Just started: too early to project a finish";
            } else {
                const daysLeft = Math.ceil((100 - actual) / (actual / elapsedReal));
                if (!Number.isFinite(daysLeft) || daysLeft > MAX_PROJECTION_DAYS) {
                    label = "Progress is too slow to project a finish date";
                    tone = "late";
                } else {
                    projectedEnd = addDays(today, daysLeft);
                    varianceDays = hasContract ? diffDays(contractEnd, projectedEnd) : null;
                    if (varianceDays === null) label = `Projected finish ${projectedEnd}`;
                    else if (varianceDays > 3) { label = `Projected ${varianceDays} days late`; tone = "late"; }
                    else if (varianceDays < -3) { label = `Projected ${-varianceDays} days early`; tone = "ok"; }
                    else { label = "On track to finish on the contract date"; tone = "ok"; }
                }
            }
            const over = hasContract ? diffDays(contractEnd, today) : null;
            if (over !== null && over > 0) { label = `Past the contract end by ${over} day${over === 1 ? "" : "s"}, ${Math.round(actual)}% done`; tone = "late"; }
        }

        // Bar positions (percent of one shared date axis) for the picture.
        const finish = realEnd || projectedEnd;
        const dates = [contractStart, contractEnd, realStart, finish, today].filter((d) => dayNum(d) !== null);
        let bars = null;
        if (dates.length >= 2) {
            const nums = dates.map(dayNum), min = Math.min(...nums), max = Math.max(...nums), span = Math.max(max - min, 1);
            const pos = (d) => Math.round(((dayNum(d) - min) / span) * 1000) / 10;
            const seg = (a, b) => (dayNum(a) !== null && dayNum(b) !== null && dayNum(b) >= dayNum(a) ? { left: pos(a), width: Math.round((pos(b) - pos(a)) * 10) / 10 } : null);
            bars = {
                min: addDays("1970-01-01", min), max: addDays("1970-01-01", max),
                contract: hasContract ? seg(contractStart, contractEnd) : null,
                realDone: realStart ? seg(realStart, realEnd || today) : null,
                realProjected: realStart && !done && projectedEnd ? seg(today, projectedEnd) : null,
                today: pos(today),
            };
        }
        return {
            id: project.id, name: project.projectName || "(unnamed)", status: project.status || "Ongoing",
            contractStart, contractEnd, contractDays: hasContract ? contractDays : null,
            contractElapsed: hasContract ? Math.max(0, Math.min(contractDays, diffDays(contractStart, today))) : null,
            plannedPct: plannedPct === null || plannedPct === undefined ? null : Math.round(plannedPct),
            actualPct: Math.round(actual), realStart, startEstimated, realEnd, projectedEnd, varianceDays, tone, label, bars,
        };
    }

    function timelineRows(projects, today, plannedFn) {
        const tonePriority = { late: 0, unknown: 1, ok: 2 };
        return arr(projects).map((p) => timelineRow(p, today, plannedFn ? plannedFn(p, today) : null))
            .sort((a, b) => tonePriority[a.tone] - tonePriority[b.tone] || a.name.localeCompare(b.name));
    }

    const api = { projectRows, cashSummary, timelineRow, timelineRows, diffDays, addDays };
    if (typeof module !== "undefined" && module.exports) module.exports = api; else root.CbcPortfolio = api;
})(typeof window !== "undefined" ? window : globalThis);
