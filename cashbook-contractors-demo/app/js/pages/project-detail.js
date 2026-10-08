"use strict";

(function () {
    function get(selector) {
        return document.querySelector(selector);
    }

    const loaded = loadProjectFromUrl();
    if (!loaded) {
        return;
    }

    const { project } = loaded;

    get("#projectStatus").textContent = project.status;
    get("#projectAddress").textContent = project.siteAddress || "—";
    get("#projectNotes").textContent = project.notes || "—";

    get("#progressFill").style.width = project.percentComplete + "%";
    get("#progressPercentLabel").textContent =
        project.percentComplete + "% complete";
    get("#projectDates").textContent = `${formatDate(
        project.startDate
    )} → ${
        project.targetEndDate
            ? formatDate(project.targetEndDate)
            : "No target date"
    }`;

    const income = sumMoney(project.incomeEntries || [], (entry) => entry.amount);
    const expense = sumMoney(project.expenseEntries || [], (entry) => entry.amount);

    get("#projectBudget").textContent = formatMoney(project.budget);
    get("#projectIncome").textContent = formatMoney(income);
    get("#projectExpense").textContent = formatMoney(expense);
    get("#projectRemaining").textContent = formatMoney(
        project.budget - expense
    );

    get("#activityLogLink").href = `../activity-log/activity-log.html?id=${project.id}`;

    get("#editProjectButton").addEventListener("click", () => {
        window.location.href =
            "../projects/projects.html?edit=" + project.id;
    });
})();
