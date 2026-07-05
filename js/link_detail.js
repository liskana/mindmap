const SUPABASE_URL = 'https://cjffcdpvstxdcnvldklt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqZmZjZHB2c3R4ZGNudmxka2x0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMTA1OTcsImV4cCI6MjA5NTg4NjU5N30.AjsLNhDOdiEmSxU3Hc4hr0TPSdTbtRbIqr-K3sDmQ5I';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const params = new URLSearchParams(window.location.search);
const linkId = params.get('id');
const graphId = params.get('graph_id');

let linkData = null;
let attributesData = [];   // detail 頁面順序 (sort_order)
let hoverOrderData = [];   // hover card 順序 (hover_sort_order)
let attrTypesData = [];
let isViewer = false;

let dragState = null; // { id, source: 'list' | 'hover' }

async function init() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return; }
    if (!linkId || !graphId) { alert('Missing link ID'); return; }

    const { data: member } = await supabaseClient.from('members').select('role').eq('id', session.user.id).single();
    isViewer = member?.role === 3;

    await Promise.all([fetchLink(), fetchAttrTypes(), fetchAttributes()]);
    renderHeader();
    renderAttributeList();
    renderHoverCardPanel();
    populateAttrTypeSelect();
    applyViewerMode();
}

function applyViewerMode() {
    if (!isViewer) return;
    const addBtn = document.querySelector('.section-header button');
    if (addBtn) addBtn.style.display = 'none';
    const rightPanel = document.getElementById('detail-right-panel');
    if (rightPanel) rightPanel.style.display = 'none';
    document.querySelectorAll('.attribute-card').forEach(c => c.style.cursor = 'default');
}

async function fetchLink() {
    const { data } = await supabaseClient
        .from('links')
        .select('*, link_types(type_name, color), source_node:nodes!links_source_fkey(label), target_node:nodes!links_target_fkey(label)')
        .eq('id', linkId).single();
    linkData = data;
}

async function fetchAttrTypes() {
    const { data } = await supabaseClient.from('attribute_types').select('*').eq('graph_id', graphId);
    attrTypesData = data || [];
}

async function fetchAttributes() {
    const { data } = await supabaseClient
        .from('attributes').select('*, attribute_types(type_name)').eq('link_id', linkId)
        .order('sort_order', { ascending: true });
    attributesData = data || [];
    rebuildHoverOrderData();
}

function rebuildHoverOrderData() {
    hoverOrderData = [...attributesData].sort(
        (a, b) => (a.hover_sort_order ?? 0) - (b.hover_sort_order ?? 0)
    );
}

function renderHeader() {
    if (!linkData) return;
    const color = linkData.link_types?.color || '#94a3b8';
    document.getElementById('linkTypeBadge').style.background = color;
    document.getElementById('linkTitle').textContent = linkData.description || 'Link';
    document.getElementById('linkSourceNode').textContent = linkData.source_node?.label || '?';
    document.getElementById('linkTargetNode').textContent = linkData.target_node?.label || '?';
}

// ============================================================
// ATTRIBUTE LIST (detail 頁面順序，可拖拽)
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
        card.draggable = !isViewer;
        card.dataset.attrId = attr.id;
        card.innerHTML = `
            ${!isViewer ? '<div class="attr-drag-handle" title="Drag to reorder">⋮⋮</div>' : ''}
            <div class="attr-body">
                <div class="attr-type-label">${attr.attribute_types?.type_name || 'Unknown Type'}</div>
                <div class="attr-value">${attr.value || ''}</div>
            </div>
        `;
        if (!isViewer) {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.attr-drag-handle')) return;
                openEditAttributeForm(attr);
            });
            card.addEventListener('dragstart', (e) => handleDragStart(e, attr.id, 'list'));
            card.addEventListener('dragover', (e) => handleDragOver(e, 'list'));
            card.addEventListener('dragleave', handleDragLeave);
            card.addEventListener('drop', (e) => handleDropOnList(e, attr.id));
            card.addEventListener('dragend', handleDragEnd);
        }
        list.appendChild(card);
    });
}

// ============================================================
// HOVER CARD PANEL（hover card 順序，可拖拽，獨立於上方順序）
// ============================================================

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
        item.draggable = true;
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
        item.addEventListener('dragstart', (e) => handleDragStart(e, attr.id, 'hover'));
        item.addEventListener('dragover', (e) => handleDragOver(e, 'hover'));
        item.addEventListener('dragleave', handleDragLeave);
        item.addEventListener('drop', (e) => handleDropOnHover(e, attr.id));
        item.addEventListener('dragend', handleDragEnd);
        list.appendChild(item);
    });
}

// ============================================================
// DRAG & DROP HELPERS
// ============================================================

function handleDragStart(e, id, source) {
    dragState = { id, source };
    e.currentTarget.classList.add('dragging');
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
    e.currentTarget.classList.remove('dragging');
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
        // 新屬性放在兩個順序的最後
        const nextOrder = attributesData.length;
        const { error } = await supabaseClient.from('attributes').insert([{
            attribute_type_id: typeId, link_id: linkId, value, show_on_hover: false,
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