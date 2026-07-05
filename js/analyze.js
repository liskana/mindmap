const SUPABASE_URL = 'https://cjffcdpvstxdcnvldklt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqZmZjZHB2c3R4ZGNudmxka2x0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMTA1OTcsImV4cCI6MjA5NTg4NjU5N30.AjsLNhDOdiEmSxU3Hc4hr0TPSdTbtRbIqr-K3sDmQ5I';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const params = new URLSearchParams(window.location.search);
const graphId = params.get('graph_id');

const OLLAMA_BASE_URL = 'http://localhost:11434';
const MAX_CHARS_PER_ITEM = 4000; // 每個 node 附加 PDF 內容的字元上限，避免 prompt 塞爆本機模型的 context window

let isViewer = false;
let allNodes = [];
let allLinks = [];
let dbNodeTypes = [];
let selectedItems = []; // { kind: 'node' | 'link', id, label }

async function init() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return; }
    if (!graphId) { alert('Missing graph ID'); return; }

    const { data: member } = await supabaseClient.from('members').select('role').eq('id', session.user.id).single();
    isViewer = member?.role === 3;
    if (isViewer) {
        document.getElementById('analyze-main').innerHTML = '<div class="empty-state">Viewers cannot use AI analysis.</div>';
        return;
    }

    await fetchGraphIndex();
    document.getElementById('analyzeSearchInput').addEventListener('input', handleSearchInput);
    checkOllamaConnection();
}

async function fetchGraphIndex() {
    const { data: nodes } = await supabaseClient
        .from('nodes').select('id, label, type_id, node_types(type_name, color)').eq('graph_id', graphId);
    allNodes = nodes || [];
    const { data: links } = await supabaseClient
        .from('links').select('id, description, source, target, type_id, link_types(type_name, color)').eq('graph_id', graphId);
    allLinks = links || [];
    const { data: types } = await supabaseClient.from('node_types').select('*').eq('graph_id', graphId);
    dbNodeTypes = types || [];
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
}

// ============================================================
// SEARCH / MULTI-SELECT
// ============================================================

function handleSearchInput(e) {
    const q = e.target.value.trim().toLowerCase();
    const resultsEl = document.getElementById('analyzeSearchResults');
    if (!q) { resultsEl.innerHTML = ''; return; }

    const nodeMatches = allNodes.filter(n => n.label.toLowerCase().includes(q) && !isSelected('node', n.id)).slice(0, 8);
    const linkMatches = allLinks.filter(l => (l.description || '').toLowerCase().includes(q) && !isSelected('link', l.id)).slice(0, 8);

    if (nodeMatches.length === 0 && linkMatches.length === 0) {
        resultsEl.innerHTML = '<div class="wikilink-empty">No matches</div>';
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
        item.onclick = () => {
            addSelection(item.dataset.kind, item.dataset.id);
            document.getElementById('analyzeSearchInput').value = '';
            resultsEl.innerHTML = '';
        };
    });
}

function isSelected(kind, id) {
    return selectedItems.some(s => s.kind === kind && s.id === id);
}

function addSelection(kind, id) {
    if (isSelected(kind, id)) return;
    const source = kind === 'node' ? allNodes.find(n => n.id === id) : allLinks.find(l => l.id === id);
    if (!source) return;
    const label = kind === 'node' ? source.label : source.description;
    selectedItems.push({ kind, id, label });
    renderSelectedChips();
}

function removeSelection(kind, id) {
    selectedItems = selectedItems.filter(s => !(s.kind === kind && s.id === id));
    renderSelectedChips();
}

function renderSelectedChips() {
    const container = document.getElementById('selectedChips');
    container.innerHTML = '';
    selectedItems.forEach(item => {
        const chip = document.createElement('span');
        chip.className = `selected-chip selected-chip-${item.kind}`;
        chip.innerHTML = `${item.kind === 'node' ? '⬤' : '↔'} ${escapeHtml(item.label)} <button>✕</button>`;
        chip.querySelector('button').onclick = () => removeSelection(item.kind, item.id);
        container.appendChild(chip);
    });
}

// ============================================================
// OLLAMA CONNECTION
// ============================================================

async function checkOllamaConnection() {
    const hint = document.getElementById('ollamaStatusHint');
    const modelSelect = document.getElementById('ollamaModelSelect');
    try {
        const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
        if (!res.ok) throw new Error('Ollama responded with error');
        const data = await res.json();
        const models = data.models || [];
        if (models.length === 0) {
            hint.textContent = 'Ollama is running but no models are installed. Run e.g. "ollama pull qwen2.5:7b-instruct" first.';
            return;
        }
        modelSelect.innerHTML = models.map(m => `<option value="${m.name}">${m.name}</option>`).join('');
        hint.textContent = `Connected to Ollama (${models.length} model${models.length > 1 ? 's' : ''} available).`;
    } catch (err) {
        console.error(err);
        hint.innerHTML = `Could not reach Ollama at ${OLLAMA_BASE_URL}. Make sure Ollama is running locally and started with <code>OLLAMA_ORIGINS=*</code>.`;
    }
}

