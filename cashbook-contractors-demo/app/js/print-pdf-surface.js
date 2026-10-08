(function () {
    "use strict";

    const scriptUrl = document.currentScript?.src || location.href;
    const surface = document.querySelector(".print-surface");
    const status = document.querySelector(".print-status");

    function pdfBytes(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        return bytes;
    }

    async function load(base64) {
        if (!window.pdfjsLib) throw new Error("The final print renderer could not be loaded.");
        if (typeof base64 !== "string" || !base64.length) throw new Error("The final print source is empty.");
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("../assets/vendor/pdf.worker.min.js", scriptUrl).href;
        status.textContent = "Rendering pages for the printer…";
        surface.textContent = "";
        const pdf = await window.pdfjsLib.getDocument({ data: pdfBytes(base64) }).promise;
        const firstPage = await pdf.getPage(1);
        const firstViewport = firstPage.getViewport({ scale: 1 });
        const pageWidthPoints = firstViewport.width;
        const pageHeightPoints = firstViewport.height;
        const totalPointPixels = Math.max(1, pdf.numPages * pageWidthPoints * pageHeightPoints);
        const renderScale = Math.max(1, Math.min(2, Math.sqrt(80_000_000 / totalPointPixels)));
        const pageRule = document.createElement("style");
        pageRule.dataset.cashbookPageSize = "true";
        pageRule.textContent = `@page{size:${pageWidthPoints}pt ${pageHeightPoints}pt;margin:0}`;
        document.head.querySelector("style[data-cashbook-page-size]")?.remove();
        document.head.append(pageRule);

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
            const page = pageNumber === 1 ? firstPage : await pdf.getPage(pageNumber);
            const printViewport = page.getViewport({ scale: renderScale });
            const wrapper = document.createElement("article");
            wrapper.className = "cashbook-print-page";
            wrapper.dataset.page = String(pageNumber);
            wrapper.style.width = `${pageWidthPoints}pt`;
            wrapper.style.height = `${pageHeightPoints}pt`;
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.floor(printViewport.width));
            canvas.height = Math.max(1, Math.floor(printViewport.height));
            canvas.setAttribute("aria-label", `Printable page ${pageNumber}`);
            wrapper.append(canvas);
            surface.append(wrapper);
            await page.render({ canvasContext: canvas.getContext("2d", { alpha: false }), viewport: printViewport }).promise;
        }

        status.textContent = `${pdf.numPages} printable page${pdf.numPages === 1 ? "" : "s"} ready`;
        document.documentElement.classList.add("cashbook-print-ready");
        const result = {
            pages: pdf.numPages,
            widthMicrons: Math.round(pageWidthPoints / 72 * 25400),
            heightMicrons: Math.round(pageHeightPoints / 72 * 25400),
            renderScale,
        };
        await pdf.destroy();
        return result;
    }

    window.CashbookPdfPrint = { load };
    window.cashbookPrintReady = window.cashbookPrintSource?.load
        ? window.cashbookPrintSource.load().then(load)
        : Promise.resolve(null);
})();
