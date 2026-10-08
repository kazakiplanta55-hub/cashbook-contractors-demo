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

    function validateDateRange(startInput, endInput, label) {
        startInput.setCustomValidity("");
        endInput.setCustomValidity("");
        if (!startInput.value || !endInput.value) return false;
        if (endInput.value < startInput.value) {
            endInput.setCustomValidity(`${label} finish date cannot be earlier than its start date.`);
            endInput.reportValidity();
            return false;
        }
        return true;
    }

    function configureSubItemSchedule(program) {
        const startInput = get("#subItemStart");
        const endInput = get("#subItemEnd");
        const minimum = program?.startDate || project.startDate || "";
        const maximum = program?.endDate || project.targetEndDate || "";
        startInput.min = minimum;
        startInput.max = maximum;
        endInput.min = minimum;
        endInput.max = maximum;
        get("#subItemScheduleLimit").textContent = minimum && maximum
            ? `Allowed schedule: ${formatDate(minimum)} → ${formatDate(maximum)}`
            : "Set the Program of Works schedule before dating this sub-item.";
        validateSubItemDates(false);
    }

    function validateSubItemDates(showMessage) {
        const startInput = get("#subItemStart");
        const endInput = get("#subItemEnd");
        startInput.setCustomValidity("");
        endInput.setCustomValidity("");
        let invalidInput = null;
        if (startInput.value && endInput.value && endInput.value < startInput.value) {
            endInput.setCustomValidity("The sub-item finish date cannot be earlier than its start date.");
            invalidInput = endInput;
        } else if (startInput.min && startInput.value && startInput.value < startInput.min) {
            startInput.setCustomValidity(`The earliest allowed start is ${formatDate(startInput.min)}.`);
            invalidInput = startInput;
        } else if (startInput.max && startInput.value && startInput.value > startInput.max) {
            startInput.setCustomValidity(`The latest allowed start is ${formatDate(startInput.max)}.`);
            invalidInput = startInput;
        } else if (endInput.min && endInput.value && endInput.value < endInput.min) {
            endInput.setCustomValidity(`The earliest allowed finish is ${formatDate(endInput.min)}.`);
            invalidInput = endInput;
        } else if (endInput.max && endInput.value && endInput.value > endInput.max) {
            endInput.setCustomValidity(`The latest allowed finish is ${formatDate(endInput.max)}.`);
            invalidInput = endInput;
        }
        if (showMessage && invalidInput) invalidInput.reportValidity();
        return !invalidInput && !!startInput.value && !!endInput.value;
    }

    const loaded = loadProjectFromUrl();
    if (!loaded) {
        return;
    }

    let project = loaded.project;

    get("#projectStatus").textContent = project.status;
    get("#projectAddress").textContent = project.siteAddress || "—";
    get("#projectNotes").textContent = project.notes || "—";

    function itemWeight(item) {
        return Number(item.weight) > 0 ? Number(item.weight) : 100;
    }

    function programWeight(program) {
        return Number(program.weight) > 0 ? Number(program.weight) : 100;
    }

    function calcProgramPercent(program) {
        const items = program.items || [];
        if (items.length === 0) return 0;
        let weightedSum = 0;
        let totalWeight = 0;
        items.forEach((item) => {
            const weight = itemWeight(item);
            weightedSum += (item.done ? 100 : 0) * weight;
            totalWeight += weight;
        });
        return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
    }

    function calcOverallFromPrograms() {
        const programs = project.programsOfWork || [];
        if (programs.length === 0) return project.percentComplete || 0;

        let weightedSum = 0;
        let totalWeight = 0;
        let hasItems = false;
        programs.forEach((program) => {
            const items = program.items || [];
            if (items.length === 0) return;
            hasItems = true;
            const weight = programWeight(program);
            weightedSum += calcProgramPercent(program) * weight;
            totalWeight += weight;
        });
        if (!hasItems || totalWeight === 0) return project.percentComplete || 0;
        return Math.round(weightedSum / totalWeight);
    }

    function effectiveOverall() {
        return project.progressOverride && Number.isFinite(Number(project.progressOverride.percent))
            ? Math.min(100, Math.max(0, Number(project.progressOverride.percent)))
            : calcOverallFromPrograms();
    }

    function renderProgressPanel() {
        const overall = effectiveOverall();
        project.percentComplete = overall;

        get("#progressFill").style.width = overall + "%";
        get("#progressPercentLabel").textContent = overall + "% complete";
        get("#projectDates").textContent = `${formatDate(
            project.startDate
        )} → ${
            project.targetEndDate
                ? formatDate(project.targetEndDate)
                : "No target date"
        }`;

        get("#adjustPercent").value = overall;
        get("#adjustPercentLabel").textContent = overall + "%";
        get("#adjustTargetEndDate").value = project.targetEndDate || "";
        const clearButton = get("#clearProgressOverride");
        if (clearButton) clearButton.hidden = !project.progressOverride;
        const source = get("#progressSourceLabel");
        if (source) source.textContent = project.progressOverride
            ? `Approved override · ${project.progressOverride.note}`
            : ((project.programsOfWork || []).length ? "Calculated from Program of Works" : "No Program of Works configured");

    }

    function renderPrograms() {
        const programs = project.programsOfWork || [];
        get("#programsEmptyState").hidden = programs.length > 0;

        get("#programsContainer").innerHTML = programs
            .map((program) => {
                const pct = calcProgramPercent(program);
                const items = program.items || [];

                const itemsHtml = items
                    .map(
                        (item) => `
                    <div class="pow-item">
                        <input type="checkbox" data-program="${program.id}" data-item="${item.id}" ${item.done ? "checked" : ""}>
                        <span>
                            <strong>${escapeHtml(item.name)}</strong>
                            <small class="pow-item-schedule">${item.startDate && item.endDate ? `${formatDate(item.startDate)} → ${formatDate(item.endDate)}` : "Schedule dates required"} · Weight ${itemWeight(item)}%${item.done ? ` · <button type="button" class="link-button edit-complete-date" data-program="${program.id}" data-item="${item.id}">Completed ${formatDate(item.completedAt.slice(0, 10))} ✎</button>` : ""}</small>
                        </span>
                        <button type="button" class="icon-button edit-item" data-program="${program.id}" data-item="${item.id}" title="Edit item and schedule">✎</button>
                        <button type="button" class="icon-button delete-item" data-program="${program.id}" data-item="${item.id}" title="Remove item">×</button>
                    </div>
                `
                    )
                    .join("");

                const totalItemWeight = items.reduce((sum, item) => sum + itemWeight(item), 0);

                return `
                    <div class="pow-card" data-id="${program.id}">
                        <div class="pow-header">
                            <div>
                                <h3>${escapeHtml(program.name)}</h3>
                                <p class="pow-schedule">
                                    ${formatDate(program.startDate)} → ${formatDate(program.endDate)}
                                    · Weight ${programWeight(program)}%
                                    · <strong>${pct}%</strong>
                                </p>
                            </div>
                            <div class="pow-actions">
                                <button type="button" class="secondary-button edit-program" data-id="${program.id}">Edit</button>
                                <button type="button" class="secondary-button delete-program" data-id="${program.id}">Delete</button>
                            </div>
                        </div>
                        <div class="progress-track" style="height:8px; margin:12px 0;">
                            <div class="progress-fill" style="width:${pct}%;"></div>
                        </div>
                        <div class="pow-items">
                            ${itemsHtml || '<p class="empty-state" style="padding:8px 0;">No sub-items yet.</p>'}
                        </div>
                        ${items.length ? `<p style="color:var(--muted);font-size:11px;margin-top:8px;">Item weights sum to ${totalItemWeight}% within this program (doesn't need to total 100 — used only to weigh items against each other).</p>` : ""}
                        <button type="button" class="secondary-button add-sub-item" data-id="${program.id}" style="margin-top:10px;">+ Add sub-item</button>
                    </div>
                `;
            })
            .join("");

        // Checkbox change
        document.querySelectorAll(".pow-item input[type=checkbox]").forEach((cb) => {
            cb.addEventListener("change", () => {
                const program = project.programsOfWork.find((p) => p.id === cb.dataset.program);
                if (!program) return;
                const item = (program.items || []).find((i) => i.id === cb.dataset.item);
                if (!item) return;

                if (cb.checked) {
                    // Don't stamp now() automatically — open an editable date
                    // picker so an accidental toggle can't silently record
                    // (or overwrite) a completion date. Revert the checkbox
                    // until the user confirms.
                    cb.checked = false;
                    openCompleteItemModal(program, item);
                    return;
                }

                (async () => {
                    const confirmed = await window.CashbookDialogs.confirm(
                        `Mark "${item.name}" as not yet complete? This clears its recorded completion date.`,
                        { title: "Reopen Item", confirmText: "Reopen", danger: true }
                    );
                    if (!confirmed) {
                        cb.checked = true;
                        return;
                    }
                    item.done = false;
                    item.completedAt = "";
                    const overall = effectiveOverall();
                    project.percentComplete = overall;
                    appendProjectAudit(project, "UPDATE", "program-item", item.id, `${item.name} reopened in ${program.name}`);
                    project = upsertProject(project, { note: `${item.name} unchecked in ${program.name}` });
                    renderPrograms();
                    renderProgressPanel();
                    drawProgressChart();
                })();
            });
        });

        // Edit an already-recorded completion date, without reopening the item
        document.querySelectorAll(".edit-complete-date").forEach((btn) => {
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                const program = project.programsOfWork.find((p) => p.id === btn.dataset.program);
                if (!program) return;
                const item = (program.items || []).find((i) => i.id === btn.dataset.item);
                if (!item) return;
                openCompleteItemModal(program, item);
            });
        });

        // Delete item
        document.querySelectorAll(".delete-item").forEach((btn) => {
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                const program = project.programsOfWork.find((p) => p.id === btn.dataset.program);
                if (!program) return;
                program.items = (program.items || []).filter((i) => i.id !== btn.dataset.item);
                project.percentComplete = effectiveOverall();
                project = upsertProject(project);
                renderPrograms();
                renderProgressPanel();
                drawProgressChart();
            });
        });

        document.querySelectorAll(".edit-item").forEach((btn) => {
            btn.addEventListener("click", (event) => {
                event.preventDefault();
                const program = project.programsOfWork.find((entry) => entry.id === btn.dataset.program);
                const item = (program?.items || []).find((entry) => entry.id === btn.dataset.item);
                if (!program || !item) return;
                get("#subItemProgramId").value = program.id;
                get("#subItemEditId").value = item.id;
                get("#subItemName").value = item.name;
                get("#subItemStart").value = item.startDate || program.startDate || "";
                get("#subItemEnd").value = item.endDate || program.endDate || "";
                get("#subItemWeight").value = itemWeight(item);
                configureSubItemSchedule(program);
                showItemWeightHint(program, item.id);
                get("#subItemModalTitle").textContent = "Edit Sub-Program Item";
                get("#subItemSaveButton").textContent = "Save Item";
                get("#subItemModal").hidden = false;
                get("#subItemName").focus();
            });
        });

        // Edit program
        document.querySelectorAll(".edit-program").forEach((btn) => {
            btn.addEventListener("click", () => {
                const program = project.programsOfWork.find((p) => p.id === btn.dataset.id);
                if (!program) return;
                get("#programEditId").value = program.id;
                get("#programName").value = program.name;
                get("#programStart").value = program.startDate || "";
                get("#programEnd").value = program.endDate || "";
                get("#programWeight").value = programWeight(program);
                showProgramWeightHint(program.id);
                get("#programModalTitle").textContent = "Edit Program of Work";
                get("#programModal").hidden = false;
            });
        });

        // Delete program
        document.querySelectorAll(".delete-program").forEach((btn) => {
            btn.addEventListener("click", async () => {
                if (!await window.CashbookDialogs.confirm("Delete this program of work and all its sub-items?", { title: "Delete program", confirmText: "Delete", danger: true })) return;
                project.programsOfWork = project.programsOfWork.filter((p) => p.id !== btn.dataset.id);
                project.percentComplete = effectiveOverall();
                project = upsertProject(project);
                renderPrograms();
                renderProgressPanel();
                drawProgressChart();
            });
        });

        // Add sub-item
        document.querySelectorAll(".add-sub-item").forEach((btn) => {
            btn.addEventListener("click", () => {
                get("#subItemProgramId").value = btn.dataset.id;
                get("#subItemEditId").value = "";
                get("#subItemName").value = "";
                const program = project.programsOfWork.find((entry) => entry.id === btn.dataset.id);
                get("#subItemStart").value = program?.startDate || project.startDate || "";
                get("#subItemEnd").value = program?.endDate || project.targetEndDate || "";
                get("#subItemWeight").value = 100;
                configureSubItemSchedule(program);
                showItemWeightHint(program, null);
                get("#subItemModalTitle").textContent = "Add Sub-Program Item";
                get("#subItemSaveButton").textContent = "Add Item";
                get("#subItemModal").hidden = false;
                get("#subItemName").focus();
            });
        });
    }

    function drawProgressChart() {
        const canvas = get("#progressChart");
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const dark = document.documentElement.dataset.theme === "dark";
        const actualColor = dark ? "#58a6dc" : "#1f4e79";
        const plannedColor = dark ? "#f0a35a" : "#c97a2b";
        const gridColor = dark ? "#4a535c" : "#dfe4e8";
        const textColor = dark ? "#c4cbd2" : "#66717d";
        const dateNumber = (value) => new Date(`${value}T00:00:00`).getTime();
        const today = getTodayValue();
        const sameDaySequence = new Map();
        const rawHistory = (project.progressHistory || []).map((point, index) => {
            const date = point.date || today;
            const sequence = sameDaySequence.get(date) || 0;
            sameDaySequence.set(date, sequence + 1);
            const recorded = Date.parse(point.recordedAt || "");
            return {
                date,
                percentComplete: Math.min(100, Math.max(0, Number(point.percentComplete) || 0)),
                eventTime: Number.isFinite(recorded) ? recorded : dateNumber(date) + sequence * 3600000,
                sourceOrder: index,
            };
        }).sort((a, b) => a.eventTime - b.eventTime || a.sourceOrder - b.sourceOrder);
        const actualByDay = new Map();
        rawHistory.forEach((point) => {
            if (point.date <= today) actualByDay.set(point.date, point);
        });
        const currentPercent = effectiveOverall();
        actualByDay.set(today, {
            date: today,
            percentComplete: currentPercent,
            eventTime: dateNumber(today),
            sourceOrder: rawHistory.length,
            current: true,
        });
        const history = [...actualByDay.values()].map((point) => ({
            ...point,
            eventTime: dateNumber(point.date),
        })).sort((a, b) => a.eventTime - b.eventTime || a.sourceOrder - b.sourceOrder);
        const startDate = project.startDate || history[0]?.date || today;
        const targetDate = project.targetEndDate || "";
        const plannedSchedule = getProjectPlannedSchedule(project);
        const projectStartTime = dateNumber(startDate);
        const projectEndTime = targetDate ? dateNumber(targetDate) : null;
        const scheduleStartTime = plannedSchedule.valid ? plannedSchedule.startTime : projectStartTime;
        const baselineTime = Math.min(projectStartTime, dateNumber(today));
        const baselineDate = projectStartTime <= dateNumber(today) ? startDate : today;
        if (!history.length || history[0].percentComplete !== 0 || history[0].eventTime > baselineTime) {
            history.unshift({ date: baselineDate, percentComplete: 0, eventTime: baselineTime, sourceOrder: -1, baseline: true });
        }
        let domainStart = Math.min(projectStartTime, scheduleStartTime, ...history.map((point) => point.eventTime));
        let domainEnd = Math.max(projectEndTime || 0, plannedSchedule.valid ? plannedSchedule.endTime : 0, dateNumber(today), ...history.map((point) => point.eventTime));
        if (domainEnd <= domainStart) domainEnd = domainStart + 86400000;
        const padding = { top: 24, right: 30, bottom: 44, left: 52 };
        const chartWidth = canvas.width - padding.left - padding.right;
        const chartHeight = canvas.height - padding.top - padding.bottom;
        const xForTime = (time) => padding.left + ((time - domainStart) / (domainEnd - domainStart)) * chartWidth;
        const xFor = (date) => xForTime(dateNumber(date));
        const yFor = (percent) => padding.top + chartHeight - (percent / 100) * chartHeight;
        ctx.font = "11px Segoe UI";
        ctx.font = "11px Segoe UI";
        [0, 25, 50, 75, 100].forEach((mark) => {
            const y = yFor(mark);
            ctx.strokeStyle = gridColor;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(padding.left, y); ctx.lineTo(padding.left + chartWidth, y); ctx.stroke();
            ctx.fillStyle = textColor;
            ctx.fillText(mark + "%", 10, y + 4);
        });
        if (plannedSchedule.valid) {
            const plannedTimes = [...new Set([domainStart, ...plannedSchedule.boundaryTimes, domainEnd])].sort((a, b) => a - b);
            ctx.strokeStyle = plannedColor;
            ctx.lineWidth = 3;
            ctx.setLineDash([9, 6]);
            ctx.beginPath();
            plannedTimes.forEach((time, index) => {
                const x = xForTime(time); const y = yFor(plannedSchedule.progressAt(time));
                if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.stroke();
            ctx.setLineDash([]);
        }
        let previousTime = null;
        let previousX = null;
        history.forEach((point) => {
            const calendarX = xForTime(point.eventTime);
            point.chartX = previousTime === point.eventTime
                ? Math.min(padding.left + chartWidth, previousX + 14)
                : calendarX;
            previousTime = point.eventTime;
            previousX = point.chartX;
        });
        canvas.dataset.actualPointCount = String(history.length);
        canvas.dataset.actualDailyPointCount = String(actualByDay.size);
        canvas.dataset.actualAuditEventCount = String(rawHistory.length);
        canvas.dataset.actualLatestDate = history[history.length - 1]?.date || "";
        canvas.dataset.actualLastX = String(Math.round(history[history.length - 1]?.chartX || 0));
        canvas.dataset.todayX = String(Math.round(xFor(today)));
        ctx.strokeStyle = actualColor;
        ctx.lineWidth = 3;
        ctx.beginPath();
        history.forEach((point, index) => {
            const x = point.chartX; const y = yFor(point.percentComplete);
            if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.fillStyle = actualColor;
        history.forEach((point) => { ctx.beginPath(); ctx.arc(point.chartX, yFor(point.percentComplete), 4, 0, Math.PI * 2); ctx.fill(); });
        const localDateFromTime = (time) => {
            const date = new Date(time);
            return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        };
        const scheduleDates = plannedSchedule.valid ? plannedSchedule.boundaryTimes.map(localDateFromTime) : [];
        const labelDates = [...new Set([startDate, ...history.map((point) => point.date), ...scheduleDates, targetDate].filter(Boolean))].sort();
        ctx.fillStyle = textColor; ctx.font = "10px Segoe UI";
        ctx.textAlign = "center";
        labelDates.forEach((date, index) => {
            if (labelDates.length > 6 && index % Math.ceil(labelDates.length / 6) !== 0 && index !== labelDates.length - 1) return;
            ctx.fillText(formatDate(date), xFor(date), padding.top + chartHeight + 20);
        });
        ctx.textAlign = "left"; ctx.lineWidth = 1;
        const plannedNow = plannedSchedule.valid ? plannedSchedule.progressAt(today) : null;
        const label = get("#scheduleVarianceLabel");
        if (plannedNow === null) {
            label.textContent = plannedSchedule.reason;
            label.style.color = "var(--muted)";
        } else {
            const variance = effectiveOverall() - plannedNow;
            const comparison = Math.abs(variance) <= 2 ? "On schedule" : variance > 0 ? `${Math.round(variance)} points ahead` : `${Math.abs(Math.round(variance))} points behind`;
            label.textContent = `Actual ${Math.round(effectiveOverall())}% · Planned ${Math.round(plannedNow)}% · ${comparison}`;
            label.style.color = Math.abs(variance) <= 2 || variance > 0 ? "var(--positive)" : "#c97a2b";
        }
    }

    function showProgramWeightHint(excludeId) {
        const others = (project.programsOfWork || []).filter((p) => p.id !== excludeId);
        const total = others.reduce((sum, p) => sum + programWeight(p), 0);
        get("#programWeightHint").textContent = others.length
            ? `Other programs on this project total ${total}% weight so far (doesn't need to total 100 — weight is only used to compare programs against each other).`
            : "This is the first program on this project — its weight only matters once you add more.";
    }

    function showItemWeightHint(program, excludeId) {
        if (!program) {
            get("#subItemWeightHint").textContent = "";
            return;
        }
        const others = (program.items || []).filter((item) => item.id !== excludeId);
        const total = others.reduce((sum, item) => sum + itemWeight(item), 0);
        get("#subItemWeightHint").textContent = others.length
            ? `Other items in this program total ${total}% weight so far (doesn't need to total 100 — weight is only used to compare items against each other).`
            : "This is the first item in this program — its weight only matters once you add more.";
    }

    function openCompleteItemModal(program, item) {
        get("#completeItemProgramId").value = program.id;
        get("#completeItemId").value = item.id;
        get("#completeItemName").textContent = `${program.name} — ${item.name}`;
        get("#completeItemDate").value = item.completedAt ? item.completedAt.slice(0, 10) : getTodayValue();
        get("#completeItemModal").hidden = false;
        get("#completeItemDate").focus();
    }

    // Modal handlers
    get("#addProgramBtn").addEventListener("click", () => {
        get("#programEditId").value = "";
        get("#programName").value = "";
        get("#programStart").value = "";
        get("#programEnd").value = "";
        get("#programWeight").value = 100;
        showProgramWeightHint(null);
        get("#programModalTitle").textContent = "Add Program of Work";
        get("#programModal").hidden = false;
        get("#programName").focus();
    });

    get("#programModalCancel").addEventListener("click", () => {
        get("#programModal").hidden = true;
    });

    ["programStart", "programEnd"].forEach((id) => {
        get("#" + id).addEventListener("input", () => {
            get("#programStart").setCustomValidity("");
            get("#programEnd").setCustomValidity("");
        });
    });

    ["subItemStart", "subItemEnd"].forEach((id) => {
        get("#" + id).addEventListener("input", () => validateSubItemDates(false));
    });

    get("#programForm").addEventListener("submit", (e) => {
        e.preventDefault();
        const name = get("#programName").value.trim();
        const startInput = get("#programStart");
        const endInput = get("#programEnd");
        const weightInput = get("#programWeight");
        if (!name || !validateDateRange(startInput, endInput, "Program")) return;
        const startDate = startInput.value;
        const endDate = endInput.value;
        const weight = Number(weightInput.value);
        if (!Number.isFinite(weight) || weight <= 0) {
            weightInput.setCustomValidity("Enter a weight greater than 0.");
            weightInput.reportValidity();
            return;
        }
        weightInput.setCustomValidity("");

        const editId = get("#programEditId").value;
        const duplicateName = (project.programsOfWork || []).find((program) =>
            program.id !== editId && String(program.name || "").toLowerCase() === name.toLowerCase()
        );
        if (duplicateName) {
            get("#programName").setCustomValidity("A program with this name already exists on this project.");
            get("#programName").reportValidity();
            return;
        }
        get("#programName").setCustomValidity("");
        if (project.startDate && startDate < project.startDate) {
            startInput.setCustomValidity("The Program of Works cannot start before the project start date.");
            startInput.reportValidity();
            return;
        }
        startInput.setCustomValidity("");
        if (project.targetEndDate && endDate > project.targetEndDate) {
            endInput.setCustomValidity("The Program of Works cannot finish after the project target finish date.");
            endInput.reportValidity();
            return;
        }

        if (editId) {
            const program = project.programsOfWork.find((p) => p.id === editId);
            if (program) {
                const outsideItem = (program.items || []).find((item) => item.startDate && item.endDate && (item.startDate < startDate || item.endDate > endDate));
                if (outsideItem) {
                    endInput.setCustomValidity(`The schedule must include the dates for sub-item “${outsideItem.name}”.`);
                    endInput.reportValidity();
                    return;
                }
                program.name = name;
                program.startDate = startDate;
                program.endDate = endDate;
                program.weight = weight;
            }
        } else {
            project.programsOfWork = [
                ...(project.programsOfWork || []),
                {
                    id: createId(),
                    name,
                    startDate,
                    endDate,
                    weight,
                    items: [],
                    createdAt: new Date().toISOString(),
                },
            ];
        }
        project = upsertProject(project);
        get("#programModal").hidden = true;
        renderPrograms();
        renderProgressPanel();
        drawProgressChart();
    });

    get("#subItemModalCancel").addEventListener("click", () => {
        get("#subItemModal").hidden = true;
    });

    get("#subItemForm").addEventListener("submit", (e) => {
        e.preventDefault();
        const name = get("#subItemName").value.trim();
        const programId = get("#subItemProgramId").value;
        const startInput = get("#subItemStart");
        const endInput = get("#subItemEnd");
        const weightInput = get("#subItemWeight");
        if (!name || !programId || !validateSubItemDates(true)) return;
        const weight = Number(weightInput.value);
        if (!Number.isFinite(weight) || weight <= 0) {
            weightInput.setCustomValidity("Enter a weight greater than 0.");
            weightInput.reportValidity();
            return;
        }
        weightInput.setCustomValidity("");

        const program = project.programsOfWork.find((p) => p.id === programId);
        if (!program) return;
        const editId = get("#subItemEditId").value;
        const duplicateName = (program.items || []).find((item) =>
            item.id !== editId && String(item.name || "").toLowerCase() === name.toLowerCase()
        );
        if (duplicateName) {
            get("#subItemName").setCustomValidity("A sub-item with this name already exists in this program.");
            get("#subItemName").reportValidity();
            return;
        }
        get("#subItemName").setCustomValidity("");
        if (editId) {
            const item = (program.items || []).find((entry) => entry.id === editId);
            if (!item) return;
            item.name = name;
            item.startDate = startInput.value;
            item.endDate = endInput.value;
            item.weight = weight;
        } else {
            program.items = [
                ...(program.items || []),
                { id: createId(), name, startDate: startInput.value, endDate: endInput.value, weight, done: false, completedAt: "" },
            ];
        }
        project.percentComplete = effectiveOverall();
        project = upsertProject(project);
        get("#subItemModal").hidden = true;
        renderPrograms();
        renderProgressPanel();
        drawProgressChart();
    });

    get("#adjustPercent").addEventListener("input", (event) => {
        get("#adjustPercentLabel").textContent = event.target.value + "%";
    });

    get("#adjustForm").addEventListener("submit", (event) => {
        event.preventDefault();

        const override = Number(get("#adjustPercent").value);
        const note = get("#adjustNote").value.trim();
        project.progressOverride = {
            percent: Math.min(100, Math.max(0, override)),
            note,
            createdAt: new Date().toISOString(),
        };
        project.percentComplete = project.progressOverride.percent;

        const newTargetEndDate = get("#adjustTargetEndDate").value;
        if (newTargetEndDate) {
            project.targetEndDate = newTargetEndDate;
        }

        appendProjectAudit(project, "OVERRIDE", "progress", project.id, `Progress overridden to ${project.percentComplete}%`, { note });
        project = upsertProject(project, { note });

        get("#adjustNote").value = "";
        renderProgressPanel();
        drawProgressChart();
    });

    get("#clearProgressOverride").addEventListener("click", async () => {
        if (!await window.CashbookDialogs.confirm("Remove the approved override and return to Program of Works calculation?", { title: "Clear progress override", confirmText: "Clear override" })) return;
        const previous = project.progressOverride;
        project.progressOverride = null;
        project.percentComplete = calcOverallFromPrograms();
        appendProjectAudit(project, "CLEAR_OVERRIDE", "progress", project.id, "Returned progress to Program of Works calculation", { previous });
        project = upsertProject(project, { note: "Progress override cleared" });
        renderProgressPanel();
        drawProgressChart();
    });

    // Close modals on overlay click
    ["programModal", "subItemModal", "completeItemModal"].forEach((id) => {
        get("#" + id).addEventListener("click", (e) => {
            if (e.target.id === id) e.target.hidden = true;
        });
    });

    get("#completeItemCancel").addEventListener("click", () => {
        get("#completeItemModal").hidden = true;
    });

    get("#completeItemForm").addEventListener("submit", (e) => {
        e.preventDefault();
        const program = project.programsOfWork.find((p) => p.id === get("#completeItemProgramId").value);
        const item = (program?.items || []).find((entry) => entry.id === get("#completeItemId").value);
        if (!program || !item) {
            get("#completeItemModal").hidden = true;
            return;
        }
        const dateInput = get("#completeItemDate");
        if (!dateInput.value) return;
        const wasAlreadyDone = item.done;
        item.done = true;
        item.completedAt = dateInput.value;
        const overall = effectiveOverall();
        project.percentComplete = overall;
        appendProjectAudit(
            project,
            "UPDATE",
            "program-item",
            item.id,
            wasAlreadyDone
                ? `${item.name} completion date changed to ${formatDate(item.completedAt)} in ${program.name}`
                : `${item.name} completed in ${program.name} (dated ${formatDate(item.completedAt)})`
        );
        project = upsertProject(project, {
            note: wasAlreadyDone ? `${item.name} completion date updated in ${program.name}` : `${item.name} completed in ${program.name}`,
        });
        get("#completeItemModal").hidden = true;
        renderPrograms();
        renderProgressPanel();
        drawProgressChart();
    });

    renderProgressPanel();
    renderPrograms();
    drawProgressChart();
})();
