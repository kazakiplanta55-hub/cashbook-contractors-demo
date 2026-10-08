"use strict";

// ======================================
// CASHBOOK FOR CONTRACTORS
// STORAGE ENGINE
// ======================================

const CLIENTS_KEY = "contractors_clients";
const PROJECTS_KEY = "contractors_projects";
const COMPANY_201_KEY = "contractors_company_201";
const SELECTED_CLIENT_KEY = "contractors_selected_client";
const SELECTED_PROJECT_KEY = "contractors_selected_project";

const CashbookDialogs = (() => {
    let active = null;
    function open({ title = "Cashbook for Contractors", message = "", confirmText = "OK", cancelText = "Cancel", inputValue = null, danger = false }) {
        if (active) active(false);
        const origin = document.activeElement;
        const overlay = document.createElement("div");
        overlay.className = "cashbook-dialog-overlay";
        overlay.innerHTML = `<section class="cashbook-dialog" role="dialog" aria-modal="true" aria-labelledby="cashbookDialogTitle"><h2 id="cashbookDialogTitle"></h2><p></p><input type="text" hidden><div class="cashbook-dialog-actions"><button type="button" class="secondary-button" data-action="cancel"></button><button type="button" data-action="confirm" class="primary-button"></button></div></section>`;
        overlay.querySelector("h2").textContent = title;
        overlay.querySelector("p").textContent = message;
        const input = overlay.querySelector("input");
        const cancel = overlay.querySelector('[data-action="cancel"]');
        const confirm = overlay.querySelector('[data-action="confirm"]');
        cancel.textContent = cancelText;
        confirm.textContent = confirmText;
        confirm.classList.toggle("danger-button", danger);
        if (inputValue !== null) { input.hidden = false; input.value = inputValue; }
        document.body.appendChild(overlay);
        return new Promise((resolve) => {
            const finish = (accepted) => {
                if (!overlay.isConnected) return;
                const value = inputValue !== null ? input.value.trim() : accepted;
                overlay.remove();
                active = null;
                requestAnimationFrame(() => { if (origin?.isConnected) origin.focus({ preventScroll: true }); });
                resolve(accepted ? value : false);
            };
            active = finish;
            cancel.addEventListener("click", () => finish(false));
            confirm.addEventListener("click", () => finish(true));
            overlay.addEventListener("keydown", (event) => {
                if (event.key === "Escape") { event.preventDefault(); finish(false); }
                if (event.key === "Enter" && event.target !== cancel) { event.preventDefault(); finish(true); }
                if (event.key === "Tab") {
                    const focusable = Array.from(overlay.querySelectorAll("input:not([hidden]),button"));
                    const index = focusable.indexOf(document.activeElement);
                    const next = event.shiftKey ? (index <= 0 ? focusable.length - 1 : index - 1) : (index >= focusable.length - 1 ? 0 : index + 1);
                    event.preventDefault(); focusable[next].focus();
                }
            });
            (inputValue !== null ? input : confirm).focus();
        });
    }
    return Object.freeze({
        confirm: (message, options = {}) => open({ ...options, message }),
        alert: (message, options = {}) => open({ ...options, message, cancelText: "", confirmText: options.confirmText || "OK" }),
        prompt: (message, value = "", options = {}) => open({ ...options, message, inputValue: value }),
    });
})();

window.CashbookDialogs = CashbookDialogs;

// --------------------------------------
// Data health reporting
// --------------------------------------
// Read/write now go through the main process (see main.js), which
// keeps checksummed files on disk with automatic rotating backups
// instead of relying solely on localStorage. This section makes any
// corruption or recovery event visible in the UI instead of silently
// swallowing it -- a business shouldn't find out a record is missing
// by noticing it's missing.

function hasStorageBridge() {
    return typeof window !== "undefined" && !!window.cbStorage;
}

function reportDataHealthIssue(issue) {
    console.warn("[Data health]", issue);
    if (typeof window === "undefined") {
        return;
    }
    window.__cbDataHealth = window.__cbDataHealth || [];
    window.__cbDataHealth.push(Object.assign({ at: new Date().toISOString() }, issue));
    showDataHealthBanner(issue);
}

