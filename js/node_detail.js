const SUPABASE_URL = 'https://cjffcdpvstxdcnvldklt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqZmZjZHB2c3R4ZGNudmxka2x0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMTA1OTcsImV4cCI6MjA5NTg4NjU5N30.AjsLNhDOdiEmSxU3Hc4hr0TPSdTbtRbIqr-K3sDmQ5I';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const params = new URLSearchParams(window.location.search);
const nodeId = params.get('id');
const graphId = params.get('graph_id');

let nodeData = null;
let attributesData = [];
let hoverOrderData = [];
let attrTypesData = [];
let isViewer = false;

let dragState = null; // { id, source: 'list' | 'hover' }

let allNodes = [];
let allLinks = [];
let dbNodeTypes = [];
let activeSelection = null; // { text, attrId }
let linkPopupBtnEl = null;

async function init() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return; }
    if (!nodeId || !graphId) { alert('Missing node ID'); return; }

    const { data: member } = await supabaseClient.from('members').select('role').eq('id', session.user.id).single();
    isViewer = member?.role === 3;

    await Promise.all([fetchNode(), fetchAttrTypes(), fetchAttributes(), fetchSearchIndex()]);
    renderHeader();
    renderAttributeList();
    renderHoverCardPanel();
    populateAttrTypeSelect();
    applyViewerMode();
    if (!isViewer) attachSelectionListener();
}

function applyViewerMode() {
    if (!isViewer) return;
    const addBtn = document.querySelector('.section-header button');
    if (addBtn) addBtn.style.display = 'none';
    const rightPanel = document.getElementById('detail-right-panel');
    if (rightPanel) rightPanel.style.display = 'none';
    document.querySelectorAll('.attribute-card').forEach(c => c.style.cursor = 'default');
}

async function fetchNode() {
    const { data } = await supabaseClient.from('nodes').select('*, node_types(type_name, color)').eq('id', nodeId).single();
    nodeData = data;
}

async function fetchAttrTypes() {
    const { data } = await supabaseClient.from('attribute_types').select('*').eq('graph_id', graphId);
    attrTypesData = data || [];
}

async function fetchAttributes() {
    const { data } = await supabaseClient
        .from('attributes').select('*, attribute_types(type_name)').eq('node_id', nodeId)
        .order('sort_order', { ascending: true });
    attributesData = data || [];
    rebuildHoverOrderData();
}

function rebuildHoverOrderData() {
    hoverOrderData = [...attributesData].sort(
        (a, b) => (a.hover_sort_order ?? 0) - (b.hover_sort_order ?? 0)
    );
}

async function fetchSearchIndex() {
    const { data: nodes } = await supabaseClient
        .from('nodes').select('id, label, type_id, node_types(type_name, color)').eq('graph_id', graphId);
    allNodes = nodes || [];

    const { data: links } = await supabaseClient
        .from('links').select('id, description, source, target, type_id, link_types(type_name, color)').eq('graph_id', graphId);
    allLinks = links || [];

    const { data: types } = await supabaseClient.from('node_types').select('*').eq('graph_id', graphId);
    dbNodeTypes = types || [];
}

async function renderHeader() {
    if (!nodeData) return;
    const color = nodeData.node_types?.color || '#94a3b8';
    document.getElementById('nodeTypeBadge').style.background = color;
    document.getElementById('nodeTitle').textContent = nodeData.label;

    const { data: links } = await supabaseClient
        .from('links')
        .select('*, source_node:nodes!links_source_fkey(label), target_node:nodes!links_target_fkey(label)')
        .or(`source.eq.${nodeId},target.eq.${nodeId}`)
        .eq('graph_id', graphId);

    const container = document.getElementById('nodeConnections');
    container.innerHTML = '';
    if (!links || links.length === 0) {
        container.innerHTML = '<span style="font-size:13px;color:#94a3b8;">No connections</span>';
        return;
    }
    links.forEach(l => {
        const isSource = l.source === nodeId;
        const otherLabel = isSource ? l.target_node?.label : l.source_node?.label;
        const chip = document.createElement('span');
        chip.className = 'conn-chip';
        chip.innerHTML = isSource
            ? `→ <span class="conn-relation">${l.description}</span> → ${otherLabel}`
            : `${otherLabel} → <span class="conn-relation">${l.description}</span> →`;
        container.appendChild(chip);
    });
}

// ============================================================
// TEXT → HTML
// ============================================================

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
}

