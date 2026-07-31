const graphSettingDefaults = {
    hideEnums: true,
    hideErrorResponses: true,
    showOnlyChanged: true,
    horizontalGap: 1.4,
    verticalGap: 1.4,
    nodeWidth: 1,
    nodeHeight: 1,
    nodeTextSize: 1,
    edgeTextSize: 1
};

const panelWidthDefaults = {
    left: 360,
    right: 360,
    min: 260,
    max: 560
};

const schemaExplorerMaxDepth = 24;

const state = {
    specId: null,
    compareSpecId: null,
    changedEndpoints: [],
    changedModels: [],
    affectedModels: [],
    endpoints: [],
    allEndpoints: [],
    models: [],
    modelTab: "all",
    selected: new Map(),
    favorites: readFavoriteEndpoints(),
    detailsCollapsed: readDetailsCollapsed(),
    collapsedSections: new Set(["endpoints", "models", "changed", "affected", "selected"]),
    method: "",
    cy: null,
    lastGraph: null,
    graphLayoutRootIds: [],
    graphFocusNodeId: null,
    searchTimer: null,
    currentDetailsNode: null,
    schemaCache: new Map(),
    schemaExplorerLoadErrors: new Set(),
    schemaExplorerRootId: null,
    schemaExplorerExpanded: new Set(),
    schemaExplorerRows: new Map(),
    similarModelsTarget: null
};

const els = {
    appShell: document.querySelector(".app-shell"),
    fileInput: document.getElementById("fileInput"),
    fileLabel: document.getElementById("fileLabel"),
    compareButton: document.getElementById("compareButton"),
    compareLabel: document.getElementById("compareLabel"),
    compareFileInput: document.getElementById("compareFileInput"),
    repoPanel: document.getElementById("repoPanel"),
    diffSourceSelect: document.getElementById("diffSourceSelect"),
    prInput: document.getElementById("prInput"),
    prLoadButton: document.getElementById("prLoadButton"),
    baseRefInput: document.getElementById("baseRefInput"),
    headRefInput: document.getElementById("headRefInput"),
    refLoadButton: document.getElementById("refLoadButton"),
    repoStatus: document.getElementById("repoStatus"),
    diffProvenance: document.getElementById("diffProvenance"),
    specMeta: document.getElementById("specMeta"),
    endpointSearch: document.getElementById("endpointSearch"),
    methodFiltersToggle: document.getElementById("methodFiltersToggle"),
    methodFilters: document.getElementById("methodFilters"),
    favoriteList: document.getElementById("favoriteList"),
    favoriteCount: document.getElementById("favoriteCount"),
    endpointList: document.getElementById("endpointList"),
    endpointCount: document.getElementById("endpointCount"),
    modelList: document.getElementById("modelList"),
    modelCount: document.getElementById("modelCount"),
    modelTabs: document.querySelectorAll("[data-model-tab]"),
    changedEndpointSection: document.getElementById("changedEndpointSection"),
    changedEndpointList: document.getElementById("changedEndpointList"),
    changedEndpointCount: document.getElementById("changedEndpointCount"),
    affectedEndpointSection: document.getElementById("affectedEndpointSection"),
    affectedEndpointList: document.getElementById("affectedEndpointList"),
    affectedEndpointCount: document.getElementById("affectedEndpointCount"),
    selectedList: document.getElementById("selectedList"),
    selectedCount: document.getElementById("selectedCount"),
    clearSelection: document.getElementById("clearSelection"),
    depthInput: document.getElementById("depthInput"),
    nodeLimitInput: document.getElementById("nodeLimitInput"),
    settingsButton: document.getElementById("settingsButton"),
    settingsPanel: document.getElementById("settingsPanel"),
    hideEnumsInput: document.getElementById("hideEnumsInput"),
    hideErrorResponsesInput: document.getElementById("hideErrorResponsesInput"),
    showOnlyChangedInput: document.getElementById("showOnlyChangedInput"),
    horizontalGapInput: document.getElementById("horizontalGapInput"),
    horizontalGapValue: document.getElementById("horizontalGapValue"),
    verticalGapInput: document.getElementById("verticalGapInput"),
    verticalGapValue: document.getElementById("verticalGapValue"),
    nodeWidthInput: document.getElementById("nodeWidthInput"),
    nodeWidthValue: document.getElementById("nodeWidthValue"),
    nodeHeightInput: document.getElementById("nodeHeightInput"),
    nodeHeightValue: document.getElementById("nodeHeightValue"),
    nodeTextSizeInput: document.getElementById("nodeTextSizeInput"),
    nodeTextSizeValue: document.getElementById("nodeTextSizeValue"),
    edgeTextSizeInput: document.getElementById("edgeTextSizeInput"),
    edgeTextSizeValue: document.getElementById("edgeTextSizeValue"),
    resetSettingsButton: document.getElementById("resetSettingsButton"),
    layoutButton: document.getElementById("layoutButton"),
    fitButton: document.getElementById("fitButton"),
    showChangesButton: document.getElementById("showChangesButton"),
    graphStatus: document.getElementById("graphStatus"),
    graph: document.getElementById("graph"),
    emptyGraph: document.getElementById("emptyGraph"),
    detailsPanel: document.querySelector(".details-panel"),
    rightResizeHandle: document.querySelector(".resize-handle-right"),
    detailsExpandButton: document.getElementById("detailsExpandButton"),
    detailsCollapseButton: document.getElementById("detailsCollapseButton"),
    detailsTitle: document.getElementById("detailsTitle"),
    detailsBadge: document.getElementById("detailsBadge"),
    detailsBody: document.getElementById("detailsBody"),
    graphNodeActions: null,
    schemaExplorerOverlay: document.getElementById("schemaExplorerOverlay"),
    schemaExplorerCloseButton: document.getElementById("schemaExplorerCloseButton"),
    schemaExplorerTitle: document.getElementById("schemaExplorerTitle"),
    schemaExplorerBadge: document.getElementById("schemaExplorerBadge"),
    schemaExplorerBody: document.getElementById("schemaExplorerBody"),
    similarModelsOverlay: document.getElementById("similarModelsOverlay"),
    similarModelsCloseButton: document.getElementById("similarModelsCloseButton"),
    similarModelsTitle: document.getElementById("similarModelsTitle"),
    similarModelsBadge: document.getElementById("similarModelsBadge"),
    similarModelsBody: document.getElementById("similarModelsBody"),
    resizeHandles: document.querySelectorAll("[data-resize-panel]")
};

window.addEventListener("DOMContentLoaded", () => {
    restorePanelWidths();
    setDetailsPanelCollapsed(state.detailsCollapsed, false);
    wireEvents();
    initializeGraph();
    renderSectionCollapse();
    renderDiffControls();
    renderChangedEndpoints();
    renderModelBrowser();
    renderDetails(null);
    refreshIcons();
    loadDiffSources();
});

function wireEvents() {
    els.fileInput.addEventListener("change", importSpec);
    els.compareButton?.addEventListener("click", () => {
        if (state.compareSpecId) {
            clearDiff();
            return;
        }

        els.compareFileInput?.click();
    });
    els.compareFileInput?.addEventListener("change", importComparisonSpec);

    els.prLoadButton?.addEventListener("click", loadPullRequestDiff);
    els.prInput?.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            loadPullRequestDiff();
        }
    });
    els.refLoadButton?.addEventListener("click", loadRefDiff);
    [els.baseRefInput, els.headRefInput].forEach(input => {
        input?.addEventListener("keydown", event => {
            if (event.key === "Enter") {
                loadRefDiff();
            }
        });
    });

    els.endpointSearch.addEventListener("input", () => {
        clearTimeout(state.searchTimer);
        state.searchTimer = setTimeout(() => {
            loadEndpoints();
            loadModels();
        }, 160);
    });

    els.modelTabs?.forEach(button => {
        button.addEventListener("click", () => {
            state.modelTab = button.dataset.modelTab || "all";
            renderModelBrowser();
        });
    });

    els.methodFiltersToggle.addEventListener("click", () => {
        setMethodFiltersCollapsed(!els.methodFilters.classList.contains("collapsed"));
    });

    els.methodFilters.addEventListener("click", event => {
        const button = event.target.closest("button[data-method]");
        if (!button) {
            return;
        }

        state.method = button.dataset.method ?? "";
        document.querySelectorAll(".method-filter").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        loadEndpoints();
    });

    document.querySelectorAll("[data-toggle-section]").forEach(button => {
        button.addEventListener("click", () => toggleSection(button.dataset.toggleSection));
    });

    els.resizeHandles.forEach(handle => {
        handle.addEventListener("pointerdown", startPanelResize);
    });

    els.detailsCollapseButton?.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        setDetailsPanelCollapsed(true);
    });
    els.detailsExpandButton?.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        setDetailsPanelCollapsed(false);
    });
    els.detailsBody?.addEventListener("click", event => {
        const diffToggle = event.target.closest("[data-toggle-diff-block]");
        if (diffToggle) {
            event.preventDefault();
            const block = diffToggle.closest(".diff-block");
            const collapsed = block?.classList.toggle("collapsed") ?? false;
            diffToggle.setAttribute("aria-expanded", String(!collapsed));
            refreshIcons();
            return;
        }

        const button = event.target.closest("[data-open-schema-explorer]");
        if (button && state.currentDetailsNode) {
            event.preventDefault();
            openSchemaExplorer(state.currentDetailsNode);
            return;
        }

        const similarButton = event.target.closest("[data-open-similar-models]");
        if (similarButton && state.currentDetailsNode) {
            event.preventDefault();
            openSimilarModelsOverlay(state.currentDetailsNode);
        }
    });
    els.schemaExplorerCloseButton?.addEventListener("click", closeSchemaExplorer);
    els.schemaExplorerOverlay?.addEventListener("click", event => {
        if (event.target === els.schemaExplorerOverlay) {
            closeSchemaExplorer();
        }
    });
    els.schemaExplorerBody?.addEventListener("click", event => {
        const toggle = event.target.closest("[data-schema-toggle]");
        if (!toggle) {
            return;
        }

        event.preventDefault();
        toggleSchemaExplorerRow(toggle.dataset.schemaToggle);
    });
    els.similarModelsCloseButton?.addEventListener("click", closeSimilarModelsOverlay);
    els.similarModelsOverlay?.addEventListener("click", event => {
        if (event.target === els.similarModelsOverlay) {
            closeSimilarModelsOverlay();
        }
    });
    els.similarModelsBody?.addEventListener("click", event => {
        const button = event.target.closest("[data-open-similar-schema]");
        if (!button) {
            return;
        }

        event.preventDefault();
        openSimilarSchema(button.dataset.openSimilarSchema);
    });

    els.clearSelection.addEventListener("click", () => {
        state.selected.clear();
        renderFavorites();
        renderEndpoints();
        renderChangedEndpoints();
        renderModelBrowser();
        renderSelected();
        updateGraph();
    });

    els.depthInput.addEventListener("change", updateGraph);
    els.nodeLimitInput.addEventListener("change", updateGraph);
    els.settingsButton.addEventListener("click", event => {
        event.stopPropagation();
        setSettingsOpen(els.settingsPanel.classList.contains("hidden"));
    });
    els.settingsPanel.addEventListener("click", event => event.stopPropagation());
    els.hideEnumsInput.addEventListener("change", updateGraph);
    els.hideErrorResponsesInput.addEventListener("change", updateGraph);
    els.showOnlyChangedInput?.addEventListener("change", updateGraph);
    els.horizontalGapInput.addEventListener("input", updateGraphGaps);
    els.verticalGapInput.addEventListener("input", updateGraphGaps);
    els.nodeWidthInput.addEventListener("input", updateGraphSizing);
    els.nodeHeightInput.addEventListener("input", updateGraphSizing);
    els.nodeTextSizeInput.addEventListener("input", updateGraphSizing);
    els.edgeTextSizeInput.addEventListener("input", updateGraphSizing);
    els.resetSettingsButton.addEventListener("click", resetGraphSettings);
    els.layoutButton.addEventListener("click", runLayout);
    els.fitButton.addEventListener("click", () => state.cy?.fit(undefined, 40));
    els.showChangesButton?.addEventListener("click", showAllChanges);
    document.addEventListener("click", () => setSettingsOpen(false));
    document.addEventListener("keydown", handleGraphKeyboardShortcut);
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            if (!els.similarModelsOverlay?.classList.contains("hidden")) {
                closeSimilarModelsOverlay();
                return;
            }

            if (!els.schemaExplorerOverlay?.classList.contains("hidden")) {
                closeSchemaExplorer();
                return;
            }

            setSettingsOpen(false);
        }
    });
}

