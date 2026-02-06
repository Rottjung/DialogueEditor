// =====================================================
// Dialogue Editor - app.js (FULL FIXED)
// - Condition + Outcome nodes
// - Condition has Flow In, False/True Flow Out (index 0/1)
// - Outcome has Flow In only
// - Condition/Outcome store string id collections:
//   - condition.data.targetIds: string[]
//   - outcome.data.rewardIds: string[]
// - Export/import keeps these fields
// - Edges preserve port 'index' (needed for Condition outputs)
// - IMPORTANT:
//   #edges is paths only (pointer-events:none)
//   Midpoint dots live in separate SVG (#edgeHandles)
//   BUT: #edgeHandles is BELOW nodes so it never blocks node clicks
// =====================================================

const canvas = document.getElementById("canvas");
const edgesSvg = document.getElementById("edges");
const viewport = document.getElementById("viewport");
const importFile = document.getElementById("importFile");

// Paths SVG: never receive pointer input
edgesSvg.style.pointerEvents = "none";

// Handles SVG: dots only (clickable), but MUST be below #canvas in z-order (CSS)
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
    const t = String(type || "").trim().toLowerCase(); // ✅ normalize
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
    // Export in Unity-compatible schema:
    // - ConditionNode: data.conditionTargetIds: string[]
    // - OutcomeNode:   data.outcomeRewards: RewardData[]
    // Everything else is exported as-is.
    const exportNodes = nodes.map(n => {
        const nn = JSON.parse(JSON.stringify(n));
        nn.data = nn.data || {};

        if (nn.type === "condition") {
            // Web editor uses targetIds internally; Unity JSON uses conditionTargetIds.
            const ids = Array.isArray(nn.data.targetIds) ? nn.data.targetIds : [];
            nn.data.conditionTargetIds = ids.slice();
            delete nn.data.targetIds;
        }

        if (nn.type === "outcome") {
            // Web editor uses rewards[] internally; Unity JSON uses outcomeRewards.
            ensureOutcomeData(nn.data);
            nn.data.outcomeRewards = (nn.data.rewards || []).map(r => ({
                rewardId: String(r.rewardId || ""),
                stableSuccess: !!r.stableSuccess,
                fragmentedSuccess: !!r.fragmentedSuccess,
                ghostlySuccess: !!r.ghostlySuccess
            }));

            // Keep outcome toggles in JSON (Unity fields)
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
            // New: list of RewardData (per reward -> per ego success)
            rewards: [],
            // Legacy mirror (kept for compatibility with older JSON)
            rewardIds: [],
            // Outcome toggles (match Unity)
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
    // ✅ normalize type even if imported weird
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
        // Consumed output (connect to Dialogue flow-in to mark dialogue consumed)
        el.appendChild(createPort(node, "consumed", "out", 140, 0));

        el.appendChild(makeSelect("Social", socialEnums, node.data, "social"));
        el.appendChild(makeSelect("Gender", genderEnums, node.data, "gender"));
        el.appendChild(makeSelect("Ideology", ideologyEnums, node.data, "ideology"));
        el.appendChild(makeSelect("Purpose", purposeEnums, node.data, "purpose"));

        // keep label (used by unity too)
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
        // ONLY the Outcome UI. No dialogue End fields.
        el.appendChild(createPort(node, "flow", "in", 30, 0));

        ensureOutcomeData(node.data);

        const wrap = document.createElement("div");
        wrap.className = "outcome-wrap";

        // Outcome toggles (match Unity)
        wrap.appendChild(makeCheckboxRow("Remove Player", node.data, "isRemovePlayer"));
        wrap.appendChild(makeCheckboxRow("Consume Dialogue", node.data, "isDialogueConsumed"));

        // Summary (Unity-style)
        const summary = document.createElement("div");
        summary.className = "outcome-summary";
        wrap.appendChild(summary);

        // Rewards editor (Unity-style)
        wrap.appendChild(makeOutcomeRewardsEditor(node.data, () => {
            // update summary + tint when something changes
            updateOutcomeVisuals(el, node, summary);
        }));

        el.appendChild(wrap);

        // First refresh
        updateOutcomeVisuals(el, node, summary);
    }

    canvas.appendChild(el);
}

function renderDialogueFields(el, node) {
    el.querySelectorAll(".dialogue-fields").forEach(e => e.remove());

    const wrap = document.createElement("div");
    wrap.className = "dialogue-fields";

    wrap.appendChild(makeVariantBlock("Stable", node.data, "stableText", "stableEnd"));
    wrap.appendChild(makeVariantBlock("Fragmented", node.data, "fragmentedText", "fragmentedEnd"));
    wrap.appendChild(makeVariantBlock("Ghostly", node.data, "ghostlyText", "ghostlyEnd"));

    el.appendChild(wrap);
}

function makeVariantBlock(label, obj, textKey, endKey) {
    const wrap = document.createElement("div");
    wrap.className = "variant-block";

    const header = document.createElement("div");
    header.className = "variant-header";

    const l = document.createElement("label");
    l.textContent = label;
    l.style.display = "inline-block";
    l.style.marginRight = "10px";

    const endWrap = document.createElement("label");
    endWrap.style.display = "inline-flex";
    endWrap.style.alignItems = "center";
    endWrap.style.gap = "6px";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!obj[endKey];

    const cbText = document.createElement("span");
    cbText.textContent = "End";

    endWrap.appendChild(cb);
    endWrap.appendChild(cbText);

    header.appendChild(l);
    header.appendChild(endWrap);

    const t = document.createElement("textarea");
    t.value = obj[textKey] || "";
    t.oninput = () => obj[textKey] = t.value;

    const apply = () => { t.style.display = obj[endKey] ? "none" : "block"; };

    cb.onchange = () => {
        obj[endKey] = cb.checked;
        apply();
    };

    apply();

    wrap.appendChild(header);
    wrap.appendChild(t);
    return wrap;
}

// -----------------------------------------------------
// Field helpers
// -----------------------------------------------------
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

    s.value = obj[key] || values[0];
    s.onchange = () => {
        obj[key] = s.value;
        if (onChange) onChange();
    };

    wrap.appendChild(l);
    wrap.appendChild(s);
    return wrap;
}

