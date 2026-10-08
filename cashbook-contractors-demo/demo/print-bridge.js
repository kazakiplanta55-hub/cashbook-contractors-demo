"use strict";
// Stands in for the Electron print service. The app asks its top window for a PDF (postMessage); this builds one
// in the browser (html2canvas -> JPEG pages -> a small PDF writer) so Print Preview, page setup and the print-area
// list work exactly as in the desktop program.
(function () {
    const MM = 96 / 25.4;
    const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

    async function renderPdf(p, baseHref) {
        const W = Math.max(1, p.sourceWidth || 800), pageW = p.pageWidth * MM, pageH = p.pageHeight * MM;
        const m = p.margins, printW = pageW - (m.left + m.right) * MM, printH = pageH - (m.top + m.bottom) * MM;
        let s = p.scaleMode === "custom" ? p.scale / 100 : p.scaleMode === "actual" ? 1 : Math.min(1, printW / W);
        if (p.scaleMode === "fit-page") s = Math.min(s, printH / Math.max(1, p.sourceHeight));
        const frame = document.createElement("iframe");
        frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${W}px;height:1200px;border:0;visibility:hidden`;
        document.body.appendChild(frame);
        try {
            const appRoot = (baseHref.match(/^.*?\/app\//) || [""])[0];
            const styles = (p.styles || []).map((css) => `<style>${css.replace(/url\((["']?)\.\.\/assets\//g, `url($1${appRoot}assets/`).replace(/<\/style/gi, "<\\/style")}</style>`).join("");
            const css = `html,body{margin:0!important;padding:0!important;background:#fff!important;color:#17211d!important}.native-print-root{display:block!important;box-sizing:border-box;width:${W}px;overflow:visible!important}.native-print-root,.native-print-root *{box-shadow:none!important}.native-print-root button,.native-print-root .screen-only,.native-print-root .topbar,.native-print-root .sidebar,.native-print-root nav,.native-print-root form,.native-print-root .form-actions{display:none!important}table{border-collapse:collapse!important;width:100%!important}.table-wrap{max-height:none!important;overflow:visible!important}`;
            const doc = frame.contentDocument; doc.open();
            doc.write(`<!doctype html><html><head><meta charset="utf-8"><base href="${esc(baseHref)}">${styles}<style>${css}</style></head><body><main class="native-print-root">${p.html}</main></body></html>`);
            doc.close();
            await new Promise((r) => setTimeout(r, 60));
            try { await frame.contentDocument.fonts.ready; } catch (e) { /* ignore */ }
            await Promise.all([...doc.images].map((img) => img.complete ? 0 : new Promise((r) => { img.onload = img.onerror = r; })));
            const root = doc.querySelector(".native-print-root");
            const fullH = Math.ceil(root.scrollHeight);
            frame.style.height = fullH + "px";
            const Q = 2;
            const shot = await html2canvas(root, { scale: Q, backgroundColor: "#ffffff", width: W, height: fullH, windowWidth: W, windowHeight: fullH, logging: false, useCORS: true });
            // Prefer to break between rows/cards rather than through them.
            const rootTop = root.getBoundingClientRect().top;
            const stops = [...root.querySelectorAll("tr,article,section,.card,.summary-card,h2,h3,p,li")].map((el) => el.getBoundingClientRect().bottom - rootTop).filter((y) => y > 0).sort((a, b) => a - b);
            const slice = printH / s; const pages = []; let y = 0;
            while (y < fullH - 1) {
                let end = Math.min(fullH, y + slice);
                if (end < fullH) { const cand = stops.filter((v) => v > y + slice * 0.55 && v <= end + 0.5); if (cand.length) end = cand[cand.length - 1]; }
                pages.push([y, end]); y = end;
            }
            if (!pages.length) pages.push([0, fullH]);
            const outW = Math.round(pageW * Q), outH = Math.round(pageH * Q), jpegs = [];
            pages.forEach(([a, b], i) => {
                const c = document.createElement("canvas"); c.width = outW; c.height = outH;
                const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, outW, outH);
                const sh = Math.max(1, Math.round((b - a) * Q));
                g.drawImage(shot, 0, Math.round(a * Q), shot.width, sh, Math.round(m.left * MM * Q), Math.round(m.top * MM * Q), Math.round(W * s * Q), Math.round((b - a) * s * Q));
                g.fillStyle = "#607080"; g.font = `${9 * Q}px Arial`;
                if (p.header) { g.textAlign = "left"; g.fillText(p.headerText || p.title, m.left * MM * Q, Math.max(12, m.top * MM * 0.55) * Q); }
                if (p.footer) {
                    const fy = (pageH - Math.max(8, m.bottom * MM * 0.4)) * Q;
                    g.textAlign = "left"; g.fillText(p.footerText || "", m.left * MM * Q, fy);
                    g.textAlign = "right"; g.fillText(`Page ${i + 1} of ${pages.length}`, (pageW - m.right * MM) * Q, fy);
                }
                jpegs.push(c.toDataURL("image/jpeg", 0.92));
            });
            return buildPdf(jpegs, outW, outH, p.pageWidth / 25.4 * 72, p.pageHeight / 25.4 * 72);
        } finally { frame.remove(); }
    }

    // Minimal PDF writer: one JPEG per page.
    function buildPdf(jpegs, pxW, pxH, ptW, ptH) {
        const enc = new TextEncoder(), chunks = [], offsets = []; let len = 0;
        const push = (d) => { const b = typeof d === "string" ? enc.encode(d) : d; chunks.push(b); len += b.length; };
        const obj = (num, body) => { offsets[num] = len; push(`${num} 0 obj\n`); push(body); push("\nendobj\n"); };
        const bytesOf = (url) => { const bin = atob(url.split(",")[1]); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
        push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
        const n = jpegs.length, kids = [];
        for (let i = 0; i < n; i++) kids.push(`${3 + i * 3} 0 R`);
        obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
        obj(2, `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${n} >>`);
        jpegs.forEach((url, i) => {
            const pg = 3 + i * 3, ct = pg + 1, im = pg + 2, data = bytesOf(url);
            obj(pg, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW.toFixed(2)} ${ptH.toFixed(2)}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${ct} 0 R >>`);
            const stream = `q ${ptW.toFixed(2)} 0 0 ${ptH.toFixed(2)} 0 0 cm /Im0 Do Q`;
            obj(ct, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
            offsets[im] = len; push(`${im} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pxW} /Height ${pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${data.length} >>\nstream\n`); push(data); push("\nendstream\nendobj\n");
        });
        const total = 3 + n * 3, xref = len;
        push(`xref\n0 ${total}\n0000000000 65535 f \n`);
        for (let i = 1; i < total; i++) push(String(offsets[i]).padStart(10, "0") + " 00000 n \n");
        push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
        const all = new Uint8Array(len); let o = 0; chunks.forEach((c) => { all.set(c, o); o += c.length; });
        let bin = ""; for (let i = 0; i < all.length; i += 0x8000) bin += String.fromCharCode.apply(null, all.subarray(i, i + 0x8000));
        return btoa(bin);
    }

    window.addEventListener("message", async (event) => {
        const d = event.data || {};
        if (d.type === "cashbook-render-print-pdf") {
            let base = "";
            try { base = event.source.location.href; } catch (e) { base = location.href; }
            try { event.source.postMessage({ type: "cashbook-render-print-pdf-result", requestId: d.requestId, pdf: await renderPdf(d.payload, base) }, "*"); }
            catch (error) { event.source.postMessage({ type: "cashbook-render-print-pdf-result", requestId: d.requestId, error: "Could not build the PDF preview: " + error.message }, "*"); }
        } else if (d.type === "cashbook-print-pdf") {
            try {
                const bin = atob(d.pdf), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
                const url = URL.createObjectURL(new Blob([u], { type: "application/pdf" }));
                const w = window.open(url, "_blank");
                if (!w) { const a = document.createElement("a"); a.href = url; a.download = "Cashbook-Contractors-Demo.pdf"; a.click(); }
                event.source.postMessage({ type: "cashbook-print-pdf-result", requestId: d.requestId, result: { printed: true, cancelled: false } }, "*");
            } catch (error) { event.source.postMessage({ type: "cashbook-print-pdf-result", requestId: d.requestId, error: error.message }, "*"); }
        }
    });
})();
