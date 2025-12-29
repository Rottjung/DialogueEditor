// =============================
// Dialogue Editor - app.js
// =============================

const canvas = document.getElementById("canvas");
const edgesSvg = document.getElementById("edges");
const viewport = document.getElementById("viewport");
const importFile = document.getElementById("importFile");

// Enums (strings match Unity names)
const egoEnums = ["None", "Stable", "Fragmented", "Ghostly"];
const socialEnums = ["None", "Aristocrats", "Bourgeoisie", "Proletariat", "Marginals"];
const genderEnums = ["None", "Male", "Female", "Mixed"];
const ideologyEnums = [
    "None", "Romantic", "Cynical", "Traditional", "Progressive",
    "Natural", "Rational", "Moralistic", "Hedonistic", "Hypocratic", "Alienated"
];
// NOTE: your Unity enum has "Professional" not "Warrior". Use the Unity names here.
const purposeEnums = ["None", "Poet", "Lover", "Professional", "Altruist", "Nihilist"];

// -----------------------------
// State
// -----------------------------
let activePort = null; // click-click or drag-start port: { nodeId, kind, direction, el }
let isDraggingConnection = false;

let nodes = [];
let edges = [];
let nextId = 1;

let pan = { x: 0, y: 0 };
let zoom = 1;

let selectedNodeId = null;
let selectedEdgeId = null;

applyTransform();
syncEdgesSvgSize();

// -----------------------------
// Public API for HTML buttons
// -----------------------------
window.createNode = createNode;
window.exportJSON = exportJSON;
window.deleteSelected = deleteSelected;

// -----------------------------
// Node creation
// -----------------------------
function createNode(type) {
    const node = {
        id: nextId++,
        type,
        x: 100 + Math.random() * 200,
        y: 100 + Math.random() * 200,
        data: defaultData(type)
    };

    nodes.push(node);
    renderNode(node);
    selectNode(node.id);
    redrawEdges();
}

function defaultData(type) {
    if (type === "dialogue") {
        return { speaker: "NPC", text: "", stableText: "", fragmentedText: "", ghostlyText: "" };
    }
    if (type === "key") {
        return { social: "None", gender: "None", ideology: "None", purpose: "None" };
    }
    if (type === "ego") {
        return { ego: "None" };
    }
    return {};
}

// -----------------------------
// Ports
// -----------------------------
function createPort(node, kind, direction, y) {
    const p = document.createElement("div");
    p.className = `port ${kind} ${direction}`;
    p.style.top = y + "px";

    p.dataset.nodeId = node.id;
    p.dataset.kind = kind;
    p.dataset.direction = direction;

    // Click-click connect
    p.addEventListener("click", (e) => {
        e.stopPropagation();
        // clicking a port should not change node selection automatically
        onPortClicked(p);
    });

    // Drag connect (pointer)
    p.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        // Start drag from this port
        isDraggingConnection = true;
        activePort = toPortMeta(p);
        setPortActiveVisual(p, true);
        p.setPointerCapture(e.pointerId);
    });

    p.addEventListener("pointerup", (e) => {
        e.stopPropagation();
        if (!isDraggingConnection || !activePort) return;

        // If released on same port, do nothing
        // (Dropping on another port is handled by that port's pointerup below
        // via hit-testing; for safety we also try to resolve under cursor.)
        const targetPort = portUnderPointer(e.clientX, e.clientY);
        if (targetPort) {
            tryConnectPorts(activePort, toPortMeta(targetPort));
        }

        clearActivePort();
        isDraggingConnection = false;
    });

    // Allow dropping on THIS port
    p.addEventListener("pointerenter", (e) => {
        if (!isDraggingConnection || !activePort) return;
        p.classList.add("port-drop-target");
    });

    p.addEventListener("pointerleave", (e) => {
        p.classList.remove("port-drop-target");
    });

    return p;
}

function toPortMeta(portEl) {
    return {
        nodeId: Number(portEl.dataset.nodeId),
        kind: portEl.dataset.kind,
        direction: portEl.dataset.direction, // "in" | "out"
        el: portEl
    };
}

