"use strict";
// Shared definitions for 201 files (personnel records). Used by the Company 201 page and the Project 201 page.
(function (root) {
    // Order = order on the form and on the printed sheet.
    const FIELDS = [
        ["position", "Position / Job title", "text"],
        ["status", "Status", "status"],
        ["hireDate", "Date hired", "date"],
        ["birthDate", "Birth date", "date"],
        ["contact", "Contact number", "text"],
        ["address", "Address", "text"],
        ["tin", "TIN", "text"],
        ["sss", "SSS No.", "text"],
        ["philhealth", "PhilHealth No.", "text"],
        ["pagibig", "Pag-IBIG No.", "text"],
        ["emergencyName", "Emergency contact", "text"],
        ["emergencyNumber", "Emergency number", "text"],
        ["notes", "Notes", "text"],
    ];
    // How the fields are grouped on the 201 sheet, the form and the Excel export.
    const GROUPS = [
        ["Employment", ["position", "status", "hireDate"]],
        ["Personal and contact", ["birthDate", "contact", "address", "emergencyName", "emergencyNumber"]],
        ["Government numbers", ["tin", "sss", "philhealth", "pagibig"]],
        ["Remarks", ["notes"]],
    ];
    const STATUSES = ["Active", "Inactive"];
    const TYPES = ["Worker", "Employee", "Subcontracted"];

    // Document kinds. "photo" is the 2x2 ID picture (images only, one per person). REQUIRED ones count toward "complete".
    const DOC_KINDS = [
        ["photo", "2x2 photo"],
        ["details", "201 details form"],
        ["id", "Government ID"],
        ["contract", "Employment contract"],
        ["credential", "Credential / certificate"],
        ["clearance", "Clearance / medical"],
        ["other", "Other document"],
    ];
    const REQUIRED_DOCS = ["photo", "details", "id", "contract"];
    const docLabel = (kind) => (DOC_KINDS.find(([k]) => k === kind) || [0, "Document"])[1];
    const docsOf = (record) => (Array.isArray(record && record.documents) ? record.documents : []);
    const missingDocs = (record) => REQUIRED_DOCS.filter((k) => !docsOf(record).some((d) => d.kind === k));

    const typeOf = (worker) => (TYPES.includes(worker && worker.workerType) ? worker.workerType : "Worker");
    const isSubcontracted = (worker) => typeOf(worker) === "Subcontracted";
    const statusOf = (record) => (record && record.file201 && STATUSES.includes(record.file201.status) ? record.file201.status : "Active");

    const api = { GROUPS, DOC_KINDS, REQUIRED_DOCS, docLabel, docsOf, missingDocs, FIELDS, STATUSES, TYPES, typeOf, isSubcontracted, statusOf };
    if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Cbc201 = api;
})(typeof window !== "undefined" ? window : globalThis);
