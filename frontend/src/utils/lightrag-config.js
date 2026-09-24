/* ============================================================
 * utils/lightrag-config.js —— LightRAG 工作区 / 端口 / 分隔符 配置
 * ------------------------------------------------------------
 * 文件作用：
 *   集中放"配置常量"，composables/useLightragApi.js 会从这里
 *   import 这些常量来拼请求 URL。
 *   这样以后端口变了只需要改这一处，不用满项目替换。
 *
 * 关于端口映射：
 *   本项目同时跑 7 个 LightRAG 实例（每个 workspace 一个进程），
 *   每个进程监听一个端口，从 9621 开始递增。这种"端口法"非常适合
 *   在一台机器上用 Nginx 反代多服务。
 * ============================================================ */

// 工作区 → LightRAG 实例端口映射表
//   g00_master_all          → 9621    (总图谱)
//   g01_people_literature   → 9622    (人物与文献)
//   g02_places_routes       → 9623    (地点与交通)
//   g03_varieties           → 9624    (荔枝品种)
//   g04_history_institutions→ 9625    (历史与制度)
//   g05_lingnan_liwan       → 9626    (岭南文化与荔湾)
//   g06_industry_tech       → 9627    (现代产业与科技)
export const PORT_BY_WS = {
  g00_master_all: 9621,
  g01_people_literature: 9622,
  g02_places_routes: 9623,
  g03_varieties: 9624,
  g04_history_institutions: 9625,
  g05_lingnan_liwan: 9626,
  g06_industry_tech: 9627
};

/**
 * portOf(ws) —— 根据 workspace 名查端口号
 *
 * @param {string} ws workspace id（如 'g01_people_literature'）
 * @returns {number} 端口号；找不到时兜底返回 9621（总图谱端口，便于排查）
 *
 * 用法示例（来自 composables/useLightragApi.js）：
 *   fetch('http://127.0.0.1:' + portOf(ws) + '/query', ...)
 *
 * 语法点（初学者）：
 *   - 对象取值：PORT_BY_WS[ws] 等价于 Python 的 PORT_BY_WS.get(ws, 9621)。
 *   - ||       短路或：左边 falsy 时返回右边的兜底值。
 */
export function portOf(ws) {
  return PORT_BY_WS[ws] || 9621;
}

// 数据源中多个来源的分隔符（LightRAG 约定）
// 后端把多个 chunk path 拼起来时，就用 '<SEP>' 隔开，
// 前端要拆分时直接 String.split(SEP)。
// 大写常量 = 业务上固定不变；放这里让"魔法字符串"集中可见。
export const SEP = '<SEP>';
