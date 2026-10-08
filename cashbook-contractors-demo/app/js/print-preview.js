(function () {
    "use strict";
    if (window.CashbookPrintPreviewV3) return;

    const previewScriptUrl = document.currentScript?.src || location.href;
    const nativePrint = window.print.bind(window);
    const PAPER = {
        A4: { width: 210, height: 297, label: "A4" },
        Letter: { width: 215.9, height: 279.4, label: "Letter" },
        Legal: { width: 215.9, height: 355.6, label: "Legal" },
        Folio: { width: 215.9, height: 330.2, label: "Folio" },
    };
    const state = {
        paper: "A4", orientation: "portrait", marginPreset: "normal",
        margins: { top: 12.7, right: 12.7, bottom: 12.7, left: 12.7 },
        scaleMode: "fit", scale: 100, header: false, footer: true,
        headerText: "", footerText: "Cashbook Family - Contractors Edition",
        // Signature block (Prepared by / Checked by / Approved by) printed after the page content.
        signatures: false,
        sigPreparedOn: true, sigPreparedName: "", sigPreparedTitle: "",
        sigCheckedOn: true, sigCheckedName: "", sigCheckedTitle: "",
        sigApprovedOn: true, sigApprovedName: "", sigApprovedTitle: "",
    };
    const SIG_ROLES = [
        { key: "Prepared", label: "Prepared by" },
        { key: "Checked", label: "Checked by" },
        { key: "Approved", label: "Approved by" },
    ];
    const SIG_STORAGE_KEY = "cbcPrintSignatures";
    const SIG_KEYS = Object.keys(state).filter((key) => key.startsWith("sig"));
    // Remember the signature choices on this computer so they do not have to be typed for every printout.
    try {
        const saved = JSON.parse(localStorage.getItem(SIG_STORAGE_KEY) || "null");
        if (saved && typeof saved === "object") SIG_KEYS.forEach((key) => { if (typeof saved[key] === typeof state[key]) state[key] = saved[key]; });
    } catch (error) { /* storage unavailable: use defaults */ }
    function saveSignatures() {
        try { localStorage.setItem(SIG_STORAGE_KEY, JSON.stringify(Object.fromEntries(SIG_KEYS.map((key) => [key, state[key]])))); }
        catch (error) { /* ignore */ }
    }
    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }
    function activeSignatureRoles() { return state.signatures ? SIG_ROLES.filter((role) => state[`sig${role.key}On`]) : []; }
    function signatureExtraHeight() { return activeSignatureRoles().length ? 140 : 0; }
    function signatureHtml() {
        const roles = activeSignatureRoles();
        if (!roles.length) return "";
        const cells = roles.map((role) => {
            const name = String(state[`sig${role.key}Name`] || "").trim();
            const position = String(state[`sig${role.key}Title`] || "").trim();
            return `<div style="flex:1 1 0;min-width:0;font-size:12px;line-height:1.35">`
                + `<div style="font-weight:700;margin-bottom:36px">${role.label}:</div>`
                + `<div style="border-top:1px solid #17211d;padding-top:4px;text-align:center;font-weight:700;min-height:17px">${name ? escapeHtml(name) : "&nbsp;"}</div>`
                + `<div style="text-align:center;min-height:16px">${position ? escapeHtml(position) : "&nbsp;"}</div>`
                + `<div style="margin-top:8px">Date: <span style="display:inline-block;width:60%;border-bottom:1px solid #17211d">&nbsp;</span></div>`
                + `</div>`;
        }).join("");
        return `<div class="cf-signature-block" style="box-sizing:border-box;width:100%;margin-top:32px;padding:0 4px;display:flex;gap:36px;break-inside:avoid;page-break-inside:avoid">${cells}</div>`;
    }
    const pending = new Map();
    let modal;
    let sourceSnapshot;
    let lastPdf = "";
    let renderTimer;
    let previewRenderTimer;
    let renderVersion = 0;
    let previewRenderVersion = 0;
    let previewZoom = "page-fit";
    let previewDocument = null;
    let currentPage = 1;

    function rpc(type, payload) {
        if (window.top === window && window.cashbookDesktop) {
            return type === "cashbook-render-print-pdf"
                ? window.cashbookDesktop.renderPrintPdf(payload)
                : window.cashbookDesktop.printPdf(payload);
        }
        return new Promise((resolve, reject) => {
            const requestId = `${Date.now()}-${Math.random()}`;
            pending.set(requestId, { resolve, reject });
            window.top.postMessage({ type, requestId, ...(type === "cashbook-render-print-pdf" ? { payload } : { pdf: payload }) }, "*");
            setTimeout(() => {
                if (!pending.has(requestId)) return;
                pending.delete(requestId);
                reject(new Error("The desktop print service did not respond."));
            }, 60000);
        });
    }

    addEventListener("message", (event) => {
        if (!["cashbook-render-print-pdf-result", "cashbook-print-pdf-result"].includes(event.data?.type)) return;
        const request = pending.get(event.data.requestId);
        if (!request) return;
        pending.delete(event.data.requestId);
        if (event.data.error) request.reject(new Error(event.data.error));
        else request.resolve(event.data.pdf ?? event.data.result ?? true);
    });

    function title() {
        return ((typeof window.CashbookPrintTitle === "function" && window.CashbookPrintTitle()) || document.querySelector("h1")?.textContent || document.title || "Cashbook Family - Contractors Edition").trim();
    }


    // ---- Print area: choose which parts of the page are printed -------------------------------
    // Blocks are the cards / sections / tables of the page. The person ticks the ones to print.
    const BLOCK_SELECTOR = "section, article, table, .form-card, .bn-card, .mp-card, .mp-formcard, .an-card, .bento-card, .chart-card, .aset-panel";
    const GROUP_SELECTOR = ".summary-grid, .bn-tiles, .mp-tiles, .an-tiles";      // rows of small figures stay together
    const SKIP_SELECTOR = ".dash-toolbar, .ledger-toolbar, .mp-nav, nav, .screen-only, .topbar, .report-controls, .accounting-toolbar, .page-actions, .form-actions, .modal-overlay, dialog, script, style";
    let areaBlocks = [];            // [{ id, el, label }] for the page currently being previewed
    const areaOff = new Set();      // ids of blocks the person has switched off

    function isShown(el) {
        if (el.hidden || el.closest("[hidden]")) return false;
        const style = getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden" && el.getClientRects().length > 0;
    }
    function hasContent(el) {
        return (el.textContent || "").trim().length > 0 || !!el.querySelector("canvas, img, svg, table");
    }
    function ownHeading(el) {
        return Array.from(el.children).some((child) => /^H[1-6]$/.test(child.tagName)
            || (/head/i.test(child.className || "") && child.querySelector("h1, h2, h3, h4")));
    }
    function blockLabel(el, index) {
        const heading = el.querySelector("h1, h2, h3, h4");
        if (heading) {
            const copy = heading.cloneNode(true);
            copy.querySelectorAll("[aria-hidden], small, svg, [class*='chip'], [class*='count'], [class*='badge']").forEach((node) => node.remove());
            const text = (copy.textContent || heading.textContent || "").replace(/\s+/g, " ").trim();
            if (text) return text;
        }
        const caption = el.getAttribute("aria-label") || el.querySelector("caption")?.textContent;
        if (caption && caption.trim()) return caption.replace(/\s+/g, " ").trim();
        if (el.matches("table")) return "Table";
        if (el.matches(GROUP_SELECTOR)) return "Summary figures";
        return `Section ${index + 1}`;
    }
    function detectBlocks(source) {
        const found = [];
        (function walk(node) {
            Array.from(node.children).forEach((child) => {
                if (child.matches(SKIP_SELECTOR) || !isShown(child)) return;
                if (child.matches(BLOCK_SELECTOR) || child.matches(GROUP_SELECTOR)) {
                    const inner = child.matches(GROUP_SELECTOR) ? [] : Array.from(child.querySelectorAll(BLOCK_SELECTOR))
                        .filter((el) => !el.matches(SKIP_SELECTOR) && isShown(el) && hasContent(el) && !el.parentElement.closest(SKIP_SELECTOR));
                    // A wrapper with no heading of its own that holds several blocks is split into those blocks.
                    if (inner.length >= 2 && !ownHeading(child)) { walk(child); return; }
                    if (hasContent(child)) found.push(child);
                    return;
                }
                walk(child);
            });
        })(source);
        const seen = new Map();
        return found.map((el, id) => {
            let label = blockLabel(el, id);
            const count = (seen.get(label) || 0) + 1;
            seen.set(label, count);
            if (count > 1) label += ` (${count})`;
            return { id, el, label };
        });
    }
    function areasUsable() { return areaBlocks.length >= 2; }
    function allAreasOff() { return areasUsable() && areaBlocks.every((block) => areaOff.has(block.id)); }
    function renderAreaList() {
        const box = modal.querySelector(".cf-areas");
        const list = box.querySelector(".cf-areas-list");
        list.textContent = "";
        box.hidden = !areasUsable();
        areaBlocks.forEach((block) => {
            const row = document.createElement("label");
            row.className = "cf-check cf-area-row";
            const input = document.createElement("input");
            input.type = "checkbox";
            input.checked = !areaOff.has(block.id);
            input.dataset.area = String(block.id);
            const text = document.createElement("span");
            text.textContent = block.label;
            row.append(input, text);
            list.append(row);
        });
        updateAreaCount();
    }
    function updateAreaCount() {
        const box = modal.querySelector(".cf-areas");
        const on = areaBlocks.length - areaOff.size;
        box.querySelector(".cf-areas-count").textContent = `${on} of ${areaBlocks.length} selected`;
    }
    function areasChanged() {
        updateAreaCount();
        if (allAreasOff()) {
            renderVersion += 1;
            lastPdf = "";
            modal.querySelector(".cf-final-print").disabled = true;
            modal.querySelector("#cfPdfStatus").textContent = "Tick at least one area to print.";
            return;
        }
        sourceSnapshot = capture();
        scheduleRender();
    }


    // ---- Export the ticked areas to Excel ------------------------------------------------------
    const XLSX_SKIP = "button, .screen-only, script, style, svg, canvas, select, textarea, form, dialog, [hidden], nav, .bn-sub, .mp-sub, .mp-card-sub, .bn-actions, .mp-actions, .bn-seg, .ie-legend, .ie-check, .bn-msg, [aria-live]";
    const BLOCK_TAGS = new Set(["DIV", "P", "LI", "UL", "OL", "TR", "H1", "H2", "H3", "H4", "H5", "H6", "SECTION", "ARTICLE", "BR", "HEADER", "FOOTER", "FIGURE", "FIELDSET", "LABEL"]);
    function cellText(node) {
        let out = "";
        (function walk(n) {
            if (n.nodeType === 3) { out += n.data.replace(/\s+/g, " "); return; }
            if (n.nodeType !== 1 || n.matches(XLSX_SKIP) || getComputedStyle(n).display === "none") return;
            if (n.tagName === "INPUT") { if (n.type !== "checkbox" && n.type !== "radio" && n.value) out += n.value; return; }
            const display = getComputedStyle(n).display;
            const block = BLOCK_TAGS.has(n.tagName) || !display.startsWith("inline");
            if (block) out += "\n";
            n.childNodes.forEach(walk);
            if (block) out += "\n";
        })(node);
        return out.split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
    }
    // ---- Reading values: text on screen becomes real numbers, money, percentages and status colours ----
    const CODE_HEAD = /^(no\.?|#|ref\.?|code|id|item no\.?|invoice|cheque no\.?|check no\.?|po no\.?|po #|number|contact|phone|mobile|tin|zip|year|sss|philhealth|pag-?ibig)\b/i;
    const MONTH = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
    const DATE_RE = new RegExp(`^(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}|(${MONTH})[a-z]*\\.? \\d{1,2},? \\d{4}|\\d{1,2} (${MONTH})[a-z]*\\.? \\d{4})$`, "i");
    const TONE_WORDS = {
        good: /^(paid|fully paid|completed?|done|active|approved|received|delivered|cleared|settled|closed|ok|on track|ahead|on time|yes|available|in stock|regular|present)$/i,
        warn: /^(pending|partial(ly paid)?|partial delivery|ongoing|in progress|draft|for approval|ordered|in transit|due|due soon|on hold|at risk|low stock|post-?dated|scheduled|for delivery|probationary)$/i,
        bad: /^(overdue|unpaid|cancel+ed|rejected|bounced|missing|delayed|late|over budget|out of stock|suspended|behind|failed|expired|terminated|absent)$/i,
    };
    function toneOf(text) {
        const t = String(text || "").trim();
        if (!t || t.length > 28) return "";
        return Object.keys(TONE_WORDS).find((tone) => TONE_WORDS[tone].test(t)) || "";
    }
    // Returns { v, fmt } where fmt is text | center | money | int | plain | dec | pct.
    function typed(text, header) {
        const raw = String(text ?? "").trim();
        if (!raw) return { v: "", fmt: "text" };
        const n = raw.replace(/[\u2212\u2012-\u2014]/g, "-");
        if (/%$/.test(n) && /^-?\d+(\.\d+)?\s*%$/.test(n)) return { v: Number(n.replace(/[%\s]/g, "")) / 100, fmt: "pct" };
        if (/^[(-]?\s*-?\s*\u20B1?\s*-?\s*\d[\d,]*(\.\d+)?\s*\)?$/.test(n)) {
            const peso = n.includes("\u20B1"), core = n.replace(/[()\s\u20B1,-]/g, "");
            const negative = /^\(.*\)$/.test(n) || /^-/.test(n) || /^\u20B1\s*-/.test(n);
            const bad = !peso && (/^0\d/.test(core) || CODE_HEAD.test(header || ""));
            if (bad && /^(no\.?|#)$/i.test((header || "").trim()) && /^[1-9]\d*$/.test(core) && !negative) return { v: Number(core), fmt: "center" };
            if (!bad && Number.isFinite(Number(core))) {
                const v = (negative ? -1 : 1) * Number(core);
                if (peso) return { v, fmt: "money" };
                if (core.includes(".")) return { v, fmt: "dec" };
                return { v, fmt: n.includes(",") ? "int" : "plain" };
            }
            return { v: raw, fmt: "center" };
        }
        if (/^(no\.?|#)$/i.test((header || "").trim()) && /^\d+$/.test(n)) return { v: Number(n), fmt: "center" };
        if (DATE_RE.test(n) || CODE_HEAD.test(header || "")) return { v: raw, fmt: "center" };
        return { v: raw, fmt: "text" };
    }
    function bodyCell(text, header, opts) {
        const X = window.CbcXlsx;
        const t = typed(text, header);
        const tone = t.fmt === "text" || t.fmt === "center" ? toneOf(text) : "";
        return { v: t.v, st: X.spec.body({ fmt: t.fmt, alt: opts.alt, total: opts.total, tone }), len: String(text ?? "").length };
    }
    const TOTAL_RE = /^(grand\s+)?(sub-?)?totals?\b/i;
    // A table becomes { head: [[{text, span}]], body: [{ cells: [{text, span}], total }] } over the columns that hold something.
    function readTable(table) {
        const lines = Array.from(table.rows).filter((row) => getComputedStyle(row).display !== "none");
        const grid = lines.map((row) => {
            const cells = [];
            Array.from(row.cells).filter((cell) => getComputedStyle(cell).display !== "none").forEach((cell) => {
                const span = Math.max(1, cell.colSpan || 1);
                cells.push({ text: cellText(cell), head: cell.tagName === "TH", span, start: true });
                for (let i = 1; i < span; i += 1) cells.push({ text: "", head: cell.tagName === "TH", span: 0, start: false });
            });
            return { cells, foot: row.parentElement && row.parentElement.tagName === "TFOOT", inHead: row.parentElement && row.parentElement.tagName === "THEAD" };
        });
        const width = Math.max(0, ...grid.map((line) => line.cells.length));
        const keep = [];
        for (let c = 0; c < width; c += 1) if (grid.some((line) => line.cells[c] && line.cells[c].text)) keep.push(c);
        const head = [], body = [];
        grid.forEach((line) => {
            if (!line.cells.some((cell, c) => keep.includes(c) && cell.text)) return;
            const cells = keep.map((c) => line.cells[c] || { text: "", head: false, span: 1, start: true });
            // Spans that lost columns shrink to the columns that are left.
            cells.forEach((cell, i) => { if (cell.start && cell.span > 1) { let k = 1; while (cells[i + k] && !cells[i + k].start) k += 1; cell.span = k; } });
            const allHead = cells.every((cell) => cell.head || !cell.text);
            if (line.inHead || allHead) head.push(cells);
            else body.push({ cells, total: line.foot || cells.slice(0, 2).some((cell) => TOTAL_RE.test(cell.text)) });
        });
        return { head, body, cols: keep.length };
    }

    function leafTexts(el, list = []) {
        if (el.nodeType !== 1 || el.matches(XLSX_SKIP) || el.matches("input") || getComputedStyle(el).display === "none") return list;
        if (!el.children.length) { const t = cellText(el); if (t) list.push(t); return list; }
        Array.from(el.childNodes).forEach((n) => {
            if (n.nodeType === 3) { const t = n.data.replace(/\s+/g, " ").trim(); if (t) list.push(t); }
            else leafTexts(n, list);
        });
        return list;
    }
    function shallow(el) { return Array.from(el.children).every((child) => child.children.length === 0 || child.matches(XLSX_SKIP)); }
    const TILE_SELECTOR = ".an-tile, .bn-tile, .mp-tile, .summary-card";
    const TILE_GROUP = ".summary-grid, .bn-tiles, .mp-tiles, .an-tiles";
    function tileFrom(tile) {
        const strong = tile.querySelector("strong");
        const leaves = Array.from(tile.querySelectorAll("*")).filter((node) => !node.children.length && !node.matches(XLSX_SKIP) && cellText(node));
        let label = "", value = "", note = "";
        if (strong && cellText(strong)) {
            const at = leaves.indexOf(strong);
            value = cellText(strong);
            label = leaves.slice(0, Math.max(0, at)).map(cellText).join(" ");
            note = leaves.slice(at + 1).map(cellText).join(" \u00B7 ");
        } else { label = leaves[0] ? cellText(leaves[0]) : ""; value = leaves[1] ? cellText(leaves[1]) : ""; note = leaves.slice(2).map(cellText).join(" \u00B7 "); }
        const cls = ` ${tile.className} `;
        const tone = /\s(bad|negative|over|danger)\s/.test(cls) ? "bad" : /\s(warn|warning)\s/.test(cls) ? "warn" : /\s(ok|positive|good)\s/.test(cls) ? "good" : "";
        return { label, value, note, tone };
    }
    // Items: { type: "table" | "kpi" | "lines" | "section" }
    function collectItems(el, items, heading) {
        if (el.matches(XLSX_SKIP) || getComputedStyle(el).display === "none") return;
        if (el.matches("h1, h2, h3, h4")) {
            const text = cellText(el);
            if (text && text !== heading) items.push({ type: "section", text });
            return;
        }
        if (el.matches("table")) { const table = readTable(el); if (table.cols) items.push({ type: "table", ...table }); return; }
        if (el.matches(TILE_GROUP) || el.matches(TILE_SELECTOR)) {
            const tiles = el.matches(TILE_SELECTOR) ? [el] : Array.from(el.querySelectorAll(TILE_SELECTOR)).filter((t) => getComputedStyle(t).display !== "none");
            const list = tiles.map(tileFrom).filter((t) => t.label || t.value);
            if (list.length) items.push({ type: "kpi", list });
            return;
        }
        if (el.querySelector("table, .an-tile, .bn-tile, .mp-tile, .summary-card") || !shallow(el)) { Array.from(el.children).forEach((child) => collectItems(child, items, heading)); return; }
        const texts = leafTexts(el).filter((t) => t !== heading);
        if (!texts.length) return;
        const last = items[items.length - 1];
        if (last && last.type === "lines") last.rows.push(texts); else items.push({ type: "lines", rows: [texts] });
    }
    function isEntryForm(el) {
        // Three or more visible fields and no table: a data-entry form, not something to report on.
        return !el.querySelector("table") && Array.from(el.querySelectorAll("input, select, textarea")).filter((c) => !["checkbox", "radio", "hidden"].includes(c.type) && getComputedStyle(c).display !== "none").length >= 3;
    }
    // ---- Laying the items out as a presentation-ready sheet ----------------------------------------
    const APP_NAME = "CASHBOOK FOR CONTRACTORS";
    const colLen = (len, cap = 46) => Math.max(9, Math.min(cap, Math.round(len * 1.15 + 2)));
    const colLetter = (i) => { let out = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + ((n - 1) % 26)) + out; return out; };
    const refOf = (r, c1, c2) => `${colLetter(c1)}${r + 1}:${colLetter(c2)}${r + 1}`;
    // Splits the columns into n groups of similar width, so boxes (signatures, key figures) fit the page.
    function splitColumns(widths, n) {
        const total = widths.reduce((sum, w) => sum + w, 0), groups = [];
        let start = 0, acc = 0;
        for (let g = 0; g < n; g += 1) {
            let end = start;
            acc += widths[end];
            while (end < widths.length - (n - g - 1) - 1 && acc < (total * (g + 1)) / n) { end += 1; acc += widths[end]; }
            groups.push([start, end]);
            start = end + 1;
        }
        groups[n - 1][1] = widths.length - 1;
        return groups;
    }
    function pageContext() {
        const sub = document.querySelector(".cbc-global-header div span");
        return (sub && sub.textContent.trim()) || "Contractor Workspace";
    }
    function stamped() {
        return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "long", timeStyle: "short" }).format(new Date());
    }
    function composeSheet(name, heading, items, sourceTitle) {
        const X = window.CbcXlsx;
        const widths = [];
        const grow = (c, len, cap) => { widths[c] = Math.max(widths[c] || 0, colLen(len, cap)); };
        // 1) measure the columns from tables and plain lines
        items.forEach((item) => {
            if (item.type === "table") {
                item.head.forEach((row) => row.forEach((cell, c) => { if (cell.start && cell.span <= 1) grow(c, Math.min(cell.text.length, 22), 30); }));
                item.body.forEach((row) => row.cells.forEach((cell, c) => { if (cell.start && cell.span <= 1) grow(c, Math.max(...cell.text.split("\n").map((l) => l.length), 0)); }));
            } else if (item.type === "lines") item.rows.forEach((row) => row.forEach((text, c) => grow(c, Math.max(...String(text).split("\n").map((l) => l.length), 0))));
        });
        const hasKpi = items.some((item) => item.type === "kpi");
        const sigRoles = activeSignatureRoles();
        let minCols = 4;
        if (hasKpi) minCols = Math.max(minCols, 3);
        if (sigRoles.length) minCols = Math.max(minCols, sigRoles.length);
        while (widths.length < minCols) widths.push(18);
        for (let c = 0; c < widths.length; c += 1) if (!widths[c]) widths[c] = 12;
        // Key figures: label | value | remarks, merged over enough columns to be readable.
        let kpiSpans = null;
        if (hasKpi) {
            const need = [26, 18, 34];
            kpiSpans = []; let c = 0;
            need.forEach((min, k) => {
                const from = c; let sum = 0;
                do { if (c >= widths.length) widths.push(min); sum += widths[c]; c += 1; } while (sum < min && (k < 2 || c < widths.length));
                kpiSpans.push([from, c - 1]);
            });
            kpiSpans[2][1] = Math.max(kpiSpans[2][1], widths.length - 1);
        }
        const cols = widths.length;
        const rows = [], merges = [], heights = {};
        const pad = (cells, style) => { while (cells.length < cols) cells.push({ v: "", st: style }); return cells; };
        const mergeRow = (r, c1, c2) => { if (c2 > c1) merges.push(refOf(r, c1, c2)); };
        const full = (text, spec, ht) => { const r = rows.length; rows.push(pad([{ v: text, st: spec }], spec)); mergeRow(r, 0, cols - 1); if (ht) heights[r] = ht; return r; };
        const spacer = (ht) => { heights[rows.length] = ht; rows.push([]); };
        // 2) header block: company, project, title, details
        full(APP_NAME, X.spec.banner(), 36);
        full(pageContext(), X.spec.bannerSub(), 22);
        spacer(8);
        full(heading, X.spec.reportTitle(), 28);
        const metaText = `Source: ${String(sourceTitle).split("|")[0].trim()}   \u2022   Generated: ${stamped()}   \u2022   Currency: Philippine Peso (\u20B1)`;
        const totalWidth = widths.reduce((sum, w) => sum + w, 0);
        full(metaText, X.spec.meta(), 8 + 13 * Math.max(1, Math.ceil(metaText.length / Math.max(30, totalWidth * 1.05))));
        spacer(8);
        let headerRow = -1, tableCount = 0, firstBody = 0, lastBody = 0, hasSpans = false;
        // 3) content
        items.forEach((item) => {
            if (item.type === "section") { full(item.text, X.spec.sectionBand(), 22); return; }
            if (item.type === "table") {
                tableCount += 1;
                const labels = [];
                item.head.forEach((row) => row.forEach((cell, c) => { if (cell.start && cell.text) labels[c] = cell.text; }));
                item.head.forEach((cells) => {
                    const r = rows.length, line = [];
                    cells.forEach((cell, c) => { line.push({ v: cell.start ? cell.text : "", st: X.spec.header() }); if (cell.start && cell.span > 1) { mergeRow(r, c, c + cell.span - 1); hasSpans = true; } });
                    rows.push(line); heights[r] = 26;
                    if (headerRow < 0) headerRow = r;
                });
                if (!item.head.length) headerRow = -2;
                firstBody = rows.length;
                item.body.forEach((row, i) => {
                    const r = rows.length, line = [];
                    row.cells.forEach((cell, c) => {
                        const built = cell.start ? bodyCell(cell.text, labels[c] || "", { alt: i % 2 === 1, total: row.total }) : { v: "", st: X.spec.body({ fmt: "text", alt: i % 2 === 1, total: row.total }) };
                        line.push(built);
                        if (cell.start && cell.span > 1) { mergeRow(r, c, c + cell.span - 1); hasSpans = true; }
                    });
                    rows.push(line);
                });
                lastBody = rows.length - 1;
                spacer(10);
                return;
            }
            if (item.type === "kpi") {
                const r0 = rows.length;
                const head = [{ v: "Key figure", st: X.spec.header() }, { v: "Value", st: X.spec.header() }, { v: "Remarks", st: X.spec.header() }];
                const line = [];
                kpiSpans.forEach(([c1, c2], k) => { for (let c = c1; c <= c2; c += 1) line[c] = { v: c === c1 ? head[k].v : "", st: X.spec.header() }; mergeRow(r0, c1, c2); });
                rows.push(line); heights[r0] = 24;
                item.list.forEach((tile) => {
                    const r = rows.length, t = typed(tile.value, tile.label), out = [];
                    const cellsFor = [{ v: tile.label, st: X.spec.kpiLabel() }, { v: t.v, st: X.spec.kpiValue({ fmt: t.fmt === "text" || t.fmt === "center" ? "text" : t.fmt, tone: tile.tone }) }, { v: tile.note, st: X.spec.kpiNote() }];
                    kpiSpans.forEach(([c1, c2], k) => { for (let c = c1; c <= c2; c += 1) out[c] = { v: c === c1 ? cellsFor[k].v : "", st: cellsFor[k].st }; mergeRow(r, c1, c2); });
                    rows.push(out); heights[r] = tile.note && tile.note.length > 40 ? 30 : 24;
                });
                spacer(10);
                return;
            }
            // Plain lines: two-part lines read as "label | value", the rest as a bordered row.
            item.rows.forEach((texts, i) => {
                const r = rows.length;
                if (texts.length === 2 && typed(texts[0]).fmt === "text") {
                    const t = typed(texts[1], texts[0]);
                    rows.push([{ v: texts[0], st: X.spec.kpiLabel() }, { v: t.v, st: X.spec.body({ fmt: t.fmt, alt: false, tone: t.fmt === "text" ? toneOf(texts[1]) : "" }) }]);
                } else rows.push(texts.map((text) => bodyCell(text, "", { alt: i % 2 === 1 })));
            });
            spacer(10);
        });
        while (rows.length && !rows[rows.length - 1].length) { rows.pop(); }
        // 4) footer note and signature boxes
        spacer(12);
        full("Prepared with Cashbook Family - Contractors Edition. Figures are as shown in the app at the time of export.", X.spec.note(), 16);
        if (sigRoles.length) {
            spacer(14);
            const groups = splitColumns(widths, sigRoles.length);
            const boxRow = (spec, ht, textFor) => {
                const r = rows.length, line = [];
                groups.forEach(([c1, c2], k) => { for (let c = c1; c <= c2; c += 1) line[c] = { v: c === c1 ? textFor(sigRoles[k]) : "", st: spec }; mergeRow(r, c1, c2); });
                rows.push(line); heights[r] = ht;
            };
            const val = (role, key) => String(state[`sig${role.key}${key}`] || "").trim();
            boxRow(X.spec.sigRole(), 20, (role) => `${role.label}:`);
            boxRow(X.spec.sigBox({ bottom: true }), 44, () => "");
            boxRow(X.spec.sigBox({ bold: true }), 20, (role) => val(role, "Name"));
            boxRow(X.spec.sigBox({}), 18, (role) => val(role, "Title"));
            boxRow(X.spec.sigBox({}), 20, () => "Date:");
        }
        const sheet = { name, widths, rows, merges, rowHeights: heights, landscape: cols > 6, hideGrid: true, tabColor: "FF1F4E79",
            headerFooter: { hl: "Cashbook for Contractors", hr: heading, fl: pageContext(), fr: stamped() } };
        // A single plain table gets a filter, frozen headings and repeating print headings.
        if (tableCount === 1 && !hasKpi && !hasSpans && headerRow >= 0 && lastBody - firstBody >= 1) {
            sheet.filterRef = `A${headerRow + 1}:${colLetter(cols - 1)}${lastBody + 1}`;
            if (lastBody - firstBody > 12) sheet.freezeRows = headerRow + 1;
            sheet.printTitleRows = [headerRow + 1, headerRow + 1];
        }
        sheet.summary = [tableCount ? `${tableCount} table${tableCount === 1 ? "" : "s"}` : "", hasKpi ? "key figures" : ""].filter(Boolean).join(", ") || "details";
        return sheet;
    }
    function sheetFor(target) {
        if (isEntryForm(target.el)) return null;
        const heading = target.el.querySelector("h1, h2, h3, h4")?.textContent.replace(/\s+/g, " ").trim() || "";
        const items = [];
        collectItems(target.el, items, heading);
        while (items.length && items[0].type === "section" && items[0].text === target.label) items.shift();
        if (!items.some((item) => item.type !== "section")) return null;
        // A chart or message area leaves only a caption behind: not worth a sheet of its own.
        const structured = items.some((item) => item.type === "table" || item.type === "kpi");
        const numeric = ["money", "int", "plain", "dec", "pct"];
        const numberRows = items.reduce((sum, item) => sum + (item.type === "lines" ? item.rows.filter((row) => row.some((text) => numeric.includes(typed(text).fmt))).length : 0), 0);
        if (!structured && numberRows < 2) return null;
        return composeSheet(target.label, target.label, items, title());
    }
    function coverSheet(sheets, fileTitle) {
        const head = [[{ text: "No.", span: 1, start: true }, { text: "Sheet", span: 1, start: true }, { text: "Contents", span: 1, start: true }]];
        const body = sheets.map((sheet, i) => ({ total: false, cells: [{ text: String(i + 1), span: 1, start: true }, { text: sheet.name, span: 1, start: true }, { text: sheet.summary, span: 1, start: true }] }));
        const cover = composeSheet("Cover", fileTitle, [{ type: "section", text: "Contents of this workbook" }, { type: "table", head, body, cols: 3 }], title());
        delete cover.filterRef; delete cover.freezeRows; delete cover.printTitleRows;
        return cover;
    }
    function loadXlsxWriter() {
        if (window.CbcXlsx) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = new URL("core/xlsx-writer.js", previewScriptUrl).href;
            script.onload = resolve;
            script.onerror = () => reject(new Error("The Excel writer could not be loaded."));
            document.head.append(script);
        });
    }
    async function exportExcel() {
        const status = modal.querySelector("#cfPdfStatus");
        const printSource = (typeof window.CashbookPrintTarget === "function" && window.CashbookPrintTarget()) || document.querySelector("main") || document.body;
        const targets = areaBlocks.length ? areaBlocks.filter((block) => !areaOff.has(block.id)) : [{ label: title(), el: printSource }];
        if (!targets.length) { status.textContent = "Tick at least one area to export."; return; }
        try {
            await loadXlsxWriter();
            const sheets = targets.map(sheetFor).filter(Boolean);
            const skipped = targets.length - sheets.length;
            if (!sheets.length) { status.textContent = "The ticked areas hold only charts or entry forms, so there is nothing to put in Excel."; return; }
            const fileTitle = title().split("|")[0].trim().replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ") || "Cashbook";
            const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
            const book = sheets.length > 1 ? [coverSheet(sheets, fileTitle), ...sheets] : sheets;
            window.CbcXlsx.download(window.CbcXlsx.build(book, { title: fileTitle, author: "Cashbook for Contractors", company: "Cashbook Family" }), `${fileTitle} - ${stamp}.xlsx`);
            status.textContent = `Excel file saved with ${sheets.length} sheet${sheets.length === 1 ? "" : "s"}${sheets.length > 1 ? " and a cover page" : ""}${skipped ? ` (${skipped} chart or form area${skipped === 1 ? "" : "s"} left out)` : ""}.`;
        } catch (error) { status.textContent = error.message || "The Excel file could not be created."; }
    }

    function capture() {
        const source = (typeof window.CashbookPrintTarget === "function" && window.CashbookPrintTarget()) || document.querySelector("main") || document.body;
        areaBlocks.forEach((block) => block.el.setAttribute("data-cf-pp", String(block.id)));
        const clone = source.cloneNode(true);
        areaBlocks.forEach((block) => block.el.removeAttribute("data-cf-pp"));
        const sourceControls = source.querySelectorAll("input, textarea, select");
        const cloneControls = clone.querySelectorAll("input, textarea, select");
        sourceControls.forEach((control, index) => {
            const copy = cloneControls[index];
            if (!copy) return;
            if (copy.tagName === "SELECT") Array.from(copy.options).forEach((option, optionIndex) => option.selected = control.options[optionIndex]?.selected || false);
            else if (["checkbox", "radio"].includes(copy.type)) copy.checked = control.checked;
            else { copy.value = control.value; copy.setAttribute("value", control.value); }
        });
        const sourceCanvases = source.querySelectorAll("canvas");
        const cloneCanvases = clone.querySelectorAll("canvas");
        sourceCanvases.forEach((canvas, index) => {
            const copy = cloneCanvases[index];
            if (!copy) return;
            try {
                const image = document.createElement("img");
                image.src = canvas.toDataURL("image/png");
                image.alt = canvas.getAttribute("aria-label") || "Printed chart";
                image.className = canvas.className;
                image.style.cssText = canvas.style.cssText;
                image.style.display = "block";
                image.style.width = `${canvas.clientWidth || canvas.width}px`;
                image.style.maxWidth = "100%";
                image.style.height = "auto";
                image.setAttribute("data-print-chart", canvas.id || `chart-${index + 1}`);
                copy.replaceWith(image);
            } catch (error) {
                console.warn("A chart could not be prepared for printing.", error);
            }
        });
        clone.querySelectorAll("script, dialog, button, .screen-only, .topbar, .report-controls, .accounting-toolbar, .page-actions, .form-actions, .modal-overlay").forEach((node) => node.remove());
        if (areaOff.size) {
            const touched = new Set();
            areaOff.forEach((id) => clone.querySelectorAll(`[data-cf-pp="${id}"]`).forEach((node) => {
                if (node.parentElement) touched.add(node.parentElement);
                node.remove();
            }));
            // A block that lost its neighbours is widened so it prints across the page, not in a leftover column.
            clone.querySelectorAll("[data-cf-pp]").forEach((node) => {
                if (!touched.has(node.parentElement)) return;
                node.style.gridColumn = "1 / -1";
                node.style.width = "100%";
                node.style.maxWidth = "none";
                node.style.flex = "1 1 100%";
            });
        }
        const originalStyle = clone.getAttribute("style");
        clone.style.position = "fixed";
        clone.style.left = "-100000px";
        clone.style.top = "0";
        clone.style.visibility = "hidden";
        clone.style.pointerEvents = "none";
        clone.style.width = `${Math.max(source.clientWidth, source.offsetWidth)}px`;
        document.body.appendChild(clone);
        const measured = { width: Math.max(clone.scrollWidth, clone.offsetWidth), height: Math.max(clone.scrollHeight, clone.offsetHeight) };
        if (originalStyle === null) clone.removeAttribute("style");
        else clone.setAttribute("style", originalStyle);
        const html = clone.outerHTML;
        clone.remove();
        return { html, ...measured };
    }

    function stylesheetText() {
        return Array.from(document.styleSheets).map((sheet) => {
            try { return Array.from(sheet.cssRules).map((rule) => rule.cssText).join("\n"); }
            catch { return ""; }
        }).filter(Boolean);
    }

    function build() {
        modal = document.createElement("div");
        modal.className = "cf-print-preview cf-print-preview-v3";
        modal.hidden = true;
        modal.innerHTML = `<aside class="cf-print-settings"><div class="cf-print-title"><button class="cf-print-back" type="button">←</button><div><strong>Print</strong><span>Exact PDF preview</span></div></div>
          <div class="cf-areas" hidden><div class="cf-areas-head"><strong>Print area</strong><span class="cf-areas-count"></span></div><p class="cf-areas-hint">Tick the parts of this page you want printed.</p><div class="cf-areas-actions"><button type="button" data-areas="all">Select all</button><button type="button" data-areas="none">Clear</button></div><div class="cf-areas-list"></div></div>
          <label>Orientation<select data-key="orientation"><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
          <label>Paper size<select data-key="paper"><option value="A4">A4 (210 × 297 mm)</option><option value="Letter">Letter (8.5 × 11 in)</option><option value="Legal">Legal (8.5 × 14 in)</option><option value="Folio">Folio (8.5 × 13 in)</option></select></label>
          <label>Margins<select data-key="marginPreset"><option value="normal">Normal</option><option value="narrow">Narrow</option><option value="wide">Wide</option><option value="custom">Custom</option></select></label>
          <div class="cf-custom-margins" hidden><label>Top (mm)<input data-margin="top" type="text" inputmode="decimal"></label><label>Right (mm)<input data-margin="right" type="text" inputmode="decimal"></label><label>Bottom (mm)<input data-margin="bottom" type="text" inputmode="decimal"></label><label>Left (mm)<input data-margin="left" type="text" inputmode="decimal"></label></div>
          <label>Scaling<select data-key="scaleMode"><option value="fit">Fit to one page wide</option><option value="fit-page">Fit entire document to one page</option><option value="actual">Actual size</option><option value="custom">Custom scale</option></select></label>
          <label class="cf-scale-row" hidden>Scale <span><input data-key="scale" type="range" min="25" max="200" step="5"><output>100%</output></span></label>
          <label class="cf-check"><input data-key="header" type="checkbox"> Include header</label><input class="cf-text-option" data-key="headerText" placeholder="Header text" hidden>
          <label class="cf-check"><input data-key="footer" type="checkbox" checked> Include footer</label><input class="cf-text-option" data-key="footerText" value="Cashbook Family - Contractors Edition">
          <label class="cf-check"><input data-key="signatures" type="checkbox"> Include signature block</label>
          <div class="cf-sign-options" hidden>${SIG_ROLES.map((role) => `<fieldset class="cf-sign-group"><label class="cf-check"><input data-key="sig${role.key}On" type="checkbox"> ${role.label}</label><input class="cf-text-option" data-key="sig${role.key}Name" placeholder="Name (optional)" maxlength="80"><input class="cf-text-option" data-key="sig${role.key}Title" placeholder="Position / title (optional)" maxlength="80"></fieldset>`).join("")}</div>
          <p class="cf-print-note">These are the exact PDF pages that will be printed. Settings affect printing only.</p><button class="cf-final-print" type="button" disabled>Print PDF</button><button class="cf-export-excel" type="button">Export to Excel</button></aside>
          <section class="cf-preview-workspace"><div class="cf-preview-toolbar"><strong id="cfPreviewTitle"></strong><div class="cf-zoom-controls" aria-label="Preview zoom"><button type="button" data-preview-zoom="out" aria-label="Zoom out">−</button><output>Fit</output><button type="button" data-preview-zoom="in" aria-label="Zoom in">+</button><button type="button" data-preview-zoom="fit">Fit preview</button></div><div class="cf-page-controls"><button type="button" data-page-nav="previous" aria-label="Previous page">‹</button><label>Page <input data-page-number type="number" min="1" value="1"> of <span data-page-count>0</span></label><button type="button" data-page-nav="next" aria-label="Next page">›</button></div><span id="cfPdfStatus">Preparing PDF…</span><button class="cf-preview-close" type="button">Close</button></div><div class="cf-pdf-stage"><div class="cf-pdf-pages" aria-label="PDF pages"></div></div></section>`;
        document.body.append(modal);
        modal.querySelectorAll("[data-key]").forEach((control) => {
            if (!SIG_KEYS.includes(control.dataset.key)) return;
            if (control.type === "checkbox") control.checked = Boolean(state[control.dataset.key]);
            else control.value = state[control.dataset.key] || "";
        });
        modal.querySelectorAll("[data-key]").forEach((control) => control.addEventListener("input", () => {
            const key = control.dataset.key;
            state[key] = control.type === "checkbox" ? control.checked : control.type === "range" ? Number(control.value) : control.value;
            if (SIG_KEYS.includes(key)) saveSignatures();
            if (key === "marginPreset") applyMarginPreset(control.value);
            syncVisibility();
            scheduleRender();
        }));
        modal.querySelector(".cf-areas-list").addEventListener("change", (event) => {
            const id = Number(event.target?.dataset?.area);
            if (!Number.isInteger(id)) return;
            if (event.target.checked) areaOff.delete(id); else areaOff.add(id);
            areasChanged();
        });
        modal.querySelectorAll("[data-areas]").forEach((button) => button.addEventListener("click", () => {
            areaOff.clear();
            if (button.dataset.areas === "none") areaBlocks.forEach((block) => areaOff.add(block.id));
            modal.querySelectorAll("[data-area]").forEach((input) => { input.checked = !areaOff.has(Number(input.dataset.area)); });
            areasChanged();
        }));
        modal.querySelectorAll("[data-margin]").forEach((input) => {
            input.addEventListener("input", () => {
                const value = input.value.trim();
                if (!/^\d{0,2}(?:\.\d{0,2})?$/.test(value)) {
                    input.value = input.dataset.previous || "";
                    return;
                }
                input.dataset.previous = value;
                if (value === "" || value.endsWith(".")) return;
                const number = Number(value);
                if (!Number.isFinite(number) || number > 50) return;
                state.margins[input.dataset.margin] = number;
                state.marginPreset = "custom";
                modal.querySelector('[data-key="marginPreset"]').value = "custom";
                scheduleRender();
            });
            input.addEventListener("blur", () => {
                const number = Math.max(0, Math.min(50, Number.parseFloat(input.value) || 0));
                state.margins[input.dataset.margin] = number;
                input.value = String(number);
                input.dataset.previous = input.value;
                scheduleRender();
            });
        });
        modal.querySelectorAll(".cf-print-back,.cf-preview-close").forEach((button) => button.addEventListener("click", close));
        modal.querySelectorAll("[data-preview-zoom]").forEach((button) => button.addEventListener("click", () => {
            if (button.dataset.previewZoom === "fit") previewZoom = "page-fit";
            else {
                const current = typeof previewZoom === "number" ? previewZoom : 100;
                previewZoom = Math.max(25, Math.min(200, current + (button.dataset.previewZoom === "in" ? 25 : -25)));
            }
            applyPreviewZoom();
        }));
        modal.querySelectorAll("[data-page-nav]").forEach((button) => button.addEventListener("click", () => {
            goToPage(currentPage + (button.dataset.pageNav === "next" ? 1 : -1));
        }));
        modal.querySelector("[data-page-number]").addEventListener("change", (event) => goToPage(Number(event.target.value)));
        modal.querySelector(".cf-pdf-stage").addEventListener("scroll", updateCurrentPage, { passive: true });
        modal.querySelector(".cf-export-excel").addEventListener("click", exportExcel);
        modal.querySelector(".cf-final-print").addEventListener("click", async () => {
            if (!lastPdf) return;
            const button = modal.querySelector(".cf-final-print");
            button.disabled = true;
            try {
                const result = await rpc("cashbook-print-pdf", lastPdf);
                modal.querySelector("#cfPdfStatus").textContent = result?.cancelled ? "Printing canceled. The PDF preview is still available." : "Print job sent to the printer.";
            } catch (error) { modal.querySelector("#cfPdfStatus").textContent = error.message; }
            finally { button.disabled = false; }
        });
    }

    function applyMarginPreset(preset) {
        const values = { normal: 12.7, narrow: 6.35, wide: 25.4 };
        if (values[preset] !== undefined) state.margins = { top: values[preset], right: values[preset], bottom: values[preset], left: values[preset] };
        modal.querySelectorAll("[data-margin]").forEach((input) => {
            input.value = state.margins[input.dataset.margin];
            input.dataset.previous = input.value;
        });
    }

    function pdfBytes(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        return bytes;
    }

    async function loadPdfPreview(base64, version) {
        if (!window.pdfjsLib) throw new Error("The PDF preview renderer could not be loaded.");
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("../assets/vendor/pdf.worker.min.js", previewScriptUrl).href;
        const oldDocument = previewDocument;
        previewDocument = null;
        if (oldDocument) await oldDocument.destroy().catch(() => {});
        const loadedDocument = await window.pdfjsLib.getDocument({ data: pdfBytes(base64) }).promise;
        if (version !== renderVersion || modal.hidden) {
            await loadedDocument.destroy().catch(() => {});
            return false;
        }
        previewDocument = loadedDocument;
        currentPage = 1;
        modal.querySelector("[data-page-count]").textContent = String(loadedDocument.numPages);
        modal.querySelector("[data-page-number]").max = String(loadedDocument.numPages);
        modal.querySelector("[data-page-number]").value = "1";
        await renderPreviewPages();
        return true;
    }

    async function renderPreviewPages() {
        if (!previewDocument || modal.hidden) return;
        const version = ++previewRenderVersion;
        const pages = modal.querySelector(".cf-pdf-pages");
        const stage = modal.querySelector(".cf-pdf-stage");
        pages.innerHTML = '<div class="cf-pdf-loading">Drawing PDF pages…</div>';
        const firstPage = await previewDocument.getPage(1);
        const unscaled = firstPage.getViewport({ scale: 1 });
        const availableWidth = Math.max(180, stage.clientWidth - 56);
        const scale = previewZoom === "page-fit"
            ? Math.max(0.25, Math.min(1.75, availableWidth / unscaled.width))
            : previewZoom / 100;
        if (version !== previewRenderVersion) return;
        pages.textContent = "";
        const outputScale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
        for (let pageNumber = 1; pageNumber <= previewDocument.numPages; pageNumber += 1) {
            if (version !== previewRenderVersion || modal.hidden) return;
            const page = pageNumber === 1 ? firstPage : await previewDocument.getPage(pageNumber);
            const viewport = page.getViewport({ scale });
            const wrapper = document.createElement("article");
            wrapper.className = "cf-pdf-page";
            wrapper.dataset.page = String(pageNumber);
            const canvas = document.createElement("canvas");
            canvas.setAttribute("aria-label", `PDF page ${pageNumber}`);
            canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
            canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
            canvas.style.width = `${Math.floor(viewport.width)}px`;
            canvas.style.height = `${Math.floor(viewport.height)}px`;
            wrapper.append(canvas);
            const label = document.createElement("span");
            label.className = "cf-pdf-page-label";
            label.textContent = `Page ${pageNumber}`;
            wrapper.append(label);
            pages.append(wrapper);
            await page.render({
                canvasContext: canvas.getContext("2d", { alpha: false }),
                viewport,
                transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
            }).promise;
        }
        updateCurrentPage();
    }

    function applyPreviewZoom() {
        modal.querySelector(".cf-zoom-controls output").textContent = previewZoom === "page-fit" ? "Fit" : `${previewZoom}%`;
        clearTimeout(previewRenderTimer);
        if (previewDocument) previewRenderTimer = setTimeout(() => renderPreviewPages().catch(showPreviewError), 80);
    }

    function goToPage(requestedPage) {
        if (!previewDocument) return;
        const pageNumber = Math.max(1, Math.min(previewDocument.numPages, Number.isFinite(requestedPage) ? requestedPage : 1));
        const page = modal.querySelector(`.cf-pdf-page[data-page="${pageNumber}"]`);
        if (page) page.scrollIntoView({ behavior: "smooth", block: "start" });
        currentPage = pageNumber;
        modal.querySelector("[data-page-number]").value = String(pageNumber);
    }

    function updateCurrentPage() {
        const stage = modal?.querySelector(".cf-pdf-stage");
        if (!stage || !previewDocument) return;
        const stageTop = stage.getBoundingClientRect().top;
        let nearest = currentPage;
        let distance = Infinity;
        modal.querySelectorAll(".cf-pdf-page").forEach((page) => {
            const difference = Math.abs(page.getBoundingClientRect().top - stageTop - 8);
            if (difference < distance) { distance = difference; nearest = Number(page.dataset.page); }
        });
        currentPage = nearest;
        modal.querySelector("[data-page-number]").value = String(nearest);
        modal.querySelector('[data-page-nav="previous"]').disabled = nearest <= 1;
        modal.querySelector('[data-page-nav="next"]').disabled = nearest >= previewDocument.numPages;
    }

    function showPreviewError(error) {
        if (modal) modal.querySelector("#cfPdfStatus").textContent = error?.message || "The PDF preview could not be displayed.";
    }

    function syncVisibility() {
        modal.querySelector(".cf-custom-margins").hidden = state.marginPreset !== "custom";
        modal.querySelector(".cf-scale-row").hidden = state.scaleMode !== "custom";
        modal.querySelector(".cf-scale-row output").textContent = `${state.scale}%`;
        modal.querySelector('[data-key="headerText"]').hidden = !state.header;
        modal.querySelector('[data-key="footerText"]').hidden = !state.footer;
        modal.querySelector(".cf-sign-options").hidden = !state.signatures;
    }

    function scheduleRender() {
        clearTimeout(renderTimer);
        renderTimer = setTimeout(renderPdf, 180);
    }

    async function renderPdf() {
        const version = ++renderVersion;
        const status = modal.querySelector("#cfPdfStatus");
        const printButton = modal.querySelector(".cf-final-print");
        status.textContent = "Generating PDF…";
        printButton.disabled = true;
        const paper = PAPER[state.paper];
        const landscape = state.orientation === "landscape";
        try {
            const pdfResult = await rpc("cashbook-render-print-pdf", {
                html: sourceSnapshot.html + signatureHtml(), title: title(), styles: stylesheetText(),
                pageWidth: landscape ? paper.height : paper.width,
                pageHeight: landscape ? paper.width : paper.height,
                margins: state.margins, scaleMode: state.scaleMode, scale: state.scale,
                sourceWidth: sourceSnapshot.width, sourceHeight: sourceSnapshot.height + signatureExtraHeight(),
                header: state.header, footer: state.footer,
                headerText: state.headerText || title(), footerText: state.footerText,
            });
            if (version !== renderVersion || modal.hidden) return;
            const pdf = typeof pdfResult === "string" ? pdfResult : pdfResult?.base64;
            if (!pdf) throw new Error("The desktop print service returned an empty PDF.");
            lastPdf = pdf;
            const loaded = await loadPdfPreview(pdf, version);
            if (!loaded || version !== renderVersion) return;
            const areaNote = areasUsable() && areaOff.size ? ` · ${areaBlocks.length - areaOff.size} of ${areaBlocks.length} areas` : "";
            status.textContent = `${paper.label} · ${state.orientation}${areaNote} · ${previewDocument.numPages} page${previewDocument.numPages === 1 ? "" : "s"} · PDF ready`;
            printButton.disabled = false;
        } catch (error) {
            if (version !== renderVersion) return;
            lastPdf = "";
            status.textContent = error.message || "PDF generation failed.";
        }
    }

    function open() {
        if (!modal) build();
        areaOff.clear();
        const printSource = (typeof window.CashbookPrintTarget === "function" && window.CashbookPrintTarget()) || document.querySelector("main") || document.body;
        areaBlocks = detectBlocks(printSource);
        renderAreaList();
        sourceSnapshot = capture();
        if (typeof window.CashbookPrintTarget === "function" && window.CashbookPrintTarget()) state.headerText = title(); else state.headerText ||= title();
        modal.querySelector("#cfPreviewTitle").textContent = title();
        modal.querySelector('[data-key="headerText"]').value = state.headerText;
        applyMarginPreset(state.marginPreset);
        syncVisibility();
        modal.hidden = false;
        document.documentElement.classList.add("cf-preview-open");
        renderPdf();
    }

    async function close() {
        if (!modal) return;
        modal.hidden = true;
        renderVersion += 1;
        previewRenderVersion += 1;
        lastPdf = "";
        modal.querySelector(".cf-pdf-pages").textContent = "";
        modal.querySelector("[data-page-count]").textContent = "0";
        const oldDocument = previewDocument;
        previewDocument = null;
        if (oldDocument) await oldDocument.destroy().catch(() => {});
        document.documentElement.classList.remove("cf-preview-open");
    }

    window.print = open;
    window.CashbookPrintPreviewV3 = { open, close, nativePrint };
    window.CashbookPrintPreview = window.CashbookPrintPreviewV3;
})();
