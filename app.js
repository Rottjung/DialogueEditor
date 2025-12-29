// =====================================================
// Dialogue Editor - app.js
// - Pan/zoom on #canvas only
// - Edges drawn in viewport-space SVG (no SVG transform)
// - Ports: tap/tap connect + drag/release connect (with dotted preview)
// - Edge selection via MIDPOINT DOT (reliable on iPad / SVG)
// - Delete Selected works for node OR edge
// =====================================================

const canvas = document.getElementById("canvas");
const edgesSvg = document.getElementById("edges");
const viewport = document.getElementById("viewport");
const importFile = document.getElementById("importFile");

// IMPORTANT: SVG must receive pointer input
edgesSvg.style.pointerEvents = "none";

// --- enums ---
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

// click-click port connect
let activePort = null; // { nodeId, nodeType, kind, direction, el }

// drag connect gesture
let portGesture = null;
// { fromPort, pointerId, startClient:{x,y}, isDragging, tempPath }

// pan/zoom
let pan = { x: 0, y: 0 };
let zoom = 1;

syncSvgSize();
applyTransform(); // redraw edges too

window.addEventListener("resize", () => {
    syncSvgSize();
    redrawEdges();
});

// -----------------------------------------------------
// Public API used by HTML buttons
// -----------------------------------------------------
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

window.deleteSelected = function () {
    // delete edge first
    if (selectedEdgeId) {
        edges = edges.filter(e => e.id !== selectedEdgeId);
        selectedEdgeId = null;
        redrawEdges();
        return;
    }

    // delete node
    if (selectedNodeId) {
        const delId = selectedNodeId;

        nodes = nodes.filter(n => n.id !== delId);
        edges = edges.filter(e => e.from.nodeId !== delId && e.to.nodeId !== delId);

        const el = canvas.querySelector(`.node[data-id="${delId}"]`);
        if (el) el.remove();

        selectedNodeId = null;
        redrawEdges();
    }
};

window.exportJSON = function () {
    const data = { version: 1, nodes, edges };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "dialogue.json";
    a.click();
};

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

// -----------------------------------------------------
// Node data defaults
// -----------------------------------------------------
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

