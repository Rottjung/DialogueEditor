// =====================================================
// Dialogue Editor - app.js (working pan/zoom + edges)
// =====================================================

const canvas = document.getElementById("canvas");
const edgesSvg = document.getElementById("edges");
const viewport = document.getElementById("viewport");
const importFile = document.getElementById("importFile");

// Ensure SVG can receive pointer input for edge selection
edgesSvg.style.pointerEvents = "auto";

// --- enums (keep yours) ---
const egoEnums = ["None", "Stable", "Fragmented", "Ghostly"];
const socialEnums = ["None", "Aristocrats", "Bourgeoisie", "Proletariat", "Marginals"];
const genderEnums = ["None", "Male", "Female", "Mixed"];
const ideologyEnums = [
    "None", "Romantic", "Cynical", "Traditional", "Progressive",
    "Natural", "Rational", "Moralistic", "Hedonistic", "Hypocratic", "Alienated"
];
const purposeEnums = ["None", "Poet", "Lover", "Warrior", "Altruist", "Nihilist"];

// --- graph state ---
let nodes = [];
let edges = [];
let nextId = 1;

// selection
let selectedNodeId = null;
let selectedEdgeId = null;

// connection interaction
let activePort = null;          // click-click mode
let drag = null;                // drag mode { fromPort, tempPath }
let lastPointer = { x: 0, y: 0 };

// pan/zoom
let pan = { x: 0, y: 0 };
let zoom = 1;

applyTransform();
syncSvgSize();

// Resize SVG to viewport on resize
window.addEventListener("resize", () => {
    syncSvgSize();
    redrawEdges();
});

// =====================================================
// Node creation
// =====================================================
window.createNode = function (type) {
    const node = {
        id: nextId++,
        type,
        x: 120 + Math.random() * 240,
        y: 120 + Math.random() * 240,
        data: defaultData(type)
    };
    nodes.push(node);
    renderNode(node);
    selectNode(node.id);
    redrawEdges();
};

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

