// =============================
// Dialogue Web Editor - app.js
// Click-click + drag-release connections
// Pan/zoom on viewport
// =============================

const viewport = document.getElementById("viewport");
const canvas = document.getElementById("canvas");
const edgesSvg = document.getElementById("edges");
const importFile = document.getElementById("importFile");

// Enums (match your Unity names)
const egoEnums = ["None", "Stable", "Fragmented", "Ghostly"];
const socialEnums = ["None", "Aristocrats", "Bourgeoisie", "Proletariat", "Marginals"];
const genderEnums = ["None", "Male", "Female", "Mixed"];
const ideologyEnums = [
    "None", "Romantic", "Cynical", "Traditional", "Progressive",
    "Natural", "Rational", "Moralistic", "Hedonistic", "Hypocratic", "Alienated"
];
// NOTE: your Unity Purpose has Professional, but your earlier web list had Warrior.
// Use whatever you want, but keep consistent in tool export later.
const purposeEnums = ["None", "Poet", "Lover", "Professional", "Altruist", "Nihilist"];

// Graph state
let nodes = [];
let edges = [];
let nextId = 1;

// Pan/zoom state (applies ONLY to canvas)
let pan = { x: 0, y: 0 };
let zoom = 1;

// Connection interaction state
let activePort = null; // click-click selection
let drag = {
    active: false,
    startPort: null,
    startClient: null,
    moved: false,
    previewPath: null
};

const DRAG_THRESHOLD_PX = 6;

// Ensure SVG fills viewport
function resizeSvg() {
    const r = viewport.getBoundingClientRect();
    edgesSvg.setAttribute("width", r.width);
    edgesSvg.setAttribute("height", r.height);
    edgesSvg.setAttribute("viewBox", `0 0 ${r.width} ${r.height}`);
}
window.addEventListener("resize", () => {
    resizeSvg();
    redrawEdges();
});
resizeSvg();

// -----------------------------
// Node creation
// -----------------------------
window.createNode = function (type) {
    const node = {
        id: nextId++,
        type,
        x: 100 + Math.random() * 200,
        y: 100 + Math.random() * 200,
        data: defaultData(type)
    };

    nodes.push(node);
    renderNode(node);
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

// -----------------------------
// Ports
// -----------------------------
function createPort(node, kind, direction, yPx) {
    const p = document.createElement("div");
    p.className = `port ${kind} ${direction}`;
    p.style.top = `${yPx}px`;

    p.dataset.nodeId = String(node.id);
    p.dataset.kind = kind;         // "flow"|"social"|...
    p.dataset.direction = direction; // "in"|"out"

    // Click-click connect support
    p.addEventListener("click", (e) => {
        e.stopPropagation();
        // If we just finished a drag, ignore the click that follows pointerup
        if (drag.moved) return;
        onPortClick(p);
    });

    // Drag-release connect support
    p.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        beginDragFromPort(p, e);
    });

    return p;
}

function getPortMeta(portEl) {
    return {
        nodeId: Number(portEl.dataset.nodeId),
        kind: portEl.dataset.kind,           // lower-case kind
        direction: portEl.dataset.direction, // "in"|"out"
        el: portEl
    };
}

// -----------------------------
// Compatibility (Unity-like)
// -----------------------------
function getNodeById(id) {
    return nodes.find(n => n.id === id) || null;
}

function isCompatiblePorts(a, b) {
    if (!a || !b) return false;
    if (a.nodeId === b.nodeId) return false;
    if (a.direction === b.direction) return false;

    // Normalize: from = out, to = in
    const from = (a.direction === "out") ? a : b;
    const to = (a.direction === "out") ? b : a;

    const fromNode = getNodeById(from.nodeId);
    const toNode = getNodeById(to.nodeId);
    if (!fromNode || !toNode) return false;

    // Ego disallowed for edges (global)
    if (from.kind === "ego" || to.kind === "ego") return false;

    // Dialogue -> Dialogue or Key via Flow
    if (fromNode.type === "dialogue" && from.kind === "flow" && to.kind === "flow") {
        return (toNode.type === "dialogue" || toNode.type === "key");
    }

    // Key -> Dialogue gating via non-flow kinds to Dialogue Flow IN
    if (fromNode.type === "key" && toNode.type === "dialogue") {
        if (to.kind !== "flow") return false;
        if (from.kind === "flow") return false;
        return ["social", "gender", "ideology", "purpose"].includes(from.kind);
    }

    return false;
}

function edgeExists(from, to) {
    return edges.some(e =>
        e.from.nodeId === from.nodeId &&
        e.from.kind === from.kind &&
        e.to.nodeId === to.nodeId &&
        e.to.kind === to.kind
    );
}

function addEdge(a, b) {
    if (!isCompatiblePorts(a, b)) return false;

    const from = (a.direction === "out") ? a : b;
    const to = (a.direction === "out") ? b : a;

    // Store in Unity-ish shape (direction capitalized)
    const newEdge = {
        from: { nodeId: from.nodeId, kind: from.kind, direction: "Output", index: 0 },
        to: { nodeId: to.nodeId, kind: to.kind, direction: "Input", index: 0 }
    };

    if (edgeExists(newEdge.from, newEdge.to)) return false;

    edges.push(newEdge);
    redrawEdges();
    return true;
}

