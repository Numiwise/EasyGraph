/* ============================================================
 * useLightragApi —— 与 LightRAG 后端、Qdrant 向量库、kb 静态目录交互的 HTTP 客户端
 * ------------------------------------------------------------
 * 文件作用：
 *   这是整个前端"和后端说话"的统一出口。视图组件不直接写 fetch，
 *   而是调用本文件导出的函数，便于：
 *     1) 统一处理基地址（端口随 workspace 变化）。
 *     2) 统一处理流式 NDJSON 解析、错误抛出。
 *     3) 同一份代码在多个 view 中复用（HomeView/GraphView/QueryView...）。
 *
 * 对外暴露的函数（按场景分组）：
 *
 *   【问答】
 *     - streamRag(ws, q, opt, onToken)   流式问答（按 token 一段一段回调）
 *     - queryData(ws, q, opt)           仅检索（拿到实体 / 关系 / chunks）
 *
 *   【原文回查】
 *     - fetchChunk(chunkId, ws)          从 Qdrant 取原文段落
 *     - kbUrl(ws, filePath)              webviz 静态原文 URL
 *     - openOriginal(filePath, ws)       浏览器直接打开原文（含 _origin 优先）
 *     - loadOriginManifest()             读取 _origin_manifest.json
 *     - isBrowserOpenable(filePath)      判断扩展名浏览器是否能直开
 *
 *   【小工具】
 *     - splitSep(s)                      按 LightRAG 约定的 <SEP> 切多来源字符串
 *     - baseKey(filePath)                提取文件名主干（去前缀 + 去扩展名）
 *
 * ============================================================ */

// 从 utils/lightrag-config.js 引入两个工具常量：
//   SEP    —— LightRAG 给多来源字符串用的分隔符（默认 "<SEP>"）
//   portOf —— 接收 workspace 名（如 "g00_master_all"），返回对应的后端端口号
//            因为这个项目同时跑多个 workspace，每个 workspace 一个端口（见 nginx）。
import { SEP, portOf } from '../utils/lightrag-config.js';

// 从 composables/useNeo4j.js 引入 api 客户端（封装对后端 /api/* 的调用）。
// 这里仅用它的 chunk() 去取原文段落 —— 由后端 api-bridge 代理 Qdrant，前端不再直连。
import { api } from './useNeo4j.js';

/**
 * isPublic() —— 判断前端当前是"直连模式"还是"公网反代模式"。
 *   - 公网反代模式：当前 host 不是 127.0.0.1 / localhost（同源路径反代）
 *   - 直连模式：本机开发，浏览器和 lightrag 实例在同一台机器
 *
 * 公网反代下，所有 lightrag 实例的 9621-9627 端口都暴露不出去（容器内 127.0.0.1 绑），
 * 只能通过 nginx 反代到 /lightrag/<ws>/ 路径访问。
 */
export function isPublic() {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return !(h === '127.0.0.1' || h === 'localhost' || h === '0.0.0.0');
}

/** 根据 ws + 是否公网环境，返回对应的 lightrag API base。 */
export function lrBaseFor(ws) {
  return isPublic() ? ('/lightrag/' + ws + '/') : ('http://127.0.0.1:' + portOf(ws) + '/');
}

/* ====== 工作区 → LightRAG 实例端口（集中配置） ======
 * 端口映射统一在 utils/lightrag-config.js 里维护（portOf(ws)）。
 * 这样改动端口只需要改一个地方。*/


/**
 * 函数：streamRag(ws, query, opts, onToken) → {response, references, responseTime}
 * ------------------------------------------------------------
 * 流式问答。每次后端推一段新的文字到前端，就调用 onToken(delta, full) 回调，
 * 让 UI 可以做到"打字机效果"一边生成一边显示。
 *
 * 协议说明（重要！很多人会踩坑）：
 *   LightRAG 的流式响应是 NDJSON（每行一个 JSON 对象），换行 \n 分割，
 *   而不是浏览器 EventSource 那种 data: 前缀的 SSE。
 *   任何一行 JSON 都可能长这样：
 *     {"response":"今天","references":[...]}                ← 流中间，含部分回答、引用
 *     {"response":null,"references":[...]}                  ← 仅携带引用，无新内容
 *     {"response":"\n\n...","response_time":2.3}            ← 流末尾，附耗时
 *
 * 参数：
 *   ws/query/opts —— 同 queryData（ws 是 workspace，query 是问题，opts 包含 mode/topK 等）
 *   onToken(delta, full) —— 回调，delta 是本段新增，full 是到目前累计全文
 *
 * 返回：{ response: 全文, references: [], responseTime }
 */