function renderValueWithLinks(rawValue) {
    if (!rawValue) return '';
    const wikiLinkRegex = /\[\[(node|link):([0-9a-fA-F-]{36})\|([^\]]*)\]\]/g;
    let result = '';
    let lastIndex = 0;
    let match;
    while ((match = wikiLinkRegex.exec(rawValue)) !== null) {
        const [full, kind, id, label] = match;
        result += escapeHtml(rawValue.slice(lastIndex, match.index));
        const href = kind === 'node'
            ? `node_detail.html?id=${id}&graph_id=${graphId}`
            : `link_detail.html?id=${id}&graph_id=${graphId}`;
        result += `<a href="${href}" class="wiki-link wiki-link-${kind}">${escapeHtml(label)}</a>`;
        lastIndex = match.index + full.length;
    }
    result += escapeHtml(rawValue.slice(lastIndex));
    return result.replace(/\n/g, '<br>');
}

// ============================================================
// ATTRIBUTE LIST — 拖拽把手獨立於卡片，避免吃掉文字選取
// ============================================================

function renderAttributeList() {
    const list = document.getElementById('attributeList');
    list.innerHTML = '';
    if (attributesData.length === 0) {
        list.innerHTML = '<div class="empty-state">No attributes yet.' + (isViewer ? '' : ' Click "+ Add Attribute" to start.') + '</div>';
        return;
    }
    attributesData.forEach(attr => {
        const card = document.createElement('div');
        card.className = 'attribute-card';
        card.dataset.attrId = attr.id;
        card.innerHTML = `
            ${!isViewer ? '<div class="attr-drag-handle" title="Drag to reorder">⋮⋮</div>' : ''}
            <div class="attr-body">
                <div class="attr-type-label">${attr.attribute_types?.type_name || 'Unknown Type'}</div>
                <div class="attr-value">${renderValueWithLinks(attr.value)}</div>
            </div>
        `;
        if (!isViewer) {
            card.addEventListener('dblclick', (e) => {
                if (e.target.closest('.wiki-link') || e.target.closest('.attr-drag-handle')) return;
                openEditAttributeForm(attr);
            });
            const handle = card.querySelector('.attr-drag-handle');
            handle.draggable = true; // 只有把手可拖，卡片本身不設 draggable
            handle.addEventListener('dragstart', (e) => handleDragStart(e, attr.id, 'list'));
            handle.addEventListener('dragend', handleDragEnd);
            card.addEventListener('dragover', (e) => handleDragOver(e, 'list'));
            card.addEventListener('dragleave', handleDragLeave);
            card.addEventListener('drop', (e) => handleDropOnList(e, attr.id));
        }
        list.appendChild(card);
    });
}

function renderHoverCardPanel() {
    if (isViewer) return;
    const list = document.getElementById('hoverCardList');
    list.innerHTML = '';
    if (hoverOrderData.length === 0) {
        list.innerHTML = '<div class="empty-state">No attributes yet.</div>';
        return;
    }
    hoverOrderData.forEach(attr => {
        const item = document.createElement('div');
        item.className = 'hover-card-item';
        item.dataset.attrId = attr.id;
        item.innerHTML = `
            <div class="hover-drag-handle" title="Drag to reorder">⋮⋮</div>
            <input type="checkbox" id="hover-${attr.id}" ${attr.show_on_hover ? 'checked' : ''}
                onchange="handleToggleHover('${attr.id}', this.checked)">
            <div class="hover-card-item-info">
                <div class="hover-card-item-type">${attr.attribute_types?.type_name || 'Unknown'}</div>
                <div class="hover-card-item-value">${attr.value || ''}</div>
            </div>
            <button class="hover-card-delete-btn" onclick="handleDeleteAttribute('${attr.id}')">✕</button>
        `;
        const handle = item.querySelector('.hover-drag-handle');
        handle.draggable = true;
        handle.addEventListener('dragstart', (e) => handleDragStart(e, attr.id, 'hover'));
        handle.addEventListener('dragend', handleDragEnd);
        item.addEventListener('dragover', (e) => handleDragOver(e, 'hover'));
        item.addEventListener('dragleave', handleDragLeave);
        item.addEventListener('drop', (e) => handleDropOnHover(e, attr.id));
        list.appendChild(item);
    });
}

// ============================================================
// DRAG & DROP（排序用，只從把手觸發）
// ============================================================

function handleDragStart(e, id, source) {
    dragState = { id, source };
    const container = e.currentTarget.closest('[data-attr-id]');
    if (container) container.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
}

