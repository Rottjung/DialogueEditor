// =====================================================
// Dialogue Editor - app.js (UPDATED for Outcome toggles + Consumed port)
// =====================================================

const canvas = document.getElementById("canvas");
const edgesSvg = document.getElementById("edges");
const viewport = document.getElementById("viewport");
const importFile = document.getElementById("importFile");

edgesSvg.style.pointerEvents = "none";
const edgeHandlesSvg = ensureEdgeHandlesSvg();

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
let activePort = null;

// drag connect gesture
let portGesture = null;

// pan/zoom
let pan = { x: 0, y: 0 };
let zoom = 1;

// optional graph-level fields
let startNodeId = -1;
let globalEgo = "None";

syncSvgSize();
applyTransform();

window.addEventListener("resize", () => {
    syncSvgSize();
    redrawEdges();
});

// -----------------------------------------------------
// Public API (HTML buttons)
// -----------------------------------------------------
window.createNode = function (type) {
    const t = String(type || "").trim().toLowerCase();
    const node = {
        id: nextId++,
        type: t,
        x: 120 + Math.random() * 240,
        y: 120 + Math.random() * 240,
        data: defaultData(t)
    };
    nodes.push(node);
    renderNode(node);
    selectNode(node.id);
    redrawEdges();
};

window.deleteSelected = function () {
    if (selectedEdgeId) {
        edges = edges.filter(e => e.id !== selectedEdgeId);
        selectedEdgeId = null;
        redrawEdges();
        return;
    }

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
    const exportNodes = nodes.map(n => {
        const nn = JSON.parse(JSON.stringify(n));
        nn.data = nn.data || {};

        if (nn.type === "condition") {
            const ids = Array.isArray(nn.data.targetIds) ? nn.data.targetIds : [];
            nn.data.conditionTargetIds = ids.slice();
            delete nn.data.targetIds;
        }

        if (nn.type === "outcome") {
            ensureOutcomeData(nn.data);

            // ✅ export rewards (Unity expects outcomeRewards)
            nn.data.outcomeRewards = (nn.data.rewards || []).map(r => ({
                rewardId: String(r.rewardId || ""),
                stableSuccess: !!r.stableSuccess,
                fragmentedSuccess: !!r.fragmentedSuccess,
                ghostlySuccess: !!r.ghostlySuccess
            }));

            // ✅ export toggles
            nn.data.isRemovePlayer = !!nn.data.isRemovePlayer;
            nn.data.isDialogueConsumed = !!nn.data.isDialogueConsumed;

            // keep export clean
            delete nn.data.rewards;
            delete nn.data.rewardIds;
        }

        return nn;
    });

    const data = { version: 1, startNodeId, globalEgo, nodes: exportNodes, edges };
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
// Defaults
// -----------------------------------------------------
function defaultData(type) {
    if (type === "dialogue") {
        return {
            speaker: "NPC",
            stableText: "",
            fragmentedText: "",
            ghostlyText: "",
            stableEnd: false,
            fragmentedEnd: false,
            ghostlyEnd: false,
            text: "" // legacy
        };
    }
    if (type === "key") {
        return { social: "None", gender: "None", ideology: "None", purpose: "None", label: "Key" };
    }
    if (type === "ego") {
        return { ego: "None" };
    }
    if (type === "condition") {
        return { targetIds: [] };
    }
    if (type === "outcome") {
        return {
            rewards: [],
            rewardIds: [],
            // ✅ NEW toggles
            isRemovePlayer: false,
            isDialogueConsumed: false
        };
    }
    return {};
}

// -----------------------------------------------------
// Rendering
// -----------------------------------------------------
function renderNode(node) {
    node.type = String(node.type || "").trim().toLowerCase();

    const el = document.createElement("div");
    el.className = "node";
    el.classList.add(node.type);
    el.style.left = node.x + "px";
    el.style.top = node.y + "px";
    el.dataset.id = node.id;

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
        el.appendChild(createPort(node, "flow", "in", 30, 0));
        el.appendChild(createPort(node, "flow", "out", 30, 0));

        el.appendChild(makeSelect("Speaker", ["NPC", "Player", "Narrator"], node.data, "speaker", () => {
            renderDialogueFields(el, node);
            redrawEdges();
        }));

        renderDialogueFields(el, node);
    }

    if (node.type === "key") {
        el.appendChild(createPort(node, "flow", "in", 30, 0));
        el.appendChild(createPort(node, "social", "out", 40, 0));
        el.appendChild(createPort(node, "gender", "out", 65, 0));
        el.appendChild(createPort(node, "ideology", "out", 90, 0));
        el.appendChild(createPort(node, "purpose", "out", 115, 0));

        // ✅ NEW: Consumed output port
        el.appendChild(createPort(node, "consumed", "out", 140, 0));

        el.appendChild(makeSelect("Social", socialEnums, node.data, "social"));
        el.appendChild(makeSelect("Gender", genderEnums, node.data, "gender"));
        el.appendChild(makeSelect("Ideology", ideologyEnums, node.data, "ideology"));
        el.appendChild(makeSelect("Purpose", purposeEnums, node.data, "purpose"));

        el.appendChild(makeInput("Label", node.data, "label", "Key"));
    }

    if (node.type === "ego") {
        el.appendChild(makeSelect("Ego", egoEnums, node.data, "ego", () => {
            globalEgo = node.data.ego || "None";
        }));
        globalEgo = node.data.ego || globalEgo;
    }

    if (node.type === "condition") {
        el.appendChild(createPort(node, "flow", "in", 30, 0));

        const outFalse = createPort(node, "flow", "out", 55, 0);
        outFalse.classList.add("cond-false");
        outFalse.title = "False (index 0)";
        el.appendChild(outFalse);

        const outTrue = createPort(node, "flow", "out", 80, 1);
        outTrue.classList.add("cond-true");
        outTrue.title = "True (index 1)";
        el.appendChild(outTrue);

        ensureArray(node.data, "targetIds");
        el.appendChild(makeIdListEditor("Targets", node.data.targetIds, "Paste InteractableId"));
    }

    if (node.type === "outcome") {
        el.appendChild(createPort(node, "flow", "in", 30, 0));

        ensureOutcomeData(node.data);

        const wrap = document.createElement("div");
        wrap.className = "outcome-wrap";

        // ✅ NEW: toggles (match Unity fields)
        wrap.appendChild(makeCheckboxRow("Remove Player", node.data, "isRemovePlayer"));
        wrap.appendChild(makeCheckboxRow("Consume Dialogue", node.data, "isDialogueConsumed"));

        const summary = document.createElement("div");
        summary.className = "outcome-summary";
        wrap.appendChild(summary);

        wrap.appendChild(makeOutcomeRewardsEditor(node.data, () => {
            updateOutcomeVisuals(el, node, summary);
        }));

        el.appendChild(wrap);
        updateOutcomeVisuals(el, node, summary);
    }

    canvas.appendChild(el);
}

