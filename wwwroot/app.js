const graphSettingDefaults = {
    hideEnums: true,
    hideErrorResponses: true,
    horizontalGap: 1.2,
    verticalGap: 1.2
};

const panelWidthDefaults = {
    left: 360,
    right: 360,
    min: 260,
    max: 560
};

const state = {
    specId: null,
    endpoints: [],
    allEndpoints: [],
    selected: new Map(),
    favorites: readFavoriteEndpoints(),
    collapsedSections: new Set(),
    method: "",
    cy: null,
    lastGraph: null,
    searchTimer: null
};

const els = {
    fileInput: document.getElementById("fileInput"),
    fileLabel: document.getElementById("fileLabel"),
    specMeta: document.getElementById("specMeta"),
    endpointSearch: document.getElementById("endpointSearch"),
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
    resetSettingsButton: document.getElementById("resetSettingsButton"),
    layoutButton: document.getElementById("layoutButton"),
    fitButton: document.getElementById("fitButton"),
    graphStatus: document.getElementById("graphStatus"),
    graph: document.getElementById("graph"),
    emptyGraph: document.getElementById("emptyGraph"),
    detailsTitle: document.getElementById("detailsTitle"),
    detailsBadge: document.getElementById("detailsBadge"),
    detailsBody: document.getElementById("detailsBody"),
    resizeHandles: document.querySelectorAll("[data-resize-panel]")
};

window.addEventListener("DOMContentLoaded", () => {
    restorePanelWidths();
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
    els.resetSettingsButton.addEventListener("click", resetGraphSettings);
    els.layoutButton.addEventListener("click", runLayout);
    els.fitButton.addEventListener("click", () => state.cy?.fit(undefined, 40));
    document.addEventListener("click", () => setSettingsOpen(false));
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
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

function resetGraphSettings() {
    els.hideEnumsInput.checked = graphSettingDefaults.hideEnums;
    els.hideErrorResponsesInput.checked = graphSettingDefaults.hideErrorResponses;
    els.horizontalGapInput.value = String(graphSettingDefaults.horizontalGap);
    els.verticalGapInput.value = String(graphSettingDefaults.verticalGap);
    updateGraphGaps();
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
        els.specMeta.textContent = `${summary.title} ${summary.version} - ${summary.endpointCount} endpoints - ${summary.schemaCount} schemas - ${summary.cycleCount} cycles`;
        await loadAllEndpoints();
        await loadEndpoints();
        renderSelected();
        updateGraph();
        setStatus("Ready");
    } catch (error) {
        console.error(error);
        setStatus("Import failed");
        els.specMeta.textContent = "Import failed";
    }
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
                    "font-size": 11,
                    "font-family": "Segoe UI, system-ui, sans-serif",
                    "text-wrap": "wrap",
                    "text-max-width": 136,
                    "text-valign": "center",
                    "text-halign": "center",
                    "color": "#112D4E",
                    "background-color": "#DBE2EF",
                    "border-width": 2,
                    "border-color": "#3F72AF",
                    "width": 148,
                    "height": 58,
                    "shape": "round-rectangle",
                    "overlay-padding": 6
                }
            },
            {
                selector: "node[kind = 'endpoint']",
                style: {
                    "shape": "round-rectangle",
                    "width": 178,
                    "height": 54,
                    "text-max-width": 158,
                    "background-color": "#3F72AF",
                    "border-color": "#112D4E",
                    "color": "#F9F7F7",
                    "font-size": 10,
                    "font-weight": 800,
                    "text-outline-width": 0
                }
            },
            {
                selector: ".enum-node",
                style: {
                    "shape": "round-rectangle",
                    "background-color": "#F9F7F7",
                    "border-color": "#3F72AF",
                    "width": 136,
                    "height": 54
                }
            },
            { selector: "node[method = 'GET']", style: { "background-color": "#3F72AF", "border-color": "#112D4E", "border-width": 3 } },
            { selector: "node[method = 'POST']", style: { "background-color": "#112D4E", "border-color": "#0B1F36", "border-width": 3 } },
            { selector: "node[method = 'PUT']", style: { "background-color": "#2E5F9E", "border-color": "#112D4E", "border-width": 3 } },
            { selector: "node[method = 'PATCH']", style: { "background-color": "#6F91C2", "border-color": "#3F72AF", "border-width": 3, "color": "#112D4E" } },
            { selector: "node[method = 'DELETE']", style: { "background-color": "#9B4057", "border-color": "#112D4E", "border-width": 3 } },
            {
                selector: "node[cycleId]",
                style: {
                    "border-color": "#112D4E",
                    "border-style": "solid",
                    "border-width": 4
                }
            },
            {
                selector: "edge",
                style: {
                    "curve-style": "bezier",
                    "target-arrow-shape": "triangle",
                    "target-arrow-color": "#3F72AF",
                    "line-color": "#3F72AF",
                    "width": 2,
                    "label": "data(label)",
                    "font-size": 13,
                    "font-weight": 750,
                    "font-family": "Segoe UI, system-ui, sans-serif",
                    "color": "#112D4E",
                    "text-background-color": "#F9F7F7",
                    "text-background-opacity": 1,
                    "text-background-padding": 4,
                    "text-rotation": "autorotate",
                    "text-margin-y": -12,
                    "overlay-padding": 4
                }
            },
            { selector: "edge[kind = 'Property']", style: { "line-color": "#6D86A7", "target-arrow-color": "#6D86A7" } },
            { selector: "edge[kind = 'ArrayItem']", style: { "line-color": "#112D4E", "target-arrow-color": "#112D4E" } },
            { selector: "edge[kind = 'Inheritance']", style: { "line-color": "#112D4E", "target-arrow-color": "#112D4E", "width": 3 } },
            { selector: "edge[kind = 'AllOf']", style: { "line-color": "#3F72AF", "target-arrow-color": "#3F72AF", "line-style": "dashed" } },
            { selector: "edge[kind = 'OneOf']", style: { "line-color": "#112D4E", "target-arrow-color": "#112D4E", "line-style": "dotted" } },
            { selector: "edge[kind = 'AnyOf']", style: { "line-color": "#6F91C2", "target-arrow-color": "#6F91C2", "line-style": "dotted" } },
            { selector: "edge[kind = 'ResponseBody']", style: { "line-color": "#3F72AF", "target-arrow-color": "#3F72AF", "width": 2.6 } },
            { selector: "edge[kind = 'RequestBody']", style: { "line-color": "#112D4E", "target-arrow-color": "#112D4E", "width": 2.6 } },
            { selector: "edge[kind = 'Parameter']", style: { "line-color": "#6D86A7", "target-arrow-color": "#6D86A7" } },
            {
                selector: ":selected",
                style: {
                    "border-color": "#111827",
                    "border-width": 4,
                    "line-color": "#111827",
                    "target-arrow-color": "#111827"
                }
            }
        ]
    });

    state.cy.on("tap", "node", event => renderDetails(event.target.data()));
    state.cy.on("tap", "edge", event => renderEdgeDetails(event.target.data()));
}

