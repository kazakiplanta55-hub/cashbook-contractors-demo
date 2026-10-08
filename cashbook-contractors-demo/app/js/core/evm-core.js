"use strict";
// Schedule and cost performance numbers: S-Curve series, forecast completion, SPI / CPI and the
// portfolio roll-up. Pure functions: they read project records and never change them.
//
//   EV (earned value)   = percent complete x budget
//   PV (planned value)  = planned percent today x budget        (needs a schedule)
//   AC (actual cost)    = expenses recorded so far (payroll, materials and cheques post into expenses)
//   SPI = EV / PV   (below 1 is behind schedule)      CPI = EV / AC   (below 1 is over cost)
//
// Where a number cannot be trusted yet (no schedule, no costs, too little progress history) the field is
// null and a plain-language note says why, so the screen can say "not enough data" instead of guessing.
(function (root) {
    const P = typeof module !== "undefined" && module.exports ? require("./portfolio-core.js") : root.CbcPortfolio;
    const round2 = (n) => Math.round(n * 100) / 100;
    const arr = (x) => (Array.isArray(x) ? x.filter(Boolean) : []);
    const live = (e) => e && e.postingStatus !== "reversed" && !e.reversalOf;
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const isDate = (d) => /^\d{4}-\d{2}-\d{2}/.test(String(d || "")) && P.diffDays(String(d).slice(0, 10), "2000-01-01") !== null;
    const day = (d) => String(d || "").slice(0, 10);
    const pctOf = (p) => Math.max(0, Math.min(100, num(p && p.percentComplete)));
    const MAX_FORECAST_DAYS = 3650;
    const MAX_POINTS = 120;
    const RATE_WINDOW_DAYS = 90;
    const MIN_RATE_DAYS = 14;
    const STALE_DAYS = 45;

    // A project's schedule (from the storage module) in the shape these functions use.
    function plannedFrom(schedule) {
        return schedule && schedule.valid
            ? { valid: true, at: (d) => Math.max(0, Math.min(100, Number(schedule.progressAt(d)) || 0)), reason: "" }
            : { valid: false, at: () => null, reason: (schedule && schedule.reason) || "Add a Program of Works to calculate planned progress" };
    }

    // ---- progress over time --------------------------------------------------------
    function history(project) {
        return arr(project.progressHistory).filter((x) => isDate(x.date))
            .map((x, i) => ({ date: day(x.date), pct: Math.max(0, Math.min(100, num(x.percentComplete))), at: String(x.recordedAt || ""), i }))
            .sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at) || a.i - b.i);
    }
    // Percent complete as it stood at the end of `date` (the last recorded point on or before it).
    function actualAt(points, date) {
        let v = 0;
        for (const p of points) { if (p.date <= date) v = p.pct; else break; }
        return v;
    }
    function cumulativeCost(project, date) {
        return round2(arr(project.expenseEntries).filter(live).filter((e) => isDate(e.date) && day(e.date) <= date).reduce((s, e) => s + num(e.amount), 0));
    }
    function totalCost(project) {
        return round2(arr(project.expenseEntries).filter(live).reduce((s, e) => s + num(e.amount), 0));
    }

    // Progress pace over the last 90 days (or since work began, if that is more recent).
    function pace(project, today, actual) {
        const points = history(project);
        const firstUp = points.find((p) => p.pct > 0);
        let realStart = firstUp ? firstUp.date : "";
        if (!realStart && actual > 0) realStart = isDate(project.startDate) ? day(project.startDate) : "";
        if (!realStart) return { ok: false, note: "No progress recorded yet" };
        const back = P.addDays(today, -RATE_WINDOW_DAYS);
        const from = realStart > back ? realStart : back;
        const days = P.diffDays(from, today);
        if (days === null || days < MIN_RATE_DAYS) return { ok: false, note: "Too early to measure a pace (needs about two weeks of progress)" };
        const base = from === realStart ? 0 : actualAt(points, from);
        const perDay = (actual - base) / days;
        if (perDay <= 0) return { ok: false, note: `No progress in the last ${days} days` };
        return { ok: true, perDay, perMonth: perDay * 30, windowDays: days, realStart };
    }

    // ---- one project ------------------------------------------------------------------------
    function evmSummary(project, today, planned) {
        planned = planned || plannedFrom(null);
        const actual = pctOf(project);
        const bac = Math.max(0, num(project.budget));
        const status = project.status || "Ongoing";
        const done = actual >= 100 || status === "Completed";
        const plannedPct = planned.valid ? planned.at(today) : null;
        const ev = round2((actual / 100) * bac), ac = totalCost(project);
        const pv = plannedPct === null ? null : round2((plannedPct / 100) * bac);
        const notes = [];

        let spi = null, spiNote = "";
        if (!planned.valid) spiNote = planned.reason;
        else if (!(plannedPct > 0)) spiNote = "Nothing is scheduled to be done yet";
        else spi = round2(actual / plannedPct);

        let cpi = null, cpiNote = "";
        if (!(ac > 0)) cpiNote = "No costs recorded yet";
        else if (!(ev > 0)) cpiNote = bac > 0 ? "No progress recorded yet" : "Add a budget to compare cost with progress";
        else cpi = round2(ev / ac);
        const eac = cpi ? round2(bac / cpi) : null;

        const pts = history(project);
        const lastUpdate = pts.length ? pts[pts.length - 1].date : "";
        const staleDays = lastUpdate && !done ? P.diffDays(lastUpdate, today) : null;
        if (cpi !== null && staleDays !== null && staleDays > STALE_DAYS) notes.push(`Progress was last updated ${staleDays} days ago, so CPI may read worse than the real position.`);

        // Forecast
        const target = isDate(project.targetEndDate) ? day(project.targetEndDate) : "";
        const remainingDays = target && !done ? Math.max(0, P.diffDays(today, target)) : null;
        let monthlyRate = null, rateNote = "", forecastDate = "", delayDays = null, forecastNote = "";
        const pc = pace(project, today, actual);
        if (done) {
            const pts2 = pts.find((p) => p.pct >= 100);
            forecastDate = day(project.actualEndDate) || (pts2 ? pts2.date : "");
            delayDays = target && forecastDate ? P.diffDays(target, forecastDate) : null;
            forecastNote = "Finished";
        } else if (!pc.ok) {
            rateNote = forecastNote = pc.note;
        } else {
            monthlyRate = round2(pc.perMonth);
            const left = Math.ceil((100 - actual) / pc.perDay);
            if (left > MAX_FORECAST_DAYS) forecastNote = "Progress is too slow to forecast a finish date";
            else {
                forecastDate = P.addDays(today, left);
                delayDays = target ? P.diffDays(target, forecastDate) : null;
            }
        }
        return {
            bac, actualPct: round2(actual), plannedPct: plannedPct === null ? null : round2(plannedPct),
            variancePts: plannedPct === null ? null : round2(actual - plannedPct),
            ev, pv, ac, spi, spiNote, cpi, cpiNote, eac, vac: eac === null ? null : round2(bac - eac),
            monthlyRate, rateNote, remainingDays, forecastDate, delayDays, forecastNote, done, staleDays, notes,
        };
    }

    // ---- S-Curve series -----------------------------------------------------------------------
    function monthEnd(date) {
        const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
        return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    }
    function monthEnds(from, to) {
        const out = [];
        let cur = monthEnd(from);
        const last = monthEnd(to);
        while (cur <= last && out.length < MAX_POINTS) { out.push(cur); cur = monthEnd(P.addDays(cur, 1)); }
        return out;
    }

    function sCurve(project, today, planned) {
        planned = planned || plannedFrom(null);
        const summary = evmSummary(project, today, planned);
        const points = history(project);
        const actualNow = summary.actualPct;
        const dates = [day(project.startDate), points[0] && points[0].date, summary.forecastDate, day(project.targetEndDate), today].filter(isDate);
        const first = dates.reduce((a, b) => (b < a ? b : a), today);
        const last = dates.reduce((a, b) => (b > a ? b : a), today);
        const labels = monthEnds(first, last);
        const todayIdx = labels.findIndex((l) => l >= today);
        const bac = summary.bac;
        const perDay = !summary.done && summary.monthlyRate ? summary.monthlyRate / 30 : 0;
        const plannedSeries = [], actual = [], forecast = [], pv = [], ev = [], ac = [];
        let reached = false;
        labels.forEach((l, i) => {
            const p = planned.valid ? planned.at(l) : null;
            plannedSeries.push(p === null ? null : round2(p));
            pv.push(p === null ? null : round2((p / 100) * bac));
            const upTo = l < today ? l : today;
            const past = i <= todayIdx || todayIdx === -1;
            if (past) {
                // Progress set directly (imports, older data) has no log: show only today's value, not an invented 0%.
                const known = i === todayIdx || points.length > 0;
                const a = i === todayIdx ? actualNow : known ? actualAt(points, upTo) : null;
                actual.push(a === null ? null : round2(a)); ev.push(a === null ? null : round2((a / 100) * bac)); ac.push(cumulativeCost(project, upTo));
            } else { actual.push(null); ev.push(null); ac.push(null); }
            // Forecast starts at today's actual and runs at the recent pace until 100%.
            if (i === todayIdx && perDay > 0 && actualNow < 100) { forecast.push(round2(actualNow)); }
            else if (i > todayIdx && todayIdx !== -1 && perDay > 0 && !reached) {
                const v = Math.min(100, actualNow + perDay * P.diffDays(today, l));
                forecast.push(round2(v)); if (v >= 100) reached = true;
            } else forecast.push(null);
        });
        // Where today falls between the month ticks (a fractional index), so the chart can draw "now" accurately.
        let todayPos = todayIdx;
        if (todayIdx >= 0) {
            const prev = todayIdx > 0 ? labels[todayIdx - 1] : P.addDays(`${labels[0].slice(0, 8)}01`, -1);
            const span = P.diffDays(prev, labels[todayIdx]);
            todayPos = (todayIdx - 1) + (span > 0 ? Math.min(1, Math.max(0, P.diffDays(prev, today) / span)) : 1);
        }
        return { labels, planned: plannedSeries, actual, forecast, pv, ev, ac, todayIndex: todayIdx, todayPos, bac, hasPlanned: planned.valid, plannedReason: planned.reason, summary };
    }

    // ---- many projects ---------------------------------------------------------------------------
    function portfolio(projects, today, plannedOf, clients) {
        const list = arr(projects).filter((p) => !p.archivedAt);
        const nameOf = (id) => (arr(clients).find((c) => c.id === id) || {}).clientName || "";
        const rows = list.map((p) => {
            const planned = plannedOf ? plannedOf(p) : plannedFrom(null);
            const s = evmSummary(p, today, planned);
            const t = P.timelineRow(p, today, s.plannedPct);
            return { id: p.id, clientId: p.clientId, clientName: nameOf(p.clientId), name: p.projectName || "(unnamed)", status: p.status || "Ongoing", budget: s.bac, ac: s.ac, ev: s.ev, pv: s.pv, plannedPct: s.plannedPct, actualPct: s.actualPct, spi: s.spi, cpi: s.cpi, tone: t.tone, delayDays: s.delayDays, startDate: day(p.startDate), project: p };
        });
        const counts = { total: rows.length, ongoing: 0, onHold: 0, completed: 0, delayed: 0 };
        rows.forEach((r) => {
            if (r.status === "Completed") counts.completed++; else if (r.status === "On Hold") counts.onHold++; else counts.ongoing++;
            if (r.status === "Ongoing" && r.tone === "late") counts.delayed++;
        });
        const budget = round2(rows.reduce((s, r) => s + r.budget, 0)), ac = round2(rows.reduce((s, r) => s + r.ac, 0));
        // Planned vs actual are compared over the same projects: the ones that have a schedule.
        const scheduled = rows.filter((r) => r.plannedPct !== null);
        const weighted = (set, key) => {
            const w = set.reduce((s, r) => s + r.budget, 0);
            return set.length ? round2(w > 0 ? set.reduce((s, r) => s + r[key] * r.budget, 0) / w : set.reduce((s, r) => s + r[key], 0) / set.length) : null;
        };
        const evSum = scheduled.reduce((s, r) => s + r.ev, 0), pvSum = scheduled.reduce((s, r) => s + (r.pv || 0), 0);
        const costed = rows.filter((r) => r.ac > 0 && r.ev > 0);
        const cpiEv = costed.reduce((s, r) => s + r.ev, 0), cpiAc = costed.reduce((s, r) => s + r.ac, 0);
        const plannedPct = weighted(scheduled, "plannedPct");
        const actualPct = scheduled.length ? weighted(scheduled, "actualPct") : weighted(rows, "actualPct");

        // Average cumulative progress of the projects that had started, month by month.
        const starts = rows.map((r) => r.startDate).filter(isDate);
        let trend = { labels: [], values: [] };
        if (starts.length) {
            const first = starts.reduce((a, b) => (b < a ? b : a));
            const labels = monthEnds(first, today);
            const hist = rows.map((r) => ({ start: r.startDate, pts: history(r.project), project: r.project }));
            trend = {
                labels,
                values: labels.map((l) => {
                    const upTo = l < today ? l : today;
                    // A project counts once it has started and has progress on record (or it is the current month).
                    const active = hist.filter((h) => isDate(h.start) && h.start <= upTo && (h.pts.length > 0 || upTo === today));
                    return active.length ? round2(active.reduce((s, h) => s + (upTo === today ? pctOf(h.project) : actualAt(h.pts, upTo)), 0) / active.length) : 0;
                }),
            };
        }
        return {
            counts, budget, ac, plannedPct, actualPct, scheduledCount: scheduled.length,
            spi: pvSum > 0 ? round2(evSum / pvSum) : null,
            cpi: cpiAc > 0 ? round2(cpiEv / cpiAc) : null,
            rows, trend,
            statusSplit: [["Ongoing", counts.ongoing], ["On Hold", counts.onHold], ["Completed", counts.completed]].filter(([, n]) => n > 0).map(([label, count]) => ({ label, count })),
            byBudget: [...rows].sort((a, b) => b.budget - a.budget),
        };
    }

    const api = { plannedFrom, evmSummary, sCurve, portfolio, monthEnds, actualAt, history };
    if (typeof module !== "undefined" && module.exports) module.exports = api; else root.CbcEvm = api;
})(typeof window !== "undefined" ? window : globalThis);
