const SUPABASE_URL = 'https://cjffcdpvstxdcnvldklt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqZmZjZHB2c3R4ZGNudmxka2x0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMTA1OTcsImV4cCI6MjA5NTg4NjU5N30.AjsLNhDOdiEmSxU3Hc4hr0TPSdTbtRbIqr-K3sDmQ5I';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let nodesData = [];
let linksData = [];
let dbTypes = [];
let dbLinkTypes = [];
let currentCreatorMode = 'OBJ_TYPE';
let parentNodeIdForExtend = null;
let selectedLinkId = null;
let currentUser = null;
let currentMember = null;
let currentGraphId = null;
let myGraphs = [];
let hoveringNode = false;
let hoveringCard = false;
const TOP_MARGIN = 100;
const LEFT_MARGIN = 0;
const RIGHT_MARGIN = 0;
const BOTTOM_MARGIN = 0;

// hover card cache: id -> [{ typeName, value }]
let nodeHoverAttrs = {};
let linkHoverAttrs = {};

const svg = d3.select("#canvas");
let simulation;
let isDraggingLink = false;
let dragSourceNode = null;

// hover card DOM element
const hoverCard = document.createElement('div');
hoverCard.id = 'hover-card';
hoverCard.style.display = 'none';
document.body.appendChild(hoverCard);


let hoverCardTimeout = null;

hoverCard.addEventListener('mouseenter', () => {

    hoveringCard = true;

    if (hoverCardTimeout) {
        clearTimeout(hoverCardTimeout);
    }

});

hoverCard.addEventListener('mouseleave', () => {

    hoveringCard = false;

    if (!hoveringNode) {
        hideHoverCard();
    }

});

function avoidRects() {
    return function(alpha) {

        const width = getCanvasWidth();

        const blocks = [
            { x1: 0, y1: 0, x2: 300, y2: 150 },
            { x1: width - 300, y1: 0, x2: width, y2: 150 }
        ];

        nodesData.forEach(d => {
            blocks.forEach(b => {
                if (
                    d.x > b.x1 &&
                    d.x < b.x2 &&
                    d.y > b.y1 &&
                    d.y < b.y2
                ) {
                    d.x += (d.x < (b.x1 + b.x2) / 2 ? -10 : 10) * alpha;
                    d.y += (d.y < (b.y1 + b.y2) / 2 ? -10 : 10) * alpha;
                }
            });
        });
    };
}

function showHoverCard(x, y, attrs, label, color) {
    clearTimeout(hoverCardTimeout);
    if (!attrs || attrs.length === 0) return;

    hoverCard.innerHTML = `
        <div class="hover-card-dot" style="background:${color}"></div>

        <div class="hover-card-title">
            ${label}
        </div>

        <div class="hover-card-attrs">
            ${attrs.map(a => `
                <div class="hover-card-attr">
                    <div class="hover-card-attr-type">
                        ${a.typeName}
                    </div>
                    <div class="hover-card-attr-value">
                        ${a.value}
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    hoverCard.style.display = 'block';

    const cardW = 280;
    const cardH = 240;
    const offset = 18;

    const winW = window.innerWidth;
    const winH = window.innerHeight;

    const placeRight = (x + cardW + offset < winW);

    let left = placeRight
        ? x + offset
        : x - cardW - offset;

    const placeBottom = (y + cardH + offset < winH);

    let top = placeBottom
        ? y + offset
        : y - cardH - offset;

    left = Math.max(8, Math.min(left, winW - cardW - 8));
    top = Math.max(8, Math.min(top, winH - cardH - 8));

    hoverCard.style.left = left + 'px';
    hoverCard.style.top = top + 'px';
}

function hideHoverCard() {
    hoverCardTimeout = setTimeout(() => {
        hoverCard.style.display = 'none';
    }, 120);
}

function getCanvasWidth() {
    const totalWidth = window.innerWidth;
    const isRightActive = d3.select("#rightPanel").classed("active");
    const isLeftActive = d3.select("#leftPanel").classed("active");
    let width = totalWidth;
    if (isRightActive) width -= 380;
    if (isLeftActive) width -= 280;
    return width;
}
let HEIGHT = window.innerHeight;

