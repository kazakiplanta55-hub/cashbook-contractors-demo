"use strict";

// User Guide: live search over the topics and a contents list that follows the section being read.
(function () {
    const input = document.getElementById("gdSearch");
    const count = document.getElementById("gdCount");
    const empty = document.getElementById("gdEmpty");
    const toc = document.getElementById("gdToc");
    const sections = [...document.querySelectorAll(".gd-sec")];
    const links = [...toc.querySelectorAll("a")];
    const linkFor = (id) => links.find((a) => a.getAttribute("href") === `#${id}`);
    const originals = new Map(sections.map((section) => [section, section.innerHTML]));

    function clearMarks(section) { section.innerHTML = originals.get(section); }

    // Wrap each match in <mark>, touching text nodes only so the guide's own markup is never broken.
    function markText(section, query) {
        const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        const lower = query.toLowerCase();
        nodes.forEach((node) => {
            const text = node.nodeValue;
            const at = text.toLowerCase().indexOf(lower);
            if (at < 0) return;
            const hit = document.createElement("mark");
            hit.className = "gd-hit";
            hit.textContent = text.slice(at, at + query.length);
            const after = node.splitText(at);
            after.nodeValue = after.nodeValue.slice(query.length);
            node.parentNode.insertBefore(hit, after);
        });
    }

    function runSearch() {
        const query = input.value.trim();
        let shown = 0;
        sections.forEach((section) => {
            clearMarks(section);
            const match = !query || section.textContent.toLowerCase().includes(query.toLowerCase());
            section.hidden = !match;
            const link = linkFor(section.id);
            if (link) link.hidden = !match;
            if (match) shown += 1;
            if (match && query) markText(section, query);
        });
        empty.hidden = shown > 0;
        count.textContent = query ? `${shown} of ${sections.length} topics match "${query}".` : "";
    }
    input.addEventListener("input", runSearch);

    // Contents list: mark the topic nearest the top of the page.
    if ("IntersectionObserver" in window) {
        const seen = new Set();
        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => (entry.isIntersecting ? seen.add(entry.target.id) : seen.delete(entry.target.id)));
            const current = sections.find((section) => seen.has(section.id));
            links.forEach((a) => a.classList.toggle("active", Boolean(current) && a.getAttribute("href") === `#${current.id}`));
        }, { rootMargin: "-80px 0px -60% 0px" });
        sections.forEach((section) => observer.observe(section));
    }

    // Open a topic straight from a link such as guide.html#payroll.
    if (location.hash) {
        const target = document.getElementById(location.hash.slice(1));
        if (target) target.scrollIntoView();
    }
})();
