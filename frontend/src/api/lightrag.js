/* ============================================================
 * lightrag.js —— LightRAG / Qdrant / 静态原文 HTTP 客户端
 * ------------------------------------------------------------
 *  这个文件只负责「发起请求并返回数据」，不存任何 UI 状态。
 *  所有方法都是 async / promise，可以直接 await。
 *
 *  路由拓扑（注意 LightRAG 在 docker 内每个工作区一个端口）：
 *   - LightRAG Server : http://127.0.0.1:9621 ~ 9627
 *       · /query           非流式（一次性）问答
 *       · /query/stream    流式问答（NDJSON）
 *       · /query/data      只检索不生成（拿到 entities/relationships/chunks）
 *   - Qdrant           : http://localhost:6333（按 chunk id 取原文段落）
 *   - webviz 静态原文  : /kb/<ws>/__parsed__/<文件名>
 *
 *  溯源链路：
 *   回答中的 [n]  → /query 的 references[n-1].file_path（文件名）
 *                → /query/data 的 chunks[reference_id].content（段落）
 *                → /kb/<ws>/__parsed__/<file_path>（完整原文）
 *   实体/关系     → source_id（= 内嵌 chunk id）→ Qdrant 拿段落
 *                → file_path                       → /kb 拿全文
 *
 *  使用：
 *   import { streamRag, queryData, openOriginal } from '../api/lightrag.js';
 *   const ans = await streamRag(ws, q, opt, (delta, full) => { ... });
 *
 * ============================================================ */

// 工作区 → LightRAG 实例端口
const PORT_BY_WS = {
  g00_master_all: 9621,
  g01_people_literature: 9622,
  g02_places_routes: 9623,
  g03_varieties: 9624,
  g04_history_institutions: 9625,
  g05_lingnan_liwan: 9626,
  g06_industry_tech: 9627
};

const LIGHTRAG_HOST = 'http://127.0.0.1';
const QDRANT_HOST = 'http://localhost:6333';
const CHUNK_COLLECTION = 'lightrag_vdb_chunks_baai_bge_m3_1024d';

// 数据源中多个来源的分隔符（LightRAG 约定）
export const SEP = '<SEP>';

export function portOf(ws) {
  return PORT_BY_WS[ws] || 9621;
}

async function postJson(url, body, timeoutMs) {
  const ctrl = timeoutMs ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined
    });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 调用 /query：返回 LLM 生成的回答（含 [n] 引用）及其 references */
export async function queryRag(ws, query, opts = {}) {
  const body = {
    query,
    mode: opts.mode || 'mix',
    include_references: true,
    response_type: opts.responseType || '请用中文作答，分小节阐述并保留关键原文与论据',
    top_k: opts.topK != null ? opts.topK : 10,
    chunk_top_k: opts.chunkTopK != null ? opts.chunkTopK : 5
  };
  const d = await postJson(LIGHTRAG_HOST + ':' + portOf(ws) + '/query', body, opts.timeoutMs || 240000);
  return {
    response: d.response || '',
    references: d.references || [],
    responseTime: d.response_time
  };
}

/**
 * 流式调用 /query/stream：每次拿到一段 token 就回调 onToken(delta, full)。
 * 最终返回 references（首行事件里携带）与累计的完整回答。
 * 注意：LightRAG 流式响应是 NDJSON（每行一个 JSON 对象），而非 SSE 的 data: 前缀。
 *   默认顺序：先发 { "references": [...] }，随后逐条发 { "response": "<delta>" }。
 */
export async function streamRag(ws, query, opts = {}, onToken) {
  // 明确输出风格 + 防幻觉约束：开门见山、内联 [n] 引用、不输出思考过程、不追加 References 列表，
  //   并且仅依据检索资料「整理排版」，忠实原文事实，严禁编造 / 上网 / 凭空补充内容。
  //   注意：LightRAG Pydantic 限制 MAX_RESPONSE_TYPE_CHARS=256，所以这里必须 <=256 字符。
  const responseType = opts.responseType || (
    '中文直接回答。仅依据所给检索资料整理输出，忠实原文事实，' +
    '严禁编造、严禁上网或凭空补充内容；开门见山，分点论据；' +
    '引用用行内[1][2]，禁止REFxx；不输出思考块、不写开场白；文末不要References清单。'
  );
  if (responseType.length > 256) throw new Error('response_type 超过 256 字符上限，请精简');
  const body = {
    query,
    mode: opts.mode || 'mix',
    include_references: true,
    // 让参考文献携带原文段落 content，供「鼠标指着引用即显示 chunk」的悬浮气泡使用
    include_chunk_content: true,
    response_type: responseType,
    top_k: opts.topK != null ? opts.topK : 10,
    chunk_top_k: opts.chunkTopK != null ? opts.chunkTopK : 5
  };
  const url = LIGHTRAG_HOST + ':' + portOf(ws) + '/query/stream';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok || !res.body) throw new Error('HTTP ' + res.status + ' ' + res.statusText);
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let full = '';
  let references = [];
  let responseTime = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    // NDJSON：每行一个 JSON 对象，以单个 \n 结尾；逐行解析
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let obj;
      try { obj = JSON.parse(line); } catch (e) { continue; }
      if (obj.error) throw new Error(obj.error);
      if (Array.isArray(obj.references)) references = obj.references;
      if (typeof obj.response === 'string') {
        full += obj.response;
        if (onToken) onToken(obj.response, full);
      }
      if (obj.response_time != null) responseTime = obj.response_time;
    }
  }
  return { response: full, references, responseTime };
}