// -----------------------------
// Rendering
// -----------------------------
function renderNode(node) {
    const el = document.createElement("div");
    el.className = "node";
    el.style.left = node.x + "px";
    el.style.top = node.y + "px";
    el.dataset.id = node.id;

    // Select node on click/tap
    el.addEventListener("pointerdown", (e) => {
        // If they clicked a port/textarea/select, don't steal focus
        if (e.target && e.target.classList && e.target.classList.contains("port")) return;
        selectNode(node.id);
    });

    const header = document.createElement("header");
    header.textContent = `${node.type.toUpperCase()} #${node.id}`;
    el.appendChild(header);

    makeDraggable(el, header, node);

    if (node.type === "dialogue") {
        el.appendChild(createPort(node, "flow", "in", 30));
        el.appendChild(createPort(node, "flow", "out", 30));

        el.appendChild(makeSelect("Speaker", ["NPC", "Player", "Narrator"], node.data, "speaker", () => {
            renderDialogueFields(el, node);
        }));

        renderDialogueFields(el, node);
    }

    if (node.type === "key") {
        el.appendChild(createPort(node, "flow", "in", 30));

        el.appendChild(createPort(node, "social", "out", 40));
        el.appendChild(createPort(node, "gender", "out", 65));
        el.appendChild(createPort(node, "ideology", "out", 90));
        el.appendChild(createPort(node, "purpose", "out", 115));

        el.appendChild(makeSelect("Social", socialEnums, node.data, "social"));
        el.appendChild(makeSelect("Gender", genderEnums, node.data, "gender"));
        el.appendChild(makeSelect("Ideology", ideologyEnums, node.data, "ideology"));
        el.appendChild(makeSelect("Purpose", purposeEnums, node.data, "purpose"));
    }

    if (node.type === "ego") {
        el.appendChild(makeSelect("Ego", egoEnums, node.data, "ego"));
    }

    canvas.appendChild(el);
    updateNodeSelectedVisuals();
}

function renderDialogueFields(el, node) {
    el.querySelectorAll(".dialogue-fields").forEach(e => e.remove());

    const wrap = document.createElement("div");
    wrap.className = "dialogue-fields";

    if (node.data.speaker === "Player") {
        wrap.appendChild(makeTextarea("Stable", node.data, "stableText"));
        wrap.appendChild(makeTextarea("Fragmented", node.data, "fragmentedText"));
        wrap.appendChild(makeTextarea("Ghostly", node.data, "ghostlyText"));
    } else {
        wrap.appendChild(makeTextarea("Text", node.data, "text"));
    }

    el.appendChild(wrap);
}

// -----------------------------
// UI helpers
// -----------------------------
function makeTextarea(label, obj, key) {
    const wrap = document.createElement("div");
    const l = document.createElement("label");
    l.textContent = label;
    const t = document.createElement("textarea");
    t.value = obj[key] ?? "";
    t.addEventListener("input", () => obj[key] = t.value);
    wrap.appendChild(l);
    wrap.appendChild(t);
    return wrap;
}

function makeSelect(label, values, obj, key, onChange) {
    const wrap = document.createElement("div");
    const l = document.createElement("label");
    l.textContent = label;
    const s = document.createElement("select");

    values.forEach(v => {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = v;
        s.appendChild(o);
    });

    s.value = obj[key];
    s.addEventListener("change", () => {
        obj[key] = s.value;
        if (onChange) onChange();
    });

    wrap.appendChild(l);
    wrap.appendChild(s);
    return wrap;
}

// -----------------------------
// Selection (node / edge)
// -----------------------------
function selectNode(nodeId) {
    selectedNodeId = nodeId;
    selectedEdgeId = null;
    updateNodeSelectedVisuals();
    updateEdgeSelectedVisuals();
}

function selectEdge(edgeId) {
    selectedEdgeId = edgeId;
    selectedNodeId = null;
    updateNodeSelectedVisuals();
    updateEdgeSelectedVisuals();
}

function clearSelection() {
    selectedNodeId = null;
    selectedEdgeId = null;
    updateNodeSelectedVisuals();
    updateEdgeSelectedVisuals();
}

function updateNodeSelectedVisuals() {
    document.querySelectorAll(".node").forEach(n => {
        const id = Number(n.dataset.id);
        n.classList.toggle("selected-node", id === selectedNodeId);
    });
}

