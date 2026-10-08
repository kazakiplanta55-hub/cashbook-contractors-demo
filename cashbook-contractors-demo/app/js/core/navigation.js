"use strict";

document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-href]").forEach((control) => control.addEventListener("click", () => { location.href = control.dataset.href; }));
    document.querySelectorAll("[data-back]").forEach((control) => control.addEventListener("click", () => history.back()));
});