// -----------------------------
// Click-click connection
// -----------------------------
function onPortClick(portEl) {
    const port = getPortMeta(portEl);

    if (!activePort) {
        activePort = port;
        setPortHighlighted(port.el, true);
        return;
    }

    // Clicking same port just cancels
    if (activePort.el === port.el) {
        clearActivePort();
        return;
    }

    // If incompatible, cancel selection (simple UX)
    if (!isCompatiblePorts(activePort, port)) {
        clearActivePort();
        return;
    }

    addEdge(activePort, port);
    clearActivePort();
}

function clearActivePort() {
    if (activePort?.el) setPortHighlighted(activePort.el, false);
    activePort = null;
}

function setPortHighlighted(el, on) {
    el.style.outline = on ? "2px solid white" : "";
}

// -----------------------------
// Drag-release connection (with preview line)
// -----------------------------
function beginDragFromPort(portEl, pointerEvent) {
    const port = getPortMeta(portEl);

    // Start drag state
    drag.active = true;
    drag.startPort = port;
    drag.startClient = { x: pointerEvent.clientX, y: pointerEvent.clientY };
    drag.moved = false;

    // Clear click-click selection to avoid weird combos
    clearActivePort();

    // Create preview path
    drag.previewPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    drag.previewPath.classList.add("connection");
    drag.previewPath.style.strokeDasharray = "6 4";
    drag.previewPath.style.opacity = "0.9";
    edgesSvg.appendChild(drag.previewPath);

    // Capture pointer so we always get move/up
    portEl.setPointerCapture(pointerEvent.pointerId);

    portEl.addEventListener("pointermove", onDragMove);
    portEl.addEventListener("pointerup", onDragUp, { once: true });
    portEl.addEventListener("pointercancel", onDragCancel, { once: true });

    // Draw initial preview
    updatePreview(pointerEvent.clientX, pointerEvent.clientY);
}

function onDragMove(e) {
    if (!drag.active) return;

    const dx = e.clientX - drag.startClient.x;
    const dy = e.clientY - drag.startClient.y;
    if (!drag.moved && (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX)) {
        drag.moved = true;
    }

    updatePreview(e.clientX, e.clientY);
}

function onDragUp(e) {
    if (!drag.active) return;

    // Remove move listener from the element we attached to (currentTarget)
    e.currentTarget.removeEventListener("pointermove", onDragMove);

    // If the user barely moved, let click handler do its thing
    if (!drag.moved) {
        cleanupDragPreview();
        drag.active = false;
        drag.startPort = null;
        return;
    }

    // Find what is under the pointer on release
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const portEl = target?.closest?.(".port");

    if (portEl) {
        const endPort = getPortMeta(portEl);
        addEdge(drag.startPort, endPort);
    }

    cleanupDragPreview();
    drag.active = false;
    drag.startPort = null;
}

function onDragCancel(e) {
    if (!drag.active) return;
    e.currentTarget.removeEventListener("pointermove", onDragMove);
    cleanupDragPreview();
    drag.active = false;
    drag.startPort = null;
}

function cleanupDragPreview() {
    if (drag.previewPath && drag.previewPath.parentNode) {
        drag.previewPath.parentNode.removeChild(drag.previewPath);
    }
    drag.previewPath = null;
}

// Preview line from start port center -> current pointer
function updatePreview(clientX, clientY) {
    if (!drag.previewPath || !drag.startPort?.el) return;

    const p1 = portCenterInViewport(drag.startPort.el);
    const p2 = clientToViewport(clientX, clientY);

    drag.previewPath.setAttribute("d", bezierPath(p1, p2));
}

function clientToViewport(clientX, clientY) {
    const vr = viewport.getBoundingClientRect();
    return { x: clientX - vr.left, y: clientY - vr.top };
}

function bezierPath(p1, p2) {
    const dx = Math.max(60, Math.min(140, Math.abs(p2.x - p1.x)));
    const c1 = { x: p1.x + dx, y: p1.y };
    const c2 = { x: p2.x - dx, y: p2.y };
    return `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`;
}

