"use strict";

(function initializeCashbookExchangeCore() {
    const FORMAT = "cashbook-family-transfer";
    const FORMAT_VERSION = 1;

    function createId() {
        if (
            globalThis.crypto &&
            typeof crypto.randomUUID === "function"
        ) {
            return crypto.randomUUID();
        }

        return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    function normalizeText(value) {
        return String(value || "")
            .trim()
            .replace(/\s+/g, " ")
            .toLowerCase();
    }

    function normalizeTin(value) {
        return String(value || "")
            .replace(/[^0-9]/g, "");
    }

    function stableValue(value) {
        if (Array.isArray(value)) {
            return value.map(stableValue);
        }

        if (value && typeof value === "object") {
            return Object.keys(value)
                .sort()
                .reduce((result, key) => {
                    result[key] = stableValue(value[key]);
                    return result;
                }, {});
        }

        return value;
    }

    function stableStringify(value) {
        return JSON.stringify(stableValue(value));
    }

    async function checksum(value) {
        const bytes = new TextEncoder().encode(
            stableStringify(value)
        );
        const digest = await crypto.subtle.digest(
            "SHA-256",
            bytes
        );

        return Array.from(new Uint8Array(digest))
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
    }

    function transactionSignature(entry, kind) {
        return [
            kind,
            entry.date,
            normalizeText(
                entry.referenceNumber || entry.referenceNo
            ),
            Number(entry.amount || entry.totalAmount || 0).toFixed(2),
            normalizeText(
                entry.transactionType || entry.expenseType || entry.category
            ),
            normalizeText(entry.description),
        ].join("|");
    }

    function likelyTransactionSignature(entry, kind) {
        return [
            kind,
            entry.date,
            normalizeText(
                entry.referenceNumber || entry.referenceNo
            ),
            Number(entry.amount || entry.totalAmount || 0).toFixed(2),
        ].join("|");
    }

    async function createPackage(options) {
        const payload = options.payload;
        const packageRecord = {
            format: FORMAT,
            formatVersion: FORMAT_VERSION,
            packageId: createId(),
            createdAt: new Date().toISOString(),
            source: options.source,
            exportOptions: options.exportOptions || {},
            payload,
        };

        packageRecord.checksum = await checksum(payload);
        return packageRecord;
    }

    async function validatePackage(packageRecord) {
        if (
            !packageRecord ||
            packageRecord.format !== FORMAT ||
            packageRecord.formatVersion !== FORMAT_VERSION ||
            !packageRecord.packageId ||
            !packageRecord.source ||
            !packageRecord.payload
        ) {
            throw new Error(
                "This is not a supported Cashbook Family transfer package."
            );
        }

        const calculated = await checksum(
            packageRecord.payload
        );

        if (calculated !== packageRecord.checksum) {
            throw new Error(
                "The transfer package failed its integrity check. Do not import this file."
            );
        }

        return packageRecord;
    }

    function downloadJson(value, fileName) {
        const blob = new Blob(
            [JSON.stringify(value, null, 2)],
            { type: "application/json" }
        );
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    function readJsonFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = () => {
                try {
                    resolve(JSON.parse(reader.result));
                } catch {
                    reject(new Error(
                        "The selected file is not valid JSON."
                    ));
                }
            };
            reader.onerror = () => reject(
                new Error("The selected file could not be read.")
            );
            reader.readAsText(file);
        });
    }

    function safeFileName(value) {
        return String(value || "transfer")
            .trim()
            .replace(/[^a-z0-9_-]+/gi, "-")
            .replace(/^-+|-+$/g, "")
            .toLowerCase() || "transfer";
    }

    window.CashbookExchange = {
        FORMAT,
        FORMAT_VERSION,
        createId,
        normalizeText,
        normalizeTin,
        stableStringify,
        checksum,
        transactionSignature,
        likelyTransactionSignature,
        createPackage,
        validatePackage,
        downloadJson,
        readJsonFile,
        safeFileName,
    };
})();