function restorePanelWidths() {
    const widths = readPanelWidths();
    setPanelWidth("left", widths.left);
    setPanelWidth("right", widths.right);
}

function readPanelWidths() {
    try {
        const saved = JSON.parse(localStorage.getItem("openapi-visualizer:panel-widths") || "{}");
        return {
            left: clampPanelWidth(saved.left, panelWidthDefaults.left),
            right: clampPanelWidth(saved.right, panelWidthDefaults.right)
        };
    } catch {
        return { left: panelWidthDefaults.left, right: panelWidthDefaults.right };
    }
}

function savePanelWidths(widths) {
    try {
        localStorage.setItem("openapi-visualizer:panel-widths", JSON.stringify(widths));
    } catch {
        // Panel widths are a local preference; the app should remain usable without storage.
    }
}

function readDetailsCollapsed() {
    try {
        return localStorage.getItem("openapi-visualizer:details-collapsed") === "true";
    } catch {
        return false;
    }
}

function saveDetailsCollapsed(collapsed) {
    try {
        localStorage.setItem("openapi-visualizer:details-collapsed", String(collapsed));
    } catch {
        // Details panel visibility is a local preference; the app should remain usable without storage.
    }
}

function setDetailsPanelCollapsed(collapsed, persist = true) {
    state.detailsCollapsed = collapsed;
    document.body.classList.toggle("details-collapsed", collapsed);
    els.appShell?.classList.toggle("details-collapsed", collapsed);
    els.detailsPanel?.classList.toggle("collapsed", collapsed);
    els.rightResizeHandle?.classList.toggle("collapsed", collapsed);
    els.detailsExpandButton?.classList.toggle("hidden", !collapsed);
    els.detailsExpandButton?.setAttribute("aria-expanded", String(!collapsed));
    els.detailsCollapseButton?.setAttribute("aria-expanded", String(!collapsed));

    if (persist) {
        saveDetailsCollapsed(collapsed);
    }

    window.requestAnimationFrame(() => {
        state.cy?.resize();
        state.cy?.fit(undefined, 40);
    });
}

function setPanelWidth(panel, width) {
    document.documentElement.style.setProperty(`--${panel}-panel-width`, `${clampPanelWidth(width)}px`);
}

function clampPanelWidth(width, fallback = panelWidthDefaults.left) {
    return Math.max(panelWidthDefaults.min, Math.min(panelWidthDefaults.max, Number(width) || fallback));
}

function startPanelResize(event) {
    const panel = event.currentTarget.dataset.resizePanel;
    if (!panel) {
        return;
    }

    if (panel === "right" && state.detailsCollapsed) {
        return;
    }

    event.preventDefault();
    const startX = event.clientX;
    const widths = readPanelWidths();
    const startWidth = widths[panel];
    const handle = event.currentTarget;
    handle.classList.add("active");
    document.body.classList.add("resizing-panels");

    function onMove(moveEvent) {
        const delta = moveEvent.clientX - startX;
        const nextWidth = panel === "left" ? startWidth + delta : startWidth - delta;
        widths[panel] = clampPanelWidth(nextWidth);
        setPanelWidth(panel, widths[panel]);
        state.cy?.resize();
    }

    function onUp() {
        handle.classList.remove("active");
        document.body.classList.remove("resizing-panels");
        savePanelWidths(widths);
        state.cy?.resize();
        state.cy?.fit(undefined, 40);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
}

function setSettingsOpen(open) {
    els.settingsPanel.classList.toggle("hidden", !open);
    els.settingsButton.setAttribute("aria-expanded", String(open));
}

function handleGraphKeyboardShortcut(event) {
    if (event.repeat || isEditableTarget(event.target)) {
        return;
    }

    const key = event.key.toLowerCase();
    if (key !== "i" && key !== "o" && key !== "s") {
        return;
    }

    const data = selectedGraphNodeData();
    if (!data) {
        setStatus("Select a graph node first");
        return;
    }

    event.preventDefault();
    if (key === "i") {
        loadIncomingGraph(data);
    } else if (key === "o") {
        loadOutgoingGraph(data);
    } else {
        openSimilarModelsOverlay(data);
    }
}

function selectedGraphNodeData() {
    const selected = state.cy?.nodes(":selected");
    if (!selected || selected.length === 0) {
        return null;
    }

    return selected[selected.length - 1].data();
}

function isEditableTarget(target) {
    return target instanceof HTMLElement &&
        (target.isContentEditable ||
            ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName));
}

function readFavoriteEndpoints() {
    try {
        return new Set(JSON.parse(localStorage.getItem("openapi-visualizer:favorites") || "[]"));
    } catch {
        return new Set();
    }
}

function saveFavoriteEndpoints() {
    try {
        localStorage.setItem("openapi-visualizer:favorites", JSON.stringify([...state.favorites]));
    } catch {
        // Favorites are a local convenience; graph behavior should still work without storage.
    }
}

function setMethodFiltersCollapsed(collapsed) {
    els.methodFilters.classList.toggle("collapsed", collapsed);
    els.methodFiltersToggle.classList.toggle("collapsed", collapsed);
    els.methodFiltersToggle.setAttribute("aria-expanded", String(!collapsed));
    els.methodFiltersToggle.setAttribute("aria-label", collapsed ? "Show method filters" : "Hide method filters");
    els.methodFiltersToggle.title = collapsed ? "Show method filters" : "Hide method filters";

    const icon = els.methodFiltersToggle.querySelector("i, svg");
    if (icon) {
        icon.setAttribute("data-lucide", collapsed ? "chevron-down" : "chevron-up");
    }
    refreshIcons();
}

function refreshIcons() {
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

function toggleSection(sectionName) {
    if (!sectionName) {
        return;
    }

    if (state.collapsedSections.has(sectionName)) {
        state.collapsedSections.delete(sectionName);
    } else {
        state.collapsedSections.add(sectionName);
    }

    renderSectionCollapse();
}

function renderSectionCollapse() {
    document.querySelectorAll(".collapsible-section").forEach(section => {
        const sectionName = section.dataset.section;
        const collapsed = state.collapsedSections.has(sectionName);
        section.classList.toggle("collapsed", collapsed);
        section.querySelectorAll("[data-toggle-section]").forEach(button => {
            button.setAttribute("aria-expanded", String(!collapsed));
        });
    });
}

function updateGraphGaps() {
    els.horizontalGapValue.textContent = Number.parseFloat(els.horizontalGapInput.value).toFixed(1);
    els.verticalGapValue.textContent = Number.parseFloat(els.verticalGapInput.value).toFixed(1);
    runLayout();
}

function updateGraphSizing() {
    syncGraphSizingLabels();
    if (state.lastGraph) {
        renderGraph(state.lastGraph);
    }
}

function syncGraphSizingLabels() {
    els.nodeWidthValue.textContent = Number.parseFloat(els.nodeWidthInput.value).toFixed(1);
    els.nodeHeightValue.textContent = Number.parseFloat(els.nodeHeightInput.value).toFixed(1);
    els.nodeTextSizeValue.textContent = Number.parseFloat(els.nodeTextSizeInput.value).toFixed(1);
    els.edgeTextSizeValue.textContent = Number.parseFloat(els.edgeTextSizeInput.value).toFixed(1);
}

function resetGraphSettings() {
    els.hideEnumsInput.checked = graphSettingDefaults.hideEnums;
    els.hideErrorResponsesInput.checked = graphSettingDefaults.hideErrorResponses;
    if (els.showOnlyChangedInput) {
        els.showOnlyChangedInput.checked = graphSettingDefaults.showOnlyChanged;
    }
    els.horizontalGapInput.value = String(graphSettingDefaults.horizontalGap);
    els.verticalGapInput.value = String(graphSettingDefaults.verticalGap);
    els.nodeWidthInput.value = String(graphSettingDefaults.nodeWidth);
    els.nodeHeightInput.value = String(graphSettingDefaults.nodeHeight);
    els.nodeTextSizeInput.value = String(graphSettingDefaults.nodeTextSize);
    els.edgeTextSizeInput.value = String(graphSettingDefaults.edgeTextSize);
    syncGraphSizingLabels();
    els.horizontalGapValue.textContent = graphSettingDefaults.horizontalGap.toFixed(1);
    els.verticalGapValue.textContent = graphSettingDefaults.verticalGap.toFixed(1);
    updateGraph();
}

async function importSpec() {
    const file = els.fileInput.files?.[0];
    if (!file) {
        return;
    }

    setStatus("Importing");
    els.fileLabel.textContent = file.name;

    const form = new FormData();
    form.append("file", file);

    try {
        const response = await fetch("/api/specs/import", {
            method: "POST",
            body: form
        });

        if (!response.ok) {
            throw new Error(await response.text());
        }

        const summary = await response.json();
        state.specId = summary.specId;
        state.compareSpecId = null;
        state.changedEndpoints = [];
        state.changedModels = [];
        state.affectedModels = [];
        state.modelTab = "all";
        state.selected.clear();
        state.currentDetailsNode = null;
        state.schemaCache.clear();
        state.schemaExplorerLoadErrors.clear();
        closeSchemaExplorer();
        renderDiffControls();
        renderSpecMeta(summary);
        await loadAllEndpoints();
        await loadEndpoints();
        await loadModels();
        renderChangedEndpoints();
        renderModelBrowser();
        renderSelected();
        updateGraph();
        setStatus("Ready");
    } catch (error) {
        console.error(error);
        setStatus("Import failed");
        els.specMeta.textContent = "Import failed";
        els.specMeta.title = "";
    }
}

async function importComparisonSpec() {
    const file = els.compareFileInput?.files?.[0];
    if (!file || !state.specId) {
        return;
    }

    setStatus("Comparing");

    const form = new FormData();
    form.append("file", file);

    try {
        const response = await fetch(`/api/specs/${state.specId}/compare`, {
            method: "POST",
            body: form
        });

        if (!response.ok) {
            throw new Error(await response.text());
        }

        const diff = await response.json();
        state.compareSpecId = diff.compareSpecId;
        state.changedEndpoints = diff.changedEndpoints || [];
        state.changedModels = diff.changedSchemas || [];
        state.affectedModels = diff.affectedSchemas || [];
        state.schemaCache.clear();
        state.schemaExplorerLoadErrors.clear();
        closeSchemaExplorer();
        renderDiffControls();
        renderChangedEndpoints();
        renderFavorites();
        renderEndpoints();
        renderModelBrowser();
        renderSelected();
        updateGraph();
        setStatus("Diff ready");
    } catch (error) {
        console.error(error);
        setStatus("Compare failed");
    } finally {
        if (els.compareFileInput) {
            els.compareFileInput.value = "";
        }
    }
}

function clearDiff() {
    state.compareSpecId = null;
    state.changedEndpoints = [];
    state.changedModels = [];
    state.affectedModels = [];
    state.modelTab = "all";
    state.schemaCache.clear();
    state.schemaExplorerLoadErrors.clear();
    closeSchemaExplorer();
    renderDiffControls();
    renderProvenance(null);
    renderChangedEndpoints();
    renderFavorites();
    renderEndpoints();
    renderModelBrowser();
    renderSelected();
    updateGraph();
}

function renderDiffControls() {
    els.compareButton?.classList.toggle("hidden", !state.specId);
    els.compareButton?.classList.toggle("danger", Boolean(state.compareSpecId));
    els.showChangesButton?.classList.toggle("hidden", !state.compareSpecId);
    els.showOnlyChangedInput?.toggleAttribute("disabled", !state.compareSpecId);
    if (els.compareLabel) {
        els.compareLabel.textContent = state.compareSpecId ? "Clear diff" : "View diff";
    }
}

async function loadDiffSources() {
    if (!els.repoPanel || !els.diffSourceSelect) {
        return;
    }

    let sources = [];
    try {
        const response = await fetch("/api/diff/sources");
        sources = response.ok ? await response.json() : [];
    } catch (error) {
        console.error(error);
    }

    // The panel only makes sense when the server has repositories configured.
    if (sources.length === 0) {
        els.repoPanel.hidden = true;
        return;
    }

    els.diffSourceSelect.innerHTML = "";
    for (const source of sources) {
        const option = document.createElement("option");
        option.value = source.name;
        option.textContent = source.name;
        option.dataset.supportsPullRequests = String(source.supportsPullRequests);
        els.diffSourceSelect.appendChild(option);
    }

    els.repoPanel.hidden = false;
    els.diffSourceSelect.addEventListener("change", renderRepoSourceCapabilities);
    renderRepoSourceCapabilities();
    refreshIcons();
}

function renderRepoSourceCapabilities() {
    const option = els.diffSourceSelect?.selectedOptions?.[0];
    const supportsPullRequests = option?.dataset.supportsPullRequests !== "false";
    els.prInput?.toggleAttribute("disabled", !supportsPullRequests);
    els.prLoadButton?.toggleAttribute("disabled", !supportsPullRequests);
    if (els.prInput) {
        els.prInput.placeholder = supportsPullRequests
            ? "Pull request number"
            : "No Azure DevOps configured";
    }
}

function loadPullRequestDiff() {
    const pullRequestId = Number.parseInt(els.prInput?.value ?? "", 10);
    if (!Number.isInteger(pullRequestId) || pullRequestId <= 0) {
        setRepoStatus("Enter a pull request number.", true);
        return;
    }

    return requestRepoDiff("/api/diff/from-pr", {
        source: els.diffSourceSelect?.value,
        pullRequestId
    }, `Preparing PR ${pullRequestId}`);
}

function loadRefDiff() {
    const baseRef = els.baseRefInput?.value.trim();
    const headRef = els.headRefInput?.value.trim();
    if (!baseRef || !headRef) {
        setRepoStatus("Enter both a base ref and a head ref.", true);
        return;
    }

    return requestRepoDiff("/api/diff/from-refs", {
        source: els.diffSourceSelect?.value,
        baseRef,
        headRef
    }, `Comparing ${baseRef} to ${headRef}`);
}

async function requestRepoDiff(url, body, busyLabel) {
    setRepoBusy(true);
    // A cold build clones nothing but does bundle thousands of files, so say what is happening.
    setRepoStatus(`${busyLabel} - building specs, this can take a while on first use.`, false);
    setStatus(busyLabel);

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
            throw new Error(payload?.error || `Request failed with status ${response.status}`);
        }

        await applyPreparedDiff(payload);
        setRepoStatus("", false);
        setStatus("Diff ready");
    } catch (error) {
        console.error(error);
        setRepoStatus(error.message || "Failed to prepare the diff.", true);
        setStatus("Diff failed");
    } finally {
        setRepoBusy(false);
    }
}