// ============================================================
// AUTH
// ============================================================

async function checkAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return false; }
    currentUser = session.user;

    const { data: member } = await supabaseClient
        .from('members').select('*').eq('id', currentUser.id).single();
    currentMember = member;

    const displayName = member?.name || currentUser.email.split('@')[0];
    document.getElementById('userNameDisplay').textContent = displayName;
    return true;
}

window.handleLogout = async function() {
    await supabaseClient.auth.signOut();
    window.location.href = 'login.html';
};

window.toggleLeftPanel = function() {
    const panel = d3.select("#leftPanel");
    panel.classed("active", !panel.classed("active"));
    setTimeout(() => {
        const currentWidth = getCanvasWidth();
        svg.attr("width", currentWidth);
        if (simulation) simulation.force("center", d3.forceCenter(currentWidth / 2, HEIGHT / 2)).alpha(0.2).restart();
    }, 310);
};

// ============================================================
// GRAPHS
// ============================================================

async function fetchMyGraphs() {
    let graphs = [];
    if (currentMember.role === 1) {
        const { data } = await supabaseClient.from('graphs').select('*').order('created_at');
        graphs = data || [];
    } else {
        const { data } = await supabaseClient
            .from('graph_permissions').select('graph_id, graphs(id, name)').eq('member_id', currentUser.id);
        graphs = (data || []).map(d => d.graphs).filter(Boolean);
    }
    myGraphs = graphs;
    renderGraphList();
    if (!currentGraphId && graphs.length > 0) await switchGraph(graphs[0].id);
}

function renderGraphList() {
    const list = document.getElementById('graphList');
    list.innerHTML = '';
    myGraphs.forEach(g => {
        const li = document.createElement('li');
        li.textContent = g.name;
        li.className = g.id === currentGraphId ? 'graph-item active' : 'graph-item';
        li.onclick = () => switchGraph(g.id);
        list.appendChild(li);
    });
    const addBtn = document.getElementById('addGraphBtn');
    if (addBtn) addBtn.style.display = currentMember?.role === 1 ? 'block' : 'none';
}

async function switchGraph(graphId) {
    currentGraphId = graphId;
    const graph = myGraphs.find(g => g.id === graphId);
    document.getElementById('currentGraphName').textContent = graph?.name || 'Graph';
    renderGraphList();
    await fetchData();
    updateRepToggleVisibility();
    renderGraph();
    renderRepresentPanel();
    renderDropdownMenu();
    updateTypeSelectOptions();
}

window.handleCreateGraph = async function() {
    const name = document.getElementById('newGraphName').value.trim();
    if (!name) return alert('Please enter a graph name!');
    const { data, error } = await supabaseClient.from('graphs').insert([{ name, owner_id: currentUser.id }]).select().single();
    if (error) { console.error(error); return; }
    document.getElementById('newGraphName').value = '';
    document.getElementById('newGraphForm').style.display = 'none';
    await fetchMyGraphs();
    await switchGraph(data.id);
};

window.toggleNewGraphForm = function() {
    const form = document.getElementById('newGraphForm');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
};

// ============================================================
// INIT
// ============================================================

async function init() {
    const authed = await checkAuth();
    if (!authed) return;
    await fetchMyGraphs();
}

async function fetchData() {
    if (!currentGraphId) return;

    const { data: types } = await supabaseClient.from('node_types').select('*').eq('graph_id', currentGraphId);
    dbTypes = types || [];

    const { data: linkTypes } = await supabaseClient.from('link_types').select('*').eq('graph_id', currentGraphId);
    dbLinkTypes = linkTypes || [];

    const { data: nodes } = await supabaseClient.from('nodes').select('*').eq('graph_id', currentGraphId);
    const typeMap = {};
    dbTypes.forEach(t => { typeMap[t.id] = { name: t.type_name, color: t.color }; });
    nodesData = (nodes || []).map(n => {
        const matchedType = typeMap[n.type_id] || { name: 'Uncategorized', color: '#94a3b8' };
        return { ...n, typeName: matchedType.name, color: matchedType.color };
    });

    const { data: links } = await supabaseClient.from('links').select('*').eq('graph_id', currentGraphId);
    const existingNodeIds = new Set(nodesData.map(n => n.id));
    const linkTypeMap = {};
    dbLinkTypes.forEach(t => { linkTypeMap[t.id] = { name: t.type_name, color: t.color }; });
    linksData = (links || [])
        .filter(l => l.source && l.target && existingNodeIds.has(l.source) && existingNodeIds.has(l.target))
        .map(l => {
            const lt = l.type_id ? linkTypeMap[l.type_id] : null;
            return {
                id: l.id, source: l.source, target: l.target,
                description: l.description || 'related',
                type_id: l.type_id || null,
                typeColor: lt ? lt.color : '#94a3b8',
                typeName: lt ? lt.name : null,
            };
        });

    // 撈 hover attributes
    await fetchHoverAttrs();
    updateRepToggleVisibility();
    renderRepresentPanel();
}