// (rest of your file stays the same down to ensureOutcomeData, but update ensureOutcomeData below)

function ensureOutcomeData(data) {
    if (!data) return;

    if (!Array.isArray(data.rewards)) data.rewards = [];
    if (!Array.isArray(data.rewardIds)) data.rewardIds = [];

    // ✅ NEW defaults for toggles
    if (typeof data.isRemovePlayer !== "boolean") data.isRemovePlayer = false;
    if (typeof data.isDialogueConsumed !== "boolean") data.isDialogueConsumed = false;

    const hasOldFlags =
        (typeof data.stableSuccess === "boolean") ||
        (typeof data.fragmentedSuccess === "boolean") ||
        (typeof data.ghostlySuccess === "boolean");

    if (data.rewards.length === 0 && data.rewardIds.length > 0 && hasOldFlags) {
        const stable = (typeof data.stableSuccess === "boolean") ? data.stableSuccess : true;
        const frag = (typeof data.fragmentedSuccess === "boolean") ? data.fragmentedSuccess : false;
        const ghost = (typeof data.ghostlySuccess === "boolean") ? data.ghostlySuccess : false;

        data.rewards = data.rewardIds.map(id => ({
            rewardId: String(id || ""),
            stableSuccess: !!stable,
            fragmentedSuccess: !!frag,
            ghostlySuccess: !!ghost
        }));
    }

    while (data.rewardIds.length < data.rewards.length) data.rewardIds.push("");
    while (data.rewards.length < data.rewardIds.length) data.rewards.push({
        rewardId: "",
        stableSuccess: true,
        fragmentedSuccess: false,
        ghostlySuccess: false
    });

    for (let i = 0; i < data.rewards.length; i++) {
        const r = data.rewards[i] || {};
        if (typeof r.rewardId !== "string") r.rewardId = String(r.rewardId || "");
        if (typeof r.stableSuccess !== "boolean") r.stableSuccess = true;
        if (typeof r.fragmentedSuccess !== "boolean") r.fragmentedSuccess = false;
        if (typeof r.ghostlySuccess !== "boolean") r.ghostlySuccess = false;

        data.rewards[i] = r;

        if (!r.rewardId && data.rewardIds[i]) {
            r.rewardId = String(data.rewardIds[i] || "");
            data.rewards[i] = r;
        } else {
            data.rewardIds[i] = r.rewardId;
        }
    }

    delete data.stableSuccess;
    delete data.fragmentedSuccess;
    delete data.ghostlySuccess;
}

