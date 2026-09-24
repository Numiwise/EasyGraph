<!--
  GraphView.vue —— 大图谱可视化主页面（路由 /graph/:ws）
  ------------------------------------------------------------
  Vue 3 重构（SFC + Composition API）：
  - 组件级可变状态用 ref（避免 this.）
  - 组件级不可变状态用 const（wsOptions / limitOptions / hopsOptions / RESERVED_KEYS / edgeFontBase）
  - neo4j 全局从 import 替换（neo4j.int 调用保持）
  - vis-network 从 import { DataSet, Network } 起步
  - onMounted / onBeforeUnmount 替代 mounted / beforeUnmount
  - watch(() => route.params.ws) 替代 watch '$route.params.ws'
-->
<template>
  <div class="graph-page">
    <div id="bar">
      <span class="brand">
        <WorkspaceBadge :meta="currentMeta" />
        <span class="title">{{ currentMeta.name }}</span>
      </span>
      <el-button size="small" @click="goHome">‹ 导航</el-button>
      <el-button size="small" type="primary" @click="goQuery">智能问答</el-button>
      <label class="lbl">图谱</label>
      <WorkspaceSelect v-model="ws" width="170px" filter @update:model-value="onWsChange" />
      <label class="lbl">上限</label>
      <el-select v-model="limitNum" @change="reload" style="width:88px">
        <el-option v-for="l in limitOptions" :key="l" :value="l" :label="String(l)"></el-option>
      </el-select>
      <el-input v-model="keyword" placeholder="搜索实体名，回车出子图" style="width:200px"
        @keyup.enter="searchGo" clearable></el-input>
      <label class="lbl">跳数</label>
      <el-select v-model="hops" @change="onHopsChange" style="width:78px">
        <el-option v-for="h in hopsOptions" :key="h" :value="h" :label="h + '跳'"></el-option>
      </el-select>
      <el-button :type="showRel ? 'primary' : 'info'" @click="toggleRel">
        {{ showRel ? '隐藏关系名称' : '显示关系名称' }}
      </el-button>
      <el-button @click="showAll">显示全部</el-button>
      <el-button @click="fitView">适应视图</el-button>
      <span id="status"><span id="dot" :class="{ok: status.ok}"></span>{{ status.text }}</span>
    </div>
    <div id="main">
      <div id="net"></div>
      <div id="side" v-show="side.visible">
        <h3>{{ side.name }}</h3>
        <span class="tag">{{ side.type }}</span>
        <span class="tag" v-if="side.isCenter">展开中心</span>
        <div class="hint">提示：点击图中任一节点，即按当前跳数直接展开其子图</div>

        <!-- 描述（来自 Neo4j properties.description；LightRAG 把朝代/产地等属性也写入此字段） -->
        <div v-if="side.descr" class="descr">
          <div class="section-head" @click="descrOpen = !descrOpen">
            <span class="sh-title">描述</span>
            <span class="sh-tog">{{ descrOpen ? '收起 ▲' : '展开 ▼' }}</span>
          </div>
          <div v-show="descrOpen" class="descr-body">{{ side.descr }}</div>
        </div>

        <!-- 自定义属性表（Neo4j properties 中除保留键外的字段） -->
        <div v-if="side.extraProps && side.extraProps.length" class="attrs">
          <AttrTable
            :rows="side.extraProps"
            :open="attrsOpen"
            @toggle="attrsOpen = !attrsOpen" />
        </div>

        <ChunkPanel
          v-if="side.segs && side.segs.length"
          :src-ids="side.srcIds"
          :file-paths="side.fps"
          :ws="ws"
          @open-original="openOriginalFile" />
        <ChunkPanel
          v-else
          :src-ids="[]"
          :file-paths="[]"
          :ws="ws"
          @open-original="openOriginalFile" />
      </div>
    </div>
    <div id="legend" v-show="typeList.length">
      <TypeLegend
        title="实体类型（勾选筛选，选择会被记住）"
        :type-list="typeList"
        :type-colors="typeColors"
        :selected-types="selectedTypes"
        @toggle="toggleType"
        @select-all="selectAllTypes"
        @select-none="selectNoneTypes" />
    </div>
    <!-- 全屏加载遮罩：取数阶段 + 布局定位阶段都保持，直到图谱真正可见 -->
    <div id="loading" v-show="loading || stabilizing">
      <div class="loading-card">
        <div class="loading-spin"></div>
        <div class="loading-title">{{ loadTitle }}</div>
        <div class="loading-sub">{{ loadSub }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { DataSet, Network } from 'vis-network/standalone/esm/vis-network';
import { getDriver, wsMeta } from '../composables/useNeo4j.js';
import { fetchChunk, splitSep, openOriginal } from '../composables/useLightragApi.js';
import WorkspaceBadge from '../components/WorkspaceBadge.vue';
import WorkspaceSelect from '../components/WorkspaceSelect.vue';
import TypeLegend from '../components/TypeLegend.vue';
import ChunkPanel from '../components/ChunkPanel.vue';
import AttrTable from '../components/AttrTable.vue';

const vis = { DataSet, Network };

/* ===== 颜色（模块级常量） ===== */
// 科技感配色（与 renderGraph / buildGraph 共用 → 图例和节点颜色一致）
const TECH_PALETTE = [
  '#2563eb', '#16a34a', '#ea580c', '#dc2626',
  '#9333ea', '#0891b2', '#65a30d', '#db2777',
  '#ca8a04', '#0d9488', '#4f46e5', '#7c3aed'
];
// 实体类型 → 颜色的统一函数（按 type 字符串 hash 取模分配，确保相邻 type 也分到差异较大的色相）
const _colorAssign = new Map();
function hashStr(s) {
  let h = 0;
  const k = String(s || '');
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function colorFor(t) {
  const key = String(t || '');
  if (!_colorAssign.has(key)) {
    _colorAssign.set(key, TECH_PALETTE[hashStr(key) % TECH_PALETTE.length]);
  }
  return _colorAssign.get(key);
}

/* ===== 组件 props ===== */
const props = defineProps({
  ws0: { type: String, default: '' }
});

/* ===== 路由 ===== */
const route = useRoute();
const router = useRouter();

/* ===== 响应式状态（原 data()） ===== */
const ws = ref(props.ws0 || 'g00_master_all');
const wsOptions = WS_META.map(m => ({ v: m.id, t: m.name }));
const limitNum = ref(300);
const limitOptions = [150, 300, 600, 1000];
const keyword = ref('');
const hops = ref(1);
const hopsOptions = [1, 2, 3, 4, 5];
const status = reactive({ ok: false, text: '未连接' });
const loading = ref(false);
// 数据已取回但 vis-network 仍在做内置布局定位（stabilization）时保持 loading 遮罩，
// 消除「提示消失 → 图谱要几秒才出来」的断裂感。stabilizationIterationsDone 后置 false
const stabilizing = ref(false);
// 选中中心节点的光晕/连线脉冲动画句柄
let _pulseRaf = null;
// 动画期间被改过颜色的边 id（停止动画时还原为"原色"）
let _pulseEdges = [];
const showRel = ref(false);          // 连线上是否显示关系名称
const edgeFontBase = { size: 10, color: '#55637a', face: 'Microsoft YaHei', align: 'middle',
  strokeWidth: 2, strokeColor: '#dbe6f5', background: 'rgba(219,230,245,0.92)' };
const centerId = ref(null);          // 最近一次「以节点为中心展开」的中心节点
// hopsMode: 'all' 显示全图；'sub' 按 center+hops 隐藏
const hopsMode = ref('all');
// 全图邻接表（renderGraph 时存到 _adj）
let _adj = null;
let _allNodeIds = [];
let _allEdgeIds = [];
// vis-network 实例 / DataSet（markRaw 避免 Vue 把它们深度代理）
let driver = null;
let net = null;
let nodesDS = null;
let edgesDS = null;
let _stabTimer = null;
let _selectedId = null;
const typeList = ref([]);
const typeColors = ref({});
const selectedTypes = ref([]);
const side = reactive({ visible: false, id: 0, name: '', type: '', isCenter: false, descr: '',
  props: {}, extraProps: [], srcIds: [], fps: [], rels: [], segs: [] });
// 节点全部 Neo4j 属性键中需要排除显示的「保留键」——留给顶部卡片与原文区
const RESERVED_KEYS = ['entity_id', 'entity_type', 'description', 'source_id', 'file_path',
  'created_at', 'updated_at', 'id'];
// 详情面板各分区的折叠状态：描述/属性可手动折叠，原文片段在 chunks 上单独控制
const descrOpen = ref(true);
const attrsOpen = ref(true);

/* ===== 计算属性 ===== */
const typeFs = computed(() => selectedTypes.value);
const currentMeta = computed(() => wsMeta(ws.value));
// 加载遮罩标题/副文案：取数阶段 vs 布局定位阶段 不同文案，衔接更自然
const loadTitle = computed(() => (loading.value && !stabilizing.value) ? '图谱加载中…' : '正在铺展节点位置…');
const loadSub = computed(() => stabilizing.value
  ? '已取回节点与关系，正在稳定布局（动画定位），请稍候'
  : '正在准备图谱内容，耐心等一下');
// 图例两个批量开关的勾选态
const allSelected = computed(() => typeList.value.length > 0 && selectedTypes.value.length === typeList.value.length);
const noneSelected = computed(() => selectedTypes.value.length === 0);

/* ===== 工具方法 ===== */
function setStatus(ok, text) {
  status.ok = ok;
  status.text = text;
}

/* ===== 路由相关 ===== */
function goHome() { router.push('/'); }
function goQuery() {
  const url = window.location.origin + window.location.pathname +
    '#/query?ws=' + encodeURIComponent(ws.value);
  window.open(url, '_blank');
}
function onWsChange(v) { router.push('/graph/' + v); }   // 下拉切换 = 路由跳转

/* ===== 溯源 ===== */
async function openOriginalFile(fp) {
  if (!fp) return;
  const ok = await openOriginal(fp, ws.value);
  if (!ok) openDoc(fp);
}
function openDoc(fp) {
  if (!fp) return;
  const url = window.location.origin + window.location.pathname +
    '#/doc?ws=' + encodeURIComponent(ws.value) + '&file=' + encodeURIComponent(fp);
  window.open(url, '_blank');
}

/* ===== 节点属性辅助 ===== */
// 把下划线 / 蛇形字段名转成展示名：「entity_type」→「Entity Type」
function prettifyKey(k) {
  return String(k).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
function extractExtraProps(props) {
  const out = [];
  Object.keys(props || {}).forEach(k => {
    if (RESERVED_KEYS.includes(k)) return;
    const v = props[k];
    if (v === null || v === undefined || v === '') return;
    out.push({ key: k, label: prettifyKey(k), value: formatPropValue(v) });
  });
  out.sort((a, b) => a.key.localeCompare(b.key));
  return out;
}
function formatPropValue(v) {
  if (Array.isArray(v)) return v.join('、');
  if (typeof v === 'object') {
    // Neo4j 时空类型 → ISO 字符串；其他对象 → JSON
    try {
      if (v.year || v.month || v.day) {
        const y = v.year && (v.year.low != null ? v.year.low : v.year);
        const m = v.month && (v.month.low != null ? v.month.low : v.month);
        const d = v.day && (v.day.low != null ? v.day.low : v.day);
        const parts = [y, m, d].filter(x => x != null);
        if (parts.length) return parts.join('-');
      }
      return JSON.stringify(v);
    } catch (e) { return String(v); }
  }
  return String(v);
}

// 取原文片段（chunk）并内联到节点信息中：
//   头两个 chunk 默认展开，余下折叠；原文按钮始终可见
async function populateSegs(srcIds, fps) {
  const segs = (srcIds || []).map((s, i) => ({
    srcId: s, file: (fps || [])[i] || '', para: '', loading: true,
    // 默认展开前 2 个，避免一次性堆叠 N 段原文内容互斥打架
    expanded: i < 2
  }));
  side.segs = segs;
  for (let i = 0; i < segs.length; i++) {
    try {
      const pl = await fetchChunk(segs[i].srcId, ws.value);
      segs[i].para = (pl && pl.content) ? pl.content : '';
      if (pl && pl.file_path && !segs[i].file) segs[i].file = pl.file_path;
    } catch (err) {
      segs[i].para = '';
    }
    segs[i].loading = false;
  }
}

/* ===== 工作区 ===== */
async function switchWorkspace() {
  loading.value = true;
  centerId.value = '';
  stopPulse();
  if (_stabTimer) { clearTimeout(_stabTimer); _stabTimer = null; }
  if (net) { try { net.destroy(); } catch (e) {} net = null; nodesDS = null; edgesDS = null; }
  // 页签名称 + 导航栏名称随子图变化
  document.title = currentMeta.value.name + ' · 妃子笑荔枝文化图谱';
  try {
    await loadTypes(ws.value);
    await loadGraph('');
  } finally { loading.value = false; }
}

async function loadTypes(label) {
  const session = driver.session({ database: 'neo4j' });
  try {
    const res = await session.run(
      'MATCH (n:`' + label + '`) RETURN DISTINCT coalesce(n.entity_type, "其他") AS t ORDER BY t');
    typeList.value = res.records.map(r => r.get('t'));
    // 默认全选：进入子图即全部实体类型可见（图例"全选"勾选态）
    selectedTypes.value = typeList.value.slice();
    // 用与节点同源的 colorFor 分配（图例 ↔ 节点颜色一致）
    const colors = {};
    typeList.value.forEach(t => { colors[t] = colorFor(t); });
    typeColors.value = colors;
  } finally { await session.close(); }
}

/* ===== 类型多选筛选 ===== */
function toggleType(t) {
  const i = selectedTypes.value.indexOf(t);
  if (i >= 0) selectedTypes.value.splice(i, 1);
  else selectedTypes.value.push(t);
  applyTypeFilter();
}
function selectAllTypes() {
  selectedTypes.value = typeList.value.slice();
  applyTypeFilter();
}
function selectNoneTypes() {
  selectedTypes.value = [];
  applyTypeFilter();
}
function applyTypeFilter() { refreshVisibility(); }

// 统一可见性：实体类型筛选 AND 跳数隐藏（两者叠加生效）
function refreshVisibility() {
  if (!nodesDS || !edgesDS) return;
  // 1) 跳数可见集合（sub 模式 → BFS；all 模式 → 不做跳数限制）
  let hopKeep = null;
  if (hopsMode.value === 'sub' && centerId.value != null && centerId.value !== '' && _adj) {
    hopKeep = new Set([centerId.value]);
    let frontier = [centerId.value];
    for (let d = 0; d < hops.value && frontier.length; d++) {
      const next = [];
      for (const id of frontier) {
        const ns = _adj[id];
        if (!ns) continue;
        for (const nid of ns) { if (!hopKeep.has(nid)) { hopKeep.add(nid); next.push(nid); } }
      }
      frontier = next;
    }
  }
  // 2) 类型可见集合：勾选了才显示（"全部不选"= 空集合 → 不显示任何类型）
  const visTypes = new Set(selectedTypes.value);
  // 3) 逐节点：目标中心节点豁免类型筛选（选中它看子图时永远不能隐藏）；
  //    其余节点：类型已勾选 且（无跳数限制 或 在跳数集合内）→ 显示
  const nodeUpd = [];
  const visible = new Set();
  nodesDS.forEach(n => {
    const isCenter = (centerId.value != null && n.id === centerId.value);
    const okType = isCenter || visTypes.has(n.group);
    const okHop = !hopKeep || hopKeep.has(n.id);
    const show = okType && okHop;
    if (show) visible.add(n.id);
    if ((n.hidden || false) === show) nodeUpd.push({ id: n.id, hidden: !show });
  });
  if (nodeUpd.length) nodesDS.update(nodeUpd);
  // 4) 边：两端都可见才显示
  const edgeUpd = [];
  edgesDS.forEach(e => {
    const show = visible.has(e.from) && visible.has(e.to);
    if ((e.hidden || false) === show) edgeUpd.push({ id: e.id, hidden: !show });
  });
  if (edgeUpd.length) edgesDS.update(edgeUpd);
}

function applyHopsFilter() { refreshVisibility(); }

/* ===== 工具栏动作 ===== */
function searchGo() { centerId.value = null; loadGraph(keyword.value.trim()); }
function onHopsChange() {
  hopsMode.value = (centerId.value != null && centerId.value !== '') ? 'sub' : 'all';
  applyHopsFilter();
  setStatus(true, hopsMode.value === 'sub'
    ? ('已显示「中心节点」' + hops.value + ' 跳邻居')
    : ('跳数 ' + hops.value + '（点击节点后生效）'));
}
function reload() { loadGraph(keyword.value.trim()); }
function showAll() {
  keyword.value = '';
  centerId.value = '';
  hopsMode.value = 'all';
  refreshVisibility();
  fitView();
}
function fitView() { if (net) net.fit({ animation: true }); }

/* ===== 关系名称显示开关 ===== */
function relLabel(ds) {
  const s = (Array.isArray(ds) ? ds[0] : '') || '';
  return s.length > 16 ? s.slice(0, 16) + '…' : s;
}
function toggleRel() {
  showRel.value = !showRel.value;
  if (!edgesDS || !net) return;
  // 1) 改每条边的 label（数据层）
  edgesDS.update(edgesDS.get().map(e => ({
    id: e.id, label: showRel.value ? relLabel(e.raw) : ''
  })));
  // 2) 改 edges.font.size（渲染层）：size:0 让 vis-network 不再画文字，
  //    仅改 label 字符串在某些版本下不会立刻清掉已渲染的标签缓存。
  const base = edgeFontBase;
  net.setOptions({
    edges: {
      font: showRel.value
        ? { ...base }
        : { ...base, size: 0, strokeWidth: 0, background: 'rgba(0,0,0,0)' }
    }
  });
  // 3) 触发一次画布重绘，确保字号变化立即生效
  net.redraw();
  setStatus(true, showRel.value ? '已显示关系名称' : '已隐藏关系名称');
}

/* ===== 图查询 ===== */
async function loadGraph(searchText) {
  const label = ws.value;
  const limit = limitNum.value;
  loading.value = true;
  const t0 = performance.now();
  try {
    const session = driver.session({ database: 'neo4j' });
    let nodes, edges, centerIds = [];
    try {
      if (searchText) {
        const res = await radialFetch(session, label, searchText, limit, hops.value);
        nodes = res.nodes; edges = res.edges; centerIds = res.centerIds;
      } else {
        centerId.value = null;
        // 全图模式：按度数（连接数）取前 N 个核心节点，天然聚焦大集团、剔除外围游离节点
        // 兼容所有 Neo4j 版本：用 OPTIONAL MATCH 计算度数（不用 count { ... } 这种 5.x 语法）
        //   - 先排除 deg=0/1 的孤立或叶子节点（kcore 删不掉的弱连接）
        //   - 再按度数降序取前 N 个
        const q1 = 'MATCH (n:`' + label + '`) ' +
          'WHERE ($typeFs = [] OR coalesce(n.entity_type,"其他") IN $typeFs) ' +
          'OPTIONAL MATCH (n)-[r]-() ' +
          'WITH n, count(r) AS deg ' +
          'WHERE deg >= 2 ' +
          'ORDER BY deg DESC, n.entity_id ' +
          'LIMIT $limit ' +
          'RETURN id(n) AS id, n.entity_id AS name, coalesce(n.entity_type,"其他") AS type, ' +
          'n.description AS descr, coalesce(n.source_id,"") AS src, coalesce(n.file_path,"") AS fp, ' +
          'properties(n) AS props, deg';
        const r1 = await session.run(q1, { typeFs: typeFs.value, limit: neo4j.int(limit) });
        nodes = r1.records.map(r => ({
          id: r.get('id').toNumber(), name: r.get('name') || '(未命名)',
          type: r.get('type'), descr: r.get('descr') || '',
          src: r.get('src') || '', fp: r.get('fp') || '',
          props: r.get('props') || {}
        }));
        if (nodes.length) {
          const ids = nodes.map(n => n.id);
          const q2 = 'UNWIND $ids AS i ' +
            'MATCH (a)-[r]->(b) WHERE id(a) = i AND id(b) IN $ids ' +
            'WITH id(a) AS s, id(b) AS t, collect(coalesce(r.description, type(r))) AS ds, ' +
            'collect(coalesce(r.keywords,"")) AS kws, ' +
            'collect(coalesce(r.source_id,"")) AS srcs, collect(coalesce(r.file_path,"")) AS fps ' +
            'RETURN s, t, ds, kws, srcs, fps';
          const r2 = await session.run(q2, { ids });
          edges = r2.records.map(r => ({
            s: r.get('s').toNumber(), t: r.get('t').toNumber(), ds: r.get('ds'),
            kws: r.get('kws'), srcs: r.get('srcs'), fps: r.get('fps')
          }));
        } else edges = [];
      }
    } finally { await session.close(); }
    renderGraph(nodes, edges, centerIds);
    const ms = Math.round(performance.now() - t0);
    if (searchText && !nodes.length) {
      setStatus(true, '未找到匹配实体（仅支持名称子串）');
    } else {
      const pre = centerIds.length ? ('中心 ' + centerIds.length + ' · ') : '';
      const tf = selectedTypes.value.length ? ('已筛类型 ' + selectedTypes.value.length + ' 种 · ') : '';
      setStatus(true, tf + pre + '节点 ' + nodes.length + ' · 关系 ' + edges.length + ' · 加载耗时 ' + ms + 'ms');
    }
  } catch (err) {
    console.error(err);
    setStatus(false, '加载失败: ' + (err.message || err));
  } finally { loading.value = false; }
}

// 辐射状 k 跳搜索：中心按名称匹配（不受类型筛选），邻居按类型筛选
async function radialFetch(session, label, kw, cap, hopsVal) {
  const typeFs = typeFs.value;
  const r0 = await session.run(
    'MATCH (n:`' + label + '`) WHERE n.entity_id CONTAINS $kw ' +
    'RETURN id(n) AS id, n.entity_id AS name, coalesce(n.entity_type,"其他") AS type, ' +
    'n.description AS descr, coalesce(n.source_id,"") AS src, coalesce(n.file_path,"") AS fp, ' +
    'properties(n) AS props ' +
    'ORDER BY size(n.entity_id) LIMIT 3', { kw });
  const centers = r0.records.map(r => ({
    id: r.get('id').toNumber(), name: r.get('name') || '(未命名)',
    type: r.get('type'), descr: r.get('descr') || '',
    src: r.get('src') || '', fp: r.get('fp') || '',
    props: r.get('props') || {}
  }));
  if (!centers.length) return { nodes: [], edges: [], centerIds: [] };
  const nodeMap = new Map();
  centers.forEach(n => nodeMap.set(n.id, n));
  const seen = new Set(centers.map(n => n.id));
  const edgeMap = new Map();
  let frontier = centers.map(n => n.id);
  for (let h = 1; h <= hopsVal && frontier.length && seen.size < cap; h++) {
    const r1 = await session.run(
        'MATCH (a)-[r]-(b:`' + label + '`) WHERE id(a) IN $frontier AND NOT id(b) IN $seen ' +
        'AND ($typeFs = [] OR coalesce(b.entity_type,"其他") IN $typeFs) ' +
        'RETURN DISTINCT id(b) AS id, b.entity_id AS name, coalesce(b.entity_type,"其他") AS type, ' +
        'b.description AS descr, coalesce(b.source_id,"") AS src, coalesce(b.file_path,"") AS fp, ' +
        'properties(b) AS props LIMIT $cap',
        { frontier, seen: Array.from(seen), typeFs, cap: neo4j.int(Math.max(cap - seen.size, 1)) });
    const newIds = [];
    r1.records.forEach(rec => {
      const id = rec.get('id').toNumber();
      if (!nodeMap.has(id)) {
        nodeMap.set(id, {
          id, name: rec.get('name') || '(未命名)', type: rec.get('type'),
          descr: rec.get('descr') || '', src: rec.get('src') || '', fp: rec.get('fp') || '',
          props: rec.get('props') || {}
        });
        newIds.push(id);
      }
    });
    newIds.forEach(id => seen.add(id));
    if (newIds.length) {
      const r2 = await session.run(
        'MATCH (a)-[r]->(b) WHERE id(a) IN $seen AND id(b) IN $seen ' +
        'RETURN id(r) AS rid, id(a) AS s, id(b) AS t, coalesce(r.description, type(r)) AS d, ' +
        'coalesce(r.keywords,"") AS kw, coalesce(r.source_id,"") AS src, coalesce(r.file_path,"") AS fp',
        { seen: Array.from(seen) });
      r2.records.forEach(rec => {
        const rid = rec.get('rid').toNumber();
        if (!edgeMap.has(rid)) edgeMap.set(rid, {
          s: rec.get('s').toNumber(), t: rec.get('t').toNumber(), ds: [rec.get('d') || ''],
          kws: [rec.get('kw') || ''], srcs: [rec.get('src') || ''], fps: [rec.get('fp') || '']
        });
      });
    }
    frontier = newIds;
  }
  return { nodes: Array.from(nodeMap.values()), edges: Array.from(edgeMap.values()), centerIds: centers.map(n => n.id) };
}

// 以被点击节点为中心做 k 跳展开（邻居同样吃类型筛选）
async function expandFromNode(nodeId, hopsVal) {
  const label = ws.value;
  loading.value = true;
  const t0 = performance.now();
  try {
    const session = driver.session({ database: 'neo4j' });
    let center = null;
    const nodeMap = new Map();
    const edgeMap = new Map();
    const typeFs = typeFs.value;
    try {
      const rc = await session.run(
        'MATCH (n:`' + label + '`) WHERE id(n)=$id ' +
        'RETURN id(n) AS id, n.entity_id AS name, coalesce(n.entity_type,"其他") AS type, ' +
        'n.description AS descr, coalesce(n.source_id,"") AS src, coalesce(n.file_path,"") AS fp, ' +
        'properties(n) AS props',
        { id: neo4j.int(nodeId) });
      if (!rc.records.length) { setStatus(false, '节点不存在'); return; }
      const rec = rc.records[0];
      center = {
        id: nodeId, name: rec.get('name') || '(未命名)',
        type: rec.get('type'), descr: rec.get('descr') || '',
        src: rec.get('src') || '', fp: rec.get('fp') || '',
        props: rec.get('props') || {}
      };
      nodeMap.set(nodeId, center);
      const seen = new Set([nodeId]);
      let frontier = [nodeId];
      for (let h = 1; h <= hopsVal && frontier.length; h++) {
        const r1 = await session.run(
          'MATCH (a)-[r]-(b) WHERE id(a) IN $frontier AND NOT id(b) IN $seen ' +
          'AND ($typeFs = [] OR coalesce(b.entity_type,"其他") IN $typeFs) ' +
          'RETURN DISTINCT id(b) AS id, b.entity_id AS name, coalesce(b.entity_type,"其他") AS type, ' +
          'b.description AS descr, coalesce(b.source_id,"") AS src, coalesce(b.file_path,"") AS fp, ' +
          'properties(b) AS props',
          { frontier, seen: Array.from(seen), typeFs });
        const newIds = [];
        r1.records.forEach(rec2 => {
          const id = rec2.get('id').toNumber();
          if (!nodeMap.has(id)) {
            nodeMap.set(id, {
              id, name: rec2.get('name') || '(未命名)', type: rec2.get('type'),
              descr: rec2.get('descr') || '', src: rec2.get('src') || '', fp: rec2.get('fp') || '',
              props: rec2.get('props') || {}
            });
            newIds.push(id);
          }
        });
        newIds.forEach(id => seen.add(id));
        if (newIds.length) {
          const r2 = await session.run(
            'MATCH (a)-[r]->(b) WHERE id(a) IN $seen AND id(b) IN $seen ' +
            'RETURN id(r) AS rid, id(a) AS s, id(b) AS t, coalesce(r.description, type(r)) AS d, ' +
            'coalesce(r.keywords,"") AS kw, coalesce(r.source_id,"") AS src, coalesce(r.file_path,"") AS fp',
            { seen: Array.from(seen) });
          r2.records.forEach(rec2 => {
            const rid = rec2.get('rid').toNumber();
            if (!edgeMap.has(rid)) edgeMap.set(rid, {
              s: rec2.get('s').toNumber(), t: rec2.get('t').toNumber(), ds: [rec2.get('d') || ''],
              kws: [rec2.get('kw') || ''], srcs: [rec2.get('src') || ''], fps: [rec2.get('fp') || '']
            });
          });
        }
        frontier = newIds;
      }
    } finally { await session.close(); }
    const nodes = Array.from(nodeMap.values());
    const edges = Array.from(edgeMap.values());
    centerId.value = nodeId;   // 记住中心，类型筛选变化时可复现
    renderGraph(nodes, edges, [nodeId]);
    showNodeSide(nodeId, true);
    if (net) net.focus(nodeId, { scale: 0.8, animation: { duration: 400 } });
    const ms = Math.round(performance.now() - t0);
    const pre = typeFs.length ? ('已筛类型 ' + typeFs.length + ' 种 · ') : '';
    setStatus(true, pre + '以「' + center.name + '」为中心 ' + hopsVal + ' 跳 · 节点 ' +
      nodes.length + ' · 关系 ' + edges.length + ' · 加载耗时 ' + ms + 'ms');
  } catch (err) {
    console.error(err);
    setStatus(false, '展开失败: ' + (err.message || err));
  } finally { loading.value = false; }
}

/* ===== vis-network 渲染（vis 内置布局 + 完全静态） ===== */
function renderGraph(nodes, edges, centerIds) {
  // 数据已就绪 → 进入布局定位阶段：保持 loading 遮罩直到 stabilization 完成
  stabilizing.value = true;
  // 兜底：万一 stabilizationIterationsDone 未触发（极端情况），超时后强制收起遮罩
  if (_stabTimer) clearTimeout(_stabTimer);
  _stabTimer = setTimeout(() => { stabilizing.value = false; }, 10000);
  const deg = {};
  edges.forEach(e => { deg[e.s] = (deg[e.s] || 0) + 1; deg[e.t] = (deg[e.t] || 0) + 1; });
  // 节点大小按度数做"非线性拉伸"（梯度拉大）
  const maxDeg = Math.max(1, ...Object.values(deg));
  const minSize = 8, maxSize = 38;
  nodesDS = new vis.DataSet(nodes.map(n => {
    const d = deg[n.id] || 0;
    const ratio = Math.sqrt(d / maxDeg);
    const sz = minSize + ratio * (maxSize - minSize);
    const isC = centerIds.indexOf(n.id) !== -1;
    return {
      id: n.id, label: (isC ? '★ ' : '') + n.name, group: n.type,
      value: d + 1,
      size: sz,
      font: { size: Math.min(16, 10 + Math.round(ratio * 8)), face: 'Microsoft YaHei' },
      shadow: isC ? { enabled: true, color: '#ffd257', size: 20 } : undefined,
      _origSize: sz,
      _origShadow: isC ? { enabled: true, color: '#ffd257', size: 20 } : undefined,
      _origBorder: 0,
      _origColor: { background: colorFor(n.type || '其他'), border: colorFor(n.type || '其他'),
        highlight: { background: colorFor(n.type || '其他'), border: '#1f6feb' } },
      raw: Object.assign({}, n, { isCenter: isC })
    };
  }));
  edgesDS = new vis.DataSet(edges.map((e, i) => ({
    id: i, from: e.s, to: e.t, title: e.ds.join('\n'),
    label: showRel.value ? relLabel(e.ds) : undefined,
    raw: e.ds, names: e.kws || [], srcs: e.srcs || [], fps: e.fps || []
  })));

  // 科技感配色（少量金属色，不鲜艳不乱）
  const techGroups = {};
  const techTypeList = Array.from(new Set(nodes.map(n => n.type || '其他')));
  techTypeList.forEach(t => { techGroups[t] = { color: colorFor(t) }; });

  const options = {
    groups: techGroups,
    nodes: {
      shape: 'dot',
      scaling: { min: 8, max: 38, label: { enabled: false } },
      font: { color: '#1f2d3d', face: 'Microsoft YaHei' },
      borderWidth: 0,
      shadow: { enabled: false }
      // 不在 options.nodes.color 覆盖 → group 颜色接管
    },
    edges: {
      color: { color: '#94a3b8', highlight: '#1f6feb', hover: '#1f6feb', opacity: 0.7 },
      width: 1.0, hoverWidth: 1.6, selectionWidth: 1.4,
      smooth: { enabled: true, type: 'continuous', roundness: 0.4 }
    },
    // ========== 用 vis-network 内置默认布局（行业最简最好的实践） ==========
    //   - barnesHut 物理引擎：赫尔曼 + 重心引力 + 阻尼
    //   - stabilization iterations 600：算法跑完自动停止（之后节点不动）
    //   - improvedLayout: true：让 vis 内部优化初始排布（避免 randomSeed 随机）
    //   - 跑完后 setOptions 关掉 physics（防止 ghost 圆 + 后续自动重排）
    physics: {
      enabled: true,
      solver: 'barnesHut',
      barnesHut: {
        gravitationalConstant: -2400,
        centralGravity: 0.3,
        springLength: 110,
        springConstant: 0.04,
        damping: 0.5,
        avoidOverlap: 0.5
      },
      stabilization: { enabled: true, iterations: 600, fit: true,
        updateInterval: 50, onlyDynamicEdges: false }
    },
    layout: { improvedLayout: true, randomSeed: 2 },
    // 节点不能拖（仅点击）；view 仍可拖（拖动整个图）+ 缩放
    interaction: { hover: true, tooltipDelay: 150, navigationButtons: true, keyboard: false,
      dragNodes: false, dragView: true, zoomView: true }
  };
  if (!net) {
    net = new vis.Network(document.getElementById('net'),
      { nodes: nodesDS, edges: edgesDS }, options);
    net.on('click', p => onPick(p));
    net.on('doubleClick', p => {
      if (p.nodes.length) net.focus(p.nodes[0], { scale: 1.1 });
    });
    // 在顶层绘制层叠加「选中中心光晕 + 连线脉冲」（浅→深循环）
    net.on('afterDrawing', ctx => drawPulse(ctx));
  } else {
    net.setData({ nodes: nodesDS, edges: edgesDS });
  }

  // 同步把 group 颜色应用到每个节点（确保稳定填充色）
  const colorUpd = [];
  for (const n of nodes) {
    const t = n.type || '其他';
    const c = colorFor(t);
    colorUpd.push({
      id: n.id,
      color: { background: c, border: c, highlight: { background: c, border: '#1f6feb' } }
    });
  }
  nodesDS.update(colorUpd);

  // 保存全图邻接表（用于按跳数隐藏远处节点）
  const adj = {};
  for (const e of edges) {
    if (!adj[e.s]) adj[e.s] = new Set();
    if (!adj[e.t]) adj[e.t] = new Set();
    adj[e.s].add(e.t);
    adj[e.t].add(e.s);
  }
  _adj = adj;
  _allNodeIds = nodes.map(n => n.id);
  _allEdgeIds = edges.map((e, i) => i);
  hopsMode.value = 'all';

  // vis-network 内置 layout 完成（stabilizationIterationsDone）后保留极慢的 physics
  //   弹簧调很弱、阻尼很大 → 节点只在自己周围轻微浮动（不会互相重叠）
  //   用户点击节点 → onPick 中 stopPhysics 关闭 → 完全静止
  net.once('stabilizationIterationsDone', () => {
    if (!net) return;
    // 布局完成 → 收起 loading 遮罩（图谱已经可见，消除断裂感）
    stabilizing.value = false;
    if (_stabTimer) { clearTimeout(_stabTimer); _stabTimer = null; }
    // 切到极慢模式：弱弹簧 + 高阻尼，节点只做微幅摆动
    net.setOptions({
      physics: {
        enabled: true,
        solver: 'barnesHut',
        barnesHut: {
          gravitationalConstant: -400,   // 极弱引力
          centralGravity: 0.005,           // 几乎无中心
          springLength: 240,               // 长弹簧 → 节点之间距离大
          springConstant: 0.005,           // 极弱弹簧 → 飘动极小
          damping: 0.92,                   // 高阻尼 → 减速快
          avoidOverlap: 0.8                // 避免重叠
        },
        stabilization: { enabled: false }
      }
    });
    // 子图（有点击展开节点）：fit 到中心节点
    if (centerId.value != null && centerId.value !== '') {
      try {
        net.focus(centerId.value, { scale: 0.85, locked: false,
          animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
      } catch (e) {}
    }
  });
}

/* ===== 点节点/点边 → 侧栏 ===== */
function onPick(params) {
  // 点击 → 立刻关掉 vis-network physics（节点永久静止，冻结到当前布局）
  if (net && (params.nodes.length || params.edges.length)) {
    net.setOptions({ physics: { enabled: false } });
  }
  // 高亮 + focus 屏幕中央
  if (net) {
    if (params.nodes.length) {
      const id = params.nodes[0];
      centerId.value = id;
      hopsMode.value = 'sub';
      applyHopsFilter();
      const n = nodesDS.get(id);
      if (n) {
        nodesDS.update({
          id,
          size: (n.size || 14) * 1.7,
          shadow: { enabled: true, color: '#fb923c', size: 28 },
          borderWidth: 4,
          color: { background: '#f59e0b', border: '#9a3412', highlight: { background: '#f59e0b', border: '#9a3412' } }
        });
      }
      // 取消之前的选中状态（除当前节点）
      if (_selectedId && _selectedId !== id) {
        const prev = nodesDS.get(_selectedId);
        if (prev) {
          nodesDS.update({
            id: _selectedId,
            size: prev._origSize || prev.size,
            shadow: prev._origShadow,
            borderWidth: prev._origBorder,
            color: prev._origColor
          });
        }
      }
      _selectedId = id;
      net.focus(id, { scale: 1.0, locked: false,
        animation: { duration: 600, easingFunction: 'easeInOutQuad' } });
      startPulse();
    } else if (params.edges.length) {
      // 点边：不需要居中节点
    } else {
      // 点空白：取消选中 + 停止脉冲动画
      if (_selectedId) {
        const prev = nodesDS.get(_selectedId);
        if (prev) nodesDS.update({
          id: _selectedId,
          size: prev._origSize || prev.size,
          shadow: prev._origShadow,
          borderWidth: prev._origBorder,
          color: prev._origColor
        });
        _selectedId = null;
        stopPulse();
      }
      // 冻结视图：刚才的 focus 动画可能还在跑，立刻 moveTo 到当前位置把它定住
      if (net && net.getViewPosition) {
        try {
          const p = net.getViewPosition();
          const sc = net.getScale();
          net.moveTo({ position: p, scale: sc, animation: false });
        } catch (e) {}
      }
    }
  }
  // 点击节点 → 仅移动视图 + 高亮 + 详情（不重新画图）
  if (params.nodes.length) {
    showNodeSide(params.nodes[0], false);
  } else if (params.edges.length) {
    const e = edgesDS.get(params.edges[0]);
    if (!e) return;
    const a = nodesDS.get(e.from), b = nodesDS.get(e.to);
    const edgeSrcIds = splitSep((e.srcs || []).find(x => x) || '');
    const edgeFps = splitSep((e.fps || []).find(x => x) || '');
    side.visible = true;
    side.id = 0;
    side.name = (a ? a.raw.name : '?') + ' → ' + (b ? b.raw.name : '?');
    side.type = (e.names && e.names[0]) || '关系';
    side.isCenter = false;
    side.descr = e.raw.join('\n').replace(/<SEP>/g, '；');
    side.srcIds = edgeSrcIds;
    side.fps = edgeFps;
    side.rels = [];
    side.segs = [];
    populateSegs(edgeSrcIds, edgeFps);
  } else {
    side.visible = false;
  }
}

/* ===== 选中中心节点：从内向外辐射光晕 + 邻边稳定加深 ===== */
function startPulse() {
  stopPulse();   // 先清理旧循环并还原上一中心连线的颜色
  updateEdgeFlash();   // 一次性加深邻边（幂等）
  const loop = () => {
    if (!net || !_selectedId) { _pulseRaf = null; return; }
    try { net.requestRedraw(); } catch (e) {}
    _pulseRaf = requestAnimationFrame(loop);
  };
  _pulseRaf = requestAnimationFrame(loop);
}
function stopPulse() {
  if (_pulseRaf) { cancelAnimationFrame(_pulseRaf); _pulseRaf = null; }
  if (_pulseEdges.length && edgesDS) {
    edgesDS.update(_pulseEdges.map(id => ({ id, color: undefined })));
  }
  _pulseEdges = [];
}
function updateEdgeFlash() {
  const id = _selectedId;
  if (id == null || !edgesDS) return;
  const hex = '#64748b';   // 固定深灰（强调邻边，不用蓝色）
  const upd = [];
  const flashIds = [];
  edgesDS.forEach(e => {
    const rel = (e.from === id && e.to === id) ? false : (e.from === id || e.to === id);
    if (!rel) return;
    const nbId = e.from === id ? e.to : e.from;
    const nbNode = nodesDS.get(nbId);
    if (!nbNode || nbNode.hidden) return;   // 只强调当前可见的边（隐藏的不动）
    // 只在颜色还没设成强调色时才更新，减少 DataSet 写入
    const cur = e.color && e.color.color;
    if (cur !== hex) upd.push({
      id: e.id,
      color: { color: hex, highlight: '#1f6feb', hover: '#1f6feb', opacity: 0.8 }
    });
    flashIds.push(e.id);
  });
  if (upd.length) edgesDS.update(upd);
  _pulseEdges = flashIds;
}
// 顶层叠加：中心节点"从内向外辐射"的呼吸光环
function drawPulse(ctx) {
  if (!net) return;
  const id = _selectedId;
  if (id == null) return;
  let pos;
  try { pos = net.getPositions([id]); } catch (e) { return; }
  if (!pos || !pos[id]) return;
  const { x, y } = pos[id];
  const n = nodesDS && nodesDS.get(id);
  if (!n) return;
  const baseR = (n.size || 14) * 0.9;
  // 相位 0..1：半径从内圈外扩到更远，形成"从内向外辐射"的扩散光晕
  const p = (Math.sin(performance.now() / 260) + 1) / 2;
  const amber = '255, 158, 27';   // #f59e0b
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 2; k++) {
    // 从 baseR（贴近节点）向外扩张：外圈半径随相位增大，透明度随之呼吸
    const rr = baseR + k * (10 + p * 26);
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${amber}, ${0.28 + p * 0.42 - k * 0.14})`;
    ctx.lineWidth = 2.4 - k * 0.8;
    ctx.stroke();
  }
  // 第三圈：近端柔光，强化"由内向外"的发光感（贴近节点边缘的雾化光环）
  ctx.beginPath();
  ctx.arc(x, y, baseR + 6 + p * 4, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(${amber}, ${0.16 + p * 0.2})`;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.restore();
}

// 侧栏展示某个节点的详情与关系列表
function showNodeSide(id, isCenter) {
  const n = nodesDS && nodesDS.get(id);
  if (!n) { side.visible = false; return; }
  const rels = edgesDS.get().filter(e => e.from === id || e.to === id);
  const nameOf = x => { const o = nodesDS.get(x); return o ? o.raw.name : '?'; };
  const srcIds = splitSep(n.raw.src || ''), fps = splitSep(n.raw.fp || '');
  const props = n.raw.props || {};
  const extraProps = extractExtraProps(props);
  // 每次切换节点都重置折叠态：描述/属性默认展开
  descrOpen.value = !!((n.raw.descr || '').replace(/<SEP>/g, '；').trim());
  attrsOpen.value = extraProps.length > 0;
  side.visible = true;
  side.id = id;
  side.name = n.raw.name;
  side.type = n.raw.type;
  side.isCenter = isCenter !== undefined ? !!isCenter : !!n.raw.isCenter;
  side.descr = (n.raw.descr || '').replace(/<SEP>/g, '；');
  side.props = props;
  side.extraProps = extraProps;
  side.srcIds = srcIds;
  side.fps = fps;
  side.segs = [];
  side.rels = rels.slice(0, 30).map((e, i) => {
    const dir = e.from === id;
    const d = (e.raw || []).join(' / ').replace(/<SEP>/g, '；');
    return {
      key: i, dir, other: nameOf(dir ? e.to : e.from),
      name: (e.names && e.names.find(x => x)) || '',
      d,
      srcIds: splitSep((e.srcs || []).find(x => x) || ''),
      fps: splitSep((e.fps || []).find(x => x) || '')
    };
  });
  populateSegs(srcIds, fps);
}

/* ===== 生命周期 ===== */
onMounted(async () => {
  net = null; nodesDS = null; edgesDS = null;
  try {
    driver = getDriver();
    await driver.getServerInfo();
    setStatus(true, '图谱数据已就绪');
    await switchWorkspace();
  } catch (err) {
    setStatus(false, '连接失败: ' + (err.message || err));
  }
});

onBeforeUnmount(() => {
  stopPulse();
  if (_stabTimer) { clearTimeout(_stabTimer); _stabTimer = null; }
});

// 路由参数变化（从导航页/别的子图跳转进来）→ 切换图谱
watch(() => route.params.ws, async (val) => {
  if (val && val !== ws.value) {
    ws.value = val;
    await switchWorkspace();
  }
});
</script>

<style scoped>
/* ============================================================
 * GraphView 专属样式（原 graph.css 全部迁入；scoped 隔离）
 * ============================================================ */
.graph-page {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  background: linear-gradient(135deg, #d9e4f5 0%, #d2def0 50%, #e0d6ee 100%);
}
#bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  row-gap: 8px;
  background: linear-gradient(95deg, var(--chrome), var(--chrome-2));
  border-bottom: none;
  color: var(--chrome-text);
  flex-wrap: wrap;
  box-shadow: 0 2px 10px rgba(20, 30, 55, .28);
}
#bar .brand {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-right: 4px;
}
#bar .bbadge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  color: #fff;
  font-weight: 800;
  font-size: 14px;
  box-shadow: 0 1px 4px rgba(31, 45, 61, .22);
}
#bar .title {
  font-size: 16px;
  font-weight: 700;
  color: var(--chrome-text);
  white-space: nowrap;
}
#status {
  margin-left: auto;
  font-size: 12px;
  color: var(--chrome-dim);
  white-space: nowrap;
}
#dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--danger);
  margin-right: 5px;
}
#dot.ok { background: var(--ok); }