export async function streamRag(ws, query, opts = {}, onToken) {
  // response_type 是给 LLM 的"风格"指令。后端 Pydantic 模型规定该字段 <= 256 字符，
  // 太长会触发 422 校验失败，所以这里先校验一下再发请求。
  // 重要：必须显式禁止英文 / 禁止 References 区块，否则 lightrag 默认 prompt 会触发英文回复 + 末尾 References 列表。
  const responseType = opts.responseType || (
    '必须用中文回答。仅依据所给检索资料整理输出，忠实原文事实，' +
    '严禁编造、严禁上网或凭空补充内容；开门见山，分点论据；' +
    '引用用行内[1][2]，禁止REFxx；不输出思考块、不写开场白、不写英文；' +
    '文末不要References清单，禁止任何参考列表小标题。'
  );
  if (responseType.length > 256) throw new Error('response_type 超过 256 字符上限，请精简');

  // user_prompt 完全覆盖 lightrag 默认 system prompt，强制中文 + 行内引用 + 禁 References
  const userPrompt = opts.userPrompt || (
    '你是知识图谱问答助理。' +
    '严格使用中文回答。仅依据下方"Context"中的检索资料回答问题，不编造、不上网、不补充外部知识。' +
    '输出格式：开门见山，分点论述，关键事实后用行内[1][2]标注引用。' +
    '禁止输出：英文内容、思考块、欢迎语、"好的"等开场白、' +
    '任何"References"/"参考"小标题列表、"REFxx"格式引用。'
  );

  // 拼装请求体。和 queryData 几乎一样，多了一个 include_chunk_content: true，
  // 让 chunks 里附带原文（方便前端做"引用段落"展开）。
  const body = {
    query,
    mode: opts.mode || 'mix',
    include_references: true,
    include_chunk_content: true,
    response_type: responseType,
    user_prompt: userPrompt,
    top_k: opts.topK != null ? opts.topK : 10,
    chunk_top_k: opts.chunkTopK != null ? opts.chunkTopK : 5
  };

  // 发起流式 POST。注意后端路径是 /query/stream，比非流式多了 /stream。
  // 同源走 /lightrag/<ws>/，由云端 nginx 反代到 lightrag 实例；
  // 开发环境（127.0.0.1 直连）走原始端口。
  const lrBase = lrBaseFor(ws);
  const res = await fetch(lrBase + 'query/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  // 没有 body 时（例如网络中断）直接抛错
  if (!res.ok || !res.body) throw new Error('HTTP ' + res.status + ' ' + res.statusText);

  // ============================================================
  // 下面是手动解析流式响应（不让浏览器自动按 JSON 反序列化，
  // 因为我们想拿到一段一段的增量做实时刷新）。
  // ============================================================
  // res.body.getReader()：拿到一个 reader，可以一段一段读 Uint8Array。
  const reader = res.body.getReader();
  // TextDecoder：把字节（Uint8Array）解码成 UTF-8 字符串。stream: true 表示
  // 跨多次调用维护状态，避免多字节字符（比如中文）被错误切断。
  const decoder = new TextDecoder('utf-8');
  let buf = '';        // 半行缓冲：可能收到一半的 JSON，等补全再解析
  let full = '';       // 已经累积的完整回答
  let references = []; // 引用列表，NDJSON 中可能分多次推送
  let responseTime = null; // 后端给出的耗时

  // 无限循环读取，直到流关闭（reader.read 返回 { done: true }）。
  while (true) {
    const { value, done } = await reader.read();
    if (done) break; // 流结束，退出循环
    // 把这一段字节追加到 buf，注意 stream:true 让 decoder 知道可能多字节字符被切到下一段
    buf += decoder.decode(value, { stream: true });

    // 一行一行处理（换行 \n 分割）。
    // 内层 while 处理"可能一次性到了多行"的场景，buf.indexOf('\n') 可能连续多次命中。
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim(); // 取出这一行
      buf = buf.slice(nl + 1);              // 剩下部分继续等下次解析
      if (!line) continue;                   // 空行跳过

      // 把这一行解析成 JSON。如果失败（半行、异常行）就跳过，继续处理下一行。
      let obj;
      try { obj = JSON.parse(line); } catch (e) { continue; }

      // 后端推送的 error 字段：表示生成失败，要主动抛出中断
      if (obj.error) throw new Error(obj.error);

      // 后端推送引用数组（一次或多次都行，直接覆盖/合并到 references）
      if (Array.isArray(obj.references)) references = obj.references;

      // 后端推送新的回答片段
      if (typeof obj.response === 'string') {
        full += obj.response;                         // 累积到全文
        if (onToken) onToken(obj.response, full);     // 通知 UI 渲染
      }

      // 后端推送耗时
      if (obj.response_time != null) responseTime = obj.response_time;
    }
  }
  // 流关闭，把整理好的数据 return 给调用者
  return { response: full, references, responseTime };
}