async function fetchHoverAttrs() {
    const nodeIds = nodesData.map(n => n.id);
    const linkIds = linksData.map(l => l.id);

    nodeHoverAttrs = {};
    linkHoverAttrs = {};

    if (nodeIds.length > 0) {
        const { data } = await supabaseClient
            .from('attributes')
            .select('node_id, value, attribute_types(type_name)')
            .eq('show_on_hover', true)
            .in('node_id', nodeIds);
        (data || []).forEach(a => {
            if (!nodeHoverAttrs[a.node_id]) nodeHoverAttrs[a.node_id] = [];
            nodeHoverAttrs[a.node_id].push({ typeName: a.attribute_types?.type_name || '', value: a.value || '' });
        });
    }

    if (linkIds.length > 0) {
        const { data } = await supabaseClient
            .from('attributes')
            .select('link_id, value, attribute_types(type_name)')
            .eq('show_on_hover', true)
            .in('link_id', linkIds);
        (data || []).forEach(a => {
            if (!linkHoverAttrs[a.link_id]) linkHoverAttrs[a.link_id] = [];
            linkHoverAttrs[a.link_id].push({ typeName: a.attribute_types?.type_name || '', value: a.value || '' });
        });
    }
}

// ============================================================
// GRAPH RENDER
// ============================================================
function updateRepToggleVisibility() {
    const btn = document.getElementById("repToggleBtn");

    const hasRep = nodesData.some(n => {
        const attrs = nodeHoverAttrs[n.id];
        return attrs?.some(a => a.typeName === "represent" && a.value);
    });

    btn.style.display = hasRep ? "block" : "none";
}

function buildRepresentList() {
    const list = [];

    nodesData.forEach(n => {
        const attrs = nodeHoverAttrs[n.id];
        const rep = attrs?.find(a => a.typeName === "represent");

        if (!rep?.value) return;

        list.push({
            id: n.id,
            label: n.label,
            type: n.typeName,
            represent: rep.value
        });
    });

    return list;
}