#main {
  display: flex;
  flex: 1;
  min-height: 0;
}
#net {
  flex: 1;
  background: linear-gradient(180deg, #f4f7fc, #e9eff8);
  border-right: 1px solid var(--border);
}
#side {
  width: 340px;
  background: var(--panel);
  border-left: 1px solid var(--border-2);
  color: var(--text-2);
  padding: 14px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  box-shadow: inset 6px 0 14px -8px rgba(31, 45, 61, .18);
}
#side > .chunks { flex: 1 1 auto; min-height: 120px; }
#side > .rel { flex: 0 0 auto; }
#side h3 {
  color: var(--text-1);
  font-size: 15px;
  margin-bottom: 8px;
  word-break: break-all;
  padding-left: 9px;
  border-left: 4px solid var(--primary);
}
#side .tag {
  display: inline-block;
  background: var(--primary);
  color: #fff;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 12px;
  margin: 2px 4px 8px 0;
}
#side p {
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  color: var(--text-2);
}
#side .hint {
  font-size: 11.5px;
  color: var(--text-1);
  background: var(--tint-amber);
  border: 1px solid var(--tint-amber-bd);
  border-radius: 6px;
  padding: 6px 8px;
  margin: 8px 0;
  line-height: 1.5;
}
#side .rel {
  border-top: 1px dashed var(--border-2);
  margin-top: 10px;
  padding-top: 8px;
  font-size: 12.5px;
  line-height: 1.6;
}
#side .rel-item {
  border-top: 1px dashed var(--border-2);
  margin-top: 8px;
  padding-top: 8px;
}
#side .rel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
#side .relname {
  font-size: 11px;
  color: var(--gold);
  background: var(--gold-soft);
  border: 1px solid var(--tint-amber-bd);
  border-radius: 4px;
  padding: 1px 6px;
}
#side .reldesc {
  font-size: 12.5px;
  color: var(--text-1);
  line-height: 1.65;
  margin-top: 4px;
  white-space: pre-wrap;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
}
#side .relsrc {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
#side .relsrc .isrc-open { font-size: 11.5px; }

