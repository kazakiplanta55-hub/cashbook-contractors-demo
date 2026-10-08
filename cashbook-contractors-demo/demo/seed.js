"use strict";
// Demo dataset. Dates are relative to today so due dates, overdue cheques and progress always look live.
window.CBDEMO_SEED = function () {
    const manila = (off) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(Date.now() + off * 86400000));
    const iso = (off) => new Date(Date.now() + off * 86400000).toISOString();
    let n = 0; const id = (p) => `demo-${p}-${++n}`;
    const svg = (txt, bg, fg) => "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" rx="28" fill="${bg}"/><text x="100" y="125" font-family="Arial" font-weight="700" font-size="76" text-anchor="middle" fill="${fg || "#fff"}">${txt}</text></svg>`);
    const audit = (project, action, type, eid, summary, off) => project.auditTrail.push({ id: id("au"), at: iso(off), action, entityType: type, entityId: eid, summary, details: {} });

    const clients = [
        { id: "demo-client-bayview", clientName: "Bayview Realty Corp", businessName: "Bayview Realty Corp", userName: "BAYVIEW", contactNumber: "02 8123 4567", clientEmail: "projects@bayview.example", tin: "234-567-890-000", clientAddress: "Roxas Blvd, Pasay City", brandColor: "#1f6f8b", logo: svg("BR", "#1f6f8b"), createdAt: iso(-120) },
        { id: "demo-client-reyes", clientName: "Ana Reyes", businessName: "Reyes Bakery", userName: "REYES", contactNumber: "0918 765 4321", clientEmail: "ana@reyesbakery.example", tin: "", clientAddress: "45 Rizal Ave, Marikina", brandColor: "#b4531f", logo: svg("RB", "#b4531f"), createdAt: iso(-100) },
        { id: "demo-client-metro", clientName: "Dr. Paolo Lim", businessName: "Metro Dental Group", userName: "METRODENTAL", contactNumber: "0917 222 3344", clientEmail: "admin@metrodental.example", tin: "345-678-901-000", clientAddress: "Ortigas Center, Pasig City", brandColor: "#5b3f9e", logo: svg("MD", "#5b3f9e"), createdAt: iso(-300) },
    ].map((c) => ({ archivedAt: "", auditTrail: [], updatedAt: c.createdAt, ...c }));

    // ---------- HR (company 201 files) ----------
    const hr = (name, rank, position, extra) => ({ id: id("hr"), name, rank, workerType: "Employee", file201: Object.assign({ status: "Active", position, hireDate: manila(-700), birthDate: "1990-05-14", contact: "0917 000 1111", address: "Quezon City", tin: "123-456-789", sss: "34-1234567-8", philhealth: "12-345678901-2", pagibig: "1234-5678-9012", emergencyName: "Family contact", emergencyNumber: "0918 111 2222", notes: "" }, extra || {}), documents: [], createdAt: iso(-700), updatedAt: iso(-30) });
    const company201 = [
        hr("Ramon Cruz", "Supervisor 1", "Foreman", { hireDate: "2019-03-04", birthDate: "1982-11-02", contact: "0917 555 0101", address: "Antipolo, Rizal" }),
        hr("Jose Mercado", "Skilled 2", "Mason", { hireDate: "2020-08-17", birthDate: "1988-02-21", contact: "0918 555 0202", address: "Marikina City" }),
        hr("Mario Dizon", "Laborer 1", "Helper", { hireDate: "2021-01-11", birthDate: "1995-07-30", contact: "0919 555 0303", address: "Cainta, Rizal" }),
        hr("Liza Ortega", "Staff 2", "Project Engineer", { hireDate: "2018-06-01", birthDate: "1991-09-09", contact: "0917 555 0404", address: "Pasig City", notes: "PRC licensed civil engineer." }),
        hr("Dennis Bautista", "Skilled 1", "Electrician", { hireDate: "2022-02-14", birthDate: "1990-12-12", contact: "0920 555 0505", address: "Taytay, Rizal" }),
        hr("Carlo Villanueva", "Skilled 1", "Carpenter", { hireDate: "2022-05-23", birthDate: "1992-04-18", contact: "0921 555 0606", address: "Binangonan, Rizal" }),
    ];
    const docs = {};
    company201.forEach((p, i) => {
        const initials = p.name.split(" ").map((w) => w[0]).join("");
        const photoId = id("doc"), idId = id("doc"), ctId = id("doc");
        docs[photoId] = svg(initials, ["#2f6f5e", "#8a4b2a", "#3b5b92", "#7a3b69", "#4d6b2f", "#8a6d1f"][i % 6]);
        p.documents.push({ id: photoId, kind: "photo", name: "2x2 photo.jpg", mime: "image/svg+xml", size: 2400, addedAt: iso(-60) });
        if (i < 4) { docs[idId] = svg("ID", "#475569"); p.documents.push({ id: idId, kind: "id", name: "Government ID.png", mime: "image/svg+xml", size: 2400, addedAt: iso(-60) }); }
        if (i < 2) { const dId = id("doc"); docs[dId] = svg("201", "#1f2937"); p.documents.push({ id: dId, kind: "details", name: "201 details form.png", mime: "image/svg+xml", size: 2400, addedAt: iso(-60) }); }
        if (i < 3) { docs[ctId] = svg("CT", "#334155"); p.documents.push({ id: ctId, kind: "contract", name: "Employment contract.png", mime: "image/svg+xml", size: 2400, addedAt: iso(-60) }); }
    });
    const hrById = Object.fromEntries(company201.map((p) => [p.name, p]));

    const worker = (name, role, daily, type, hrName, rank) => {
        const h = hrName ? hrById[hrName] : null;
        return { id: id("w"), companyId: h ? h.id : undefined, name, role, workerType: type || "Employee", rank: type === "Subcontracted" ? "" : (rank || (h && h.rank) || ""), file201: h ? JSON.parse(JSON.stringify(h.file201)) : { status: "Active" }, documents: [], dailyRate: daily, hourlyRate: Math.round(daily / 8 * 100) / 100, otRate: Math.round(daily / 8 * 1.25 * 100) / 100, createdAt: iso(-90) };
    };
    const roles = (...names) => names.map((name) => ({ id: id("role"), name }));

    function payrollFor(project, days, crewIds) {
        const out = [];
        for (let off = -days; off <= -1; off++) {
            const date = manila(off); const dow = new Date(date + "T12:00:00").getDay();
            if (dow === 0) continue;
            crewIds.forEach((wid, i) => {
                const w = project.workers.find((x) => x.id === wid);
                if ((off + i * 3) % 11 === 0) return; // an occasional absence
                const half = (off + i) % 9 === 0, ot = (off + i) % 4 === 0 ? 2 : 0;
                const dayFactor = half ? 0.5 : 1;
                const basic = Math.round(w.dailyRate * dayFactor * 100) / 100, otPay = Math.round(ot * w.otRate * 100) / 100;
                out.push({ id: id("pay"), workerId: wid, date, daysWorked: dayFactor, regularHours: 0, overtimeHours: ot, payBasis: "auto", regularDayRate: w.dailyRate, overtimeHourlyRate: w.otRate, basicPay: basic, allowance: 0, nightDiff: 0, holidayFee: 0, otPay, otherFee: 0, otherNote: "", grossPay: basic + otPay, notes: "", hoursWorked: dayFactor * 8, ratePerDay: basic, createdAt: iso(off) });
            });
        }
        return out;
    }
    const cash = (project, dir, off, amount, description, ref, category, sourceType, sourceIds) => {
        const e = { id: id(dir === "in" ? "inc" : "exp"), date: manila(off), amount, description, referenceNo: ref || "", category, sourceType: sourceType || "manual", postingStatus: "posted", postedAt: iso(off), createdAt: iso(off) };
        const ids = sourceIds || [e.id]; e.sourceIds = ids; if (ids.length === 1) e.sourceId = ids[0]; e.sourceKey = `${e.sourceType}:${ids.slice().sort().join("|")}`;
        project[dir === "in" ? "incomeEntries" : "expenseEntries"].push(e); return e;
    };
    const base = (clientId, name, code, site, budget, matBudget, start, end, status, pct, notes) => ({ id: id("proj"), clientId, projectName: name, projectCode: code, siteAddress: site, budget, materialsBudget: matBudget, startDate: manila(start), targetEndDate: manila(end), actualEndDate: "", percentComplete: pct, status, archivedAt: "", notes, incomeEntries: [], expenseEntries: [], materialEntries: [], purchaseOrders: [], workers: [], roles: [], payrollEntries: [], progressHistory: [], programsOfWork: [], chequeEntries: [], progressOverride: null, auditTrail: [], createdAt: iso(start), updatedAt: iso(-1) });
    const programs = (project, spec) => {
        project.programsOfWork = spec.map(([name, s, e, items]) => ({ id: id("prog"), name, startDate: manila(s), endDate: manila(e), weight: 100, createdAt: iso(s), items: items.map(([iname, is, ie, done]) => ({ id: id("item"), name: iname, startDate: manila(is), endDate: manila(ie), weight: 100, done: !!done, completedAt: done ? iso(Math.min(-1, done)) : "" })) }));
    };
    const history = (project, pts) => { project.progressHistory = pts.map(([off, pct]) => ({ id: id("ph"), date: manila(off), percentComplete: pct, recordedAt: iso(off) })); };
    const cheque = (project, type, no, bank, party, amount, off, status, notes) => project.chequeEntries.push({ id: id("chq"), type, chequeNumber: no, bankName: bank, partyName: party, amount, dueDate: manila(off), maturityDate: manila(off), status, notes: notes || "", createdAt: iso(off - 10) });

    // ---------- Project 1: Bayview Warehouse Annex ----------
    const p1 = base("demo-client-bayview", "Bayview Warehouse Annex", "BVW-2026-001", "Lot 5, Roxas Blvd, Pasay City", 4800000, 1900000, -110, 70, "Ongoing", 62, "Two-storey warehouse annex with loading bay and mezzanine office.");
    p1.roles = roles("Project Engineer", "Foreman", "Electrician", "Mason", "Carpenter", "Helper");
    p1.workers = [worker("Liza Ortega", "Project Engineer", 1800, "Employee", "Liza Ortega"), worker("Ramon Cruz", "Foreman", 1200, "Employee", "Ramon Cruz"), worker("Dennis Bautista", "Electrician", 1000, "Employee", "Dennis Bautista"), worker("Jose Mercado", "Mason", 850, "Employee", "Jose Mercado"), worker("Carlo Villanueva", "Carpenter", 850, "Employee", "Carlo Villanueva"), worker("Mario Dizon", "Helper", 610, "Employee", "Mario Dizon"), worker("Edgar Santos", "Helper", 610, "Worker"), worker("Rey Manalo Steelworks", "Mason", 3500, "Subcontracted")];
    p1.payrollEntries = payrollFor(p1, 21, p1.workers.slice(1, 8).map((w) => w.id));
    // post the older payroll weeks to Cash Out, leave the latest week unposted
    const cutoff = manila(-8); const olderPay = p1.payrollEntries.filter((e) => e.date <= cutoff);
    [[-22, -15], [-14, -8]].forEach(([a, b]) => { const grp = olderPay.filter((e) => e.date >= manila(a) && e.date <= manila(b)); if (grp.length) cash(p1, "out", b, grp.reduce((s, e) => s + e.grossPay, 0), `Payroll ${manila(a)} to ${manila(b)}`, "PR-" + Math.abs(b), "Payroll", "payroll-batch", grp.map((e) => e.id)); });
    cash(p1, "in", -105, 960000, "Down payment (20%)", "OR-5001", "Down Payment");
    cash(p1, "in", -60, 1200000, "Progress billing no. 1", "OR-5014", "Progress Payment");
    cash(p1, "in", -20, 900000, "Progress billing no. 2", "OR-5027", "Progress Payment");
    cash(p1, "out", -100, 85000, "Building permit and fees", "OR-1180", "Permits");
    cash(p1, "out", -92, 215000, "Excavator and dump truck rental", "INV-3321", "Equipment");
    cash(p1, "out", -75, 420000, "Steel works subcontract (1st tranche)", "SC-0011", "Subcontractor");
    cash(p1, "out", -55, 118500.5, "Formworks and scaffolding", "DR-7001", "Equipment");
    cash(p1, "out", -35, 96000, "Electrical rough-in materials", "DR-7044", "Materials");
    cash(p1, "out", -50, 64000, "Weekly labor — masonry crew (cash)", "PR-7002", "Labor"); cash(p1, "out", -26, 58000, "Weekly labor — carpentry crew (cash)", "PR-7003", "Labor");
    cash(p1, "out", -12, 310000, "Steel works subcontract (2nd tranche)", "SC-0012", "Subcontractor");
    // Purchase orders + stock
    const po = (no, mat, sup, qty, unit, total, delivered, inst) => {
        const o = { id: id("po"), poNumber: no, materialName: mat, supplier: sup, quantity: qty, unit, totalAmount: total, deliveryStatus: delivered ? "Delivered" : "Ordered", createdAt: iso(-60), installments: inst.map(([off, amt, paid]) => ({ id: id("ins"), dueDate: manila(off), amount: amt, status: paid ? "Paid" : "Due" })) };
        if (delivered) o.deliveredDate = manila(delivered);
        p1.purchaseOrders.push(o); return o;
    };
    const o1 = po("PO-2026-001", "Portland cement", "Holcim Trading", 600, "bags", 210000, -50, [[-50, 105000, 1], [-20, 105000, 1]]);
    const o2 = po("PO-2026-002", "Rebar 16mm", "Steel Depot Manila", 900, "pcs", 585000, -45, [[-45, 300000, 1], [-9, 150000, 0], [12, 135000, 0]]);
    const o3 = po("PO-2026-003", "Hollow blocks 6\"", "Marikina Blocks Inc.", 8000, "pcs", 96000, -30, [[-30, 96000, 1]]);
    const o4 = po("PO-2026-004", "Gravel 3/4", "Quarry Express", 40, "cu.m", 64000, 0, [[6, 32000, 0], [20, 32000, 0]]);
    const o5 = po("PO-2026-005", "Plywood 3/4 marine", "Lumber World", 120, "sheets", 138000, 0, [[2, 69000, 0], [-3, 69000, 0]]);
    p1.purchaseOrders.forEach((o) => o.installments.forEach((i) => { if (i.status === "Paid") { const e = cash(p1, "out", Math.round((Date.parse(i.dueDate) - Date.now()) / 86400000), i.amount, `${o.poNumber} — ${o.materialName} (${o.supplier}) payment`, "CHK-" + (1000 + n), "Materials", "po-installment", [i.id]); i.paidDate = i.dueDate; i.expenseEntryId = e.id; } }));
    p1.purchaseOrders.filter((o) => o.deliveryStatus === "Delivered").forEach((o) => { const e = { id: id("mat"), materialName: o.materialName, direction: "in", date: o.deliveredDate, deliveryDate: o.deliveredDate, quantity: o.quantity, unit: o.unit, handledBy: "", receivedBy: "Ramon Cruz", notes: `Delivered under ${o.poNumber}`, poId: o.id, unitCost: Math.round(o.totalAmount / o.quantity * 100) / 100, amount: o.totalAmount, createdAt: iso(-40) }; p1.materialEntries.push(e); o.deliveryEntryId = e.id; });
    const out = (mat, unit, qty, off, reason, by) => p1.materialEntries.push({ id: id("mat"), materialName: mat, direction: "out", date: manila(off), deliveryDate: "", quantity: qty, unit, reason: reason || "Used on site", handledBy: by || "Ramon Cruz", receivedBy: "", notes: "", unitCost: 0, amount: 0, createdAt: iso(off) });
    out("Portland cement", "bags", 180, -38); out("Portland cement", "bags", 210, -22); out("Portland cement", "bags", 140, -9); out("Rebar 16mm", "pcs", 400, -33); out("Rebar 16mm", "pcs", 300, -15); out("Hollow blocks 6\"", "pcs", 4200, -18, "Used on site", "Jose Mercado"); out("Hollow blocks 6\"", "pcs", 60, -10, "Damaged / lost", "Jose Mercado");
    p1.materialEntries.push({ id: id("mat"), materialName: "Tie wire", direction: "in", date: manila(-40), deliveryDate: manila(-40), quantity: 80, unit: "kg", handledBy: "", receivedBy: "Ramon Cruz", notes: "Walk-in purchase", unitCost: 95, amount: 7600, createdAt: iso(-40) });
    out("Tie wire", "kg", 52, -14);
    cheque(p1, "received", "0045123", "BDO", "Bayview Realty Corp", 750000, 6, "Pending", "Progress billing no. 3");
    cheque(p1, "received", "0045098", "BDO", "Bayview Realty Corp", 900000, -20, "Cleared", "Progress billing no. 2");
    cheque(p1, "issued", "0098812", "BPI", "Steel Depot Manila", 150000, -2, "Pending", "PO-2026-002 balance");
    cheque(p1, "issued", "0098813", "BPI", "Lumber World", 69000, 4, "Pending");
    cheque(p1, "issued", "0098790", "BPI", "Quarry Express", 48000, -15, "Bounced", "Re-issue after funding");
    cheque(p1, "issued", "0098771", "BPI", "Holcim Trading", 105000, -20, "Cleared");
    programs(p1, [
        ["Site works and foundation", -108, -62, [["Site clearing and layout", -108, -100, -100], ["Excavation", -100, -88, -88], ["Footings and column starters", -88, -70, -70], ["Slab on grade", -70, -62, -62]]],
        ["Structural frame", -64, -10, [["Ground floor columns", -64, -50, -50], ["Second floor beams and slab", -50, -28, -28], ["Steel roof trusses", -28, -10, -12]]],
        ["Masonry and finishing", -30, 40, [["CHB walls", -30, -4, -5], ["Plastering", -10, 14, 0], ["Floor finishes", 5, 28, 0], ["Painting", 20, 40, 0]]],
        ["Electrical and plumbing", -20, 55, [["Rough-in conduits", -20, 0, -3], ["Wiring and panel boards", 0, 30, 0], ["Plumbing fixtures", 15, 45, 0], ["Testing and commissioning", 45, 55, 0]]],
        ["Turnover", 55, 70, [["Punch list", 55, 65, 0], ["Final inspection and turnover", 65, 70, 0]]],
    ]);
    history(p1, [[-108, 0], [-90, 6], [-70, 14], [-55, 24], [-40, 34], [-25, 44], [-12, 53], [-4, 59], [-1, 62]]);
    audit(p1, "CREATE", "project", p1.id, "Created project Bayview Warehouse Annex", -110); audit(p1, "POST", "income", "", "Posted down payment OR-5001", -105); audit(p1, "CREATE", "purchase-order", o2.id, "Created PO-2026-002: Rebar 16mm (Steel Depot Manila)", -60); audit(p1, "STATUS", "cheque", "", "Cheque #0098790 (BPI): Pending to Bounced", -14);

    // ---------- Project 2: Bayview Office Fit-out ----------
    const p2 = base("demo-client-bayview", "Bayview Head Office Fit-out", "BVO-2026-002", "18F Tower One, Makati City", 1850000, 700000, -40, 50, "Ongoing", 38, "Interior fit-out for 600 sqm office, including partitions, ceilings, lighting and MEP.");
    p2.roles = roles("Foreman", "Electrician", "Carpenter", "Helper");
    p2.workers = [worker("Ramon Cruz", "Foreman", 1200, "Employee", "Ramon Cruz"), worker("Dennis Bautista", "Electrician", 1000, "Employee", "Dennis Bautista"), worker("Carlo Villanueva", "Carpenter", 850, "Employee", "Carlo Villanueva"), worker("Mario Dizon", "Helper", 610, "Employee", "Mario Dizon")];
    p2.payrollEntries = payrollFor(p2, 12, p2.workers.map((w) => w.id));
    cash(p2, "in", -38, 555000, "Down payment (30%)", "OR-5030", "Down Payment"); cash(p2, "in", -8, 400000, "Progress billing no. 1", "OR-5041", "Progress Payment");
    cash(p2, "out", -30, 160000, "Gypsum board and metal furring", "DR-8001", "Materials"); cash(p2, "out", -18, 92000, "LED panel lights and cables", "DR-8014", "Materials"); cash(p2, "out", -16, 36000, "Labor — ceiling installers (cash)", "PR-8004", "Labor"); cash(p2, "out", -6, 45000, "Tools and consumables", "DR-8020", "Equipment");
    p2.materialEntries.push({ id: id("mat"), materialName: "Gypsum board 12mm", direction: "in", date: manila(-30), deliveryDate: manila(-30), quantity: 200, unit: "sheets", handledBy: "", receivedBy: "Ramon Cruz", notes: "", unitCost: 520, amount: 104000, createdAt: iso(-30) });
    p2.materialEntries.push({ id: id("mat"), materialName: "Gypsum board 12mm", direction: "out", date: manila(-9), deliveryDate: "", quantity: 120, unit: "sheets", reason: "Used on site", handledBy: "Carlo Villanueva", receivedBy: "", notes: "", unitCost: 0, amount: 0, createdAt: iso(-9) });
    cheque(p2, "received", "0045201", "BDO", "Bayview Realty Corp", 500000, 12, "Pending", "Progress billing no. 2");
    programs(p2, [["Demolition and prep", -40, -28, [["Strip-out", -40, -32, -32], ["Layout marking", -32, -28, -28]]], ["Partitions and ceilings", -28, 14, [["Metal framing", -28, -10, -10], ["Gypsum boards", -14, 8, 0], ["Ceiling grid", -4, 14, 0]]], ["MEP and finishes", -6, 45, [["Electrical works", -6, 25, 0], ["Flooring", 20, 38, 0], ["Painting and finishing", 30, 45, 0]]]]);
    history(p2, [[-40, 0], [-30, 8], [-20, 18], [-10, 30], [-2, 38]]);
    audit(p2, "CREATE", "project", p2.id, "Created project Bayview Head Office Fit-out", -40);

    // ---------- Project 3: Reyes Bakery Renovation (behind schedule) ----------
    const p3 = base("demo-client-reyes", "Reyes Bakery Renovation", "RBK-2026-003", "45 Rizal Ave, Marikina City", 980000, 420000, -75, -3, "Ongoing", 70, "Kitchen expansion, new shopfront and exhaust system. Delayed by permit and equipment lead time.");
    p3.roles = roles("Foreman", "Mason", "Helper");
    p3.workers = [worker("Jose Mercado", "Mason", 850, "Employee", "Jose Mercado"), worker("Mario Dizon", "Helper", 610, "Employee", "Mario Dizon"), worker("Nestor Aquino", "Foreman", 1100, "Worker")];
    p3.payrollEntries = payrollFor(p3, 10, p3.workers.map((w) => w.id));
    cash(p3, "in", -72, 294000, "Down payment (30%)", "OR-6001", "Down Payment"); cash(p3, "in", -30, 350000, "Progress payment", "OR-6009", "Progress Payment");
    cash(p3, "out", -60, 188000, "Tiles, cement and sand", "DR-9001", "Materials"); cash(p3, "out", -34, 124000, "Stainless exhaust hood fabrication", "INV-5520", "Subcontractor"); cash(p3, "out", -10, 38000, "Electrical supplies", "DR-9017", "Materials");
    cheque(p3, "received", "0072001", "Metrobank", "Ana Reyes", 200000, -4, "Pending", "Past maturity — follow up with client");
    cheque(p3, "issued", "0098831", "BPI", "Kitchen Supply Co.", 56000, 9, "Pending");
    programs(p3, [["Demolition and structure", -75, -40, [["Demolition", -75, -65, -65], ["Wall extension", -65, -40, -40]]], ["Kitchen build-out", -45, 0, [["Floor and wall tiling", -45, -15, -15], ["Exhaust hood installation", -20, -4, -6], ["Electrical and gas lines", -20, 0, 0]]], ["Shopfront and finishing", -10, 10, [["Glass shopfront", -10, 4, 0], ["Painting and signage", 0, 10, 0]]]]);
    history(p3, [[-75, 0], [-55, 18], [-35, 40], [-18, 58], [-5, 68], [-1, 70]]);
    audit(p3, "CREATE", "project", p3.id, "Created project Reyes Bakery Renovation", -75);

    // ---------- Project 4: Metro Dental (completed) ----------
    const p4 = base("demo-client-metro", "Metro Dental Clinic Build", "MDC-2026-004", "Ortigas Center, Pasig City", 2200000, 880000, -260, -40, "Completed", 100, "Turnkey dental clinic with 6 treatment rooms. Turned over and fully paid.");
    p4.actualEndDate = manila(-45); p4.roles = roles("Foreman", "Carpenter");
    p4.workers = [worker("Ramon Cruz", "Foreman", 1200, "Employee", "Ramon Cruz"), worker("Carlo Villanueva", "Carpenter", 850, "Employee", "Carlo Villanueva")];
    cash(p4, "in", -255, 660000, "Down payment (30%)", "OR-4001", "Down Payment"); cash(p4, "in", -150, 880000, "Progress payment", "OR-4010", "Progress Payment"); cash(p4, "in", -44, 660000, "Final payment", "OR-4022", "Final Payment");
    cash(p4, "out", -230, 820000, "Materials (consolidated)", "DR-2001", "Materials"); cash(p4, "out", -160, 560000, "Labor and subcontractors", "PR-2002", "Labor"); cash(p4, "out", -90, 340000, "MEP subcontractor", "SC-2003", "Subcontractor");
    programs(p4, [["Build and fit-out", -260, -45, [["Structure", -260, -170, -170], ["Fit-out", -170, -60, -60], ["Turnover", -60, -45, -45]]]]);
    history(p4, [[-260, 0], [-200, 35], [-140, 70], [-80, 95], [-45, 100]]);
    audit(p4, "CREATE", "project", p4.id, "Created project Metro Dental Clinic Build", -260); audit(p4, "STATUS", "project", p4.id, "Project marked Completed", -45);

    const projects = [p1, p2, p3, p4].map((p) => { p.updatedAt = iso(-1); return p; });
    return { clients, projects, company201, docs };
};
