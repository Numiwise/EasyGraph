/* ============================================================
 * Neo4j 数据访问层（前端唯一后端依赖：浏览器直连 bolt）
 * 职责：连接管理、工作区元数据、各工作区节点计数
 * 说明：前端读取的是「展示版」实例 neo4j-display（已做过
 *   类型白名单删减 + 孤立点/碎片清理 + 2-core 修剪 + 同义合并），
 *   与 LightRAG 写入的完整版实例（7687）相互隔离。
 *
 * Vue 3 工程化变更（原 UMD `neo4j` 全局 → ESM 命名导入）：
 *   - import neo4j from 'neo4j-driver'   ← 默认导出 Driver 工厂
 *   - neo4j.driver / neo4j.auth.basic / neo4j.int   全部以命名属性访问
 *   - 与原 global `neo4j` 对象用法一致
 * ============================================================ */
import neo4j from 'neo4j-driver';

const NEO4J_URI = 'bolt://localhost:7688';
const NEO4J_AUTH = { user: 'neo4j', password: 'LightRAG2026neo4j' };

// 七个图谱的展示元数据（顺序即导航页顺序）
// badge：首页卡片与图谱页导航栏用的单字徽标
export const WS_META = [
  {
    id: 'g00_master_all', name: '总图谱', badge: '总',
    desc: '全部内容合在一起的大图，人物、地点、故事都连起来了',
    color: '#ffd257'
  },
  {
    id: 'g01_people_literature', name: '人物与文献', badge: '人',
    desc: '杨贵妃、杜牧、苏轼等人物，和他们写下的诗文与故事',
    color: '#4fa3ff'
  },
  {
    id: 'g02_places_routes', name: '地点与交通', badge: '路',
    desc: '荔枝从哪里来，又走哪条路送进长安',
    color: '#3ecf6a'
  },
  {
    id: 'g03_varieties', name: '荔枝品种', badge: '荔',
    desc: '妃子笑、挂绿、糯米糍……各种荔枝的特点和来历',
    color: '#ff7eb6'
  },
  {
    id: 'g04_history_institutions', name: '历史与制度', badge: '史',
    desc: '古时候给皇帝进贡荔枝的规矩和有名的故事',
    color: '#b28dff'
  },
  {
    id: 'g05_lingnan_liwan', name: '岭南文化与荔湾', badge: '岭',
    desc: '荔枝湾的传说、广州的老地名和岭南文化',
    color: '#ff9f43'
  },
  {
    id: 'g06_industry_tech', name: '现代产业与科技', badge: '产',
    desc: '今天荔枝怎么种、怎么保鲜、怎么卖到全世界',
    color: '#4dd0c4'
  }
];

/** 按工作区 id 取元数据 */
export function wsMeta(id) {
  return WS_META.find(m => m.id === id) || { id, name: id, badge: '图', desc: '', color: '#4fa3ff' };
}

let _driver = null;

/** 获取 Neo4j 连接（单例） */
export function getDriver() {
  if (!_driver) {
    _driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_AUTH.user, NEO4J_AUTH.password));
  }
  return _driver;
}

/** 列出各工作区标签的节点数与关系数（导航页统计用） */
export async function listWorkspaceCounts() {
  const session = getDriver().session({ database: 'neo4j' });
  try {
    const res = await session.run('CALL db.labels() YIELD label RETURN label ORDER BY label');
    const labels = res.records.map(r => r.get('label')).filter(l => /^g\d{2}_/.test(l));
    const nodes = {}, rels = {};
    for (const l of labels) {
      const c = await session.run(
        'MATCH (n:`' + l + '`) RETURN count(n) AS c');
      nodes[l] = c.records[0].get('c').toNumber();
      const r = await session.run(
        'MATCH (a:`' + l + '`)-[x]-(b:`' + l + '`) RETURN count(x) AS c');
      rels[l] = r.records[0].get('c').toNumber();
    }
    return { nodes, rels };
  } finally { await session.close(); }
}
