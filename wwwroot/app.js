const graphSettingDefaults = {
    hideEnums: true,
    hideErrorResponses: true,
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
    endpoints: [],
    allEndpoints: [],
    selected: new Map(),
    favorites: readFavoriteEndpoints(),
    detailsCollapsed: readDetailsCollapsed(),
    collapsedSections: new Set(),
    method: "",
    cy: null,
    lastGraph: null,
    searchTimer: null,
    currentDetailsNode: null,
    schemaCache: new Map(),
    schemaExplorerLoadErrors: new Set(),
    schemaExplorerRootId: null,
    schemaExplorerExpanded: new Set(),
    schemaExplorerRows: new Map()
};

const els = {
    appShell: document.querySelector(".app-shell"),
    fileInput: document.getElementById("fileInput"),
    fileLabel: document.getElementById("fileLabel"),
    specMeta: document.getElementById("specMeta"),
    endpointSearch: document.getElementById("endpointSearch"),
    methodFiltersToggle: document.getElementById("methodFiltersToggle"),
    methodFilters: document.getElementById("methodFilters"),
    favoriteList: document.getElementById("favoriteList"),
    favoriteCount: document.getElementById("favoriteCount"),
    endpointList: document.getElementById("endpointList"),
    endpointCount: document.getElementById("endpointCount"),
    selectedList: document.getElementById("selectedList"),
    selectedCount: document.getElementById("selectedCount"),
    clearSelection: document.getElementById("clearSelection"),
    depthInput: document.getElementById("depthInput"),
    nodeLimitInput: document.getElementById("nodeLimitInput"),
    settingsButton: document.getElementById("settingsButton"),
    settingsPanel: document.getElementById("settingsPanel"),
    hideEnumsInput: document.getElementById("hideEnumsInput"),
    hideErrorResponsesInput: document.getElementById("hideErrorResponsesInput"),
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
    resizeHandles: document.querySelectorAll("[data-resize-panel]")
};

window.addEventListener("DOMContentLoaded", () => {
    restorePanelWidths();
    setDetailsPanelCollapsed(state.detailsCollapsed, false);
    wireEvents();
    initializeGraph();
    renderSectionCollapse();
    renderDetails(null);
    refreshIcons();
});