/* ================================================================
 *  函数：queryData(ws, query, opts) → 检索结果（不调 LLM 生成）
 * ------------------------------------------------------------
 *  用途：仅做"知识库检索"，不调用 LLM 生成自然语言回答。
 *        前端的图谱视图会用这个接口：先检索回实体 / 关系 / chunks，
 *        然后在前端画图谱，而不需要等 LLM 把它们"复述"成文字。
 *
 *  opts.signal —— 可选的 AbortController.signal，用于上层"取消请求"。
 *  返回：{ entities, relationships, chunks, references, metadata }
 * ================================================================ */
export async function queryData(ws, query, opts = {}) {
  const body = {
    query,
    mode: opts.mode || 'mix',
    top_k: opts.topK != null ? opts.topK : 10,
    chunk_top_k: opts.chunkTopK != null ? opts.chunkTopK : 5
  };
  const res = await fetch(lrBase + 'query/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // signal 可以让 fetch 在外部触发 abort() 时直接中断请求（用于组件卸载等场景）
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


/* ================================================================
 *  原文段落（chunk）取回
 * ------------------------------------------------------------
 *  LightRAG 把"原文段落（chunk）"向量化后存进 Qdrant。改版前前端直接连 Qdrant(6333)
 *  取数据；现在统一走后端 api-bridge 的 /api/chunk（由后端代理 Qdrant），
 *  前端不再暴露任何数据库地址/端口。这里只是把后端返回包一层，保持原调用签名。
 * ================================================================ */

/**
 * fetchChunk(chunkId, ws) —— 按 chunk 主键 + workspace 消歧，取一条 chunk 完整 payload。
 *  实际请求交给后端 api-bridge（它去 Qdrant 查），前端只 fetch 同源 /api/chunk。
 *
 * @param {string} chunkId chunk 主键
 * @param {string} ws workspace id（用于消歧）
 * @returns {Promise<Object|null>} payload（含 content/workspace_id/full_doc_id 等）或 null
 */
export async function fetchChunk(chunkId, ws) {
  if (!chunkId) return null;
  // 调用 api.chunk（见 useNeo4j.js），它内部 fetch('/api/chunk?id=..&ws=..')
  const d = await api.chunk(chunkId, ws);
  // 后端返回 { payload } 或 { payload: null }；没有内容时返回 null
  return (d && d.payload) ? d.payload : null;
}


/* ================================================================
 *  kb 静态原文目录相关
 * ------------------------------------------------------------
 *  LightRAG 把转写好的 Markdown 等文件挂到前端服务的 /kb/<ws>/__parsed__/ 下。
 *  原始网页/扫描件放在 /kb/_origin/ 下，由一份 _origin_manifest.json 索引。
 * ================================================================ */

/**
 * kbUrl(ws, filePath) —— 拼出"webviz 转写版文件"的前端可访问 URL
 *
 * 入参 filePath 通常形如：
 *   "e:\\...\\data\\inputs\\g00_master_all\\__parsed__\\01a-...md"
 *   或：".../data/inputs/g00_master_all/__parsed__/01a-...md"
 *
 * 解析思路：把所有前缀（__parsed__/ 或 data/inputs/）之后的路径段拼出来，
 *          然后对每一段做 encodeURIComponent（处理中文、空格、#、? 等）。
 */
export function kbUrl(ws, filePath) {
  let base = String(filePath || '');
  // 删去 __parsed__/ 之前的所有路径
  base = base.replace(/^.*__parsed__\//, '');
  // 兼容旧版没有 __parsed__/、直接是 data/inputs/ 的路径
  base = base.replace(/^.*data\/inputs\//, '');
  // 逐段 URL 编码后用 / 拼接（防止 / 不被编码，路径分隔保持 /）
  const encoded = base.split('/').map(encodeURIComponent).join('/');
  return '/kb/' + ws + '/__parsed__/' + encoded;
}


/**
 * splitSep(s) —— 拆分 LightRAG 的"多来源合并字符串"
 *   LightRAG 在合并多个 chunk 来源时，会用 <SEP> 把每个来源串起来。
 *   比如一个实体"杨贵妃"在多个文档里提到，LightRAG 把这些文档路径拼成：
 *      "/path/a.md<SEP>/path/b.md<SEP>/path/c.md"
 *   这个函数把它拆成数组 ['/path/a.md','/path/b.md','/path/c.md']。
 *   SEP 在 utils/lightrag-config.js 里定义（默认 '<SEP>'）。
 */
export function splitSep(s) {
  return String(s || '').split(SEP).map(x => x.trim()).filter(Boolean);
}


/* ================================================================
 *  Original（原版原始资料）相关
 * ------------------------------------------------------------
 *  LightRAG 的 chunk 默认指向 .md"转写版"，但有时用户更想看 HTML 原网页
 *  或扫描图片。我们在 data/inputs/_origin/ 下保留了"原始资料"，并用
 *  /kb/_origin_manifest.json 做映射。下面这套函数解决：
 *   - 用户点击"查看原文"时该开哪个 URL？
 *   - 文件后缀是浏览器可以直接渲染的吗？
 * ================================================================ */

// 这些扩展名浏览器可以直接打开渲染（无需依赖外部应用）
const OPENABLE_EXT = ['html', 'htm', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];

// 在内存里缓存一次 _origin_manifest，避免每次都 fetch
let _originManifest = null;

/**
 * loadOriginManifest() —— 读取并缓存 /kb/_origin_manifest.json
 * 返回值是形如 { "01a-妃子笑-xxx": "01a-妃子笑-...html", ... } 的对象。
 */
export function loadOriginManifest() {
  // 如果已经加载过，直接返回缓存（包成 Promise.resolve 以匹配返回类型）
  if (_originManifest) return Promise.resolve(_originManifest);
  // 否则去 fetch；任何失败（404/网络）都用 {} 容错（保持调用方不用 try/catch）
  return fetch('/kb/_origin_manifest.json', { cache: 'no-cache' })
    .then(res => (res.ok ? res.json() : {}))
    .catch(() => ({}))
    .then(m => { _originManifest = m || {}; return _originManifest; });
}

/**
 * baseKey(filePath) —— 把任意完整路径提取成"短键名"（用于查 manifest）
 *   /kb/g00_master_all/__parsed__/01a-妃子笑-...md  →  "01a-妃子笑-..."
 *   规则：去掉路径前缀、去掉扩展名。
 */
export function baseKey(filePath) {
  let b = String(filePath || '');
  // 把 windows 反斜杠统一成正斜杠（让正则统一处理）
  b = b.replace(/\\/g, '/');
  b = b.replace(/^.*__parsed__\//, '').replace(/^.*data\/inputs\//, '');
  // split('/').pop() 取最后一段（即"文件名.扩展名"）
  b = b.split('/').pop();
  // 去掉最后一个 .xxx 扩展名
  return b.replace(/\.[^./]+$/, '');
}

/**
 * originUrl(filePath) —— 计算"原始资料"对应的 URL（_origin 命中则返回，否则返回 ''）
 *   注意：必须先调用 loadOriginManifest() 让 _originManifest 缓存生效，
 *         否则永远拿到 ''。
 */
export function originUrl(filePath) {
  const name = _originManifest && _originManifest[baseKey(filePath)];
  return name ? ('/kb/_origin/' + encodeURIComponent(name)) : '';
}

/**
 * isBrowserOpenable(filePath) —— 这个文件浏览器能不能直接打开？
 *   优先用 _origin 命中后的"原始文件名"来判扩展名，否则用 baseKey 自身的扩展名。
 */
export function isBrowserOpenable(filePath) {
  const name = (_originManifest && _originManifest[baseKey(filePath)]) || baseKey(filePath);
  const ext = String(name).split('.').pop().toLowerCase();
  return OPENABLE_EXT.indexOf(ext) >= 0;
}

/**
 * openOriginal(filePath, ws) —— 一站式"打开原文"
 *   业务策略（按优先级）：
 *     1) 先尝试 _origin 命中，且浏览器能直开（HTML/PDF/图片等），就直接打开原始文件。
 *     2) 否则 .docx 等 Office 文件浏览器打不开，返回 false 让上层跳 DocView。
 *     3) 其它情况（主要是 .md）：直接打开 kbUrl() 给浏览器当纯文本看。
 *
 *   返回 true / false 表示"是否成功代为打开新页面"。
 */
export async function openOriginal(filePath, ws) {
  if (!filePath) return false;
  await loadOriginManifest();   // 确保 _originManifest 已就位

  // 1) _origin 命中且扩展名能直开 → 打开原始文件
  if (isBrowserOpenable(filePath)) {
    const url = originUrl(filePath);
    if (url) { window.open(url, '_blank', 'noopener'); return true; }
  }

  // 2) docx / doc 浏览器原生打不开 → 返回 false（上层应跳到 DocView）
  const ext = String(filePath).split('.').pop().toLowerCase();
  if (ext === 'docx' || ext === 'doc') return false;

  // 3) 其他（主要是 md）：打开 webviz 转写版的纯文本视图
  const url = kbUrl(ws || '', filePath);
  if (url) { window.open(url, '_blank', 'noopener'); return true; }
  return false;
}