async function applyPreparedDiff(diff) {
    state.specId = diff.baseSpecId;
    state.compareSpecId = diff.compareSpecId;
    state.changedEndpoints = diff.changedEndpoints || [];
    state.changedModels = diff.changedSchemas || [];
    state.affectedModels = diff.affectedSchemas || [];
    state.selected.clear();
    state.currentDetailsNode = null;
    state.schemaCache.clear();
    state.schemaExplorerLoadErrors.clear();
    // The changed and affected endpoint lists are the point of a prepared diff, so open those sections.
    state.collapsedSections.delete("changed");
    state.collapsedSections.delete("affected");
    state.collapsedSections.delete("models");
    closeSchemaExplorer();

    renderSectionCollapse();
    renderDiffControls();
    renderProvenance(diff.provenance);
    renderSpecMeta(diff.provenance?.baseSummary || diff.compareSummary);
    if (els.fileLabel) {
        els.fileLabel.textContent = diff.provenance?.sourceName || "Load JSON spec";
    }

    await loadAllEndpoints();
    await loadEndpoints();
    await loadModels();
    renderChangedEndpoints();
    renderModelBrowser();
    renderSelected();
    updateGraph();
}

function setRepoBusy(busy) {
    els.prLoadButton?.toggleAttribute("disabled", busy);
    els.refLoadButton?.toggleAttribute("disabled", busy);
    els.repoPanel?.classList.toggle("busy", busy);
    if (!busy) {
        renderRepoSourceCapabilities();
    }
}

function setRepoStatus(message, isError) {
    if (!els.repoStatus) {
        return;
    }

    els.repoStatus.textContent = message || "";
    els.repoStatus.classList.toggle("hidden", !message);
    els.repoStatus.classList.toggle("error", Boolean(isError));
}

function renderProvenance(provenance) {
    if (!els.diffProvenance) {
        return;
    }

    if (!provenance) {
        els.diffProvenance.innerHTML = "";
        els.diffProvenance.classList.add("hidden");
        return;
    }

    const short = commit => String(commit ?? "").slice(0, 8);
    const rows = [];

    if (provenance.pullRequestId) {
        rows.push(`<div class="provenance-title">PR ${provenance.pullRequestId}: ${escapeHtml(provenance.pullRequestTitle)}</div>`);
    }

    rows.push(`
        <div class="provenance-pair">
            <span class="provenance-side">
                <span class="provenance-label">${escapeHtml(provenance.baseLabel)}</span>
                <code>${short(provenance.baseCommit)}</code>
            </span>
            <i data-lucide="arrow-right"></i>
            <span class="provenance-side">
                <span class="provenance-label">${escapeHtml(provenance.headLabel)}</span>
                <code>${short(provenance.headCommit)}</code>
            </span>
        </div>`);

    const cached = provenance.baseFromCache && provenance.headFromCache
        ? "cached"
        : provenance.baseFromCache || provenance.headFromCache
            ? "partly cached"
            : "freshly built";
    rows.push(`<div class="provenance-meta">${escapeHtml(provenance.baseStrategy)} &middot; ${cached} in ${provenance.prepareSeconds}s</div>`);

    els.diffProvenance.innerHTML = rows.join("");
    els.diffProvenance.classList.remove("hidden");
    refreshIcons();
}

function renderSpecMeta(summary) {
    els.specMeta.textContent = summary.title || "OpenAPI spec";
    els.specMeta.title = [
        summary.version ? `Version: ${summary.version}` : "",
        `${summary.endpointCount} endpoints`,
        `${summary.schemaCount} schemas`,
        `${summary.cycleCount} cycles`
    ].filter(value => String(value || "").trim().length > 0).join(" - ");
}

async function loadEndpoints() {
    if (!state.specId) {
        state.endpoints = [];
        state.allEndpoints = [];
        renderFavorites();
        renderEndpoints();
        return;
    }

    const params = new URLSearchParams();
    params.set("limit", "180");
    if (els.endpointSearch.value.trim()) {
        params.set("query", els.endpointSearch.value.trim());
    }
    if (state.method) {
        params.set("method", state.method);
    }

    const response = await fetch(`/api/specs/${state.specId}/endpoints?${params}`);
    state.endpoints = response.ok ? await response.json() : [];
    renderFavorites();
    renderEndpoints();
}

async function loadAllEndpoints() {
    if (!state.specId) {
        state.allEndpoints = [];
        renderFavorites();
        return;
    }

    const response = await fetch(`/api/specs/${state.specId}/endpoints?limit=500`);
    state.allEndpoints = response.ok ? await response.json() : [];
    renderFavorites();
}

async function loadModels() {
    if (!state.specId) {
        state.models = [];
        renderModelBrowser();
        return;
    }

    const params = new URLSearchParams();
    params.set("limit", "180");
    if (els.endpointSearch.value.trim()) {
        params.set("query", els.endpointSearch.value.trim());
    }

    const response = await fetch(`/api/specs/${state.specId}/models?${params}`);
    state.models = response.ok ? await response.json() : [];
    renderModelBrowser();
}

function renderEndpoints() {
    els.endpointCount.textContent = state.endpoints.length.toString();
    els.endpointList.innerHTML = "";

    for (const endpoint of state.endpoints) {
        els.endpointList.appendChild(createEndpointRow(withKnownEndpointDiff(endpoint)));
    }

    refreshIcons();
}

function renderFavorites() {
    const favorites = state.allEndpoints.filter(endpoint => state.favorites.has(endpoint.id)).map(withKnownEndpointDiff);
    els.favoriteCount.textContent = favorites.length.toString();
    els.favoriteList.innerHTML = "";

    if (favorites.length === 0) {
        els.favoriteList.innerHTML = `<div class="empty-list">No favorites</div>`;
        return;
    }

    for (const endpoint of favorites) {
        els.favoriteList.appendChild(createEndpointRow(endpoint));
    }

    refreshIcons();
}

function renderChangedEndpoints() {
    if (!els.changedEndpointSection || !els.changedEndpointList || !els.changedEndpointCount ||
        !els.affectedEndpointSection || !els.affectedEndpointList || !els.affectedEndpointCount) {
        return;
    }

    const endpoints = state.changedEndpoints || [];
    const changed = endpoints.filter(endpoint => endpoint.diffState !== "affected");
    const affected = endpoints.filter(endpoint => endpoint.diffState === "affected");

    renderEndpointDiffList(
        els.changedEndpointSection,
        els.changedEndpointList,
        els.changedEndpointCount,
        changed,
        "No endpoint changes");
    renderEndpointDiffList(
        els.affectedEndpointSection,
        els.affectedEndpointList,
        els.affectedEndpointCount,
        affected,
        "No affected endpoints");

    refreshIcons();
}

function renderModelBrowser() {
    if (!els.modelList || !els.modelCount) {
        return;
    }

    const models = currentModelList();
    els.modelCount.textContent = models.length.toString();
    els.modelTabs?.forEach(button => {
        const tab = button.dataset.modelTab || "all";
        button.classList.toggle("active", tab === state.modelTab);
        button.setAttribute("aria-selected", String(tab === state.modelTab));
        button.disabled = tab !== "all" && !state.compareSpecId;
    });

    els.modelList.innerHTML = "";
    if (models.length === 0) {
        els.modelList.innerHTML = `<div class="empty-list">${escapeHtml(modelEmptyText())}</div>`;
        return;
    }

    for (const model of models) {
        els.modelList.appendChild(createModelRow(withKnownModelDiff(model)));
    }

    refreshIcons();
}

function currentModelList() {
    if (state.modelTab === "changed") {
        return state.changedModels || [];
    }

    if (state.modelTab === "affected") {
        return state.affectedModels || [];
    }

    return state.models || [];
}

function modelEmptyText() {
    if (state.modelTab === "changed") {
        return state.compareSpecId ? "No changed models" : "Load a diff to see changed models";
    }

    if (state.modelTab === "affected") {
        return state.compareSpecId ? "No affected models" : "Load a diff to see affected models";
    }

    return "No models";
}

