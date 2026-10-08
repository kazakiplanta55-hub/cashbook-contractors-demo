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

    function statusClass(status) {
        if (status === "Completed") return "completed";
        if (status === "On Hold") return "on-hold";
        return "ongoing";
    }

    function projectTotals(project) {
        const income = sumMoney(project.incomeEntries || [], (entry) => entry.amount);
        const expense = sumMoney(project.expenseEntries || [], (entry) => entry.amount);
        return { income, expense };
    }

    function diffDays(fromDateStr, toDateStr) {
        const from = dateValueToTime(fromDateStr);
        const to = dateValueToTime(toDateStr);
        if (from === null || to === null) return null;
        return Math.round((to - from) / (1000 * 60 * 60 * 24));
    }

    function daysBetween(dateString) {
        const today = new Date(getTodayValue());
        const due = new Date(dateString);
        return Math.round((due - today) / (1000 * 60 * 60 * 24));
    }

    const FILTER_CLIENT_KEY = "cbc_dashboard_client_filter";
    const FILTER_PROJECT_KEY = "cbc_dashboard_project_filter";

    // Loaded once — the filter dropdowns scope everything below down to a
    // subset of these, they never refetch from storage.
    const allClients = loadClients().filter((client) => !client.archivedAt);
    const allProjects = loadProjects().filter((project) => !project.archivedAt);

    get("#dashboardEmptyState").hidden = allProjects.length > 0;

    // --------------------------------------
    // Filter bar — Client scopes the whole dashboard, Project picks what's
    // featured in the Hero and Phase Progress cards (defaults to "Auto",
    // the most recently updated active project in the current scope).
    // --------------------------------------

    function populateClientFilterOptions() {
        const select = get("#dashboardClientFilter");
        const current = select.value;
        select.innerHTML =
            `<option value="">All Clients</option>` +
            allClients
                .map((client) => `<option value="${client.id}">${escapeHtml(client.clientName)}</option>`)
                .join("");
        select.value = allClients.some((client) => client.id === current) ? current : "";
    }

    function populateProjectFilterOptions(scopeClientId) {
        const select = get("#dashboardProjectFilter");
        const current = select.value;
        const pool = allProjects.filter(
            (project) => project.status !== "Completed" && (!scopeClientId || project.clientId === scopeClientId)
        );
        select.innerHTML =
            `<option value="">Auto (most recently active)</option>` +
            pool.map((project) => `<option value="${project.id}">${escapeHtml(project.projectName)}</option>`).join("");
        select.value = pool.some((project) => project.id === current) ? current : "";
    }

    // Restore a saved filter, but only if it still points at something real.
    // populateClientFilterOptions() rebuilds the <select>'s innerHTML from
    // scratch, which wipes any .value set beforehand — so options must be
    // built FIRST, then the saved value applied against the real <option>
    // elements that now exist.
    populateClientFilterOptions();
    const savedClientId = localStorage.getItem(FILTER_CLIENT_KEY) || "";
    if (allClients.some((client) => client.id === savedClientId)) {
        get("#dashboardClientFilter").value = savedClientId;
    }

    populateProjectFilterOptions(get("#dashboardClientFilter").value);
    const savedProjectId = localStorage.getItem(FILTER_PROJECT_KEY) || "";
    if (Array.from(get("#dashboardProjectFilter").options).some((option) => option.value === savedProjectId)) {
        get("#dashboardProjectFilter").value = savedProjectId;
    }

    get("#dashboardClientFilter").addEventListener("change", () => {
        const newClientId = get("#dashboardClientFilter").value;
        localStorage.setItem(FILTER_CLIENT_KEY, newClientId);
        // A client switch invalidates whatever project was picked before —
        // repopulate the project list for the new scope and force it back
        // to Auto (populate alone would keep the old id since it can still
        // be a valid project in the new, wider pool).
        populateProjectFilterOptions(newClientId);
        get("#dashboardProjectFilter").value = "";
        localStorage.setItem(FILTER_PROJECT_KEY, "");
        renderDashboard();
    });

    get("#dashboardProjectFilter").addEventListener("change", () => {
        localStorage.setItem(FILTER_PROJECT_KEY, get("#dashboardProjectFilter").value);
        renderDashboard();
    });

    // The popups (View Projects, Budget Summary, Timeline Status) show whatever
    // the client filter currently scopes the dashboard to.
    let currentScope = { clients: [], projects: [], activeProjects: [], label: "All clients" };
    get("#featuredProjectCard").addEventListener("click", (event) => {
        const button = event.target.closest("[data-open-projects]");
        if (button) window.CbcDashPopups.viewProjects(currentScope, button);
    });
    get("#budgetDetailsBtn").addEventListener("click", (event) => window.CbcDashPopups.budgetDetails(currentScope, event.currentTarget));
    get("#timelineDetailsBtn").addEventListener("click", (event) => window.CbcDashPopups.timelineDetails(currentScope, event.currentTarget));

    // --------------------------------------
    // Master render — re-run in full whenever a filter changes.
    // --------------------------------------

    function renderDashboard() {
        const scopeClientId = get("#dashboardClientFilter").value;
        const scopeProjectId = get("#dashboardProjectFilter").value;

        const scopedClients = scopeClientId ? allClients.filter((client) => client.id === scopeClientId) : allClients;
        const scopedProjects = scopeClientId ? allProjects.filter((project) => project.clientId === scopeClientId) : allProjects;
        const scopedActiveProjects = scopedProjects.filter((project) => project.status !== "Completed");

        // Each card renders independently — if one throws (bad data shape,
        // an unexpected edge case, etc.) it's isolated to that card instead
        // of aborting the rest of the dashboard and leaving every card after
        // it silently blank. The failing card shows what happened instead
        // of empty space, and the real error still goes to the console.
        function safeRender(label, hostSelector, fn) {
            try {
                fn();
            } catch (error) {
                console.error(`Dashboard card "${label}" failed to render:`, error);
                const host = get(hostSelector);
                if (host) {
                    host.innerHTML = `<p class="bento-empty">Couldn't load ${escapeHtml(label)} (${escapeHtml(error.message || "unknown error")}). Other cards are unaffected.</p>`;
                }
            }
        }

        currentScope = {
            clients: allClients,
            projects: scopedProjects,
            activeProjects: scopedActiveProjects,
            label: (scopedClients.length === 1 && scopeClientId) ? scopedClients[0].clientName : "All clients",
        };

        let comparable = [];
        safeRender("stat strip", "#activeProjects", () => renderStatStrip(scopedActiveProjects));
        safeRender("Due This Week", "#dueThisWeekList", () => renderDueThisWeek(collectDueItems(scopedProjects)));
        safeRender("Schedule comparison", "#timelineMeta", () => {
            comparable = buildComparable(scopedActiveProjects);
        });

        const featuredProject = pickFeaturedProject(scopedActiveProjects, scopeProjectId);
        safeRender("Featured Project", "#featuredProjectCard", () => renderFeaturedProject(featuredProject, scopedClients.length ? scopedClients : allClients));
        safeRender("Budget Summary", "#budgetSummaryBody", () => renderBudgetSummary(scopedActiveProjects));
        safeRender("Timeline Status", "#timelineMeta", () => renderTimelineStatus(scopedActiveProjects, comparable));
    }

    // --------------------------------------
    // Stat strip
    // --------------------------------------

    function renderStatStrip(scopedActiveProjects) {
        get("#activeProjects").textContent = scopedActiveProjects.length;

        const totalBudget = sumMoney(scopedActiveProjects, (project) => project.budget);
        get("#totalBudget").textContent = formatMoney(totalBudget);

        const totalIncome = scopedActiveProjects.reduce((sum, project) => sum + projectTotals(project).income, 0);
        get("#totalIncome").textContent = formatMoney(totalIncome);

        const netAcrossProjects = scopedActiveProjects.reduce((sum, project) => {
            const totals = projectTotals(project);
            return sum + (totals.income - totals.expense);
        }, 0);
        get("#netAcrossProjects").textContent = formatMoney(netAcrossProjects);
        get("#netCard").classList.remove("positive", "negative");
        get("#netCard").classList.add(netAcrossProjects >= 0 ? "positive" : "negative");
    }

    // --------------------------------------
    // Due This Week — upcoming/overdue PO installments & cheques
    // --------------------------------------

    function collectDueItems(scopedProjects) {
        const dueItems = [];
        scopedProjects.forEach((project) => {
            (Array.isArray(project.purchaseOrders) ? project.purchaseOrders : []).forEach((po) => {
                (Array.isArray(po.installments) ? po.installments : []).forEach((installment) => {
                    if (installment.status !== "Due") return;
                    const days = daysBetween(installment.dueDate);
                    if (days <= 7) {
                        dueItems.push({
                            projectName: project.projectName,
                            projectId: project.id,
                            label: `${po.poNumber} — ${po.materialName} (${po.supplier})`,
                            amount: installment.amount,
                            dueDate: installment.dueDate,
                            days,
                            link: window.CbcWorkspaceCore.portalLink(project),
                            icon: "📦",
                        });
                    }
                });
            });

            (project.chequeEntries || []).forEach((cheque) => {
                if (cheque.status !== "Pending") return;
                const days = daysBetween(cheque.dueDate);
                if (days <= 7) {
                    dueItems.push({
                        projectName: project.projectName,
                        projectId: project.id,
                        label: `Cheque #${cheque.chequeNumber} (${cheque.bankName}) — ${
                            cheque.type === "issued" ? "to" : "from"
                        } ${cheque.partyName}`,
                        amount: cheque.amount,
                        dueDate: cheque.dueDate,
                        days,
                        link: window.CbcWorkspaceCore.portalLink(project),
                        icon: "🏦",
                    });
                }
            });
        });
        dueItems.sort((a, b) => a.days - b.days);
        return dueItems;
    }

    function renderDueThisWeek(dueItems) {
        get("#dueThisWeekEmptyState").hidden = dueItems.length > 0;

        const overdueCount = dueItems.filter((item) => item.days < 0).length;
        const totalDue = sumMoney(dueItems, (item) => item.amount);
        get("#dueThisWeekSummary").innerHTML = dueItems.length
            ? `
                <div class="mini-stat"><strong>${dueItems.length}</strong><span>Item${dueItems.length === 1 ? "" : "s"} due</span></div>
                <div class="mini-stat"><strong>${formatMoney(totalDue)}</strong><span>Total amount</span></div>
                ${overdueCount ? `<div class="mini-stat negative"><strong>${overdueCount}</strong><span>Overdue</span></div>` : ""}
            `
            : "";

        get("#dueThisWeekList").innerHTML = dueItems
            .map((item) => {
                const isOverdue = item.days < 0;
                const statusLabel = isOverdue
                    ? `${Math.abs(item.days)} day${Math.abs(item.days) === 1 ? "" : "s"} overdue`
                    : item.days === 0
                    ? "Due today"
                    : `Due in ${item.days} day${item.days === 1 ? "" : "s"}`;

                return `
                    <a href="${item.link}" class="due-item ${
                    isOverdue ? "overdue" : "upcoming"
                }" style="text-decoration: none; color: inherit; cursor: pointer;">
                        <span class="due-item-icon">${item.icon}</span>
                        <div class="due-item-info">
                            <h4>${escapeHtml(item.label)}</h4>
                            <p>${escapeHtml(item.projectName)} · ${formatDate(item.dueDate)}</p>
                        </div>
                        <div class="due-item-amount">
                            <strong>${formatMoney(item.amount)}</strong>
                            <span>${statusLabel}</span>
                        </div>
                    </a>
                `;
            })
            .join("");
    }

    // --------------------------------------
    // Actual vs planned project progress
    // --------------------------------------

    function buildComparable(scopedActiveProjects) {
        return scopedActiveProjects.map((project) => ({
            project,
            schedule: getProjectPlannedSchedule(project),
            planned: calculatePlannedProgress(project),
            actual: Math.min(100, Math.max(0, Number(project.percentComplete) || 0)),
        }));
    }

    // --------------------------------------
    // Featured Project (hero card)
    // --------------------------------------

    const AVATAR_COLORS = ["#1f4e79", "#2f6b6b", "#c97a2b", "#2f7449", "#a3462f", "#6b5b95"];

    function initials(name) {
        const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return "?";
        return (parts[0][0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
    }

    function currentPhaseLabel(project) {
        const today = getTodayValue();
        const programs = Array.isArray(project.programsOfWork) ? project.programsOfWork : [];
        const activeProgram = programs.find(
            (program) => program.startDate && program.endDate && program.startDate <= today && today <= program.endDate
        );
        if (activeProgram) return activeProgram.name || "Current";
        const pct = Math.min(100, Math.max(0, Number(project.percentComplete) || 0));
        if (pct >= 100) return "Completion";
        if (pct >= 66) return "Finishing";
        if (pct >= 33) return "Structural";
        return "Foundation";
    }

    function pickFeaturedProject(scopedActiveProjects, scopeProjectId) {
        if (scopeProjectId) {
            const chosen = scopedActiveProjects.find((project) => project.id === scopeProjectId);
            if (chosen) return chosen;
        }
        return scopedActiveProjects.length
            ? [...scopedActiveProjects].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0]
            : null;
    }

    function renderFeaturedProject(featuredProject, clientPool) {
        const host = get("#featuredProjectCard");

        if (!featuredProject) {
            host.innerHTML = `
                <p class="bento-hero-eyebrow">No Active Project</p>
                <h2>Nothing in progress right now</h2>
                <p class="bento-empty">Create a project — or adjust the filters above — to feature one here, with its current phase, crew, and progress.</p>
                ${currentScope.projects.length ? `<button type="button" class="bento-hero-cta screen-only" data-open-projects aria-haspopup="dialog">View Projects →</button>` : ""}
            `;
            return;
        }

        const client = clientPool.find((item) => item.id === featuredProject.clientId) || allClients.find((item) => item.id === featuredProject.clientId);
        const pct = Math.min(100, Math.max(0, Number(featuredProject.percentComplete) || 0));
        const workers = featuredProject.workers || [];
        const shown = workers.slice(0, 4);
        const extra = workers.length - shown.length;

        host.innerHTML = `
            <div>
                <p class="bento-hero-eyebrow">${escapeHtml(currentPhaseLabel(featuredProject))} Phase · In Progress</p>
                <h2>${escapeHtml(featuredProject.projectName)}</h2>
                <p class="bento-hero-meta">${escapeHtml(client ? client.clientName : "Unknown client")}${
            featuredProject.siteAddress ? " · " + escapeHtml(featuredProject.siteAddress) : ""
        }</p>

                <div class="bento-hero-progress">
                    <div class="bento-hero-progress-track">
                        <div class="bento-hero-progress-fill" style="width:${pct}%;"></div>
                    </div>
                    <p class="bento-hero-progress-label">${Math.round(pct)}% complete · Budget ${formatMoney(featuredProject.budget)}</p>
                </div>
            </div>

            <div class="bento-hero-footer">
                <div class="bento-hero-crew">
                    ${
                        workers.length
                            ? `
                        <div class="avatar-stack">
                            ${shown
                                .map(
                                    (worker, index) =>
                                        `<span class="avatar-chip" style="background:${
                                            AVATAR_COLORS[index % AVATAR_COLORS.length]
                                        };">${escapeHtml(initials(worker.name))}</span>`
                                )
                                .join("")}
                            ${extra > 0 ? `<span class="avatar-chip" style="background:#10283d;">+${extra}</span>` : ""}
                        </div>
                        <div class="bento-hero-crew-count">
                            <strong>${workers.length}</strong>
                            Worker${workers.length === 1 ? "" : "s"} on roster
                        </div>
                    `
                            : `<div class="bento-hero-crew-count">No workers on this project's roster yet.</div>`
                    }
                </div>
                <button type="button" class="bento-hero-cta screen-only" data-open-projects aria-haspopup="dialog">View Projects →</button>
            </div>

            <svg class="bento-hero-illustration" width="130" height="120" viewBox="0 0 130 120" fill="none" aria-hidden="true">
                <rect x="14" y="46" width="26" height="64" rx="2" fill="rgba(255,255,255,.14)"/>
                <rect x="44" y="30" width="30" height="80" rx="2" fill="rgba(255,255,255,.20)"/>
                <rect x="78" y="58" width="24" height="52" rx="2" fill="rgba(255,255,255,.14)"/>
                <rect x="49" y="38" width="6" height="8" fill="rgba(255,255,255,.35)"/>
                <rect x="60" y="38" width="6" height="8" fill="rgba(255,255,255,.35)"/>
                <rect x="49" y="52" width="6" height="8" fill="rgba(255,255,255,.35)"/>
                <rect x="60" y="52" width="6" height="8" fill="rgba(255,255,255,.35)"/>
                <line x1="86" y1="58" x2="86" y2="18" stroke="rgba(255,255,255,.4)" stroke-width="2"/>
                <line x1="86" y1="18" x2="118" y2="18" stroke="rgba(255,255,255,.4)" stroke-width="2"/>
                <line x1="112" y1="18" x2="112" y2="30" stroke="rgba(255,255,255,.4)" stroke-width="2"/>
            </svg>
        `;
    }

    // --------------------------------------
    // Budget Summary card
    // --------------------------------------

    function renderBudgetSummary(scopedActiveProjects) {
        const host = get("#budgetSummaryBody");

        if (!scopedActiveProjects.length) {
            host.innerHTML = `<p class="bento-empty">No active projects to summarize in this scope.</p>`;
            return;
        }

        const totalBudget = sumMoney(scopedActiveProjects, (project) => project.budget);
        const activeExpenseEntries = scopedActiveProjects.flatMap((project) => project.expenseEntries || []);
        const totalSpent = sumMoney(activeExpenseEntries, (entry) => entry.amount);
        const spentByCategory = {};
        activeExpenseEntries.forEach((entry) => {
            const category = entry.category || "Other";
            spentByCategory[category] = (spentByCategory[category] || 0) + money(entry.amount);
        });
        const materialsSpent = spentByCategory["Materials"] || 0;
        const laborSpent = spentByCategory["Labor"] || 0;

        const overBudgetCount = scopedActiveProjects.filter((project) => {
            const spent = sumMoney(project.expenseEntries || [], (entry) => entry.amount);
            return money(project.budget) > 0 && spent > money(project.budget);
        }).length;

        const ratio = totalBudget > 0 ? totalSpent / totalBudget : 0;
        const segmentCount = 22;
        const filledSegments = Math.min(segmentCount, Math.round(Math.min(1, ratio) * segmentCount));
        const segments = Array.from({ length: segmentCount }, (_, index) =>
            index < filledSegments ? `<span class="${ratio > 1 ? "over" : "filled"}"></span>` : `<span></span>`
        ).join("");

        host.innerHTML = `
            <p class="budget-limit">${formatMoney(totalBudget)} limit${
            overBudgetCount
                ? ` · <span class="budget-over-note">${overBudgetCount} project${overBudgetCount === 1 ? "" : "s"} over budget</span>`
                : ""
        }</p>
            <p class="budget-spent">${formatMoney(totalSpent)} <small>spent</small></p>
            <div class="budget-segments">${segments}</div>
            <div class="budget-breakdown">
                <div><strong>${formatMoney(materialsSpent)}</strong><span>Materials</span></div>
                <div><strong>${formatMoney(laborSpent)}</strong><span>Labor</span></div>
            </div>
        `;
    }

    // --------------------------------------
    // Timeline Status card
    // --------------------------------------

    function shortDate(value) {
        if (!value) return null;
        const parts = value.split("-");
        if (parts.length !== 3) return value;
        const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        return date.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
    }

    function renderTimelineStatus(scopedActiveProjects, comparable) {
        const metaHost = get("#timelineMeta");
        const bigHost = get("#timelineBig");
        const canvas = get("#timelineSparkline");

        if (!scopedActiveProjects.length) {
            metaHost.innerHTML = `<p class="bento-empty">No active projects to schedule in this scope.</p>`;
            canvas.hidden = true;
            bigHost.innerHTML = "";
            return;
        }

        const starts = scopedActiveProjects.map((project) => project.startDate).filter(Boolean).sort();
        const ends = scopedActiveProjects.map((project) => project.targetEndDate).filter(Boolean).sort();
        const rangeLabel =
            starts.length && ends.length ? `${shortDate(starts[0])} – ${shortDate(ends[ends.length - 1])}` : "Set start and target dates on your projects";

        const rowsWithSchedule = comparable.filter((item) => item.planned !== null);
        let pillClass = "unknown";
        let pillText = "Add schedules to track status";
        if (rowsWithSchedule.length) {
            const avgVariance = rowsWithSchedule.reduce((sum, item) => sum + (item.actual - item.planned), 0) / rowsWithSchedule.length;
            if (Math.abs(avgVariance) <= 2) {
                pillClass = "on-track";
                pillText = "On schedule";
            } else if (avgVariance > 0) {
                pillClass = "on-track";
                pillText = `${Math.round(avgVariance)} points ahead`;
            } else {
                pillClass = "behind";
                pillText = `${Math.abs(Math.round(avgVariance))} points behind`;
            }
        }

        metaHost.innerHTML = `
            <p class="timeline-range">${escapeHtml(rangeLabel)}</p>
            <span class="timeline-status-pill ${pillClass}">${escapeHtml(pillText)}</span>
        `;

        const avgActual =
            scopedActiveProjects.reduce((sum, project) => sum + Math.min(100, Math.max(0, Number(project.percentComplete) || 0)), 0) /
            scopedActiveProjects.length;
        bigHost.innerHTML = `<strong>${Math.round(avgActual)}%</strong><span>Average progress across ${scopedActiveProjects.length} active project${
            scopedActiveProjects.length === 1 ? "" : "s"
        }</span>`;

        const buckets = {};
        scopedActiveProjects.forEach((project) => {
            (project.progressHistory || []).forEach((point) => {
                if (!point.date) return;
                const key = point.date.slice(0, 7);
                if (!buckets[key]) buckets[key] = [];
                buckets[key].push(Number(point.percentComplete) || 0);
            });
        });
        const keys = Object.keys(buckets).sort().slice(-8);
        const values = keys.map((key) => buckets[key].reduce((sum, value) => sum + value, 0) / buckets[key].length);

        if (values.length < 2) {
            canvas.hidden = true;
            return;
        }
        canvas.hidden = false;

        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const dark = document.documentElement.dataset.theme === "dark";
        const lineColor = dark ? "#4fa19a" : "#2f6b6b";
        const fillColor = dark ? "rgba(79,161,154,.18)" : "rgba(47,107,107,.12)";
        const padding = 6;
        const w = canvas.width - padding * 2;
        const h = canvas.height - padding * 2;
        const stepX = w / (values.length - 1);
        const maxV = Math.max(100, ...values);
        const minV = Math.min(0, ...values);
        const range = Math.max(1, maxV - minV);
        const points = values.map((value, index) => ({
            x: padding + stepX * index,
            y: padding + h - ((value - minV) / range) * h,
        }));

        ctx.beginPath();
        ctx.moveTo(points[0].x, canvas.height - padding);
        points.forEach((point) => ctx.lineTo(point.x, point.y));
        ctx.lineTo(points[points.length - 1].x, canvas.height - padding);
        ctx.closePath();
        ctx.fillStyle = fillColor;
        ctx.fill();

        ctx.beginPath();
        points.forEach((point, index) => {
            if (index === 0) ctx.moveTo(point.x, point.y);
            else ctx.lineTo(point.x, point.y);
        });
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = lineColor;
        const last = points[points.length - 1];
        ctx.beginPath();
        ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
        ctx.fill();
    }

    renderDashboard();
})();
