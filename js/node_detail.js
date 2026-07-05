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

let dragState = null;

let allNodes = [];
let allLinks = [];
let dbNodeTypes = [];
let activeSelection = null;
let linkPopupBtnEl = null;

let pdfDocumentsData = [];

async function init() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return; }
    if (!nodeId || !graphId) { alert('Missing node ID'); return; }

    const { data: member } = await supabaseClient.from('members').select('role').eq('id', session.user.id).single();
    isViewer = member?.role === 3;

    await Promise.all([fetchNode(), fetchAttrTypes(), fetchAttributes(), fetchSearchIndex(), fetchPdfDocuments()]);
    renderHeader();
    renderAttributeList();
    renderHoverCardPanel();
    renderPdfList();
    populateAttrTypeSelect();
    applyViewerMode();
    if (!isViewer) {
        attachSelectionListener();
        document.getElementById('pdfFileInput').addEventListener('change', handlePdfFileSelected);
        ensureEmbeddingsForAttributes(attributesData).then(() => refreshSimilaritySuggestions());
    }
}

function applyViewerMode() {
    if (!isViewer) return;
    const addBtn = document.querySelector('.section-header button');
    if (addBtn) addBtn.style.display = 'none';
    const rightPanel = document.getElementById('detail-right-panel');
    if (rightPanel) rightPanel.style.display = 'none';
    const simSection = document.getElementById('similaritySection');
    if (simSection) simSection.style.display = 'none';
    const pdfUploadLabel = document.querySelector('.pdf-upload-btn');
    if (pdfUploadLabel) pdfUploadLabel.style.display = 'none';
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
    
    const badgeEl = document.getElementById('aiSuggestedBadge');
    if (badgeEl) {
        badgeEl.innerHTML = nodeData.created_by_ai
            ? `<div class="ai-suggested-badge" title="${escapeHtml(nodeData.ai_reasoning || '')}">🤖 AI Suggested — hover for reasoning</div>`
            : '';
    }

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
// PDF DOCUMENTS
// ============================================================

async function fetchPdfDocuments() {
    const { data } = await supabaseClient
        .from('pdf_documents').select('*').eq('node_id', nodeId).order('uploaded_at', { ascending: false });
    pdfDocumentsData = data || [];
    for (const doc of pdfDocumentsData) {
        const { count } = await supabaseClient
            .from('pdf_chunks').select('id', { count: 'exact', head: true }).eq('document_id', doc.id);
        doc.chunkCount = count || 0;
    }
}

function renderPdfList() {
    const list = document.getElementById('pdfDocumentList');
    if (!list) return;
    list.innerHTML = '';
    if (pdfDocumentsData.length === 0) {
        list.innerHTML = '<div class="empty-state">No documents uploaded yet.</div>';
        return;
    }
    pdfDocumentsData.forEach(doc => {
        const item = document.createElement('div');
        item.className = 'pdf-doc-item';
        item.innerHTML = `
            <div class="pdf-doc-info">
                <div class="pdf-doc-name">${escapeHtml(doc.file_name)}</div>
                <div class="pdf-doc-meta">${doc.chunkCount} chunks indexed</div>
            </div>
            ${!isViewer ? `<button class="pdf-doc-delete-btn">✕</button>` : ''}
        `;
        const delBtn = item.querySelector('.pdf-doc-delete-btn');
        if (delBtn) delBtn.onclick = () => handleDeletePdf(doc.id, doc.storage_path);
        list.appendChild(item);
    });
}

async function handlePdfFileSelected(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.type !== 'application/pdf') { alert('Please select a PDF file'); return; }

    const progressEl = document.getElementById('pdfUploadProgress');
    progressEl.style.display = 'block';
    progressEl.textContent = 'Reading PDF...';

    try {
        const arrayBuffer = await file.arrayBuffer();
        const rawText = await window.extractPdfText(arrayBuffer);
        if (!rawText || !rawText.trim()) {
            alert('No extractable text found in this PDF (it might be a scanned/image-only PDF).');
            progressEl.style.display = 'none';
            return;
        }
        const chunks = window.chunkText(rawText);

        progressEl.textContent = 'Saving document record...';
        const { data: doc, error: docError } = await supabaseClient
            .from('pdf_documents')
            .insert([{ graph_id: graphId, node_id: nodeId, file_name: file.name }])
            .select().single();
        if (docError) throw docError;

        progressEl.textContent = 'Uploading file...';
        const storagePath = `${graphId}/${nodeId}/${doc.id}.pdf`;
        const { error: uploadError } = await supabaseClient.storage
            .from('pdfs').upload(storagePath, file, { contentType: 'application/pdf' });
        if (uploadError) {
            console.error('Storage upload failed (continuing without stored file):', uploadError);
        } else {
            await supabaseClient.from('pdf_documents').update({ storage_path: storagePath }).eq('id', doc.id);
        }

        const rows = [];
        for (let i = 0; i < chunks.length; i++) {
            progressEl.textContent = `Embedding chunk ${i + 1} / ${chunks.length}...`;
            const vec = await window.computeEmbedding(chunks[i]);
            if (!vec) continue;
            rows.push({
                document_id: doc.id,
                chunk_index: i,
                content: chunks[i].replace(/\u0000/g, ''),
                embedding: window.embeddingToPgVector(vec)
            });
        }
        if (rows.length > 0) {
            const { error: chunkError } = await supabaseClient.from('pdf_chunks').insert(rows);
            if (chunkError) throw chunkError;
        }

        progressEl.style.display = 'none';
        await fetchPdfDocuments();
        renderPdfList();
        refreshSimilaritySuggestions();
    } catch (err) {
        console.error('PDF processing failed:', err);
        alert('Failed to process PDF. Check console for details.');
        progressEl.style.display = 'none';
    }
}

