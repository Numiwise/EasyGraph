<!--
  GraphView.vue —— 大图谱可视化主页面（路由 /graph/:ws）
  ------------------------------------------------------------
  业务用途：
    本页面是知识图谱的核心可视化入口。路由 /graph/:ws（:ws 是 workspace id）
    进入后，会：
      1) 连上 Neo4j 数据库（getDriver）
      2) 拿全部 entity_type 列表 → 渲染"实体类型图例"组件（可勾选筛选）
      3) 取该 workspace 的图数据（节点 + 关系），渲染到 vis-network
      4) 用户点击节点 → 右侧侧栏显示节点的描述、属性、原文片段、相关关系
      5) 用户搜索实体名 → 以该实体为中心展开 k 跳邻居
      6) 整个动作都可以通过顶部工具条操作：跳数 / 上限 / 显示关系名 / 适应视图 等

  Vue 3 涉及的概念（给初学者）：
    - defineProps({ ws0 })：从路由 props 拿到 workspace id（router 会自动传过来）
    - 响应式状态：ref（基本类型）/ reactive（对象）/ computed（派生）
    - watch(() => route.params.ws)：监听路由变化，自动切到对应 workspace
    - onMounted / onBeforeUnmount：生命周期钩子
    - vis-network：第三方图可视化库，通过 DataSet + Network + Canvas 渲染
-->
<template>
  <div class="graph-page">
    <!-- 顶部"工具条"：徽标 + 标题 + 各种按钮 / 下拉 -->
    <div id="bar">
      <span class="brand">
        <WorkspaceBadge :meta="currentMeta" />
        <span class="title">{{ currentMeta.name }}</span>
      </span>
      <el-button size="small" @click="goHome">‹ 导航</el-button>
      <el-button size="small" type="primary" @click="goQuery">智能问答</el-button>
      <label class="lbl">图谱</label>
      <WorkspaceSelect v-model="ws" width="170px" filterable @change="onWsChange" />
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

    <!-- 主体：左侧 vis-network 画布，右侧详情面板 -->
    <div id="main">
      <div id="net"></div>
      <!--
        右侧侧栏：点击节点/边时显示。
        内部有三个子组件：
          AttrTable —— 节点的非保留键属性表
          ChunkPanel —— 节点的原文片段列表（支持展开/折叠）
          （还有原生的 .descr / .attrs / .rels 区段）
      -->
      <div id="side" v-show="side.visible">
        <h3>{{ side.name }}</h3>
        <span class="tag">{{ side.type }}</span>
        <span class="tag" v-if="side.isCenter">展开中心</span>
        <div class="hint">提示：点击图中任一节点，即按当前跳数直接展开其子图</div>

        <!-- 描述（来自 Neo4j properties.description） -->
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

        <!--
          ChunkPanel：节点的原文片段列表。
          用 v-if/v-else 让"有/无段落"分两个分支，保证 watch 能正确触发。
        -->
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

    <!-- 左下"实体类型图例"：可勾选筛选多类型 -->
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

    <!-- 全屏加载遮罩：取数阶段 + vis-network 布局定位阶段都保持 -->
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
/* ============================================================
 * 导入区
 * ============================================================ */
// 从 vue 引入组合式 API
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue';
// vue-router 4：useRoute (响应式 route 对象) / useRouter (跳转)
import { useRoute, useRouter } from 'vue-router';
// vis-network 的独立构建：DataSet（高效数据集合）+ Network（canvas 渲染）
import { DataSet, Network } from 'vis-network/standalone/esm/vis-network';

// 从 composables/useNeo4j.js 引入 WS_META / wsMeta / api（统一数据库访问，后端代理）
import { WS_META, wsMeta, api } from '../composables/useNeo4j.js';
// 从 composables/useLightragApi.js 引入 fetchChunk / splitSep / openOriginal
import { fetchChunk, splitSep, openOriginal } from '../composables/useLightragApi.js';

// 引入几个组件
import WorkspaceBadge from '../components/WorkspaceBadge.vue';
import WorkspaceSelect from '../components/WorkspaceSelect.vue';
import TypeLegend from '../components/TypeLegend.vue';
import ChunkPanel from '../components/ChunkPanel.vue';
import AttrTable from '../components/AttrTable.vue';

