/* ============================================================
 * useNeo4j() —— Neo4j Bolt 连接 + 工作区元数据 composable
 * ------------------------------------------------------------
 *   - driver：单例（浏览器直连 bolt://）
 *   - wsMeta(id) / WS_META：7 个工作区元数据
 *   - listWorkspaceCounts()：导航页统计
 *   - useNeo4jSession(label)：按需创建短生命周期 session
 * ============================================================ */
import { readonly, ref, shallowRef } from 'vue';
import neo4j from 'neo4j-driver';

/* ====== 配置（部署时改这里即可，无需改组件） ====== */
const NEO4J_URI = 'bolt://localhost:7688';
const NEO4J_AUTH = { user: 'neo4j', password: 'LightRAG2026neo4j' };

/* ====== 7 个工作区展示元数据（顺序即导航页顺序） ====== */
export const WS_META = [
  { id: 'g00_master_all', name: '总图谱', badge: '总',
    desc: '全部内容合在一起的大图，人物、地点、故事都连起来了', color: '#ffd257' },
  { id: 'g01_people_literature', name: '人物与文献', badge: '人',
    desc: '杨贵妃、杜牧、苏轼等人物，和他们写下的诗文与故事', color: '#4fa3ff' },
  { id: 'g02_places_routes', name: '地点与交通', badge: '路',
    desc: '荔枝从哪里来，又走哪条路送进长安', color: '#3ecf6a' },
  { id: 'g03_varieties', name: '荔枝品种', badge: '荔',
    desc: '妃子笑、挂绿、糯米糍……各种荔枝的特点和来历', color: '#ff7eb6' },
  { id: 'g04_history_institutions', name: '历史与制度', badge: '史',
    desc: '古时候给皇帝进贡荔枝的规矩和有名的故事', color: '#b28dff' },
  { id: 'g05_lingnan_liwan', name: '岭南文化与荔湾', badge: '岭',
    desc: '荔枝湾的传说、广州的老地名和岭南文化', color: '#ff9f43' },
  { id: 'g06_industry_tech', name: '现代产业与科技', badge: '产',
    desc: '今天荔枝怎么种、怎么保鲜、怎么卖到全世界', color: '#4dd0c4' }
];

export function wsMeta(id) {
  return WS_META.find(m => m.id === id)
    || { id, name: id, badge: '图', desc: '', color: '#4fa3ff' };
}

/* ====== 单例 driver ====== */
let _driver = null;
export function getDriver() {
  if (!_driver) {
    _driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_AUTH.user, NEO4J_AUTH.password));
  }
  return _driver;
}

/* ====== 列表统计 ====== */
export async function listWorkspaceCounts() {
  const session = getDriver().session({ database: 'neo4j' });
  try {
    const res = await session.run('CALL db.labels() YIELD label RETURN label ORDER BY label');
    const labels = res.records.map(r => r.get('label')).filter(l => /^g\d{2}_/.test(l));
    const nodes = {}, rels = {};
    for (const l of labels) {
      const c = await session.run('MATCH (n:`' + l + '`) RETURN count(n) AS c');
      nodes[l] = c.records[0].get('c').toNumber();
      const r = await session.run(
        'MATCH (a:`' + l + '`)-[x]-(b:`' + l + '`) RETURN count(x) AS c');
      rels[l] = r.records[0].get('c').toNumber();
    }
    return { nodes, rels };
  } finally { await session.close(); }
}

/* ====== Vue 组合式 API ====== */
/**
 * @param {string|null} initialWs 当前工作区 id（用于响应式 wsMeta）
 */
export function useNeo4j(initialWs = null) {
  const ws = ref(initialWs);
  const meta = shallowRef(WS_META[0]);
  function setWs(id) {
    ws.value = id;
    meta.value = wsMeta(id);
  }
  return {
    WS_META: readonly(WS_META),
    ws,
    meta,
    setWs,
    getDriver,
    listWorkspaceCounts
  };
}

/**
 * 用法：const session = useNeo4jSession('g01_people_literature')
 *       await session.run('MATCH (n) RETURN n LIMIT 1')
 *       await session.close()
 */
export function useNeo4jSession(database = 'neo4j') {
  return getDriver().session({ database });
}