// ============================================================
// GATHER CONTENT FOR SELECTED ITEMS
// ============================================================

async function buildContentForSelection() {
    const sections = [];
    for (const item of selectedItems) {
        sections.push(item.kind === 'node' ? await buildNodeContent(item.id) : await buildLinkContent(item.id));
    }
    return sections.join('\n\n---\n\n');
}

async function buildNodeContent(nodeId) {
    const node = allNodes.find(n => n.id === nodeId);
    const { data: attrs } = await supabaseClient
        .from('attributes').select('value, attribute_types(type_name)').eq('node_id', nodeId);
    const { data: docs } = await supabaseClient
        .from('pdf_documents').select('id, file_name').eq('node_id', nodeId);

    let text = `## Node: ${node.label} (type: ${node.node_types?.type_name || 'unknown'})\n`;
    (attrs || []).forEach(a => {
        text += `- ${a.attribute_types?.type_name || 'Attribute'}: ${a.value}\n`;
    });

    for (const doc of (docs || [])) {
        const { data: chunks } = await supabaseClient
            .from('pdf_chunks').select('content').eq('document_id', doc.id).order('chunk_index').limit(6);
        const docText = (chunks || []).map(c => c.content).join(' ');
        text += `\n[Excerpt from PDF "${doc.file_name}"]: ${docText.slice(0, MAX_CHARS_PER_ITEM)}\n`;
    }
    return text;
}

async function buildLinkContent(linkId) {
    const link = allLinks.find(l => l.id === linkId);
    const sourceNode = allNodes.find(n => n.id === link.source);
    const targetNode = allNodes.find(n => n.id === link.target);
    const { data: attrs } = await supabaseClient
        .from('attributes').select('value, attribute_types(type_name)').eq('link_id', linkId);

    let text = `## Relation: "${link.description}" (${sourceNode?.label || '?'} -> ${targetNode?.label || '?'})\n`;
    (attrs || []).forEach(a => {
        text += `- ${a.attribute_types?.type_name || 'Attribute'}: ${a.value}\n`;
    });
    return text;
}

// ============================================================
// RUN ANALYSIS
// ============================================================

window.runAnalysis = async function () {
    if (selectedItems.length === 0) { alert('Please select at least one node or relation.'); return; }
    const model = document.getElementById('ollamaModelSelect').value;
    if (!model) { alert('No Ollama model available.'); return; }

    const resultsEl = document.getElementById('analysisResults');
    resultsEl.innerHTML = '<div class="empty-state">Gathering content…</div>';

    const content = await buildContentForSelection();
    const question = document.getElementById('analyzeQuestion').value.trim();
    const typeList = dbNodeTypes.map(t => t.type_name).join(', ') || '(none defined yet)';

    const systemPrompt = `You are an assistant embedded in a knowledge-graph tool. The graph has nodes (entities) and relations (typed edges) between them. Existing node types in this graph: ${typeList}.
Given the content below (attributes and/or PDF excerpts of user-selected nodes/relations), do two things:
1. Suggest any NEW nodes worth extracting that are NOT already represented (concepts, entities, etc. mentioned in the text but missing from the graph).
2. Suggest any relationships worth adding between the selected items, or between a selected item and a suggested new node.
Respond ONLY with valid JSON matching exactly this schema, no extra prose, no markdown fences:
{
  "summary": "a short paragraph of overall insight",
  "suggested_nodes": [ { "label": "string", "type_name": "one of the existing types above, or null if none fit", "reasoning": "string" } ],
  "suggested_relationships": [ { "source_label": "string (must match a selected item's label or a suggested node's label)", "target_label": "string (same rule)", "description": "short relation label, e.g. 'cites', 'extends', 'contradicts'", "reasoning": "string" } ]
}`;

    const userPrompt = `${question ? `User question: ${question}\n\n` : ''}Content:\n${content}`;

    resultsEl.innerHTML = `<div class="empty-state">Running analysis with ${model}…</div>`;

    try {
        const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                format: 'json',
                stream: false,
                options: { num_ctx: 8192 }
            })
        });
        if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
        const data = await res.json();
        const raw = data.message?.content || '';
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (parseErr) {
            resultsEl.innerHTML = `<div class="empty-state">Model did not return valid JSON. Raw output:</div><pre class="analyze-raw-output">${escapeHtml(raw)}</pre>`;
            return;
        }
        renderAnalysisResults(parsed);
    } catch (err) {
        console.error(err);
        resultsEl.innerHTML = `<div class="empty-state">Failed to reach Ollama. Make sure it's running locally with OLLAMA_ORIGINS=* set.</div>`;
    }
};

