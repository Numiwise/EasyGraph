/* ============================================================
 * utils/lightrag-config.js —— LightRAG 工作区/端口/分隔符配置
 * ------------------------------------------------------------
 *   集中放端口号和分隔符常量，composables/useLightragApi 引用这里，
 *   方便未来改端口（如加 https 代理）只动一处。
 * ============================================================ */

// 工作区 → LightRAG 实例端口
export const PORT_BY_WS = {
  g00_master_all: 9621,
  g01_people_literature: 9622,
  g02_places_routes: 9623,
  g03_varieties: 9624,
  g04_history_institutions: 9625,
  g05_lingnan_liwan: 9626,
  g06_industry_tech: 9627
};

export function portOf(ws) {
  return PORT_BY_WS[ws] || 9621;
}

// 数据源中多个来源的分隔符（LightRAG 约定）
export const SEP = '<SEP>';
