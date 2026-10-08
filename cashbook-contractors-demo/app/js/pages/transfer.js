"use strict";

(function () {
    function get(selector) {
        return document.querySelector(selector);
    }

    function escapeHtml(value) {
        const div = document.createElement("div");
        div.textContent = String(value ?? "");
        return div.innerHTML;
    }

    const exchange = window.CashbookExchange;
    const clients = loadClients().filter((client) => !client.archivedAt);
    const projects = loadProjects().filter((project) => !project.archivedAt);

    function clientEntryCounts(client) {
        const clientProjects = projects.filter(
            (project) => project.clientId === client.id
        );

        let cashIn = 0;
        let cashOut = 0;

        clientProjects.forEach((project) => {
            cashIn += (project.incomeEntries || []).length;
            cashOut += (project.expenseEntries || []).length;
        });

        return { cashIn, cashOut, clientProjects };
    }

    function renderSummary() {
        const rows = clients.map((client) => {
            return { client, ...clientEntryCounts(client) };
        });

        const withEntries = rows.filter(
            (row) => row.cashIn + row.cashOut > 0
        );

        get("#clientSummaryEmptyState").hidden = withEntries.length > 0;
        get("#exportButton").disabled = withEntries.length === 0;

        get("#clientSummaryBody").innerHTML = rows
            .map((row) => {
                return `
                    <tr>
                        <td>${escapeHtml(row.client.clientName)}</td>
                        <td>${escapeHtml(row.client.tin) || "—"}</td>
                        <td>${row.cashIn}</td>
                        <td>${row.cashOut}</td>
                    </tr>
                `;
            })
            .join("");
    }

    function buildClientPayload(client) {
        const { clientProjects } = clientEntryCounts(client);

        const cashInEntries = [];
        const cashOutEntries = [];

        clientProjects.forEach((project) => {
            (project.incomeEntries || []).forEach((entry) => {
                cashInEntries.push({
                    id: entry.id,
                    date: entry.date,
                    amount: money(entry.amount),
                    totalAmount: money(entry.amount),
                    referenceNumber: entry.referenceNo || "",
                    description: `[${project.projectName}] ${entry.description || ""}`.trim(),
                    transactionType: entry.category || "Other",
                    createdAt: entry.createdAt,
                });
            });

            (project.expenseEntries || []).forEach((entry) => {
                cashOutEntries.push({
                    id: entry.id,
                    date: entry.date,
                    amount: money(entry.amount),
                    totalAmount: money(entry.amount),
                    referenceNumber: entry.referenceNo || "",
                    description: `[${project.projectName}] ${entry.description || ""}`.trim(),
                    expenseType: entry.category || "Other",
                    createdAt: entry.createdAt,
                });
            });
        });

        return {
            profile: {
                id: client.id,
                name: client.clientName,
                business: client.businessName || "",
                tin: client.tin || "",
                rdo: "",
            },
            cashInEntries,
            cashOutEntries,
        };
    }

    get("#exportButton").addEventListener("click", async () => {
        get("#exportButton").disabled = true;
        get("#exportMessage").textContent = "Building transfer package...";

        try {
            const clientPayloads = clients
                .map(buildClientPayload)
                .filter((payload) => {
                    return (
                        payload.cashInEntries.length > 0 ||
                        payload.cashOutEntries.length > 0
                    );
                });

            const packageRecord = await exchange.createPackage({
                source: {
                    application: "Cashbook for Contractors",
                    deviceName:
                        navigator.platform || "Unknown device",
                },
                exportOptions: { scope: "all" },
                payload: { clients: clientPayloads },
            });

            const dateStamp = getTodayValue();
            const fileName = `cashbook-contractors-${dateStamp}-${packageRecord.packageId.slice(
                0,
                8
            )}.cftransfer`;

            exchange.downloadJson(packageRecord, fileName);

            get("#exportMessage").textContent =
                `Exported ${clientPayloads.length} client(s). Send this file to your accountant to import into the Accountant Edition.`;
        } catch (error) {
            get("#exportMessage").textContent =
                "Something went wrong building the transfer package: " +
                error.message;
        } finally {
            get("#exportButton").disabled = false;
        }
    });

    renderSummary();
})();
