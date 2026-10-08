"use strict";
// S-Curve & Forecast for one project (opened from its workspace).
(function () {
    const E = window.CbcEvm, C = window.CbcCharts;
    const $ = (s) => document.querySelector(s);
    const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const loaded = loadProjectFromUrl();
    if (!loaded) return;
    const { project } = loaded;
    const today = getTodayValue();
    const schedule = getProjectPlannedSchedule(project);
    const planned = E.plannedFrom(schedule);
    const curve = E.sCurve(project, today, planned);
    const s = curve.summary;
    const days = (n) => `${Math.abs(n)} day${Math.abs(n) === 1 ? "" : "s"}`;
    const pts = (n) => `${n > 0 ? "+" : ""}${n} pts`;

    const tile = (label, value, note, tone) => `<div class="an-tile ${tone || (value === "-" ? "na" : "")}"><small>${esc(label)}</small><strong>${esc(value)}</strong><span>${esc(note || "")}</span></div>`;
    const ratioTone = (v) => (v >= 1 ? "ok" : v >= 0.9 ? "warn" : "bad");

    // ---- tiles
    const variance = s.variancePts === null ? null : s.variancePts;
    const top = [
        tile("Planned %", s.plannedPct === null ? "-" : `${s.plannedPct}%`, s.plannedPct === null ? planned.reason : "Where the schedule says you should be today"),
        tile("Actual %", `${s.actualPct}%`, "Recorded progress today", ""),
        tile("Variance", variance === null ? "-" : pts(variance), variance === null ? "Needs a planned schedule" : variance >= 0 ? "Ahead of plan" : "Behind plan", variance === null ? "" : variance >= -2 ? "ok" : variance >= -10 ? "warn" : "bad"),
        tile("Monthly rate", s.monthlyRate === null ? "-" : `${s.monthlyRate}%`, s.monthlyRate === null ? s.rateNote : "Progress gained per month, recent pace"),
        tile("Remaining duration", s.remainingDays === null ? (s.done ? "Finished" : "-") : `${s.remainingDays} d`, s.remainingDays === null ? (s.done ? "" : "Add a target end date") : `To the target end, ${formatDate(project.targetEndDate)}`),
    ];
    const bottom = [
        tile("Forecast completion", s.forecastDate ? formatDate(s.forecastDate) : "-", s.forecastDate ? (s.done ? "Finished" : "At the recent pace") : s.forecastNote),
        tile("Delay forecast", s.delayDays === null ? "-" : s.delayDays > 0 ? `+${days(s.delayDays)}` : s.delayDays < 0 ? `-${days(s.delayDays)}` : "On time", s.delayDays === null ? (s.forecastDate ? "Add a target end date" : s.forecastNote) : s.delayDays > 3 ? "Later than the target end date" : s.delayDays < -3 ? "Earlier than the target end date" : "About on the target end date", s.delayDays === null ? "" : s.delayDays > 3 ? "bad" : "ok"),
        tile("SPI", s.spi === null ? "-" : s.spi.toFixed(2), s.spi === null ? s.spiNote : s.spi >= 1 ? "On or ahead of schedule" : "Behind schedule", s.spi === null ? "" : ratioTone(s.spi)),
        tile("CPI", s.cpi === null ? "-" : s.cpi.toFixed(2), s.cpi === null ? s.cpiNote : s.cpi >= 1 ? "On or under cost" : "Over cost for the work done", s.cpi === null ? "" : ratioTone(s.cpi)),
        tile("Forecast final cost", s.eac === null ? "-" : formatMoney(s.eac), s.eac === null ? s.cpiNote : `${s.vac >= 0 ? "Under" : "Over"} the ${formatMoney(s.bac)} budget by ${formatMoney(Math.abs(s.vac))}`, s.eac === null ? "" : s.vac >= 0 ? "ok" : "bad"),
    ];
    $("#anTilesTop").innerHTML = top.join("");
    $("#anTilesBottom").innerHTML = bottom.join("");

    // ---- banners: why something is missing, and a staleness warning
    const banners = [];
    if (!planned.valid) banners.push(`<p class="an-banner info">${esc(planned.reason)}. Without it there is no planned line, variance or SPI. Add it on the <a data-project-link href="../project-progress/progress.html">Progress &amp; Timeline</a> page.</p>`);
    s.notes.forEach((n) => banners.push(`<p class="an-banner">${esc(n)}</p>`));
    $("#anBanners").innerHTML = banners.join("");
    document.querySelectorAll("#anBanners [data-project-link]").forEach((a) => { const u = new URL(a.href); u.searchParams.set("id", project.id); a.href = u.toString(); });

    // ---- charts
    const dark = () => C.isDark();
    function draw() {
        const col = (name) => (dark() && C.COLORS[`${name}Dark`]) || C.COLORS[name];
        const series = [
            { name: "Planned %", color: C.COLORS.grey, values: curve.planned, dashed: true },
            { name: "Actual %", color: C.COLORS.green, values: curve.actual, fill: dark() ? "rgba(47,158,99,.20)" : "rgba(47,158,99,.14)", atToday: true },
            { name: "Forecast %", color: col("orange"), values: curve.forecast, dashed: true, atToday: true },
        ];
        C.line($("#sCurveChart"), { labels: curve.labels, todayIndex: curve.todayIndex, todayPos: curve.todayPos, yMax: 100, yFormat: (v) => `${v}`, series, emptyText: "Add a start date and target end date to see the S-Curve" });
        $("#sCurveLegend").innerHTML = C.legend(series.filter((x) => x.values.some((v) => v !== null)).map((x) => ({ name: x.name, color: x.color, dashed: x.dashed })));
        const fin = [
            { name: "Planned value", color: C.COLORS.grey, values: curve.pv, dashed: true },
            { name: "Earned value", color: C.COLORS.green, values: curve.ev, atToday: true },
            { name: "Actual cost", color: C.COLORS.red, values: curve.ac, atToday: true },
        ];
        const hasMoney = curve.bac > 0 || curve.ac.some((v) => v);
        C.line($("#financialChart"), { labels: hasMoney ? curve.labels : [], todayIndex: curve.todayIndex, todayPos: curve.todayPos, yFormat: (v) => C.money(v), series: fin, emptyText: "Add a project budget to see the financial S-Curve" });
        $("#financialLegend").innerHTML = C.legend(fin.filter((x) => x.values.some((v) => v)).map((x) => ({ name: x.name, color: x.color, dashed: x.dashed })));
    }
    draw();
    C.onResize($("#sCurveChart"), draw);
})();