function wireEvents() {
    els.fileInput.addEventListener("change", importSpec);
    els.endpointSearch.addEventListener("input", () => {
        clearTimeout(state.searchTimer);
        state.searchTimer = setTimeout(loadEndpoints, 160);
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
        const button = event.target.closest("[data-open-schema-explorer]");
        if (!button || !state.currentDetailsNode) {
            return;
        }

        event.preventDefault();
        openSchemaExplorer(state.currentDetailsNode);
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

    els.clearSelection.addEventListener("click", () => {
        state.selected.clear();
        renderFavorites();
        renderEndpoints();
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
    els.horizontalGapInput.addEventListener("input", updateGraphGaps);
    els.verticalGapInput.addEventListener("input", updateGraphGaps);
    els.nodeWidthInput.addEventListener("input", updateGraphSizing);
    els.nodeHeightInput.addEventListener("input", updateGraphSizing);
    els.nodeTextSizeInput.addEventListener("input", updateGraphSizing);
    els.edgeTextSizeInput.addEventListener("input", updateGraphSizing);
    els.resetSettingsButton.addEventListener("click", resetGraphSettings);
    els.layoutButton.addEventListener("click", runLayout);
    els.fitButton.addEventListener("click", () => state.cy?.fit(undefined, 40));
    document.addEventListener("click", () => setSettingsOpen(false));
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
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
        state.selected.clear();
        state.currentDetailsNode = null;
        state.schemaCache.clear();
        state.schemaExplorerLoadErrors.clear();
        closeSchemaExplorer();
        renderSpecMeta(summary);
        await loadAllEndpoints();
        await loadEndpoints();
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

function renderEndpoints() {
    els.endpointCount.textContent = state.endpoints.length.toString();
    els.endpointList.innerHTML = "";

    for (const endpoint of state.endpoints) {
        els.endpointList.appendChild(createEndpointRow(endpoint));
    }

    refreshIcons();
}

function renderFavorites() {
    const favorites = state.allEndpoints.filter(endpoint => state.favorites.has(endpoint.id));
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

function createEndpointRow(endpoint) {
    const row = document.createElement("div");
    row.className = `endpoint-row ${state.selected.has(endpoint.id) ? "selected" : ""}`;

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
    button.innerHTML = `
        <span class="method-badge ${escapeHtml(endpoint.method)}">${escapeHtml(endpoint.method)}</span>
        <span class="endpoint-main">
            <span class="endpoint-path">${escapeHtml(endpoint.path)}</span>
            <span class="endpoint-summary">${escapeHtml(endpoint.summary || endpoint.operationId || endpoint.tags?.[0] || "")}</span>
        </span>
    `;
    button.addEventListener("click", () => toggleEndpoint(endpoint));
    row.append(favoriteButton, button);
    return row;
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
        state.selected.set(endpoint.id, endpoint);
    }

    renderFavorites();
    renderEndpoints();
    renderSelected();
    updateGraph();
}

function renderSelected() {
    els.selectedList.innerHTML = "";
    els.selectedCount.textContent = state.selected.size.toString();

    for (const endpoint of state.selected.values()) {
        const button = document.createElement("button");
        button.className = "selected-item";
        button.type = "button";
        button.innerHTML = `
            <span class="method-badge ${escapeHtml(endpoint.method)}">${escapeHtml(endpoint.method)}</span>
            <span class="endpoint-main">
                <span class="endpoint-path">${escapeHtml(endpoint.path)}</span>
            </span>
        `;
        button.addEventListener("click", () => toggleEndpoint(endpoint));
        els.selectedList.appendChild(button);
    }
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
                    "background-color": "#9bc7c5",
                    "border-width": 1,
                    "border-color": "#1bb28c",
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
                    "border-color": "#1bb28c"
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
                    "target-arrow-color": "#1bb28c",
                    "line-color": "#1bb28c",
                    "width": 2,
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
            { selector: "edge[kind = 'Property']", style: { "line-color": "#6da6a3", "target-arrow-color": "#6da6a3" } },
            { selector: "edge[kind = 'ArrayItem']", style: { "line-color": "#23362b", "target-arrow-color": "#23362b" } },
            { selector: "edge[kind = 'Inheritance']", style: { "line-color": "#e86a58", "target-arrow-color": "#e86a58", "width": 4, "font-size": "data(inheritanceFontSize)", "font-weight": "bold" } },
            { selector: "edge[kind = 'AllOf']", style: { "line-color": "#1bb28c", "target-arrow-color": "#1bb28c", "line-style": "dashed" } },
            { selector: "edge[kind = 'OneOf']", style: { "line-color": "#23362b", "target-arrow-color": "#23362b", "line-style": "dotted" } },
            { selector: "edge[kind = 'AnyOf']", style: { "line-color": "#fed45b", "target-arrow-color": "#fed45b", "line-style": "dotted" } },
            { selector: "edge[kind = 'ResponseBody']", style: { "line-color": "#61affe", "target-arrow-color": "#61affe", "width": 2.6 } },
            { selector: "edge[kind = 'RequestBody']", style: { "line-color": "#49cc90", "target-arrow-color": "#49cc90", "width": 2.6 } },
            { selector: "edge[kind = 'Parameter']", style: { "line-color": "#50e3c2", "target-arrow-color": "#50e3c2" } },
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

    state.cy.on("tap", "node", event => renderDetails(event.target.data()));
    state.cy.on("tap", "edge", event => renderEdgeDetails(event.target.data()));
    state.cy.on("pan zoom resize position render", updateGraphNodeActionPositions);
}

async function updateGraph() {
    if (!state.specId || state.selected.size === 0) {
        state.lastGraph = null;
        state.cy.elements().remove();
        renderGraphNodeActions();
        els.emptyGraph.classList.remove("hidden");
        setStatus("Idle");
        renderDetails(null);
        return;
    }

    setStatus("Loading graph");
    const allReachable = els.depthInput.value === "all";
    const body = {
        endpointIds: [...state.selected.keys()],
        depth: allReachable ? 0 : Number.parseInt(els.depthInput.value, 10) || 4,
        maxNodes: Number.parseInt(els.nodeLimitInput.value, 10) || 250,
        includeProperties: true,
        allReachable,
        hideEnums: els.hideEnumsInput.checked,
        hideErrorResponses: els.hideErrorResponsesInput.checked
    };

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
                edgeFontSize,
                inheritanceFontSize
            }
        }))
    ];

    state.cy.elements().remove();
    state.cy.add(elements);
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
            <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="${radius}" fill="${colors.tint}" stroke="${colors.primary}" stroke-width="1"/>
            <rect x="${padding}" y="${padding}" width="${methodWidth}" height="${height - padding * 2}" rx="4" fill="${colors.primary}"/>
            <text x="${padding + methodWidth / 2}" y="${methodY}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${methodFont}" font-weight="900" fill="${colors.methodText}">${escapeXml(method)}</text>
            <text x="${pathX}" y="${pathY}" font-family="Segoe UI, Arial, sans-serif" font-size="${pathFont}" font-weight="900" fill="#23362b">${escapeXml(node.label)}</text>
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

    return colors[method] || { primary: "#9bc7c5", tint: "#efeeea", methodText: "#23362b" };
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

    const roots = state.cy.nodes("[kind = 'endpoint']");
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
    els.detailsBadge.textContent = "";
    els.detailsBody.innerHTML = renderNodeSummary(data, false) + renderSchemaExplorerAction(data);
    refreshIcons();
}