async function updateGraph() {
    if (!state.specId || state.selected.size === 0) {
        state.lastGraph = null;
        state.cy.elements().remove();
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

    const elements = [
        ...graph.nodes.map(node => ({
            group: "nodes",
            classes: node.enumValues?.length ? "enum-node" : "",
            data: {
                id: node.id,
                kind: node.kind,
                label: node.kind === "endpoint" ? endpointNodeLabel(node) : node.label,
                rawLabel: node.label,
                subtitle: node.subtitle,
                method: node.method,
                cycleId: node.cycleId,
                properties: node.properties || [],
                enumValues: node.enumValues || [],
                enumCount: node.enumValues?.length || 0,
                tags: node.tags || []
            }
        })),
        ...graph.edges.map(edge => ({
            group: "edges",
            data: {
                id: edge.id,
                source: edge.source,
                target: edge.target,
                kind: edge.kind,
                label: shortEdgeLabel(edge.label),
                fullLabel: edge.label
            }
        }))
    ];

    state.cy.elements().remove();
    state.cy.add(elements);
    runLayout();

    const warning = graph.warnings?.[0] ? ` - ${graph.warnings[0]}` : "";
    setStatus(`${graph.nodes.length} nodes - ${graph.edges.length} edges - ${graph.cycles.length} cycles${warning}`);
}

function endpointNodeLabel(node) {
    return `${node.method || "HTTP"} ${node.label}`;
}

function runLayout() {
    if (!state.cy || state.cy.nodes().length === 0) {
        return;
    }

    const roots = state.cy.nodes("[kind = 'endpoint']");
    const horizontalGap = Number.parseFloat(els.horizontalGapInput.value) || 1.2;
    const verticalGap = Number.parseFloat(els.verticalGapInput.value) || 1.2;
    state.cy.layout({
        name: "breadthfirst",
        directed: true,
        roots,
        spacingFactor: 1,
        avoidOverlap: true,
        animate: true,
        animationDuration: 220,
        fit: true,
        padding: 34,
        transform: (_node, position) => ({
            x: position.y * horizontalGap,
            y: position.x * verticalGap
        })
    }).run();
}

function renderDetails(data) {
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

    els.detailsTitle.textContent = data.label;
    els.detailsBadge.textContent = data.method || data.kind;
    els.detailsBody.innerHTML = renderNodeSummary(data, false);
}

function renderEdgeDetails(data) {
    els.detailsTitle.textContent = data.kind;
    els.detailsBadge.textContent = "edge";
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
        html += `
            <div class="detail-block">
                <div class="detail-label">Id</div>
                <div class="detail-value">${escapeHtml(data.id)}</div>
            </div>
        `;
        if (data.subtitle) {
            html += `
                <div class="detail-block">
                    <div class="detail-label">Summary</div>
                    <div class="detail-value">${escapeHtml(data.subtitle)}</div>
                </div>
            `;
        }
        if (data.cycleId) {
            html += `
                <div class="detail-block">
                    <div class="detail-label">Cycle</div>
                    <div class="detail-value">${escapeHtml(String(data.cycleId))}</div>
                </div>
            `;
        }
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

    const propertyRows = props.map(prop => `
        <div class="property-row property-kind-${propertyKind(prop)}">
            <div class="property-main">
                <span class="property-name">${prop.required ? `<span class="required-dot">*</span> ` : ""}${escapeHtml(prop.name)}</span>
                ${prop.enumValues?.length ? `<div class="enum-chip-row property-enums">${renderEnumChips(prop.enumValues)}</div>` : ""}
            </div>
            <span class="property-type">${escapeHtml(propertyType(prop))}</span>
        </div>
    `).join("");

    if (compact) {
        html += `<div class="property-list">${propertyRows}</div>`;
    } else {
        html += `
            <div class="detail-block">
                <div class="detail-label">Properties</div>
                <div class="property-list">${propertyRows}</div>
            </div>
        `;
    }

    return html;
}

function renderEnumChips(values) {
    return values
        .map(value => `<span class="enum-chip">${escapeHtml(value)}</span>`)
        .join("");
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