function makeInput(label, obj, key, fallback = "") {
    const wrap = document.createElement("div");
    const l = document.createElement("label");
    l.textContent = label;

    const inp = document.createElement("input");
    inp.type = "text";
    inp.value = (typeof obj[key] === "string") ? obj[key] : fallback;
    inp.oninput = () => obj[key] = inp.value;

    wrap.appendChild(l);
    wrap.appendChild(inp);
    return wrap;
}

// -----------------------------------------------------
// ID list editor (matches your CSS classes)
// -----------------------------------------------------
function makeIdListEditor(title, arrRef, placeholder) {
    const wrap = document.createElement("div");
    wrap.className = "idlist";

    const header = document.createElement("div");
    header.className = "idlist-header";

    const left = document.createElement("div");
    left.className = "idlist-left";

    const t = document.createElement("div");
    t.className = "idlist-title";
    t.textContent = title;

    const count = document.createElement("div");
    count.className = "idlist-count";

    left.appendChild(t);
    left.appendChild(count);

    const addBtn = document.createElement("button");
    addBtn.className = "mini-btn";
    addBtn.textContent = "+ Add";
    addBtn.onclick = () => {
        arrRef.push("");
        rebuild();
    };

    header.appendChild(left);
    header.appendChild(addBtn);

    const rows = document.createElement("div");
    rows.className = "idlist-rows";

    wrap.appendChild(header);
    wrap.appendChild(rows);

    const rebuild = () => {
        rows.innerHTML = "";
        count.textContent = `(${validCount(arrRef)}/${arrRef.length})`;

        arrRef.forEach((val, i) => {
            const row = document.createElement("div");
            row.className = "idrow";

            const input = document.createElement("input");
            input.type = "text";
            input.placeholder = placeholder;
            input.value = val || "";
            input.oninput = () => { arrRef[i] = input.value; };

            const del = document.createElement("button");
            del.className = "mini-btn danger";
            del.textContent = "X";
            del.onclick = () => {
                arrRef.splice(i, 1);
                rebuild();
            };

            row.appendChild(input);
            row.appendChild(del);
            rows.appendChild(row);
        });
    };

    rebuild();
    return wrap;
}