async function handleDeletePdf(docId, storagePath) {
    if (!confirm('Delete this document and all its indexed chunks?')) return;
    if (storagePath) {
        const { error } = await supabaseClient.storage.from('pdfs').remove([storagePath]);
        if (error) console.error('Failed to delete storage file:', error);
    }
    const { error } = await supabaseClient.from('pdf_documents').delete().eq('id', docId);
    if (error) { console.error(error); alert('Failed to delete document'); return; }
    await fetchPdfDocuments();
    renderPdfList();
    refreshSimilaritySuggestions();
}

// ============================================================
// EMBEDDINGS
// ============================================================

async function computeAndStoreEmbedding(attributeId, text) {
    try {
        const vec = await window.computeEmbedding(text);
        if (!vec) return;
        const { error } = await supabaseClient
            .from('attribute_embeddings')
            .upsert({ attribute_id: attributeId, embedding: window.embeddingToPgVector(vec), updated_at: new Date().toISOString() });
        if (error) console.error('Failed to store embedding:', error);
    } catch (err) {
        console.error('Embedding computation failed:', err);
    }
}

async function ensureEmbeddingsForAttributes(attrs) {
    const withText = attrs.filter(a => a.value && a.value.trim());
    if (withText.length === 0) return;
    const ids = withText.map(a => a.id);
    const { data: existing } = await supabaseClient
        .from('attribute_embeddings').select('attribute_id').in('attribute_id', ids);
    const existingSet = new Set((existing || []).map(e => e.attribute_id));
    const missing = withText.filter(a => !existingSet.has(a.id));
    for (const attr of missing) {
        await computeAndStoreEmbedding(attr.id, attr.value);
    }
}

// 這個 node 的整體語意向量 = attribute embedding + 自己附加的 PDF chunk embedding 一起平均
async function getNodeAverageEmbedding() {
    const vectors = [];

    const attrIds = attributesData.filter(a => a.value && a.value.trim()).map(a => a.id);
    if (attrIds.length > 0) {
        const { data } = await supabaseClient.from('attribute_embeddings').select('embedding').in('attribute_id', attrIds);
        (data || []).forEach(d => { const v = window.parsePgVector(d.embedding); if (v) vectors.push(v); });
    }

    const docIds = pdfDocumentsData.map(d => d.id);
    if (docIds.length > 0) {
        const { data: chunks } = await supabaseClient.from('pdf_chunks').select('embedding').in('document_id', docIds);
        (chunks || []).forEach(c => { const v = window.parsePgVector(c.embedding); if (v) vectors.push(v); });
    }

    if (vectors.length === 0) return null;
    return window.averageVectors(vectors);
}