function showDataHealthBanner(issue) {
    if (typeof document === "undefined") {
        return;
    }

    const render = () => {
        const bannerKey = `${issue.type}-${issue.key}`;
        if (document.querySelector(`[data-health-key="${bannerKey}"]`)) {
            return;
        }

        const banner = document.createElement("div");
        banner.setAttribute("data-health-key", bannerKey);
        banner.style.cssText =
            "position:fixed;top:0;left:0;right:0;z-index:9999;padding:10px 16px;" +
            "font:13px/1.4 -apple-system,Segoe UI,sans-serif;color:#fff;" +
            "background:" + (issue.type === "recovered" ? "#b8860b" : "#b3261e") + ";" +
            "display:flex;justify-content:space-between;align-items:center;gap:12px;" +
            "box-shadow:0 2px 6px rgba(0,0,0,.25);";

        const text = document.createElement("span");
        text.textContent = issue.message;

        const close = document.createElement("button");
        close.type = "button";
        close.textContent = "Dismiss";
        close.style.cssText =
            "background:transparent;border:1px solid #fff;color:#fff;border-radius:4px;" +
            "padding:4px 10px;cursor:pointer;flex-shrink:0;";
        close.addEventListener("click", () => banner.remove());

        banner.appendChild(text);
        banner.appendChild(close);
        document.body.prepend(banner);
    };

    if (document.body) {
        render();
    } else {
        document.addEventListener("DOMContentLoaded", render);
    }
}

function getDataDirectoryPath() {
    if (hasStorageBridge()) {
        try {
            return window.cbStorage.getDataDir();
        } catch (error) {
            console.error("Could not read data directory path.", error);
        }
    }
    return null;
}

function readJson(key, fallback) {
    if (hasStorageBridge()) {
        try {
            const result = window.cbStorage.readSync(key);

            if (result && result.corrupted) {
                reportDataHealthIssue({
                    type: "corrupted",
                    key,
                    message:
                        `Could not read ${key} and no usable backup was found. ` +
                        "Your on-disk files were NOT deleted -- please stop entering data and use Restore " +
                        "from the Settings menu, or contact support before continuing.",
                });
                return fallback;
            }

            if (result && result.recovered) {
                reportDataHealthIssue({
                    type: "recovered",
                    key,
                    message:
                        `${key.includes("client") ? "Client" : "Project"} data was automatically restored ` +
                        `from a recent backup (${result.recoveredFrom}) because the saved file was unreadable. ` +
                        "Please review your records for anything entered since that backup.",
                });
            }

            const value = result ? result.value : null;
            return value === null || value === undefined ? fallback : value;
        } catch (error) {
            console.error(`Bridge read failed for ${key}, falling back to localStorage.`, error);
        }
    }

    try {
        return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch (error) {
        console.error(`Could not read ${key}.`, error);
        return fallback;
    }
}

function writeJson(key, value) {
    if (hasStorageBridge()) {
        try {
            const result = window.cbStorage.writeSync(key, value);
            if (!result || !result.ok) {
                reportDataHealthIssue({
                    type: "write-failed",
                    key,
                    message:
                        `Saving ${key} to disk just failed. Your latest change may only exist in this open ` +
                        "window -- please use Backup from the Settings menu now, and avoid closing the app.",
                });
            }
            return;
        } catch (error) {
            console.error(`Bridge write failed for ${key}, falling back to localStorage.`, error);
        }
    }

    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.error(`Could not write ${key}.`, error);
    }
}

