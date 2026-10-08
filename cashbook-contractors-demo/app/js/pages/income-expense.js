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

    const loaded = loadProjectFromUrl();
    if (!loaded) {
        return;
    }

    let project = loaded.project;

    function percentOf(part, whole) {
        const w = Number(whole) || 0;
        return w > 0 ? Math.round((Number(part) / w) * 100) : null;
    }

    function refreshSummary() {
        const income = sumMoney(project.incomeEntries || [], (entry) => entry.amount);
        const expense = sumMoney(project.expenseEntries || [], (entry) => entry.amount);
        const remaining = project.budget - expense;

        get("#projectBudget").textContent = formatMoney(project.budget);
        get("#projectIncome").textContent = formatMoney(income);
        get("#projectExpense").textContent = formatMoney(expense);
        get("#projectRemaining").textContent = formatMoney(remaining);

        const incomePct = percentOf(income, project.budget);
        const expensePct = percentOf(expense, project.budget);
        get("#ieIncomeNote").textContent = income > 0
            ? (incomePct === null ? "Total received" : `${incomePct}% of the budget received`)
            : "Nothing received yet";
        get("#ieExpenseNote").textContent = expense > 0
            ? (expensePct === null ? "Total spent" : `${expensePct}% of the budget spent`)
            : "Nothing spent yet";
        get("#ieRemainingNote").textContent = remaining < 0 ? "Over budget" : "Budget less expenses";
        get("#projectRemaining").closest(".bn-tile").classList.toggle("over", remaining < 0);

        drawCashFlowChart();
    }

    function monthLabel(dateString) {
        const [year, month] = dateString.split("-");
        const date = new Date(Number(year), Number(month) - 1, 1);
        return date.toLocaleDateString("en-PH", {
            month: "short",
            year: "2-digit",
        });
    }

    function shortMoney(value) {
        const abs = Math.abs(value);
        if (abs >= 1000000) return "₱" + (value / 1000000).toFixed(abs % 1000000 === 0 ? 0 : 1) + "M";
        if (abs >= 1000) return "₱" + (value / 1000).toFixed(abs % 1000 === 0 ? 0 : 1) + "K";
        return "₱" + Math.round(value);
    }

    // Round the top of the axis up to a tidy number so the grid lines fall on 1, 2, 2.5 or 5 steps.
    function niceCeil(value, steps) {
        const raw = value / steps;
        const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
        const fraction = raw / magnitude;
        const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
        return nice * magnitude * steps;
    }

    function roundedBar(ctx, x, y, w, h, r) {
        if (h <= 0) return;
        const radius = Math.min(r, w / 2, h);
        ctx.beginPath();
        ctx.moveTo(x, y + h);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.lineTo(x + w - radius, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
        ctx.lineTo(x + w, y + h);
        ctx.closePath();
        ctx.fill();
    }

    function drawCashFlowChart() {
        const canvas = get("#cashFlowChart");
        const ctx = canvas.getContext("2d");

        // Draw at the size the card really has, at device resolution, so text and bars stay sharp.
        const ratio = window.devicePixelRatio || 1;
        const width = Math.max(320, Math.round(canvas.clientWidth || 640));
        const height = Math.max(220, Math.round(width * 0.42));
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, width, height);

        const dark = document.documentElement.dataset.theme === "dark";
        const incomeColor = dark ? "#59b980" : "#2f7449";
        const expenseColor = dark ? "#e07b62" : "#a33f3f";
        const axisColor = dark ? "#c4cbd2" : "#66717d";
        const gridColor = dark ? "#3a4148" : "#e6eaee";
        const font = '"Segoe UI", Arial, sans-serif';

        const byMonth = {};

        (project.incomeEntries || []).forEach((entry) => {
            if (entry.postingStatus === "reversed" || entry.reversalOf) return;
            const key = (entry.date || "").slice(0, 7);
            if (!key) return;
            if (!byMonth[key]) byMonth[key] = { income: 0, expense: 0 };
            byMonth[key].income += money(entry.amount);
        });

        (project.expenseEntries || []).forEach((entry) => {
            if (entry.postingStatus === "reversed" || entry.reversalOf) return;
            const key = (entry.date || "").slice(0, 7);
            if (!key) return;
            if (!byMonth[key]) byMonth[key] = { income: 0, expense: 0 };
            byMonth[key].expense += money(entry.amount);
        });

        const months = Object.keys(byMonth).sort();

        if (months.length === 0) {
            ctx.fillStyle = axisColor;
            ctx.font = `14px ${font}`;
            ctx.textAlign = "center";
            ctx.fillText("No income or expense entries yet.", width / 2, height / 2);
            ctx.textAlign = "left";
            return;
        }

        const padding = { top: 16, right: 12, bottom: 32, left: 54 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        const maxRaw = Math.max(1, ...months.map((m) => Math.max(byMonth[m].income, byMonth[m].expense)));
        const steps = 4;
        const maxValue = niceCeil(maxRaw, steps);

        // Horizontal grid lines with amounts on the left
        ctx.lineWidth = 1;
        ctx.font = `11px ${font}`;
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        for (let i = 0; i <= steps; i += 1) {
            const value = (maxValue / steps) * i;
            const y = Math.round(padding.top + chartHeight - (value / maxValue) * chartHeight) + 0.5;
            ctx.strokeStyle = gridColor;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(padding.left + chartWidth, y);
            ctx.stroke();
            ctx.fillStyle = axisColor;
            ctx.fillText(shortMoney(value), padding.left - 8, y);
        }

        const groupWidth = chartWidth / months.length;
        const barWidth = Math.max(8, Math.min(34, groupWidth / 3));
        const gap = 4;

        months.forEach((monthKey, index) => {
            const groupX = padding.left + index * groupWidth + groupWidth / 2;
            const income = byMonth[monthKey].income;
            const expense = byMonth[monthKey].expense;

            const incomeHeight = (income / maxValue) * chartHeight;
            const expenseHeight = (expense / maxValue) * chartHeight;
            const baseY = padding.top + chartHeight;

            ctx.fillStyle = incomeColor;
            roundedBar(ctx, groupX - barWidth - gap / 2, baseY - incomeHeight, barWidth, incomeHeight, 5);
            ctx.fillStyle = expenseColor;
            roundedBar(ctx, groupX + gap / 2, baseY - expenseHeight, barWidth, expenseHeight, 5);

            ctx.fillStyle = axisColor;
            ctx.font = `11.5px ${font}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "alphabetic";
            ctx.fillText(monthLabel(monthKey + "-01"), groupX, baseY + 20);
        });

        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
    }

    let entryFilter = "all";
    let showReversed = false;

    function renderEntries() {
        const combined = [
            ...(project.incomeEntries || []).map((entry) => ({
                ...entry,
                entryType: "income",
            })),
            ...(project.expenseEntries || []).map((entry) => ({
                ...entry,
                entryType: "expense",
            })),
        ].sort((a, b) => new Date(b.date) - new Date(a.date));

        const isReversedItem = (entry) => entry.postingStatus === "reversed" || Boolean(entry.reversalOf);
        const reversedTotal = combined.filter(isReversedItem).length;
        get("#ieReversedCount").textContent = reversedTotal ? `(${reversedTotal})` : "";
        get("#ieShowReversed").checked = showReversed;

        const visible = combined
            .filter((entry) => showReversed || !isReversedItem(entry))
            .filter((entry) => entryFilter === "all" || entry.entryType === entryFilter);

        get("#ieCount").textContent = String(visible.length);
        get("#entryEmptyState").hidden = visible.length > 0;
        get("#entryEmptyState").textContent = combined.length === 0
            ? "No income or expense entries recorded yet."
            : entryFilter === "all"
                ? "No entries to show. Tick Show reversed to see reversed ones."
                : `No ${entryFilter} entries to show.`;
        get("#ieTableWrap").hidden = visible.length === 0;

        document.querySelectorAll("#ieEntries [data-filter]").forEach((button) => {
            button.setAttribute("aria-pressed", String(button.dataset.filter === entryFilter));
        });

        get("#entryTableBody").innerHTML = visible
            .map((entry) => {
                const reversed = entry.postingStatus === "reversed";
                const reversal = Boolean(entry.reversalOf);
                const isIncome = entry.entryType === "income";
                const sourceLabel = entry.sourceType && entry.sourceType !== "manual"
                    ? entry.sourceType.replaceAll("-", " ")
                    : "Manual";
                const status = reversed ? " · Reversed" : reversal ? " · Audit reversal" : " · Posted";
                return `
                    <tr class="${reversed ? "is-reversed" : ""}">
                        <td class="ie-date">${formatDate(entry.date)}</td>
                        <td><span class="mp-chip ${isIncome ? "in" : "out"}">${isIncome ? "Income" : "Expense"}${reversal ? " reversal" : ""}</span></td>
                        <td class="ie-desc">${escapeHtml(entry.description)}<small>${escapeHtml(sourceLabel)}${status}</small></td>
                        <td>${escapeHtml(entry.category) || "—"}</td>
                        <td>${escapeHtml(entry.referenceNo) || "—"}</td>
                        <td class="mp-num ie-amt ${isIncome ? "in" : "out"}">${formatMoney(entry.amount)}</td>
                        <td>
                            <div class="mp-row-actions">
                                ${reversed || reversal ? "" : `<button type="button" class="secondary-button reverse-entry" data-id="${entry.id}" data-type="${entry.entryType}">Reverse</button>`}
                            </div>
                        </td>
                    </tr>
                `;
            })
            .join("");

        document.querySelectorAll(".reverse-entry").forEach((button) => {
            button.addEventListener("click", async () => {
                const { id, type } = button.dataset;
                const confirmed = await window.CashbookDialogs.confirm(
                    "Reverse this posted transaction? The original and its reversing entry will remain in the audit history.",
                    { title: "Reverse transaction", confirmText: "Reverse" }
                );
                if (!confirmed) return;
                reverseEntryById(project, type, id, "Reversed from Income & Expense");
                project = upsertProject(project);

                refreshSummary();
                renderEntries();
            });
        });

        document.querySelectorAll(".edit-entry").forEach((button) => {
            button.addEventListener("click", () => {
                const { id, type } = button.dataset;
                const key = type === "income" ? "incomeEntries" : "expenseEntries";
                const entry = (project[key] || []).find((e) => e.id === id);
                if (!entry) return;

                get("#entryType").value = type;
                get("#entryDate").value = entry.date;
                get("#entryAmount").value = entry.amount;
                get("#entryDescription").value = entry.description || "";
                get("#entryReference").value = entry.referenceNo || "";
                if (type === "expense") {
                    get("#expenseCategory").value = entry.category || "Other";
                    get("#expenseCategoryField").hidden = false;
                    get("#incomeCategoryField").hidden = true;
                } else {
                    get("#incomeCategory").value = entry.category || "Other";
                    get("#expenseCategoryField").hidden = true;
                    get("#incomeCategoryField").hidden = false;
                }
                get("#entryForm").dataset.editId = id;
                get("#entryForm").dataset.editType = type;
                get("#entryForm").querySelector("button[type=submit]").textContent = "Update Entry";
                window.scrollTo({ top: 0, behavior: "smooth" });
            });
        });
    }

    get("#entryType").addEventListener("change", (event) => {
        const isExpense = event.target.value === "expense";
        get("#expenseCategoryField").hidden = !isExpense;
        get("#incomeCategoryField").hidden = isExpense;
    });

    get("#entryForm").addEventListener("submit", (event) => {
        event.preventDefault();

        const type = get("#entryType").value;
        const date = get("#entryDate").value;
        const amount = get("#entryAmount").value;
        const description = get("#entryDescription").value.trim();

        if (!date || money(amount) <= 0 || !description) {
            get("#entryFormMessage").textContent =
                "Date, a positive amount, and description are required.";
            return;
        }

        const category =
            type === "expense"
                ? get("#expenseCategory").value
                : get("#incomeCategory").value;

        const editId = get("#entryForm").dataset.editId;
        const editType = get("#entryForm").dataset.editType;

        if (editId) {
            // Remove from old type if type changed
            const oldKey = editType === "income" ? "incomeEntries" : "expenseEntries";
            const newKey = type === "income" ? "incomeEntries" : "expenseEntries";
            const existing = (project[oldKey] || []).find((e) => e.id === editId);
            if (existing) {
                if (oldKey === newKey) {
                    Object.assign(existing, {
                        date,
                        amount,
                        description,
                        referenceNo: get("#entryReference").value.trim(),
                        category,
                    });
                } else {
                    project[oldKey] = project[oldKey].filter((e) => e.id !== editId);
                    project[newKey] = [
                        ...(project[newKey] || []),
                        {
                            ...existing,
                            date,
                            amount,
                            description,
                            referenceNo: get("#entryReference").value.trim(),
                            category,
                        },
                    ];
                }
            }
            delete get("#entryForm").dataset.editId;
            delete get("#entryForm").dataset.editType;
            get("#entryForm").querySelector("button[type=submit]").textContent = "Save Entry";
        } else {
            const referenceNo = get("#entryReference").value.trim();
            if (referenceNo) {
                const duplicate = [...(project.incomeEntries || []), ...(project.expenseEntries || [])]
                    .find((entry) => entry.postingStatus !== "reversed" && !entry.reversalOf && String(entry.referenceNo || "").toLowerCase() === referenceNo.toLowerCase());
                if (duplicate) {
                    get("#entryFormMessage").textContent = `Reference ${referenceNo} is already used by another active transaction.`;
                    return;
                }
            }
            const id = createId();
            const entry = {
                id,
                date,
                amount,
                description,
                referenceNo,
                category,
                sourceType: "manual",
                sourceId: id,
                sourceIds: [id],
                sourceKey: transactionSourceKey("manual", id),
                postingStatus: "posted",
                postedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
            };
            const key = type === "income" ? "incomeEntries" : "expenseEntries";
            project[key] = [...(project[key] || []), entry];
            appendProjectAudit(project, "POST", "manual", entry.id, `Posted manual ${type}: ${description}`, {
                direction: type, amountCentavos: moneyToCentavos(amount), referenceNo,
            });
        }

        project = upsertProject(project);

        get("#entryForm").reset();
        get("#entryDate").value = getTodayValue();
        get("#expenseCategoryField").hidden = true;
        get("#incomeCategoryField").hidden = false;
        get("#entryFormMessage").textContent = "";

        refreshSummary();
        renderEntries();
    });

    document.querySelectorAll("#ieEntries [data-filter]").forEach((button) => {
        button.addEventListener("click", () => {
            entryFilter = button.dataset.filter;
            renderEntries();
        });
    });

    get("#ieShowReversed").addEventListener("change", (event) => {
        showReversed = event.target.checked;
        renderEntries();
    });

    // Keep the chart sharp when the window is resized or the theme is switched.
    let resizeTimer = null;
    window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(drawCashFlowChart, 120);
    });
    new MutationObserver(drawCashFlowChart).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    get("#entryDate").value = getTodayValue();

    refreshSummary();
    renderEntries();
})();