function renderEndpointDiffList(section, list, count, endpoints, emptyText) {
    section.classList.toggle("hidden", endpoints.length === 0);
    count.textContent = endpoints.length.toString();
    list.innerHTML = "";
    if (endpoints.length === 0) {
        list.innerHTML = `<div class="empty-list">${escapeHtml(emptyText)}</div>`;
        return;
    }

    for (const endpoint of endpoints) {
        list.appendChild(createEndpointRow(endpoint));
    }
}

function createEndpointRow(endpoint) {
    const selected = state.selected.has(endpoint.id);
    const row = document.createElement("div");
    row.className = `endpoint-row ${selected ? "selected" : ""} ${diffClass(endpoint.diffState)}`;

    const favoriteButton = document.createElement("button");
    favoriteButton.className = `favorite-button ${state.favorites.has(endpoint.id) ? "active" : ""}`;
    favoriteButton.type = "button";
    favoriteButton.title = state.favorites.has(endpoint.id) ? "Remove favorite" : "Add favorite";
    favoriteButton.setAttribute("aria-label", favoriteButton.title);
    favoriteButton.innerHTML = `<i data-lucide="star"></i>`;
    favoriteButton.addEventListener("click", () => toggleFavorite(endpoint.id));

    const button = document.createElement("button");
    button.className = "endpoint-item";
    button.type = "button";
    button.setAttribute("aria-pressed", String(selected));
    button.innerHTML = `
        <span class="method-badge ${escapeHtml(endpoint.method)}">${escapeHtml(endpoint.method)}</span>
        <span class="endpoint-main">
            <span class="endpoint-path">${escapeHtml(endpoint.path)}</span>
            <span class="endpoint-summary">${escapeHtml(endpoint.summary || endpoint.operationId || endpoint.tags?.[0] || "")}</span>
        </span>
        <span class="endpoint-row-state">
            ${renderDiffBadge(endpoint.diffState)}
        </span>
    `;
    button.addEventListener("click", () => toggleEndpoint(endpoint));
    row.append(favoriteButton, button);
    return row;
}

function createModelRow(model) {
    const normalized = normalizeModel(model);
    const selected = state.selected.has(normalized.id);
    const row = document.createElement("div");
    row.className = `model-row ${selected ? "selected" : ""} ${diffClass(normalized.diffState)}`;

    const button = document.createElement("button");
    button.className = "model-item";
    button.type = "button";
    button.setAttribute("aria-pressed", String(selected));
    button.innerHTML = `
        <span class="model-type-badge">${escapeHtml(normalized.type || "MODEL")}</span>
        <span class="model-main">
            <span class="model-name">${escapeHtml(normalized.label)}</span>
            <span class="model-summary">${escapeHtml(normalized.subtitle || "")}</span>
        </span>
        <span class="endpoint-row-state">
            ${renderDiffBadge(normalized.diffState)}
        </span>
    `;
    button.addEventListener("click", () => toggleModel(normalized));
    row.appendChild(button);
    return row;
}

function withKnownEndpointDiff(endpoint) {
    const changed = state.changedEndpoints?.find(item => item.id === endpoint.id);
    return changed ? { ...endpoint, diffState: changed.diffState, diffEntries: changed.diffEntries || [] } : endpoint;
}

function withKnownModelDiff(model) {
    const normalized = normalizeModel(model);
    const changed = state.changedModels?.find(item => item.id === normalized.id);
    const affected = state.affectedModels?.find(item => item.id === normalized.id);
    const known = changed || affected;
    return known ? { ...normalized, diffState: known.diffState, diffEntries: known.diffEntries || [] } : normalized;
}

function normalizeModel(model) {
    const id = model.id || model.schemaId || `schema:${model.name || model.label || ""}`;
    const properties = model.properties || [];
    const enumValues = model.enumValues || [];
    const label = model.label || model.name || stripSchemaPrefix(id);
    return {
        ...model,
        id,
        kind: "schema",
        label,
        rawLabel: model.rawLabel || label,
        subtitle: model.subtitle || schemaSubtitle(model, properties, enumValues),
        type: model.type,
        properties,
        enumValues,
        diffEntries: model.diffEntries || []
    };
}

function toggleFavorite(endpointId) {
    if (state.favorites.has(endpointId)) {
        state.favorites.delete(endpointId);
    } else {
        state.favorites.add(endpointId);
    }

    saveFavoriteEndpoints();
    renderFavorites();
    renderEndpoints();
}

function toggleEndpoint(endpoint) {
    if (state.selected.has(endpoint.id)) {
        state.selected.delete(endpoint.id);
    } else {
        state.selected.set(endpoint.id, { ...withKnownEndpointDiff(endpoint), kind: "endpoint" });
    }

    renderFavorites();
    renderEndpoints();
    renderChangedEndpoints();
    renderModelBrowser();
    renderSelected();
    updateGraph();
}

function toggleModel(model) {
    const normalized = withKnownModelDiff(model);
    if (state.selected.has(normalized.id)) {
        state.selected.delete(normalized.id);
    } else {
        state.selected.set(normalized.id, normalized);
    }

    renderFavorites();
    renderEndpoints();
    renderChangedEndpoints();
    renderModelBrowser();
    renderSelected();
    updateGraph();
}

function renderSelected() {
    els.selectedList.innerHTML = "";
    els.selectedCount.textContent = state.selected.size.toString();

    if (state.selected.size === 0) {
        els.selectedList.innerHTML = `<div class="empty-list">No selected endpoints or models</div>`;
        return;
    }

    for (const item of state.selected.values()) {
        const isModel = isModelItem(item);
        const annotated = isModel ? withKnownModelDiff(item) : withKnownEndpointDiff(item);
        const button = document.createElement("button");
        button.className = `selected-item ${isModel ? "model-selected-item" : ""} ${diffClass(annotated.diffState)}`;
        button.type = "button";
        button.innerHTML = isModel
            ? `
            <span class="model-type-badge">${escapeHtml(annotated.type || "MODEL")}</span>
            <span class="model-main">
                <span class="model-name">${escapeHtml(annotated.label)}</span>
            </span>
            ${renderDiffBadge(annotated.diffState)}
        `
            : `
            <span class="method-badge ${escapeHtml(annotated.method)}">${escapeHtml(annotated.method)}</span>
            <span class="endpoint-main">
                <span class="endpoint-path">${escapeHtml(annotated.path)}</span>
            </span>
            ${renderDiffBadge(annotated.diffState)}
        `;
        button.addEventListener("click", () => isModel ? toggleModel(annotated) : toggleEndpoint(annotated));
        els.selectedList.appendChild(button);
    }
}

function isModelItem(item) {
    return item?.kind === "schema" || String(item?.id || "").startsWith("schema:");
}

function showAllChanges() {
    if (!state.compareSpecId) {
        return;
    }

    state.selected.clear();
    for (const endpoint of state.changedEndpoints || []) {
        state.selected.set(endpoint.id, { ...endpoint, kind: "endpoint" });
    }
    for (const model of [...(state.changedModels || []), ...(state.affectedModels || [])]) {
        const normalized = normalizeModel(model);
        state.selected.set(normalized.id, normalized);
    }

    state.collapsedSections.delete("changed");
    state.collapsedSections.delete("affected");
    state.collapsedSections.delete("models");
    state.collapsedSections.delete("selected");
    renderSectionCollapse();
    renderFavorites();
    renderEndpoints();
    renderChangedEndpoints();
    renderModelBrowser();
    renderSelected();
    updateGraph();
}

function initializeGraph() {
    state.cy = cytoscape({
        container: els.graph,
        elements: [],
        minZoom: 0.08,
        maxZoom: 2.5,
        wheelSensitivity: 0.16,
        style: [
            {
                selector: "node",
                style: {
                    "label": "data(label)",
                    "font-size": "data(fontSize)",
                    "font-family": "Segoe UI, system-ui, sans-serif",
                    "text-wrap": "wrap",
                    "text-max-width": "data(textMaxWidth)",
                    "text-valign": "center",
                    "text-halign": "center",
                    "color": "#23362b",
                    "font-weight": "bold",
                    "background-color": "#f8fafc",
                    "border-width": 2,
                    "border-color": "#315f86",
                    "width": "data(width)",
                    "height": "data(height)",
                    "shape": "round-rectangle",
                    "overlay-padding": 6
                }
            },
            {
                selector: "node[kind = 'endpoint']",
                style: {
                    "shape": "round-rectangle",
                    "label": "",
                    "background-color": "#efeeea",
                    "background-image": "data(cardImage)",
                    "background-fit": "cover",
                    "background-clip": "none",
                    "border-width": 0,
                    "color": "#23362b",
                    "text-outline-width": 0
                }
            },
            {
                selector: ".enum-node",
                style: {
                    "shape": "round-rectangle",
                    "background-color": "#efeeea",
                    "border-color": "#7c3aed"
                }
            },
            { selector: "node[method = 'GET']", style: { "background-color": "#ebf4ff" } },
            { selector: "node[method = 'POST']", style: { "background-color": "#e8f7f0" } },
            { selector: "node[method = 'PUT']", style: { "background-color": "#fff5e6" } },
            { selector: "node[method = 'PATCH']", style: { "background-color": "#e7fbf7" } },
            { selector: "node[method = 'DELETE']", style: { "background-color": "#fff0f0" } },
            {
                selector: "node[cycleId]",
                style: {
                    "border-color": "#23362b",
                    "border-style": "solid",
                    "border-width": 2
                }
            },
            {
                selector: "edge",
                style: {
                    "curve-style": "bezier",
                    "target-arrow-shape": "triangle",
                    "target-arrow-color": "#334155",
                    "line-color": "#334155",
                    "width": 2.4,
                    "label": "data(label)",
                    "font-size": "data(edgeFontSize)",
                    "font-weight": "bold",
                    "font-family": "Segoe UI, system-ui, sans-serif",
                    "color": "#23362b",
                    "text-background-color": "#efeeea",
                    "text-background-opacity": 1,
                    "text-background-padding": 4,
                    "text-rotation": "autorotate",
                    "text-margin-y": -12,
                    "overlay-padding": 4
                }
            },
            { selector: "edge[kind = 'Property']", style: { "line-color": "#315f86", "target-arrow-color": "#315f86" } },
            { selector: "edge[kind = 'ArrayItem']", style: { "line-color": "#23362b", "target-arrow-color": "#23362b" } },
            { selector: "edge[kind = 'Inheritance']", style: { "line-color": "#7c3aed", "target-arrow-color": "#7c3aed", "width": 4, "font-size": "data(inheritanceFontSize)", "font-weight": "bold" } },
            { selector: "edge[kind = 'AllOf']", style: { "line-color": "#3b82f6", "target-arrow-color": "#3b82f6", "line-style": "dashed" } },
            { selector: "edge[kind = 'OneOf']", style: { "line-color": "#475569", "target-arrow-color": "#475569", "line-style": "dotted" } },
            { selector: "edge[kind = 'AnyOf']", style: { "line-color": "#8b5cf6", "target-arrow-color": "#8b5cf6", "line-style": "dotted" } },
            { selector: "edge[kind = 'ResponseBody']", style: { "line-color": "#3b82f6", "target-arrow-color": "#3b82f6", "width": 2.6 } },
            { selector: "edge[kind = 'RequestBody']", style: { "line-color": "#7c3aed", "target-arrow-color": "#7c3aed", "width": 2.6 } },
            { selector: "edge[kind = 'Parameter']", style: { "line-color": "#0891b2", "target-arrow-color": "#0891b2" } },
            {
                selector: "node[diffState = 'added']",
                style: {
                    "border-width": 3,
                    "border-color": "#047857",
                    "background-color": "#d1fae5"
                }
            },
            {
                selector: "node[diffState = 'deleted']",
                style: {
                    "border-width": 3,
                    "border-color": "#b91c1c",
                    "border-style": "dashed",
                    "background-color": "#fee2e2",
                    "opacity": 0.9
                }
            },
            {
                selector: "node[diffState = 'modified']",
                style: {
                    "border-width": 3,
                    "border-color": "#b45309",
                    "background-color": "#fef3c7"
                }
            },
            {
                selector: "node[diffState = 'affected']",
                style: {
                    "border-width": 3,
                    "border-color": "#2563eb",
                    "border-style": "dotted",
                    "background-color": "#dbeafe"
                }
            },
            {
                selector: "edge[diffState = 'added']",
                style: {
                    "line-color": "#047857",
                    "target-arrow-color": "#047857",
                    "width": 4
                }
            },
            {
                selector: "edge[diffState = 'deleted']",
                style: {
                    "line-color": "#b91c1c",
                    "target-arrow-color": "#b91c1c",
                    "line-style": "dashed",
                    "width": 4,
                    "opacity": 0.92
                }
            },
            {
                selector: ":selected",
                style: {
                    "border-color": "#23362b",
                    "border-width": 3,
                    "line-color": "#23362b",
                    "target-arrow-color": "#23362b"
                }
            }
        ]
    });

    els.graphNodeActions = document.createElement("div");
    els.graphNodeActions.id = "graphNodeActions";
    els.graphNodeActions.className = "graph-node-actions";
    els.graph.appendChild(els.graphNodeActions);

    state.cy.on("tap", "node", event => {
        state.cy.nodes().unselect();
        event.target.select();
        renderDetails(event.target.data());
    });
    state.cy.on("tap", "edge", event => renderEdgeDetails(event.target.data()));
    state.cy.on("pan zoom resize position render", updateGraphNodeActionPositions);
}

