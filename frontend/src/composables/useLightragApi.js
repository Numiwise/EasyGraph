/* ============================================================
 * useLightragApi() —— LightRAG / Qdrant / kb 静态原文 HTTP 客户端
 * ------------------------------------------------------------
 *   - streamRag(ws, q, opt, onToken)   流式问答（NDJSON）
 *   - queryRag(ws, q, opt)            非流式一次性问答
 *   - queryData(ws, q, opt)           仅检索（拿实体/关系/chunks）
 *   - fetchChunk(chunkId, ws)          从 Qdrant 取原文段落
 *   - kbUrl(ws, filePath)              webviz 静态原文 URL
 *   - splitSep(s)                      多来源分隔（<SEP>）
 *   - openOriginal(filePath, ws)       浏览器打开原文（带 manifest）
 * ============================================================ */
import { SEP, portOf } from '../utils/lightrag-config.js';

/* ====== 工作区 → LightRAG 实例端口（集中配置） ====== */

/* ====== 调用 /query（非流式） ====== */
export async function queryRag(ws, query, opts = {}) {
  const body = {
    query,
    mode: opts.mode || 'mix',
    include_references: true,
    response_type: opts.responseType || '请用中文作答，分小节阐述并保留关键原文与论据',
    top_k: opts.topK != null ? opts.topK : 10,
    chunk_top_k: opts.chunkTopK != null ? opts.chunkTopK : 5
  };
  const res = await fetch('http://127.0.0.1:' + portOf(ws) + '/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);
  const d = await res.json();
  return {
    response: d.response || '',
    references: d.references || [],
    responseTime: d.response_time
  };
}

/**
 * 流式调用 /query/stream：每次拿到一段 token 就回调 onToken(delta, full)。
 * 返回 references（首行事件里携带）与累计的完整回答。
 * LightRAG 流式响应是 NDJSON（每行一个 JSON 对象），而非 SSE 的 data: 前缀。
 */
export async function streamRag(ws, query, opts = {}, onToken) {
  // 防幻觉 / 引用规则约束（≤256 字符，Pydantic MAX_RESPONSE_TYPE_CHARS）
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
    include_chunk_content: true,
    response_type: responseType,
    top_k: opts.topK != null ? opts.topK : 10,
    chunk_top_k: opts.chunkTopK != null ? opts.chunkTopK : 5
  };
  const res = await fetch('http://127.0.0.1:' + portOf(ws) + '/query/stream', {
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

/* ====== 调用 /query/data（仅检索，不生成） ====== */
export async function queryData(ws, query, opts = {}) {
  const body = {
    query,
    mode: opts.mode || 'mix',
    top_k: opts.topK != null ? opts.topK : 10,
    chunk_top_k: opts.chunkTopK != null ? opts.chunkTopK : 5
  };
  const res = await fetch('http://127.0.0.1:' + portOf(ws) + '/query/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: opts.signal
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);
  const d = await res.json();
  const data = d.data || {};
  return {
    entities: data.entities || [],
    relationships: data.relationships || [],
    chunks: data.chunks || [],
    references: data.references || [],
    metadata: d.metadata || {}
  };
}

/* ====== 从 Qdrant 取原文段落（按 chunk id + workspace 消歧） ====== */
const QDRANT_HOST = 'http://localhost:6333';
const CHUNK_COLLECTION = 'lightrag_vdb_chunks_baai_bge_m3_1024d';

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
  const res = await fetch(QDRANT_HOST + '/collections/' + CHUNK_COLLECTION + '/points/scroll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: (typeof AbortController !== 'undefined') ? new AbortController().signal : undefined
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const d = await res.json();
  const pts = (d.result && d.result.points) || [];
  return pts.length ? pts[0].payload : null;
}

/* ====== 静态原文 URL（webviz 容器内的 /kb 目录） ====== */
export function kbUrl(ws, filePath) {
  let base = String(filePath || '');
  base = base.replace(/^.*__parsed__\//, '');
  base = base.replace(/^.*data\/inputs\//, '');
  const encoded = base.split('/').map(encodeURIComponent).join('/');
  return '/kb/' + ws + '/__parsed__/' + encoded;
}

/* ====== 多来源分隔（LightRAG 约定 <SEP>） ====== */
export function splitSep(s) {
  return String(s || '').split(SEP).map(x => x.trim()).filter(Boolean);
}

/* ====== 浏览器直接打开原文（带 _origin manifest 优先） ====== */
const OPENABLE_EXT = ['html', 'htm', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
let _originManifest = null;

export function loadOriginManifest() {
  if (_originManifest) return Promise.resolve(_originManifest);
  return fetch('/kb/_origin_manifest.json', { cache: 'no-cache' })
    .then(res => (res.ok ? res.json() : {}))
    .catch(() => ({}))
    .then(m => { _originManifest = m || {}; return _originManifest; });
}

export function baseKey(filePath) {
  let b = String(filePath || '').replace(/\\/g, '/');
  b = b.replace(/^.*__parsed__\//, '').replace(/^.*data\/inputs\//, '');
  b = b.split('/').pop();
  return b.replace(/\.[^./]+$/, '');
}

export function originUrl(filePath) {
  const name = _originManifest && _originManifest[baseKey(filePath)];
  return name ? ('/kb/_origin/' + encodeURIComponent(name)) : '';
}

export function isBrowserOpenable(filePath) {
  const name = (_originManifest && _originManifest[baseKey(filePath)]) || baseKey(filePath);
  const ext = String(name).split('.').pop().toLowerCase();
  return OPENABLE_EXT.indexOf(ext) >= 0;
}

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

/* ====== Vue 组合式 API ====== */
export function useLightragApi() {
  return {
    queryRag,
    streamRag,
    queryData,
    fetchChunk,
    kbUrl,
    splitSep,
    openOriginal,
    loadOriginManifest,
    isBrowserOpenable
  };
}
