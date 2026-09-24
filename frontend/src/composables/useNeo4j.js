/* ============================================================
 * useNeo4j —— Neo4j Bolt 连接 + 工作区元数据 composable
 * ------------------------------------------------------------
 * 文件作用：
 *   知识图谱数据存在 Neo4j 中。本文件解决三件事：
 *     1) 提供一个浏览器端的 Bolt 协议驱动（单例）。
 *     2) 维护 7 个 workspace 的"展示用"元数据（名字/徽标/描述/颜色）。
 *     3) 提供一个轻量的 listWorkspaceCounts() 用于首页统计。
 *
 * 涉及的语法（给初学者）：
 *   - neo4j-driver：Bolt 协议的 JS 客户端。bolt:// 是明文版本，更安全用
 *     bolt+s://（生产推荐）。本项目目前用 bolt://，因为是内网访问。
 *   - shallowRef：Vue 3 的"浅响应"。当我们存的是一个大对象、并不关心
 *     其内部属性的细粒度响应时，用 shallowRef 能省掉递归代理的开销。
 *   - readonly()：把响应式对象转成"只读"，防止组件里赋值破坏共享状态。
 *
 * ============================================================ */

// 从 vue 引入三个工具：
//   readonly  —— 把响应式对象变成只读
//   ref       —— 创建一个响应式"基本类型"包装
//   shallowRef —— 浅响应（不递归地把内部属性变成响应式）
import { readonly, ref, shallowRef } from 'vue';

// neo4j-driver 是 Neo4j 官方的 JS Bolt 客户端。
// 通过 npm/yarn 安装：yarn add neo4j-driver
import neo4j from 'neo4j-driver';

/* ====== 配置（部署时改这里即可，无需改组件） ====== */
// Bolt 协议默认端口 7687，这里因为同一台机器上同时跑知识图谱 7 个 workspace
// 而每个都连同一个 Neo4j 服务，所以用 7688 反代（在 docker-compose / nginx 配置）。
const NEO4J_URI = 'bolt://localhost:7688';
// 这里的用户名/密码是 Neo4j 数据库初始密码，部署到公网前请修改。
const NEO4J_AUTH = { user: 'neo4j', password: 'LightRAG2026neo4j' };

/* ==============================================================
 *  7 个工作区展示元数据（顺序即导航页顺序）
 * ------------------------------------------------------------
 *  说明：本项目的资料按主题切成 6 个子库（g01-g06）加 1 个总库（g00），
 *        每个库是一份独立的 LightRAG workspace，对应 Neo4j 里的一组标签。
 *  字段：
 *    id    —— workspace id（也是 Neo4j 里的节点标签前缀，如 g01_*）
 *    name  —— 中文名（导航标题）
 *    badge —— 角标字符（用来做 logo 头）
 *    desc  —— 一句话简介（首页卡片副标题）
 *    color —— 主题色（决定 WorkspaceBadge 等组件的配色）
 * ============================================================== */
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

/**
 * wsMeta(id) —— 按 id 查上面的"展示元数据"，找不到时返回兜底对象
 * 用法：在 WorkspaceBadge / 卡片标题里读到的就是这个名字、颜色。
 */
export function wsMeta(id) {
  // Array.find 找到第一个匹配的元素；找不到则走 || 的右侧兜底
  return WS_META.find(m => m.id === id)
    || { id, name: id, badge: '图', desc: '', color: '#4fa3ff' };
}

/* ==============================================================
 *  单例 driver
 * ------------------------------------------------------------
 *  Neo4j driver 是重资源（内部维护连接池），所以全应用只创建一次。
 *  通过闭包变量 _driver 保存实例，下面 getDriver() 是惰性初始化。
 * ============================================================== */
let _driver = null;   // 闭包内私有变量，外部模块拿不到

/**
 * getDriver() —— 拿到（或第一次创建后返回）driver 单例
 * 用法：
 *   const session = getDriver().session({ database: 'neo4j' });
 *   await session.run('MATCH (n) RETURN n LIMIT 1');
 *   await session.close();
 */
export function getDriver() {
  if (!_driver) {
    // neo4j.driver(uri, authObj) 创建一个 Bolt 驱动实例
    _driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_AUTH.user, NEO4J_AUTH.password));
  }
  return _driver;
}