async function updateGraph() {
    if (!state.specId || state.selected.size === 0) {
        state.lastGraph = null;
        state.graphLayoutRootIds = [];
        state.graphFocusNodeId = null;
        state.cy.elements().remove();
        renderGraphNodeActions();
        els.emptyGraph.classList.remove("hidden");
        setStatus("Idle");
        renderDetails(null);
        return;
    }

    setStatus("Loading graph");
    const allReachable = els.depthInput.value === "all";
    const selectedItems = [...state.selected.values()];
    const selectedEndpointIds = selectedItems.filter(item => !isModelItem(item)).map(item => item.id);
    const selectedSchemaIds = selectedItems.filter(isModelItem).map(item => item.id);
    const body = {
        endpointIds: selectedEndpointIds,
        schemaIds: selectedSchemaIds,
        depth: allReachable ? 0 : Number.parseInt(els.depthInput.value, 10) || 4,
        maxNodes: Number.parseInt(els.nodeLimitInput.value, 10) || 250,
        includeProperties: true,
        allReachable,
        hideEnums: els.hideEnumsInput.checked,
        hideErrorResponses: els.hideErrorResponsesInput.checked,
        showOnlyChanged: Boolean(state.compareSpecId && els.showOnlyChangedInput?.checked)
    };
    if (state.compareSpecId) {
        body.compareSpecId = state.compareSpecId;
    }

    const response = await fetch(`/api/specs/${state.specId}/graph`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        setStatus("Graph failed");
        return;
    }

    const graph = await response.json();
    state.lastGraph = graph;
    state.graphLayoutRootIds = selectedEndpointIds.length > 0 ? selectedEndpointIds : selectedSchemaIds;
    state.graphFocusNodeId = null;
    renderGraph(graph);
}

async function loadIncomingGraph(data) {
    return loadReferenceGraph(data, "incoming");
}

async function loadOutgoingGraph(data) {
    return loadReferenceGraph(data, "outgoing");
}

async function loadReferenceGraph(data, direction) {
    if (!state.specId || !data) {
        return;
    }

    const label = data.rawLabel || data.label;
    const body = {
        depth: 0,
        maxNodes: Number.parseInt(els.nodeLimitInput.value, 10) || 250,
        includeProperties: true,
        allReachable: true,
        hideEnums: els.hideEnumsInput.checked,
        hideErrorResponses: els.hideErrorResponsesInput.checked,
        showOnlyChanged: false
    };

    if (isSchemaNode(data)) {
        body[direction === "incoming" ? "incomingSchemaId" : "outgoingSchemaId"] = data.id;
    } else if (direction === "outgoing" && data.kind === "endpoint") {
        body.endpointIds = [data.id];
    } else {
        setStatus("Incoming references are available for model nodes");
        return;
    }

    if (state.compareSpecId) {
        body.compareSpecId = state.compareSpecId;
    }

    setStatus(`Loading ${direction} references for ${label}`);
    renderDetails(data);

    const response = await fetch(`/api/specs/${state.specId}/graph`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        setStatus(`${direction === "incoming" ? "Incoming" : "Outgoing"} graph failed`);
        return;
    }

    const graph = await response.json();
    state.lastGraph = graph;
    state.graphLayoutRootIds = direction === "outgoing" && isSchemaNode(data) ? [data.id] : [];
    state.graphFocusNodeId = isSchemaNode(data) ? data.id : null;
    renderGraph(graph);
}

function renderGraph(graph) {
    els.emptyGraph.classList.toggle("hidden", graph.nodes.length > 0);
    const edgeTextSize = graphSettingScale(els.edgeTextSizeInput, graphSettingDefaults.edgeTextSize);
    const edgeFontSize = Math.round(13 * edgeTextSize * 10) / 10;
    const inheritanceFontSize = Math.round(15 * edgeTextSize * 10) / 10;

    const elements = [
        ...graph.nodes.map(node => {
            const metrics = nodeMetrics(node);
            return {
                group: "nodes",
                classes: node.enumValues?.length ? "enum-node" : "",
                data: {
                    id: node.id,
                    kind: node.kind,
                    label: metrics.label,
                    rawLabel: node.label,
                    subtitle: node.subtitle,
                    method: node.method,
                    cycleId: node.cycleId,
                    properties: node.properties || [],
                    enumValues: node.enumValues || [],
                    enumCount: node.enumValues?.length || 0,
                    diffState: node.diffState || "",
                    diffEntries: node.diffEntries || [],
                    width: metrics.width,
                    height: metrics.height,
                    textMaxWidth: metrics.textMaxWidth,
                    fontSize: metrics.fontSize,
                    cardImage: metrics.cardImage || "",
                    tags: node.tags || []
                }
            };
        }),
        ...graph.edges.map(edge => ({
            group: "edges",
            data: {
                id: edge.id,
                source: edge.source,
                target: edge.target,
                kind: edge.kind,
                label: shortEdgeLabel(edge.label),
                fullLabel: edge.label,
                diffState: edge.diffState || "",
                edgeFontSize,
                inheritanceFontSize
            }
        }))
    ];

    state.cy.elements().remove();
    state.cy.add(elements);
    if (state.graphFocusNodeId) {
        const focusNode = state.cy.getElementById(state.graphFocusNodeId);
        if (focusNode.length > 0) {
            focusNode.select();
        }
    }
    renderGraphNodeActions();
    runLayout();

    const warning = graph.warnings?.[0] ? ` - ${graph.warnings[0]}` : "";
    setStatus(`${graph.nodes.length} nodes - ${graph.edges.length} edges - ${graph.cycles.length} cycles${warning}`);
}

function renderGraphNodeActions() {
    if (!els.graphNodeActions || !state.cy) {
        return;
    }

    els.graphNodeActions.innerHTML = "";
    state.cy.nodes().forEach(node => {
        const data = node.data();
        const copyText = graphNodeCopyText(data);
        if (!copyText) {
            return;
        }

        const button = document.createElement("button");
        button.className = "graph-node-copy-button";
        button.type = "button";
        button.dataset.nodeId = node.id();
        button.dataset.copyText = copyText;
        button.title = data.kind === "endpoint" ? "Copy endpoint path" : "Copy model name";
        button.setAttribute("aria-label", button.title);
        button.innerHTML = `<i data-lucide="copy"></i>`;
        stopGraphPointerEvents(button);
        button.addEventListener("click", async event => {
            event.preventDefault();
            event.stopPropagation();
            await copyGraphNodeText(button);
        });
        els.graphNodeActions.appendChild(button);
    });

    updateGraphNodeActionPositions();
    refreshIcons();
}

function updateGraphNodeActionPositions() {
    if (!els.graphNodeActions || !state.cy) {
        return;
    }

    els.graphNodeActions.querySelectorAll(".graph-node-copy-button").forEach(button => {
        const node = state.cy.getElementById(button.dataset.nodeId);
        if (!node || node.empty() || !node.visible()) {
            button.classList.add("hidden");
            return;
        }

        const position = node.renderedPosition();
        const zoom = state.cy.zoom();
        const renderedWidth = node.renderedWidth();
        const renderedHeight = node.renderedHeight();
        const size = graphNodeCopyButtonSize(renderedWidth, renderedHeight);
        if (size === 0) {
            button.classList.add("hidden");
            return;
        }

        const inset = Math.max(3, Math.round(size * 0.18));
        const x = position.x + renderedWidth / 2 - size - inset;
        const y = position.y + renderedHeight / 2 - size - inset;

        button.classList.toggle("hidden", !Number.isFinite(x) || !Number.isFinite(y));
        button.style.setProperty("--copy-button-size", `${size}px`);
        button.style.setProperty("--copy-icon-size", `${Math.max(8, Math.round(size * 0.58))}px`);
        button.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    });
}

function stopGraphPointerEvents(element) {
    for (const eventName of ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend", "dblclick"]) {
        element.addEventListener(eventName, event => {
            event.stopPropagation();
        });
    }
}

function graphNodeCopyButtonSize(renderedWidth, renderedHeight) {
    const maxContainedSize = Math.min(renderedWidth, renderedHeight) - 8;
    if (maxContainedSize < 14) {
        return 0;
    }

    return Math.round(Math.min(20, maxContainedSize));
}

function graphNodeCopyText(data) {
    if (data.kind === "endpoint") {
        return data.rawLabel || data.label || "";
    }

    if (isSchemaNode(data)) {
        return stripSchemaPrefix(data.id || data.rawLabel || data.label || "");
    }

    return data.rawLabel || data.label || "";
}

async function copyGraphNodeText(button) {
    const value = button.dataset.copyText || "";
    if (!value) {
        return;
    }

    try {
        await writeClipboardText(value);
        showGraphNodeCopyState(button, "copied");
    } catch (error) {
        console.error(error);
        showGraphNodeCopyState(button, "failed");
    }
}

async function writeClipboardText(value) {
    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(value);
            return;
        } catch {
            // Some browser contexts expose navigator.clipboard but still reject writes.
        }
    }

    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.top = "0";
    document.body.appendChild(input);
    input.focus();
    input.select();
    input.setSelectionRange(0, input.value.length);
    const copied = document.execCommand("copy");
    input.remove();
    if (!copied) {
        throw new Error("Clipboard copy failed.");
    }
}

function showGraphNodeCopyState(button, stateName) {
    button.classList.remove("copied", "failed");
    button.classList.add(stateName);
    button.innerHTML = `<i data-lucide="${stateName === "copied" ? "check" : "x"}"></i>`;
    button.title = stateName === "copied" ? "Copied" : "Copy failed";
    refreshIcons();

    window.setTimeout(() => {
        button.classList.remove("copied", "failed");
        button.innerHTML = `<i data-lucide="copy"></i>`;
        button.title = button.getAttribute("aria-label") || "Copy";
        refreshIcons();
    }, 1200);
}