// 把 DataSet 和 Network 装到 vis 对象上，便于下方统一加前缀
const vis = { DataSet, Network };

/* ============================================================
 * 颜色（模块级常量）
 * ------------------------------------------------------------
 * 实体类型 → 颜色的映射由 colorFor() 决定（按 type 字符串 hash 取模分配），
 * 这样图例上的颜色块 ↔ 图中节点颜色严格一致。
 * TECH_PALETTE 是 12 种"科技感"色，邻近的 entity_type 字符串会尽量分到
 * 差异较大的色相上。
 * ============================================================ */
const TECH_PALETTE = [
  '#2563eb', '#16a34a', '#ea580c', '#dc2626',
  '#9333ea', '#0891b2', '#65a30d', '#db2777',
  '#ca8a04', '#0d9488', '#4f46e5', '#7c3aed'
];
// 缓存 type → color 的映射，避免重复 hash
const _colorAssign = new Map();
// 简单字符串 hash（Java 风格，乘 31 加字符码）
function hashStr(s) {
  let h = 0;
  const k = String(s || '');
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0;
  return Math.abs(h);
}
// 颜色分配函数：未知 type 都返回 _colorAssign 中缓存值；首次才计算
function colorFor(t) {
  const key = String(t || '');
  if (!_colorAssign.has(key)) {
    _colorAssign.set(key, TECH_PALETTE[hashStr(key) % TECH_PALETTE.length]);
  }
  return _colorAssign.get(key);
}

/* ============================================================
 * 组件 props
 * ------------------------------------------------------------
 * 注：路由 /graph/:ws 的 props 函数会把 params.ws 转成 ws0 prop 传入。
 *   这是 router.js 里 { ... props: (route) => ({ ws0: route.params.ws }) }
 * ============================================================ */
const props = defineProps({
  ws0: { type: String, default: '' }
});

/* ============================================================
 * 路由（vue-router 4 hooks）
 * ============================================================ */
const route = useRoute();
const router = useRouter();

/* ============================================================
 * 响应式状态（相当于 Vue 2 的 data()）
 * ============================================================ */
// 当前 workspace id（默认总图谱）
const ws = ref(props.ws0 || 'g00_master_all');
// workspace 列表下拉选项
const wsOptions = WS_META.map(m => ({ v: m.id, t: m.name }));
// 全图模式的"节点上限"
const limitNum = ref(300);
// 上限可选值
const limitOptions = [150, 300, 600, 1000];
// 搜索关键词
const keyword = ref('');
// 跳数（搜索/点击展开都用这个）
const hops = ref(1);
const hopsOptions = [1, 2, 3, 4, 5];
// 连接状态：ok + text 两段（红/绿点 + 文字）
const status = reactive({ ok: false, text: '未连接' });
// 是否处于"加载中"（取数阶段）
const loading = ref(false);
// vis-network 内置 physics 布局还在跑（stabilization）时保持 loading 遮罩，
// 消除"提示消失 → 图谱要几秒才出来"的断裂感
const stabilizing = ref(false);

// 选中中心节点的光晕/连线脉冲动画句柄
let _pulseRaf = null;
// 动画期间被改过颜色的边 id（停止动画时还原为"原色"）
let _pulseEdges = [];
// 是否在连线上显示关系名称
const showRel = ref(false);
// 连线文字样式（背景 + 边框 + 字号 + 字体）
const edgeFontBase = { size: 10, color: '#55637a', face: 'Microsoft YaHei', align: 'middle',
  strokeWidth: 2, strokeColor: '#dbe6f5', background: 'rgba(219,230,245,0.92)' };
// 最近一次"以节点为中心展开"的中心节点 id
const centerId = ref(null);
// hopsMode: 'all' 显示全图；'sub' 按 center+hops 隐藏
const hopsMode = ref('all');
// 全图邻接表（renderGraph 时存到 _adj），用于"按跳数隐藏远处节点"
let _adj = null;
let _allNodeIds = [];
let _allEdgeIds = [];

// vis-network 实例 / DataSet（受 Vue 状态管理会出错时用 ref 让其兼容）
let net = null;
let nodesDS = null;
let edgesDS = null;
// 兜底定时器：万一 stabilization 事件没触发，10s 后强制关掉 loading 遮罩
let _stabTimer = null;
// 当前选中节点 id（用于"取消选中"时还原样式）
let _selectedId = null;