function makeCheckboxRow(label, obj, key) {
    const wrap = document.createElement("div");
    wrap.className = "checkrow";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!obj[key];
    cb.onchange = () => obj[key] = cb.checked;

    const l = document.createElement("label");
    l.textContent = label;

    wrap.appendChild(cb);
    wrap.appendChild(l);
    return wrap;
}

function validCount(arr) {
    let c = 0;
    for (const s of arr) if (String(s || "").trim().length > 0) c++;
    return c;
}

function ensureArray(obj, key) {
    if (!obj) return;
    if (!Array.isArray(obj[key])) obj[key] = [];
}

function ensureOutcomeData(data) {
    if (!data) return;

    // Ensure arrays exist
    if (!Array.isArray(data.rewards)) data.rewards = [];
    if (!Array.isArray(data.rewardIds)) data.rewardIds = [];

    // Outcome toggles (default false if missing)
    if (typeof data.isRemovePlayer !== "boolean") data.isRemovePlayer = false;
    if (typeof data.isDialogueConsumed !== "boolean") data.isDialogueConsumed = false;

    // --- Migration path (old JSON) ---
    // Old format: rewardIds[] + stableSuccess/fragmentedSuccess/ghostlySuccess on the node.
    // Convert each rewardId into a RewardData entry using the old node-level flags.
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

    // Keep lengths mirrored with legacy rewardIds
    while (data.rewardIds.length < data.rewards.length) data.rewardIds.push("");
    while (data.rewards.length < data.rewardIds.length) data.rewards.push({
        rewardId: "",
        stableSuccess: true,
        fragmentedSuccess: false,
        ghostlySuccess: false
    });

    // Normalize + mirror ids (RewardData is source of truth)
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

    // Remove old flags to avoid confusion (they're obsolete now)
    delete data.stableSuccess;
    delete data.fragmentedSuccess;
    delete data.ghostlySuccess;
}

function computeOutcomeSummary(data) {
    ensureOutcomeData(data);

    const total = data.rewards.length;
    if (total === 0) {
        return {
            text: "No rewards set.",
            state: "empty"
        };
    }

    let stableOk = 0, fragOk = 0, ghostOk = 0;
    let allSuccessAllEgos = true;
    let allFailAllEgos = true;

    for (const r of data.rewards) {
        if (r.stableSuccess) stableOk++;
        if (r.fragmentedSuccess) fragOk++;
        if (r.ghostlySuccess) ghostOk++;

        const all3 = r.stableSuccess && r.fragmentedSuccess && r.ghostlySuccess;
        const none3 = !r.stableSuccess && !r.fragmentedSuccess && !r.ghostlySuccess;
        allSuccessAllEgos = allSuccessAllEgos && all3;
        allFailAllEgos = allFailAllEgos && none3;
    }

    const state = allSuccessAllEgos ? "all-success" : (allFailAllEgos ? "all-fail" : "mixed");
    return {
        text: `Rewards: ${total} | Stable: ${stableOk}/${total}  Fragmented: ${fragOk}/${total}  Ghostly: ${ghostOk}/${total}`,
        state
    };
}

function updateOutcomeVisuals(nodeEl, node, summaryEl) {
    if (!nodeEl || !node || node.type !== "outcome") return;
    const s = computeOutcomeSummary(node.data);

    if (summaryEl) summaryEl.textContent = s.text;

    // Unity-style tint states
    nodeEl.classList.remove("outcome-empty", "outcome-all-success", "outcome-all-fail", "outcome-mixed");
    if (s.state === "empty") nodeEl.classList.add("outcome-empty");
    else if (s.state === "all-success") nodeEl.classList.add("outcome-all-success");
    else if (s.state === "all-fail") nodeEl.classList.add("outcome-all-fail");
    else nodeEl.classList.add("outcome-mixed");
}

