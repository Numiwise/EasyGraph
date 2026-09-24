/* ============================================================
 * GraphView.vue —— 大图谱可视化主页面（路由 /graph/:ws）
 * ------------------------------------------------------------
 *  这是整个项目里最复杂的一个组件，负责把 Neo4j 里的「节点 + 关系」
 *  渲染成一张可交互的图。读这文件可以从上到下按这段顺序看：
 *
 *  1. 顶部注释 / 引入：WS_META / getDriver / wsMeta（来自 api/neo4j.js）
 *     - WS_META 是 7 个工作区的元信息（id、name、color）
 *     - getDriver 返回一个共享的 Neo4j Driver 实例
 *     - wsMeta(ws) 根据 ws id 取出对应元信息
 *
 *  2. PALETTE / TECH_PALETTE：图谱的颜色系统
 *     - PALETTE 是当前未使用的历史配色
 *     - TECH_PALETTE 是 12 色行业实践配色；按 type 在全集中首次出现
 *       顺序分配（colorFor）；图例和节点共用同一套颜色，保证一致
 *
 *  3. export default 组件：包含 data / computed / watch / mounted / methods / template
 *     - data()：组件用到的所有响应式状态
 *         · ws/limitNum/keyword/hops：搜索范围 + 跳数（1-5）
 *         · centerId / hopsMode：是否处于「以某节点为中心 N 跳」的视图
 *         · selectedTypes / typeList / typeColors：实体类型多选筛选
 *         · _adj / _allNodeIds / _allEdgeIds：全图邻接表（BFS 用）
 *         · side / descrOpen：节点详情侧栏
 *         · _selectedId / _origColor 等：选中节点高亮与还原
 *         · showProgress / loadTitle / loadSub：加载遮罩衔接
 *     - methods()：
 *         · loadGraph(keyword)        —— 加载图（关键词 / 全部）
 *         · renderGraph(nodes,edges) —— vis-network 渲染 + 布局 + 漂浮
 *         · onPick(params)           —— 点击节点：聚焦 + 高亮 + 脉冲
 *         · refreshVisibility         —— 统一可见性（类型筛选 + 跳数）
 *         · applyTypeFilter / applyHopsFilter / onHopsChange
 *         · showAll                  —— 显示全图（不重新渲染）
 *         · toggleType / selectAllTypes / selectNoneTypes
 *         · drawPulse / startPulse / stopPulse / updateEdgeFlash
 *                                   —— 选中节点的光晕 + 连线闪烁动画
 *         · fitView / setStatus / onWsChange 等工具方法
 *
 *  4. 渲染生命周期（用户最关心的部分）：
 *     mounted → switchWorkspace → loadTypes + loadGraph('')
 *     ↓
 *     loadGraph 走 Neo4j Cypher 取节点/关系 → renderGraph
 *     ↓
 *     renderGraph 创建 vis.Network → 物理引擎布局 → stabilization.done
 *     ↓
 *     stabilization 后切到「极慢漂浮」模式（用户体验细节）
 *     ↓
 *     用户点击节点 → onPick → focus 居中 + 高亮 + 脉冲 + 邻边闪烁
 *
 *  5. 交互细节速查（项目里常被问的几条规则）：
 *     - 节点不能拖（interaction.dragNodes:false），只能点
 *     - 点击空白不会动视野（moveTo 立即冻结焦点动画）
 *     - 多选实体类型用 el-checkbox，「全选/全部不选」是批量开关
 *     - 中心节点在类型筛选时豁免，始终可见
 *     - 切换工作区会销毁旧 vis 再重建，避免布局聚成「一圈」
 *
 * ============================================================ */
import { defineComponent } from 'vue';
import { DataSet, Network } from 'vis-network/standalone/esm/vis-network';
import { WS_META, getDriver, wsMeta } from '../api/neo4j.js';
import { fetchChunk, splitSep, openOriginal } from '../api/lightrag.js';

// 把 vis-network 暴露成单一命名空间 `vis`，与原 UMD 全局 `vis` 用法保持一致
// （代码里用 `new vis.DataSet(...)` / `new vis.Network(...)`，改造成本最低）
const vis = { DataSet, Network };

const PALETTE = ['#4fa3ff', '#3ecf6a', '#ffd257', '#ff7eb6', '#b28dff', '#ff9f43',
  '#4dd0c4', '#f0616f', '#9ccc65', '#64b5f6', '#ffb74d', '#ba68c8',
  '#4db6ac', '#e57373', '#aed581'];
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