function updateEdgeSelectedVisuals() {
    edgesSvg.querySelectorAll("path.connection").forEach(p => {
        const id = Number(p.dataset.edgeId);
        p.classList.toggle("selected-edge", id === selectedEdgeId);
    });
}

// Click empty space clears selection
viewport.addEventListener("pointerdown", (e) => {
    // Only if background / edges svg / canvas are clicked
    const isBg = (e.target === viewport || e.target === canvas || e.target === edgesSvg);
    if (isBg) clearSelection();
});

// -----------------------------
// Delete Selected
// -----------------------------
function deleteSelected() {
    // Priority: edge delete first
    if (selectedEdgeId != null) {
        edges = edges.filter(e => e._id !== selectedEdgeId);
        selectedEdgeId = null;
        redrawEdges();
        return;
    }

    // Then node delete
    if (selectedNodeId != null) {
        const nid = selectedNodeId;

        // remove node
        nodes = nodes.filter(n => n.id !== nid);

        // remove node DOM
        const el = canvas.querySelector(`.node[data-id="${nid}"]`);
        if (el) el.remove();

        // remove connected edges
        edges = edges.filter(e => e.from.nodeId !== nid && e.to.nodeId !== nid);

        selectedNodeId = null;
        redrawEdges();
    }
}

// -----------------------------
// Connecting ports (click-click + drag)
// -----------------------------
function onPortClicked(portEl) {
    const port = toPortMeta(portEl);

    if (!activePort) {
        activePort = port;
        setPortActiveVisual(portEl, true);
        return;
    }

    // Second click
    tryConnectPorts(activePort, port);
    clearActivePort();
}

function tryConnectPorts(a, b) {
    if (!a || !b) return;

    // Prevent same-direction or same-node
    if (a.direction === b.direction) return;
    if (a.nodeId === b.nodeId) return;

    // Normalize: from = out, to = in
    const from = a.direction === "out" ? a : b;
    const to = a.direction === "out" ? b : a;

    // Basic validity: only connect out->in
    if (from.direction !== "out" || to.direction !== "in") return;

    // Optional: apply compatibility rules similar to Unity here if you want.
    // For now: allow any out->in.
    const edge = {
        _id: nextEdgeId(),
        from: { nodeId: from.nodeId, kind: from.kind, direction: "Output", index: 0 },
        to: { nodeId: to.nodeId, kind: to.kind, direction: "Input", index: 0 }
    };

    // prevent duplicates
    if (edges.some(e =>
        e.from.nodeId === edge.from.nodeId &&
        e.to.nodeId === edge.to.nodeId &&
        e.from.kind === edge.from.kind &&
        e.to.kind === edge.to.kind
    )) {
        return;
    }

    edges.push(edge);
    redrawEdges();
}

function setPortActiveVisual(portEl, on) {
    portEl.style.outline = on ? "2px solid white" : "";
}

function clearActivePort() {
    if (activePort && activePort.el) setPortActiveVisual(activePort.el, false);
    activePort = null;
    isDraggingConnection = false;
}

function portUnderPointer(clientX, clientY) {
    // Use elementsFromPoint to find a .port under the pointer
    const els = document.elementsFromPoint(clientX, clientY);
    return els.find(e => e.classList && e.classList.contains("port")) || null;
}

let _edgeIdCounter = 1;
function nextEdgeId() {
    return _edgeIdCounter++;
}

// -----------------------------
// Edges rendering
// -----------------------------
function redrawEdges() {
    edgesSvg.innerHTML = "";
    syncEdgesSvgSize();

    edges.forEach(e => {
        const fromEl = findPortEl(e.from);
        const toEl = findPortEl(e.to);
        if (!fromEl || !toEl) return;

        const p1 = portCenter(fromEl);
        const p2 = portCenter(toEl);

        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.classList.add("connection");
        path.dataset.edgeId = e._id;

        // Curve
        const dx = Math.max(60, Math.min(160, Math.abs(p2.x - p1.x) * 0.35));
        path.setAttribute(
            "d",
            `M ${p1.x} ${p1.y} C ${p1.x + dx} ${p1.y}, ${p2.x - dx} ${p2.y}, ${p2.x} ${p2.y}`
        );

        // Click edge to select
        path.addEventListener("pointerdown", (ev) => {
            ev.stopPropagation();
            selectEdge(e._id);
        });

        edgesSvg.appendChild(path);
    });

    updateEdgeSelectedVisuals();
}

