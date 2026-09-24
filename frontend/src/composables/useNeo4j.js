/* ============================================================
 * useNeo4j —— 工作区元数据 + 统一 API 客户端
 * ------------------------------------------------------------
 * 业务背景：
 *   本文件是前端「和数据库说话」的统一入口。改版前它直接连 Neo4j
 *   (bolt:// + 密码)，把地址和密码暴露在浏览器 JS 里。现在改为：
 *     - 前端只 fetch 同源 /api/*（由 webviz 的 nginx 反代到后端 api-bridge）
 *     - 数据库地址/密码彻底藏进后端环境变量，前端不再接触任何数据库细节
 *   因此本文件只剩下两类内容：
 *     1) 7 个 workspace 的「展示元数据」（名字/徽标/描述/颜色）—— 无敏感
 *     2) `api` 对象：把后端暴露的只读 REST 端点包装成方便调用的函数
 *
 * 设计要点（给初学者）：
 *   - fetch('/api/...') 返回 Promise，我们统一 await 后再取 .json()。
 *   - 每个函数都接收 workspace id（ws）或节点参数，拼成 query string。
 *   - 后端返回的都是「已序列化的普通 JSON」，前端直接可用，无需 neo4j 类型转换。
 *
 * 涉及 Vue 概念：
 *   - 本文件没有 ref/reactive（都是纯函数 + 常量），供 <script setup> import 使用。
 * ============================================================ */

/* ============================================================
 * 7 个工作区展示元数据（顺序即导航页/下拉框顺序）
 * ------------------------------------------------------------
 * 字段含义：
 *   id, name, badge, desc, color —— 见 GraphView 等处的解释（图例、徽标、卡片配色）
 * ============================================================ */
export const WS_META = [
  { id: 'g00_master_all',          name: '总图谱',     badge: '总',
    desc: '全部内容合在一起的大图，人物、地点、故事都连起来了',     color: '#ffd257' },
  { id: 'g01_people_literature',   name: '人物与文献', badge: '人',
    desc: '杨贵妃、杜牧、苏轼等人物，和他们写下的诗文与故事',     color: '#4fa3ff' },
  { id: 'g02_places_routes',       name: '地点与交通', badge: '路',
    desc: '荔枝从哪里来，又走哪条路送进长安',                       color: '#3ecf6a' },
  { id: 'g03_varieties',           name: '荔枝品种',   badge: '荔',
    desc: '妃子笑、挂绿、糯米糍……各种荔枝的特点和来历',             color: '#ff7eb6' },
  { id: 'g04_history_institutions',name: '历史与制度', badge: '史',
    desc: '古时候给皇帝进贡荔枝的规矩和有名的故事',                 color: '#b28dff' },
  { id: 'g05_lingnan_liwan',      name: '岭南文化与荔湾', badge: '岭',
    desc: '荔枝湾的传说、广州的老地名和岭南文化',                   color: '#ff9f43' },
  { id: 'g06_industry_tech',       name: '现代产业与科技', badge: '产',
    desc: '今天荔枝怎么种、怎么保鲜、怎么卖到全世界',               color: '#4dd0c4' }
];

/** wsMeta(id) —— 按 id 查上面的「展示元数据」，找不到时返回兜底对象 */
export function wsMeta(id) {
  // Array.find 找到第一个匹配项；找不到走 || 右侧兜底
  return WS_META.find(m => m.id === id)
    || { id, name: id, badge: '图', desc: '', color: '#4fa3ff' };
}

/* ============================================================
 * 统一 API 客户端
 * ------------------------------------------------------------
 * 后端为 scripts/api_bridge（FastAPI），只读，路由见 main.py。
 * 这里把每个端点包成一个函数，前端组件 `import { api } from ...` 后即可调用。
 * 地址统一走相对路径 `/api/...`，生产由 nginx 反代到 api-bridge(9630)。
 * ============================================================ */
export const api = {
  /**
   * counts() —— 每个 workspace 的节点数/关系数（首页三连数字）
   * @returns {Promise<{nodes: Object, rels: Object}>}
   */
  async counts() {
    return (await fetch('/api/counts')).json();
  },

  /**
   * types(ws) —— 某 workspace 的 entity_type 列表（图例勾选项）
   * @param {string} ws workspace id
   * @returns {Promise<string[]>}
   */
  async types(ws) {
    const d = await (await fetch('/api/types?ws=' + encodeURIComponent(ws))).json();
    return d.types || [];
  },

  /**
   * graph(ws, opt) —— 全图「核心节点 + 关系」（度数降序取前 N）
   * @param {string} ws workspace id
   * @param {{limit?:number, types?:string[]}} opt 可选：上限与类型白名单
   * @returns {Promise<{nodes:[], edges:[], centerIds:[]}>}
   */
  async graph(ws, { limit = 300, types = [] } = {}) {
    const q = buildQs({ ws, limit, types });
    return (await fetch('/api/graph' + q)).json();
  },

  /**
   * search(ws, kw, opt) —— 按名称搜索中心节点 + k 跳展开
   * @param {string} ws workspace id
   * @param {string} kw 名称子串
   * @param {{hops?:number, cap?:number, types?:string[]}} opt
   */
  async search(ws, kw, { hops = 1, cap = 300, types = [] } = {}) {
    const q = buildQs({ ws, kw, hops, cap, types });
    return (await fetch('/api/search' + q)).json();
  },

  /**
   * expand(ws, id, opt) —— 以某节点 ID 为中心 k 跳展开
   * @param {string} ws workspace id
   * @param {number} id 节点 id（Neo4j 内部 id）
   * @param {{hops?:number, types?:string[]}} opt
   */
  async expand(ws, id, { hops = 1, types = [] } = {}) {
    const q = buildQs({ ws, id, hops, types });
    return (await fetch('/api/expand' + q)).json();
  },

  /**
   * node(ws, name) —— 单节点属性（右侧详情面板）
   * @param {string} ws workspace id
   * @param {string} name 实体名（entity_id）
   * @returns {Promise<{props: Object}>}
   */
  async node(ws, name) {
    const q = buildQs({ ws, name });
    return (await fetch('/api/node' + q)).json();
  },

  /**
   * chunk(id, ws) —— 从 Qdrant 取原文片段（后端代理）
   * @param {string} id chunk id
   * @param {string} ws workspace id（用于消歧）
   * @returns {Promise<{payload: Object|null}>}
   */
  async chunk(id, ws) {
    const q = buildQs({ id, ws });
    return (await fetch('/api/chunk' + q)).json();
  }
};

/**
 * buildQs(params) —— 把对象拼成 URL query string（?a=1&b=2）。
 * 跳过 null/undefined/空串；数组会用逗号连接（与后端 _parse_types 对应）。
 * @param {Object} params
 * @returns {string} 以 '?' 开头的 query 或 ''
 */
function buildQs(params) {
  const parts = [];
  Object.entries(params).forEach(([k, v]) => {
    if (v === null || v === undefined || v === '') return;
    let val = v;
    if (Array.isArray(v)) {
      if (!v.length) return;          // 空数组 = 不过滤，不用传
      val = v.join(',');
    }
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(val));
  });
  return parts.length ? '?' + parts.join('&') : '';
}