// -----------------------------------------------------
// Rendering
// -----------------------------------------------------
function renderNode(node) {
    const el = document.createElement("div");
    el.className = "node";
    el.style.left = node.x + "px";
    el.style.top = node.y + "px";
    el.dataset.id = node.id;

    // select node on pointerdown (not ports)
    el.addEventListener("pointerdown", (e) => {
        if (e.target.classList.contains("port")) return;
        selectNode(node.id);
        e.stopPropagation();
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

// -----------------------------------------------------
// Ports + connecting (tap or drag)
// -----------------------------------------------------
function createPort(node, kind, direction, y) {
    const p = document.createElement("div");
    p.className = `port ${kind} ${direction}`;
    p.style.top = y + "px";
    p.style.transform = "translateY(-50%)";

    p.dataset.nodeId = node.id;
    p.dataset.nodeType = node.type;
    p.dataset.kind = kind;           // flow/social/...
    p.dataset.direction = direction; // in/out

    // Use pointerdown only (click often gets suppressed on iOS with pointer capture)
    p.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        beginPortGesture(p, e);
    });

    return p;
}

function beginPortGesture(portEl, e) {
    // starting a port gesture should clear edge selection
    selectEdge(null);

    const fromPort = readPort(portEl);

    portGesture = {
        fromPort,
        pointerId: e.pointerId,
        startClient: { x: e.clientX, y: e.clientY },
        isDragging: false,
        tempPath: null
    };

    viewport.setPointerCapture(e.pointerId);

    const onMove = (ev) => {
        if (!portGesture || ev.pointerId !== portGesture.pointerId) return;

        const dx = ev.clientX - portGesture.startClient.x;
        const dy = ev.clientY - portGesture.startClient.y;
        const dist2 = dx * dx + dy * dy;

        // begin drag after threshold
        if (!portGesture.isDragging && dist2 > 25) { // ~5px
            portGesture.isDragging = true;
            clearActivePort(); // drag overrides click-click
            setPortActiveVisual(portGesture.fromPort.el, true);
            portGesture.tempPath = createTempPath();
        }

        if (portGesture.isDragging) {
            updateTempPath(ev.clientX, ev.clientY);
        }
    };

    const onUp = (ev) => {
        if (!portGesture || ev.pointerId !== portGesture.pointerId) return;

        viewport.removeEventListener("pointermove", onMove);

        if (portGesture.isDragging) {
            // drag/release connect
            const targetPortEl = findPortElUnderPointer(ev.clientX, ev.clientY);
            if (targetPortEl) {
                const toPort = readPort(targetPortEl);
                tryConnect(portGesture.fromPort, toPort);
            }

            if (portGesture.tempPath) portGesture.tempPath.remove();
            setPortActiveVisual(portGesture.fromPort.el, false);
            portGesture = null;
            redrawEdges();
            return;
        }

        // tap = click-click connect
        handlePortTap(portGesture.fromPort);
        portGesture = null;
    };

    viewport.addEventListener("pointermove", onMove);
    viewport.addEventListener("pointerup", onUp, { once: true });
}

function handlePortTap(port) {
    if (!activePort) {
        activePort = port;
        setPortActiveVisual(activePort.el, true);
        return;
    }

    if (activePort.el === port.el) {
        clearActivePort();
        return;
    }

    tryConnect(activePort, port);
    clearActivePort();
    redrawEdges();
}

function findPortElUnderPointer(clientX, clientY) {
    const elUnder = document.elementFromPoint(clientX, clientY);
    if (!elUnder) return null;

    if (elUnder.classList && elUnder.classList.contains("port")) return elUnder;
    if (elUnder.closest) return elUnder.closest(".port");
    return null;
}

function readPort(portEl) {
    return {
        nodeId: Number(portEl.dataset.nodeId),
        nodeType: portEl.dataset.nodeType, // dialogue/key/ego
        kind: portEl.dataset.kind,         // flow/social/...
        direction: portEl.dataset.direction, // in/out
        el: portEl
    };
}

function clearActivePort() {
    if (activePort?.el) setPortActiveVisual(activePort.el, false);
    activePort = null;
}

function setPortActiveVisual(portEl, on) {
    portEl.classList.toggle("port-armed", !!on);
}

function tryConnect(a, b) {
    if (!a || !b) return;

    // prevent same node / same direction
    if (a.nodeId === b.nodeId) return;
    if (a.direction === b.direction) return;

    // normalize
    const from = a.direction === "out" ? a : b;
    const to = a.direction === "out" ? b : a;

    if (!isCompatible(from, to)) return;

    const id = edgeId(from, to);
    if (edges.some(e => e.id === id)) return;

    edges.push({
        id,
        from: {
            nodeId: from.nodeId,
            kind: toPortKindEnum(from.kind), // Flow/Social/...
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
}

function isCompatible(from, to) {
    const fromType = from.nodeType;
    const toType = to.nodeType;

    // Dialogue -> Dialogue (flow only)
    if (fromType === "dialogue" && toType === "dialogue") {
        return from.kind === "flow" && to.kind === "flow";
    }

    // Dialogue -> Key (flow in)
    if (fromType === "dialogue" && toType === "key") {
        return from.kind === "flow" && to.kind === "flow";
    }

    // Key -> Dialogue (gating ports -> dialogue flow in)
    if (fromType === "key" && toType === "dialogue") {
        return to.kind === "flow" && from.kind !== "flow";
    }

    return false;
}

function toPortKindEnum(kindLower) {
    return kindLower.charAt(0).toUpperCase() + kindLower.slice(1);
}

function edgeId(from, to) {
    return `${from.nodeId}:${from.kind}:${from.direction}->${to.nodeId}:${to.kind}:${to.direction}`;
}

// -----------------------------------------------------
// Edge drawing (viewport space) + MIDPOINT HANDLE
// -----------------------------------------------------
function redrawEdges() {
    const temp = portGesture?.isDragging ? portGesture.tempPath : null;

    // wipe SVG
    while (edgesSvg.firstChild) edgesSvg.removeChild(edgesSvg.firstChild);
    if (temp) edgesSvg.appendChild(temp);

    for (const e of edges) {
        const fromEl = findPortElForRef(e.from);
        const toEl = findPortElForRef(e.to);
        if (!fromEl || !toEl) continue;

        const p1 = portCenterViewport(fromEl);
        const p2 = portCenterViewport(toEl);

        // Edge path
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", bezier(p1, p2));
        path.classList.add("connection");
        if (e.id === selectedEdgeId) path.classList.add("selected-edge");

        // IMPORTANT: path itself is NOT used for clicking anymore (too unreliable on some browsers)
        path.style.pointerEvents = "none";

        edgesSvg.appendChild(path);

        // Midpoint handle dot (reliable hit target)
        const mid = { x: (p1.x + p2.x) * 0.5, y: (p1.y + p2.y) * 0.5 };

        // Invisible bigger hit-circle (so it’s easy to tap)
        const hit = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        hit.setAttribute("cx", mid.x);
        hit.setAttribute("cy", mid.y);
        hit.setAttribute("r", 14);
        hit.classList.add("edge-hit");

        // Visible dot
        const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        dot.setAttribute("cx", mid.x);
        dot.setAttribute("cy", mid.y);
        dot.setAttribute("r", 5);
        dot.classList.add("edge-dot");
        if (e.id === selectedEdgeId) dot.classList.add("selected");

        // Both hit + dot select the edge
        const selectFn = (ev) => {
            ev.stopPropagation();
            selectEdge(e.id);
        };

        hit.addEventListener("pointerdown", selectFn);
        dot.addEventListener("pointerdown", selectFn);

        edgesSvg.appendChild(hit);
        edgesSvg.appendChild(dot);
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
    const kind = String(ref.kind).toLowerCase(); // "Flow" -> "flow"
    const dir = ref.direction === "Output" ? "out" : "in";

    return [...document.querySelectorAll(".port")].find(p =>
        Number(p.dataset.nodeId) === nodeId &&
        p.dataset.kind === kind &&
        p.dataset.direction === dir
    );
}

// temp dotted drag path
function createTempPath() {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.classList.add("connection", "temp-connection");
    path.style.pointerEvents = "none";
    edgesSvg.appendChild(path);
    return path;
}

function updateTempPath(clientX, clientY) {
    if (!portGesture?.fromPort?.el || !portGesture?.tempPath) return;

    const vr = viewport.getBoundingClientRect();
    const p2 = { x: clientX - vr.left, y: clientY - vr.top };
    const p1 = portCenterViewport(portGesture.fromPort.el);

    portGesture.tempPath.setAttribute("d", bezier(p1, p2));
}

// keep SVG size == viewport
function syncSvgSize() {
    const r = viewport.getBoundingClientRect();
    edgesSvg.setAttribute("width", r.width);
    edgesSvg.setAttribute("height", r.height);
    edgesSvg.setAttribute("viewBox", `0 0 ${r.width} ${r.height}`);
}

// -----------------------------------------------------
// Selection
// -----------------------------------------------------
function selectNode(nodeId) {
    selectedNodeId = nodeId;
    selectedEdgeId = null;

    document.querySelectorAll(".node").forEach(n => {
        n.classList.toggle("selected-node", Number(n.dataset.id) === nodeId);
    });

    redrawEdges();
}

function selectEdge(edgeId) {
    selectedEdgeId = edgeId;
    if (edgeId) selectedNodeId = null;

    document.querySelectorAll(".node").forEach(n => n.classList.remove("selected-node"));
    redrawEdges();
}

// click empty space clears selection + disarms activePort
viewport.addEventListener("pointerdown", (e) => {
    // if click on node/port, ignore
    if (e.target.closest && (e.target.closest(".node") || e.target.closest(".port"))) return;
    // if click on edge hit/dot, ignore
    if (e.target instanceof SVGElement && (e.target.classList.contains("edge-hit") || e.target.classList.contains("edge-dot"))) return;

    selectedNodeId = null;
    selectedEdgeId = null;
    clearActivePort();

    document.querySelectorAll(".node").forEach(n => n.classList.remove("selected-node"));
    redrawEdges();
});

// -----------------------------------------------------
// UI field helpers
// -----------------------------------------------------
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

// -----------------------------------------------------
// Node dragging (updates edges live)
// -----------------------------------------------------
function makeDraggable(el, handle, node) {
    let startX, startY;

    handle.onpointerdown = (e) => {
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

// -----------------------------------------------------
// Pan / zoom (transform ONLY #canvas; edges are redrawn)
// -----------------------------------------------------
let lastPan = null;

viewport.addEventListener("pointerdown", (e) => {
    // start pan only on empty background (not node/port/edge dot)
    if (e.target.closest && e.target.closest(".node")) return;
    if (e.target instanceof SVGElement && (e.target.classList.contains("edge-hit") || e.target.classList.contains("edge-dot"))) return;
    lastPan = { x: e.clientX, y: e.clientY };
});

document.addEventListener("pointermove", (e) => {
    if (!lastPan) return;
    pan.x += e.clientX - lastPan.x;
    pan.y += e.clientY - lastPan.y;
    lastPan = { x: e.clientX, y: e.clientY };
    applyTransform();
});

document.addEventListener("pointerup", () => lastPan = null);

viewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1.1 : 0.9;
    zoom *= delta;
    zoom = Math.max(0.3, Math.min(2.0, zoom));
    applyTransform();
}, { passive: false });

function applyTransform() {
    canvas.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    redrawEdges();
}

// -----------------------------------------------------
// Pinch zoom (iPad / touchscreen) — does NOT change other behavior
// -----------------------------------------------------
let pinch = null;
// { id1, id2, startDist, startZoom, worldMid:{x,y} }

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function dist(a, b) {
    const dx = a.clientX - b.clientX;
    const dy = a.clientY - b.clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

function mid(a, b) {
    return { x: (a.clientX + b.clientX) * 0.5, y: (a.clientY + b.clientY) * 0.5 };
}

viewport.addEventListener("touchstart", (e) => {
    // Don’t interfere with port drag in progress
    if (portGesture) return;

    if (e.touches.length === 2) {
        e.preventDefault();

        const t1 = e.touches[0];
        const t2 = e.touches[1];

        const m = mid(t1, t2);

        // World point currently under the pinch midpoint (keep it anchored)
        const worldMid = {
            x: (m.x - pan.x) / zoom,
            y: (m.y - pan.y) / zoom
        };

        pinch = {
            id1: t1.identifier,
            id2: t2.identifier,
            startDist: dist(t1, t2),
            startZoom: zoom,
            worldMid
        };
    }
}, { passive: false });

viewport.addEventListener("touchmove", (e) => {
    if (!pinch) return;
    if (e.touches.length !== 2) return;

    e.preventDefault();

    const t1 = e.touches[0];
    const t2 = e.touches[1];

    const m = mid(t1, t2);
    const d = dist(t1, t2);

    const scale = d / Math.max(1, pinch.startDist);
    zoom = clamp(pinch.startZoom * scale, 0.3, 2.0);

    // Adjust pan so the same world point stays under the midpoint
    pan.x = m.x - pinch.worldMid.x * zoom;
    pan.y = m.y - pinch.worldMid.y * zoom;

    applyTransform();
}, { passive: false });

viewport.addEventListener("touchend", (e) => {
    if (!pinch) return;

    // If fingers lifted or gesture broken, stop pinch mode
    if (e.touches.length < 2) {
        pinch = null;
    }
}, { passive: false });

viewport.addEventListener("touchcancel", () => {
    pinch = null;
}, { passive: false });

// -----------------------------------------------------
// Import
// -----------------------------------------------------
function loadGraph(data) {
    nodes = [];
    edges = [];
    canvas.innerHTML = "";
    nextId = 1;

    // nodes
    (data.nodes || []).forEach(n => {
        nodes.push(n);
        nextId = Math.max(nextId, n.id + 1);
        renderNode(n);
    });

    // edges
    edges = (data.edges || []).map(e => ({
        ...e,
        id: e.id || `${e.from.nodeId}:${String(e.from.kind).toLowerCase()}:out->${e.to.nodeId}:${String(e.to.kind).toLowerCase()}:in`
    }));

    selectedNodeId = null;
    selectedEdgeId = null;
    clearActivePort();

    redrawEdges();
}