function makeOutcomeRewardsEditor(data, onChanged) {
    ensureOutcomeData(data);

    const wrap = document.createElement("div");
    wrap.className = "rewardlist";

    const header = document.createElement("div");
    header.className = "rewardlist-header";

    const left = document.createElement("div");
    left.className = "rewardlist-left";

    const t = document.createElement("div");
    t.className = "rewardlist-title";
    t.textContent = "Rewards";

    const count = document.createElement("div");
    count.className = "rewardlist-count";

    left.appendChild(t);
    left.appendChild(count);

    const addBtn = document.createElement("button");
    addBtn.className = "mini-btn";
    addBtn.textContent = "+ Add";
    addBtn.onclick = () => {
        data.rewards.push({
            rewardId: "",
            stableSuccess: true,       // Unity defaults
            fragmentedSuccess: false,
            ghostlySuccess: false
        });
        data.rewardIds.push("");
        rebuild();
        if (onChanged) onChanged();
    };

    header.appendChild(left);
    header.appendChild(addBtn);

    const rows = document.createElement("div");
    rows.className = "rewardlist-rows";

    wrap.appendChild(header);
    wrap.appendChild(rows);

    const rebuild = () => {
        ensureOutcomeData(data);
        rows.innerHTML = "";

        const total = data.rewards.length;
        let valid = 0;
        for (const r of data.rewards) if (String(r.rewardId || "").trim().length > 0) valid++;
        count.textContent = `(${valid}/${total})`;

        data.rewards.forEach((r, i) => {
            const row = document.createElement("div");
            row.className = "reward-row";

            const top = document.createElement("div");
            top.className = "reward-top";

            const input = document.createElement("input");
            input.type = "text";
            input.placeholder = "Paste RewardId";
            input.value = r.rewardId || "";
            input.oninput = () => {
                r.rewardId = input.value;
                data.rewards[i] = r;
                data.rewardIds[i] = r.rewardId;
                if (onChanged) onChanged();
            };

            const del = document.createElement("button");
            del.className = "mini-btn danger";
            del.textContent = "X";
            del.onclick = () => {
                data.rewards.splice(i, 1);
                data.rewardIds.splice(i, 1);
                rebuild();
                if (onChanged) onChanged();
            };

            top.appendChild(input);
            top.appendChild(del);

            const toggles = document.createElement("div");
            toggles.className = "reward-toggles";

            const mk = (label, key) => {
                const lab = document.createElement("label");
                lab.className = "reward-toggle";
                const cb = document.createElement("input");
                cb.type = "checkbox";
                cb.checked = !!r[key];
                cb.onchange = () => {
                    r[key] = cb.checked;
                    data.rewards[i] = r;
                    if (onChanged) onChanged();
                };
                const txt = document.createElement("span");
                txt.textContent = label;
                lab.appendChild(cb);
                lab.appendChild(txt);
                return lab;
            };

            toggles.appendChild(mk("Stable", "stableSuccess"));
            toggles.appendChild(mk("Fragmented", "fragmentedSuccess"));
            toggles.appendChild(mk("Ghostly", "ghostlySuccess"));

            row.appendChild(top);
            row.appendChild(toggles);
            rows.appendChild(row);
        });
    };

    rebuild();
    return wrap;
}

// -----------------------------------------------------
// Ports + connecting (tap or drag)
// -----------------------------------------------------
function createPort(node, kind, direction, y, index = 0) {
    const p = document.createElement("div");
    p.className = `port ${kind} ${direction}`;
    p.style.top = y + "px";
    p.style.transform = "translateY(-50%)";

    p.dataset.nodeId = node.id;
    p.dataset.nodeType = node.type;
    p.dataset.kind = kind;
    p.dataset.direction = direction;
    p.dataset.index = String(index);

    p.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        beginPortGesture(p, e);
    });

    return p;
}