// -----------------------------
// Rendering
// -----------------------------
function renderNode(node) {
    const el = document.createElement("div");
    el.className = "node";
    el.style.left = node.x + "px";
    el.style.top = node.y + "px";
    el.dataset.id = String(node.id);

    const header = document.createElement("header");
    header.textContent = `${node.type.toUpperCase()} #${node.id}`;
    el.appendChild(header);

    makeDraggable(el, header, node);

    if (node.type === "dialogue") {
        // Ports: flow in/out
        el.appendChild(createPort(node, "flow", "in", 30));
        el.appendChild(createPort(node, "flow", "out", 30));

        // Speaker
        el.appendChild(makeSelect("Speaker", ["NPC", "Player", "Narrator"], node.data, "speaker", () => {
            renderDialogueFields(el, node);
            redrawEdges();
        }));

        renderDialogueFields(el, node);
    }

    if (node.type === "key") {
        el.appendChild(createPort(node, "flow", "in", 30));

        el.appendChild(createPort(node, "social", "out", 45));
        el.appendChild(createPort(node, "gender", "out", 70));
        el.appendChild(createPort(node, "ideology", "out", 95));
        el.appendChild(createPort(node, "purpose", "out", 120));

        el.appendChild(makeSelect("Social", socialEnums, node.data, "social"));
        el.appendChild(makeSelect("Gender", genderEnums, node.data, "gender"));
        el.appendChild(makeSelect("Ideology", ideologyEnums, node.data, "ideology"));
        el.appendChild(makeSelect("Purpose", purposeEnums, node.data, "purpose"));
    }

    if (node.type === "ego") {
        // No ports, global only
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

// -----------------------------
// UI helpers
// -----------------------------
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

function makeSelect(label, values, obj, key, onChangeExtra) {
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

    s.value = obj[key] ?? values[0];
    s.onchange = () => {
        obj[key] = s.value;
        if (onChangeExtra) onChangeExtra();
    };

    wrap.appendChild(l);
    wrap.appendChild(s);
    return wrap;
}

// -----------------------------
// Edge drawing (viewport space)
// IMPORTANT: edgesSvg is NOT transformed.
// We compute port centers in viewport space.
// -----------------------------
function redrawEdges() {
    // Keep preview path if dragging
    const preview = drag.previewPath;

    edgesSvg.innerHTML = "";
    if (preview) edgesSvg.appendChild(preview);

    for (const e of edges) {
        const fromEl = findPortEl(e.from, "out");
        const toEl = findPortEl(e.to, "in");
        if (!fromEl || !toEl) continue;

        const p1 = portCenterInViewport(fromEl);
        const p2 = portCenterInViewport(toEl);

        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", bezierPath(p1, p2));
        path.classList.add("connection");

        edgesSvg.appendChild(path);
    }
}

// Find a port element by nodeId+kind+direction
function findPortEl(ref, expectedDir /* "in"|"out" */) {
    const nodeId = ref.nodeId;
    const kind = String(ref.kind).toLowerCase();

    return [...document.querySelectorAll(".port")].find(p =>
        Number(p.dataset.nodeId) === nodeId &&
        p.dataset.kind === kind &&
        p.dataset.direction === expectedDir
    );
}

function portCenterInViewport(portEl) {
    const r = portEl.getBoundingClientRect();
    const vr = viewport.getBoundingClientRect();
    return {
        x: (r.left + r.width / 2) - vr.left,
        y: (r.top + r.height / 2) - vr.top
    };
}

// -----------------------------
// Dragging nodes (within canvas space)
// -----------------------------
function makeDraggable(el, handle, node) {
    let startX = 0, startY = 0;

    handle.onpointerdown = (e) => {
        e.stopPropagation();
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
            redrawEdges();
        };
    };
}

// -----------------------------
// Pan / zoom (viewport -> transforms canvas only)
// -----------------------------
let lastPan = null;

viewport.addEventListener("pointerdown", (e) => {
    // Only pan if user clicks empty space (viewport background, canvas background, svg background)
    if (e.target !== viewport && e.target !== canvas && e.target !== edgesSvg) return;
    lastPan = { x: e.clientX, y: e.clientY };
});

document.addEventListener("pointermove", (e) => {
    if (!lastPan) return;
    pan.x += (e.clientX - lastPan.x);
    pan.y += (e.clientY - lastPan.y);
    lastPan = { x: e.clientX, y: e.clientY };
    applyTransform();
    redrawEdges();
});

document.addEventListener("pointerup", () => {
    lastPan = null;
});

viewport.addEventListener("wheel", (e) => {
    e.preventDefault();

    const prevZoom = zoom;
    const delta = e.deltaY < 0 ? 1.1 : 0.9;
    zoom *= delta;
    zoom = Math.max(0.3, Math.min(2, zoom));

    // Optional: zoom towards mouse position (feels nicer)
    const vr = viewport.getBoundingClientRect();
    const mx = e.clientX - vr.left;
    const my = e.clientY - vr.top;

    // adjust pan so the content under mouse stays under mouse
    const scale = zoom / prevZoom;
    pan.x = mx - (mx - pan.x) * scale;
    pan.y = my - (my - pan.y) * scale;

    applyTransform();
    redrawEdges();
}, { passive: false });

function applyTransform() {
    canvas.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
}

// -----------------------------
// Export / Import
// -----------------------------
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
    nodes = [];
    edges = [];
    canvas.innerHTML = "";
    nextId = 1;

    if (Array.isArray(data.nodes)) {
        for (const n of data.nodes) {
            nodes.push(n);
            nextId = Math.max(nextId, n.id + 1);
            renderNode(n);
        }
    }

    if (Array.isArray(data.edges)) {
        edges = data.edges;
    }

    redrawEdges();
}

// Initial transform
applyTransform();
