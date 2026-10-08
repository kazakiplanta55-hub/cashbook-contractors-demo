"use strict";
(function (root) {
    const DEFAULT = "#1f4e79";
    const hex = (n) => Math.round(n).toString(16).padStart(2, "0");

    function readImage(file) {
        return new Promise((resolve, reject) => {
            const fail = () => reject(new Error("That image could not be read."));
            const reader = new FileReader();
            reader.onerror = fail;
            reader.onload = () => { const img = new Image(); img.onload = () => resolve(img); img.onerror = fail; img.src = reader.result; };
            reader.readAsDataURL(file);
        });
    }

    // Shrinks the logo to 256 px and picks its main color (ignoring white, black and transparent pixels).
    async function processLogo(file) {
        if (file.size > 5 * 1024 * 1024) throw new Error("Choose an image under 5 MB.");
        const img = await readImage(file);
        const scale = Math.min(1, 256 / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d"); ctx.drawImage(img, 0, 0, w, h);
        const px = ctx.getImageData(0, 0, w, h).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < px.length; i += 4) {
            if (px[i + 3] < 200) continue;
            const mx = Math.max(px[i], px[i + 1], px[i + 2]), mn = Math.min(px[i], px[i + 1], px[i + 2]);
            if (mn > 235 || mx < 30 || mx - mn < 25) continue;
            r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
        }
        return { dataUrl: canvas.toDataURL("image/png"), color: n ? `#${hex(r / n)}${hex(g / n)}${hex(b / n)}` : DEFAULT };
    }

    function readableText(color) {
        const c = /^#[0-9a-f]{6}$/i.test(color || "") ? color : DEFAULT;
        const lum = (parseInt(c.slice(1, 3), 16) * 0.299 + parseInt(c.slice(3, 5), 16) * 0.587 + parseInt(c.slice(5, 7), 16) * 0.114) / 255;
        return lum > 0.6 ? "#111111" : "#ffffff";
    }

    root.CbcBrand = { DEFAULT, processLogo, readableText };
})(typeof window !== "undefined" ? window : globalThis);