// =====================================================
// Rendering nodes
// =====================================================
function renderNode(node) {
    const el = document.createElement("div");
    el.className = "node";
    el.style.left = node.x + "px";
    el.style.top = node.y + "px";
    el.dataset.id = node.id;

    // click on node selects it (but don't steal from port clicks)
    el.addEventListener("pointerdown", (e) => {
        if (e.target.classList.contains("port")) return;
        selectNode(node.id);
        e.stopPropagation();
    });

    const header = document.createElement("header");
    header.textContent = `${node.type.toUpperCase()} #${node.id}`;
    el.appendChild(header);

    makeDraggable(el, header, node);

    // ports + fields
    if (node.type === "dialogue") {
        el.appendChild(createPort(node, "flow", "in", 30));
        el.appendChild(createPort(node, "flow", "out", 30));

        el.appendChild(makeSelect("Speaker", ["NPC", "Player", "Narrator"], node.data, "speaker", () => {
            renderDialogueFields(el, node);
            redrawEdges();
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

// =====================================================
// Ports + connecting
// =====================================================
function createPort(node, kind, direction, y) {
    const p = document.createElement("div");
    p.className = `port ${kind} ${direction}`;
    p.style.top = y + "px";

    p.dataset.nodeId = node.id;
    p.dataset.nodeType = node.type;
    p.dataset.kind = kind;           // "flow", "social", ...
    p.dataset.direction = direction; // "in" or "out"

    // click-click support
    p.addEventListener("click", (e) => {
        e.stopPropagation();
        onPortClick(p);
    });

    // drag support
    p.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        startPortDrag(p, e);
    });

    return p;
}

function onPortClick(portEl) {
    const port = readPort(portEl);

    // If dragging is active, ignore click connect
    if (drag) return;

    if (!activePort) {
        activePort = port;
        setPortActiveVisual(activePort.el, true);
        return;
    }

    // If clicking same port: cancel
    if (activePort.el === port.el) {
        clearActivePort();
        return;
    }

    // Try connect
    tryConnect(activePort, port);
    clearActivePort();
}

function startPortDrag(portEl, e) {
    // If click-click already armed, disarm it (drag should take over)
    clearActivePort();

    const fromPort = readPort(portEl);

    // Start drag only from an OUTPUT port (feels better), but allow either:
    // We'll normalize later anyway.
    drag = {
        fromPort,
        tempPath: createTempPath()
    };

    setPortActiveVisual(fromPort.el, true);

    // capture pointer globally so we can drag outside nodes
    viewport.setPointerCapture(e.pointerId);

    viewport.addEventListener("pointermove", onDragMove);
    viewport.addEventListener("pointerup", onDragEnd, { once: true });

    // initial draw
    updateTempPath(lastPointer.x, lastPointer.y);
}

function onDragMove(e) {
    lastPointer = { x: e.clientX, y: e.clientY };
    updateTempPath(e.clientX, e.clientY);
}

function onDragEnd(e) {
    viewport.removeEventListener("pointermove", onDragMove);

    // figure out if we released over a port
    const elUnder = document.elementFromPoint(e.clientX, e.clientY);
    const targetPortEl = elUnder && elUnder.classList && elUnder.classList.contains("port")
        ? elUnder
        : (elUnder && elUnder.closest ? elUnder.closest(".port") : null);

    if (targetPortEl) {
        const toPort = readPort(targetPortEl);
        tryConnect(drag.fromPort, toPort);
    }

    // cleanup ghost + visuals
    if (drag?.tempPath) drag.tempPath.remove();
    if (drag?.fromPort?.el) setPortActiveVisual(drag.fromPort.el, false);
    drag = null;

    redrawEdges();
}

function tryConnect(a, b) {
    // Prevent same-node
    if (a.nodeId === b.nodeId) return;

    // Prevent same direction
    if (a.direction === b.direction) return;

    // Normalize
    const from = a.direction === "out" ? a : b;
    const to = a.direction === "out" ? b : a;

    // Compatibility rules (match your Unity logic)
    if (!isCompatible(from, to)) return;

    // Prevent duplicates
    const id = edgeId(from, to);
    if (edges.some(e => e.id === id)) return;

    edges.push({
        id,
        from: {
            nodeId: from.nodeId,
            kind: toPortKindEnum(from.kind),
            direction: "Output",
            index: 0
        },
        to: {
            nodeId: to.nodeId,
            kind: toPortKindEnum(to.kind),
            direction: "Input",
            index: 0
        }
    });

    redrawEdges();
}

function isCompatible(from, to) {
    // Ego disallowed entirely in web tool (no ports anyway)
    if (!from || !to) return false;

    // types
    const fromType = from.nodeType;
    const toType = to.nodeType;

    // Dialogue -> Dialogue flow only
    if (fromType === "dialogue" && toType === "dialogue") {
        return from.kind === "flow" && to.kind === "flow";
    }

    // Dialogue -> Key hub entry (flow)
    if (fromType === "dialogue" && toType === "key") {
        return from.kind === "flow" && to.kind === "flow";
    }

    // Key -> Dialogue gating: key outputs (social/gender/ideology/purpose) -> dialogue flow in
    if (fromType === "key" && toType === "dialogue") {
        return to.kind === "flow" && from.kind !== "flow";
    }

    return false;
}

function readPort(portEl) {
    return {
        nodeId: Number(portEl.dataset.nodeId),
        nodeType: portEl.dataset.nodeType,
        kind: portEl.dataset.kind,           // lowercase: flow/social/...
        direction: portEl.dataset.direction, // in/out
        el: portEl
    };
}

function clearActivePort() {
    if (activePort?.el) setPortActiveVisual(activePort.el, false);
    activePort = null;
}

function setPortActiveVisual(portEl, on) {
    portEl.style.outline = on ? "2px solid white" : "";
}

// Unity uses PortKind enums; we keep strings but export as enum-like strings
function toPortKindEnum(kindLower) {
    // flow/social/gender/ideology/purpose -> Flow/Social/...
    return kindLower.charAt(0).toUpperCase() + kindLower.slice(1);
}

function edgeId(from, to) {
    return `${from.nodeId}:${from.kind}:${from.direction}->${to.nodeId}:${to.kind}:${to.direction}`;
}

// =====================================================
// Drawing edges (viewport-space SVG, NO SVG transform)
// =====================================================
function redrawEdges() {
    // Keep temp drag path if any; wipe everything else
    const temp = drag?.tempPath || null;
    edgesSvg.innerHTML = "";
    if (temp) edgesSvg.appendChild(temp);

    for (const e of edges) {
        const fromEl = findPortElForRef(e.from);
        const toEl = findPortElForRef(e.to);
        if (!fromEl || !toEl) continue;

        const p1 = portCenterViewport(fromEl);
        const p2 = portCenterViewport(toEl);

        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", bezier(p1, p2));
        path.classList.add("connection");

        // Allow selecting edges
        path.style.pointerEvents = "stroke";
        path.dataset.edgeId = e.id;

        if (e.id === selectedEdgeId) {
            path.style.stroke = "#4aa3ff";
            path.style.strokeWidth = "3";
        }

        path.addEventListener("pointerdown", (ev) => {
            ev.stopPropagation();
            selectEdge(e.id);
        });

        edgesSvg.appendChild(path);
    }
}

function bezier(p1, p2) {
    const dx = Math.max(60, Math.min(160, Math.abs(p2.x - p1.x) * 0.35));
    const c1x = p1.x + dx;
    const c2x = p2.x - dx;
    return `M ${p1.x} ${p1.y} C ${c1x} ${p1.y}, ${c2x} ${p2.y}, ${p2.x} ${p2.y}`;
}

function portCenterViewport(el) {
    const r = el.getBoundingClientRect();
    const vr = viewport.getBoundingClientRect();
    return {
        x: (r.left + r.width / 2) - vr.left,
        y: (r.top + r.height / 2) - vr.top
    };
}

function findPortElForRef(ref) {
    const nodeId = ref.nodeId;
    const kind = String(ref.kind).toLowerCase(); // Flow->flow etc

    // Need direction: Output/Input -> out/in
    const dir = ref.direction === "Output" ? "out" : "in";

    return [...document.querySelectorAll(".port")].find(p =>
        Number(p.dataset.nodeId) === nodeId &&
        p.dataset.kind === kind &&
        p.dataset.direction === dir
    );
}

// Temp dotted drag path
function createTempPath() {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.classList.add("connection");
    path.style.strokeDasharray = "6 6";
    path.style.opacity = "0.8";
    path.style.pointerEvents = "none";
    edgesSvg.appendChild(path);
    return path;
}

function updateTempPath(clientX, clientY) {
    if (!drag?.fromPort?.el || !drag?.tempPath) return;

    const vr = viewport.getBoundingClientRect();
    const p2 = { x: clientX - vr.left, y: clientY - vr.top };
    const p1 = portCenterViewport(drag.fromPort.el);

    drag.tempPath.setAttribute("d", bezier(p1, p2));
}

// Keep svg sized to viewport so paths map 1:1
function syncSvgSize() {
    const r = viewport.getBoundingClientRect();
    edgesSvg.setAttribute("width", r.width);
    edgesSvg.setAttribute("height", r.height);
    edgesSvg.setAttribute("viewBox", `0 0 ${r.width} ${r.height}`);
}

// =====================================================
// Selecting nodes / edges
// =====================================================
function selectNode(nodeId) {
    selectedNodeId = nodeId;
    selectedEdgeId = null;

    document.querySelectorAll(".node").forEach(n => {
        n.style.outline = (Number(n.dataset.id) === nodeId) ? "2px solid #4aa3ff" : "";
    });

    redrawEdges();
}

function selectEdge(edgeId) {
    selectedEdgeId = edgeId;
    selectedNodeId = null;

    document.querySelectorAll(".node").forEach(n => n.style.outline = "");
    redrawEdges();
}

// Clicking empty space clears selection
viewport.addEventListener("pointerdown", (e) => {
    // If click on empty viewport background (not node/port/edge)
    if (e.target === viewport || e.target === canvas || e.target === edgesSvg) {
        selectedNodeId = null;
        selectedEdgeId = null;
        document.querySelectorAll(".node").forEach(n => n.style.outline = "");
        redrawEdges();
    }
});

// =====================================================
// Delete Selected
// =====================================================
window.deleteSelected = function () {
    // delete edge
    if (selectedEdgeId) {
        edges = edges.filter(e => e.id !== selectedEdgeId);
        selectedEdgeId = null;
        redrawEdges();
        return;
    }

    // delete node
    if (selectedNodeId) {
        // remove node from nodes array
        nodes = nodes.filter(n => n.id !== selectedNodeId);

        // remove any edges connected to this node
        edges = edges.filter(e => e.from.nodeId !== selectedNodeId && e.to.nodeId !== selectedNodeId);

        // remove node element
        const el = canvas.querySelector(`.node[data-id="${selectedNodeId}"]`);
        if (el) el.remove();

        selectedNodeId = null;
        redrawEdges();
    }
};

// =====================================================
// UI helper controls
// =====================================================
function makeTextarea(label, obj, key) {
    const wrap = document.createElement("div");
    const l = document.createElement("label");
    l.textContent = label;

    const t = document.createElement("textarea");
    t.value = obj[key] || "";
    t.oninput = () => obj[key] = t.value;

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
    s.onchange = () => {
        obj[key] = s.value;
        if (onChange) onChange();
    };

    wrap.appendChild(l);
    wrap.appendChild(s);
    return wrap;
}

// =====================================================
// Dragging nodes (updates edges live)
// =====================================================
function makeDraggable(el, handle, node) {
    let startX, startY;

    handle.onpointerdown = (e) => {
        // Don’t drag if starting from a port
        if (e.target.classList.contains("port")) return;

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

// =====================================================
// Pan / zoom (ONLY transform #canvas, NOT the SVG)
// =====================================================
let lastPan = null;

viewport.addEventListener("pointerdown", (e) => {
    // Pan only when clicking empty space (not node/port)
    if (e.target.closest && e.target.closest(".node")) return;
    lastPan = { x: e.clientX, y: e.clientY };
});

document.addEventListener("pointermove", (e) => {
    if (!lastPan) return;
    pan.x += e.clientX - lastPan.x;
    pan.y += e.clientY - lastPan.y;
    lastPan = { x: e.clientX, y: e.clientY };
    applyTransform();
    redrawEdges();
});

document.addEventListener("pointerup", () => lastPan = null);

viewport.addEventListener("wheel", (e) => {
    e.preventDefault();

    // zoom around cursor (optional but feels good)
    const before = screenToCanvas(e.clientX, e.clientY);

    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    zoom *= factor;
    zoom = Math.max(0.3, Math.min(2.0, zoom));

    const after = screenToCanvas(e.clientX, e.clientY);

    // adjust pan so point under cursor stays put
    pan.x += (after.x - before.x) * zoom;
    pan.y += (after.y - before.y) * zoom;

    applyTransform();
    redrawEdges();
}, { passive: false });

function applyTransform() {
    canvas.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
}

function screenToCanvas(clientX, clientY) {
    // Converts screen point into "canvas space" (approx) for zoom-around
    const vr = viewport.getBoundingClientRect();
    const x = (clientX - vr.left - pan.x) / zoom;
    const y = (clientY - vr.top - pan.y) / zoom;
    return { x, y };
}

// =====================================================
// Export / Import
// =====================================================
window.exportJSON = function () {
    const data = {
        version: 1,
        nodes,
        edges
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "dialogue.json";
    a.click();
};

importFile.onchange = (e) => {
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
    // Clear DOM
    canvas.innerHTML = "";
    edgesSvg.innerHTML = "";

    nodes = [];
    edges = [];
    nextId = 1;
    selectedNodeId = null;
    selectedEdgeId = null;
    clearActivePort();
    if (drag?.tempPath) drag.tempPath.remove();
    drag = null;

    // Load nodes
    if (Array.isArray(data.nodes)) {
        for (const n of data.nodes) {
            nodes.push(n);
            nextId = Math.max(nextId, n.id + 1);
            renderNode(n);
        }
    }

    // Load edges
    if (Array.isArray(data.edges)) {
        // keep only edges that still have valid endpoints
        edges = data.edges.filter(e => e && e.from && e.to);
    }

    redrawEdges();
}
