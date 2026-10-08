"use strict";

// Client Portal entry: a login-style page. Pick a client and open the portal
// (no password), or press "Create new profile" to reveal the registration form
// Editing, status changes and deletion move into the portal
// itself (Client Settings).
(function () {
    function get(selector) {
        return document.querySelector(selector);
    }

    // Logo state: undefined = unchanged, "" = removed, data URL = new logo.
    let logoChange;
    function showLogo(src) {
        get("#clientLogoPreviewBox").hidden = !src;
        get("#clientLogoPreview").src = src || "";
    }
    get("#clientLogo").addEventListener("change", async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        try {
            const result = await CbcBrand.processLogo(file);
            logoChange = result.dataUrl;
            get("#clientBrandColor").value = result.color;
            showLogo(result.dataUrl);
        } catch (error) {
            get("#formMessage").textContent = error.message;
        }
    });
    get("#clientLogoRemove").addEventListener("click", () => {
        logoChange = "";
        get("#clientLogo").value = "";
        showLogo("");
    });

    function resetForm() {
        get("#clientForm").reset();
        get("#formMessage").textContent = "";
        logoChange = undefined;
        get("#clientLogo").value = "";
        showLogo("");
        get("#clientBrandColor").value = "#1f4e79";
    }

    // ---- Client picker -------------------------------------------------

    function activeClients() {
        return loadClients()
            .filter((client) => !client.archivedAt)
            .sort((a, b) => String(a.clientName).localeCompare(String(b.clientName)));
    }

    function renderPicker(selectedId) {
        const picker = get("#clientPicker");
        const query = get("#clientSearch").value.trim().toLowerCase();
        const keep = selectedId || picker.value;
        const all = activeClients();
        const matches = query
            ? all.filter((client) =>
                  (client.clientName || "").toLowerCase().includes(query) ||
                  (client.businessName || "").toLowerCase().includes(query))
            : all;

        picker.innerHTML = "";
        if (!all.length) {
            picker.add(new Option("No client profiles yet", ""));
        } else if (!matches.length) {
            picker.add(new Option("No client matches your search", ""));
        } else {
            picker.add(new Option("Choose a client...", ""));
            matches.forEach((client) => {
                const label = client.businessName && client.businessName !== client.clientName
                    ? `${client.clientName} - ${client.businessName}`
                    : client.clientName;
                picker.add(new Option(label, client.id));
            });
            if (matches.some((client) => client.id === keep)) picker.value = keep;
            else if (matches.length === 1 && query) picker.value = matches[0].id;
        }
        picker.disabled = !matches.length;
        get("#openPortalButton").disabled = !matches.length;
    }

    get("#clientSearch").addEventListener("input", () => {
        get("#portalOpenMessage").textContent = "";
        renderPicker();
    });

    get("#portalOpenForm").addEventListener("submit", (event) => {
        event.preventDefault();
        const id = get("#clientPicker").value;
        if (!id || !getClientById(id)) {
            get("#portalOpenMessage").textContent = "Choose a client first.";
            return;
        }
        location.href = `../client-status/client-status.html?client=${encodeURIComponent(id)}`;
    });

    // ---- Create new profile --------------------------------------------

    function setRegisterOpen(open) {
        get("#registerPanel").hidden = !open;
        get("#createProfileButton").setAttribute("aria-expanded", String(open));
        get("#createProfileButton").hidden = open;
        get(".portal-divider").hidden = open;
        if (open) {
            get("#clientName").focus();
            get("#registerPanel").scrollIntoView({ behavior: "smooth", block: "start" });
        } else {
            resetForm();
            window.scrollTo({ top: 0, behavior: "smooth" });
        }
    }

    get("#createProfileButton").addEventListener("click", () => setRegisterOpen(true));
    get("#cancelCreateButton").addEventListener("click", () => setRegisterOpen(false));

    get("#clientForm").addEventListener("submit", (event) => {
        event.preventDefault();

        const clientName = get("#clientName").value.trim();
        if (!clientName) {
            get("#formMessage").textContent = "Client name is required.";
            return;
        }

        const tin = get("#clientTin").value.trim();
        const duplicateName = loadClients().find((c) =>
            String(c.clientName || "").toLowerCase() === clientName.toLowerCase()
        );
        if (duplicateName) {
            get("#formMessage").textContent = `A client named "${clientName}" already exists.`;
            return;
        }
        if (tin) {
            const duplicateTin = loadClients().find((c) =>
                String(c.tin || "").toLowerCase() === tin.toLowerCase()
            );
            if (duplicateTin) {
                get("#formMessage").textContent = `TIN ${tin} is already used by another client.`;
                return;
            }
        }

        const logo = logoChange === undefined ? "" : logoChange;
        const colorValue = get("#clientBrandColor").value;
        const client = {
            id: createId(),
            clientName,
            businessName: get("#businessName").value.trim(),
            contactNumber: get("#contactNumber").value.trim(),
            clientEmail: get("#clientEmail").value.trim(),
            tin,
            clientAddress: get("#clientAddress").value.trim(),
            logo,
            brandColor: logo || colorValue !== "#1f4e79" ? colorValue : "",
        };

        upsertClient(client);
        setRegisterOpen(false);
        get("#clientSearch").value = "";
        renderPicker(client.id);
        get("#portalOpenMessage").textContent = `Profile created for ${clientName}. Press Open Portal to continue.`;
    });

    renderPicker();
})();