/** 调用 /query/data：纯检索（无 LLM 生成），返回实体/关系/原文段落/引用 */
export async function queryData(ws, query, opts = {}) {
  const body = {
    query,
    mode: opts.mode || 'mix',
    top_k: opts.topK != null ? opts.topK : 10,
    chunk_top_k: opts.chunkTopK != null ? opts.chunkTopK : 5
  };
  const d = await postJson(LIGHTRAG_HOST + ':' + portOf(ws) + '/query/data', body, opts.timeoutMs || 120000);
  const data = d.data || {};
  return {
    entities: data.entities || [],
    relationships: data.relationships || [],
    chunks: data.chunks || [],
    references: data.references || [],
    metadata: d.metadata || {}
  };
}

/** 按 chunk id（= source_id）从 Qdrant 取原文段落；需带 workspace 消歧 */
export async function fetchChunk(chunkId, ws) {
  if (!chunkId) return null;
  const body = {
    filter: {
      must: [
        { key: 'id', match: { value: chunkId } },
        { key: 'workspace_id', match: { value: ws } }
      ]
    },
    limit: 5,
    with_payload: true,
    with_vector: false
  };
  const d = await postJson(
    QDRANT_HOST + '/collections/' + CHUNK_COLLECTION + '/points/scroll', body, 20000);
  const pts = (d.result && d.result.points) || [];
  return pts.length ? pts[0].payload : null;
}

/** 由文件名（或含路径的 file_path）拼出「完整原文」的 webviz 静态地址 */
export function kbUrl(ws, filePath) {
  let base = String(filePath || '');
  // 兼容 file_path 可能形如 /app/data/inputs/<ws>/__parsed__/xxx.md 或 <ws>/__parsed__/xxx.md
  base = base.replace(/^.*__parsed__\//, '');
  base = base.replace(/^.*data\/inputs\//, '');
  // 按路径分段编码，保留目录分隔
  const encoded = base.split('/').map(encodeURIComponent).join('/');
  return '/kb/' + ws + '/__parsed__/' + encoded;
}

/** 拆分 LightRAG 的多来源字段（<SEP> 分隔） */
export function splitSep(s) {
  return String(s || '').split(SEP).map(x => x.trim()).filter(Boolean);
}

/* ============================================================
 * 原始资料：把「打开原文」交给浏览器直接打开原文件
 *   - 原始 html/pdf/png/jpg… 已复制到 data/inputs/_origin/（webviz 挂载为 /kb/_origin/）
 *   - data/inputs/_origin_manifest.json 记录「已解析 md 的 basename → 原始文件名」
 *   - html 打开即原网页；pdf/png 由浏览器自带阅读器呈现（不再由前端二次渲染）
 * ============================================================ */
// 浏览器可原生渲染的原始资料类型
const OPENABLE_EXT = ['html', 'htm', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];

let _originManifest = null;

/** 加载原始资料清单（仅一次） */
export function loadOriginManifest() {
  if (_originManifest) return Promise.resolve(_originManifest);
  return fetch('/kb/_origin_manifest.json', { cache: 'no-cache' })
    .then(res => (res.ok ? res.json() : {}))
    .catch(() => ({}))
    .then(m => { _originManifest = m || {}; return _originManifest; });
}

/** 取文件主名（去目录、去扩展名），用于在清单中查原始资料 */
export function baseKey(filePath) {
  let b = String(filePath || '').replace(/\\/g, '/');
  b = b.replace(/^.*__parsed__\//, '').replace(/^.*data\/inputs\//, '');
  b = b.split('/').pop();
  return b.replace(/\.[^./]+$/, '');
}

/** 原始资料在 webviz 上的静态地址；无对应原始文件时返回 '' */
export function originUrl(filePath) {
  const name = _originManifest && _originManifest[baseKey(filePath)];
  return name ? ('/kb/_origin/' + encodeURIComponent(name)) : '';
}

/** 该文件浏览器能否原生打开展示（docx 等不能，需回退） */
export function isBrowserOpenable(filePath) {
  const name = (_originManifest && _originManifest[baseKey(filePath)]) || baseKey(filePath);
  const ext = String(name).split('.').pop().toLowerCase();
  return OPENABLE_EXT.indexOf(ext) >= 0;
}

/**
 * 用浏览器打开原文（按用户偏好：直接给浏览器看，不走前端渲染层）
 *   1) 优先打开 _origin 下的原文件（html 原网页 / pdf / png / jpg …）
 *   2) 否则直接打开 webviz 静态托管的已解析 md（nginx 以 text/plain 返回，
 *      浏览器以纯文本视图显示）——避免 DocView 二次渲染带来的样式走样
 *   3) docx 仍回退 DocView（浏览器无法原生打开）
 */
export async function openOriginal(filePath, ws) {
  if (!filePath) return false;
  await loadOriginManifest();
  // 1) _origin 命中且浏览器可直开 → 打开原始文件
  if (isBrowserOpenable(filePath)) {
    const url = originUrl(filePath);
    if (url) { window.open(url, '_blank', 'noopener'); return true; }
  }
  // 2) docx 直接回退 DocView（浏览器原生打不开）
  const ext = String(filePath).split('.').pop().toLowerCase();
  if (ext === 'docx' || ext === 'doc') return false;
  // 3) 其他（主要是 md）：直接把 kbUrl 给浏览器（text/plain 视图）
  const url = kbUrl(ws || '', filePath);
  if (url) { window.open(url, '_blank', 'noopener'); return true; }
  return false;
}
