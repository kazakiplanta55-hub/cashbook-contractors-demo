"use strict";
// Minimal .xlsx writer (no library): sheets of text/number cells, rich styles (fills, borders, number formats), merges,
// column widths, frozen panes, filter, print setup (header/footer, print titles) and document properties.
// An .xlsx file is a ZIP of XML parts; the parts are stored uncompressed, which Excel and LibreOffice open normally.
(function (root) {
    const enc = new TextEncoder();
    const xml = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
    const colName = (i) => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

    // ---- ZIP (stored) ----
    const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
    function crc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
    function zip(files) {
        const parts = [], central = [];
        let offset = 0;
        const u16 = (v) => [v & 255, (v >>> 8) & 255], u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
        files.forEach(({ name, data }) => {
            const nameBytes = enc.encode(name), crc = crc32(data), size = data.length;
            const header = Uint8Array.from([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(size), ...u32(size), ...u16(nameBytes.length), ...u16(0)]);
            parts.push(header, nameBytes, data);
            central.push(Uint8Array.from([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(size), ...u32(size), ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), nameBytes);
            offset += header.length + nameBytes.length + size;
        });
        const centralSize = central.reduce((n, p) => n + p.length, 0);
        const end = Uint8Array.from([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(centralSize), ...u32(offset), ...u16(0)]);
        return new Blob([...parts, ...central, end], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    }

    // ---- Styles ---------------------------------------------------------------------------------
    // Styles are described as small objects and registered on demand, so a sheet can ask for any mix of font, fill,
    // border, number format and alignment. The first five registered are the original named styles (ids 0 to 4).
    const COLOR = { navy: "FF1F4E79", dark: "FF0B2E4F", line: "FFBFC9D3", tint: "FFEAF1F8", band: "FFD6E4F0", zebra: "FFF5F8FB", white: "FFFFFFFF", text: "FF1B2733", muted: "FF5B6877", soft: "FFDCE6F1" };
    const TONE = { good: { fill: "FFE2F3E8", color: "FF1E6B3C" }, warn: { fill: "FFFFF1D6", color: "FF8A5A00" }, bad: { fill: "FFFBE0E0", color: "FFA32121" } };
    const FMT = { money: '"\u20B1"#,##0.00;[Red]\\-"\u20B1"#,##0.00', int: "#,##0;[Red]\\-#,##0", plain: "0", dec: "#,##0.00;[Red]\\-#,##0.00", pct: "0.0%;[Red]\\-0.0%" };
    const SPEC = {
        normal: () => ({ border: "thin", v: "top", wrap: 1 }),
        header: () => ({ b: 1, color: COLOR.white, fill: COLOR.navy, border: "thin", h: "center", v: "center", wrap: 1 }),
        title: () => ({ b: 1, sz: 16, color: COLOR.navy }),
        label: () => ({ b: 1, fill: COLOR.tint, border: "thin", v: "top", wrap: 1 }),
        section: () => ({ b: 1, fill: COLOR.band, border: "thin", v: "center" }),
        banner: () => ({ b: 1, sz: 20, color: COLOR.white, fill: COLOR.dark, h: "left", v: "center", indent: 1 }),
        bannerSub: () => ({ sz: 11, color: COLOR.soft, fill: COLOR.navy, h: "left", v: "center", indent: 1 }),
        reportTitle: () => ({ b: 1, sz: 15, color: COLOR.navy, v: "center" }),
        meta: () => ({ sz: 9, color: COLOR.muted, v: "center", border: "bottom", wrap: 1 }),
        note: () => ({ i: 1, sz: 9, color: COLOR.muted, v: "top", wrap: 1 }),
        sectionBand: () => ({ b: 1, sz: 12, color: COLOR.white, fill: COLOR.navy, border: "thin", v: "center", indent: 1 }),
        // Table body cell. fmt: text | center | money | int | plain | dec | pct. tone: good | warn | bad (status colours).
        body: (o) => {
            const t = o.tone ? TONE[o.tone] : null, numeric = ["money", "int", "plain", "dec", "pct"].includes(o.fmt);
            return { border: o.total ? "total" : "thin", b: o.total || t ? 1 : 0, color: t ? t.color : COLOR.text,
                fill: t ? t.fill : o.total ? COLOR.band : o.alt ? COLOR.zebra : null,
                fmt: numeric ? FMT[o.fmt] : null, h: t || o.fmt === "center" ? "center" : numeric ? "right" : "left", v: "center", wrap: 1 };
        },
        kpiLabel: () => ({ b: 1, sz: 10, color: COLOR.muted, fill: COLOR.tint, border: "thin", v: "center", wrap: 1, indent: 1 }),
        kpiValue: (o) => {
            const t = o.tone ? TONE[o.tone] : null, numeric = ["money", "int", "plain", "dec", "pct"].includes(o.fmt);
            return { b: 1, sz: 13, color: t ? t.color : COLOR.navy, fill: t ? t.fill : null, border: "thin", fmt: numeric ? FMT[o.fmt] : null, h: numeric ? "right" : "center", v: "center", wrap: 1, indent: numeric ? 1 : 0 };
        },
        kpiNote: () => ({ i: 1, sz: 9, color: COLOR.muted, border: "thin", v: "center", wrap: 1, indent: 1 }),
        sigRole: () => ({ b: 1, sz: 10, color: COLOR.navy, fill: COLOR.tint, border: "thin", h: "left", v: "center", indent: 1 }),
        sigBox: (o) => ({ b: o.bold ? 1 : 0, sz: 10, color: COLOR.text, border: "thin", h: "center", v: o.bottom ? "bottom" : "center", wrap: 1 }),
    };

    function createRegistry() {
        const fonts = [], fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'], borders = [], fmts = [], xfs = [], seen = new Map();
        const side = (name, style, color) => `<${name} style="${style}"><color rgb="${color}"/></${name}>`;
        const BORDER = {
            none: '<border><left/><right/><top/><bottom/><diagonal/></border>',
            thin: `<border>${side("left", "thin", COLOR.line)}${side("right", "thin", COLOR.line)}${side("top", "thin", COLOR.line)}${side("bottom", "thin", COLOR.line)}<diagonal/></border>`,
            total: `<border>${side("left", "thin", COLOR.line)}${side("right", "thin", COLOR.line)}${side("top", "medium", COLOR.navy)}${side("bottom", "thin", COLOR.navy)}<diagonal/></border>`,
            bottom: `<border><left/><right/><top/>${side("bottom", "thin", COLOR.navy)}<diagonal/></border>`,
        };
        const idOf = (list, item) => { let i = list.indexOf(item); if (i < 0) { list.push(item); i = list.length - 1; } return i; };
        idOf(borders, BORDER.none);
        function xf(spec) {
            const key = JSON.stringify(spec);
            if (seen.has(key)) return seen.get(key);
            const font = `<font>${spec.b ? "<b/>" : ""}${spec.i ? "<i/>" : ""}<sz val="${spec.sz || 11}"/><color rgb="${spec.color || COLOR.text}"/><name val="Calibri"/></font>`;
            const fontId = idOf(fonts, font);
            const fillId = spec.fill ? idOf(fills, `<fill><patternFill patternType="solid"><fgColor rgb="${spec.fill}"/></patternFill></fill>`) : 0;
            const borderId = idOf(borders, BORDER[spec.border || "none"]);
            const fmtId = spec.fmt ? 164 + idOf(fmts, spec.fmt) : 0;
            const align = `<alignment${spec.h ? ` horizontal="${spec.h}"` : ""} vertical="${spec.v || "top"}"${spec.wrap ? ' wrapText="1"' : ""}${spec.indent ? ` indent="${spec.indent}"` : ""}/>`;
            xfs.push(`<xf numFmtId="${fmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${align}</xf>`);
            seen.set(key, xfs.length - 1);
            return xfs.length - 1;
        }
        // The original five named styles keep ids 0 to 4.
        ["normal", "header", "title", "label", "section"].forEach((name) => xf(SPEC[name]()));
        function stylesXml() {
            return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
                (fmts.length ? `<numFmts count="${fmts.length}">${fmts.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${xml(f)}"/>`).join("")}</numFmts>` : "") +
                `<fonts count="${fonts.length}">${fonts.join("")}</fonts><fills count="${fills.length}">${fills.join("")}</fills><borders count="${borders.length}">${borders.join("")}</borders>` +
                `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>` +
                `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
        }
        return { xf, stylesXml };
    }
    const STYLE = { normal: 0, header: 1, title: 2, label: 3, section: 4 };

    // sheet: { name, widths:[chars], rows:[[cell,...]], header:true (first row is a table header: frozen + filter) }
    // cell: string | number | { v, s: "header"|"title"|"label"|"section"|"normal" }
    const printText = (t) => String(t ?? "").replace(/&/g, "&&");
    function sheetXml(sheet, reg) {
        const rows = sheet.rows.map((cells, r) => {
            const tag = cells.map((cell, c) => {
                const obj = cell !== null && typeof cell === "object" ? cell : { v: cell };
                const style = obj.st ? reg.xf(obj.st) : (STYLE[obj.s] ?? (sheet.header && r === 0 ? 1 : 0));
                const ref = colName(c) + (r + 1);
                if (obj.v === "" || obj.v == null) return `<c r="${ref}" s="${style}"/>`;
                if (typeof obj.v === "number" && Number.isFinite(obj.v)) return `<c r="${ref}" s="${style}"><v>${obj.v}</v></c>`;
                return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(obj.v)}</t></is></c>`;
            }).join("");
            const height = sheet.rowHeights && sheet.rowHeights[r] ? sheet.rowHeights[r] : (sheet.header && r === 0 ? 30 : 0);
            return `<row r="${r + 1}"${height ? ` ht="${height}" customHeight="1"` : ""}>${tag}</row>`;
        }).join("");
        const widths = (sheet.widths || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
        const cols = sheet.widths && sheet.widths.length ? `<cols>${widths}</cols>` : "";
        const lastCol = colName(Math.max(1, ...sheet.rows.map((r) => r.length)) - 1);
        const grid = sheet.hideGrid ? ' showGridLines="0"' : "";
        const freeze = sheet.freezeRows || (sheet.header ? 1 : 0);
        const view = freeze ? `<sheetViews><sheetView workbookViewId="0"${grid}><pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : `<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>`;
        const filterRef = sheet.filterRef || (sheet.header && sheet.rows.length > 1 ? `A1:${lastCol}${sheet.rows.length}` : "");
        const filter = filterRef ? `<autoFilter ref="${filterRef}"/>` : "";
        const merges = (sheet.merges || []).length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "";
        const setup = `<printOptions horizontalCentered="1"/><pageMargins left="0.5" right="0.5" top="0.75" bottom="0.7" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="${sheet.landscape ? "landscape" : "portrait"}" fitToWidth="1" fitToHeight="0"/>`;
        const hf = sheet.headerFooter
            ? `<headerFooter><oddHeader>${xml(`&L&"Calibri,Bold"&10${printText(sheet.headerFooter.hl)}&R&10${printText(sheet.headerFooter.hr)}`)}</oddHeader><oddFooter>${xml(`&L&9${printText(sheet.headerFooter.fl)}&C&9Page &P of &N&R&9${printText(sheet.headerFooter.fr)}`)}</oddFooter></headerFooter>` : "";
        const tab = sheet.tabColor ? `<tabColor rgb="${sheet.tabColor}"/>` : "";
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr>${tab}<pageSetUpPr fitToPage="1"/></sheetPr>${view}<sheetFormatPr defaultRowHeight="16"/>${cols}<sheetData>${rows}</sheetData>${filter}${merges}${setup}${hf}</worksheet>`;
    }

    function sheetName(name, used) {
        let n = String(name || "Sheet").replace(/[\[\]:*?\/\\]/g, " ").trim().slice(0, 31) || "Sheet", i = 2;
        const base = n;
        while (used.has(n.toLowerCase())) n = base.slice(0, 28) + " " + i++;
        used.add(n.toLowerCase());
        return n;
    }

    function build(sheets, meta) {
        const info = meta || {};
        const reg = createRegistry();
        const used = new Set(), names = sheets.map((s) => sheetName(s.name, used));
        const sheetParts = sheets.map((s) => sheetXml(s, reg));
        const quote = (n) => `'${String(n).replace(/'/g, "''")}'`;
        const titles = sheets.map((s, i) => (s.printTitleRows ? `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${xml(quote(names[i]))}!$${s.printTitleRows[0]}:$${s.printTitleRows[1]}</definedName>` : "")).join("");
        const defined = titles ? `<definedNames>${titles}</definedNames>` : "";
        const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
        const files = [
            { name: "[Content_Types].xml", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
            { name: "_rels/.rels", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
            { name: "docProps/core.xml", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(info.title || "Cashbook for Contractors")}</dc:title><dc:creator>${xml(info.author || "Cashbook for Contractors")}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>` },
            { name: "docProps/app.xml", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Cashbook for Contractors</Application><Company>${xml(info.company || "Cashbook Family")}</Company></Properties>` },
            { name: "xl/workbook.xml", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>${defined}</workbook>` },
            { name: "xl/_rels/workbook.xml.rels", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
            { name: "xl/styles.xml", text: reg.stylesXml() },
            ...sheetParts.map((text, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text })),
        ].map((f) => ({ name: f.name, data: enc.encode(f.text) }));
        return zip(files);
    }

    function download(blob, fileName) {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 4000);
    }

    const api = { build, download, crc32, spec: SPEC };
    if (typeof module !== "undefined" && module.exports) module.exports = api; else root.CbcXlsx = api;
})(typeof window !== "undefined" ? window : globalThis);