function handleDragOver(e, source) {
    if (!dragState || dragState.source !== source) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragState.id !== e.currentTarget.dataset.attrId) {
        e.currentTarget.classList.add('drag-over');
    }
}

function handleDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}

function handleDragEnd(e) {
    const container = e.currentTarget.closest('[data-attr-id]');
    if (container) container.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    dragState = null;
}

async function handleDropOnList(e, overId) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    if (!dragState || dragState.source !== 'list' || dragState.id === overId) { dragState = null; return; }
    reorderArray(attributesData, dragState.id, overId);
    dragState = null;
    renderAttributeList();
    await persistOrder(attributesData, 'sort_order');
}

async function handleDropOnHover(e, overId) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    if (!dragState || dragState.source !== 'hover' || dragState.id === overId) { dragState = null; return; }
    reorderArray(hoverOrderData, dragState.id, overId);
    dragState = null;
    renderHoverCardPanel();
    await persistOrder(hoverOrderData, 'hover_sort_order');
}

function reorderArray(arr, draggedId, targetId) {
    const fromIdx = arr.findIndex(a => a.id === draggedId);
    const toIdx = arr.findIndex(a => a.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, moved);
}

async function persistOrder(arr, field) {
    const updates = arr.map((attr, idx) => {
        attr[field] = idx;
        return supabaseClient.from('attributes').update({ [field]: idx }).eq('id', attr.id);
    });
    try {
        await Promise.all(updates);
    } catch (err) {
        console.error('Failed to persist order:', err);
    }
}

// ============================================================
// 選字建立連結
// ============================================================

function attachSelectionListener() {
    document.getElementById('attributeList').addEventListener('mouseup', handleTextSelection);
    document.addEventListener('mousedown', (e) => {
        if (e.target.id !== 'textLinkPopupBtn') hideLinkPopupBtn();
    });
}

function handleTextSelection(e) {
    const valueEl = e.target.closest('.attr-value');
    if (!valueEl) { hideLinkPopupBtn(); return; }
    const selection = window.getSelection();
    const text = selection.toString().trim();
    if (!text || selection.rangeCount === 0) { hideLinkPopupBtn(); return; }
    const range = selection.getRangeAt(0);
    if (!valueEl.contains(range.commonAncestorContainer)) { hideLinkPopupBtn(); return; }
    const card = valueEl.closest('.attribute-card');
    activeSelection = { text, attrId: card.dataset.attrId };
    showLinkPopupBtn(range.getBoundingClientRect());
}

function showLinkPopupBtn(rect) {
    if (!linkPopupBtnEl) {
        linkPopupBtnEl = document.createElement('button');
        linkPopupBtnEl.id = 'textLinkPopupBtn';
        linkPopupBtnEl.className = 'text-link-popup-btn';
        linkPopupBtnEl.textContent = '🔗 link';
        linkPopupBtnEl.onclick = openWikiLinkSearch;
        document.body.appendChild(linkPopupBtnEl);
    }
    linkPopupBtnEl.style.display = 'block';
    linkPopupBtnEl.style.left = Math.max(8, rect.left + rect.width / 2 - 34 + window.scrollX) + 'px';
    linkPopupBtnEl.style.top = (rect.top - 40 + window.scrollY) + 'px';
}

function hideLinkPopupBtn() {
    if (linkPopupBtnEl) linkPopupBtnEl.style.display = 'none';
}

function openWikiLinkSearch() {
    if (!activeSelection) return;
    hideLinkPopupBtn();

    const modal = document.createElement('div');
    modal.className = 'wikilink-modal-backdrop';
    modal.innerHTML = `
        <div class="wikilink-modal">
            <div class="wikilink-modal-header">
                <span>link to「${escapeHtml(activeSelection.text)}」</span>
                <button class="wikilink-modal-close">✕</button>
            </div>
            <input type="text" id="wikilinkSearchInput" placeholder="looking for the existing node..." value="${escapeHtml(activeSelection.text)}">
            <div id="wikilinkResults" class="wikilink-results"></div>
            <div class="wikilink-divider">or</div>
            <button class="primary full-width" id="wikilinkCreateNewBtn">+ add new node「${escapeHtml(activeSelection.text)}」</button>
        </div>
    `;
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => { if (e.target === modal) closeWikiLinkModal(modal); });
    modal.querySelector('.wikilink-modal-close').onclick = () => closeWikiLinkModal(modal);

    const input = modal.querySelector('#wikilinkSearchInput');
    input.addEventListener('input', () => renderWikiLinkResults(input.value, modal));
    modal.querySelector('#wikilinkCreateNewBtn').onclick = () => openQuickNodeForm(modal);

    renderWikiLinkResults(activeSelection.text, modal);
    input.focus();
    input.select();
}

