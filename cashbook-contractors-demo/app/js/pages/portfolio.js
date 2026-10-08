"use strict";
// Portfolio overview: every project (or one client's projects) on one page.
(function () {
    const E = window.CbcEvm, C = window.CbcCharts, core = window.CbcWorkspaceCore;
    const $ = (s) => document.querySelector(s);
    const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const clients = loadClients().filter((c) => !c.archivedAt).sort((a, b) => String(a.clientName).localeCompare(String(b.clientName)));
    clients.forEach((c) => $("#pfClient").add(new Option(c.clientName, c.id)));
    const today = getTodayValue();
    const MAX_BARS = 12;
    const STATUS_COLORS = { Ongoing: C.COLORS.blue, "On Hold": C.COLORS.amber, Completed: C.COLORS.green };
    const days = (n) => `${Math.abs(n)} d`;
    const ratioTone = (v) => (v === null ? "na" : v >= 1 ? "ok" : v >= 0.9 ? "warn" : "bad");

    const tile = (label, value, note, tone) => `<div class="an-tile ${tone || (value === "-" ? "na" : "")}"><small>${esc(label)}</small><strong>${esc(value)}</strong><span>${esc(note || "")}</span></div>`;
    const clip = (name) => String(name);

    let state = null;
    function compute() {
        const clientId = $("#pfClient").value;
        const all = loadProjects().filter((p) => !p.archivedAt && (!clientId || p.clientId === clientId));
        state = E.portfolio(all, today, (p) => E.plannedFrom(getProjectPlannedSchedule(p)), clients);
        return state;
    }

    function renderTiles(pf) {
        const n = pf.counts;
        $("#pfTilesCounts").innerHTML = [
            tile("Total projects", String(n.total), ""),
            tile("Ongoing", String(n.ongoing), "Work in progress"),
            tile("Delayed", String(n.delayed), n.delayed ? "Past or projected past the target end" : "None running late", n.delayed ? "bad" : "ok"),
            tile("On hold", String(n.onHold), ""),
            tile("Completed", String(n.completed), ""),
        ].join("");
        const spiNote = pf.spi === null ? "Needs a Program of Works" : pf.spi >= 1 ? "On or ahead of schedule" : "Behind schedule";
        const cpiNote = pf.cpi === null ? "Needs recorded costs and progress" : pf.cpi >= 1 ? "On or under cost" : "Over cost for the work done";
        const costPct = pf.budget > 0 ? `${Math.round((pf.ac / pf.budget) * 1000) / 10}% of budget spent` : "";
        $("#pfTilesMoney").innerHTML = [
            tile("Portfolio budget", formatMoney(pf.budget), `${n.total} project${n.total === 1 ? "" : "s"}`),
            tile("Actual cost", formatMoney(pf.ac), costPct),
            tile("Planned progress", pf.plannedPct === null ? "-" : `${pf.plannedPct}%`, pf.plannedPct === null ? "No project has a schedule yet" : `${pf.scheduledCount} of ${n.total} projects scheduled`),
            tile("Actual progress", pf.actualPct === null ? "-" : `${pf.actualPct}%`, pf.plannedPct === null ? "Budget-weighted, all projects" : "Same projects, budget-weighted"),
            tile("Portfolio SPI", pf.spi === null ? "-" : pf.spi.toFixed(2), spiNote, pf.spi === null ? "" : ratioTone(pf.spi)),
            tile("Portfolio CPI", pf.cpi === null ? "-" : pf.cpi.toFixed(2), cpiNote, pf.cpi === null ? "" : ratioTone(pf.cpi)),
        ].join("");
        $("#pfBanner").innerHTML = n.total === 0 ? `<p class="an-banner info">No projects yet. Add one from a client's portal and the numbers will appear here.</p>` : "";
    }

    function renderTable(pf) {
        $("#pfEmpty").hidden = pf.rows.length > 0;
        const cls = (s) => (s === "Completed" ? "completed" : s === "On Hold" ? "on-hold" : "");
        const cell = (v, fmt, tone) => `<td class="num ${v === null ? "na" : tone || ""}">${v === null ? "-" : esc(fmt(v))}</td>`;
        $("#pfRows").innerHTML = pf.rows.slice().sort((a, b) => b.budget - a.budget).map((r) =>
            `<tr><td><a href="${esc(core.portalLink(r.project))}">${esc(r.name)}</a></td><td>${esc(r.clientName)}</td><td><span class="an-pill ${cls(r.status)}">${esc(r.status)}</span></td>` +
            `<td class="num">${esc(formatMoney(r.budget))}</td><td class="num">${esc(formatMoney(r.ac))}</td>${cell(r.plannedPct, (v) => `${v}%`)}<td class="num">${r.actualPct}%</td>` +
            `${cell(r.spi, (v) => v.toFixed(2), ratioTone(r.spi))}${cell(r.cpi, (v) => v.toFixed(2), ratioTone(r.cpi))}` +
            `${cell(r.delayDays, (v) => (v > 0 ? `+${days(v)}` : v < 0 ? `-${days(v)}` : "On time"), r.delayDays === null ? "" : r.delayDays > 3 ? "bad" : "ok")}</tr>`).join("");
    }

    function draw() {
        const pf = state || compute();
        const dark = C.isDark();
        const orange = dark ? C.COLORS.orangeDark : C.COLORS.orange;
        const slices = pf.statusSplit.map((s) => ({ label: s.label, value: s.count, color: STATUS_COLORS[s.label] }));
        C.donut($("#pfDonut"), { slices, centerLabel: pf.counts.total === 1 ? "project" : "projects", emptyText: "No projects yet" });
        $("#pfDonutLegend").innerHTML = C.legend(slices.map((s) => ({ name: `${s.label} (${s.value})`, color: s.color })));

        const top = pf.byBudget.slice(0, MAX_BARS);
        C.bars($("#pfBudget"), { labels: top.map((r) => clip(r.name)), yFormat: (v) => C.money(v), series: [{ name: "Budget", color: C.COLORS.green, values: top.map((r) => r.budget) }], emptyText: "No projects yet" });

        C.line($("#pfTrend"), { labels: pf.trend.labels, yMax: 100, yFormat: (v) => `${v}`, series: [{ name: "Average progress %", color: orange, values: pf.trend.values, fill: dark ? "rgba(240,163,90,.18)" : "rgba(201,122,43,.14)" }], emptyText: "Add project start dates to see the trend" });

        const sched = pf.rows.filter((r) => r.plannedPct !== null).sort((a, b) => b.budget - a.budget).slice(0, MAX_BARS);
        const pva = [{ name: "Planned %", color: C.COLORS.grey, values: sched.map((r) => r.plannedPct) }, { name: "Actual %", color: C.COLORS.green, values: sched.map((r) => r.actualPct) }];
        C.bars($("#pfPva"), { labels: sched.map((r) => clip(r.name)), yMax: 100, valueLabels: true, yFormat: (v) => `${Math.round(v)}`, series: pva, emptyText: "Add a Program of Works to a project to compare planned and actual" });
        $("#pfPvaLegend").innerHTML = sched.length ? C.legend(pva.map((s) => ({ name: s.name, color: s.color }))) : "";

        const meas = pf.rows.filter((r) => r.spi !== null || r.cpi !== null).sort((a, b) => b.budget - a.budget).slice(0, MAX_BARS);
        const idx = [{ name: "SPI", color: C.COLORS.blue, values: meas.map((r) => r.spi) }, { name: "CPI", color: orange, values: meas.map((r) => r.cpi) }];
        C.bars($("#pfIndex"), { labels: meas.map((r) => clip(r.name)), valueLabels: true, yFormat: (v) => (Math.round(v * 100) / 100).toFixed(2), series: idx, emptyText: "SPI and CPI appear once projects have a schedule, costs and progress" });
        $("#pfIndexLegend").innerHTML = meas.length ? C.legend(idx.map((s) => ({ name: s.name, color: s.color }))) : "";
    }

    function render() { const pf = compute(); renderTiles(pf); renderTable(pf); draw(); }
    $("#pfClient").addEventListener("change", render);
    render();
    C.onResize($("#pfTrend"), draw);
})();