// -----------------------------------------------------
// Import
// -----------------------------------------------------
function loadGraph(data) {
    nodes = [];
    edges = [];
    canvas.innerHTML = "";
    nextId = 1;

    startNodeId = (typeof data.startNodeId === "number") ? data.startNodeId : -1;
    globalEgo = data.globalEgo || "None";

    (data.nodes || []).forEach(n => {
        n.type = String(n.type || "").trim().toLowerCase();
        n.data = n.data || {};

        if (n.type === "dialogue") {
            if (typeof n.data.stableText !== "string") n.data.stableText = "";
            if (typeof n.data.fragmentedText !== "string") n.data.fragmentedText = "";
            if (typeof n.data.ghostlyText !== "string") n.data.ghostlyText = "";
            if (typeof n.data.stableEnd !== "boolean") n.data.stableEnd = false;
            if (typeof n.data.fragmentedEnd !== "boolean") n.data.fragmentedEnd = false;
            if (typeof n.data.ghostlyEnd !== "boolean") n.data.ghostlyEnd = false;
            if (typeof n.data.text !== "string") n.data.text = "";
            if (typeof n.data.speaker !== "string") n.data.speaker = "NPC";
        }

        if (n.type === "key") {
            if (typeof n.data.social !== "string") n.data.social = "None";
            if (typeof n.data.gender !== "string") n.data.gender = "None";
            if (typeof n.data.ideology !== "string") n.data.ideology = "None";
            if (typeof n.data.purpose !== "string") n.data.purpose = "None";
            if (typeof n.data.label !== "string") n.data.label = "Key";
        }

        if (n.type === "ego") {
            if (typeof n.data.ego !== "string") n.data.ego = "None";
            globalEgo = n.data.ego || globalEgo;
        }

        if (n.type === "condition") {
            if (Array.isArray(n.data.conditionTargetIds)) {
                n.data.targetIds = n.data.conditionTargetIds.slice();
            }
            ensureArray(n.data, "targetIds");
        }

        if (n.type === "outcome") {
            if (Array.isArray(n.data.outcomeRewards)) {
                n.data.rewards = n.data.outcomeRewards.map(r => ({
                    rewardId: String(r.rewardId || ""),
                    stableSuccess: !!r.stableSuccess,
                    fragmentedSuccess: !!r.fragmentedSuccess,
                    ghostlySuccess: !!r.ghostlySuccess
                }));
                n.data.rewardIds = n.data.rewards.map(r => r.rewardId);
            }

            // ✅ NEW toggles (default false if missing)
            if (typeof n.data.isRemovePlayer !== "boolean") n.data.isRemovePlayer = false;
            if (typeof n.data.isDialogueConsumed !== "boolean") n.data.isDialogueConsumed = false;

            ensureOutcomeData(n.data);
        }

        nodes.push(n);
        nextId = Math.max(nextId, n.id + 1);
        renderNode(n);
    });

    edges = (data.edges || []).map(e => ({
        ...e,
        id: e.id || `${e.from.nodeId}:${String(e.from.kind).toLowerCase()}:out:${e.from.index || 0}->${e.to.nodeId}:${String(e.to.kind).toLowerCase()}:in:${e.to.index || 0}`,
        from: { ...e.from, index: (typeof e.from.index === "number") ? e.from.index : 0 },
        to: { ...e.to, index: (typeof e.to.index === "number") ? e.to.index : 0 }
    }));

    selectedNodeId = null;
    selectedEdgeId = null;
    clearActivePort();
    redrawEdges();
}

// ✅ Compatibility: key->dialogue already allows any non-flow (Consumed included)
function isCompatible(from, to) {
    const fromType = from.nodeType;
    const toType = to.nodeType;

    if (fromType === "ego" || toType === "ego") return false;

    if (toType === "outcome") {
        return from.kind === "flow" && to.kind === "flow";
    }

    if (fromType === "dialogue" && toType === "dialogue") {
        return from.kind === "flow" && to.kind === "flow";
    }

    if (fromType === "dialogue" && toType === "key") {
        return from.kind === "flow" && to.kind === "flow";
    }

    if (fromType === "key" && toType === "dialogue") {
        return to.kind === "flow" && from.kind !== "flow";
    }

    if (fromType === "dialogue" && toType === "condition") {
        return from.kind === "flow" && to.kind === "flow";
    }

    if (fromType === "key" && toType === "condition") {
        return to.kind === "flow" && from.kind !== "flow";
    }

    if (fromType === "condition") {
        return from.kind === "flow" && to.kind === "flow"
            && (toType === "dialogue" || toType === "key" || toType === "condition" || toType === "outcome");
    }

    return false;
}

// --- keep the rest of your original app.js below unchanged ---
// (ports, drawing, selection, pan/zoom, ensureEdgeHandlesSvg, etc.)

// -----------------------------------------------------
// Utils
// -----------------------------------------------------
function ensureEdgeHandlesSvg() {
    let svg = document.getElementById("edgeHandles");
    if (svg) return svg;

    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("id", "edgeHandles");
    viewport.appendChild(svg);
    return svg;
}