function renderGraph() {
    const currentWidth = getCanvasWidth();
    svg.attr("width", currentWidth).attr("height", HEIGHT);
    svg.selectAll("*").remove();

    const defs = svg.append("defs");
    const arrowColors = ['#94a3b8', '#4f46e5', ...new Set(dbLinkTypes.map(t => t.color))];
    arrowColors.forEach(color => {
        const safeId = 'arrow-' + color.replace('#', '');
        defs.append("marker")
            .attr("id", safeId)
            .attr("viewBox", "0 -5 10 10")
            .attr("refX", 23).attr("refY", 0)
            .attr("markerWidth", 6).attr("markerHeight", 6)
            .attr("orient", "auto")
            .append("path").attr("d", "M0,-4L10,0L0,4").attr("fill", color);
    });

    const dragLine = svg.append("line")
        .attr("class", "drag-line")
        .style("display", "none")
        .attr("stroke", "#4f46e5")
        .attr("stroke-width", 3)
        .attr("stroke-dasharray", "5,5");

    simulation = d3.forceSimulation(nodesData)
        .force("link", d3.forceLink(linksData).id(d => d.id).distance(130))
        .force("charge", d3.forceManyBody().strength(-500))
        .force("center", d3.forceCenter(currentWidth / 2, HEIGHT / 2))
        .force("collision", d3.forceCollide().radius(60))
        .force("avoidUI", avoidRects());

    const linkGroup = svg.append("g").selectAll("g")
        .data(linksData).join("g")
        .attr("class", "link-group")
        .on("click", (e, d) => {
            e.stopPropagation();
            selectedLinkId = d.id;
            openLinkEditor(d);
            renderLinkHighlight();
        })
        .on("dblclick", (e, d) => {
            e.stopPropagation();
            window.location.href = `link_detail.html?id=${d.id}&graph_id=${currentGraphId}`;
        })
        .on("mouseover", (e, d) => {
            const attrs = linkHoverAttrs[d.id];
            if (attrs && attrs.length > 0) {
                showHoverCard(e.clientX, e.clientY, attrs, d.description, d.typeColor);
            }
        })
        .on("mousemove", (e, d) => {
            const attrs = linkHoverAttrs[d.id];
            if (attrs && attrs.length > 0) {
                showHoverCard(e.clientX, e.clientY, attrs, d.description, d.typeColor);
            }
        })
        .on("mouseout", () => hideHoverCard());

    const link = linkGroup.append("line")
        .attr("class", "link-line")
        .attr("stroke", d => d.typeColor)
        .attr("marker-end", d => `url(#arrow-${d.typeColor.replace('#', '')})`);

    const linkText = linkGroup.append("text")
        .attr("class", "link-text")
        .attr("text-anchor", "middle")
        .text(d => d.description);

    function renderLinkHighlight() {
        linkGroup.selectAll(".link-line")
            .attr("stroke", d => d.id === selectedLinkId ? "#4f46e5" : d.typeColor)
            .attr("stroke-width", d => d.id === selectedLinkId ? 5 : 2)
            .attr("marker-end", d => d.id === selectedLinkId
                ? "url(#arrow-4f46e5)"
                : `url(#arrow-${d.typeColor.replace('#', '')})`);
        linkGroup.selectAll(".link-text")
            .attr("fill", d => d.id === selectedLinkId ? "#4f46e5" : "#475569")
            .style("font-weight", d => d.id === selectedLinkId ? "bold" : "normal");
    }
    renderLinkHighlight();
    const nodeRepresentMap = {};
    nodesData.forEach(n => {
        const attrs = nodeHoverAttrs[n.id];
        const rep = attrs?.find(a => a.typeName === "represent");
        if (rep) nodeRepresentMap[n.id] = rep.value;
    });

    const nodeGroup = svg.append("g").selectAll("g")
        .data(nodesData).join("g")
        .attr("class", "node-group")
        .on("click", (e, d) => {
            e.stopPropagation();
            selectedLinkId = null;
            renderLinkHighlight();
            openNodeEditor(d);
        })
        .on("dblclick", (e, d) => {
            e.stopPropagation();
            window.location.href = `node_detail.html?id=${d.id}&graph_id=${currentGraphId}`;
        })
        .on("mouseover", (e, d) => {
            const attrs = nodeHoverAttrs[d.id];
            if (attrs && attrs.length > 0) {
                showHoverCard(e.clientX, e.clientY, attrs, d.label, d.color);
            }
        })
        .on("mouseenter", (e, d) => {

            hoveringNode = true;

            const attrs = nodeHoverAttrs[d.id];

            if (attrs && attrs.length > 0) {
                showHoverCard(
                    e.clientX,
                    e.clientY,
                    attrs,
                    d.label,
                    d.color
                );
            }

        })

        .on("mouseleave", () => {

            hoveringNode = false;

            setTimeout(() => {

                if (!hoveringNode && !hoveringCard) {
                    hideHoverCard();
                }

            }, 100);

        })

        .on("mousemove", (e, d) => {
            const attrs = nodeHoverAttrs[d.id];
            if (attrs && attrs.length > 0) {
                showHoverCard(e.clientX, e.clientY, attrs, d.label, d.color);
            }
        });
        // .on("mouseout", () => hideHoverCard());

    nodeGroup.append("circle")
        .attr("class", "node-circle")
        .attr("r", 14)
        .attr("fill", d => d.color);

    nodeGroup.append("text")
        .attr("class", "node-text")
        .attr("y", -22)
        .text(d => {
            const attrs = nodeHoverAttrs[d.id];
            const rep = attrs?.find(a => a.typeName === "represent");

            // ⭐ 有 represent → 顯示 represent
            if (rep?.value) return rep.value;

            // ⭐ 沒 represent → 顯示 label + type
            return `${d.label} [${d.typeName}]`;
        });

    const hoverControls = nodeGroup.append("g").attr("class", "hover-controls-group");

    const quickAddBtn = hoverControls.append("g")
        .attr("class", "quick-control-btn")
        .attr("transform", "translate(22, -10)")
        .on("click", (e, d) => { e.stopPropagation(); openExtendObjectConsole(d); });
    quickAddBtn.append("circle").attr("r", 9).attr("fill", "#10b981");
    quickAddBtn.append("text")
        .attr("text-anchor", "middle").attr("dy", "3.5").attr("fill", "#ffffff")
        .style("font-size", "11px").style("font-weight", "bold").text("+");

    const quickLinkBtn = hoverControls.append("g")
        .attr("class", "quick-control-btn")
        .attr("transform", "translate(22, 12)")
        .call(d3.drag()
            .on("start", function(e, d) {
                e.sourceEvent.stopPropagation();
                isDraggingLink = true;
                dragSourceNode = d;
                dragLine.style("display", "block")
                    .attr("x1", d.x).attr("y1", d.y)
                    .attr("x2", d.x).attr("y2", d.y);
            })
            .on("drag", function(e) {
                const mouseCoords = d3.pointer(e.sourceEvent, svg.node());
                dragLine.attr("x2", mouseCoords[0]).attr("y2", mouseCoords[1]);
            })
            .on("end", async function(e) {
                if (!isDraggingLink) return;
                isDraggingLink = false;
                dragLine.style("display", "none");
                const targetEl = document.elementFromPoint(e.sourceEvent.clientX, e.sourceEvent.clientY);
                let targetNode = null;
                if (targetEl) {
                    const nodeGroupEl = targetEl.closest(".node-group");
                    if (nodeGroupEl) {
                        const matchedData = d3.select(nodeGroupEl).datum();
                        if (matchedData && matchedData.id !== dragSourceNode.id) targetNode = matchedData;
                    }
                }
                if (targetNode) await handleDragConnect(dragSourceNode, targetNode);
                else simulation.alpha(0.05).restart();
                dragSourceNode = null;
            })
        );
    quickLinkBtn.append("circle").attr("r", 9).attr("fill", "#4f46e5");
    quickLinkBtn.append("text")
        .attr("text-anchor", "middle").attr("dy", "3").attr("fill", "#ffffff")
        .style("font-size", "10px").style("font-weight", "bold").text("↗");

    nodeGroup.call(d3.drag()
        .on("start", (e, d) => {
            if (isDraggingLink) return;
            if (!e.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x; d.fy = d.y;
        })
        .on("drag", (e, d) => {
            if (isDraggingLink) return;
            d.fx = e.x; d.fy = e.y;
        })
        .on("end", (e, d) => {
            if (isDraggingLink) return;
            if (!e.active) simulation.alphaTarget(0);
            d.fx = null; d.fy = null;
        }));

    svg.on("click", (e) => {
        if (e.target.tagName === "svg") {
            selectedLinkId = null;
            renderLinkHighlight();
        }
    });

    simulation.on("tick", () => {
        const padding = 35;
        const w = getCanvasWidth();

        nodesData.forEach(d => {
            d.x = Math.max(LEFT_MARGIN + 35, Math.min(w - RIGHT_MARGIN - 35, d.x));
            d.y = Math.max(TOP_MARGIN + 35, Math.min(HEIGHT - BOTTOM_MARGIN - 35, d.y));
        });
        link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
        linkText
            .attr("x", d => (d.source.x + d.target.x) / 2)
            .attr("y", d => (d.source.y + d.target.y) / 2 - 6);
        nodeGroup.attr("transform", d => `translate(${d.x},${d.y})`);
    });
}

async function handleDragConnect(sourceNode, targetNode) {
    const isDuplicate = linksData.some(l =>
        (l.source.id === sourceNode.id && l.target.id === targetNode.id) ||
        (l.source === sourceNode.id && l.target === targetNode.id)
    );
    if (isDuplicate) { alert("A link between these two nodes already exists!"); simulation.alpha(0.05).restart(); return; }

    const { data: newLinkArray, error } = await supabaseClient
        .from('links')
        .insert([{ source: sourceNode.id, target: targetNode.id, description: 'new link', graph_id: currentGraphId }])
        .select();

    if (error) { console.error("Failed to create link:", error); simulation.alpha(0.05).restart(); return; }

    await fetchData();
    if (newLinkArray && newLinkArray.length > 0) {
        selectedLinkId = newLinkArray[0].id;
        renderGraph();
        const createdLink = linksData.find(l => l.id === selectedLinkId);
        if (createdLink) openLinkEditor(createdLink);
    } else {
        renderGraph();
    }
}

// ============================================================
// UI HELPERS
// ============================================================

function updateTypeSelectOptions() {
    const selectEl = d3.select("#objTypeSelect");
    const editSelectEl = d3.select("#editNodeTypeSelect");
    selectEl.selectAll("*").remove();
    editSelectEl.selectAll("*").remove();
    if (dbTypes.length === 0) {
        selectEl.append("option").attr("value", "").text("(Create an Object Type first)");
        editSelectEl.append("option").attr("value", "").text("(No types available)");
    } else {
        dbTypes.forEach(t => {
            selectEl.append("option").attr("value", t.id).text(t.type_name);
            editSelectEl.append("option").attr("value", t.id).text(t.type_name);
        });
    }
}

function updateLinkTypeSelectOptions(currentTypeId) {
    const selectEl = d3.select("#editLinkTypeSelect");
    selectEl.selectAll("*").remove();
    selectEl.append("option").attr("value", "").text("(No type — default grey)");
    dbLinkTypes.forEach(t => {
        selectEl.append("option").attr("value", t.id).text(t.type_name);
    });
    if (currentTypeId) selectEl.property("value", currentTypeId);
}

function renderDropdownMenu() {
    const typeList = d3.select("#dropdown-types");
    const nodeList = d3.select("#dropdown-nodes");
    typeList.selectAll("*").remove();
    nodeList.selectAll("*").remove();
    dbTypes.forEach(t => {
        typeList.append("li")
            .html(`<span class="type-badge" style="background:${t.color}"></span>${t.type_name}`)
            .on("click", () => { openCreatorConsole(); switchCreatorMode('OBJECT'); d3.select("#objTypeSelect").property("value", t.id); });
    });
    nodesData.forEach(n => {
        nodeList.append("li").text(n.label).on("click", () => { openNodeEditor(n); });
    });
}

window.toggleRightPanel = function() {
    const panel = d3.select("#rightPanel");
    const btn = document.getElementById("hoverActionBtn");
    const isOpening = !panel.classed("active");
    panel.classed("active", isOpening);
    btn.classList.toggle("open", isOpening);
    if (isOpening) {
        hideAllPanelSections();
        d3.select("#creatorConsoleContainer").style("display", "block");
        switchCreatorMode('OBJ_TYPE');
        parentNodeIdForExtend = null;
        d3.select("#relationFieldContainer").style("display", "none");
    }
    setTimeout(() => {
        const currentWidth = getCanvasWidth();
        svg.attr("width", currentWidth);
        if (simulation) simulation.force("center", d3.forceCenter(currentWidth / 2, HEIGHT / 2)).alpha(0.2).restart();
    }, 310);
};

window.openCreatorConsole = function() {
    d3.select("#rightPanel").classed("active", true);
    document.getElementById("hoverActionBtn").classList.add("open");
    hideAllPanelSections();
    d3.select("#creatorConsoleContainer").style("display", "block");
    switchCreatorMode('OBJ_TYPE');
    parentNodeIdForExtend = null;
    d3.select("#relationFieldContainer").style("display", "none");
    syncLayoutAndSim();
};

window.toggleRepresentPanel = function () {
    const panel = document.getElementById("representPanel");
    panel.classList.toggle("hidden");

    if (!panel.classList.contains("hidden")) {
        renderRepresentPanel();
    }
};

window.openExtendObjectConsole = function(parentNodes) {
    openCreatorConsole();
    switchCreatorMode('OBJECT');
    parentNodeIdForExtend = parentNodes.id;
    d3.select("#relationFieldContainer").style("display", "block");
    d3.select("#objRelation").property("value", "extends");
};

window.switchCreatorMode = function(mode) {
    currentCreatorMode = mode;
    const radioMap = { 'OBJ_TYPE': 'radio-obj-type', 'REL_TYPE': 'radio-rel-type', 'OBJECT': 'radio-object' };
    const radioEl = document.getElementById(radioMap[mode]);
    if (radioEl) radioEl.checked = true;
    d3.select("#form-add-obj-type").style("display", mode === 'OBJ_TYPE' ? "block" : "none");
    d3.select("#form-add-rel-type").style("display", mode === 'REL_TYPE' ? "block" : "none");
    d3.select("#form-add-object").style("display", mode === 'OBJECT' ? "block" : "none");
    if (mode === 'OBJECT') updateTypeSelectOptions();
};

window.triggerInlineTypeForm = function() {
    const form = d3.select("#inlineTypeForm");
    form.style("display", form.style("display") === "none" ? "block" : "none");
};

window.openNodeEditor = function(node) {
    d3.select("#rightPanel").classed("active", true);
    hideAllPanelSections();
    d3.select("#nodeEditContainer").style("display", "block");
    updateTypeSelectOptions();
    d3.select("#editNodeId").property("value", node.id);
    d3.select("#editNodeLabel").property("value", node.label);
    d3.select("#editNodeTypeSelect").property("value", node.type_id || "");
    syncLayoutAndSim();
};

window.openLinkEditor = function(link) {
    d3.select("#rightPanel").classed("active", true);
    hideAllPanelSections();
    d3.select("#linkFormContainer").style("display", "block");
    d3.select("#linkId").property("value", link.id);
    d3.select("#linkLabel").property("value", link.description);
    updateLinkTypeSelectOptions(link.type_id);
    updateLinkTypeColorPreview(link.type_id);
    syncLayoutAndSim();
};

window.onLinkTypeChange = function() {
    const typeId = d3.select("#editLinkTypeSelect").property("value");
    updateLinkTypeColorPreview(typeId);
};

function updateLinkTypeColorPreview(typeId) {
    const preview = document.getElementById('linkTypeColorPreview');
    if (!preview) return;
    const lt = dbLinkTypes.find(t => t.id === typeId);
    preview.style.background = lt ? lt.color : '#94a3b8';
}

function hideAllPanelSections() {
    d3.select("#creatorConsoleContainer").style("display", "none");
    d3.select("#nodeEditContainer").style("display", "none");
    d3.select("#linkFormContainer").style("display", "none");
}

function renderRepresentPanel() {
    const panel = document.getElementById("representList");
    if (!panel) return;

    const data = buildRepresentList();
    panel.innerHTML = "";

    data.forEach(item => {
        const div = document.createElement("div");
        div.className = "rep-item";

        div.innerHTML = `
            <div class="rep-value">${item.represent}</div>
            <div class="rep-label">${item.label} [${item.type}]</div>
        `;

        div.onclick = () => {
            focusNode(item.id);
        };

        panel.appendChild(div);
    });
}

function syncLayoutAndSim() {
    const currentWidth = getCanvasWidth();
    svg.attr("width", currentWidth);
    if (simulation) simulation.force("center", d3.forceCenter(currentWidth / 2, HEIGHT / 2)).alpha(0.2).restart();
}

// ============================================================
// CRUD
// ============================================================

window.handleCreateTypeOnly = async function() {
    const tName = d3.select("#newObjTypeName").property("value").trim();
    const tColor = d3.select("#newObjTypeColor").property("value");
    if (!tName) return alert("Please enter a type name!");
    await supabaseClient.from('node_types').insert([{ type_name: tName, color: tColor, graph_id: currentGraphId }]);
    d3.select("#newObjTypeName").property("value", "");
    await fetchData(); renderGraph(); renderDropdownMenu(); updateTypeSelectOptions();updateRepToggleVisibility();
};

window.handleCreateRelationType = async function() {
    const tName = d3.select("#newRelTypeName").property("value").trim();
    const tColor = d3.select("#newRelTypeColor").property("value");
    if (!tName) return alert("Please enter a relation type name!");
    const { error } = await supabaseClient.from('link_types').insert([{ type_name: tName, color: tColor, graph_id: currentGraphId }]);
    if (error) { console.error(error); return; }
    d3.select("#newRelTypeName").property("value", "");
    await fetchData();
    updateRepToggleVisibility();
    alert(`Relation type "${tName}" saved!`);
};

window.handleCreateObject = async function() {
    const label = d3.select("#objLabel").property("value").trim();
    if (!label) return alert("Please enter a node label!");
    let finalTypeId = d3.select("#objTypeSelect").property("value");
    const isInlineActive = d3.select("#inlineTypeForm").style("display") === "block";
    if (isInlineActive) {
        const inlineTName = d3.select("#inlineTypeName").property("value").trim();
        const inlineTColor = d3.select("#inlineTypeColor").property("value");
        if (inlineTName) {
            const { data: newTypeObj } = await supabaseClient
                .from('node_types').insert([{ type_name: inlineTName, color: inlineTColor, graph_id: currentGraphId }]).select();
            if (newTypeObj && newTypeObj.length > 0) finalTypeId = newTypeObj[0].id;
        }
    }
    if (!finalTypeId) return alert("Please select or create a type!");
    const newId = crypto.randomUUID();
    await supabaseClient.from('nodes').insert([{ id: newId, label, type_id: finalTypeId, graph_id: currentGraphId }]);
    if (parentNodeIdForExtend) {
        const relText = d3.select("#objRelation").property("value") || "extends";
        await supabaseClient.from('links').insert([{ source: parentNodeIdForExtend, target: newId, description: relText, graph_id: currentGraphId }]);
    }
    d3.select("#objLabel").property("value", "");
    d3.select("#inlineTypeName").property("value", "");
    d3.select("#inlineTypeForm").style("display", "none");
    parentNodeIdForExtend = null;
    d3.select("#relationFieldContainer").style("display", "none");
    await fetchData(); renderGraph(); renderDropdownMenu(); updateTypeSelectOptions(); updateRepToggleVisibility();
};

window.handleUpdateNode = async function() {
    const id = d3.select("#editNodeId").property("value");
    const label = d3.select("#editNodeLabel").property("value").trim();
    const type_id = d3.select("#editNodeTypeSelect").property("value");
    if (id && label) {
        await supabaseClient.from('nodes').update({ label, type_id }).eq('id', id);
        await fetchData(); renderGraph(); renderDropdownMenu(); updateRepToggleVisibility();
    }
};

window.handleDeleteNode = async function() {
    const id = d3.select("#editNodeId").property("value");
    if (id && confirm("Delete this node?")) {
        await supabaseClient.from('nodes').delete().eq('id', id);
        hideAllPanelSections();
        await fetchData(); renderGraph(); renderDropdownMenu(); updateRepToggleVisibility();
    }
};

window.handleSaveLink = async function() {
    const id = d3.select("#linkId").property("value");
    const description = d3.select("#linkLabel").property("value").trim();
    const type_id = d3.select("#editLinkTypeSelect").property("value") || null;
    if (!id || !description) return alert("Please enter a relation label!");
    const { error } = await supabaseClient.from('links').update({ description, type_id }).eq('id', id);
    if (error) { console.error("Failed to save link:", error); return; }
    await fetchData(); renderGraph(); updateRepToggleVisibility();
};

window.handleDeleteLink = async function() {
    const id = d3.select("#linkId").property("value");
    if (!id || !confirm("Delete this link?")) return;
    const { error } = await supabaseClient.from('links').delete().eq('id', id);
    if (error) { console.error("Failed to delete link:", error); return; }
    hideAllPanelSections();
    await fetchData(); renderGraph(); updateRepToggleVisibility();
};

// ============================================================
// EVENTS
// ============================================================

window.addEventListener("resize", () => {
    HEIGHT = window.innerHeight;
    const currentWidth = getCanvasWidth();
    svg.attr("width", currentWidth).attr("height", HEIGHT);
    if (simulation) simulation.force("center", d3.forceCenter(currentWidth / 2, HEIGHT / 2)).alpha(0.3).restart();
});

window.addEventListener('DOMContentLoaded', init);