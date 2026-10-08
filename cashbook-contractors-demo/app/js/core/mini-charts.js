"use strict";
// Small canvas charts (line, bars, donut) in the same hand-drawn style as the app's other charts.
// Each draw function takes a canvas and a plain spec; nothing else is needed. They follow the light/dark
// theme, size themselves to the canvas's on-screen width, and show a hover tooltip when run in a browser.
(function (root) {
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const FONT = "12px 'Segoe UI', system-ui, -apple-system, sans-serif";
    const isDark = () => typeof document !== "undefined" && document.documentElement.dataset.theme === "dark";
    const palette = () => (isDark()
        ? { text: "#c4cbd2", grid: "#3a4148", axis: "#59636d", bg: "#1d2227", today: "#e3ac6d" }
        : { text: "#66717d", grid: "#e3e7eb", axis: "#b9c0c7", bg: "#ffffff", today: "#c97a2b" });
    const COLORS = { blue: "#1f4e79", blueDark: "#58a6dc", orange: "#c97a2b", orangeDark: "#f0a35a", green: "#2f9e63", red: "#d9534f", teal: "#2f8f8a", grey: "#8a8f98", amber: "#b7791f" };

    function monthLabel(iso) { return `${MONTHS[Number(iso.slice(5, 7)) - 1] || ""} ${iso.slice(2, 4)}`; }
    function money(n, withSign) {
        const a = Math.abs(n), sign = n < 0 ? "-" : withSign ? "+" : "";
        const f = (v, u) => `${sign}\u20B1${(Math.round(v * 10) / 10).toString().replace(/\.0$/, "")}${u}`;
        return a >= 1e9 ? f(a / 1e9, "B") : a >= 1e6 ? f(a / 1e6, "M") : a >= 1e3 ? f(a / 1e3, "K") : f(a, "");
    }
    const percent = (n) => `${Math.round(n * 10) / 10}%`;

    // A "nice" upper bound and step for the value axis.
    function niceScale(max, ticks) {
        if (!(max > 0)) return { max: 1, step: 0.25 };
        const raw = max / (ticks || 5), mag = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / mag;
        const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
        return { max: Math.ceil(max / step) * step, step };
    }

    // Size the canvas backing store to its on-screen box (crisp on high-DPI screens).
    function fit(canvas, fallbackW, fallbackH) {
        const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
        const cssW = (canvas.clientWidth || fallbackW || 600), cssH = (canvas.clientHeight && canvas.clientHeight > 40 ? canvas.clientHeight : fallbackH || 280);
        if (canvas.style && !canvas.style.height) canvas.style.height = `${cssH}px`;
        canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cssW, cssH);
        ctx.font = FONT;
        return { ctx, w: cssW, h: cssH };
    }

    function emptyMessage(ctx, w, h, text, pal) {
        ctx.fillStyle = pal.text; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(text || "Nothing to show yet", w / 2, h / 2); ctx.textAlign = "left";
    }

    // ---- tooltip (browser only) ---------------------------------------------------------------
    function setHits(canvas, hits, formatter) {
        canvas._cbcHits = hits; canvas._cbcFormat = formatter;
        if (canvas._cbcBound || typeof document === "undefined" || !canvas.addEventListener) return;
        canvas._cbcBound = true;
        const tip = document.createElement("div");
        tip.className = "cbc-chart-tip"; tip.hidden = true;
        (canvas.parentNode || document.body).appendChild(tip);
        canvas.addEventListener("mouseleave", () => { tip.hidden = true; });
        canvas.addEventListener("mousemove", (e) => {
            const rect = canvas.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
            const hit = (canvas._cbcHits || []).filter((h) => x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1)[0];
            if (!hit) { tip.hidden = true; return; }
            tip.innerHTML = canvas._cbcFormat(hit);
            tip.hidden = false;
            const box = canvas.parentNode.getBoundingClientRect();
            tip.style.left = `${Math.min(rect.left - box.left + x + 14, box.width - tip.offsetWidth - 4)}px`;
            tip.style.top = `${Math.max(rect.top - box.top + y - tip.offsetHeight - 10, 0)}px`;
        });
    }
    const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    // ---- line chart ------------------------------------------------------------------------------
    // spec: { labels: ["2026-06-30", ...] (dates) or text, series: [{ name, color, values, dashed, fill, markers }],
    //         yFormat, yMax, todayIndex, emptyText, height }
    function line(canvas, spec) {
        const { ctx, w, h } = fit(canvas, 700, spec.height || 300);
        const pal = palette(), yFormat = spec.yFormat || String, labels = spec.labels || [];
        const series = (spec.series || []).filter((s) => (s.values || []).some((v) => v !== null && v !== undefined));
        if (!labels.length || !series.length) { emptyMessage(ctx, w, h, spec.emptyText, pal); setHits(canvas, [], () => ""); return; }
        const all = series.flatMap((s) => s.values).filter((v) => v !== null && v !== undefined);
        const scale = niceScale(Math.max(spec.yMax || 0, ...all), 5);
        const yMin = spec.yMin || 0;
        const text = (l) => (String(l).length === 10 ? monthLabel(l) : String(l));
        const labelW = Math.max(...labels.map((l) => ctx.measureText(text(l)).width)) + 14;
        const left = Math.max(44, ...[0, scale.max].map((v) => ctx.measureText(yFormat(v)).width + 14)), right = Math.max(14, Math.ceil(labelW / 2)), top = 12, bottom = 28;
        const pw = w - left - right, ph = h - top - bottom;
        const xAt = (i) => left + (labels.length === 1 ? pw / 2 : (i / (labels.length - 1)) * pw);
        // "Today" sits between month ticks: spec.todayPos is a fractional index, and series flagged atToday end/start there.
        const hasPos = Number.isFinite(spec.todayPos) && spec.todayIndex >= 0;
        const xFor = (i, s) => (hasPos && s && s.atToday && i === spec.todayIndex ? xAt(spec.todayPos) : xAt(i));
        const yAt = (v) => top + ph - ((v - yMin) / (scale.max - yMin)) * ph;
        ctx.lineWidth = 1; ctx.strokeStyle = pal.grid; ctx.fillStyle = pal.text; ctx.textAlign = "right"; ctx.textBaseline = "middle";
        for (let v = yMin; v <= scale.max + 1e-9; v += scale.step) {
            const y = Math.round(yAt(v)) + 0.5;
            ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - right, y); ctx.stroke();
            ctx.fillText(yFormat(v), left - 6, y);
        }
        ctx.textAlign = "center"; ctx.textBaseline = "top";
        const every = Math.max(1, Math.ceil(labelW / (pw / Math.max(labels.length - 1, 1))));
        labels.forEach((l, i) => { if (i % every === 0) ctx.fillText(text(l), xAt(i), h - bottom + 8); });
        ctx.strokeStyle = pal.axis; ctx.beginPath(); ctx.moveTo(left, top + ph + 0.5); ctx.lineTo(w - right, top + ph + 0.5); ctx.stroke();

        if (spec.todayIndex >= 0 && spec.todayIndex < labels.length) {
            const x = hasPos ? xAt(spec.todayPos) : xAt(spec.todayIndex);
            ctx.save(); ctx.setLineDash([2, 4]); ctx.strokeStyle = pal.today; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + ph); ctx.stroke(); ctx.restore();
            ctx.fillStyle = pal.today; ctx.textAlign = x > w - 50 ? "right" : "left"; ctx.textBaseline = "top"; ctx.fillText("Today", x + (x > w - 50 ? -4 : 4), top + 2);
        }
        series.forEach((s) => {
            const pts = s.values.map((v, i) => (v === null || v === undefined ? null : { x: xFor(i, s), y: yAt(v) }));
            if (s.fill) {
                ctx.fillStyle = s.fill;
                let run = [];
                const flush = () => { if (run.length > 1) { ctx.beginPath(); ctx.moveTo(run[0].x, yAt(yMin)); run.forEach((p) => ctx.lineTo(p.x, p.y)); ctx.lineTo(run[run.length - 1].x, yAt(yMin)); ctx.closePath(); ctx.fill(); } run = []; };
                pts.forEach((p) => (p ? run.push(p) : flush())); flush();
            }
            ctx.save(); ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2.5; ctx.lineJoin = "round"; ctx.setLineDash(s.dashed ? [6, 5] : []);
            let pen = false; ctx.beginPath();
            pts.forEach((p) => { if (!p) { pen = false; return; } if (!pen) { ctx.moveTo(p.x, p.y); pen = true; } else ctx.lineTo(p.x, p.y); });
            ctx.stroke(); ctx.restore();
            if (s.markers !== false) pts.forEach((p) => { if (!p) return; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fillStyle = pal.bg; ctx.fill(); ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.stroke(); });
        });
        const step = labels.length === 1 ? pw : pw / (labels.length - 1);
        setHits(canvas, labels.map((l, i) => ({ x0: xAt(i) - step / 2, x1: xAt(i) + step / 2, y0: top, y1: top + ph, i })), (hit) => {
            const rows = series.map((s) => (s.values[hit.i] === null || s.values[hit.i] === undefined ? "" : `<div><i style="background:${s.color}"></i>${esc(s.name)}: <b>${esc(yFormat(s.values[hit.i]))}</b></div>`)).join("");
            return `<strong>${esc(text(labels[hit.i]))}</strong>${rows}`;
        });
    }

    // ---- bar chart ----------------------------------------------------------------------------------
    // spec: { labels: [...], series: [{ name, color, values }], yFormat, yMax, emptyText, height, valueLabels }
    function bars(canvas, spec) {
        const { ctx, w, h } = fit(canvas, 600, spec.height || 280);
        const pal = palette(), yFormat = spec.yFormat || String, labels = spec.labels || [], series = spec.series || [];
        if (!labels.length || !series.length) { emptyMessage(ctx, w, h, spec.emptyText, pal); setHits(canvas, [], () => ""); return; }
        const all = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
        const scale = niceScale(Math.max(spec.yMax || 0, ...all, 0), 5);
        const leftBase = Math.max(44, ...[0, scale.max].map((v) => ctx.measureText(yFormat(v)).width + 14)), right = 10, top = spec.valueLabels ? 22 : 14;
        // Narrow bars: tilt the names so they stay readable instead of cutting them to a few letters.
        const slot0 = (w - leftBase - right) / labels.length;
        const tilt = slot0 < 80 && labels.some((l) => String(l).length > Math.max(4, Math.floor(slot0 / 6.5)));
        const bottom = tilt ? 94 : 34, left = tilt ? Math.max(leftBase, 100) : leftBase;   // tilted names run down and to the left
        const pw = w - left - right, ph = h - top - bottom, slot = pw / labels.length;
        ctx.lineWidth = 1; ctx.strokeStyle = pal.grid; ctx.fillStyle = pal.text; ctx.textAlign = "right"; ctx.textBaseline = "middle";
        for (let v = 0; v <= scale.max + 1e-9; v += scale.step) {
            const y = Math.round(top + ph - (v / scale.max) * ph) + 0.5;
            ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - right, y); ctx.stroke(); ctx.fillText(yFormat(v), left - 6, y);
        }
        const group = Math.min(slot * 0.78, 28 * series.length + 8), bw = group / series.length - (series.length > 1 ? 3 : 0);
        ctx.textAlign = "center"; ctx.textBaseline = "top";
        labels.forEach((l, i) => {
            const cx = left + slot * i + slot / 2;
            series.forEach((s, k) => {
                const v = s.values[i]; if (!Number.isFinite(v) || v <= 0) return;
                const bh = Math.max(1, (v / scale.max) * ph), x = cx - group / 2 + k * (group / series.length) + 1.5, y = top + ph - bh;
                ctx.fillStyle = s.color; ctx.beginPath();
                const r = Math.min(4, bw / 2); ctx.moveTo(x, y + bh); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.lineTo(x + bw - r, y); ctx.quadraticCurveTo(x + bw, y, x + bw, y + r); ctx.lineTo(x + bw, y + bh); ctx.closePath(); ctx.fill();
                if (spec.valueLabels && bw >= 14) { ctx.fillStyle = pal.text; ctx.font = "11px 'Segoe UI', system-ui, sans-serif"; ctx.textBaseline = "bottom"; ctx.fillText(yFormat(v), x + bw / 2, y - 2); ctx.textBaseline = "top"; ctx.font = FONT; }
            });
            ctx.fillStyle = pal.text;
            if (tilt) {
                const t = String(l).length > 18 ? `${String(l).slice(0, 17)}\u2026` : String(l);
                ctx.save(); ctx.translate(cx + 4, h - bottom + 8); ctx.rotate(-Math.PI / 4); ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillText(t, 0, 0); ctx.restore();
                ctx.textAlign = "center"; ctx.textBaseline = "top";
            } else {
                const maxChars = Math.max(4, Math.floor(slot / 6.5)), t = String(l).length > maxChars ? `${String(l).slice(0, maxChars - 1)}\u2026` : String(l);
                ctx.fillText(t, cx, h - bottom + 8);
            }
        });
        ctx.strokeStyle = pal.axis; ctx.beginPath(); ctx.moveTo(left, top + ph + 0.5); ctx.lineTo(w - right, top + ph + 0.5); ctx.stroke();
        setHits(canvas, labels.map((l, i) => ({ x0: left + slot * i, x1: left + slot * (i + 1), y0: top, y1: top + ph, i })), (hit) =>
            `<strong>${esc(labels[hit.i])}</strong>` + series.map((s) => `<div><i style="background:${s.color}"></i>${esc(s.name)}: <b>${esc(Number.isFinite(s.values[hit.i]) ? yFormat(s.values[hit.i]) : "-")}</b></div>`).join(""));
    }

    // ---- donut ---------------------------------------------------------------------------------------------
    // spec: { slices: [{ label, value, color }], centerLabel, emptyText, height }
    function donut(canvas, spec) {
        const { ctx, w, h } = fit(canvas, 260, spec.height || 240);
        const pal = palette(), slices = (spec.slices || []).filter((s) => s.value > 0), total = slices.reduce((s, x) => s + x.value, 0);
        if (!total) { emptyMessage(ctx, w, h, spec.emptyText, pal); setHits(canvas, [], () => ""); return; }
        const cx = w / 2, cy = h / 2, R = Math.max(20, Math.min(w, h) / 2 - 8), r = R * 0.62;
        let a = -Math.PI / 2;
        const spans = [];
        slices.forEach((s) => {
            const span = (s.value / total) * Math.PI * 2;
            ctx.beginPath(); ctx.arc(cx, cy, R, a, a + span); ctx.arc(cx, cy, r, a + span, a, true); ctx.closePath();
            ctx.fillStyle = s.color; ctx.fill(); ctx.strokeStyle = pal.bg; ctx.lineWidth = 2; ctx.stroke();
            spans.push({ from: a, to: a + span, s }); a += span;
        });
        ctx.fillStyle = pal.text; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.font = "700 24px 'Segoe UI', system-ui, sans-serif"; ctx.fillText(String(total), cx, cy - 7);
        ctx.font = "12px 'Segoe UI', system-ui, sans-serif"; ctx.fillText(spec.centerLabel || "projects", cx, cy + 14); ctx.font = FONT; ctx.textAlign = "left";
        canvas._cbcSpans = spans;
        setHits(canvas, [{ x0: 0, x1: w, y0: 0, y1: h }], () => "");
        if (canvas.addEventListener && !canvas._cbcDonutBound) {
            canvas._cbcDonutBound = true;
            canvas.addEventListener("mousemove", (e) => {
                const rect = canvas.getBoundingClientRect(), dx = e.clientX - rect.left - rect.width / 2, dy = e.clientY - rect.top - rect.height / 2;
                const dist = Math.hypot(dx, dy); let ang = Math.atan2(dy, dx); if (ang < -Math.PI / 2) ang += Math.PI * 2;
                const hit = dist >= r && dist <= R ? (canvas._cbcSpans || []).find((p) => ang >= p.from && ang <= p.to) : null;
                canvas.title = hit ? `${hit.s.label}: ${hit.s.value}` : "";
            });
        }
    }

    // Re-draw when the canvas changes width (window resize, sidebar toggle).
    function onResize(canvas, redraw) {
        if (typeof ResizeObserver === "undefined") { if (typeof window !== "undefined") window.addEventListener("resize", redraw); return; }
        let last = canvas.clientWidth, timer = 0;
        new ResizeObserver(() => { if (canvas.clientWidth === last) return; last = canvas.clientWidth; clearTimeout(timer); timer = setTimeout(redraw, 60); }).observe(canvas);
    }
    function legend(items) {
        return `<div class="cbc-chart-legend">${items.map((i) => `<span><i style="background:${i.color}${i.dashed ? ";opacity:.75" : ""}"></i>${esc(i.name)}</span>`).join("")}</div>`;
    }

    const api = { line, bars, donut, onResize, legend, money, percent, monthLabel, niceScale, COLORS, palette, isDark };
    if (typeof module !== "undefined" && module.exports) module.exports = api; else root.CbcCharts = api;
})(typeof window !== "undefined" ? window : globalThis);