#legend {
  position: absolute;
  left: 14px;
  bottom: 14px;
  background: linear-gradient(150deg, #1c2742 0%, #2c3e6b 60%, #3a4f80 100%);
  color: #f4f7fc;
  border: 1px solid #0f1a2a;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 12px;
  max-height: 46%;
  overflow-y: auto;
  z-index: 5;
  box-shadow: 0 8px 22px rgba(15, 26, 42, .40);
}
#legend .lhead {
  color: #b6c4de;
  margin-bottom: 4px;
  font-weight: 600;
}
#legend .item {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 3px 0;
  cursor: pointer;
  padding: 3px 6px;
  border-radius: 5px;
  color: #e8eefb;
  transition: background 0.15s;
}
#legend .item:hover { background: rgba(255, 255, 255, .10); }
#legend .item.on {
  background: rgba(255, 255, 255, .18);
  color: #ffffff;
  font-weight: 600;
}
#legend .item.all {
  color: #ffd257;
  font-weight: 600;
}
#legend .ck {
  width: 14px;
  font-size: 13px;
  color: #ffd257;
}
#legend .sw {
  width: 11px;
  height: 11px;
  border-radius: 3px;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, .18);
  display: inline-block;
}

#loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, rgba(244, 247, 252, .92), rgba(233, 239, 248, .95));
  z-index: 8;
  backdrop-filter: blur(2px);
}
#loading .loading-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 22px 30px;
  min-width: 240px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  box-shadow: 0 18px 40px rgba(28, 39, 66, .22);
}
#loading .loading-spin {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 3px solid var(--border);
  border-top-color: var(--primary);
  animation: qspin 0.9s linear infinite;
  margin-bottom: 4px;
}
@keyframes qspin { to { transform: rotate(360deg); } }
#loading .loading-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-1);
}
#loading .loading-sub {
  font-size: 11.5px;
  color: var(--text-3);
  text-align: center;
  line-height: 1.5;
}
</style>