function closeWikiLinkModal(modal) {
    modal.remove();
    activeSelection = null;
}

function renderWikiLinkResults(query, modal) {
    const resultsEl = modal.querySelector('#wikilinkResults');
    const q = query.trim().toLowerCase();
    if (!q) { resultsEl.innerHTML = '<div class="wikilink-empty">enter the keyword...</div>'; return; }

    const nodeMatches = allNodes.filter(n => n.label.toLowerCase().includes(q)).slice(0, 8);
    const linkMatches = allLinks.filter(l => (l.description || '').toLowerCase().includes(q)).slice(0, 8);

    if (nodeMatches.length === 0 && linkMatches.length === 0) {
        resultsEl.innerHTML = '<div class="wikilink-empty">No result found</div>';
        return;
    }

    resultsEl.innerHTML = [
        ...nodeMatches.map(n => `
            <div class="wikilink-result-item" data-kind="node" data-id="${n.id}">
                <span class="wikilink-result-dot" style="background:${n.node_types?.color || '#94a3b8'}"></span>
                <span class="wikilink-result-label">${escapeHtml(n.label)}</span>
                <span class="wikilink-result-type">${escapeHtml(n.node_types?.type_name || '')}</span>
            </div>`),
        ...linkMatches.map(l => `
            <div class="wikilink-result-item" data-kind="link" data-id="${l.id}">
                <span class="wikilink-result-dot" style="background:${l.link_types?.color || '#94a3b8'}"></span>
                <span class="wikilink-result-label">${escapeHtml(l.description)}</span>
                <span class="wikilink-result-type">relation</span>
            </div>`)
    ].join('');

    resultsEl.querySelectorAll('.wikilink-result-item').forEach(item => {
        item.onclick = () => applyWikiLink(item.dataset.kind, item.dataset.id, modal);
    });
}

function openQuickNodeForm(modal) {
    const modalBody = modal.querySelector('.wikilink-modal');
    modalBody.innerHTML = `
        <div class="wikilink-modal-header">
            <span>建立新 Node</span>
            <button class="wikilink-modal-close">✕</button>
        </div>
        <label>Label</label>
        <input type="text" id="quickNodeLabel" value="${escapeHtml(activeSelection.text)}">
        <label>Type</label>
        <select id="quickNodeType"></select>
        <div class="btn-group">
            <button class="primary" id="quickNodeSaveBtn">build and link</button>
            <button id="quickNodeCancelBtn">取消</button>
        </div>
    `;
    const typeSelect = modalBody.querySelector('#quickNodeType');
    if (dbNodeTypes.length === 0) {
        typeSelect.innerHTML = '<option value="">(此 graph 尚無 node type，請先到主畫面建立)</option>';
    } else {
        dbNodeTypes.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.type_name;
            typeSelect.appendChild(opt);
        });
    }
    modalBody.querySelector('.wikilink-modal-close').onclick = () => closeWikiLinkModal(modal);
    modalBody.querySelector('#quickNodeCancelBtn').onclick = () => closeWikiLinkModal(modal);
    modalBody.querySelector('#quickNodeSaveBtn').onclick = async () => {
        const label = modalBody.querySelector('#quickNodeLabel').value.trim();
        const typeId = typeSelect.value;
        if (!label) return alert('請輸入 label');
        if (!typeId) return alert('請選擇 type');
        const newId = crypto.randomUUID();
        const { error } = await supabaseClient.from('nodes').insert([{ id: newId, label, type_id: typeId, graph_id: graphId }]);
        if (error) { console.error(error); alert('建立失敗'); return; }
        await applyWikiLink('node', newId, modal);
    };
}

async function applyWikiLink(kind, targetId, modal) {
    if (!activeSelection) { modal.remove(); return; }
    const { text, attrId } = activeSelection;
    const attr = attributesData.find(a => a.id === attrId);
    if (!attr) { modal.remove(); activeSelection = null; return; }

    const markup = `[[${kind}:${targetId}|${text}]]`;
    const idx = attr.value.indexOf(text);
    const newValue = idx === -1
        ? `${attr.value} ${markup}`
        : attr.value.slice(0, idx) + markup + attr.value.slice(idx + text.length);

    const { error } = await supabaseClient.from('attributes').update({ value: newValue }).eq('id', attrId);
    if (error) { console.error(error); alert('儲存連結失敗'); modal.remove(); activeSelection = null; return; }

    if (kind === 'node' && targetId !== nodeId) {
        await ensureGraphEdge(nodeId, targetId);
    }

    modal.remove();
    activeSelection = null;
    await Promise.all([fetchAttributes(), fetchSearchIndex()]);
    renderAttributeList();
    renderHoverCardPanel();
}

