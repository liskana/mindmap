const SUPABASE_URL = 'https://cjffcdpvstxdcnvldklt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqZmZjZHB2c3R4ZGNudmxka2x0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMTA1OTcsImV4cCI6MjA5NTg4NjU5N30.AjsLNhDOdiEmSxU3Hc4hr0TPSdTbtRbIqr-K3sDmQ5I';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const params = new URLSearchParams(window.location.search);
const linkId = params.get('id');
const graphId = params.get('graph_id');

let linkData = null;
let attributesData = [];
let attrTypesData = [];

async function init() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return; }
    if (!linkId || !graphId) { alert('Missing link ID'); return; }

    await Promise.all([fetchLink(), fetchAttrTypes(), fetchAttributes()]);
    renderHeader();
    renderAttributeList();
    renderHoverCardPanel();
    populateAttrTypeSelect();
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
        .from('attributes')
        .select('*, attribute_types(type_name)')
        .eq('link_id', linkId);
    attributesData = data || [];
}

function renderHeader() {
    if (!linkData) return;

    const color = linkData.link_types?.color || '#94a3b8';
    document.getElementById('linkTypeBadge').style.background = color;
    document.getElementById('linkTitle').textContent = linkData.description || 'Link';
    document.getElementById('linkSourceNode').textContent = linkData.source_node?.label || '?';
    document.getElementById('linkTargetNode').textContent = linkData.target_node?.label || '?';
}

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
        const { error } = await supabaseClient.from('attributes').update({ attribute_type_id: typeId, value }).eq('id', editId);
        if (error) { console.error(error); return; }
    } else {
        const { error } = await supabaseClient.from('attributes').insert([{
            attribute_type_id: typeId,
            link_id: linkId,
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
    await supabaseClient.from('attributes').update({ show_on_hover: checked }).eq('id', attrId);
    await fetchAttributes();
    renderHoverCardPanel();
};

window.handleDeleteAttribute = async function(attrId) {
    if (!confirm('Delete this attribute?')) return;
    await supabaseClient.from('attributes').delete().eq('id', attrId);
    await fetchAttributes();
    renderAttributeList();
    renderHoverCardPanel();
};

window.addEventListener('DOMContentLoaded', init);