function nodeMetrics(node) {
    const widthScale = graphSettingScale(els.nodeWidthInput, graphSettingDefaults.nodeWidth);
    const heightScale = graphSettingScale(els.nodeHeightInput, graphSettingDefaults.nodeHeight);
    const textScale = graphSettingScale(els.nodeTextSizeInput, graphSettingDefaults.nodeTextSize);
    const isEndpoint = node.kind === "endpoint";
    if (isEndpoint) {
        return endpointNodeMetrics(node, widthScale, heightScale, textScale);
    }

    const isEnum = node.enumValues?.length > 0;
    const baseWidth = isEnum ? 136 : 148;
    const baseHeight = isEnum ? 54 : 58;
    const baseFontSize = 11;
    const width = Math.round(baseWidth * widthScale);
    const height = Math.round(baseHeight * heightScale);
    const textMaxWidth = Math.max(72, width - 18);
    const label = fittedNodeLabel(node, textMaxWidth);
    const lines = label.split("\n");
    const longestLine = Math.max(...lines.map(line => line.length), 1);
    const fontByWidth = textMaxWidth / (longestLine * 0.56);
    const fontByHeight = (height - 10) / (lines.length * 1.22);
    const fontSize = Math.max(7, Math.min(baseFontSize * textScale, fontByWidth, fontByHeight));

    return {
        width,
        height,
        textMaxWidth,
        fontSize: Math.round(fontSize * 10) / 10,
        label,
        cardImage: ""
    };
}

function fittedNodeLabel(node, textMaxWidth) {
    return wrapNodeLabel(node.label, Math.max(10, Math.floor(textMaxWidth / 6.4)), 3);
}

function endpointNodeMetrics(node, widthScale, heightScale, textScale) {
    const method = (node.method || "HTTP").toUpperCase();
    const padding = endpointCardPadding(heightScale);
    const methodFont = endpointMethodFontSize(textScale);
    const pathFont = endpointPathFontSize(textScale);
    const methodWidth = endpointMethodWidth(method, methodFont, widthScale);
    const pathGap = Math.round(14 * widthScale);
    const pathWidth = Math.ceil(measureTextWidth(node.label, endpointPathFont(pathFont)));
    const width = Math.max(
        Math.round(360 * widthScale),
        Math.ceil(padding + methodWidth + pathGap + pathWidth + padding + 12)
    );
    const height = Math.round(58 * heightScale);

    return {
        width,
        height,
        textMaxWidth: Math.max(72, width - 18),
        fontSize: Math.round(pathFont * 10) / 10,
        label: "",
        cardImage: endpointCardImage(node, width, height, widthScale, heightScale, textScale)
    };
}