// 图例相关的三个 ref
const typeList = ref([]);          // 该 workspace 全部 entity_type（如 ["人物","地点","组织"]）
const typeColors = ref({});        // 类型 → 颜色 hex 映射
const selectedTypes = ref([]);     // 当前已勾选类型（默认全选，进入即全部可见）

// 侧栏状态（对象用 reactive 便于字段统一管理）
const side = reactive({ visible: false, id: 0, name: '', type: '', isCenter: false, descr: '',
  props: {}, extraProps: [], srcIds: [], fps: [], rels: [], segs: [] });

// Neo4j 属性键中需要排除显示的"保留键"（已经专门在顶部卡片或原文区展示）
const RESERVED_KEYS = ['entity_id', 'entity_type', 'description', 'source_id', 'file_path',
  'created_at', 'updated_at', 'id'];
// 详情面板各分区的折叠状态
const descrOpen = ref(true);
const attrsOpen = ref(true);

/* ============================================================
 * 计算属性
 * ============================================================ */
const typeFs = computed(() => selectedTypes.value);   // 给 Cypher 用，方便传参
const currentMeta = computed(() => wsMeta(ws.value)); // 当前 workspace 的展示元数据

// 加载遮罩的两段文案
const loadTitle = computed(() => (loading.value && !stabilizing.value) ? '图谱加载中…' : '正在铺展节点位置…');
const loadSub = computed(() => stabilizing.value
  ? '已取回节点与关系，正在稳定布局（动画定位），请稍候'
  : '正在准备图谱内容，耐心等一下');

// 图例两个批量按钮的勾选态（虽然按钮本身由 TypeLegend 控制，但这里备份）
const allSelected = computed(() => typeList.value.length > 0 && selectedTypes.value.length === typeList.value.length);
const noneSelected = computed(() => selectedTypes.value.length === 0);

/* ============================================================
 * 工具方法
 * ============================================================ */
// 同时设置 ok 和 text
function setStatus(ok, text) {
  status.ok = ok;
  status.text = text;
}

/* ============================================================
 * 路由相关动作
 * ============================================================ */
// 返回首页
function goHome() { router.push('/'); }
// 跳到问答页（新标签页打开）
function goQuery() {
  const url = window.location.origin + window.location.pathname +
    '#/query?ws=' + encodeURIComponent(ws.value);
  window.open(url, '_blank');
}
// 切换 workspace：直接改 URL（路由 watch 会触发 switchWorkspace）
function onWsChange(v) { router.push('/graph/' + v); }

/* ============================================================
 * 溯源：点击 chunk 旁的"查看原文"按钮
 * ============================================================ */
async function openOriginalFile(fp) {
  if (!fp) return;
  // openOriginal(fp, ws) 内部已经做了一站式（_origin/html/pdf 都能直开，docx 兜底返回 false）
  const ok = await openOriginal(fp, ws.value);
  if (!ok) openDoc(fp);   // 浏览器打不开（docx 等）→ 在 DocView 中预览
}
function openDoc(fp) {
  if (!fp) return;
  // 新标签页打开 /doc?ws=...&file=... 路由（DocView 负责把 md 渲染出 HTML）
  const url = window.location.origin + window.location.pathname +
    '#/doc?ws=' + encodeURIComponent(ws.value) + '&file=' + encodeURIComponent(fp);
  window.open(url, '_blank');
}

/* ============================================================
 * 节点属性辅助：把 Neo4j 属性转成侧栏要显示的"展示项"
 * ============================================================ */
