import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

// 只從 CDN / Hugging Face 下載模型，不嘗試讀取本地路徑
env.allowLocalModels = false;

let extractorPromise = null;

function getExtractor() {
    if (!extractorPromise) {
        extractorPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    }
    return extractorPromise;
}

// 頁面一載入就先在背景開始下載/初始化模型（第一次會抓約 25MB，瀏覽器會快取，之後很快）
getExtractor().catch(err => console.error('Embedding model failed to load:', err));

// text -> 384 維向量陣列
window.computeEmbedding = async function (text) {
    if (!text || !text.trim()) return null;
    const extractor = await getExtractor();
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
};

// JS 陣列 -> pgvector 需要的文字格式，例如 "[0.1,0.2,0.3]"
window.embeddingToPgVector = function (vec) {
    return `[${vec.join(',')}]`;
};

// Supabase 回傳的 pgvector 字串 -> JS 陣列
window.parsePgVector = function (str) {
    if (!str) return null;
    return str.replace(/^\[|\]$/g, '').split(',').map(Number);
};

// 多個向量取平均（用來代表一個 node 底下所有 attribute 的整體語意）
window.averageVectors = function (vectors) {
    if (!vectors || vectors.length === 0) return null;
    const dim = vectors[0].length;
    const avg = new Array(dim).fill(0);
    vectors.forEach(v => v.forEach((val, i) => { avg[i] += val; }));
    return avg.map(v => v / vectors.length);
};