function portCenter(el) {
    const r = el.getBoundingClientRect();
    const vr = viewport.getBoundingClientRect();
    return {
        x: (r.left + r.width / 2 - vr.left),
        y: (r.top + r.height / 2 - vr.top)
    };
}

function findPortEl(ref) {
    // Ref.kind in edges is like "flow/social" (lowercase)
    // We stored "flow" etc. in DOM dataset.kind already.
    const kindLower = String(ref.kind).toLowerCase();

    // Also must match direction to avoid matching the wrong side
    const wantDir = (ref.direction === "Output") ? "out" : "in";

    return [...document.querySelectorAll(".port")].find(p =>
        Number(p.dataset.nodeId) === ref.nodeId &&
        p.dataset.kind === kindLower &&
        p.dataset.direction === wantDir
    );
}

function syncEdgesSvgSize() {
    // Make SVG coordinate system match viewport pixels
    const rect = viewport.getBoundingClientRect();
    edgesSvg.setAttribute("width", rect.width);
    edgesSvg.setAttribute("height", rect.height);
    edgesSvg.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
}

window.addEventListener("resize", () => {
    syncEdgesSvgSize();
    redrawEdges();
});

// -----------------------------
// Dragging nodes
// -----------------------------
function makeDraggable(el, handle, node) {
    let startX, startY;

    handle.onpointerdown = (e) => {
        // Don't start node drag if we're starting a connection drag
        if (e.target && e.target.classList && e.target.classList.contains("port")) return;

        selectNode(node.id);

        handle.setPointerCapture(e.pointerId);
        startX = e.clientX;
        startY = e.clientY;

        handle.onpointermove = (ev) => {
            const dx = (ev.clientX - startX) / zoom;
            const dy = (ev.clientY - startY) / zoom;
            node.x += dx;
            node.y += dy;
            el.style.left = node.x + "px";
            el.style.top = node.y + "px";
            startX = ev.clientX;
            startY = ev.clientY;

            redrawEdges();
        };

        handle.onpointerup = () => {
            handle.onpointermove = null;
        };
    };
}

// -----------------------------
// Pan / zoom
// -----------------------------
let lastPan = null;

viewport.addEventListener("pointerdown", e => {
    // Don't pan if clicking a node/port/control
    const isBg = (e.target === canvas || e.target === edgesSvg || e.target === viewport);
    if (!isBg) return;

    lastPan = { x: e.clientX, y: e.clientY };
});

document.addEventListener("pointermove", e => {
    if (!lastPan) return;
    pan.x += e.clientX - lastPan.x;
    pan.y += e.clientY - lastPan.y;
    lastPan = { x: e.clientX, y: e.clientY };
    applyTransform();
});

document.addEventListener("pointerup", () => lastPan = null);

viewport.addEventListener("wheel", e => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1.1 : 0.9;
    zoom *= delta;
    zoom = Math.max(0.3, Math.min(2, zoom));
    applyTransform();
}, { passive: false });

function applyTransform() {
    const t = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    canvas.style.transform = t;
    edgesSvg.style.transform = t;
}

// -----------------------------
// Export / Import
// -----------------------------
function exportJSON() {
    // Keep edges stable ids in export
    const data = {
        version: 1,
        nodes,
        edges: edges.map(e => ({
            from: e.from,
            to: e.to
        }))
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "dialogue.json";
    a.click();
}

importFile.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
        const data = JSON.parse(reader.result);
        loadGraph(data);
    };
    reader.readAsText(file);
};

function loadGraph(data) {
    nodes = [];
    edges = [];
    canvas.innerHTML = "";
    nextId = 1;
    _edgeIdCounter = 1;

    if (!data || !Array.isArray(data.nodes)) return;

    data.nodes.forEach(n => {
        nodes.push(n);
        nextId = Math.max(nextId, n.id + 1);
        renderNode(n);
    });

    if (Array.isArray(data.edges)) {
        data.edges.forEach(e => {
            edges.push({
                _id: nextEdgeId(),
                from: e.from,
                to: e.to
            });
        });
    }

    clearSelection();
    redrawEdges();
}
