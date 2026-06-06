const SUPABASE_URL = 'https://cjffcdpvstxdcnvldklt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqZmZjZHB2c3R4ZGNudmxka2x0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMTA1OTcsImV4cCI6MjA5NTg4NjU5N30.AjsLNhDOdiEmSxU3Hc4hr0TPSdTbtRbIqr-K3sDmQ5I';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const params = new URLSearchParams(window.location.search);
const nodeId = params.get('id');
const graphId = params.get('graph_id');

let nodeData = null;
let attributesData = [];
let attrTypesData = [];

// ============================================================
// INIT
// ============================================================

async function init() {
    // Auth check
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return; }

    if (!nodeId || !graphId) { alert('Missing node ID'); return; }

    await Promise.all([fetchNode(), fetchAttrTypes(), fetchAttributes()]);
    renderHeader();
    renderAttributeList();
    renderHoverCardPanel();
    populateAttrTypeSelect();
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
        .from('attributes')
        .select('*, attribute_types(type_name)')
        .eq('node_id', nodeId);
    attributesData = data || [];
}

// ============================================================
// RENDER HEADER
// ============================================================

async function renderHeader() {
    if (!nodeData) return;

    // Badge color
    const color = nodeData.node_types?.color || '#94a3b8';
    document.getElementById('nodeTypeBadge').style.background = color;

    // Title
    document.getElementById('nodeTitle').textContent = nodeData.label;

    // Connected nodes
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
// RENDER ATTRIBUTES
// ============================================================

function renderAttributeList() {
    const list = document.getElementById('attributeList');
    list.innerHTML = '';

    if (attributesData.length === 0) {
        list.innerHTML = '<div class="empty-state">No attributes yet. Click "+ Add Attribute" to start.</div>';
        return;
    }

    attributesData.forEach(attr => {
        const card = document.createElement('div');
        card.className = 'attribute-card';
        card.innerHTML = `
            <div class="attr-type-label">${attr.attribute_types?.type_name || 'Unknown Type'}</div>
            <div class="attr-value">${attr.value || ''}</div>
        `;
        card.onclick = () => openEditAttributeForm(attr);
        list.appendChild(card);
    });
}

function renderHoverCardPanel() {
    const list = document.getElementById('hoverCardList');
    list.innerHTML = '';

    if (attributesData.length === 0) {
        list.innerHTML = '<div class="empty-state">No attributes yet.</div>';
        return;
    }

    attributesData.forEach(attr => {
        const item = document.createElement('div');
        item.className = 'hover-card-item';
        item.innerHTML = `
            <input type="checkbox" id="hover-${attr.id}" ${attr.show_on_hover ? 'checked' : ''}
                onchange="handleToggleHover('${attr.id}', this.checked)">
            <div class="hover-card-item-info">
                <div class="hover-card-item-type">${attr.attribute_types?.type_name || 'Unknown'}</div>
                <div class="hover-card-item-value">${attr.value || ''}</div>
            </div>
            <button class="hover-card-delete-btn" onclick="handleDeleteAttribute('${attr.id}')">✕</button>
        `;
        list.appendChild(item);
    });
}

// ============================================================
// ATTRIBUTE FORM
// ============================================================

function populateAttrTypeSelect(selectedId = null) {
    const select = document.getElementById('attrTypeSelect');
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
    document.getElementById('editAttrId').value = '';
    document.getElementById('attrValue').value = '';
    document.getElementById('inlineAttrTypeForm').style.display = 'none';
    document.getElementById('newAttrTypeName').value = '';
    populateAttrTypeSelect();
    document.getElementById('attributeForm').style.display = 'block';
};

window.openEditAttributeForm = function(attr) {
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
    const editId = document.getElementById('editAttrId').value;
    const value = document.getElementById('attrValue').value.trim();
    let typeId = document.getElementById('attrTypeSelect').value;

    // inline new type
    const inlineActive = document.getElementById('inlineAttrTypeForm').style.display !== 'none';
    if (inlineActive) {
        const newTypeName = document.getElementById('newAttrTypeName').value.trim();
        if (newTypeName) {
            const { data: newType, error } = await supabaseClient
                .from('attribute_types')
                .insert([{ type_name: newTypeName, graph_id: graphId }])
                .select().single();
            if (error) { console.error(error); return; }
            typeId = newType.id;
            await fetchAttrTypes();
            populateAttrTypeSelect(typeId);
        }
    }

    if (!typeId) return alert('Please select or create an attribute type!');
    if (!value) return alert('Please enter a value!');

    if (editId) {
        // UPDATE
        const { error } = await supabaseClient.from('attributes').update({ attribute_type_id: typeId, value }).eq('id', editId);
        if (error) { console.error(error); return; }
    } else {
        // INSERT
        const { error } = await supabaseClient.from('attributes').insert([{
            attribute_type_id: typeId,
            node_id: nodeId,
            value,
            show_on_hover: false
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
    const { error } = await supabaseClient.from('attributes').update({ show_on_hover: checked }).eq('id', attrId);
    if (error) { console.error(error); }
    await fetchAttributes();
    renderHoverCardPanel();
};

window.handleDeleteAttribute = async function(attrId) {
    if (!confirm('Delete this attribute?')) return;
    const { error } = await supabaseClient.from('attributes').delete().eq('id', attrId);
    if (error) { console.error(error); return; }
    await fetchAttributes();
    renderAttributeList();
    renderHoverCardPanel();
};

window.addEventListener('DOMContentLoaded', init);