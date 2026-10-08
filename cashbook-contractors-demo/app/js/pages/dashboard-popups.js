"use strict";
// The three Dashboard popups. They read the dashboard's current scope (client filter)
// and show it in a small modal. Nothing here changes saved data.
(function () {
    const P = window.CbcPortfolio;
    const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const peso = (n) => esc(formatMoney(n));
    const dateText = (d) => (d ? esc(formatDate(d)) : "-");
    const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

    let overlay = null, opener = null;

    function close() {
        if (!overlay) return;
        overlay.remove();
        overlay = null;
        document.removeEventListener("keydown", onKey, true);
        if (opener && document.contains(opener)) opener.focus();
        opener = null;
    }

    function onKey(event) {
        if (event.key === "Escape") { event.stopPropagation(); close(); return; }
        if (event.key !== "Tab" || !overlay) return;
        const items = [...overlay.querySelectorAll("button, a[href]")].filter((el) => !el.disabled);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }

    function openModal(title, subtitle, bodyHtml, trigger) {
        close();
        opener = trigger || document.activeElement;
        overlay = document.createElement("div");
        overlay.className = "modal-overlay dp-overlay";
        overlay.innerHTML = `<div class="modal-card dp-card" role="dialog" aria-modal="true" aria-labelledby="dpTitle">
            <div class="dp-head"><div><h3 id="dpTitle">${esc(title)}</h3><p>${esc(subtitle)}</p></div>
            <button type="button" class="dp-close" aria-label="Close">&times;</button></div>
            <div class="dp-body">${bodyHtml}</div></div>`;
        overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
        overlay.querySelector(".dp-close").addEventListener("click", close);
        document.body.appendChild(overlay);
        document.addEventListener("keydown", onKey, true);
        overlay.querySelector(".dp-close").focus();
    }

    // ---- View Projects --------------------------------------------------
    function statusClass(s) { return s === "Completed" ? "completed" : s === "On Hold" ? "on-hold" : "ongoing"; }

    function viewProjects(scope, trigger) {
        const rows = P.projectRows(scope.projects, scope.clients);
        const body = rows.length ? `<div class="dp-list">${rows.map((r) => `
            <div class="dp-proj">
                <div class="dp-proj-top"><strong>${esc(r.name)}</strong><span class="dp-pill ${statusClass(r.status)}">${esc(r.status)}</span></div>
                <small>${esc(r.clientName)}</small>
                <div class="dp-bar" role="progressbar" aria-valuenow="${r.pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${r.pct}%"></span></div>
                <div class="dp-proj-meta"><strong>${Math.round(r.pct)}% complete</strong><span>${dateText(r.startDate)} &rarr; ${dateText(r.targetEndDate)}</span>
                <a href="../client-status/client-status.html?client=${encodeURIComponent(r.clientId)}&tab=projects">Open in Client Portal &rarr;</a></div>
            </div>`).join("")}</div>
            <p class="dp-foot">To work inside a project, open its client in the <a href="../client-portal/client-portal.html">Client Portal</a>.</p>`
            : `<p class="bento-empty">No projects in this scope yet.</p>`;
        openModal("Projects", `${scope.label} · ${plural(rows.length, "project")}`, body, trigger);
    }

    // ---- Budget Summary: Cash In / Cash Out / Collectibles / Payables --------
    function budgetDetails(scope, trigger) {
        const { rows, totals } = P.cashSummary(scope.activeProjects);
        const tile = (cls, label, value, note) => `<div class="dp-tile ${cls}"><small>${label}</small><strong>${peso(value)}</strong><span>${note}</span></div>`;
        const tiles = `<div class="dp-tiles">
            ${tile("in", "Cash In", totals.cashIn, "Payments received")}
            ${tile("out", "Cash Out", totals.cashOut, "Expenses recorded")}
            ${tile("coll", "Collectibles", totals.collectibles, totals.chequesReceived ? `Includes ${peso(totals.chequesReceived)} in cheques not yet cleared` : "Still to collect from the client")}
            ${tile("pay", "Payables", totals.payables, `PO installments ${peso(totals.poDue)} · cheques issued ${peso(totals.chequesIssued)}`)}
        </div>`;
        const table = rows.length ? `<div class="dp-scroll"><table class="dp-table"><thead><tr><th>Project</th><th class="num">Cash In</th><th class="num">Cash Out</th><th class="num">Collectibles</th><th class="num">Payables</th></tr></thead><tbody>${rows.map((r) =>
            `<tr><td>${esc(r.name)}</td><td class="num">${peso(r.cashIn)}</td><td class="num">${peso(r.cashOut)}</td><td class="num">${peso(r.collectibles)}</td><td class="num">${peso(r.payables)}</td></tr>`).join("")}</tbody>
            <tfoot><tr><td>Total</td><td class="num">${peso(totals.cashIn)}</td><td class="num">${peso(totals.cashOut)}</td><td class="num">${peso(totals.collectibles)}</td><td class="num">${peso(totals.payables)}</td></tr></tfoot></table></div>` : "";
        const notes = `<p class="dp-foot"><strong>Collectibles</strong> = project budget minus payments received. <strong>Payables</strong> = unpaid purchase-order installments plus issued cheques not yet cleared.</p>`;
        openModal("Budget Summary", `${scope.label} · ${plural(rows.length, "active project")}`, rows.length ? tiles + table + notes : `<p class="bento-empty">No active projects in this scope.</p>`, trigger);
    }

    // ---- Timeline Status: Real vs Contract -------------------------------------
    function timelineDetails(scope, trigger) {
        const planned = typeof calculatePlannedProgress === "function" ? (p, d) => calculatePlannedProgress(p, d) : null;
        const rows = P.timelineRows(scope.activeProjects, getTodayValue(), planned);
        const card = (r) => {
            const b = r.bars, seg = (s, cls) => (s ? `<i class="${cls}" style="left:${s.left}%;width:${Math.max(s.width, 0.6)}%"></i>` : "");
            const picture = b ? `<div class="dp-axis">
                <div class="dp-axis-row"><span>Contract</span><div class="dp-track">${seg(b.contract, "c")}<b style="left:${b.today}%" title="Today"></b></div></div>
                <div class="dp-axis-row"><span>Real</span><div class="dp-track">${seg(b.realDone, `r ${r.tone}`)}${seg(b.realProjected, `p ${r.tone}`)}<b style="left:${b.today}%" title="Today"></b></div></div>
                <div class="dp-axis-legend"><span><i class="c"></i>Contract</span><span><i class="r ${r.tone}"></i>Real so far</span><span><i class="p ${r.tone}"></i>Projected</span><span><i class="t"></i>Today</span></div></div>`
                : `<p class="bento-empty">Add start and target dates to see the timeline.</p>`;
            const finish = r.realEnd ? `Finished ${dateText(r.realEnd)}` : r.projectedEnd ? `Projected finish ${dateText(r.projectedEnd)}` : "Finish not projected yet";
            return `<div class="dp-tl">
                <div class="dp-proj-top"><strong>${esc(r.name)}</strong><span class="dp-tone ${r.tone}">${esc(r.label)}</span></div>
                ${picture}
                <div class="dp-tl-cols">
                    <div><small>Contract timeline</small><p>${dateText(r.contractStart)} &rarr; ${dateText(r.contractEnd)}</p>
                        <p>${r.contractDays === null ? "No contract length set" : `${plural(r.contractDays, "day")} · day ${r.contractElapsed} today`}</p>
                        <p>Planned today: ${r.plannedPct === null ? "needs a Program of Works" : r.plannedPct + "%"}</p></div>
                    <div><small>Real timeline</small><p>${r.realStart ? `Started ${dateText(r.realStart)}${r.startEstimated ? " (estimated)" : ""}` : "Not started"}</p>
                        <p>${finish}</p><p>Actual today: ${r.actualPct}%</p></div>
                </div></div>`;
        };
        openModal("Timeline Status", `${scope.label} · Real vs contract timeline`, rows.length ? `<div class="dp-list">${rows.map(card).join("")}</div>` : `<p class="bento-empty">No active projects in this scope.</p>`, trigger);
    }

    window.CbcDashPopups = { viewProjects, budgetDetails, timelineDetails, close };
})();