async function fetchConnectedNodeIds() {
    const { data: links } = await supabaseClient
        .from('links').select('source, target')
        .or(`source.eq.${nodeId},target.eq.${nodeId}`).eq('graph_id', graphId);
    const set = new Set();
    (links || []).forEach(l => {
        if (l.source === nodeId) set.add(l.target);
        if (l.target === nodeId) set.add(l.source);
    });
    return set;
}

window.refreshSimilaritySuggestions = async function () {
    const container = document.getElementById('similarityResults');
    if (!container) return;
    container.innerHTML = '<div class="empty-state">Analyzing…</div>';

    const avgVec = await getNodeAverageEmbedding();
    if (!avgVec) {
        container.innerHTML = '<div class="empty-state">Not enough content on this node yet to compare (add an attribute or PDF first).</div>';
        return;
    }

    const connected = await fetchConnectedNodeIds();
    const bestByNode = new Map();

    // 1. 跟其他 node 的 attribute 比對
    const { data: attrMatches, error: attrErr } = await supabaseClient.rpc('match_attribute_embeddings', {
        query_embedding: window.embeddingToPgVector(avgVec),
        match_count: 40,
        exclude_node_id: nodeId
    });
    if (attrErr) console.error(attrErr);
    (attrMatches || []).forEach(row => {
        if (!row.node_id || row.node_id === nodeId || connected.has(row.node_id)) return;
        const cur = bestByNode.get(row.node_id);
        if (cur === undefined || row.similarity > cur) bestByNode.set(row.node_id, row.similarity);
    });

    // 2. 跟其他 node 附加的 PDF 內容比對
    const { data: pdfMatches, error: pdfErr } = await supabaseClient.rpc('match_pdf_chunks', {
        query_embedding: window.embeddingToPgVector(avgVec),
        match_count: 40
    });
    if (pdfErr) console.error(pdfErr);
    if (pdfMatches && pdfMatches.length > 0) {
        const docIds = [...new Set(pdfMatches.map(m => m.document_id))];
        const { data: docsMeta } = await supabaseClient.from('pdf_documents').select('id, node_id').in('id', docIds);
        const docNodeMap = new Map((docsMeta || []).map(d => [d.id, d.node_id]));
        pdfMatches.forEach(m => {
            const targetNodeId = docNodeMap.get(m.document_id);
            if (!targetNodeId || targetNodeId === nodeId || connected.has(targetNodeId)) return;
            const cur = bestByNode.get(targetNodeId);
            if (cur === undefined || m.similarity > cur) bestByNode.set(targetNodeId, m.similarity);
        });
    }

    const sorted = [...bestByNode.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (sorted.length === 0) {
        container.innerHTML = '<div class="empty-state">No similar unconnected nodes found.</div>';
        return;
    }

    container.innerHTML = '';
    sorted.forEach(([suggestedNodeId, similarity]) => {
        const n = allNodes.find(x => x.id === suggestedNodeId);
        if (!n) return;
        const item = document.createElement('div');
        item.className = 'similarity-item';
        item.innerHTML = `
            <span class="similarity-dot" style="background:${n.node_types?.color || '#94a3b8'}"></span>
            <div class="similarity-info">
                <div class="similarity-label">${n.label}</div>
                <div class="similarity-type">${n.node_types?.type_name || ''}</div>
            </div>
            <div class="similarity-score">${Math.round(similarity * 100)}%</div>
            <button class="small-connect-btn">Connect</button>
        `;
        item.querySelector('.small-connect-btn').onclick = async () => {
            await ensureGraphEdge(nodeId, suggestedNodeId);
            await Promise.all([fetchSearchIndex(), refreshSimilaritySuggestions()]);
        };
        container.appendChild(item);
    });
};

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
// ATTRIBUTE LIST
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
            handle.draggable = true;
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
// DRAG & DROP
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
        linkPopupBtnEl.textContent = '🔗 Link';
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
                <span>Link "${escapeHtml(activeSelection.text)}"</span>
                <button class="wikilink-modal-close">✕</button>
            </div>
            <input type="text" id="wikilinkSearchInput" placeholder="Search existing node or relation..." value="${escapeHtml(activeSelection.text)}">
            <div id="wikilinkResults" class="wikilink-results"></div>
            <div class="wikilink-divider">or</div>
            <button class="primary full-width" id="wikilinkCreateNewBtn">+ Create new node "${escapeHtml(activeSelection.text)}"</button>
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
    if (!q) { resultsEl.innerHTML = '<div class="wikilink-empty">Type to search</div>'; return; }

    const nodeMatches = allNodes.filter(n => n.label.toLowerCase().includes(q)).slice(0, 8);
    const linkMatches = allLinks.filter(l => (l.description || '').toLowerCase().includes(q)).slice(0, 8);

    if (nodeMatches.length === 0 && linkMatches.length === 0) {
        resultsEl.innerHTML = '<div class="wikilink-empty">No matches found</div>';
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
            <span>Create New Node</span>
            <button class="wikilink-modal-close">✕</button>
        </div>
        <label>Label</label>
        <input type="text" id="quickNodeLabel" value="${escapeHtml(activeSelection.text)}">
        <label>Type</label>
        <select id="quickNodeType"></select>
        <div class="btn-group">
            <button class="primary" id="quickNodeSaveBtn">Create & Link</button>
            <button id="quickNodeCancelBtn">Cancel</button>
        </div>
    `;
    const typeSelect = modalBody.querySelector('#quickNodeType');
    if (dbNodeTypes.length === 0) {
        typeSelect.innerHTML = '<option value="">(No node types in this graph yet)</option>';
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
        if (!label) return alert('Please enter a label');
        if (!typeId) return alert('Please select a type');
        const newId = crypto.randomUUID();
        const { error } = await supabaseClient.from('nodes').insert([{ id: newId, label, type_id: typeId, graph_id: graphId }]);
        if (error) { console.error(error); alert('Failed to create node'); return; }
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
    if (error) { console.error(error); alert('Failed to save link'); modal.remove(); activeSelection = null; return; }

    if (kind === 'node' && targetId !== nodeId) {
        await ensureGraphEdge(nodeId, targetId);
    }

    modal.remove();
    activeSelection = null;
    await Promise.all([fetchAttributes(), fetchSearchIndex()]);
    renderAttributeList();
    renderHoverCardPanel();
    refreshSimilaritySuggestions();
}

async function ensureGraphEdge(sourceId, targetId) {
    const exists = allLinks.some(l =>
        (l.source === sourceId && l.target === targetId) ||
        (l.source === targetId && l.target === sourceId)
    );
    if (exists) return;
    const { error } = await supabaseClient
        .from('links').insert([{ source: sourceId, target: targetId, description: 'related', graph_id: graphId }]);
    if (error) console.error('Failed to create graph edge:', error);
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
        await computeAndStoreEmbedding(editId, value);
    } else {
        const nextOrder = attributesData.length;
        const { data: inserted, error } = await supabaseClient.from('attributes').insert([{
            attribute_type_id: typeId, node_id: nodeId, value, show_on_hover: false,
            sort_order: nextOrder, hover_sort_order: nextOrder
        }]).select().single();
        if (error) { console.error(error); return; }
        await computeAndStoreEmbedding(inserted.id, value);
    }
    document.getElementById('attributeForm').style.display = 'none';
    document.getElementById('newAttrTypeName').value = '';
    await fetchAttributes();
    renderAttributeList();
    renderHoverCardPanel();
    refreshSimilaritySuggestions();
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
    await supabaseClient.from('attribute_embeddings').delete().eq('attribute_id', attrId);
    await fetchAttributes();
    renderAttributeList();
    renderHoverCardPanel();
    refreshSimilaritySuggestions();
};

window.addEventListener('DOMContentLoaded', init);