async function ensureGraphEdge(sourceId, targetId) {
    const exists = allLinks.some(l =>
        (l.source === sourceId && l.target === targetId) ||
        (l.source === targetId && l.target === sourceId)
    );
    if (exists) return;
    const { error } = await supabaseClient
        .from('links').insert([{ source: sourceId, target: targetId, description: 'related', graph_id: graphId }]);
    if (error) console.error('建立 graph 連線失敗', error);
}

// ============================================================
// ATTRIBUTE TYPE SELECT / FORM
// ============================================================

function populateAttrTypeSelect(selectedId = null) {
    const select = document.getElementById('attrTypeSelect');
    if (!select) return;
    select.innerHTML = '';
    if (attrTypesData.length === 0) {
        select.innerHTML = '<option value="">(Create a type first using +)</option>';
    } else {
        attrTypesData.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.type_name;
            select.appendChild(opt);
        });
    }
    if (selectedId) select.value = selectedId;
}

window.openAddAttributeForm = function() {
    if (isViewer) return;
    document.getElementById('editAttrId').value = '';
    document.getElementById('attrValue').value = '';
    document.getElementById('inlineAttrTypeForm').style.display = 'none';
    document.getElementById('newAttrTypeName').value = '';
    populateAttrTypeSelect();
    document.getElementById('attributeForm').style.display = 'block';
};

window.openEditAttributeForm = function(attr) {
    if (isViewer) return;
    hideLinkPopupBtn();
    document.getElementById('editAttrId').value = attr.id;
    document.getElementById('attrValue').value = attr.value || '';
    populateAttrTypeSelect(attr.attribute_type_id);
    document.getElementById('inlineAttrTypeForm').style.display = 'none';
    document.getElementById('attributeForm').style.display = 'block';
};

window.closeAttributeForm = function() {
    document.getElementById('attributeForm').style.display = 'none';
};

window.toggleInlineAttrTypeForm = function() {
    const form = document.getElementById('inlineAttrTypeForm');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
};

window.handleSaveAttribute = async function() {
    if (isViewer) return;
    const editId = document.getElementById('editAttrId').value;
    const value = document.getElementById('attrValue').value.trim();
    let typeId = document.getElementById('attrTypeSelect').value;
    const inlineActive = document.getElementById('inlineAttrTypeForm').style.display !== 'none';
    if (inlineActive) {
        const newTypeName = document.getElementById('newAttrTypeName').value.trim();
        if (newTypeName) {
            const { data: newType, error } = await supabaseClient
                .from('attribute_types').insert([{ type_name: newTypeName, graph_id: graphId }]).select().single();
            if (error) { console.error(error); return; }
            typeId = newType.id;
            await fetchAttrTypes();
            populateAttrTypeSelect(typeId);
        }
    }
    if (!typeId) return alert('Please select or create an attribute type!');
    if (!value) return alert('Please enter a value!');
    if (editId) {
        const { error } = await supabaseClient.from('attributes').update({ attribute_type_id: typeId, value }).eq('id', editId);
        if (error) { console.error(error); return; }
    } else {
        const nextOrder = attributesData.length;
        const { error } = await supabaseClient.from('attributes').insert([{
            attribute_type_id: typeId, node_id: nodeId, value, show_on_hover: false,
            sort_order: nextOrder, hover_sort_order: nextOrder
        }]);
        if (error) { console.error(error); return; }
    }
    document.getElementById('attributeForm').style.display = 'none';
    document.getElementById('newAttrTypeName').value = '';
    await fetchAttributes();
    renderAttributeList();
    renderHoverCardPanel();
};

window.handleToggleHover = async function(attrId, checked) {
    if (isViewer) return;
    await supabaseClient.from('attributes').update({ show_on_hover: checked }).eq('id', attrId);
    await fetchAttributes();
    renderAttributeList();
    renderHoverCardPanel();
};

window.handleDeleteAttribute = async function(attrId) {
    if (isViewer) return;
    if (!confirm('Delete this attribute?')) return;
    await supabaseClient.from('attributes').delete().eq('id', attrId);
    await fetchAttributes();
    renderAttributeList();
    renderHoverCardPanel();
};

window.addEventListener('DOMContentLoaded', init);