// "entity_type" → "Entity Type" 这种"下划线命名 → 标题命名"
function prettifyKey(k) {
  return String(k).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
// 提取所有非保留键、非空值的属性，转成 { key, label, value }[]
function extractExtraProps(props) {
  const out = [];
  Object.keys(props || {}).forEach(k => {
    if (RESERVED_KEYS.includes(k)) return;   // 保留键留到顶部展示
    const v = props[k];
    if (v === null || v === undefined || v === '') return;   // 空值不显示
    out.push({ key: k, label: prettifyKey(k), value: formatPropValue(v) });
  });
  // 按 key 字母序展示，方便人眼扫
  out.sort((a, b) => a.key.localeCompare(b.key));
  return out;
}
// 格式化属性值：数组 → 用"、"拼接；对象 → 看是不是 Neo4j Date 字段（year/month/day），
// 是的话格式化成 "yyyy-mm-dd"；其它对象 → JSON 字符串
function formatPropValue(v) {
  if (Array.isArray(v)) return v.join('、');
  if (typeof v === 'object') {
    try {
      if (v.year || v.month || v.day) {
        // Neo4j Bolt 时空类型：可能是 number 或 { low } 大整数
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

// 取节点的原文片段（chunk）并内联到节点信息中：
//   头两个 chunk 默认展开，余下折叠
async function populateSegs(srcIds, fps) {
  const segs = (srcIds || []).map((s, i) => ({
    srcId: s, file: (fps || [])[i] || '', para: '', loading: true,
    // 默认展开前 2 个，避免一次性堆叠 N 段原文内容导致侧栏太长
    expanded: i < 2
  }));
  side.segs = segs;
  for (let i = 0; i < segs.length; i++) {
    try {
      const pl = await fetchChunk(segs[i].srcId, ws.value);
      segs[i].para = (pl && pl.content) ? pl.content : '';
      // 如果 props 没传 file_path 但 payload 里有，就用它（更准确）
      if (pl && pl.file_path && !segs[i].file) segs[i].file = pl.file_path;
    } catch (err) {
      segs[i].para = '';
    }
    segs[i].loading = false;
  }
}

/* ============================================================
 * 工作区切换
 * ============================================================ */
// 切换 workspace 时的"清理 + 重载"
async function switchWorkspace() {
  loading.value = true;
  centerId.value = '';
  stopPulse();                                // 停掉上一个 ws 残留的脉冲动画
  if (_stabTimer) { clearTimeout(_stabTimer); _stabTimer = null; }
  if (net) { try { net.destroy(); } catch (e) {} net = null; nodesDS = null; edgesDS = null; }
  // 页签名称 + 顶部标题
  document.title = currentMeta.value.name + ' · 妃子笑荔枝文化图谱';
  try {
    await loadTypes(ws.value);    // 拿 entity_type 列表 + 颜色映射
    await loadGraph('');          // 全图模式
  } finally { loading.value = false; }
}

// loadTypes(label) —— 拿 label 这个 workspace 下所有 entity_type（按字母升序）
// 数据改由后端 api-bridge 从 Neo4j 查询（api.types），前端不再直连数据库。
async function loadTypes(label) {
  // 后端返回该 workspace 的去重实体类型列表（如 ["人物","地点","组织"]）
  const types = await api.types(label);
  typeList.value = types;
  // 默认全选：进入子图所有实体类型可见
  selectedTypes.value = typeList.value.slice();
  // 给每个 type 分配一个颜色（用 colorFor 与节点同源，颜色逻辑仍在前端，无敏感）
  const colors = {};
  typeList.value.forEach(t => { colors[t] = colorFor(t); });
  typeColors.value = colors;
}

/* ============================================================
 * 类型多选筛选（侧栏图例）
 * ============================================================ */
function toggleType(t) {
  const i = selectedTypes.value.indexOf(t);
  if (i >= 0) selectedTypes.value.splice(i, 1);     // 已选 → 取消
  else selectedTypes.value.push(t);                 // 未选 → 选中
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

// 统一可见性计算：实体类型筛选 AND 跳数隐藏（两者叠加生效）
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
  // 2) 类型可见集合
  const visTypes = new Set(selectedTypes.value);
  // 3) 逐节点：选中中心节点豁免类型筛选（永远不能隐藏）；其余节点需要"已勾选"且"在跳数集合内"
  const nodeUpd = [];
  const visible = new Set();
  nodesDS.forEach(n => {
    const isCenter = (centerId.value != null && n.id === centerId.value);
    const okType = isCenter || visTypes.has(n.group);   // group 在 vis 里就是 entity_type
    const okHop = !hopKeep || hopKeep.has(n.id);
    const show = okType && okHop;
    if (show) visible.add(n.id);
    // 只在状态需要变时才往 DataSet 里写（vis-network 内部 diff）
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

/* ============================================================
 * 顶部工具栏动作
 * ============================================================ */
// 搜索关键词 → 以关键词为中心 k 跳展开
function searchGo() { centerId.value = null; loadGraph(keyword.value.trim()); }
// 跳数变化 → 切到 sub 或 all 模式
function onHopsChange() {
  hopsMode.value = (centerId.value != null && centerId.value !== '') ? 'sub' : 'all';
  applyHopsFilter();
  setStatus(true, hopsMode.value === 'sub'
    ? ('已显示「中心节点」' + hops.value + ' 跳邻居')
    : ('跳数 ' + hops.value + '（点击节点后生效）'));
}
// 重新加载（通常由"上限"变化触发）
function reload() { loadGraph(keyword.value.trim()); }
// 显示全部：清空关键词 + 中心节点 + 跳数，回到全图模式
function showAll() {
  keyword.value = '';
  centerId.value = '';
  hopsMode.value = 'all';
  refreshVisibility();
  fitView();
}
// 适应视图（居中 + 缩放到合适大小）
function fitView() { if (net) net.fit({ animation: true }); }

/* ============================================================
 * 关系名称显示开关
 * ============================================================ */
// 取边的描述前 16 个字符当 label，太长会"自动截断 + …"
function relLabel(ds) {
  const s = (Array.isArray(ds) ? ds[0] : '') || '';
  return s.length > 16 ? s.slice(0, 16) + '…' : s;
}
// 切换"显示关系名称"：三步同时改（数据 label + font size + 强制重绘）
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

/* ============================================================
 * 图查询入口（两种模式）：
 *   - 有 searchText → 径向 k 跳搜索（api.search），后端完成 BFS 展开
 *   - 无 searchText → 全图模式，按度数取核心节点（api.graph）
 * 数据改由后端 api-bridge 从 Neo4j 查询，前端不再直连数据库。
 * ============================================================ */
async function loadGraph(searchText) {
  const limit = limitNum.value;
  loading.value = true;
  const t0 = performance.now();
  try {
    let result;
    if (searchText) {
      // 搜索模式：径向 k 跳展开，数据由后端 api-bridge 查询
      // api.search(workspace, 关键词, { hops: 跳数, cap: 节点上限, types: 类型筛选 })
      result = await api.search(ws.value, searchText, {
        hops: hops.value, cap: limit, types: typeFs.value
      });
    } else {
      // 全图模式：按度数取前 N，数据由后端 api-bridge 查询
      // api.graph(workspace, { limit: 节点上限, types: 类型筛选 })
      centerId.value = null;
      result = await api.graph(ws.value, { limit, types: typeFs.value });
    }
    // 后端返回 { nodes, edges, centerIds }，与 renderGraph 接口一致
    renderGraph(result.nodes, result.edges, result.centerIds || []);
    const ms = Math.round(performance.now() - t0);
    if (searchText && !result.nodes.length) {
      setStatus(true, '未找到匹配实体（仅支持名称子串）');
    } else {
      const pre = result.centerIds?.length ? ('中心 ' + result.centerIds.length + ' · ') : '';
      const tf = selectedTypes.value.length ? ('已筛类型 ' + selectedTypes.value.length + ' 种 · ') : '';
      setStatus(true, tf + pre + '节点 ' + result.nodes.length + ' · 关系 ' + result.edges.length + ' · 加载耗时 ' + ms + 'ms');
    }
  } catch (err) {
    console.error(err);
    setStatus(false, '加载失败: ' + (err.message || err));
  } finally { loading.value = false; }
}

// 以被点击节点为中心做 k 跳展开（邻居同样吃类型筛选）
// 数据改由后端 api-bridge 从 Neo4j 查询，前端不再直连数据库。
// api.expand(workspace, nodeId, { hops: 跳数, types: 类型筛选 })
async function expandFromNode(nodeId, hopsVal) {
  loading.value = true;
  const t0 = performance.now();
  try {
    const result = await api.expand(ws.value, nodeId, {
      hops: hopsVal, types: typeFs.value
    });
    centerId.value = nodeId;  // 记住中心，类型筛选变化时可复现
    renderGraph(result.nodes, result.edges, [nodeId]);
    showNodeSide(nodeId, true);
    if (net) net.focus(nodeId, { scale: 0.8, animation: { duration: 400 } });
    const ms = Math.round(performance.now() - t0);
    const pre = typeFs.value.length ? ('已筛类型 ' + typeFs.value.length + ' 种 · ') : '';
    const centerNode = result.nodes.find(n => n.id === nodeId);
    const centerName = centerNode ? centerNode.name : '未知';
    setStatus(true, pre + '以「' + centerName + '」为中心 ' + hopsVal + ' 跳 · 节点 ' +
      result.nodes.length + ' · 关系 ' + result.edges.length + ' · 加载耗时 ' + ms + 'ms');
  } catch (err) {
    console.error(err);
    setStatus(false, '展开失败: ' + (err.message || err));
  } finally { loading.value = false; }
}

/* ============================================================
 * vis-network 渲染（vis 内置布局 + 完全静态）
 * ============================================================ */
function renderGraph(nodes, edges, centerIds) {
  // 数据已就绪 → 进入布局定位阶段：保持 loading 遮罩直到 stabilization 完成
  stabilizing.value = true;
  // 兜底：万一 stabilizationIterationsDone 没触发（极端情况），10s 后强制收起
  if (_stabTimer) clearTimeout(_stabTimer);
  _stabTimer = setTimeout(() => { stabilizing.value = false; }, 10000);

  // 先算每个节点的度数（被多少条边连接）
  const deg = {};
  edges.forEach(e => { deg[e.s] = (deg[e.s] || 0) + 1; deg[e.t] = (deg[e.t] || 0) + 1; });
  // 节点大小按度数做"非线性拉伸"（用 sqrt 让大节点差距更明显，但不会出现"超大节点"）
  const maxDeg = Math.max(1, ...Object.values(deg));
  const minSize = 8, maxSize = 38;

  // 把节点数组转成 vis-network 的 DataSet
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
      // 备份原始样式（选中/取消时用）
      _origSize: sz,
      _origShadow: isC ? { enabled: true, color: '#ffd257', size: 20 } : undefined,
      _origBorder: 0,
      _origColor: { background: colorFor(n.type || '其他'), border: colorFor(n.type || '其他'),
        highlight: { background: colorFor(n.type || '其他'), border: '#1f6feb' } },
      raw: Object.assign({}, n, { isCenter: isC })
    };
  }));
  // 边 DataSet
  edgesDS = new vis.DataSet(edges.map((e, i) => ({
    id: i, from: e.s, to: e.t, title: e.ds.join('\n'),
    label: showRel.value ? relLabel(e.ds) : undefined,
    raw: e.ds, names: e.kws || [], srcs: e.srcs || [], fps: e.fps || []
  })));

  // 科技感配色（每种 entity_type 一个组颜色）
  const techGroups = {};
  const techTypeList = Array.from(new Set(nodes.map(n => n.type || '其他')));
  techTypeList.forEach(t => { techGroups[t] = { color: colorFor(t) }; });

  // vis-network options：
  //   - physics.barnesHut 物理引擎：赫尔曼式引力 + 弹簧
  //   - stabilization.iterations 600：算法跑完自动停止
  //   - improvedLayout: true：vis 自家做的初始排布优化
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
    // 在顶层绘制层叠加"选中中心光晕 + 连线脉冲"（浅→深循环）
    net.on('afterDrawing', ctx => drawPulse(ctx));
  } else {
    net.setData({ nodes: nodesDS, edges: edgesDS });
  }

  // 把 group 颜色应用到每个节点（稳定填充色，跨版本兼容）
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

  // vis-network 内置布局完成（stabilizationIterationsDone）后保留极慢的 physics
  //   弹簧调很弱、阻尼很大 → 节点只在自己周围轻微浮动（不会互相重叠）
  //   用户点击节点 → onPick 中 stopPhysics 关闭 → 完全静止
  net.once('stabilizationIterationsDone', () => {
    if (!net) return;
    stabilizing.value = false;
    if (_stabTimer) { clearTimeout(_stabTimer); _stabTimer = null; }
    // 切到极慢模式：弱弹簧 + 高阻尼，节点只做微幅摆动
    net.setOptions({
      physics: {
        enabled: true,
        solver: 'barnesHut',
        barnesHut: {
          gravitationalConstant: -400,
          centralGravity: 0.005,
          springLength: 240,
          springConstant: 0.005,
          damping: 0.92,
          avoidOverlap: 0.8
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

/* ============================================================
 * 点节点/点边 → 侧栏
 * ============================================================ */
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
        // 把当前节点"暂时"放大、加上橙色光晕、加粗边框
        nodesDS.update({
          id,
          size: (n.size || 14) * 1.7,
          shadow: { enabled: true, color: '#fb923c', size: 28 },
          borderWidth: 4,
          color: { background: '#f59e0b', border: '#9a3412', highlight: { background: '#f59e0b', border: '#9a3412' } }
        });
      }
      // 取消上一个选中节点的样式（还原"原始"）
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
      // 居中节点
      net.focus(id, { scale: 1.0, locked: false,
        animation: { duration: 600, easingFunction: 'easeInOutQuad' } });
      startPulse();        // 启动脉冲动画
    } else if (params.edges.length) {
      // 点边：不切换中心节点
    } else {
      // 点空白：取消选中 + 停止脉冲
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
      // 冻结视图：把当前的 viewPosition/scale 立刻回写，把焦点动画停掉
      if (net && net.getViewPosition) {
        try {
          const p = net.getViewPosition();
          const sc = net.getScale();
          net.moveTo({ position: p, scale: sc, animation: false });
        } catch (e) {}
      }
    }
  }
  // 点击节点 → 仅显示详情，不重新画图；点击边 → 显示"关系详情"；空白 → 隐藏侧栏
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

/* ============================================================
 * 选中中心节点：从内向外辐射光晕 + 邻边稳定加深
 * ============================================================ */
function startPulse() {
  stopPulse();                                // 先清理旧循环
  updateEdgeFlash();                          // 一次性加深邻边（幂等）
  // 进入持续重绘循环：用 requestAnimationFrame 让 vis-network 反复调用 drawPulse
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
// 把"跟选中节点相邻的边"统一加深为深灰色（让用户看清关系）
function updateEdgeFlash() {
  const id = _selectedId;
  if (id == null || !edgesDS) return;
  const hex = '#64748b';   // 固定深灰
  const upd = [];
  const flashIds = [];
  edgesDS.forEach(e => {
    const rel = (e.from === id && e.to === id) ? false : (e.from === id || e.to === id);
    if (!rel) return;
    const nbId = e.from === id ? e.to : e.from;
    const nbNode = nodesDS.get(nbId);
    if (!nbNode || nbNode.hidden) return;          // 跳过隐藏的邻居
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
//   - ctx 是 vis-network 的 CanvasRenderingContext2D
//   - ctx.save / restore 保护上下文（不影响其它图层）
//   - globalCompositeOperation='lighter' 让叠加更亮
//   - 用 sin 函数做"呼吸"：相位 0..1 循环
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
    const rr = baseR + k * (10 + p * 26);
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${amber}, ${0.28 + p * 0.42 - k * 0.14})`;
    ctx.lineWidth = 2.4 - k * 0.8;
    ctx.stroke();
  }
  // 第三圈：近端柔光，强化"由内向外"的发光感
  ctx.beginPath();
  ctx.arc(x, y, baseR + 6 + p * 4, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(${amber}, ${0.16 + p * 0.2})`;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.restore();
}

// showNodeSide(id, isCenter) —— 侧栏展示某个节点的详情与关系列表
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
  side.rels = rels.slice(0, 30).map((e, i) => {     // 最多展示 30 条相关关系
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

/* ============================================================
 * 生命周期
 * ============================================================ */
onMounted(async () => {
  // 初始化图谱组件状态，不再持有 Neo4j driver（数据库访问已移至后端）
  net = null; nodesDS = null; edgesDS = null;
  try {
    setStatus(true, '图谱数据已就绪');
    await switchWorkspace();
  } catch (err) {
    setStatus(false, '加载失败: ' + (err.message || err));
  }
});

onBeforeUnmount(() => {
  // 清理 RAF / 兜底定时器（避免组件卸载后还在跑）
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
 * GraphView 专属样式（统一内联在 <style scoped>，与组件内聚）
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

/* 主体：左侧画布 flex:1，右侧栏 340px */
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

/* 左下实体类型图例 */
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

/* 全屏加载遮罩 */
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