function createId() {
    if (
        globalThis.crypto &&
        typeof crypto.randomUUID === "function"
    ) {
        return crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function moneyToCentavos(value) {
    const number = Number(String(value ?? 0).replaceAll(",", ""));
    if (!Number.isFinite(number)) return 0;
    return Math.round((number + Math.sign(number) * Number.EPSILON) * 100);
}

function centavosToMoney(value) {
    return (Number.isSafeInteger(Number(value)) ? Number(value) : 0) / 100;
}

const MONEY_FIELDS = ["amount", "totalAmount", "unitCost", "grossPay", "basicPay", "allowance", "nightDiff", "holidayFee", "otPay", "otherFee", "ratePerDay", "dailyRate", "hourlyRate", "otRate", "regularHourlyRate", "overtimeHourlyRate"];

function normalizeMoneyFields(record) {
    if (!record || typeof record !== "object" || Array.isArray(record)) return record;
    const normalized = { ...record };
    MONEY_FIELDS.forEach((field) => {
        const centsField = `${field}Centavos`;
        // The peso field is what pages edit, so it wins. The centavo copy is only used when the peso field is missing
        // (otherwise an edited amount was silently reverted to its old centavo value on save).
        const hasPlain = normalized[field] !== undefined && normalized[field] !== null && normalized[field] !== "";
        const storedCents = Number(normalized[centsField]);
        const cents = hasPlain ? moneyToCentavos(normalized[field]) : (Number.isSafeInteger(storedCents) ? storedCents : moneyToCentavos(normalized[field]));
        if (normalized[field] !== undefined || normalized[centsField] !== undefined) {
            normalized[centsField] = cents;
            normalized[field] = centavosToMoney(cents);
        }
    });
    return normalized;
}

function dateValueToTime(value) {
    const time = Date.parse(`${value || ""}T00:00:00`);
    return Number.isFinite(time) ? time : null;
}

function getProjectPlannedSchedule(project) {
    const programs = Array.isArray(project?.programsOfWork) ? project.programsOfWork : [];
    const projectStartTime = dateValueToTime(project?.startDate);
    const projectEndTime = dateValueToTime(project?.targetEndDate);
    if (projectStartTime === null || projectEndTime === null || projectEndTime <= projectStartTime) {
        return { valid: false, source: "project", reason: "Add valid project start and target finish dates" };
    }
    if (!programs.length) {
        return { valid: false, source: "programs", reason: "Add a Program of Works to calculate planned progress" };
    }
    const unscheduledPrograms = programs.filter((program) => !dateValueToTime(program.startDate) || !dateValueToTime(program.endDate));
    if (unscheduledPrograms.length) {
        return {
            valid: false,
            source: "programs",
            reason: `Add start and finish dates to ${unscheduledPrograms.length} Program${unscheduledPrograms.length === 1 ? "" : "s"} of Works`,
        };
    }
    const items = programs.flatMap((program) => (program.items || []).map((item) => ({
        ...item,
        programId: program.id,
        programWeight: Number(program.weight) > 0 ? Number(program.weight) : 100,
        programName: program.name || "Program of Work",
        programStartDate: program.startDate,
        programEndDate: program.endDate,
    })));

    if (items.length) {
        const incomplete = items.filter((item) => !dateValueToTime(item.startDate) || !dateValueToTime(item.endDate));
        if (incomplete.length) {
            return {
                valid: false,
                source: "sub-items",
                reason: `Add start and finish dates to ${incomplete.length} sub-item${incomplete.length === 1 ? "" : "s"}`,
                incomplete,
            };
        }

        const scheduled = items.map((item) => ({
            ...item,
            startTime: dateValueToTime(item.startDate),
            endTime: dateValueToTime(item.endDate),
            weight: Number(item.weight) > 0 ? Number(item.weight) : 100,
        }));
        if (scheduled.some((item) => item.endTime < item.startTime)) {
            return { valid: false, source: "sub-items", reason: "A sub-item finish date is earlier than its start date" };
        }
        if (scheduled.some((item) => item.startTime < projectStartTime || item.endTime > projectEndTime)) {
            return { valid: false, source: "sub-items", reason: "A sub-item schedule falls outside the project schedule" };
        }
        if (scheduled.some((item) => item.startDate < item.programStartDate || item.endDate > item.programEndDate)) {
            return { valid: false, source: "sub-items", reason: "A sub-item schedule falls outside its Program of Works" };
        }
        const boundaryTimes = [...new Set(scheduled.flatMap((item) => [item.startTime, item.endTime]))].sort((a, b) => a - b);

        // Group by program so planned progress rolls up the same way actual
        // progress does: item weight within a program, then program weight
        // within the project. A missing/zero weight defaults to 100, so
        // unweighted programs/items behave exactly like a flat average.
        const byProgram = new Map();
        scheduled.forEach((item) => {
            if (!byProgram.has(item.programId)) {
                byProgram.set(item.programId, { weight: item.programWeight, items: [] });
            }
            byProgram.get(item.programId).items.push(item);
        });

        return {
            valid: true,
            source: "sub-items",
            startTime: boundaryTimes[0],
            endTime: boundaryTimes[boundaryTimes.length - 1],
            boundaryTimes,
            progressAt(time) {
                const current = typeof time === "number" ? time : dateValueToTime(time);
                if (!Number.isFinite(current)) return 0;
                let weightedSum = 0;
                let totalWeight = 0;
                byProgram.forEach(({ weight: programWeight, items: programItems }) => {
                    let itemWeightedSum = 0;
                    let itemTotalWeight = 0;
                    programItems.forEach((item) => {
                        const itemProgress = item.endTime <= item.startTime
                            ? (current >= item.startTime ? 1 : 0)
                            : Math.min(1, Math.max(0, (current - item.startTime) / (item.endTime - item.startTime)));
                        itemWeightedSum += itemProgress * item.weight;
                        itemTotalWeight += item.weight;
                    });
                    const programProgress = itemTotalWeight > 0 ? itemWeightedSum / itemTotalWeight : 0;
                    weightedSum += programProgress * programWeight;
                    totalWeight += programWeight;
                });
                return totalWeight > 0 ? (weightedSum / totalWeight) * 100 : 0;
            },
        };
    }

    return {
        valid: true,
        source: "project",
        startTime: projectStartTime,
        endTime: projectEndTime,
        boundaryTimes: [projectStartTime, projectEndTime],
        progressAt(time) {
            const current = typeof time === "number" ? time : dateValueToTime(time);
            if (!Number.isFinite(current)) return 0;
            return Math.min(100, Math.max(0, ((current - projectStartTime) / (projectEndTime - projectStartTime)) * 100));
        },
    };
}

function calculatePlannedProgress(project, onDate = getTodayValue()) {
    const schedule = getProjectPlannedSchedule(project);
    return schedule.valid ? schedule.progressAt(onDate) : null;
}

// --------------------------------------
// Clients
// --------------------------------------

function loadClients() {
    const clients = readJson(CLIENTS_KEY, []);
    return Array.isArray(clients) ? clients.map((client) => ({
        ...client,
        archivedAt: client.archivedAt || "",
        auditTrail: Array.isArray(client.auditTrail) ? client.auditTrail : [],
    })) : [];
}

function saveClients(clients) {
    writeJson(CLIENTS_KEY, clients);
}

// Company 201 files: the main company's own people (project 201 files live inside each project's workers).
function loadCompany201() {
    const list = readJson(COMPANY_201_KEY, []);
    return Array.isArray(list) ? list.filter((p) => p && typeof p === "object") : [];
}

function saveCompany201(list) {
    writeJson(COMPANY_201_KEY, list);
}

// 201 documents (scanned PDFs, 2x2 photo, IDs, credentials). The person's record only keeps a small list
// (person.documents); each file itself is saved under its own key so the big client/project data is never
// rewritten when a document is added.
function documentKey(id) {
    return `contractors_doc_${String(id).replace(/[^a-z0-9]/gi, "_")}`;
}

function saveDocumentFile(id, dataUrl) {
    writeJson(documentKey(id), { id, dataUrl });
}

function loadDocumentFile(id) {
    const doc = readJson(documentKey(id), null);
    return doc && typeof doc.dataUrl === "string" ? doc.dataUrl : "";
}

function deleteDocumentFile(id) {
    writeJson(documentKey(id), null);
}

// Every document id referenced by company 201 files and project workers.
function allDocumentIds() {
    const ids = [];
    const take = (person) => (Array.isArray(person && person.documents) ? person.documents : []).forEach((d) => d && d.id && ids.push(d.id));
    loadCompany201().forEach(take);
    loadProjects().forEach((project) => (project.workers || []).forEach(take));
    return ids;
}

// Project codes are shown on the workspace card and used to tell projects apart. A project without a saved code used
// to get PRJ-<year>-<position in the list>, so deleting or re-dating a project could renumber the others.
// This saves the code each project shows today (so nothing visible changes) and keeps it from then on.
function ensureProjectCodes() {
    const core = window.CbcWorkspaceCore;
    if (!core) return;
    const projects = loadProjects();
    const missing = projects.filter((project) => !project.projectCode);
    if (!missing.length) return;
    const taken = new Set(projects.filter((project) => project.projectCode).map((project) => String(project.projectCode).trim().toUpperCase()));
    const bump = (code) => (/\d+$/.test(code) ? code.replace(/\d+$/, (n) => String(Number(n) + 1).padStart(n.length, "0")) : code + "-2");
    const assigned = new Map();
    missing.forEach((project) => {
        let code = core.projectCode(project, projects);
        while (taken.has(code)) code = bump(code);
        taken.add(code);
        assigned.set(project.id, code);
    });
    saveProjects(projects.map((project) => (assigned.has(project.id) ? { ...project, projectCode: assigned.get(project.id) } : project)));
}

function getSelectedClientId() {
    return readJson(SELECTED_CLIENT_KEY, null);
}

function setSelectedClientId(clientId) {
    if (clientId) {
        writeJson(SELECTED_CLIENT_KEY, clientId);
    } else {
        writeJson(SELECTED_CLIENT_KEY, null);
    }
}

function getClientById(clientId) {
    return loadClients().find(
        (client) => client.id === clientId
    ) || null;
}

function upsertClient(client) {
    const clients = loadClients();
    const index = clients.findIndex(
        (item) => item.id === client.id
    );

    if (index >= 0) {
        clients[index] = client;
    } else {
        clients.push(client);
    }

    saveClients(clients);
    return client;
}

function deleteClient(clientId) {
    const clients = loadClients().filter(
        (client) => client.id !== clientId
    );
    saveClients(clients);
}

// --------------------------------------
// Projects
// --------------------------------------

function loadProjects() {
    const projects = readJson(PROJECTS_KEY, []);
    return Array.isArray(projects) ? projects.map((project) => ({
        ...project,
        budget: centavosToMoney(Number.isSafeInteger(Number(project.budgetCentavos)) ? Number(project.budgetCentavos) : moneyToCentavos(project.budget)),
        materialsBudget: centavosToMoney(Number.isSafeInteger(Number(project.materialsBudgetCentavos)) ? Number(project.materialsBudgetCentavos) : moneyToCentavos(project.materialsBudget)),
        incomeEntries: (project.incomeEntries || []).map(normalizeMoneyFields),
        expenseEntries: (project.expenseEntries || []).map(normalizeMoneyFields),
        materialEntries: (project.materialEntries || []).map(normalizeMoneyFields),
        purchaseOrders: (project.purchaseOrders || []).map(normalizeMoneyFields),
        workers: (project.workers || []).map(normalizeMoneyFields),
        payrollEntries: (project.payrollEntries || []).map(normalizeMoneyFields),
        chequeEntries: (project.chequeEntries || []).map(normalizeMoneyFields),
    })) : [];
}

function saveProjects(projects) {
    writeJson(PROJECTS_KEY, projects);
}

function getProjectsForClient(clientId, options = {}) {
    return loadProjects().filter(
        (project) => project.clientId === clientId && (options.includeArchived || !project.archivedAt)
    );
}

function getProjectById(projectId) {
    return loadProjects().find(
        (project) => project.id === projectId
    ) || null;
}

function getSelectedProjectId() {
    return readJson(SELECTED_PROJECT_KEY, null);
}

function setSelectedProjectId(projectId) {
    if (projectId) {
        writeJson(SELECTED_PROJECT_KEY, projectId);
    } else {
        writeJson(SELECTED_PROJECT_KEY, null);
    }
}

function normalizeProject(project) {
    return {
        id: project.id || createId(),
        clientId: project.clientId || "",
        projectName: project.projectName || "",
        projectCode: project.projectCode || "",
        siteAddress: project.siteAddress || "",
        budget: centavosToMoney(moneyToCentavos(project.budget)),
        budgetCentavos: moneyToCentavos(project.budget),
        materialsBudget: centavosToMoney(moneyToCentavos(project.materialsBudget)),
        materialsBudgetCentavos: moneyToCentavos(project.materialsBudget),
        startDate: project.startDate || "",
        targetEndDate: project.targetEndDate || "",
        actualEndDate: project.actualEndDate || "",
        percentComplete: Math.min(
            100,
            Math.max(0, Number(project.percentComplete) || 0)
        ),
        status: project.status || "Ongoing",
        archivedAt: project.archivedAt || "",
        notes: project.notes || "",
        incomeEntries: Array.isArray(project.incomeEntries)
            ? project.incomeEntries.map(normalizeMoneyFields)
            : [],
        expenseEntries: Array.isArray(project.expenseEntries)
            ? project.expenseEntries.map(normalizeMoneyFields)
            : [],
        materialEntries: Array.isArray(project.materialEntries)
            ? project.materialEntries.map(normalizeMoneyFields)
            : [],
        purchaseOrders: Array.isArray(project.purchaseOrders)
            ? project.purchaseOrders.map(normalizeMoneyFields)
            : [],
        workers: Array.isArray(project.workers)
            ? project.workers.map(normalizeMoneyFields)
            : [],
        roles: Array.isArray(project.roles)
            ? project.roles
            : [],
        payrollEntries: Array.isArray(project.payrollEntries)
            ? project.payrollEntries.map(normalizeMoneyFields)
            : [],
        progressHistory: Array.isArray(project.progressHistory)
            ? project.progressHistory.map((point) => ({
                ...point,
                date: point.date || getTodayValue(),
                percentComplete: Math.min(100, Math.max(0, Number(point.percentComplete) || 0)),
                recordedAt: point.recordedAt || "",
            }))
            : [],
        programsOfWork: Array.isArray(project.programsOfWork)
            ? project.programsOfWork.map((program) => ({
                ...program,
                startDate: program.startDate || "",
                endDate: program.endDate || "",
                // Weight defaults to 100 so a program/item without a custom
                // weight behaves exactly like the old flat 1/N average.
                weight: Number(program.weight) > 0 ? Number(program.weight) : 100,
                items: Array.isArray(program.items) ? program.items.map((item) => ({
                    ...item,
                    startDate: item.startDate || "",
                    endDate: item.endDate || "",
                    completedAt: item.completedAt || "",
                    weight: Number(item.weight) > 0 ? Number(item.weight) : 100,
                })) : [],
            }))
            : [],
        chequeEntries: Array.isArray(project.chequeEntries)
            ? project.chequeEntries.map(normalizeMoneyFields)
            : [],
        progressOverride: project.progressOverride && typeof project.progressOverride === "object"
            ? project.progressOverride
            : null,
        auditTrail: Array.isArray(project.auditTrail)
            ? project.auditTrail
            : [],
        createdAt: project.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}

function upsertProject(project, options) {
    const note = options && options.note ? options.note : "";
    const projects = loadProjects();
    const normalized = normalizeProject(project);
    const index = projects.findIndex(
        (item) => item.id === normalized.id
    );

    const previous = index >= 0 ? projects[index] : null;
    // A page that opened the project before its code was saved must not blank that code.
    if (previous && previous.projectCode && !normalized.projectCode) normalized.projectCode = previous.projectCode;
    const previousPercent = previous
        ? previous.percentComplete
        : null;

    if (
        previousPercent === null ||
        previousPercent !== normalized.percentComplete
    ) {
        normalized.progressHistory = [
            ...(normalized.progressHistory || []),
            {
                id: createId(),
                date: getTodayValue(),
                recordedAt: new Date().toISOString(),
                percentComplete: normalized.percentComplete,
                note,
            },
        ];
    }

    if (index >= 0) {
        projects[index] = normalized;
    } else {
        projects.push(normalized);
    }

    saveProjects(projects);
    return normalized;
}

function deleteProject(projectId) {
    const projects = loadProjects().filter(
        (project) => project.id !== projectId
    );
    saveProjects(projects);
}

// --------------------------------------
// Financial controls / audit history
// --------------------------------------

function appendProjectAudit(project, action, entityType, entityId, summary, details = {}) {
    const entry = {
        id: createId(),
        at: new Date().toISOString(),
        action,
        entityType,
        entityId: entityId || "",
        summary: String(summary || ""),
        details,
    };
    project.auditTrail = [...(project.auditTrail || []), entry].slice(-2000);
    return entry;
}

function normalizeSourceIds(sourceIds) {
    return [...new Set((Array.isArray(sourceIds) ? sourceIds : [sourceIds])
        .filter(Boolean)
        .map(String))].sort();
}

function transactionSourceKey(sourceType, sourceIds) {
    return `${String(sourceType || "manual")}:${normalizeSourceIds(sourceIds).join("|")}`;
}

function linkedEntries(project, direction) {
    return direction === "income" ? (project.incomeEntries || []) : (project.expenseEntries || []);
}

function findPostedSourceEntry(project, direction, sourceType, sourceIds) {
    const ids = normalizeSourceIds(sourceIds);
    return linkedEntries(project, direction).find((entry) => {
        if (entry.sourceType !== sourceType || entry.postingStatus === "reversed" || entry.reversalOf) return false;
        const entryIds = normalizeSourceIds(entry.sourceIds || entry.sourceId);
        return ids.some((id) => entryIds.includes(id));
    }) || null;
}

function postProjectTransaction(project, direction, options) {
    const sourceIds = normalizeSourceIds(options.sourceIds || options.sourceId);
    const existing = findPostedSourceEntry(project, direction, options.sourceType, sourceIds);
    if (existing) return { ok: false, reason: "already-posted", existing };

    const entry = normalizeMoneyFields({
        id: createId(),
        date: options.date || getTodayValue(),
        amount: money(options.amount),
        description: options.description || "",
        referenceNo: options.referenceNo || "",
        category: options.category || "Other",
        sourceType: options.sourceType,
        sourceId: sourceIds.length === 1 ? sourceIds[0] : undefined,
        sourceIds,
        sourceKey: transactionSourceKey(options.sourceType, sourceIds),
        postingStatus: "posted",
        postedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
    });
    const key = direction === "income" ? "incomeEntries" : "expenseEntries";
    project[key] = [...(project[key] || []), entry];
    appendProjectAudit(project, "POST", options.sourceType, entry.id, options.auditSummary || entry.description, {
        direction,
        amountCentavos: moneyToCentavos(entry.amount),
        sourceIds,
    });
    return { ok: true, entry };
}

function reverseEntryById(project, direction, entryId, reason) {
    const original = linkedEntries(project, direction).find((entry) => entry.id === entryId && entry.postingStatus !== "reversed" && !entry.reversalOf);
    if (!original) return { ok: false, reason: "not-posted" };
    const sourceType = original.sourceType || "manual";
    const sourceIds = normalizeSourceIds(original.sourceIds || original.sourceId || original.id);
    const now = new Date().toISOString();
    original.postingStatus = "reversed";
    original.reversedAt = now;
    original.reversalReason = String(reason || "Source record was reversed");
    const reversal = normalizeMoneyFields({
        id: createId(),
        date: getTodayValue(),
        amount: -money(original.amount),
        description: `REVERSAL — ${original.description}`,
        referenceNo: original.referenceNo || "",
        category: original.category || "Other",
        sourceType: `${sourceType}-reversal`,
        sourceIds: normalizeSourceIds(sourceIds),
        sourceKey: original.sourceKey || transactionSourceKey(sourceType, sourceIds),
        reversalOf: original.id,
        postingStatus: "posted",
        postedAt: now,
        createdAt: now,
    });
    const key = direction === "income" ? "incomeEntries" : "expenseEntries";
    project[key] = [...(project[key] || []), reversal];
    // A purchase order installment whose payment is reversed (from any screen) goes back to Due, so the order never
    // shows Paid without a cash-out behind it.
    if (sourceType === "po-installment") {
        const installmentId = normalizeSourceIds(sourceIds)[0];
        (project.purchaseOrders || []).forEach((po) => (Array.isArray(po.installments) ? po.installments : []).forEach((item) => {
            if (item.id !== installmentId || item.status !== "Paid") return;
            item.status = "Due";
            delete item.paidDate; delete item.reference; delete item.expenseEntryId;
            appendProjectAudit(project, "STATUS", "po-installment", item.id, `${po.poNumber}: installment Paid to Due (payment reversed in Cash Out)`);
        }));
    }
    appendProjectAudit(project, "REVERSE", sourceType, original.id, reversal.description, {
        direction,
        amountCentavos: moneyToCentavos(original.amount),
        reason: original.reversalReason,
    });
    return { ok: true, original, reversal };
}

function reverseProjectTransaction(project, direction, sourceType, sourceIds, reason) {
    const original = findPostedSourceEntry(project, direction, sourceType, sourceIds);
    return original ? reverseEntryById(project, direction, original.id, reason) : { ok: false, reason: "not-posted" };
}

function archiveProject(projectId) {
    const project = getProjectById(projectId);
    if (!project || project.archivedAt) return null;
    project.archivedAt = new Date().toISOString();
    appendProjectAudit(project, "ARCHIVE", "project", project.id, `Archived project ${project.projectName}`);
    return upsertProject(project);
}

function restoreProject(projectId) {
    const project = getProjectById(projectId);
    if (!project || !project.archivedAt) return null;
    project.archivedAt = "";
    appendProjectAudit(project, "RESTORE", "project", project.id, `Restored project ${project.projectName}`);
    return upsertProject(project);
}

function archiveClient(clientId) {
    const clients = loadClients();
    const client = clients.find((item) => item.id === clientId);
    if (!client || client.archivedAt) return null;
    client.archivedAt = new Date().toISOString();
    client.auditTrail = [...(client.auditTrail || []), {
        id: createId(), at: client.archivedAt, action: "ARCHIVE", entityType: "client",
        entityId: client.id, summary: `Archived client ${client.clientName}`,
    }].slice(-2000);
    saveClients(clients);
    return client;
}

function restoreClient(clientId) {
    const clients = loadClients();
    const client = clients.find((item) => item.id === clientId);
    if (!client || !client.archivedAt) return null;
    client.archivedAt = "";
    client.auditTrail = [...(client.auditTrail || []), {
        id: createId(), at: new Date().toISOString(), action: "RESTORE", entityType: "client",
        entityId: client.id, summary: `Restored client ${client.clientName}`,
    }].slice(-2000);
    saveClients(clients);
    return client;
}

// --------------------------------------
// Money / date helpers
// --------------------------------------

function money(value) {
    return centavosToMoney(moneyToCentavos(value));
}

function sumMoney(values, selector = (value) => value) {
    return centavosToMoney((Array.isArray(values) ? values : []).reduce((total, value) => total + moneyToCentavos(selector(value)), 0));
}

function formatMoney(value) {
    return `₱${money(value).toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

function formatDate(value) {
    if (!value) {
        return "—";
    }

    const parts = value.split("-");
    if (parts.length !== 3) {
        return value;
    }

    const date = new Date(
        Number(parts[0]),
        Number(parts[1]) - 1,
        Number(parts[2])
    );

    return date.toLocaleDateString("en-PH", {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}

function getTodayValue() {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date());
    const values = Object.fromEntries(
        parts.map((part) => [part.type, part.value])
    );
    return `${values.year}-${values.month}-${values.day}`;
}

// --------------------------------------
// Backup / Restore
// --------------------------------------

function simpleChecksum(text) {
    if (window.cbStorage?.checksumSync) {
        const checksum = window.cbStorage.checksumSync(text);
        if (checksum) return checksum;
    }
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
        hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16);
}

// HR part of a backup (company 201 files and the scanned documents). Kept in its own checksum so that older
// backup files, which only had a clients/projects checksum, still restore.
function hrChecksumOf(company201, hrDocuments) {
    return simpleChecksum(JSON.stringify({ company201, hrDocuments }));
}

function exportAllDataAsFile() {
    const clients = loadClients();
    const projects = loadProjects();
    const dataText = JSON.stringify({ clients, projects });
    const company201 = loadCompany201();
    const hrDocuments = allDocumentIds().map((id) => ({ id, dataUrl: loadDocumentFile(id) })).filter((d) => d.dataUrl);

    const payload = {
        app: "cashbook-for-contractors",
        backupFormatVersion: 3,
        exportedAt: new Date().toISOString(),
        checksum: simpleChecksum(dataText),
        hrChecksum: hrChecksumOf(company201, hrDocuments),
        clients,
        projects,
        company201,
        hrDocuments,
    };

    // Compact JSON (no indentation): scanned documents are large and pretty-printing only makes the file bigger.
    const blob = new Blob([JSON.stringify(payload)], {
        type: "application/json",
    });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `Cashbook-Contractors-Backup-${getTodayValue()}.json`;
    link.click();

    // Keep the blob alive long enough for a large file to be written out.
    setTimeout(() => URL.revokeObjectURL(url), 30000);

    // The restore-point copy kept on this computer. Callers that must not continue without it check .internalBackupOk.
    let internalBackupOk = !hasStorageBridge();
    if (hasStorageBridge()) {
        try {
            const result = window.cbStorage.backupNow();
            internalBackupOk = !!(result && result.ok);
        } catch (error) {
            console.error("Could not trigger an additional internal backup.", error);
        }
    }
    return { internalBackupOk, fileName: link.download };
}

function restoreAllDataFromFile(file, onDone) {
    const reader = new FileReader();

    reader.onload = () => {
        try {
            const payload = JSON.parse(reader.result);

            if (
                !payload ||
                !Array.isArray(payload.clients) ||
                !Array.isArray(payload.projects)
            ) {
                onDone(false, "That file doesn't look like a valid backup.");
                return;
            }

            const corrupted = () => onDone(
                false,
                "This backup file failed its checksum check -- it may be corrupted or incomplete. " +
                    "Nothing was changed. Try a different backup copy."
            );
            if (payload.checksum) {
                const dataText = JSON.stringify({
                    clients: payload.clients,
                    projects: payload.projects,
                });
                if (simpleChecksum(dataText) !== payload.checksum) { corrupted(); return; }
            }
            // A backup made before HR existed has no HR section; one that has it must also pass its HR checksum.
            const hasHr = Array.isArray(payload.company201);
            const hrDocs = Array.isArray(payload.hrDocuments) ? payload.hrDocuments : [];
            if (hasHr && payload.hrChecksum && hrChecksumOf(payload.company201, hrDocs) !== payload.hrChecksum) { corrupted(); return; }

            // Safety net: back up what's currently on disk before we
            // overwrite it, in case the file being restored turns out
            // to be the wrong one.
            if (hasStorageBridge()) {
                try {
                    window.cbStorage.backupNow();
                } catch (error) {
                    console.error("Pre-restore safety backup failed.", error);
                }
            }

            const documentsBefore = hasHr ? allDocumentIds() : [];
            saveClients(payload.clients);
            saveProjects(payload.projects);
            if (hasHr) {
                saveCompany201(payload.company201);
                hrDocs.forEach((d) => d && d.id && d.dataUrl && saveDocumentFile(d.id, d.dataUrl));
                // Scanned files that belong to people who are not in the restored backup are removed, so HR matches the file.
                const keep = new Set(allDocumentIds());
                documentsBefore.filter((id) => !keep.has(id)).forEach(deleteDocumentFile);
            }

            onDone(true, hasHr
                ? "Backup restored successfully."
                : "Backup restored. This file was made before the HR page existed, so the HR files already on this computer were left as they are.");
        } catch (error) {
            onDone(false, "Could not read that file as a backup.");
        }
    };

    reader.onerror = () => {
        onDone(false, "Could not read that file.");
    };

    reader.readAsText(file);
}

function loadProjectFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get("id");
    const project = projectId ? getProjectById(projectId) : null;

    if (!project) {
        document.querySelectorAll("main > section").forEach((section) => {
            section.hidden = true;
        });
        const notFound = document.querySelector("#notFoundState");
        if (notFound) {
            notFound.hidden = false;
        }
        return null;
    }

    const client = getClientById(project.clientId);
    const titleEl = document.querySelector("#projectTitle");
    const clientEl = document.querySelector("#projectClientName");

    if (titleEl) {
        titleEl.textContent = project.projectName;
    }
    if (clientEl) {
        clientEl.textContent = client
            ? client.clientName
            : "Unknown client";
    }

    document.querySelectorAll("[data-project-link]").forEach((link) => {
        const url = new URL(link.href);
        url.searchParams.set("id", project.id);
        link.href = url.toString();
    });

    return { project, client };
}