function renderEdgeDetails(data) {
    state.currentDetailsNode = null;
    els.detailsTitle.textContent = data.kind;
    els.detailsBadge.textContent = "";
    els.detailsBody.innerHTML = `
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
        <button class="schema-explorer-button" type="button" data-open-schema-explorer>
            <i data-lucide="list-tree"></i>
            <span>Even more details!</span>
        </button>
    `;
}

function renderNodeSummary(data, compact) {
    const props = data.properties || [];
    const enumValues = data.enumValues || [];
    const tags = data.tags || [];

    let html = "";
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
        <div class="property-row property-kind-${propertyKind(prop)} ${prop.inherited ? "inherited" : ""}">
            <div class="property-main">
                <span class="property-name">${prop.required ? `<span class="required-dot">*</span> ` : ""}${escapeHtml(prop.name)}</span>
                ${prop.enumValues?.length ? `<div class="enum-chip-row property-enums">${renderEnumChips(prop.enumValues)}</div>` : ""}
            </div>
            <span class="property-type">${escapeHtml(propertyType(prop))}</span>
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
    const response = await fetch(`/api/specs/${state.specId}/schemas?${params}`);
    if (!response.ok) {
        throw new Error(await response.text());
    }

    const schema = normalizeSchema(await response.json(), true);
    state.schemaCache.set(schema.id, schema);
    return schema;
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
        schema.nullable ? "nullable" : "",
        schema.cycleId ? `cycle ${schema.cycleId}` : ""
    ].filter(Boolean);

    const enumHtml = enumValues.length
        ? `<div class="schema-tree-enums">${renderEnumChips(enumValues)}</div>`
        : "";
    const descriptionHtml = schema.description
        ? `<div class="schema-tree-description">${escapeHtml(schema.description)}</div>`
        : "";

    const propertiesHtml = props.length
        ? renderPropertyGroups(
            props,
            (prop, index) => renderSchemaTreeProperty(prop, `${pathKey}.${index}`, trail, depth),
            "schema-tree-properties")
        : `<div class="schema-tree-empty">No properties</div>`;

    return `
        <div class="schema-tree-node" style="--schema-depth: ${depth}">
            <div class="schema-tree-model">
                <div class="schema-tree-model-main">
                    <div class="schema-tree-model-name">${escapeHtml(schema.label)}</div>
                    <div class="schema-tree-model-meta">${meta.map(item => `<span>${escapeHtml(item)}</span>`).join("")}</div>
                </div>
                <span class="schema-tree-property-count">${props.length}</span>
            </div>
            ${descriptionHtml}
            ${enumHtml}
            ${propertiesHtml}
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
            : prop.nullable
                ? `<span class="schema-tree-note">nullable</span>`
                : "";
    const childHtml = expanded
        ? state.schemaExplorerLoadErrors.has(refId)
            ? `<div class="schema-tree-loading error">Could not load ${escapeHtml(stripSchemaPrefix(refId))}</div>`
            : child
            ? renderSchemaTreeNode(child, pathKey, nextTrail, depth + 1)
            : `<div class="schema-tree-loading">Loading ${escapeHtml(stripSchemaPrefix(refId))}</div>`
        : "";

    return `
        <div class="schema-tree-property property-kind-${propertyKind(prop)}">
            <div class="schema-tree-property-row">
                ${toggle}
                <div class="schema-tree-property-main">
                    <span class="schema-tree-property-name">${prop.required ? `<span class="required-dot">*</span> ` : ""}${escapeHtml(prop.name)}</span>
                    ${prop.enumValues?.length ? `<div class="enum-chip-row property-enums">${renderEnumChips(prop.enumValues)}</div>` : ""}
                </div>
                ${extra}
                <span class="property-type">${escapeHtml(propertyType(prop))}</span>
            </div>
            ${childHtml}
        </div>
    `;
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
    if (prop.itemsRefId || type === "array") {
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
