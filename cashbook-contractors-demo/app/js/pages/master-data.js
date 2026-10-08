"use strict";
// Master Data page: view-only. It never writes to saved data.
(function () {
    const M = window.CbcMasterData, brand = window.CbcBrand;
    const $ = (s) => document.querySelector(s);
    const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const allClients = loadClients(), projects = loadProjects();
    const num = (n) => `<td class="num${n < 0 ? " neg" : ""}">${esc(formatMoney(n))}</td>`;
    const initials = (name) => String(name || "?").trim().split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase() || "?";
    function projectRow(r, color) {
        const p = r.project, pct = Math.max(0, Math.min(100, Number(p.percentComplete) || 0));
        const state = p.archivedAt ? "Archived" : (p.status || "Ongoing");
        return `<tr class="md-proj"><td>${esc(p.projectName)}${p.siteAddress ? `<br><small>${esc(p.siteAddress)}</small>` : ""}</td>` +
            `<td>${esc(state)}</td>` +
            `<td class="num"><span class="md-bar"><span style="width:${pct}%"></span></span>${pct}%</td>` +
            `<td>${esc(p.startDate ? formatDate(p.startDate) : "-")}</td><td>${esc(p.targetEndDate ? formatDate(p.targetEndDate) : "-")}</td>` +
            `${num(r.totals.budget)}${num(r.totals.income)}${num(r.totals.expense)}</tr>`;
    }

    function clientBlock(g, filtering) {
        const c = g.client;
        const color = M.safeColor(c.brandColor) || (brand ? brand.DEFAULT : "#1f4e79");
        const logo = M.safeLogo(c.logo);
        const mark = logo ? `<img class="md-logo" src="${logo}" alt="">` : `<span class="md-initials">${esc(initials(c.clientName))}</span>`;
        const count = g.projects.length;
        const head = `<tr class="md-client" style="--md-color:${color}"><td colspan="8"><div class="md-client-head">${mark}` +
            `<div><div class="md-client-name">${esc(c.clientName)}</div><div class="md-client-meta">${c.businessName ? esc(c.businessName) + " · " : ""}${count} project${count === 1 ? "" : "s"}</div></div>` +
            `<span class="md-client-sum">Budget ${esc(formatMoney(g.totals.budget))}</span>` +
            `<button type="button" class="secondary-button md-open" data-client="${esc(c.id)}">View details</button></div></td></tr>`;
        const body = count ? g.projects.map((r) => projectRow(r, color)).join("") : (filtering ? "" : `<tr class="md-empty-row" style="--md-color:${color}"><td colspan="8">No projects yet.</td></tr>`);
        return `<tbody class="md-group" style="--md-color:${color}">${head}${body}</tbody>`;
    }

    function orphanBlock(g) {
        const head = `<tr class="md-client"><td colspan="8"><div class="md-client-head"><span class="md-initials">?</span><div><div class="md-client-name">No client record found</div><div class="md-client-meta">${g.projects.length} project(s) whose client is missing. Their records are kept.</div></div></div></td></tr>`;
        return `<tbody class="md-group">${head}${g.projects.map((r) => projectRow(r)).join("")}</tbody>`;
    }

    function render() {
        const status = $("#mdStatus").value, search = $("#mdSearch").value;
        const data = M.buildMasterData(allClients, projects, { search, status, sort: $("#mdSort").value });
        const filtering = Boolean(search.trim()) || status !== M.STATUS_ALL;
        const blocks = data.groups.map((g) => clientBlock(g, filtering)).join("") + (data.orphans ? orphanBlock(data.orphans) : "");
        const table = $(".md-table");
        table.querySelectorAll("tbody").forEach((b) => b.remove());
        table.insertAdjacentHTML("beforeend", blocks + (data.projectCount ? `<tbody><tr class="md-grand"><td colspan="5">Total shown</td>${num(data.totals.budget)}${num(data.totals.income)}${num(data.totals.expense)}</tr></tbody>` : ""));

        $("#mdCount").textContent = `${data.clientCount} client${data.clientCount === 1 ? "" : "s"}, ${data.projectCount} project${data.projectCount === 1 ? "" : "s"} shown`;
        const empty = $("#mdEmpty");
        empty.hidden = data.groups.length > 0 || Boolean(data.orphans);
        empty.textContent = filtering ? "Nothing matches your search or filter." : "No clients yet. Add one in Client Portal.";
    }

    // ---------- Client details pop-up (view-only, printable) ----------
    const todayValue = () => (typeof getTodayValue === "function" ? getTodayValue() : new Date().toISOString().slice(0, 10));
    const peso = (n) => esc(formatMoney(n));
    const dash = (v) => (v ? esc(v) : "-");
    let popupOpener = null;

    function dueText(days) {
        if (days === null || days === undefined) return "";
        if (days < 0) return `${Math.abs(days)} day${days === -1 ? "" : "s"} overdue`;
        return days === 0 ? "Due today" : `In ${days} day${days === 1 ? "" : "s"}`;
    }

    function popupBody(client) {
        const d = M.clientDetails(client, projects, todayValue());
        const color = M.safeColor(client.brandColor) || "#1f4e79", logo = M.safeLogo(client.logo);
        const mark = logo ? `<img class="md-logo md-logo-lg" src="${logo}" alt="">` : `<span class="md-initials md-logo-lg">${esc(initials(client.clientName))}</span>`;
        const p = d.profile;
        const projectRows = d.projects.map((r) => {
            const pr = r.project, pct = Math.max(0, Math.min(100, Number(pr.percentComplete) || 0));
            return `<tr><td>${esc(pr.projectName)}</td><td>${esc(pr.status || "Ongoing")}</td><td class="num">${pct}%</td>` +
                `<td>${esc(pr.startDate ? formatDate(pr.startDate) : "-")}</td><td>${esc(pr.targetEndDate ? formatDate(pr.targetEndDate) : "-")}</td>` +
                `${num(r.totals.budget)}${num(r.totals.income)}${num(r.totals.expense)}${num(r.totals.net)}</tr>`;
        }).join("");
        const chequeRows = d.cheques.map((c) => `<tr><td>${esc(c.direction)}</td><td>${esc(c.projectName)}</td><td>${dash(c.number)}${c.bank ? ` <small>${esc(c.bank)}</small>` : ""}</td>` +
            `<td>${dash(c.party)}</td><td>${esc(c.date ? formatDate(c.date) : "-")}</td><td>${esc(c.state)}${dueText(c.days) ? ` <small>(${esc(dueText(c.days))})</small>` : ""}</td>${num(c.amount)}</tr>`).join("");
        const payRows = d.payments.map((x) => `<tr><td>${esc(x.projectName)}</td><td>${dash(x.label)}${x.supplier ? ` <small>${esc(x.supplier)}</small>` : ""}</td>` +
            `<td>${esc(formatDate(x.date))}</td><td>${esc(dueText(x.days))}</td>${num(x.amount)}</tr>`).join("");
        const table = (head, rows, empty) => rows ? `<div class="mdp-scroll"><table class="ledger-table mdp-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="mdp-none">${empty}</p>`;
        return `<div class="mdp-head" style="--md-color:${color}">${mark}<div><h3 id="mdPopupTitle">${esc(client.clientName)}</h3>` +
                `<div class="mdp-sub">${client.businessName ? esc(client.businessName) + " · " : ""}As of ${esc(formatDate(todayValue()))}</div></div></div>` +
            `<h4>Profile</h4><dl class="mdp-profile"><div><dt>Contact</dt><dd>${dash(p.contactNumber)}</dd></div><div><dt>Email</dt><dd>${dash(p.clientEmail)}</dd></div>` +
                `<div><dt>TIN</dt><dd>${dash(p.tin)}</dd></div><div><dt>Address</dt><dd>${dash(p.clientAddress)}</dd></div></dl>` +
            `<h4>Money</h4><div class="mdp-cards"><div><span>Budget</span><strong>${peso(d.money.budget)}</strong></div><div><span>Income</span><strong>${peso(d.money.income)}</strong></div>` +
                `<div><span>Expenses</span><strong>${peso(d.money.expense)}</strong></div><div><span>Net</span><strong class="${d.money.net < 0 ? "neg" : ""}">${peso(d.money.net)}</strong></div></div>` +
            `<h4>Projects (${d.projects.length})</h4>` + table("<th>Project</th><th>Status</th><th class=\"num\">Progress</th><th>Start</th><th>Target end</th><th class=\"num\">Budget</th><th class=\"num\">Income</th><th class=\"num\">Expenses</th><th class=\"num\">Net</th>", projectRows, "No projects yet.") +
            `<h4>Pending cheques</h4>` + table("<th>Type</th><th>Project</th><th>Cheque</th><th>Party</th><th>Maturity</th><th>Status</th><th class=\"num\">Amount</th>", chequeRows, "No pending cheques.") +
            `<h4>Payments due this week and overdue</h4>` + table("<th>Project</th><th>Item</th><th>Due date</th><th>When</th><th class=\"num\">Amount</th>", payRows, "Nothing due this week.");
    }

    function closePopup() {
        const pop = $("#mdPopup");
        if (!pop || pop.hidden) return;
        pop.hidden = true;
        document.documentElement.classList.remove("md-popup-open");
        window.CashbookPrintTarget = null; window.CashbookPrintTitle = null;
        if (popupOpener) popupOpener.focus();
    }

    function openPopup(client, opener) {
        popupOpener = opener;
        $("#mdPopupBody").innerHTML = popupBody(client);
        window.CashbookPrintTarget = () => $("#mdPopupBody");      // Print preview prints only the pop-up
        window.CashbookPrintTitle = () => `Client Details - ${client.clientName}`;
        $("#mdPopup").hidden = false;
        document.documentElement.classList.add("md-popup-open");
        $(".md-popup").scrollTop = 0;
        $("#mdPopupClose").focus();
    }

    document.addEventListener("click", (e) => {
        const open = e.target.closest(".md-open");
        if (open) { const c = allClients.find((x) => x.id === open.dataset.client); if (c) openPopup(c, open); return; }
        if (e.target.id === "mdPopup") closePopup();                // click on the dark area
    });
    $("#mdPopupClose").addEventListener("click", closePopup);
    $("#mdPopupPrint").addEventListener("click", () => { const v = window.CashbookPrintPreviewV3 || window.CashbookPrintPreview; if (v) v.open(); });
    document.addEventListener("keydown", (e) => {
        if ($("#mdPopup").hidden || document.documentElement.classList.contains("cf-preview-open")) return;
        if (e.key === "Escape") closePopup();
        if (e.key === "Tab") {                                       // keep keyboard focus inside the pop-up
            const f = [...$("#mdPopup").querySelectorAll("button")].filter((b) => !b.disabled);
            if (!f.length) return;
            if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
            else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
        }
    });

    $("#mdSearch").addEventListener("input", render);
    $("#mdStatus").addEventListener("change", render);
    $("#mdSort").addEventListener("change", render);
    $("#mdPrint").addEventListener("click", () => window.print());
    render();
})();
