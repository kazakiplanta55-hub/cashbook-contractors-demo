"use strict";

// Payroll page. Workers, rates and the role hierarchy live on the Project 201 Files page;
// this page records pay (daily timesheet or single entry), shows the log, and posts to Cash Out.
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
    const PAGE_SIZE = 30;
    const log = { page: 0, filter: "all", query: "", open: new Set() };
    let sheet = {}; // daily timesheet state: workerId -> { days, ot }

    function toView(sel, opts) { const el = get(sel); if (el && el.scrollIntoView) el.scrollIntoView(opts); }
    const iso = (d) => d.toISOString().slice(0, 10);
    const parseDay = (s) => new Date(`${s}T00:00:00Z`);
    function addDays(s, n) { const d = parseDay(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
    function weekdayName(s) { return parseDay(s).toLocaleDateString("en-PH", { weekday: "long", timeZone: "UTC" }); }
    const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + "s")}`;

    // ---- Workers (read-only here) ----
    function roleOrderMap() {
        const map = {};
        (project.roles || []).forEach((r, i) => { map[String(r.name).toLowerCase()] = i; });
        return map;
    }
    function sortedWorkers() {
        const order = roleOrderMap();
        return [...(project.workers || [])].sort((a, b) => {
            const ra = order[String(a.role || "").toLowerCase()];
            const rb = order[String(b.role || "").toLowerCase()];
            if (ra !== undefined && rb !== undefined && ra !== rb) return ra - rb;
            if (ra !== undefined && rb === undefined) return -1;
            if (rb !== undefined && ra === undefined) return 1;
            return String(a.name).localeCompare(String(b.name));
        });
    }
    const hasRate = (w) => Boolean(w.dailyRate || w.hourlyRate);
    const workerById = (id) => (project.workers || []).find((w) => w.id === id);
    const isPosted = (entry) => Boolean(findPostedSourceEntry(project, "expense", "payroll-batch", entry.id));

    // One place for the pay rules, shared by the timesheet and the single entry form.
    function ratesOf(worker, basis) {
        const daily = money(worker.dailyRate), hourly = money(worker.hourlyRate), ot = money(worker.otRate);
        let regularPerDay;
        if (basis === "hourly") regularPerDay = hourly > 0 ? hourly * 8 : daily;
        else regularPerDay = daily > 0 ? daily : hourly * 8;
        const regularPerHour = hourly > 0 ? hourly : regularPerDay / 8;
        return {
            regularPerDay: Math.round(regularPerDay * 100) / 100,
            overtimePerHour: Math.round((ot > 0 ? ot : regularPerHour * 1.25) * 100) / 100,
        };
    }
    // Hourly rate for a partial day: the hourly rate if set, otherwise the daily rate divided by 8.
    function hourRateOf(worker) {
        const hourly = money(worker.hourlyRate), daily = money(worker.dailyRate);
        return Math.round((hourly > 0 ? hourly : daily / 8) * 100) / 100;
    }
    function payFor(worker, days, overtimeHours, hours = 0) {
        const rates = ratesOf(worker, "auto");
        const basic = hours > 0 ? Math.round(hours * hourRateOf(worker) * 100) / 100 : Math.round(days * rates.regularPerDay * 100) / 100;
        const otPay = Math.round(overtimeHours * rates.overtimePerHour * 100) / 100;
        return { ...rates, basic, otPay, gross: money(basic + otPay) };
    }

    function formatHours(value) {
        const hours = Number(value) || 0;
        return Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 100) / 100);
    }
    const formatDays = formatHours;
    function entryDaysWorked(entry) {
        // daysWorked is the source of truth; older entries only have hoursWorked.
        return entry.daysWorked ?? (Number(entry.hoursWorked) || 0) / 8;
    }
    const mini = (d) => { const [y, m, day] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); };

    // ---- Summary tiles and the missing-rate notice ----
    function renderTiles() {
        const workers = project.workers || [];
        const entries = project.payrollEntries || [];
        const unposted = entries.filter((e) => !isPosted(e));
        const noRate = workers.filter((w) => !hasRate(w));
        get("#pyTileWorkers").textContent = String(workers.length);
        get("#pyTileWorkersNote").innerHTML = noRate.length
            ? `${noRate.length} without a pay rate`
            : `<a href="../project-201/project-201.html?id=${encodeURIComponent(project.id)}">Manage on Project 201 Files</a>`;
        get("#pyTilePaid").textContent = formatMoney(sumMoney(entries, (e) => e.grossPay));
        get("#pyTilePaidNote").textContent = `${plural(entries.length, "payment")} recorded`;
        get("#pyTileUnposted").textContent = formatMoney(sumMoney(unposted, (e) => e.grossPay));
        get("#pyTileUnpostedNote").textContent = unposted.length ? `${plural(unposted.length, "record")} to post` : "Nothing waiting";
        get("#pyTilePosted").textContent = formatMoney(sumMoney(entries.filter(isPosted), (e) => e.grossPay));

        const banner = get("#pyNoRate");
        if (noRate.length) {
            const names = noRate.slice(0, 4).map((w) => escapeHtml(w.name)).join(", ") + (noRate.length > 4 ? ` and ${noRate.length - 4} more` : "");
            banner.innerHTML = `${names} ${noRate.length === 1 ? "has" : "have"} no pay rate yet. Set it on the <a href="../project-201/project-201.html?id=${encodeURIComponent(project.id)}">Project 201 Files</a> page before recording pay.`;
            banner.hidden = false;
        } else banner.hidden = true;
    }

    // ---- Tabs: daily timesheet | single entry ----
    function setTab(name) {
        const daily = name !== "single";
        get("#dailyPanel").hidden = !daily;
        get("#singlePanel").hidden = daily;
        get("#tabDaily").setAttribute("aria-selected", String(daily));
        get("#tabSingle").setAttribute("aria-selected", String(!daily));
    }
    get("#tabDaily").addEventListener("click", () => setTab("daily"));
    get("#tabSingle").addEventListener("click", () => {
        if (!get("#payrollForm").dataset.editId) resetPayrollForm();
        setTab("single");
    });

    // ---- Daily timesheet ----
    function recordedOn(date) {
        const map = new Map();
        (project.payrollEntries || []).forEach((e) => { if (e.date === date) map.set(e.workerId, e); });
        return map;
    }
    function rowState(id) { return sheet[id] || { days: 0, ot: 0, hrs: 0 }; }

    function renderTimesheet() {
        const date = get("#tsDate").value;
        get("#tsWeekday").textContent = date ? weekdayName(date) : "";
        const workers = sortedWorkers();
        get("#tsEmpty").hidden = workers.length > 0;
        get("#tsRows").hidden = workers.length === 0;
        const done = recordedOn(date);

        get("#tsRows").innerHTML = workers.map((w) => {
            const entry = done.get(w.id);
            const role = [w.role, w.workerType === "Subcontracted" ? "Subcontracted" : ""].filter(Boolean).join(" · ");
            if (entry) {
                const posted = isPosted(entry);
                return `<div class="ts-row is-locked" data-id="${escapeHtml(w.id)}">
                    <div class="ts-who"><strong>${escapeHtml(w.name)}</strong><small>${escapeHtml(role) || "&nbsp;"}</small></div>
                    <div class="ts-locked-info">Recorded: ${Number(entry.regularHours) > 0 ? formatHours(entry.regularHours) + "h" : formatDays(entryDaysWorked(entry)) + "d"}${(Number(entry.overtimeHours) || 0) > 0 ? ` + ${formatHours(entry.overtimeHours)}h OT` : ""} <span class="bn-chip ${posted ? "ok" : "info"}">${posted ? "Posted" : "In log"}</span></div>
                    <div class="ts-pay">${formatMoney(entry.grossPay)}</div>
                </div>`;
            }
            const st = rowState(w.id);
            const rate = hasRate(w) ? `${formatMoney(ratesOf(w, "auto").regularPerDay)}/day` : "";
            const seg = [["0", "Absent"], ["0.5", "½ Day"], ["1", "1 Day"]]
                .map(([v, label]) => `<button type="button" data-days="${v}" aria-pressed="${Number(v) === st.days}">${label}</button>`).join("");
            return `<div class="ts-row${st.days > 0 || st.ot > 0 || st.hrs > 0 ? " is-set" : ""}" data-id="${escapeHtml(w.id)}">
                <div class="ts-who"><strong>${escapeHtml(w.name)}</strong><small${rate ? "" : ' class="bad"'}>${rate ? escapeHtml([role, rate].filter(Boolean).join(" · ")) : "No pay rate set"}</small></div>
                <div class="bn-seg ts-days" role="group" aria-label="Days worked by ${escapeHtml(w.name)}">${seg}</div>
                <label class="ts-ot ts-hrs" title="For a partial day. Hours actually worked, paid at the hourly rate. Overtime is separate."><span>Hours</span><input type="number" min="0" max="24" step="0.25" value="${st.hrs || ""}" placeholder="e.g. 2" aria-label="Regular hours worked by ${escapeHtml(w.name)} (partial day)"></label>
                <label class="ts-ot ts-otin"><span>OT hrs</span><input type="number" min="0" step="0.25" value="${st.ot || ""}" placeholder="0" aria-label="Overtime hours for ${escapeHtml(w.name)}"></label>
                <div class="ts-pay zero">—</div>
            </div>`;
        }).join("");
        workers.forEach((w) => { if (!done.has(w.id)) refreshRow(w.id); });
        refreshTotals();
    }

    function refreshRow(id) {
        const row = get(`#tsRows .ts-row[data-id="${CSS.escape(id)}"]`);
        const w = workerById(id);
        if (!row || !w || row.classList.contains("is-locked")) return;
        const st = rowState(id);
        row.classList.toggle("is-set", st.days > 0 || st.ot > 0 || st.hrs > 0);
        row.querySelectorAll("[data-days]").forEach((b) => b.setAttribute("aria-pressed", String(st.hrs <= 0 && Number(b.dataset.days) === st.days)));
        const cell = row.querySelector(".ts-pay");
        if (st.days > 0 || st.ot > 0 || st.hrs > 0) {
            cell.textContent = hasRate(w) ? formatMoney(payFor(w, st.days, st.ot, st.hrs).gross) : "No rate";
            cell.classList.remove("zero");
        } else { cell.textContent = "—"; cell.classList.add("zero"); }
    }

    function sheetRows() {
        const done = recordedOn(get("#tsDate").value);
        return sortedWorkers().filter((w) => !done.has(w.id)).map((w) => ({ worker: w, ...rowState(w.id) })).filter((r) => r.days > 0 || r.ot > 0 || r.hrs > 0);
    }
    function refreshTotals() {
        const rows = sheetRows();
        const total = sumMoney(rows.filter((r) => hasRate(r.worker)), (r) => payFor(r.worker, r.days, r.ot, r.hrs).gross);
        const days = rows.reduce((n, r) => n + r.days, 0);
        const part = rows.reduce((n, r) => n + r.hrs, 0);
        const ot = rows.reduce((n, r) => n + r.ot, 0);
        get("#tsSummary").textContent = rows.length
            ? `${plural(rows.length, "worker")}${days > 0 ? ` · ${formatDays(days)} day${days === 1 ? "" : "s"}` : ""}${part > 0 ? ` · ${formatHours(part)}h partial` : ""}${ot > 0 ? ` · ${formatHours(ot)}h OT` : ""}`
            : "Nothing marked yet";
        get("#tsTotal").textContent = formatMoney(total);
        get("#tsSave").disabled = rows.length === 0;
    }
    function tsSay(text, kind) { const el = get("#tsMessage"); el.textContent = text; el.className = `bn-msg${kind ? " " + kind : ""}`; }

    get("#tsRows").addEventListener("click", (e) => {
        const btn = e.target.closest("[data-days]");
        if (!btn) return;
        const id = btn.closest(".ts-row").dataset.id;
        sheet[id] = { ...rowState(id), days: Number(btn.dataset.days), hrs: 0 };
        btn.closest(".ts-row").querySelector(".ts-hrs input").value = "";
        tsSay("");
        refreshRow(id); refreshTotals();
    });
    get("#tsRows").addEventListener("input", (e) => {
        if (!e.target.matches(".ts-ot input")) return;
        const id = e.target.closest(".ts-row").dataset.id;
        const value = Math.max(0, Number(e.target.value) || 0);
        // Typing partial-day hours replaces the day buttons; overtime stays separate.
        sheet[id] = e.target.closest(".ts-hrs") ? { ...rowState(id), hrs: Math.min(24, value), days: 0 } : { ...rowState(id), ot: value };
        tsSay("");
        refreshRow(id); refreshTotals();
    });
    function setDate(value) { get("#tsDate").value = value; sheet = {}; tsSay(""); renderTimesheet(); }
    get("#tsDate").addEventListener("change", () => { if (get("#tsDate").value) setDate(get("#tsDate").value); });
    get("#tsPrev").addEventListener("click", () => setDate(addDays(get("#tsDate").value || getTodayValue(), -1)));
    get("#tsNext").addEventListener("click", () => setDate(addDays(get("#tsDate").value || getTodayValue(), 1)));
    get("#tsClear").addEventListener("click", () => { sheet = {}; tsSay(""); renderTimesheet(); });
    get("#tsAllPresent").addEventListener("click", () => {
        const done = recordedOn(get("#tsDate").value);
        sortedWorkers().forEach((w) => { if (!done.has(w.id)) sheet[w.id] = { ...rowState(w.id), days: 1 }; });
        tsSay(""); renderTimesheet();
    });
    get("#tsCopyPrev").addEventListener("click", () => {
        const date = get("#tsDate").value;
        const earlier = (project.payrollEntries || []).map((e) => e.date).filter((d) => d < date).sort();
        if (!earlier.length) { tsSay("No earlier day with entries to copy from.", "err"); return; }
        const source = earlier[earlier.length - 1];
        const done = recordedOn(date);
        let copied = 0;
        (project.payrollEntries || []).filter((e) => e.date === source).forEach((e) => {
            const w = workerById(e.workerId);
            if (!w || done.has(w.id)) return;
            sheet[w.id] = Number(e.regularHours) > 0
                ? { days: 0, hrs: Number(e.regularHours), ot: Number(e.overtimeHours) || 0 }
                : { days: Math.min(1, entryDaysWorked(e)), hrs: 0, ot: Number(e.overtimeHours) || 0 };
            copied++;
        });
        renderTimesheet();
        tsSay(copied ? `Copied ${plural(copied, "worker")} from ${mini(source)}. Adjust anyone who differs, then save.` : "Nobody from that day is left to copy.", copied ? "ok" : "err");
    });

    get("#tsSave").addEventListener("click", () => {
        const date = get("#tsDate").value;
        if (!date) { tsSay("Choose a date.", "err"); return; }
        const rows = sheetRows();
        if (!rows.length) { tsSay("Mark at least one person present first.", "err"); return; }
        const missing = rows.filter((r) => !hasRate(r.worker)).map((r) => r.worker.name);
        if (missing.length) { tsSay(`Set a pay rate on the Project 201 Files page for: ${missing.join(", ")}.`, "err"); return; }
        const fresh = recordedOn(date);
        const clash = rows.filter((r) => fresh.has(r.worker.id)).map((r) => r.worker.name);
        if (clash.length) { tsSay(`Already recorded for this date: ${clash.join(", ")}.`, "err"); return; }

        const created = rows.map(({ worker, days, ot, hrs }) => {
            const pay = payFor(worker, days, ot, hrs);
            return {
                id: createId(), workerId: worker.id, date,
                daysWorked: hrs > 0 ? hrs / 8 : days, regularHours: hrs > 0 ? hrs : 0, overtimeHours: ot, payBasis: "auto",
                regularDayRate: pay.regularPerDay, overtimeHourlyRate: pay.overtimePerHour,
                basicPay: pay.basic, allowance: 0, nightDiff: 0, holidayFee: 0, otPay: pay.otPay,
                otherFee: 0, otherNote: "", grossPay: pay.gross, notes: "",
                hoursWorked: hrs > 0 ? hrs : days * 8, ratePerDay: pay.basic,
                createdAt: new Date().toISOString(),
            };
        });
        project.payrollEntries = [...(project.payrollEntries || []), ...created];
        created.forEach((entry) => appendProjectAudit(project, "CREATE", "payroll", entry.id, `Recorded payroll for ${workerById(entry.workerId)?.name || "worker"}`));
        project = upsertProject(project);
        const total = sumMoney(created, (e) => e.grossPay);
        sheet = {};
        log.page = 0;
        renderAll();
        tsSay(`Saved ${plural(created.length, "worker")} for ${mini(date)}, ${formatMoney(total)} in total.`, "ok");
    });

    // ---- Payroll log (Gmail-style: 30 per page, each entry opens) ----
    function logEntries() {
        const q = log.query.trim().toLowerCase();
        return [...(project.payrollEntries || [])]
            .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : String(b.createdAt || "").localeCompare(String(a.createdAt || ""))))
            .filter((e) => {
                const posted = isPosted(e);
                if (log.filter === "posted" && !posted) return false;
                if (log.filter === "unposted" && posted) return false;
                if (!q) return true;
                const w = workerById(e.workerId);
                return [w ? w.name : "removed worker", e.date, formatDate(e.date), e.notes, e.otherNote].some((v) => String(v || "").toLowerCase().includes(q));
            });
    }
    function part(label, value, small, cls) {
        return `<div class="lg-part${cls ? " " + cls : ""}"><span>${label}</span><strong>${value}</strong>${small ? `<small>${small}</small>` : ""}</div>`;
    }
    function renderPayroll() {
        const all = project.payrollEntries || [];
        const list = logEntries();
        const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
        log.page = Math.min(Math.max(0, log.page), pages - 1);
        const start = log.page * PAGE_SIZE;
        const slice = list.slice(start, start + PAGE_SIZE);

        get("#payrollEmptyState").hidden = all.length > 0;
        get("#payrollEmptyState").textContent = all.length ? "" : "No payroll payments recorded yet.";
        const noMatch = all.length > 0 && list.length === 0;
        get("#logRange").textContent = list.length ? `${start + 1}–${start + slice.length} of ${list.length}` : (noMatch ? "No matches" : "0 entries");
        get("#logNewer").disabled = log.page === 0;
        get("#logOlder").disabled = log.page >= pages - 1;
        get("#logToggleAll").hidden = slice.length === 0;
        get("#logToggleAll").textContent = slice.length && slice.every((e) => log.open.has(e.id)) ? "Collapse Page" : "Expand Page";

        get("#payrollTableBody").innerHTML = slice.map((entry) => {
            const posted = isPosted(entry);
            const worker = workerById(entry.workerId);
            const open = log.open.has(entry.id);
            const ot = Number(entry.overtimeHours) || 0;
            const partial = Number(entry.regularHours) > 0;
            const snippet = `${partial ? formatHours(entry.regularHours) + "h" : formatDays(entryDaysWorked(entry)) + "d"} regular${ot > 0 ? ` · ${formatHours(ot)}h OT` : ""}${entry.notes ? ` — ${escapeHtml(entry.notes)}` : ""}`;
            const parts = [part("Regular pay", formatMoney(entry.basicPay ?? entry.ratePerDay), partial ? `${formatHours(entry.regularHours)}h × ${formatMoney((entry.basicPay || 0) / entry.regularHours)}` : (entry.regularDayRate ? `${formatDays(entryDaysWorked(entry))}d × ${formatMoney(entry.regularDayRate)}` : ""))];
            if (entry.allowance) parts.push(part("Allowance", formatMoney(entry.allowance)));
            if (entry.nightDiff) parts.push(part("Night diff", formatMoney(entry.nightDiff)));
            if (entry.holidayFee) parts.push(part("Holiday fee", formatMoney(entry.holidayFee)));
            if (entry.otPay) parts.push(part("Overtime", formatMoney(entry.otPay), ot > 0 && entry.overtimeHourlyRate ? `${formatHours(ot)}h × ${formatMoney(entry.overtimeHourlyRate)}` : ""));
            if (entry.otherFee) parts.push(part(entry.otherFee < 0 ? "Deduction" : "Other fee", formatMoney(entry.otherFee), escapeHtml(entry.otherNote || "")));
            parts.push(part("Gross", formatMoney(entry.grossPay), "", "total"));
            return `<article class="lg-item${open ? " open" : ""}" data-id="${escapeHtml(entry.id)}">
                <button type="button" class="lg-row" aria-expanded="${open}" aria-controls="lg-${escapeHtml(entry.id)}">
                    <span class="lg-chev" aria-hidden="true">&#9656;</span>
                    <span class="lg-date">${escapeHtml(mini(entry.date))}</span>
                    <span class="lg-main"><strong>${escapeHtml(worker ? worker.name : "Removed worker")}</strong><span class="lg-snip">${snippet}</span></span>
                    <span class="lg-amt">${formatMoney(entry.grossPay)}</span>
                    <span class="lg-state"><span class="bn-chip ${posted ? "ok" : "warn"}">${posted ? "Posted" : "Unposted"}</span></span>
                </button>
                <div class="lg-panel" id="lg-${escapeHtml(entry.id)}"${open ? "" : " hidden"}>
                    <div class="lg-parts">${parts.join("")}</div>
                    ${entry.notes ? `<p class="lg-note"><span>Note:</span> ${escapeHtml(entry.notes)}</p>` : ""}
                    <div class="lg-actions">
                        <button type="button" class="secondary-button" data-edit="${escapeHtml(entry.id)}" ${posted ? 'disabled title="Reverse its Cash Out before editing"' : ""}>Edit</button>
                        <button type="button" class="secondary-button" data-delete="${escapeHtml(entry.id)}" ${posted ? 'disabled title="Reverse its Cash Out before deleting"' : ""}>Delete</button>
                    </div>
                </div>
            </article>`;
        }).join("");
        renderTiles();
    }

    get("#payrollTableBody").addEventListener("click", async (e) => {
        const edit = e.target.closest("[data-edit]");
        const del = e.target.closest("[data-delete]");
        const row = e.target.closest(".lg-row");
        if (edit) { if (!edit.disabled) startEdit(edit.dataset.edit); return; }
        if (del) { if (!del.disabled) await deleteEntry(del.dataset.delete); return; }
        if (row) {
            const id = row.closest(".lg-item").dataset.id;
            if (log.open.has(id)) log.open.delete(id); else log.open.add(id);
            renderPayroll();
            const again = get(`.lg-item[data-id="${CSS.escape(id)}"] .lg-row`);
            if (again) again.focus({ preventScroll: true });
        }
    });
    get("#logToggleAll").addEventListener("click", () => {
        const slice = logEntries().slice(log.page * PAGE_SIZE, log.page * PAGE_SIZE + PAGE_SIZE);
        const allOpen = slice.every((x) => log.open.has(x.id));
        slice.forEach((x) => (allOpen ? log.open.delete(x.id) : log.open.add(x.id)));
        renderPayroll();
    });
    get("#logNewer").addEventListener("click", () => { log.page -= 1; renderPayroll(); toView("#pyLog", { block: "start" }); });
    get("#logOlder").addEventListener("click", () => { log.page += 1; renderPayroll(); toView("#pyLog", { block: "start" }); });
    let logTimer = null;
    get("#logSearch").addEventListener("input", () => { clearTimeout(logTimer); logTimer = setTimeout(() => { log.query = get("#logSearch").value; log.page = 0; renderPayroll(); }, 120); });
    get("#logFilter").addEventListener("click", (e) => {
        const b = e.target.closest("[data-filter]");
        if (!b) return;
        log.filter = b.dataset.filter; log.page = 0;
        get("#logFilter").querySelectorAll("[data-filter]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        renderPayroll();
    });

    async function deleteEntry(id) {
        const removed = (project.payrollEntries || []).find((entry) => entry.id === id);
        if (!removed) return;
        const who = workerById(removed.workerId)?.name || "this worker";
        if (!await window.CashbookDialogs.confirm(`Delete the payroll entry for ${who} on ${formatDate(removed.date)}?`, { title: "Delete payroll entry", confirmText: "Delete", danger: true })) return;
        project.payrollEntries = (project.payrollEntries || []).filter((entry) => entry.id !== id);
        project.expenseEntries = (project.expenseEntries || []).filter((entry) => entry.sourceId !== id);
        appendProjectAudit(project, "DELETE", "payroll", removed.id, `Deleted unposted payroll record dated ${removed.date}`);
        log.open.delete(id);
        project = upsertProject(project);
        renderAll();
    }

    // ---- Single entry form (also used to edit a log entry) ----
    function populateWorkerSelect() {
        const workers = sortedWorkers();
        const select = get("#payrollWorker");
        const submit = get("#payrollForm").querySelector("button[type=submit]");
        if (workers.length === 0) {
            select.innerHTML = `<option value="">No workers yet. Add one on the Project 201 Files page</option>`;
            submit.disabled = true;
            return;
        }
        submit.disabled = false;
        select.innerHTML =
            `<option value="">Select worker</option>` +
            workers.map((worker) => `<option value="${worker.id}" data-daily="${worker.dailyRate || 0}" data-hourly="${worker.hourlyRate || 0}" data-ot="${worker.otRate || 0}">${escapeHtml(worker.name)}${worker.role ? " — " + escapeHtml(worker.role) : ""}</option>`).join("");
    }

    function calcGross() {
        return money(get("#payrollBasic").value) + money(get("#payrollAllowance").value) + money(get("#payrollNightDiff").value) +
            money(get("#payrollHoliday").value) + money(get("#payrollOtPay").value) + money(get("#payrollOtherFee").value);
    }
    function updateGrossPreview() { get("#payrollGrossPreview").value = formatMoney(calcGross()); }

    function selectedPayRates() {
        const option = get("#payrollWorker").selectedOptions[0];
        if (!option || !option.value) return { regularPerDay: 0, overtimePerHour: 0 };
        const worker = { dailyRate: option.dataset.daily, hourlyRate: option.dataset.hourly, otRate: option.dataset.ot };
        return { ...ratesOf(worker, get("#payrollRateType").value || "auto"), regularPerHour: hourRateOf(worker) };
    }

    function expandExtraPay() { get("#extraPayFields").hidden = false; get("#toggleExtraPay").textContent = "− Hide Extra Pay / Deductions"; }
    function collapseExtraPay() { get("#extraPayFields").hidden = true; get("#toggleExtraPay").textContent = "Add Extra Pay / Deductions"; }
    get("#toggleExtraPay").addEventListener("click", () => { if (get("#extraPayFields").hidden) expandExtraPay(); else collapseExtraPay(); });

    // While editing, keep the amounts that were saved unless the worker, pay basis, days or overtime change.
    function isSavedUnchanged() {
        const f = get("#payrollForm");
        return Boolean(f.dataset.editId) && f.dataset.savedBasic !== undefined &&
            Number(get("#payrollHours").value || 0) === Number(f.dataset.savedHours || 0) &&
            get("#payrollWorker").value === f.dataset.savedWorker &&
            Number(get("#payrollDays").value) === Number(f.dataset.savedDays) &&
            Number(get("#payrollOvertimeHours").value) === Number(f.dataset.savedOt) &&
            get("#payrollRateType").value === f.dataset.savedBasis;
    }
    function recalcPayFromDays(clearLegacy = true) {
        if (clearLegacy) delete get("#payrollForm").dataset.legacyManualPay;
        if (isSavedUnchanged()) {
            const f = get("#payrollForm");
            get("#payrollBasic").value = f.dataset.savedBasic;
            get("#payrollOtPay").value = f.dataset.savedOtPay;
            get("#payrollRateSummary").textContent = "Saved amounts kept. Change the worker, days or overtime to recalculate at current rates.";
            updateGrossPreview();
            return;
        }
        const days = Number(get("#payrollDays").value) || 0;
        const hours = Number(get("#payrollHours").value) || 0;
        const overtimeHours = Number(get("#payrollOvertimeHours").value) || 0;
        const rates = selectedPayRates();
        get("#payrollBasic").value = hours > 0 ? Math.round(hours * (rates.regularPerHour || 0) * 100) / 100 : Math.round(days * rates.regularPerDay * 100) / 100;
        get("#payrollOtPay").value = Math.round(overtimeHours * rates.overtimePerHour * 100) / 100;
        get("#payrollRateSummary").textContent = get("#payrollWorker").value
            ? `${hours > 0 ? `Partial day ${formatMoney(rates.regularPerHour || 0)}/hr` : `Regular ${formatMoney(rates.regularPerDay)}/day`}${overtimeHours > 0 ? ` · Overtime ${formatMoney(rates.overtimePerHour)}/hr` : ""}`
            : "Select a worker and enter days worked to calculate pay.";
        updateGrossPreview();
    }
    get("#payrollWorker").addEventListener("change", recalcPayFromDays);
    get("#payrollDays").addEventListener("input", () => { if (Number(get("#payrollDays").value) > 0) get("#payrollHours").value = ""; recalcPayFromDays(); });
    get("#payrollHours").addEventListener("input", () => { if (Number(get("#payrollHours").value) > 0) get("#payrollDays").value = ""; recalcPayFromDays(); });
    get("#payrollOvertimeHours").addEventListener("input", recalcPayFromDays);
    get("#payrollRateType").addEventListener("change", recalcPayFromDays);
    ["payrollAllowance", "payrollNightDiff", "payrollHoliday", "payrollOtherFee"].forEach((id) => get("#" + id).addEventListener("input", updateGrossPreview));

    function resetPayrollForm() {
        const f = get("#payrollForm");
        f.reset();
        delete f.dataset.editId;
        delete f.dataset.legacyManualPay;
        ["savedHours", "savedWorker", "savedDays", "savedOt", "savedBasis", "savedBasic", "savedOtPay"].forEach((k) => delete f.dataset[k]);
        [...get("#payrollWorker").options].filter((o) => o.text === "Removed worker").forEach((o) => o.remove());
        get("#payrollDays").value = "";
        get("#payrollHours").value = "";
        get("#payrollOvertimeHours").value = 0;
        get("#payrollRateType").value = "auto";
        get("#payrollDate").value = get("#tsDate").value || getTodayValue();
        get("#payrollFormMessage").textContent = "";
        f.querySelector("button[type=submit]").textContent = "Save Payroll Payment";
        get("#payrollFormTitle").textContent = "Record Payroll Payment";
        collapseExtraPay();
        recalcPayFromDays();
    }
    get("#payrollFormCancel").addEventListener("click", () => { resetPayrollForm(); setTab("daily"); });

    function startEdit(id) {
        const entry = (project.payrollEntries || []).find((e) => e.id === id);
        if (!entry) return;
        const f = get("#payrollForm");
        resetPayrollForm();
        if (![...get("#payrollWorker").options].some((o) => o.value === entry.workerId)) get("#payrollWorker").add(new Option("Removed worker", entry.workerId));
        get("#payrollWorker").value = entry.workerId;
        get("#payrollDate").value = entry.date;
        const partialEntry = Number(entry.regularHours) > 0;
        get("#payrollDays").value = partialEntry ? "" : entryDaysWorked(entry);
        get("#payrollHours").value = partialEntry ? entry.regularHours : "";
        get("#payrollOvertimeHours").value = entry.overtimeHours ?? 0;
        get("#payrollRateType").value = entry.payBasis || "auto";
        get("#payrollBasic").value = entry.basicPay ?? entry.ratePerDay ?? 0;
        get("#payrollAllowance").value = entry.allowance || 0;
        get("#payrollNightDiff").value = entry.nightDiff || 0;
        get("#payrollHoliday").value = entry.holidayFee || 0;
        get("#payrollOtPay").value = entry.otPay || 0;
        get("#payrollOtherFee").value = entry.otherFee || 0;
        get("#payrollOtherNote").value = entry.otherNote || "";
        get("#payrollNotes").value = entry.notes || "";
        Object.assign(f.dataset, {
            editId: entry.id, savedWorker: entry.workerId, savedDays: partialEntry ? "0" : String(entryDaysWorked(entry)), savedHours: partialEntry ? String(entry.regularHours) : "0",
            savedOt: String(entry.overtimeHours ?? 0), savedBasis: entry.payBasis || "auto",
            savedBasic: String(entry.basicPay ?? entry.ratePerDay ?? 0), savedOtPay: String(entry.otPay || 0),
        });
        if ((Number(entry.overtimeHours) || 0) > 0 || (Number(entry.allowance) || 0) > 0 || (Number(entry.nightDiff) || 0) > 0 || (Number(entry.holidayFee) || 0) > 0 || (Number(entry.otherFee) || 0) !== 0) expandExtraPay();
        else collapseExtraPay();
        if (entry.overtimeHours === undefined && Number(entry.otPay) > 0) {
            f.dataset.legacyManualPay = "true";
            get("#payrollRateSummary").textContent = "Legacy OT amount retained. Enter overtime hours to recalculate it from the worker's rate.";
        } else recalcPayFromDays(false);
        updateGrossPreview();
        f.querySelector("button[type=submit]").textContent = "Update Payroll";
        get("#payrollFormTitle").textContent = "Edit Payroll Payment";
        setTab("single");
        toView("#pyRecord", { behavior: "smooth", block: "start" });
        get("#payrollWorker").focus({ preventScroll: true });
    }

    get("#payrollForm").addEventListener("submit", (event) => {
        event.preventDefault();
        const say = (t) => { get("#payrollFormMessage").textContent = t; };
        const workerId = get("#payrollWorker").value;
        if (!workerId) { say("Select a worker."); return; }

        const regularHours = Number(get("#payrollHours").value) || 0;
        const regularDays = regularHours > 0 ? regularHours / 8 : (Number(get("#payrollDays").value) || 0);
        const overtimeHours = Number(get("#payrollOvertimeHours").value) || 0;
        const rates = selectedPayRates();
        if (regularDays < 0 || overtimeHours < 0 || (regularDays === 0 && overtimeHours === 0)) { say("Enter days worked or hours worked, overtime hours, or both."); return; }
        if (regularHours > 24) { say("Hours worked in one day cannot be more than 24."); return; }
        if (!isSavedUnchanged() && regularDays > 0 && (regularHours > 0 ? !(rates.regularPerHour > 0) : rates.regularPerDay <= 0)) { say("This worker needs a daily or hourly rate before regular pay can be calculated. Set it on the Project 201 Files page."); return; }
        if (!isSavedUnchanged() && overtimeHours > 0 && rates.overtimePerHour <= 0) { say("This worker needs an OT, hourly, or daily rate before overtime can be calculated."); return; }

        const gross = calcGross();
        if (!get("#payrollDate").value || gross <= 0) { say("Payroll date and a positive gross pay are required."); return; }
        const editId = get("#payrollForm").dataset.editId;

        const duplicate = (project.payrollEntries || []).find((entry) => entry.id !== editId && entry.workerId === workerId && entry.date === get("#payrollDate").value);
        if (duplicate) { say("This worker already has a payroll entry for that date. Edit the existing entry instead of adding another."); return; }

        const entryData = {
            workerId,
            date: get("#payrollDate").value,
            daysWorked: regularDays,
            regularHours,
            overtimeHours,
            payBasis: get("#payrollRateType").value || "auto",
            regularDayRate: rates.regularPerDay,
            overtimeHourlyRate: rates.overtimePerHour,
            basicPay: money(get("#payrollBasic").value),
            allowance: money(get("#payrollAllowance").value),
            nightDiff: money(get("#payrollNightDiff").value),
            holidayFee: money(get("#payrollHoliday").value),
            otPay: money(get("#payrollOtPay").value),
            otherFee: money(get("#payrollOtherFee").value),
            otherNote: get("#payrollOtherNote").value.trim(),
            grossPay: gross,
            notes: get("#payrollNotes").value.trim(),
            // legacy compat, in case anything still reads hours directly
            hoursWorked: regularHours > 0 ? regularHours : regularDays * 8,
            ratePerDay: money(get("#payrollBasic").value),
        };

        if (editId) {
            const existing = project.payrollEntries.find((e) => e.id === editId);
            if (existing) {
                if (isSavedUnchanged()) {
                    entryData.regularDayRate = existing.regularDayRate ?? entryData.regularDayRate;
                    entryData.overtimeHourlyRate = existing.overtimeHourlyRate ?? entryData.overtimeHourlyRate;
                }
                Object.assign(existing, entryData);
                appendProjectAudit(project, "UPDATE", "payroll", existing.id, `Updated unposted payroll record dated ${entryData.date}`);
            }
            const exp = (project.expenseEntries || []).find((e) => e.sourceId === editId);
            if (exp) {
                exp.amount = gross;
                exp.date = entryData.date;
                exp.description = `Payroll — ${get("#payrollWorker").selectedOptions[0]?.textContent?.trim() || "worker"}`;
            }
        } else {
            const entry = { id: createId(), ...entryData, createdAt: new Date().toISOString() };
            project.payrollEntries = [...(project.payrollEntries || []), entry];
            appendProjectAudit(project, "CREATE", "payroll", entry.id, `Recorded payroll for ${get("#payrollWorker").selectedOptions[0]?.textContent?.trim() || "worker"}`);
        }

        project = upsertProject(project);
        resetPayrollForm();
        setTab("daily");
        renderAll();
    });

    // ---- Cash Out: pick a pay period, see what will be posted, post it ----
    function periodFor(kind) {
        const today = getTodayValue();
        if (kind === "week" || kind === "lastweek") {
            const dow = parseDay(today).getUTCDay();
            const monday = addDays(today, -((dow + 6) % 7) - (kind === "lastweek" ? 7 : 0));
            return [monday, addDays(monday, 6)];
        }
        const [y, m] = today.split("-").map(Number);
        const pad = (n) => String(n).padStart(2, "0");
        if (kind === "first") return [`${y}-${pad(m)}-01`, `${y}-${pad(m)}-15`];
        const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
        return [`${y}-${pad(m)}-16`, `${y}-${pad(m)}-${pad(last)}`];
    }
    function cashOutEntries() {
        const from = get("#cashOutFrom").value, to = get("#cashOutTo").value;
        if (!from || !to || from > to) return [];
        return (project.payrollEntries || []).filter((e) => e.date >= from && e.date <= to && !isPosted(e));
    }
    function renderCashOutPreview() {
        const from = get("#cashOutFrom").value, to = get("#cashOutTo").value;
        const text = get("#coPreviewText"), total = get("#coPreviewTotal");
        if (!from || !to) { text.textContent = "Choose a period to see what will be posted."; total.textContent = ""; return; }
        if (from > to) { text.textContent = "The From date is after the To date."; total.textContent = ""; return; }
        const entries = cashOutEntries();
        const workers = new Set(entries.map((e) => e.workerId)).size;
        text.textContent = entries.length ? `${plural(entries.length, "unposted record")} · ${plural(workers, "worker")}` : "No unposted records in this period.";
        total.textContent = entries.length ? formatMoney(sumMoney(entries, (e) => e.grossPay)) : "";
    }
    get("#coPresets").addEventListener("click", (e) => {
        const b = e.target.closest("[data-preset]");
        if (!b) return;
        const [from, to] = periodFor(b.dataset.preset);
        get("#cashOutFrom").value = from; get("#cashOutTo").value = to;
        get("#coPresets").querySelectorAll("[data-preset]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        get("#cashOutMessage").textContent = "";
        renderCashOutPreview();
    });
    ["#cashOutFrom", "#cashOutTo"].forEach((sel) => get(sel).addEventListener("input", () => {
        get("#coPresets").querySelectorAll("[data-preset]").forEach((x) => x.setAttribute("aria-pressed", "false"));
        get("#cashOutMessage").textContent = "";
        renderCashOutPreview();
    }));

    function coSay(text, kind) { const el = get("#cashOutMessage"); el.textContent = text; el.className = `bn-msg${kind ? " " + kind : ""}`; }
    get("#generateCashOutBtn").addEventListener("click", async () => {
        const from = get("#cashOutFrom").value, to = get("#cashOutTo").value;
        if (!from || !to) { coSay("Please select both From and To dates.", "err"); return; }
        if (from > to) { coSay("The From date is after the To date.", "err"); return; }
        const entries = cashOutEntries();
        if (entries.length === 0) { coSay("No unposted payroll entries in that date range.", "err"); return; }

        const total = sumMoney(entries, (entry) => entry.grossPay);
        if (!await window.CashbookDialogs.confirm(`Post ${plural(entries.length, "payroll record")} (${formatMoney(total)}) for ${formatDate(from)} to ${formatDate(to)} to Cash Out? Posted records are locked until the Cash Out is reversed.`, { title: "Post payroll to Cash Out", confirmText: "Post" })) return;

        const desc = `Payroll batch ${formatDate(from)} – ${formatDate(to)} (${entries.length} entries)`;
        const posting = postProjectTransaction(project, "expense", {
            sourceType: "payroll-batch", sourceIds: entries.map((e) => e.id), date: to,
            amount: total, description: desc, category: "Payroll",
            auditSummary: `Posted ${entries.length} payroll record(s) to Cash Out`,
        });
        if (!posting.ok) { coSay("Duplicate posting blocked. Reverse the existing payroll Cash Out first.", "err"); return; }
        project = upsertProject(project);
        renderAll();
        coSay(`Created cash-out of ${formatMoney(total)} for ${entries.length} payroll entries.`, "ok");
    });

    function renderAll() {
        renderTiles();
        renderTimesheet();
        renderPayroll();
        renderCashOutPreview();
    }

    // Init
    get("#tsDate").value = getTodayValue();
    populateWorkerSelect();
    resetPayrollForm();
    renderAll();
})();
