import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.worker.min.mjs';

// 讀 PDF 的 ArrayBuffer -> 純文字（把所有頁面串在一起）
window.extractPdfText = async function (arrayBuffer) {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        fullText += content.items.map(item => item.str).join(' ') + '\n\n';
    }
    return fullText;
};

// 把長文字切成小段落，帶一點 overlap 避免語意在邊界被切斷
window.chunkText = function (text, chunkSize = 800, overlap = 150) {
    const clean = text.replace(/\s+/g, ' ').trim();
    const chunks = [];
    let start = 0;
    while (start < clean.length) {
        const end = Math.min(start + chunkSize, clean.length);
        chunks.push(clean.slice(start, end));
        if (end === clean.length) break;
        start = end - overlap;
    }
    return chunks;
};