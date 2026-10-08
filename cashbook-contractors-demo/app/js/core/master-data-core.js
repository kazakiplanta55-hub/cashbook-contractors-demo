"use strict";
// Master Data (read-only): every active client with its projects.
// This file only prepares the rows; it never changes saved data.
(function (root) {
    const summary = (typeof module !== "undefined" && module.exports) ? require("./project-summary.js") : root.CbcProjectSummary;
    const round = (n) => Math.round(n * 100) / 100;
    const text = (v) => String(v ?? "").toLowerCase();
    const STATUS_ALL = "all", STATUS_ARCHIVED = "Archived";

    // Newest start date first; same date -> name A-Z.
    function byStartNewest(a, b) {
        return String(b.project.startDate || "").localeCompare(String(a.project.startDate || ""))
            || String(a.project.projectName || "").localeCompare(String(b.project.projectName || ""), undefined, { sensitivity: "base" });
    }
    const byClientName = (a, b) => String(a.client.clientName || "").localeCompare(String(b.client.clientName || ""), undefined, { sensitivity: "base" });

    function statusMatches(project, status) {
        if (status === STATUS_ARCHIVED) return Boolean(project.archivedAt);
        if (project.archivedAt) return false;
        return !status || status === STATUS_ALL || project.status === status;
    }

    // opts: { search, status, sort }  sort = "client" (A-Z, default) | "latest" (client with the newest project start first)
    // allClients is the full list (archived too) so a project is only called "no client" when its client record is truly missing.
    function buildMasterData(allClients, projects, opts = {}) {
        const query = text(opts.search).trim();
        const status = opts.status || STATUS_ALL;
        const filtering = Boolean(query) || status !== STATUS_ALL;
        const rowOf = (project) => ({ project, totals: summary.projectTotals(project) });
        const totalsOf = (rows) => {
            const t = { budget: 0, income: 0, expense: 0 };
            rows.forEach((r) => { t.budget += r.totals.budget; t.income += r.totals.income; t.expense += r.totals.expense; });
            return { budget: round(t.budget), income: round(t.income), expense: round(t.expense) };
        };

        const groups = (allClients || []).filter((c) => !c.archivedAt).map((client) => {
            const clientHit = Boolean(query) && (text(client.clientName).includes(query) || text(client.businessName).includes(query));
            const rows = (projects || [])
                .filter((p) => p.clientId === client.id && statusMatches(p, status))
                .filter((p) => !query || clientHit || text(p.projectName).includes(query) || text(p.siteAddress).includes(query))
                .map(rowOf).sort(byStartNewest);
            return { client, projects: rows, totals: totalsOf(rows) };
        }).filter((g) => !filtering || g.projects.length > 0);

        if (opts.sort === "latest") {
            const newest = (g) => g.projects.reduce((m, r) => (String(r.project.startDate || "") > m ? String(r.project.startDate) : m), "");
            groups.sort((a, b) => newest(b).localeCompare(newest(a)) || byClientName(a, b));
        } else groups.sort(byClientName);

        // Projects whose client record is missing entirely stay visible instead of disappearing.
        const known = new Set((allClients || []).map((c) => c.id));
        const orphanRows = (projects || [])
            .filter((p) => !known.has(p.clientId) && statusMatches(p, status))
            .filter((p) => !query || text(p.projectName).includes(query) || text(p.siteAddress).includes(query))
            .map(rowOf).sort(byStartNewest);
        const orphans = orphanRows.length ? { client: null, projects: orphanRows, totals: totalsOf(orphanRows) } : null;

        const all = groups.concat(orphans ? [orphans] : []);
        const projectCount = all.reduce((n, g) => n + g.projects.length, 0);
        return { groups, orphans, clientCount: groups.length, projectCount, totals: totalsOf(all.flatMap((g) => g.projects)) };
    }

    // A logo is only used if it is a plain base64 image data URL (nothing that could break out of an attribute).
    function safeLogo(value) {
        return /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(String(value || "")) ? value : "";
    }
    function safeColor(value) {
        return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : "";
    }


    // ---- Client details (the pop-up) ----
    const dayGap = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
    const CHEQUE_DONE = new Set(["Cleared", "Completed", "Bounced"]);

    // Everything the pop-up shows for ONE client. today = "YYYY-MM-DD". Reads only; never changes saved data.
    // Same due rules as the Dashboard: unpaid PO installments and pending cheques due within 7 days (or already overdue).
    function clientDetails(client, projects, today) {
        const mine = (projects || []).filter((p) => p.clientId === client.id && !p.archivedAt)
            .map((project) => ({ project, totals: summary.projectTotals(project) })).sort(byStartNewest);
        const totals = { budget: 0, income: 0, expense: 0 };
        mine.forEach((r) => { totals.budget += r.totals.budget; totals.income += r.totals.income; totals.expense += r.totals.expense; });
        const money = { budget: round(totals.budget), income: round(totals.income), expense: round(totals.expense) };
        money.net = round(money.income - money.expense);

        const cheques = [], payments = [];
        mine.forEach(({ project }) => {
            (project.chequeEntries || []).forEach((c) => {
                if (CHEQUE_DONE.has(c.status)) return;
                const date = c.maturityDate || c.dueDate || "";
                const days = date ? dayGap(today, date) : null;
                cheques.push({
                    projectName: project.projectName, direction: c.type === "issued" ? "Issued" : "Received", number: c.chequeNumber || "",
                    bank: c.bankName || "", party: c.partyName || "", amount: Number(c.amount) || 0, date, days,
                    state: days === null ? "Pending" : days < 0 ? "Matured" : days <= 7 ? "Near maturity" : "Pending",
                });
            });
            (project.purchaseOrders || []).forEach((po) => (po.installments || []).forEach((i) => {
                if (i.status !== "Due") return;
                const days = dayGap(today, i.dueDate);
                if (Number.isFinite(days) && days <= 7) payments.push({
                    projectName: project.projectName, label: [po.poNumber, po.materialName].filter(Boolean).join(" - "), supplier: po.supplier || "",
                    amount: Number(i.amount) || 0, date: i.dueDate, days,
                });
            }));
        });
        const byDate = (a, b) => (a.days ?? 99999) - (b.days ?? 99999);
        cheques.sort(byDate); payments.sort(byDate);

        return {
            profile: { contactNumber: client.contactNumber || "", clientEmail: client.clientEmail || "", tin: client.tin || "", clientAddress: client.clientAddress || "", businessName: client.businessName || "" },
            projects: mine, money, cheques, payments,
        };
    }

    const api = { buildMasterData, clientDetails, safeLogo, safeColor, STATUS_ALL, STATUS_ARCHIVED };
    if (typeof module !== "undefined" && module.exports) module.exports = api; else root.CbcMasterData = api;
})(typeof window !== "undefined" ? window : globalThis);