/* ==============================================================
 *  listWorkspaceCounts() —— 首页统计每个 workspace 的节点 / 关系数
 * ------------------------------------------------------------
 *  业务流程：
 *    1) 拿所有 label（相当于 Neo4j 的"表名"），过滤出 g00_ / g01_ / ... 开头。
 *    2) 对每个 label 各跑一次 MATCH 数节点 / 关系。
 *    3) 把结果按 label 聚合返回。
 *  注意：Cypher 不能参数化 label 名（这是 Neo4j 故意为之的安全策略），
 *        所以这里用字符串拼接（label 是我们自己控制的字符，可放心）。
 * ============================================================== */
export async function listWorkspaceCounts() {
  // 创建一个 Neo4j 会话，database 默认是 'neo4j'（Neo4j 4+ 支持多库）
  const session = getDriver().session({ database: 'neo4j' });
  try {
    // 1) 拿所有 label 并按名字排序
    const res = await session.run('CALL db.labels() YIELD label RETURN label ORDER BY label');
    // res.records 是 Neo4j Record 数组，用 .get('label') 拿字段
    // 过滤只保留 g\d{2}_ 开头的（即本项目的 7 个 workspace）
    const labels = res.records.map(r => r.get('label')).filter(l => /^g\d{2}_/.test(l));

    // 准备两个对象：nodes[label]=节点数, rels[label]=关系数
    const nodes = {}, rels = {};

    // 2) 对每个 label 跑两条统计查询
    for (const l of labels) {
      // 数节点：Cypher 中 `` 是反引号转义 label 名（必须，因为 label 里有中文）
      const c = await session.run('MATCH (n:`' + l + '`) RETURN count(n) AS c');
      // Neo4j 整数要 .toNumber() 拿到 JS 数字
      nodes[l] = c.records[0].get('c').toNumber();

      // 数关系：[x] 表示任意关系类型，-(a)-[x]-(b) 双向匹配，
      // 这样无论 a→b 还是 b→a 都算一次；count(x) 数关系数量。
      const r = await session.run(
        'MATCH (a:`' + l + '`)-[x]-(b:`' + l + '`) RETURN count(x) AS c');
      rels[l] = r.records[0].get('c').toNumber();
    }
    return { nodes, rels };
  } finally {
    // try/finally 保证无论成功失败都关闭会话，避免连接泄露
    await session.close();
  }
}

/* ==============================================================
 *  Vue 组合式 API 包装
 * ============================================================== */
/**
 * useNeo4j(initialWs) —— 在 <script setup> 里调用
 *  返回：
 *    WS_META —— 只读的工作区元数据数组（首页导航用）
 *    ws      —— 当前 workspace 的 ref（响应式，组件里直接 v-model）
 *    meta    —— 当前 workspace 的元数据 shallowRef（响应式但内部不递归代理）
 *    setWs   —— 切换 workspace 的方法
 *    getDriver / listWorkspaceCounts —— 同上
 *
 * @param {string|null} initialWs 当前工作区 id（用于响应式 wsMeta）
 */
export function useNeo4j(initialWs = null) {
  // ref 创建一个响应式引用（基本类型），之后在组件里用 ws.value 读写
  const ws = ref(initialWs);
  // shallowRef 创建的引用本身是响应式的，但内部的 WS_META 对象的属性变化不会触发更新
  // —— 元数据整体替换即可，性能比 ref 更优。
  const meta = shallowRef(WS_META[0]);

  // 切换 workspace 时更新两个响应式引用
  function setWs(id) {
    ws.value = id;
    meta.value = wsMeta(id);
  }

  return {
    // readonly() 把 WS_META 包成只读对象，组件里赋值会发出警告
    WS_META: readonly(WS_META),
    ws,
    meta,
    setWs,
    getDriver,
    listWorkspaceCounts
  };
}

/**
 * useNeo4jSession(database) —— 直接拿一个短生命周期会话
 * 用法：
 *   const session = useNeo4jSession('g01_people_literature');
 *   await session.run('MATCH (n:`g01_...`) RETURN n LIMIT 1');
 *   await session.close();
 * 注意：调用方负责关闭会话（用 try/finally 包裹）。
 */
export function useNeo4jSession(database = 'neo4j') {
  return getDriver().session({ database });
}
