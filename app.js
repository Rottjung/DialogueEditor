// =====================================================
// Dialogue Editor - app.js (FULL WORKING)
// - Pan/zoom
// - Node drag
// - Connect ports: click/click + drag/release
// - Dotted preview while dragging
// - Select node + edge (blue)
// - Delete selected (node/edge) without breaking graph
// =====================================================

const canvas = document.getElementById("canvas");
const edgesSvg = document.getElementById("edges");
const viewport = document.getElementById("viewport");
const importFile = document.getElementById("importFile");

// SVG must receive pointer input for edge selection
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
let edges = []; // { id, from:{nodeId,kind,direction,index}, to:{...} }
let nextId = 1;

// selection
let selectedNodeId = null;
let selectedEdgeId = null;

// click-click arming
let armedPort = null; // { nodeId, nodeType, kind, direction, el }

// pointer-based port interaction (drag OR tap)
let portPointer = null; // { pointerId, fromPort, moved, startX, startY, tempPath }

// pan/zoom
let pan = { x: 0, y: 0 };
let zoom = 1;

applyTransform();
syncSvgSize();
redrawEdges();

window.addEventListener("resize", () => {
    syncSvgSize();
    redrawEdges();
});

// =====================================================
// Public API (called from HTML buttons)
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

window.deleteSelected = function () {
    // Delete edge first
    if (selectedEdgeId) {
        edges = edges.filter(e => e.id !== selectedEdgeId);
        selectedEdgeId = null;
        redrawEdges();
        return;
    }

    // Delete node
    if (selectedNodeId) {
        const id = selectedNodeId;

        // remove node model
        nodes = nodes.filter(n => n.id !== id);

        // remove attached edges
        edges = edges.filter(e => e.from.nodeId !== id && e.to.nodeId !== id);

        // remove DOM
        const el = canvas.querySelector(`.node[data-id="${id}"]`);
        if (el) el.remove();

        selectedNodeId = null;
        redrawEdges();
    }
};

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
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
        try {
            const data = JSON.parse(reader.result);
            loadGraph(data);
        } catch (err) {
            console.error(err);
            alert("Import failed: invalid JSON.");
        }
    };
    reader.readAsText(file);

    // allow importing the same file again
    importFile.value = "";
};

// =====================================================
// Data defaults
// =====================================================
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

    el.addEventListener("pointerdown", (e) => {
        // ignore if pointerdown started on a port (port handler will manage)
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

        el.appendChild(
            makeSelect("Speaker", ["NPC", "Player", "Narrator"], node.data, "speaker", () => {
                renderDialogueFields(el, node);
                redrawEdges();
            })
        );

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
// Ports + connecting (unified pointer handling)
// - Tap w/o moving = click-click mode
// - Move a bit = drag mode with dotted preview
// =====================================================
function createPort(node, kind, direction, y) {
    const p = document.createElement("div");
    p.className = `port ${kind} ${direction}`;
    p.style.top = y + "px";

    p.dataset.nodeId = node.id;
    p.dataset.nodeType = node.type;
    p.dataset.kind = kind;            // flow/social/gender/...
    p.dataset.direction = direction;  // in/out

    p.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        beginPortPointer(p, e);
    });

    return p;
}

function beginPortPointer(portEl, e) {
    // Cancel any previous pointer state
    cleanupPortPointer();

    const fromPort = readPort(portEl);

    // Visual feedback
    setPortOutline(fromPort.el, true);

    portPointer = {
        pointerId: e.pointerId,
        fromPort,
        moved: false,
        startX: e.clientX,
        startY: e.clientY,
        tempPath: null
    };

    viewport.setPointerCapture(e.pointerId);

    viewport.addEventListener("pointermove", onPortPointerMove);
    viewport.addEventListener("pointerup", onPortPointerUp, { once: true });
}

function onPortPointerMove(e) {
    if (!portPointer || e.pointerId !== portPointer.pointerId) return;

    const dx = e.clientX - portPointer.startX;
    const dy = e.clientY - portPointer.startY;
    const dist2 = dx * dx + dy * dy;

    // Movement threshold: if exceeded => drag mode
    if (!portPointer.moved && dist2 > 16) {
        portPointer.moved = true;
        portPointer.tempPath = createTempPath();
    }

    if (portPointer.moved && portPointer.tempPath) {
        updateTempPath(e.clientX, e.clientY);
    }
}