function endpointCardImage(node, width, height, widthScale, heightScale, textScale) {
    const method = (node.method || "HTTP").toUpperCase();
    const colors = methodColors(method);
    const diff = diffColors(node.diffState);
    const radius = 6;
    const padding = endpointCardPadding(heightScale);
    const methodFont = endpointMethodFontSize(textScale);
    const pathFont = endpointPathFontSize(textScale);
    const methodWidth = endpointMethodWidth(method, methodFont, widthScale);
    const pathX = padding + methodWidth + Math.round(14 * widthScale);
    const methodY = Math.round(height / 2 + methodFont / 3 - 1);
    const pathY = Math.round(height / 2 + pathFont / 3 - 1);

    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
            <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="${radius}" fill="${diff.tint || colors.tint}" stroke="${diff.stroke || colors.primary}" stroke-width="${diff.stroke ? 3 : 1}" stroke-dasharray="${node.diffState === "deleted" ? "7 5" : "0"}"/>
            <rect x="${padding}" y="${padding}" width="${methodWidth}" height="${height - padding * 2}" rx="4" fill="${colors.primary}"/>
            <text x="${padding + methodWidth / 2}" y="${methodY}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${methodFont}" font-weight="900" fill="${colors.methodText}">${escapeXml(method)}</text>
            <text x="${pathX}" y="${pathY}" font-family="Segoe UI, Arial, sans-serif" font-size="${pathFont}" font-weight="900" fill="#23362b">${escapeXml(node.label)}</text>
            ${diff.label ? `<text x="${width - padding}" y="${Math.max(14, padding + 9)}" text-anchor="end" font-family="Segoe UI, Arial, sans-serif" font-size="10" font-weight="900" fill="${diff.stroke}">${diff.label}</text>` : ""}
        </svg>
    `.replace(/\s+/g, " ").trim();

    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function endpointCardPadding(size) {
    return Math.max(5, Math.round(6 * size));
}

function endpointMethodFontSize(size) {
    return Math.max(10, Math.min(15, 12 * size));
}

function endpointPathFontSize(size) {
    return Math.max(11, Math.min(16, 13 * size));
}

function endpointMethodWidth(method, fontSize, size) {
    return Math.ceil(Math.max(74 * size, measureTextWidth(method, endpointMethodFont(fontSize)) + 24 * size));
}

function graphSettingScale(input, fallback) {
    return Number.parseFloat(input.value) || fallback;
}

function endpointMethodFont(fontSize) {
    return `900 ${fontSize}px Segoe UI, Arial, sans-serif`;
}

function endpointPathFont(fontSize) {
    return `900 ${fontSize}px Segoe UI, Arial, sans-serif`;
}

function measureTextWidth(value, font) {
    if (!measureTextWidth.canvas && typeof document !== "undefined") {
        measureTextWidth.canvas = document.createElement("canvas");
    }

    if (measureTextWidth.canvas) {
        const context = measureTextWidth.canvas.getContext("2d");
        context.font = font;
        return context.measureText(String(value || "")).width;
    }

    const fontSize = Number.parseFloat(font.match(/(\d+(?:\.\d+)?)px/)?.[1] || "13");
    return String(value || "").length * fontSize * 0.6;
}

function methodColors(method) {
    const colors = {
        GET: { primary: "#61affe", tint: "#eff7ff", methodText: "#ffffff" },
        POST: { primary: "#49cc90", tint: "#ecfaf4", methodText: "#ffffff" },
        PUT: { primary: "#fca130", tint: "#fff5e6", methodText: "#ffffff" },
        PATCH: { primary: "#50e3c2", tint: "#e7fbf7", methodText: "#23362b" },
        DELETE: { primary: "#f93e3e", tint: "#fff0f0", methodText: "#ffffff" }
    };

    return colors[method] || { primary: "#4f78a8", tint: "#f3f6f9", methodText: "#23362b" };
}

function diffColors(stateName) {
    if (stateName === "added") {
        return { stroke: "#047857", tint: "#d1fae5", label: "ADDED" };
    }

    if (stateName === "deleted") {
        return { stroke: "#b91c1c", tint: "#fee2e2", label: "DELETED" };
    }

    if (stateName === "modified") {
        return { stroke: "#b45309", tint: "#fef3c7", label: "MODIFIED" };
    }

    if (stateName === "affected") {
        return { stroke: "#2563eb", tint: "#dbeafe", label: "AFFECTED" };
    }

    return {};
}

function wrapNodeLabel(value, maxChars, maxLines) {
    const words = String(value || "")
        .split(/([\s/_-]+)/)
        .filter(Boolean);
    const lines = [];
    let current = "";

    for (const word of words) {
        const candidate = `${current}${word}`;
        if (candidate.trim().length <= maxChars) {
            current = candidate;
            continue;
        }

        if (current.trim()) {
            lines.push(current.trim());
        }

        if (word.trim().length > maxChars) {
            for (let i = 0; i < word.length; i += maxChars) {
                lines.push(word.slice(i, i + maxChars));
            }
            current = "";
        } else {
            current = word;
        }
    }

    if (current.trim()) {
        lines.push(current.trim());
    }

    if (lines.length <= maxLines) {
        return lines.join("\n");
    }

    const visible = lines.slice(0, maxLines);
    visible[maxLines - 1] = `${visible[maxLines - 1].slice(0, Math.max(1, maxChars - 3))}...`;
    return visible.join("\n");
}

function runLayout() {
    if (!state.cy || state.cy.nodes().length === 0) {
        return;
    }

    const roots = graphLayoutRoots();
    const horizontalGap = Number.parseFloat(els.horizontalGapInput.value) || graphSettingDefaults.horizontalGap;
    const verticalGap = Number.parseFloat(els.verticalGapInput.value) || graphSettingDefaults.verticalGap;
    const layout = state.cy.layout({
        name: "breadthfirst",
        directed: true,
        roots,
        spacingFactor: 1,
        avoidOverlap: true,
        animate: false,
        fit: false,
        padding: 34
    });

    layout.one("layoutstop", () => {
        applyLeftToRightLayout(roots, horizontalGap, verticalGap);
        state.cy.fit(undefined, 40);
        window.requestAnimationFrame(updateGraphNodeActionPositions);
    });
    layout.run();
}

function graphLayoutRoots() {
    if (state.graphLayoutRootIds.length > 0) {
        const rootIds = new Set(state.graphLayoutRootIds);
        const explicitRoots = state.cy.nodes().filter(node => rootIds.has(node.id()));
        if (explicitRoots.length > 0) {
            return explicitRoots;
        }
    }

    const endpointRoots = state.cy.nodes("[kind = 'endpoint']");
    if (endpointRoots.length > 0) {
        return endpointRoots;
    }

    const sourceRoots = state.cy.nodes().filter(node => node.incomers("edge").length === 0);
    return sourceRoots.length > 0 ? sourceRoots : state.cy.nodes();
}

function applyLeftToRightLayout(roots, horizontalGap, verticalGap) {
    const depths = graphDepthsFromRoots(roots);
    const groups = new Map();
    let maxDepth = 0;

    state.cy.nodes().forEach(node => {
        const depth = depths.get(node.id()) ?? 0;
        maxDepth = Math.max(maxDepth, depth);
        if (!groups.has(depth)) {
            groups.set(depth, []);
        }
        groups.get(depth).push(node);
    });

    let columnLeft = 0;
    const columnGap = 170 * horizontalGap;
    for (let depth = 0; depth <= maxDepth; depth++) {
        const nodes = groups.get(depth) || [];
        if (nodes.length === 0) {
            continue;
        }

        const columnWidth = Math.max(...nodes.map(node => Number(node.data("width")) || node.width()));
        const yPositions = packedColumnYPositions(nodes, verticalGap);
        for (const node of nodes) {
            node.position({
                x: columnLeft + (Number(node.data("width")) || node.width()) / 2,
                y: yPositions.get(node.id()) ?? 0
            });
        }

        columnLeft += columnWidth + columnGap;
    }
}

function graphDepthsFromRoots(roots) {
    const depths = new Map();
    const queue = [];

    roots.forEach(root => {
        depths.set(root.id(), 0);
        queue.push(root);
    });

    for (let index = 0; index < queue.length; index++) {
        const node = queue[index];
        const currentDepth = depths.get(node.id()) ?? 0;
        node.outgoers("edge").forEach(edge => {
            const target = edge.target();
            const nextDepth = currentDepth + 1;
            const knownDepth = depths.get(target.id());
            if (knownDepth === undefined || nextDepth < knownDepth) {
                depths.set(target.id(), nextDepth);
                queue.push(target);
            }
        });
    }

    const fallbackDepth = depths.size === 0 ? 0 : Math.max(...depths.values()) + 1;
    state.cy.nodes().forEach(node => {
        if (!depths.has(node.id())) {
            depths.set(node.id(), fallbackDepth);
        }
    });

    return depths;
}

function packedColumnYPositions(nodes, verticalGap) {
    const ordered = [...nodes].sort((a, b) => {
        const positionDelta = a.position("x") - b.position("x");
        if (Math.abs(positionDelta) > 1) {
            return positionDelta;
        }

        return String(a.data("rawLabel") || a.data("label") || "").localeCompare(String(b.data("rawLabel") || b.data("label") || ""));
    });

    const rowGap = 58 * verticalGap;
    const totalHeight = ordered.reduce((sum, node) => sum + (Number(node.data("height")) || node.height()), 0) +
        Math.max(0, ordered.length - 1) * rowGap;
    let top = -totalHeight / 2;
    const yPositions = new Map();

    for (const node of ordered) {
        const height = Number(node.data("height")) || node.height();
        yPositions.set(node.id(), top + height / 2);
        top += height + rowGap;
    }

    return yPositions;
}

function renderDetails(data) {
    state.currentDetailsNode = data;
    if (!data) {
        els.detailsTitle.textContent = "Details";
        els.detailsBadge.textContent = "";
        els.detailsBody.innerHTML = `
            <div class="detail-block">
                <div class="detail-label">Selection</div>
                <div class="detail-value">No node selected</div>
            </div>
        `;
        return;
    }

    els.detailsTitle.textContent = data.rawLabel || data.label;
    els.detailsBadge.textContent = diffBadgeLabel(data.diffState);
    els.detailsBadge.title = diffLabel(data.diffState);
    els.detailsBadge.className = diffClass(data.diffState);
    els.detailsBody.innerHTML = renderNodeSummary(data, false) + renderSchemaExplorerAction(data);
    refreshIcons();
}

function renderEdgeDetails(data) {
    state.currentDetailsNode = null;
    els.detailsTitle.textContent = data.kind;
    els.detailsBadge.textContent = diffBadgeLabel(data.diffState);
    els.detailsBadge.title = diffLabel(data.diffState);
    els.detailsBadge.className = diffClass(data.diffState);
    els.detailsBody.innerHTML = `
        ${renderDiffEntries(data)}
        <div class="detail-block">
            <div class="detail-label">Label</div>
            <div class="detail-value">${escapeHtml(data.fullLabel || data.label || "")}</div>
        </div>
        <div class="detail-block">
            <div class="detail-label">Source</div>
            <div class="detail-value">${escapeHtml(data.source)}</div>
        </div>
        <div class="detail-block">
            <div class="detail-label">Target</div>
            <div class="detail-value">${escapeHtml(data.target)}</div>
        </div>
    `;
}

function renderSchemaExplorerAction(data) {
    if (!isSchemaNode(data)) {
        return "";
    }

    return `
        <div class="schema-action-row">
            <button class="schema-explorer-button" type="button" data-open-schema-explorer>
                <i data-lucide="list-tree"></i>
                <span>Model details</span>
            </button>
            <button class="schema-explorer-button secondary" type="button" data-open-similar-models>
                <i data-lucide="scan-search"></i>
                <span>Similar models</span>
            </button>
        </div>
    `;
}

function renderNodeSummary(data, compact) {
    const props = data.properties || [];
    const enumValues = data.enumValues || [];
    const tags = data.tags || [];

    let html = "";
    html += renderDiffEntries(data);
    if (compact) {
        html += `
            <div class="detail-block">
                ${escapeHtml(data.label)}
                <div class="detail-value">${escapeHtml(data.subtitle || data.method || data.kind || "")}</div>
            </div>
        `;
    } else {
        if (tags.length > 0) {
            html += `
                <div class="detail-block">
                    <div class="detail-label">Tags</div>
                    <div class="tag-row">${tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
                </div>
            `;
        }
    }

    if (enumValues.length > 0) {
        html += compact
            ? `<div class="enum-chip-row compact">${renderEnumChips(enumValues)}</div>`
            : `
                <div class="detail-block">
                    <div class="detail-label">Enum values</div>
                    <div class="enum-chip-row">${renderEnumChips(enumValues)}</div>
                </div>
            `;
    }

    if (props.length === 0) {
        if (enumValues.length === 0) {
            html += compact
                ? `<div class="property-list"><div class="property-row"><span class="property-name">No properties</span><span class="property-type"></span></div></div>`
                : `<div class="detail-block"><div class="detail-label">Properties</div><div class="detail-value">None</div></div>`;
        }
        return html;
    }

    const propertyRows = renderPropertyGroups(props, prop => renderPropertyRow(prop), "property-list");

    if (compact) {
        html += propertyRows;
    } else {
        html += `
            <div class="detail-block">
                <div class="detail-label">Properties</div>
                ${propertyRows}
            </div>
        `;
    }

    return html;
}

function renderPropertyRow(prop) {
    return `
        <div class="property-row property-kind-${propertyKind(prop)} ${prop.inherited ? "inherited" : ""} ${diffClass(prop.diffState)}">
            <div class="property-main">
                <span class="property-name">${prop.required ? `<span class="required-dot">*</span> ` : ""}${escapeHtml(prop.name)}</span>
                ${prop.enumValues?.length ? `<div class="enum-chip-row property-enums">${renderEnumChips(prop.enumValues)}</div>` : ""}
                ${prop.previousType ? `<span class="property-diff-before">${escapeHtml(prop.previousType)}</span>` : ""}
                ${renderPropertyRequiredChange(prop)}
            </div>
            <span class="property-type">${escapeHtml(propertyType(prop))}</span>
            ${renderDiffBadge(prop.diffState)}
        </div>
    `;
}

function renderPropertyGroups(props, rowRenderer, className) {
    const groups = groupPropertiesBySource(props);
    return `
        <div class="${className}">
            ${groups.map(group => `
                <div class="property-group ${group.inherited ? "inherited" : "local"}">
                    <div class="property-group-title">${escapeHtml(group.label)}</div>
                    <div class="property-group-rows">${group.entries.map(entry => rowRenderer(entry.property, entry.index)).join("")}</div>
                </div>
            `).join("")}
        </div>
    `;
}

function groupPropertiesBySource(props) {
    const indexed = props.map((property, index) => ({ property, index }));
    const local = indexed.filter(entry => !entry.property.inherited);
    const inherited = indexed.filter(entry => entry.property.inherited);
    const groups = [];

    if (local.length > 0) {
        groups.push({
            label: "Declared properties",
            inherited: false,
            entries: local
        });
    }

    for (const entry of inherited) {
        const prop = entry.property;
        const sourceName = prop.sourceSchemaName || "Inherited schema";
        let group = groups.find(item => item.inherited && item.sourceName === sourceName);
        if (!group) {
            group = {
                label: `Inherited from ${sourceName}`,
                sourceName,
                inherited: true,
                entries: []
            };
            groups.push(group);
        }

        group.entries.push(entry);
    }

    if (groups.length === 0 && props.length > 0) {
        groups.push({
            label: "Properties",
            inherited: false,
            entries: indexed
        });
    }

    return groups;
}

function renderEnumChips(values) {
    return values
        .map(value => `<span class="enum-chip">${escapeHtml(value)}</span>`)
        .join("");
}

function renderDiffEntries(data) {
    const entries = data?.diffEntries || [];
    if (!data?.diffState || data.diffState === "unchanged") {
        return "";
    }

    const rows = entries.length === 0
        ? `<div class="diff-entry ${diffClass(data.diffState)}">
            <span>${escapeHtml(diffLabel(data.diffState))}</span>
            <strong>${escapeHtml(data.rawLabel || data.label || data.id || "")}</strong>
        </div>`
        : entries.map(entry => `
            <div class="diff-entry ${diffClass(entry.state)}">
                <span>${escapeHtml(entry.label)}</span>
                <strong>${escapeHtml(diffEntryValue(entry))}</strong>
            </div>
        `).join("");

    return `
        <div class="detail-block diff-block collapsed">
            <button class="diff-block-toggle" type="button" data-toggle-diff-block aria-expanded="false">
                <span class="detail-label">Diff</span>
                <span class="diff-block-meta">${entries.length || 1}</span>
                <i data-lucide="chevron-down"></i>
            </button>
            <div class="diff-entry-list">${rows}</div>
        </div>
    `;
}

function diffEntryValue(entry) {
    if (entry.before && entry.after) {
        return `${entry.before} -> ${entry.after}`;
    }

    return entry.after || entry.before || diffLabel(entry.state);
}

function renderDiffBadge(stateName) {
    const label = diffBadgeLabel(stateName);
    const title = diffLabel(stateName);
    return label ? `<span class="diff-badge ${diffClass(stateName)}" title="${escapeHtml(title)}">${escapeHtml(label)}</span>` : "";
}

function diffBadgeLabel(stateName) {
    if (stateName === "added") {
        return "A";
    }

    if (stateName === "deleted") {
        return "D";
    }

    if (stateName === "modified") {
        return "M";
    }

    if (stateName === "affected") {
        return "AF";
    }

    return "";
}

function diffLabel(stateName) {
    if (stateName === "added") {
        return "Added";
    }

    if (stateName === "deleted") {
        return "Deleted";
    }

    if (stateName === "modified") {
        return "Modified";
    }

    if (stateName === "affected") {
        return "Affected";
    }

    return "";
}

function diffClass(stateName) {
    return stateName && stateName !== "unchanged" ? `diff-${stateName}` : "";
}

async function openSchemaExplorer(data) {
    if (!state.specId || !isSchemaNode(data)) {
        return;
    }

    const rootId = data.id;
    state.schemaExplorerRootId = rootId;
    state.schemaExplorerExpanded.clear();
    state.schemaExplorerRows.clear();
    state.schemaCache.set(rootId, normalizeSchema(data));
    els.schemaExplorerOverlay?.classList.remove("hidden");
    document.body.classList.add("schema-explorer-open");
    renderSchemaExplorer();

    try {
        await loadSchema(rootId);
        renderSchemaExplorer();
    } catch (error) {
        console.error(error);
    }
}

function closeSchemaExplorer() {
    els.schemaExplorerOverlay?.classList.add("hidden");
    document.body.classList.remove("schema-explorer-open");
    state.schemaExplorerRootId = null;
    state.schemaExplorerExpanded.clear();
    state.schemaExplorerRows.clear();
    state.schemaExplorerLoadErrors.clear();
}

async function toggleSchemaExplorerRow(pathKey) {
    const row = state.schemaExplorerRows.get(pathKey);
    if (!row) {
        return;
    }

    if (state.schemaExplorerExpanded.has(pathKey)) {
        state.schemaExplorerExpanded.delete(pathKey);
        renderSchemaExplorer();
        return;
    }

    state.schemaExplorerExpanded.add(pathKey);
    renderSchemaExplorer();

    try {
        await loadSchema(row.refId);
    } catch (error) {
        console.error(error);
        state.schemaExplorerLoadErrors.add(row.refId);
    }

    renderSchemaExplorer();
}

async function loadSchema(schemaId) {
    if (!state.specId || state.schemaCache.has(schemaId) && state.schemaCache.get(schemaId).fullyLoaded) {
        return state.schemaCache.get(schemaId);
    }

    state.schemaExplorerLoadErrors.delete(schemaId);

    const params = new URLSearchParams({ schemaId });
    if (state.compareSpecId) {
        params.set("compareSpecId", state.compareSpecId);
    }
    const response = await fetch(`/api/specs/${state.specId}/schemas?${params}`);
    if (!response.ok) {
        throw new Error(await response.text());
    }

    const schema = normalizeSchema(await response.json(), true);
    state.schemaCache.set(schema.id, schema);
    return schema;
}

async function openSimilarModelsOverlay(data) {
    if (!state.specId || !isSchemaNode(data)) {
        setStatus("Similar models are available for model nodes");
        return;
    }

    const target = normalizeSchema(data);
    state.similarModelsTarget = target;
    els.similarModelsTitle.textContent = "Similar models";
    els.similarModelsBadge.textContent = target.label;
    els.similarModelsOverlay?.classList.remove("hidden");
    document.body.classList.add("similar-models-open");
    els.similarModelsBody.innerHTML = `<div class="similar-models-message">Finding similar models</div>`;
    setStatus(`Finding similar models for ${target.label}`);

    try {
        const params = new URLSearchParams({
            schemaId: target.id,
            limit: "5"
        });
        if (state.compareSpecId) {
            params.set("compareSpecId", state.compareSpecId);
        }

        const response = await fetch(`/api/specs/${state.specId}/models/similar?${params}`);
        if (!response.ok) {
            throw new Error(await response.text());
        }

        renderSimilarModels(await response.json());
        setStatus("Similar models ready");
    } catch (error) {
        console.error(error);
        els.similarModelsBody.innerHTML = `<div class="similar-models-message error">Could not load similar models</div>`;
        setStatus("Similar models failed");
    }
}

function closeSimilarModelsOverlay() {
    els.similarModelsOverlay?.classList.add("hidden");
    document.body.classList.remove("similar-models-open");
    state.similarModelsTarget = null;
}

function renderSimilarModels(results) {
    const items = Array.isArray(results) ? results : [];
    if (items.length === 0) {
        els.similarModelsBody.innerHTML = `<div class="similar-models-message">No similar models found</div>`;
        return;
    }

    els.similarModelsBody.innerHTML = `
        <div class="similar-model-list">
            ${items.map(renderSimilarModelResult).join("")}
        </div>
    `;
}

function renderSimilarModelResult(result) {
    const schema = normalizeSchema(result.schema || {});
    const score = Math.round((Number(result.score) || 0) * 100);
    const shared = Number(result.sharedPropertyCount) || 0;
    const total = Number(result.totalPropertyCount) || 0;
    const reasons = Array.isArray(result.reasons) ? result.reasons : [];
    return `
        <button class="similar-model-result" type="button" data-open-similar-schema="${escapeHtml(schema.id)}">
            <span class="similar-model-score">${score}</span>
            <span class="similar-model-main">
                <span class="similar-model-name">${escapeHtml(schema.label)}</span>
                <span class="similar-model-meta">${escapeHtml(schema.subtitle || "")}</span>
                <span class="similar-model-reasons">
                    <span>${escapeHtml(`${shared}/${Math.max(total, 1)} properties`)}</span>
                    ${reasons.map(reason => `<span>${escapeHtml(reason)}</span>`).join("")}
                </span>
            </span>
            <i data-lucide="chevron-right"></i>
        </button>
    `;
}

async function openSimilarSchema(schemaId) {
    if (!schemaId) {
        return;
    }

    closeSimilarModelsOverlay();
    const cached = state.schemaCache.get(schemaId);
    openSchemaExplorer(cached || { id: schemaId, kind: "schema", label: stripSchemaPrefix(schemaId) });
}

function renderSchemaExplorer() {
    state.schemaExplorerRows.clear();
    const root = state.schemaCache.get(state.schemaExplorerRootId);
    if (!root) {
        els.schemaExplorerTitle.textContent = "Model details";
        els.schemaExplorerBadge.textContent = "";
        els.schemaExplorerBody.innerHTML = `<div class="schema-tree-message">Loading schema</div>`;
        return;
    }

    els.schemaExplorerTitle.textContent = root.label;
    els.schemaExplorerBadge.textContent = root.subtitle || root.kind;
    els.schemaExplorerBody.innerHTML = renderSchemaTreeNode(root, "root", [root.id], 0);
    refreshIcons();
}

function renderSchemaTreeNode(schema, pathKey, trail, depth) {
    const props = schema.properties || [];
    const enumValues = schema.enumValues || [];
    const type = schema.type || "object";
    const meta = [
        type,
        schema.format,
        diffBadgeLabel(schema.diffState)
    ].filter(Boolean);

    const enumHtml = enumValues.length
        ? `<div class="schema-tree-properties">${enumValues.map(value => renderSchemaTreeValueRow(value)).join("")}</div>`
        : "";

    const propertiesHtml = props.length
        ? `<div class="schema-tree-properties">${props.map((prop, index) => renderSchemaTreeProperty(prop, `${pathKey}.${index}`, trail, depth)).join("")}</div>`
        : enumValues.length === 0 ? `<div class="schema-tree-empty">No properties</div>` : "";

    return `
        <div class="schema-tree-node schema-tree-level-${depth % 4}" style="--schema-depth: ${depth}">
            <div class="schema-tree-model ${diffClass(schema.diffState)}">
                <div class="schema-tree-model-main">
                    <div class="schema-tree-model-name">${escapeHtml(schema.label)}</div>
                    <div class="schema-tree-model-meta">${meta.map(item => `<span>${escapeHtml(item)}</span>`).join("")}</div>
                </div>
            </div>
            ${renderDiffEntries(schema)}
            ${enumHtml}
            ${propertiesHtml}
        </div>
    `;
}

function renderSchemaTreeValueRow(value) {
    return `
        <div class="schema-tree-property">
            <div class="schema-tree-property-row">
                <span class="schema-tree-toggle-placeholder"></span>
                <span class="schema-tree-origin-badge declared" title="Declared">d</span>
                <div class="schema-tree-property-main">
                    <span class="schema-tree-property-name">${escapeHtml(value)}</span>
                </div>
                <span class="property-type">enum value</span>
            </div>
        </div>
    `;
}

function renderSchemaTreeProperty(prop, pathKey, trail, depth) {
    const refId = prop.itemsRefId || prop.refId || "";
    const hasRef = Boolean(refId);
    const isCycle = hasRef && trail.includes(refId);
    const atMaxDepth = depth >= schemaExplorerMaxDepth;
    const canExpand = hasRef && !isCycle && !atMaxDepth;
    const expanded = canExpand && state.schemaExplorerExpanded.has(pathKey);
    const child = expanded ? state.schemaCache.get(refId) : null;
    const nextTrail = hasRef ? [...trail, refId] : trail;

    if (canExpand) {
        state.schemaExplorerRows.set(pathKey, { refId });
    }

    const toggle = canExpand
        ? `
            <button class="schema-tree-toggle" type="button" data-schema-toggle="${escapeHtml(pathKey)}" aria-expanded="${expanded}" title="${expanded ? "Collapse model" : "Expand model"}" aria-label="${expanded ? "Collapse model" : "Expand model"}">
                <i data-lucide="${expanded ? "chevron-down" : "chevron-right"}"></i>
            </button>
        `
        : `<span class="schema-tree-toggle-placeholder"></span>`;

    const extra = isCycle
        ? `<span class="schema-tree-note">cycle</span>`
        : atMaxDepth && hasRef
            ? `<span class="schema-tree-note">depth limit</span>`
            : "";
    const childHtml = expanded
        ? state.schemaExplorerLoadErrors.has(refId)
            ? `<div class="schema-tree-loading error">Could not load ${escapeHtml(stripSchemaPrefix(refId))}</div>`
            : child
            ? renderSchemaTreeNode(child, pathKey, nextTrail, depth + 1)
            : `<div class="schema-tree-loading">Loading ${escapeHtml(stripSchemaPrefix(refId))}</div>`
        : "";

    return `
        <div class="schema-tree-property property-kind-${propertyKind(prop)} ${diffClass(prop.diffState)}">
            <div class="schema-tree-property-row">
                ${toggle}
                <span class="schema-tree-origin-badge ${prop.inherited ? "inherited" : "declared"}" title="${prop.inherited ? `Inherited from ${escapeHtml(prop.sourceSchemaName || "schema")}` : "Declared"}">${prop.inherited ? "i" : "d"}</span>
                <div class="schema-tree-property-main">
                    <span class="schema-tree-property-name">${prop.required ? `<span class="required-dot">*</span> ` : ""}${escapeHtml(prop.name)}</span>
                    ${prop.enumValues?.length ? `<div class="enum-chip-row property-enums">${renderEnumChips(prop.enumValues)}</div>` : ""}
                    ${prop.previousType ? `<span class="property-diff-before">${escapeHtml(prop.previousType)}</span>` : ""}
                    ${renderPropertyRequiredChange(prop)}
                </div>
                ${extra}
                <span class="property-type">${escapeHtml(schemaTreePropertyType(prop))}</span>
                ${renderDiffBadge(prop.diffState)}
            </div>
            ${childHtml}
        </div>
    `;
}

function renderPropertyRequiredChange(prop) {
    if (typeof prop.previousRequired !== "boolean" || prop.previousRequired === prop.required) {
        return "";
    }

    const before = prop.previousRequired ? "required" : "optional";
    const after = prop.required ? "required" : "optional";
    return `
        <span class="property-required-change">
            <span class="property-diff-before">${escapeHtml(before)}</span>
            <span class="property-diff-arrow">-&gt;</span>
            <span class="property-diff-after">${escapeHtml(after)}</span>
        </span>
    `;
}

function schemaTreePropertyType(prop) {
    if (prop.enumValues?.length) {
        return "enum";
    }

    const refId = prop.itemsRefId || prop.refId;
    if (refId && state.schemaCache.get(refId)?.enumValues?.length) {
        return prop.itemsRefId ? "enum[]" : "enum";
    }

    return propertyType(prop);
}

function normalizeSchema(schema, fullyLoaded = false) {
    const id = schema.id || schema.schemaId || `schema:${schema.name || schema.label || ""}`;
    const properties = schema.properties || [];
    const enumValues = schema.enumValues || [];
    const label = schema.rawLabel || schema.label || schema.name || stripSchemaPrefix(id);

    return {
        id,
        kind: "schema",
        label,
        rawLabel: label,
        subtitle: schema.subtitle || schemaSubtitle(schema, properties, enumValues),
        type: schema.type,
        format: schema.format,
        description: schema.description,
        properties,
        enumValues,
        nullable: schema.nullable,
        cycleId: schema.cycleId,
        diffState: schema.diffState,
        diffEntries: schema.diffEntries || [],
        fullyLoaded
    };
}

function schemaSubtitle(schema, properties, enumValues) {
    const type = schema.type || "schema";
    const enumText = enumValues.length === 0
        ? ""
        : enumValues.length === 1 ? "1 enum value" : `${enumValues.length} enum values`;
    const propertyText = properties.length === 0
        ? ""
        : properties.length === 1 ? "1 property" : `${properties.length} properties`;
    return [type, enumText, propertyText].filter(Boolean).join(" - ");
}

function isSchemaNode(data) {
    return data?.kind === "schema" || String(data?.id || "").startsWith("schema:");
}

function propertyType(prop) {
    if (prop.itemsRefId) {
        return `${stripSchemaPrefix(prop.itemsRefId)}[]`;
    }
    if (prop.refId) {
        return stripSchemaPrefix(prop.refId);
    }
    if (prop.enumValues?.length) {
        return `enum(${prop.enumValues.length})`;
    }
    if (prop.format) {
        return `${prop.type || "value"}:${prop.format}`;
    }
    return prop.type || "value";
}

function propertyKind(prop) {
    const type = String(prop.type || "").toLowerCase();
    const format = String(prop.format || "").toLowerCase();

    if (prop.enumValues?.length) {
        return "enum";
    }
    if (prop.itemsRefId || type === "array" || type.endsWith("[]")) {
        return "array";
    }
    if (prop.refId || type === "object" || type.startsWith("oneof") || type.startsWith("allof") || type.startsWith("anyof")) {
        return "object";
    }
    if (format.includes("date") || format.includes("time")) {
        return "date";
    }
    if (type === "number" || type === "integer") {
        return "number";
    }
    if (type === "boolean") {
        return "boolean";
    }
    if (type === "string") {
        return "string";
    }
    return "value";
}

function stripSchemaPrefix(value) {
    return String(value || "").replace(/^schema:/, "");
}

function shortEdgeLabel(label) {
    if (!label) {
        return "";
    }

    return label.length > 22 ? `${label.slice(0, 20)}…` : label;
}

function setStatus(text) {
    els.graphStatus.textContent = text;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function escapeXml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}