function beginPortGesture(portEl, e) {
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

        if (!portGesture.isDragging && dist2 > 25) {
            portGesture.isDragging = true;
            clearActivePort();
            setPortActiveVisual(portGesture.fromPort.el, true);
            portGesture.tempPath = createTempPath();
        }

        if (portGesture.isDragging) updateTempPath(ev.clientX, ev.clientY);
    };

    const onUp = (ev) => {
        if (!portGesture || ev.pointerId !== portGesture.pointerId) return;

        viewport.removeEventListener("pointermove", onMove);

        if (portGesture.isDragging) {
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
        nodeType: portEl.dataset.nodeType,
        kind: portEl.dataset.kind,
        direction: portEl.dataset.direction,
        index: Number(portEl.dataset.index || "0"),
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

    if (a.nodeId === b.nodeId) return;
    if (a.direction === b.direction) return;

    const from = a.direction === "out" ? a : b;
    const to = a.direction === "out" ? b : a;

    if (!isCompatible(from, to)) return;

    const id = edgeId(from, to);
    if (edges.some(e => e.id === id)) return;

    edges.push({
        id,
        from: {
            nodeId: from.nodeId,
            kind: toPortKindEnum(from.kind),
            direction: "Output",
            index: from.index || 0
        },
        to: {
            nodeId: to.nodeId,
            kind: toPortKindEnum(to.kind),
            direction: "Input",
            index: to.index || 0
        }
    });
}

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

function toPortKindEnum(kindLower) {
    return kindLower.charAt(0).toUpperCase() + kindLower.slice(1);
}

function edgeId(from, to) {
    return `${from.nodeId}:${from.kind}:${from.direction}:${from.index}->${to.nodeId}:${to.kind}:${to.direction}:${to.index}`;
}

// -----------------------------------------------------
// Edge drawing + MIDPOINT HANDLE (separate SVG)
// -----------------------------------------------------
function redrawEdges() {
    const temp = portGesture?.isDragging ? portGesture.tempPath : null;

    while (edgesSvg.firstChild) edgesSvg.removeChild(edgesSvg.firstChild);
    while (edgeHandlesSvg.firstChild) edgeHandlesSvg.removeChild(edgeHandlesSvg.firstChild);

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
        if (e.id === selectedEdgeId) path.classList.add("selected-edge");
        edgesSvg.appendChild(path);

        const mid = { x: (p1.x + p2.x) * 0.5, y: (p1.y + p2.y) * 0.5 };

        const hit = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        hit.setAttribute("cx", mid.x);
        hit.setAttribute("cy", mid.y);
        hit.setAttribute("r", 14);
        hit.classList.add("edge-hit");

        const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        dot.setAttribute("cx", mid.x);
        dot.setAttribute("cy", mid.y);
        dot.setAttribute("r", 5);
        dot.classList.add("edge-dot");
        if (e.id === selectedEdgeId) dot.classList.add("selected");

        const selectFn = (ev) => {
            ev.stopPropagation();
            selectEdge(e.id);
        };

        hit.addEventListener("pointerdown", selectFn);
        dot.addEventListener("pointerdown", selectFn);

        edgeHandlesSvg.appendChild(hit);
        edgeHandlesSvg.appendChild(dot);
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
    return { x: (r.left + r.width / 2) - vr.left, y: (r.top + r.height / 2) - vr.top };
}

function findPortElForRef(ref) {
    const nodeId = ref.nodeId;
    const kind = String(ref.kind).toLowerCase();
    const dir = ref.direction === "Output" ? "out" : "in";
    const index = Number(ref.index || 0);

    return [...document.querySelectorAll(".port")].find(p =>
        Number(p.dataset.nodeId) === nodeId &&
        p.dataset.kind === kind &&
        p.dataset.direction === dir &&
        Number(p.dataset.index || "0") === index
    );
}

function createTempPath() {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.classList.add("connection", "temp-connection");
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

function syncSvgSize() {
    const r = viewport.getBoundingClientRect();

    edgesSvg.setAttribute("width", r.width);
    edgesSvg.setAttribute("height", r.height);
    edgesSvg.setAttribute("viewBox", `0 0 ${r.width} ${r.height}`);

    edgeHandlesSvg.setAttribute("width", r.width);
    edgeHandlesSvg.setAttribute("height", r.height);
    edgeHandlesSvg.setAttribute("viewBox", `0 0 ${r.width} ${r.height}`);
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

viewport.addEventListener("pointerdown", (e) => {
    if (e.target.closest && (e.target.closest(".node") || e.target.closest(".port"))) return;

    // if you clicked a dot, its handler already ran
    if (e.target instanceof SVGElement) return;

    selectedNodeId = null;
    selectedEdgeId = null;
    clearActivePort();

    document.querySelectorAll(".node").forEach(n => n.classList.remove("selected-node"));
    redrawEdges();
});

// -----------------------------------------------------
// Node dragging
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
// Pan / zoom
// -----------------------------------------------------
let lastPan = null;

viewport.addEventListener("pointerdown", (e) => {
    // if click is inside node, don't pan
    if (e.target.closest && (e.target.closest(".node") || e.target.closest(".port"))) return;

    // IMPORTANT: if click is on a dot (edgeHandles), don't pan
    if (e.target instanceof SVGElement) return;

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

// ✅ ONLY CHANGE: wheel zoom now centers on mouse pointer (no other behavior touched)
viewport.addEventListener("wheel", (e) => {
    e.preventDefault();

    // Mouse position in viewport-local coordinates
    const vr = viewport.getBoundingClientRect();
    const px = e.clientX - vr.left;
    const py = e.clientY - vr.top;

    // World position under mouse BEFORE zoom
    const wx = (px - pan.x) / zoom;
    const wy = (py - pan.y) / zoom;

    // Keep your existing step sizes
    const delta = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.max(0.3, Math.min(2.0, zoom * delta));

    // Adjust pan so the same world point stays under the mouse AFTER zoom
    pan.x = px - wx * newZoom;
    pan.y = py - wy * newZoom;

    zoom = newZoom;
    applyTransform();
}, { passive: false });

function applyTransform() {
    canvas.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    redrawEdges();
}

// -----------------------------------------------------
// Pinch zoom (touchscreen)
// -----------------------------------------------------
let pinch = null;

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function dist(a, b) { const dx = a.clientX - b.clientX; const dy = a.clientY - b.clientY; return Math.sqrt(dx * dx + dy * dy); }
function mid(a, b) { return { x: (a.clientX + b.clientX) * 0.5, y: (a.clientY + b.clientY) * 0.5 }; }

viewport.addEventListener("touchstart", (e) => {
    if (portGesture) return;

    if (e.touches.length === 2) {
        e.preventDefault();

        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const m = mid(t1, t2);

        // ✅ viewport-local midpoint (fixes anchoring)
        const r = viewport.getBoundingClientRect();
        const mLocal = { x: m.x - r.left, y: m.y - r.top };

        const worldMid = {
            x: (mLocal.x - pan.x) / zoom,
            y: (mLocal.y - pan.y) / zoom
        };

        pinch = {
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

    // ✅ viewport-local midpoint (fixes centering)
    const r = viewport.getBoundingClientRect();
    const mLocal = { x: m.x - r.left, y: m.y - r.top };

    const scale = d / Math.max(1, pinch.startDist);

    // ✅ dampen pinch sensitivity (fixes "too reactive")
    const damped = Math.pow(scale, 0.35);

    zoom = clamp(pinch.startZoom * damped, 0.3, 2.0);

    pan.x = mLocal.x - pinch.worldMid.x * zoom;
    pan.y = mLocal.y - pinch.worldMid.y * zoom;

    applyTransform();
}, { passive: false });

viewport.addEventListener("touchend", (e) => {
    if (!pinch) return;
    if (e.touches.length < 2) pinch = null;
}, { passive: false });

viewport.addEventListener("touchcancel", () => { pinch = null; }, { passive: false });

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
        n.type = String(n.type || "").trim().toLowerCase(); // ✅ normalize
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
            // Unity JSON stores targets in conditionTargetIds. Internally we use targetIds for the UI.
            if (Array.isArray(n.data.conditionTargetIds)) {
                n.data.targetIds = n.data.conditionTargetIds.slice();
            }
            ensureArray(n.data, "targetIds");
        }

        if (n.type === "outcome") {
            // Unity JSON stores rewards in outcomeRewards[]. Internally we use rewards[] (+ rewardIds mirror) for the UI.
            if (Array.isArray(n.data.outcomeRewards)) {
                n.data.rewards = n.data.outcomeRewards.map(r => ({
                    rewardId: String(r.rewardId || ""),
                    stableSuccess: !!r.stableSuccess,
                    fragmentedSuccess: !!r.fragmentedSuccess,
                    ghostlySuccess: !!r.ghostlySuccess
                }));
                n.data.rewardIds = n.data.rewards.map(r => r.rewardId);
            }

            // Outcome toggles (default false if missing)
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