function onPortPointerUp(e) {
    viewport.removeEventListener("pointermove", onPortPointerMove);

    if (!portPointer || e.pointerId !== portPointer.pointerId) {
        cleanupPortPointer();
        return;
    }

    // Find if released over a port
    const targetPortEl = findPortElementUnderPointer(e.clientX, e.clientY);

    if (portPointer.moved) {
        // DRAG mode: connect if released on a port
        if (targetPortEl) {
            const toPort = readPort(targetPortEl);
            tryConnect(portPointer.fromPort, toPort);
        }
    } else {
        // TAP/CLICK mode:
        // - if nothing armed => arm this port
        // - else => connect armed->this
        handleClickConnect(portPointer.fromPort);
    }

    cleanupPortPointer();
    redrawEdges();
}

function handleClickConnect(port) {
    // clicking the same port again cancels
    if (armedPort && armedPort.el === port.el) {
        clearArmedPort();
        return;
    }

    if (!armedPort) {
        armedPort = port;
        setPortOutline(armedPort.el, true);
        return;
    }

    // Attempt connection armed <-> port
    tryConnect(armedPort, port);
    clearArmedPort();
}

function clearArmedPort() {
    if (armedPort?.el) setPortOutline(armedPort.el, false);
    armedPort = null;
}

function cleanupPortPointer() {
    if (!portPointer) return;

    // remove temp path
    if (portPointer.tempPath) portPointer.tempPath.remove();

    // remove outline from the origin port IF it is not armed
    if (portPointer.fromPort?.el) {
        const keep = armedPort && armedPort.el === portPointer.fromPort.el;
        if (!keep) setPortOutline(portPointer.fromPort.el, false);
    }

    portPointer = null;
}

function setPortOutline(portEl, on) {
    portEl.style.outline = on ? "2px solid white" : "";
}

function findPortElementUnderPointer(clientX, clientY) {
    const elUnder = document.elementFromPoint(clientX, clientY);
    if (!elUnder) return null;
    if (elUnder.classList && elUnder.classList.contains("port")) return elUnder;
    if (elUnder.closest) return elUnder.closest(".port");
    return null;
}

function readPort(portEl) {
    return {
        nodeId: Number(portEl.dataset.nodeId),
        nodeType: portEl.dataset.nodeType,        // dialogue/key/ego
        kind: portEl.dataset.kind,                // flow/social/...
        direction: portEl.dataset.direction,      // in/out
        el: portEl
    };
}

function tryConnect(a, b) {
    if (!a || !b) return;

    // same node or same direction => no
    if (a.nodeId === b.nodeId) return;
    if (a.direction === b.direction) return;

    // normalize to from(out) -> to(in)
    const from = (a.direction === "out") ? a : b;
    const to = (a.direction === "out") ? b : a;

    // only allow output->input
    if (from.direction !== "out" || to.direction !== "in") return;

    // compatibility rules (match your Unity logic)
    if (!isCompatible(from, to)) return;

    const id = edgeId(from, to);
    if (edges.some(e => e.id === id)) return;

    edges.push({
        id,
        from: { nodeId: from.nodeId, kind: toPortKindEnum(from.kind), direction: "Output", index: 0 },
        to: { nodeId: to.nodeId, kind: toPortKindEnum(to.kind), direction: "Input", index: 0 }
    });
}

function isCompatible(from, to) {
    // no ports on ego in this web tool, so we ignore ego
    const fromType = from.nodeType; // "dialogue" / "key"
    const toType = to.nodeType;

    // Dialogue -> Dialogue flow
    if (fromType === "dialogue" && toType === "dialogue") {
        return from.kind === "flow" && to.kind === "flow";
    }

    // Dialogue -> Key flow hub
    if (fromType === "dialogue" && toType === "key") {
        return from.kind === "flow" && to.kind === "flow";
    }

    // Key -> Dialogue gating
    if (fromType === "key" && toType === "dialogue") {
        return to.kind === "flow" && from.kind !== "flow";
    }

    return false;
}

function toPortKindEnum(kindLower) {
    return kindLower.charAt(0).toUpperCase() + kindLower.slice(1);
}

function edgeId(from, to) {
    return `${from.nodeId}:${from.kind}->${to.nodeId}:${to.kind}`;
}

