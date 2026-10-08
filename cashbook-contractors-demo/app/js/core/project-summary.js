"use strict";
(function (root) {
    const round = (n) => Math.round(n * 100) / 100;
    const live = (e) => e.postingStatus !== "reversed" && !e.reversalOf;
    const sum = (list) => round((list || []).filter(live).reduce((s, e) => s + (Number(e.amount) || 0), 0));

    function projectTotals(p) {
        const budget = Number(p.budget) || 0, income = sum(p.incomeEntries), expense = sum(p.expenseEntries);
        return { budget, income, expense, net: round(income - expense), remaining: round(budget - income), usedPct: budget > 0 ? Math.round((expense / budget) * 1000) / 10 : 0 };
    }

    // Clients A-Z, each with its projects (oldest start first) and subtotals. codeOf(project) gives the project code.
    function groupByClient(clients, projects, codeOf, opts = {}) {
        const keys = ["budget", "income", "expense", "net", "remaining"];
        return clients
            .filter((c) => !c.archivedAt && (!opts.clientId || c.id === opts.clientId))
            .sort((a, b) => String(a.clientName).localeCompare(String(b.clientName), undefined, { sensitivity: "base" }))
            .map((client) => {
                const list = projects
                    .filter((p) => p.clientId === client.id && (opts.includeArchived || !p.archivedAt) && (!opts.status || p.status === opts.status))
                    .sort((a, b) => String(a.startDate || "").localeCompare(String(b.startDate || "")) || String(a.projectName).localeCompare(String(b.projectName)))
                    .map((project) => ({ project, code: codeOf(project), totals: projectTotals(project) }));
                const totals = {};
                keys.forEach((k) => { totals[k] = round(list.reduce((s, r) => s + r.totals[k], 0)); });
                return { client, projects: list, totals };
            })
            .filter((g) => g.projects.length || opts.keepEmpty);
    }

    function grandTotals(groups) {
        const t = {};
        ["budget", "income", "expense", "net", "remaining"].forEach((k) => { t[k] = round(groups.reduce((s, g) => s + g.totals[k], 0)); });
        return t;
    }

    const api = { projectTotals, groupByClient, grandTotals };
    if (typeof module !== "undefined" && module.exports) module.exports = api; else root.CbcProjectSummary = api;
})(typeof window !== "undefined" ? window : globalThis);