function renderAnalysisResults(parsed) {
    const resultsEl = document.getElementById('analysisResults');
    resultsEl.innerHTML = '';

    if (parsed.summary) {
        const summaryEl = document.createElement('div');
        summaryEl.className = 'analyze-summary';
        summaryEl.textContent = parsed.summary;
        resultsEl.appendChild(summaryEl);
    }

    if (parsed.suggested_nodes && parsed.suggested_nodes.length > 0) {
        const heading = document.createElement('h3');
        heading.textContent = 'Suggested New Nodes';
        resultsEl.appendChild(heading);
        parsed.suggested_nodes.forEach(sugg => {
            const card = document.createElement('div');
            card.className = 'suggestion-card';
            card.innerHTML = `
                <div class="suggestion-badge">🤖 AI Suggested</div>
                <div class="suggestion-title">${escapeHtml(sugg.label)}</div>
                <div class="suggestion-meta">Type: ${escapeHtml(sugg.type_name || 'unspecified')}</div>
                <div class="suggestion-reasoning">${escapeHtml(sugg.reasoning || '')}</div>
                <button class="primary suggestion-create-btn">+ Create Node</button>
            `;
            card.querySelector('.suggestion-create-btn').onclick = async (e) => {
                e.target.disabled = true;
                e.target.textContent = 'Creating…';
                await createSuggestedNode(sugg);
                e.target.textContent = '✓ Created';
            };
            resultsEl.appendChild(card);
        });
    }

    if (parsed.suggested_relationships && parsed.suggested_relationships.length > 0) {
        const heading = document.createElement('h3');
        heading.textContent = 'Suggested Relationships';
        resultsEl.appendChild(heading);
        parsed.suggested_relationships.forEach(sugg => {
            const card = document.createElement('div');
            card.className = 'suggestion-card';
            card.innerHTML = `
                <div class="suggestion-badge">🤖 AI Suggested</div>
                <div class="suggestion-title">${escapeHtml(sugg.source_label)} → ${escapeHtml(sugg.target_label)}</div>
                <div class="suggestion-meta">Relation: ${escapeHtml(sugg.description || 'related')}</div>
                <div class="suggestion-reasoning">${escapeHtml(sugg.reasoning || '')}</div>
                <button class="primary suggestion-create-btn">+ Create Relation</button>
            `;
            card.querySelector('.suggestion-create-btn').onclick = async (e) => {
                e.target.disabled = true;
                e.target.textContent = 'Creating…';
                const ok = await createSuggestedRelationship(sugg);
                e.target.textContent = ok ? '✓ Created' : '⚠ Could not resolve nodes';
            };
            resultsEl.appendChild(card);
        });
    }

    if ((!parsed.suggested_nodes || parsed.suggested_nodes.length === 0) &&
        (!parsed.suggested_relationships || parsed.suggested_relationships.length === 0) &&
        !parsed.summary) {
        resultsEl.innerHTML = '<div class="empty-state">No suggestions returned.</div>';
    }
}

async function createSuggestedNode(sugg) {
    const matchedType = dbNodeTypes.find(t => t.type_name === sugg.type_name);
    const typeId = matchedType ? matchedType.id : (dbNodeTypes[0]?.id || null);
    if (!typeId) { alert('No node type available in this graph to assign.'); return; }
    const newId = crypto.randomUUID();
    const { error } = await supabaseClient.from('nodes').insert([{
        id: newId, label: sugg.label, type_id: typeId, graph_id: graphId,
        created_by_ai: true, ai_reasoning: sugg.reasoning || null
    }]);
    if (error) { console.error(error); alert('Failed to create node'); return; }
    await fetchGraphIndex(); // 讓新建立的 node 進 allNodes，之後的關係建議才找得到它
}

function resolveLabelToNodeId(label) {
    const exact = allNodes.find(n => n.label === label);
    if (exact) return exact.id;
    const fuzzy = allNodes.find(n => n.label.toLowerCase() === label.toLowerCase());
    return fuzzy ? fuzzy.id : null;
}

async function createSuggestedRelationship(sugg) {
    const sourceId = resolveLabelToNodeId(sugg.source_label);
    const targetId = resolveLabelToNodeId(sugg.target_label);
    if (!sourceId || !targetId) return false;
    const { error } = await supabaseClient.from('links').insert([{
        source: sourceId, target: targetId, description: sugg.description || 'related',
        graph_id: graphId, created_by_ai: true, ai_reasoning: sugg.reasoning || null
    }]);
    if (error) { console.error(error); return false; }
    return true;
}

window.addEventListener('DOMContentLoaded', init);