export default defineComponent({
  name: 'GraphView',
  props: { ws0: { type: String, default: '' } },

  data() {
    return {
      ws: this.ws0 || 'g00_master_all',
      wsOptions: WS_META.map(m => ({ v: m.id, t: m.name })),
      limitNum: 300, limitOptions: [150, 300, 600, 1000],
      keyword: '', hops: 1,
      // 跳数下拉选项 1-5
      hopsOptions: [1, 2, 3, 4, 5],
      status: { ok: false, text: '未连接' },
      loading: false,
      // 数据已取回但 vis-network 仍在做内置布局定位（stabilization）时保持 loading 遮罩，
      // 消除「提示消失 → 图谱要几秒才出来」的断裂感。stabilizationIterationsDone 后置 false
      stabilizing: false,
      // 选中中心节点的光晕/连线脉冲动画句柄
      _pulseRaf: null,
      // 动画期间被改过颜色的边 id（停止动画时还原为“原色”）
      _pulseEdges: [],
      showRel: false,          // 连线上是否显示关系名称
      edgeFontBase: { size: 10, color: '#55637a', face: 'Microsoft YaHei', align: 'middle',
        strokeWidth: 2, strokeColor: '#dbe6f5', background: 'rgba(219,230,245,0.92)' },
      centerId: null,          // 最近一次「以节点为中心展开」的中心节点
      // hopsMode: 'all' 显示全图；'sub' 按 center+hops 隐藏
      hopsMode: 'all',
      // 全图邻接表（renderGraph 时存到 _adj）
      _adj: null,
      // 全图 nodeIds 顺序（用于重置显示）
      _allNodeIds: [],
      _allEdgeIds: [],
      typeList: [], typeColors: {}, selectedTypes: [],
      side: { visible: false, id: 0, name: '', type: '', isCenter: false, descr: '',
        props: {}, extraProps: [], srcIds: [], fps: [], rels: [], segs: [] },
      // 节点全部 Neo4j 属性键中需要排除显示的「保留键」——留给顶部卡片与原文区
      RESERVED_KEYS: ['entity_id', 'entity_type', 'description', 'source_id', 'file_path',
        'created_at', 'updated_at', 'id'],
      // 详情面板各分区的折叠状态：描述/属性可手动折叠，原文片段在 chunks 上单独控制
      descrOpen: true,
      attrsOpen: true,
    };
  },

  computed: {
    typeFs() { return this.selectedTypes; },
    currentMeta() { return wsMeta(this.ws); },
    // 加载遮罩标题/副文案：取数阶段 vs 布局定位阶段 不同文案，衔接更自然
    loadTitle() { return this.loading && !this.stabilizing ? '图谱加载中…' : '正在铺展节点位置…'; },
    loadSub() { return this.stabilizing
    ? '已取回节点与关系，正在稳定布局（动画定位），请稍候'
    : '正在准备图谱内容，耐心等一下'; },
    // 图例两个批量开关的勾选态
    allSelected() { return this.typeList.length > 0 && this.selectedTypes.length === this.typeList.length; },
    noneSelected() { return this.selectedTypes.length === 0; }
  },

  watch: {
    // 路由参数变化（从导航页/别的子图跳转进来）→ 切换图谱
    '$route.params.ws': {
      async handler(val) {
        if (val && val !== this.ws) {
          this.ws = val;
          await this.switchWorkspace();
        }
      }
    }
  },

  async mounted() {
    this.net = null; this.nodesDS = null; this.edgesDS = null;
    try {
      this.driver = getDriver();
      await this.driver.getServerInfo();
      this.setStatus(true, '图谱数据已就绪');
      await this.switchWorkspace();
    } catch (err) {
      this.setStatus(false, '连接失败: ' + (err.message || err));
    }
  },

  methods: {
    /* ---------- 基础 ---------- */
    setStatus(ok, text) { this.status = { ok, text }; },

    /* ---------- 路由 ---------- */
    goHome() { this.$router.push('/'); },
    // 新页签打开智能问答页（与首页一致）
    goQuery() {
      const url = window.location.origin + window.location.pathname +
        '#/query?ws=' + encodeURIComponent(this.ws);
      window.open(url, '_blank');
    },
    onWsChange(v) { this.$router.push('/graph/' + v); },   // 下拉切换 = 路由跳转

    /* ---------- 溯源：原文段落 / 打开原文 ---------- */
    // 打开原文：优先用浏览器直接打开原始文件（html 原网页 / pdf / png…）；
    // 无原始文件或浏览器不可直开（如 docx）时，回退到 /doc 前端渲染页
    async openOriginalFile(fp) {
      if (!fp) return;
      const ok = await openOriginal(fp, this.ws);
      if (!ok) this.openDoc(fp);
    },
    // 回退：前端渲染已解析的 markdown 原文（docx 等不可直开时）
    openDoc(fp) {
      if (!fp) return;
      const url = window.location.origin + window.location.pathname +
        '#/doc?ws=' + encodeURIComponent(this.ws) + '&file=' + encodeURIComponent(fp);
      window.open(url, '_blank');
    },

    /* ---------- Neo4j：取节点全部属性（用于详情面板「属性」展示） ---------- */
    // 排除 LightRAG 内部/冗余字段：留给「描述」「类型」「来源」等专门区域显示
    async fetchNodeProps(session, label, id) {
      try {
        const r = await session.run(
          'MATCH (n:`' + label + '`) WHERE id(n) = $id RETURN properties(n) AS props',
          { id: neo4j.int(id) });
        if (!r.records.length) return {};
        return r.records[0].get('props') || {};
      } catch (err) { return {}; }
    },
    async fetchNodePropsBatch(session, label, ids) {
      const out = {};
      if (!ids || !ids.length) return out;
      try {
        const r = await session.run(
          'UNWIND $ids AS i MATCH (n:`' + label + '`) WHERE id(n) = i RETURN id(n) AS id, properties(n) AS props',
          { ids: ids.map(i => (typeof i === 'number' ? neo4j.int(i) : i)) });
        r.records.forEach(rec => { out[rec.get('id').toNumber()] = rec.get('props') || {}; });
      } catch (err) { /* ignore */ }
      return out;
    },
    // 把下划线 / 蛇形字段名转成展示名：「entity_type」→「Entity Type」
    prettifyKey(k) {
      return String(k).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    },
    // 整理出「非保留键」属性（按 key 排序），供侧栏展示
    extractExtraProps(props) {
      const out = [];
      Object.keys(props || {}).forEach(k => {
        if (this.RESERVED_KEYS.includes(k)) return;
        const v = props[k];
        if (v === null || v === undefined || v === '') return;
        out.push({ key: k, label: this.prettifyKey(k), value: this.formatPropValue(v) });
      });
      out.sort((a, b) => a.key.localeCompare(b.key));
      return out;
    },
    formatPropValue(v) {
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
    },

    // 取原文片段（chunk）并内联到节点信息中：
    //   头两个 chunk 默认展开，余下折叠；原文按钮始终可见
    async populateSegs(srcIds, fps) {
      const segs = (srcIds || []).map((s, i) => ({
        srcId: s, file: (fps || [])[i] || '', para: '', loading: true,
        // 默认展开前 2 个，避免一次性堆叠 N 段原文内容互斥打架
        expanded: i < 2
      }));
      this.side.segs = segs;
      for (let i = 0; i < segs.length; i++) {
        try {
          const pl = await fetchChunk(segs[i].srcId, this.ws);
          this.side.segs[i].para = (pl && pl.content) ? pl.content : '';
          if (pl && pl.file_path && !this.side.segs[i].file) this.side.segs[i].file = pl.file_path;
        } catch (err) {
          this.side.segs[i].para = '';
        }
        this.side.segs[i].loading = false;
      }
    },

    /* ---------- 工作区 ---------- */
    async switchWorkspace() {
      this.loading = true;
      this.centerId = '';
      // 工作区切换 = 重渲染 → 重新启动动画
      this._animStop = false;
      // 切换工作区时销毁旧网络再重建，避免复用旧容器尺寸/状态导致新图谱被收紧成「一圈」
      this.stopPulse();
      if (this._stabTimer) { clearTimeout(this._stabTimer); this._stabTimer = null; }
      if (this.net) { try { this.net.destroy(); } catch (e) {} this.net = null; this.nodesDS = null; this.edgesDS = null; }
      // 页签名称 + 导航栏名称随子图变化
      document.title = this.currentMeta.name + ' · 妃子笑荔枝文化图谱';
      try {
        await this.loadTypes(this.ws);
        await this.loadGraph('');
      } finally { this.loading = false; }
    },

    async loadTypes(label) {
      const session = this.driver.session({ database: 'neo4j' });
      try {
        const res = await session.run(
          'MATCH (n:`' + label + '`) RETURN DISTINCT coalesce(n.entity_type, "其他") AS t ORDER BY t');
        this.typeList = res.records.map(r => r.get('t'));
        // 默认全选：进入子图即全部实体类型可见（图例“全选”勾选态）
        this.selectedTypes = this.typeList.slice();
        // 用与节点同源的 colorFor 分配（图例 ↔ 节点颜色一致）
        const colors = {};
        this.typeList.forEach(t => { colors[t] = colorFor(t); });
        this.typeColors = colors;
      } finally { await session.close(); }
    },

    /* ---------- 类型多选筛选（选择会被记住并持续生效） ---------- */
    toggleType(t) {
      const i = this.selectedTypes.indexOf(t);
      if (i >= 0) this.selectedTypes.splice(i, 1);
      else this.selectedTypes.push(t);
      this.applyTypeFilter();
    },
    // 全选：勾选所有实体类型 → 全部可见
    selectAllTypes() {
      this.selectedTypes = this.typeList.slice();
      this.applyTypeFilter();
    },
    // 全部不选：清空所有勾选 → 不显示任何实体类型
    selectNoneTypes() {
      this.selectedTypes = [];
      this.applyTypeFilter();
    },
    /* 类型筛选变化 → 重算可见性（只切 hidden，不重画） */
    applyTypeFilter() { this.refreshVisibility(); },

    // 统一可见性：实体类型筛选 AND 跳数隐藏（两者叠加生效）
    refreshVisibility() {
      if (!this.nodesDS || !this.edgesDS) return;
      // 1) 跳数可见集合（sub 模式 → BFS；all 模式 → 不做跳数限制）
      let hopKeep = null;
      if (this.hopsMode === 'sub' && this.centerId != null && this.centerId !== '' && this._adj) {
        hopKeep = new Set([this.centerId]);
        let frontier = [this.centerId];
        for (let d = 0; d < this.hops && frontier.length; d++) {
          const next = [];
          for (const id of frontier) {
            const ns = this._adj[id];
            if (!ns) continue;
            for (const nid of ns) { if (!hopKeep.has(nid)) { hopKeep.add(nid); next.push(nid); } }
          }
          frontier = next;
        }
      }
      // 2) 类型可见集合：勾选了才显示（“全部不选”= 空集合 → 不显示任何类型）
      const visTypes = new Set(this.selectedTypes);
      // 3) 逐节点：目标中心节点豁免类型筛选（选中它看子图时永远不能隐藏）；
      //    其余节点：类型已勾选 且（无跳数限制 或 在跳数集合内）→ 显示
      const nodeUpd = [];
      const visible = new Set();
      this.nodesDS.forEach(n => {
        const isCenter = (this.centerId != null && n.id === this.centerId);
        const okType = isCenter || visTypes.has(n.group);
        const okHop = !hopKeep || hopKeep.has(n.id);
        const show = okType && okHop;
        if (show) visible.add(n.id);
        if ((n.hidden || false) === show) nodeUpd.push({ id: n.id, hidden: !show });
      });
      if (nodeUpd.length) this.nodesDS.update(nodeUpd);
      // 4) 边：两端都可见才显示
      const edgeUpd = [];
      this.edgesDS.forEach(e => {
        const show = visible.has(e.from) && visible.has(e.to);
        if ((e.hidden || false) === show) edgeUpd.push({ id: e.id, hidden: !show });
      });
      if (edgeUpd.length) this.edgesDS.update(edgeUpd);
    },

    // 按跳数隐藏：复用统一可见性（AND 叠加类型筛选），只切 hidden（不重画、全程一张图）
    applyHopsFilter() { this.refreshVisibility(); },

    /* ---------- 工具栏动作 ---------- */
    searchGo() { this.centerId = null; this.loadGraph(this.keyword.trim()); },
    // 跳数变化：不重画，仅在“有中心节点”时按新跳数切换隐藏；无中心则保持全图
    onHopsChange() {
      this.hopsMode = (this.centerId != null && this.centerId !== '') ? 'sub' : 'all';
      this.applyHopsFilter();
      this.setStatus(true, this.hopsMode === 'sub'
        ? ('已显示「中心节点」' + this.hops + ' 跳邻居')
        : ('跳数 ' + this.hops + '（点击节点后生效）'));
    },
    reload() { this.loadGraph(this.keyword.trim()); },
    // 显示全部：清除跳数隐藏，回到全图（不禁用实体类型筛选，选择会记住）
    showAll() {
      this.keyword = '';
      this.centerId = '';
      this.hopsMode = 'all';
      this.refreshVisibility();
      this.fitView();
    },
    fitView() { if (this.net) this.net.fit({ animation: true }); },

    /* ---------- 关系名称显示开关 ---------- */
    relLabel(ds) {
      const s = (Array.isArray(ds) ? ds[0] : '') || '';
      return s.length > 16 ? s.slice(0, 16) + '…' : s;
    },
    toggleRel() {
      this.showRel = !this.showRel;
      if (!this.edgesDS || !this.net) return;
      // 1) 改每条边的 label（数据层）
      this.edgesDS.update(this.edgesDS.get().map(e => ({
        id: e.id, label: this.showRel ? this.relLabel(e.raw) : ''
      })));
      // 2) 改 edges.font.size（渲染层）：size:0 让 vis-network 不再画文字，
      //    仅改 label 字符串在某些版本下不会立刻清掉已渲染的标签缓存。
      const base = this.edgeFontBase;
      this.net.setOptions({
        edges: {
          font: this.showRel
            ? { ...base }
            : { ...base, size: 0, strokeWidth: 0, background: 'rgba(0,0,0,0)' }
        }
      });
      // 3) 触发一次画布重绘，确保字号变化立即生效
      this.net.redraw();
      this.setStatus(true, this.showRel ? '已显示关系名称' : '已隐藏关系名称');
    },

    /* ---------- 图查询 ---------- */
    async loadGraph(searchText) {
      const label = this.ws;
      const limit = this.limitNum;
      this.loading = true;
      const t0 = performance.now();
      try {
        const session = this.driver.session({ database: 'neo4j' });
        let nodes, edges, centerIds = [];
        try {
          if (searchText) {
            const res = await this.radialFetch(session, label, searchText, limit, this.hops);
            nodes = res.nodes; edges = res.edges; centerIds = res.centerIds;
          } else {
            this.centerId = null;
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
            const r1 = await session.run(q1, { typeFs: this.typeFs, limit: neo4j.int(limit) });
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
        this.renderGraph(nodes, edges, centerIds);
        const ms = Math.round(performance.now() - t0);
        if (searchText && !nodes.length) {
          this.setStatus(true, '未找到匹配实体（仅支持名称子串）');
        } else {
          const pre = centerIds.length ? ('中心 ' + centerIds.length + ' · ') : '';
          const tf = this.selectedTypes.length ? ('已筛类型 ' + this.selectedTypes.length + ' 种 · ') : '';
          this.setStatus(true, tf + pre + '节点 ' + nodes.length + ' · 关系 ' + edges.length + ' · 加载耗时 ' + ms + 'ms');
        }
      } catch (err) {
        console.error(err);
        this.setStatus(false, '加载失败: ' + (err.message || err));
      } finally { this.loading = false; }
    },

    // 辐射状 k 跳搜索：中心按名称匹配（不受类型筛选），邻居按类型筛选
    async radialFetch(session, label, kw, cap, hops) {
      const typeFs = this.typeFs;
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
      for (let h = 1; h <= hops && frontier.length && seen.size < cap; h++) {
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
    },

    // 以被点击节点为中心做 k 跳展开（邻居同样吃类型筛选）
    async expandFromNode(nodeId, hops) {
      const label = this.ws;
      this.loading = true;
      const t0 = performance.now();
      try {
        const session = this.driver.session({ database: 'neo4j' });
        let center = null;
        const nodeMap = new Map();
        const edgeMap = new Map();
        const typeFs = this.typeFs;
        try {
          const rc = await session.run(
            'MATCH (n:`' + label + '`) WHERE id(n)=$id ' +
            'RETURN id(n) AS id, n.entity_id AS name, coalesce(n.entity_type,"其他") AS type, ' +
            'n.description AS descr, coalesce(n.source_id,"") AS src, coalesce(n.file_path,"") AS fp, ' +
            'properties(n) AS props',
            { id: neo4j.int(nodeId) });
          if (!rc.records.length) { this.setStatus(false, '节点不存在'); return; }
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
          for (let h = 1; h <= hops && frontier.length; h++) {
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
        this.centerId = nodeId;   // 记住中心，类型筛选变化时可复现
        this.renderGraph(nodes, edges, [nodeId]);
        this.showNodeSide(nodeId, true);
        if (this.net) this.net.focus(nodeId, { scale: 0.8, animation: { duration: 400 } });
        const ms = Math.round(performance.now() - t0);
        const pre = typeFs.length ? ('已筛类型 ' + typeFs.length + ' 种 · ') : '';
        this.setStatus(true, pre + '以「' + center.name + '」为中心 ' + hops + ' 跳 · 节点 ' +
          nodes.length + ' · 关系 ' + edges.length + ' · 加载耗时 ' + ms + 'ms');
      } catch (err) {
        console.error(err);
        this.setStatus(false, '展开失败: ' + (err.message || err));
      } finally { this.loading = false; }
    },

    /* ---------- vis-network 渲染（vis 内置布局 + 完全静态） ---------- */
    renderGraph(nodes, edges, centerIds) {
      // 数据已就绪 → 进入布局定位阶段：保持 loading 遮罩直到 stabilization 完成
      this.stabilizing = true;
      // 兜底：万一 stabilizationIterationsDone 未触发（极端情况），超时后强制收起遮罩
      if (this._stabTimer) clearTimeout(this._stabTimer);
      this._stabTimer = setTimeout(() => { this.stabilizing = false; }, 10000);
      const deg = {};
      edges.forEach(e => { deg[e.s] = (deg[e.s] || 0) + 1; deg[e.t] = (deg[e.t] || 0) + 1; });
      // 节点大小按度数做"非线性拉伸"（梯度拉大）
      const maxDeg = Math.max(1, ...Object.values(deg));
      const minSize = 8, maxSize = 38;
      this.nodesDS = new vis.DataSet(nodes.map(n => {
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
      this.edgesDS = new vis.DataSet(edges.map((e, i) => ({
        id: i, from: e.s, to: e.t, title: e.ds.join('\n'),
        label: this.showRel ? this.relLabel(e.ds) : undefined,
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
      if (!this.net) {
        this.net = new vis.Network(document.getElementById('net'),
          { nodes: this.nodesDS, edges: this.edgesDS }, options);
        this.net.on('click', p => this.onPick(p));
        this.net.on('doubleClick', p => {
          if (p.nodes.length) this.net.focus(p.nodes[0], { scale: 1.1 });
        });
        // 在顶层绘制层叠加「选中中心光晕 + 连线脉冲」（浅→深循环）
        this.net.on('afterDrawing', ctx => this.drawPulse(ctx));
      } else {
        this.net.setData({ nodes: this.nodesDS, edges: this.edgesDS });
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
      this.nodesDS.update(colorUpd);

      // 保存全图邻接表（用于按跳数隐藏远处节点）
      const adj = {};
      for (const e of edges) {
        if (!adj[e.s]) adj[e.s] = new Set();
        if (!adj[e.t]) adj[e.t] = new Set();
        adj[e.s].add(e.t);
        adj[e.t].add(e.s);
      }
      this._adj = adj;
      this._allNodeIds = nodes.map(n => n.id);
      this._allEdgeIds = edges.map((e, i) => i);
      this.hopsMode = 'all';

      // vis-network 内置 layout 完成（stabilizationIterationsDone）后保留极慢的 physics
      //   弹簧调很弱、阻尼很大 → 节点只在自己周围轻微浮动（不会互相重叠）
      //   用户点击节点 → onPick 中 stopPhysics 关闭 → 完全静止
      this.net.once('stabilizationIterationsDone', () => {
        if (!this.net) return;
        // 布局完成 → 收起 loading 遮罩（图谱已经可见，消除断裂感）
        this.stabilizing = false;
        if (this._stabTimer) { clearTimeout(this._stabTimer); this._stabTimer = null; }
        // 切到极慢模式：弱弹簧 + 高阻尼，节点只做微幅摆动
        this.net.setOptions({
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
        if (this.centerId != null && this.centerId !== '') {
          try {
            this.net.focus(this.centerId, { scale: 0.85, locked: false,
              animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
          } catch (e) {}
        }
      });
    },

    beforeUnmount() {
      // 清理动画循环与定时器，避免组件销毁后仍有重绘/遮罩残留
      this.stopPulse();
      if (this._stabTimer) { clearTimeout(this._stabTimer); this._stabTimer = null; }
    },

    /* ---------- 点节点/点边 → 侧栏 ---------- */
    // 点击节点：放大高亮 → focus 到屏幕中央 → 永久冻结动画 → 展示详情
    onPick(params) {
      // 点击 → 立刻关掉 vis-network physics（节点永久静止，冻结到当前布局）
      if (this.net && (params.nodes.length || params.edges.length)) {
        this.net.setOptions({ physics: { enabled: false } });
      }
      // 高亮 + focus 屏幕中央
      if (this.net) {
        if (params.nodes.length) {
          // 高亮节点：临时把选中节点的 size 加大 + 改用特殊高亮色（琥珀色 #f59e0b）
          //   与按 type 分配的 group color 区分开
          const id = params.nodes[0];
          // 设为中心 → 按当前跳数隐藏远处节点（只切 hidden，不重画）
          this.centerId = id;
          this.hopsMode = 'sub';
          this.applyHopsFilter();
          const n = this.nodesDS.get(id);
          if (n) {
            this.nodesDS.update({
              id,
              size: (n.size || 14) * 1.7,
              shadow: { enabled: true, color: '#fb923c', size: 28 },
              borderWidth: 4,
              color: { background: '#f59e0b', border: '#9a3412', highlight: { background: '#f59e0b', border: '#9a3412' } }
            });
          }
          // 取消之前的选中状态（除当前节点）
          if (this._selectedId && this._selectedId !== id) {
            const prev = this.nodesDS.get(this._selectedId);
            if (prev) {
              this.nodesDS.update({
                id: this._selectedId,
                size: prev._origSize || prev.size,
                shadow: prev._origShadow,
                borderWidth: prev._origBorder,
                color: prev._origColor
              });
            }
          }
          this._selectedId = id;
          // focus 到屏幕中央（带动画）
          this.net.focus(id, { scale: 1.0, locked: false,
            animation: { duration: 600, easingFunction: 'easeInOutQuad' } });
          // 开启中心节点光晕 + 连线脉冲动画（浅→深循环）
          this.startPulse();
        } else if (params.edges.length) {
          // 点边：不需要居中节点
        } else {
          // 点空白：保持当前视图（不调用 fit/focus/zoom），仅清掉之前选中节点的高亮与脉冲动画
          // 点空白：取消选中 + 停止脉冲动画
          if (this._selectedId) {
            const prev = this.nodesDS.get(this._selectedId);
            if (prev) this.nodesDS.update({
              id: this._selectedId,
              size: prev._origSize || prev.size,
              shadow: prev._origShadow,
              borderWidth: prev._origBorder,
              color: prev._origColor
            });
            this._selectedId = null;
            this.stopPulse();
          }
          // 冻结视图：刚才的 focus 动画可能还在跑，立刻 moveTo 到当前位置把它定住
          // （这样空白点击不会再让视野继续移动）
          if (this.net && this.net.getViewPosition) {
            try {
              const p = this.net.getViewPosition();
              const sc = this.net.getScale();
              this.net.moveTo({ position: p, scale: sc, animation: false });
            } catch (e) {}
          }
        }
      }
      // 点击节点 → 仅移动视图 + 高亮 + 详情（不重新画图）
      if (params.nodes.length) {
        this.showNodeSide(params.nodes[0], false);
      } else if (params.edges.length) {
        const e = this.edgesDS.get(params.edges[0]);
        if (!e) return;
        const a = this.nodesDS.get(e.from), b = this.nodesDS.get(e.to);
        const edgeSrcIds = splitSep((e.srcs || []).find(x => x) || '');
        const edgeFps = splitSep((e.fps || []).find(x => x) || '');
        this.side = {
          visible: true, id: 0,
          name: (a ? a.raw.name : '?') + ' → ' + (b ? b.raw.name : '?'),
          type: (e.names && e.names[0]) || '关系', isCenter: false,
          descr: e.raw.join('\n').replace(/<SEP>/g, '；'),
          srcIds: edgeSrcIds,
          fps: edgeFps,
          rels: [], segs: []
        };
        this.populateSegs(edgeSrcIds, edgeFps);
      } else {
        this.side.visible = false;
      }
    },

    /* ---------- 选中中心节点：从内向外辐射光晕 + 邻边稳定加深 ---------- */
    // 选中节点时：把与它相连的可见边一次性加深（固定深灰，不闪烁、不变蓝），
    // 用于「视觉强调邻边」；同时用 rAF 驱动光晕叠加层（drawPulse）。
    // 点击空白 → stopPulse → 邻边颜色还原为 undefined（回落全局默认色）。
    startPulse() {
      this.stopPulse();   // 先清理旧循环并还原上一中心连线的颜色
      this.updateEdgeFlash();   // 一次性加深邻边（幂等）
      const loop = () => {
        if (!this.net || !this._selectedId) { this._pulseRaf = null; return; }
        try { this.net.requestRedraw(); } catch (e) {}
        this._pulseRaf = requestAnimationFrame(loop);
      };
      this._pulseRaf = requestAnimationFrame(loop);
    },
    // 停止动画：取消 rAF，并把动画期间改过色的边还原为“原色”（原来什么连线还原成什么）
    stopPulse() {
      if (this._pulseRaf) { cancelAnimationFrame(this._pulseRaf); this._pulseRaf = null; }
      if (this._pulseEdges.length && this.edgesDS) {
        this.edgesDS.update(this._pulseEdges.map(id => ({ id, color: undefined })));
      }
      this._pulseEdges = [];
    },
    // 邻边加深：把与中心相连的可见边颜色固定设为深灰 #64748b（比基色 #94a3b8 深一档），
    // 仅执行一次（颜色已一致则跳过），不做循环闪烁。
    updateEdgeFlash() {
      const id = this._selectedId;
      if (id == null || !this.edgesDS) return;
      const hex = '#64748b';   // 固定深灰（强调邻边，不用蓝色）
      const upd = [];
      const flashIds = [];
      this.edgesDS.forEach(e => {
        const rel = (e.from === id && e.to === id) ? false : (e.from === id || e.to === id);
        if (!rel) return;
        const nbId = e.from === id ? e.to : e.from;
        const nbNode = this.nodesDS.get(nbId);
        if (!nbNode || nbNode.hidden) return;   // 只强调当前可见的边（隐藏的不动）
        // 只在颜色还没设成强调色时才更新，减少 DataSet 写入
        const cur = e.color && e.color.color;
        if (cur !== hex) upd.push({
          id: e.id,
          color: { color: hex, highlight: '#1f6feb', hover: '#1f6feb', opacity: 0.8 }
        });
        flashIds.push(e.id);
      });
      if (upd.length) this.edgesDS.update(upd);
      this._pulseEdges = flashIds;
    },
    // 顶层叠加：中心节点“从内向外辐射”的呼吸光环（空心圆环，`lighter` 叠加，
    // 只描外圈、中心无填充 → 不遮住节点本身；从节点边缘向远处扩散）
    drawPulse(ctx) {
      if (!this.net) return;
      const id = this._selectedId;
      if (id == null) return;
      let pos;
      try { pos = this.net.getPositions([id]); } catch (e) { return; }
      if (!pos || !pos[id]) return;
      const { x, y } = pos[id];
      const n = this.nodesDS && this.nodesDS.get(id);
      if (!n) return;
      const baseR = (n.size || 14) * 0.9;
      // 相位 0..1：半径从内圈外扩到更远，形成“从内向外辐射”的扩散光晕
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
      // 第三圈：近端柔光，强化“由内向外”的发光感（贴近节点边缘的雾化光环）
      ctx.beginPath();
      ctx.arc(x, y, baseR + 6 + p * 4, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${amber}, ${0.16 + p * 0.2})`;
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.restore();
    },

    // 侧栏展示某个节点的详情与关系列表
    showNodeSide(id, isCenter) {
      const n = this.nodesDS && this.nodesDS.get(id);
      if (!n) { this.side.visible = false; return; }
      const rels = this.edgesDS.get().filter(e => e.from === id || e.to === id);
      const nameOf = x => { const o = this.nodesDS.get(x); return o ? o.raw.name : '?'; };
      const srcIds = splitSep(n.raw.src || ''), fps = splitSep(n.raw.fp || '');
      const props = n.raw.props || {};
      const extraProps = this.extractExtraProps(props);
      // 每次切换节点都重置折叠态：描述/属性默认展开
      this.descrOpen = !!((n.raw.descr || '').replace(/<SEP>/g, '；').trim());
      this.attrsOpen = extraProps.length > 0;
      this.side = {
        visible: true, id, name: n.raw.name, type: n.raw.type,
        isCenter: isCenter !== undefined ? !!isCenter : !!n.raw.isCenter,
        descr: (n.raw.descr || '').replace(/<SEP>/g, '；'),
        props, extraProps, srcIds, fps, segs: [],
        rels: rels.slice(0, 30).map((e, i) => {
          const dir = e.from === id;
          const d = (e.raw || []).join(' / ').replace(/<SEP>/g, '；');
          return {
            key: i, dir, other: nameOf(dir ? e.to : e.from),
            name: (e.names && e.names.find(x => x)) || '',
            d,
            srcIds: splitSep((e.srcs || []).find(x => x) || ''),
            fps: splitSep((e.fps || []).find(x => x) || '')
          };
        })
      };
      this.populateSegs(srcIds, fps);
    }
  },

  template: `
  <div class="graph-page">
    <div id="bar">
      <span class="brand">
        <span class="bbadge" :style="{background: currentMeta.color}">{{ currentMeta.badge }}</span>
        <span class="title">{{ currentMeta.name }}</span>
      </span>
      <el-button size="small" @click="goHome">‹ 导航</el-button>
      <el-button size="small" type="primary" @click="goQuery">智能问答</el-button>
      <label class="lbl">图谱</label>
      <el-select :model-value="ws" @change="onWsChange" style="width:170px" filterable>
        <el-option v-for="o in wsOptions" :key="o.v" :value="o.v" :label="o.t"></el-option>
      </el-select>
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
        <div class="descr" v-if="side.descr">
          <div class="section-head" @click="descrOpen = !descrOpen">
            <span class="sh-title">描述</span>
            <span class="sh-tog">{{ descrOpen ? '收起 ▲' : '展开 ▼' }}</span>
          </div>
          <div class="descr-body" v-show="descrOpen">{{ side.descr }}</div>
        </div>

        <!-- 自定义属性表（Neo4j properties 中除保留键外的字段） -->
        <div class="attrs" v-if="side.extraProps && side.extraProps.length">
          <div class="section-head" @click="attrsOpen = !attrsOpen">
            <span class="sh-title">属性（{{ side.extraProps.length }}）</span>
            <span class="sh-tog">{{ attrsOpen ? '收起 ▲' : '展开 ▼' }}</span>
          </div>
          <table class="attrs-table" v-show="attrsOpen">
            <tbody>
              <tr v-for="p in side.extraProps" :key="p.key">
                <th>{{ p.label }}</th>
                <td>{{ p.value }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="chunks" v-if="side.segs && side.segs.length">
          <div class="chunk" v-for="(s,i) in side.segs" :key="'n'+i" :class="{collapsed: !s.expanded}">
            <div class="chunk-head" @click="s.expanded = !s.expanded">
              <span class="chunk-idx">原文片段 {{ i+1 }}</span>
              <span class="chunk-tog">{{ s.expanded ? '收起 ▲' : '展开 ▼' }}</span>
            </div>
            <div class="chunk-scroll" v-show="s.expanded">
              <div class="chunk-para" v-if="!s.loading && s.para">{{ s.para }}</div>
              <div class="chunk-para dim" v-else-if="s.loading">原文片段载入中…</div>
              <div class="chunk-para dim" v-else>（未检索到该原文片段）</div>
            </div>
            <!-- 前两个 chunk 始终显示原文按钮；第 3+ 按钮跟随展开态 -->
            <button class="isrc-open chunk-open" :class="{disabled: !s.file}"
              v-show="i < 2 || s.expanded"
              :disabled="!s.file" @click.stop="openOriginalFile(s.file)">
              {{ s.file ? '查看原文网页' : '暂无原文链接' }}
            </button>
          </div>
        </div>
        <div class="chunks" v-else>
          <div class="chunk">
            <div class="chunk-head">原文片段</div>
            <div class="chunk-scroll"><span class="dim">（该节点未记录原文来源）</span></div>
            <button class="isrc-open chunk-open disabled" disabled>暂无原文链接</button>
          </div>
        </div>
      </div>
    </div>
    <div id="legend" v-show="typeList.length">
      <div class="lhead">实体类型（勾选筛选，选择会被记住）</div>
      <el-checkbox class="legend-ck legend-batch" :model-value="allSelected"
        @change="selectAllTypes">全选</el-checkbox>
      <el-checkbox class="legend-ck legend-batch" :model-value="noneSelected"
        @change="selectNoneTypes">全部不选</el-checkbox>
      <el-checkbox v-for="t in typeList" :key="t" class="legend-ck"
        :model-value="selectedTypes.includes(t)" @change="toggleType(t)">
        <span class="sw" :style="{background: typeColors[t] || '#888'}"></span>{{ t }}
      </el-checkbox>
    </div>
    <!-- 全屏加载遮罩：取数阶段 + 布局定位阶段都保持，直到图谱真正可见 -->
    <div id="loading" v-show="loading || stabilizing">
      <div class="loading-card">
        <div class="loading-spin"></div>
        <div class="loading-title">{{ loadTitle }}</div>
        <div class="loading-sub">{{ loadSub }}</div>
      </div>
    </div>
  </div>`
});