// =====================================================
// Edge drawing (SVG in viewport coords; DO NOT transform SVG)
// =====================================================
function redrawEdges() {
    // keep temp path if currently dragging
    const temp = portPointer?.tempPath || null;

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

        // selectable edge
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

function findPortElForRef(ref) {
    const nodeId = ref.nodeId;
    const kind = String(ref.kind).toLowerCase(); // Flow -> flow etc
    const dir = (ref.direction === "Output") ? "out" : "in";

    return [...document.querySelectorAll(".port")].find(p =>
        Number(p.dataset.nodeId) === nodeId &&
        p.dataset.kind === kind &&
        p.dataset.direction === dir
    );
}

function portCenterViewport(el) {
    const r = el.getBoundingClientRect();
    const vr = viewport.getBoundingClientRect();
    return {
        x: (r.left + r.width / 2) - vr.left,
        y: (r.top + r.height / 2) - vr.top
    };
}

function bezier(p1, p2) {
    const dx = Math.max(60, Math.min(160, Math.abs(p2.x - p1.x) * 0.35));
    const c1x = p1.x + dx;
    const c2x = p2.x - dx;
    return `M ${p1.x} ${p1.y} C ${c1x} ${p1.y}, ${c2x} ${p2.y}, ${p2.x} ${p2.y}`;
}

// Dotted preview path while dragging
function createTempPath() {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.classList.add("connection");
    path.style.strokeDasharray = "6 6";
    path.style.opacity = "0.9";
    path.style.pointerEvents = "none";
    edgesSvg.appendChild(path);
    return path;
}

function updateTempPath(clientX, clientY) {
    if (!portPointer?.fromPort?.el || !portPointer?.tempPath) return;

    const vr = viewport.getBoundingClientRect();
    const p2 = { x: clientX - vr.left, y: clientY - vr.top };
    const p1 = portCenterViewport(portPointer.fromPort.el);

    portPointer.tempPath.setAttribute("d", bezier(p1, p2));
}

function syncSvgSize() {
    const r = viewport.getBoundingClientRect();
    edgesSvg.setAttribute("width", r.width);
    edgesSvg.setAttribute("height", r.height);
    edgesSvg.setAttribute("viewBox", `0 0 ${r.width} ${r.height}`);
}

// =====================================================
// Selection: nodes + edges
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

// Clear selection when clicking empty space
viewport.addEventListener("pointerdown", (e) => {
    // If clicking on a node or port or edge, don't clear
    if (e.target.closest && (e.target.closest(".node") || e.target.closest(".port"))) return;
    if (e.target instanceof SVGPathElement) return;

    selectedNodeId = null;
    selectedEdgeId = null;
    document.querySelectorAll(".node").forEach(n => n.style.outline = "");
    redrawEdges();
});

// =====================================================
// UI controls
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

    s.value = obj[key] ?? values[0];
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
    let startX = 0, startY = 0;

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

// =====================================================
// Pan / zoom (transform ONLY the canvas)
// =====================================================
let lastPan = null;

viewport.addEventListener("pointerdown", (e) => {
    // Pan only if not on node/port/edge
    if (e.target.closest && (e.target.closest(".node") || e.target.closest(".port"))) return;
    if (e.target instanceof SVGPathElement) return;

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

document.addEventListener("pointerup", () => {
    lastPan = null;
});

viewport.addEventListener("wheel", (e) => {
    e.preventDefault();

    const prevZoom = zoom;
    const delta = (e.deltaY < 0) ? 1.1 : 0.9;
    zoom = Math.max(0.3, Math.min(2, zoom * delta));

    // Zoom around cursor (so it feels correct)
    const vr = viewport.getBoundingClientRect();
    const mx = e.clientX - vr.left;
    const my = e.clientY - vr.top;

    const scale = zoom / prevZoom;
    pan.x = mx - (mx - pan.x) * scale;
    pan.y = my - (my - pan.y) * scale;

    applyTransform();
    redrawEdges();
}, { passive: false });

function applyTransform() {
    canvas.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    // IMPORTANT: do NOT transform the SVG
}

// =====================================================
// Import/load graph
// =====================================================
function loadGraph(data) {
    // reset
    nodes = [];
    edges = [];
    nextId = 1;
    selectedNodeId = null;
    selectedEdgeId = null;
    armedPort = null;
    cleanupPortPointer();

    canvas.innerHTML = "";
    edgesSvg.innerHTML = "";

    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
        alert("Import failed: missing nodes/edges arrays.");
        return;
    }

    // nodes
    for (const n of data.nodes) {
        nodes.push(n);
        nextId = Math.max(nextId, (n.id || 0) + 1);
        renderNode(n);
    }

    // edges
    for (const e of data.edges) {
        // keep if minimally valid
        if (!e?.from?.nodeId || !e?.to?.nodeId) continue;
        if (!e.id) {
            // rebuild a stable-ish id if missing
            e.id = `${e.from.nodeId}:${String(e.from.kind).toLowerCase()}->${e.to.nodeId}:${String(e.to.kind).toLowerCase()}`;
        }
        edges.push(e);
    }

    redrawEdges();
}
