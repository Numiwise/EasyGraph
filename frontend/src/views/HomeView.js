/* ============================================================
 * 导航首页：七个图谱的跳转工具（路由 → /graph/:ws）
 * 点击卡片 = 在新浏览器页签打开对应子图
 *
 * Vue 3 兼容：仅添加 `import { defineComponent } from 'vue'`，原
 *   Options API 对象写法在 Vue 3 中依然完全支持。
 * ============================================================ */
import { defineComponent } from 'vue';
import { WS_META, listWorkspaceCounts, getDriver } from '../api/neo4j.js';

export default defineComponent({
  name: 'HomeView',
  data() {
    return {
      counts: {}, rels: {}, connected: false, error: '',
      // 统计显示值（从 0 动画滚到目标），用于容器始终渲染、避免页面跳动
      displayNodes: 0, displayRels: 0, displaySubs: 6
    };
  },
  async mounted() {
    document.title = '知识图谱问答';
    try {
      await getDriver().getServerInfo();
      this.connected = true;
      const s = await listWorkspaceCounts();
      this.counts = s && s.nodes ? s.nodes : s;
      this.rels = (s && s.rels) ? s.rels : {};
      // 数据回来后用数字滚动动画跳到目标值（视觉上"跳"上去，不会出现/隐藏造成错动）
      this.animateCount(this.displayNodes, this.total(), (val) => { this.displayNodes = val; });
      this.animateCount(this.displayRels, this.totalRels(), (val) => { this.displayRels = val; });
    } catch (err) {
      this.error = (err.message || String(err));
    }
  },
  methods: {
    // 跳转到溯源问答页（新页签打开，与子图一致）
    goQuery() {
      const url = window.location.origin + window.location.pathname + '#/query?ws=g00_master_all';
      window.open(url, '_blank');
    },
    // 新页签打开子图（hash 路由：原地址 + #/graph/<ws>）
    enter(ws) {
      const url = window.location.origin + window.location.pathname + '#/graph/' + ws;
      window.open(url, '_blank');
    },
    total() {
      return Object.values(this.counts).reduce((a, b) => a + (b || 0), 0);
    },
    totalRels() {
      return Object.values(this.rels).reduce((a, b) => a + (b || 0), 0);
    },
    // 数字滚动动画：from → to，用 easeOutCubic 让数字"跳"上去，~600ms
    animateCount(from, to, setter) {
      if (from === to || !to) { setter(to); return; }
      const dur = 600;
      const t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / dur);
        const eased = 1 - Math.pow(1 - k, 3);  // easeOutCubic：开头快结尾缓
        const val = Math.round(from + (to - from) * eased);
        setter(val);
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  },
  computed: {
    metas() { return WS_META; },
    hasCounts() { return Object.keys(this.counts).length > 0; },
    master() { return WS_META.find(m => m.id === 'g00_master_all'); },
    subs() { return WS_META.filter(m => m.id !== 'g00_master_all'); },
    /* 专题子图行数：根据子图数量选最接近均分的列数（2/3/4）
       - 6 → 3×2  |  5 → 不均匀，强制 2 或 3 列（这里选 3，余 1）
       - 4 → 2×2  |  3 → 3×1  |  2 → 2×1  |  1 → 1
       列数选择让 max(行间差) 最小 */
    subCols() {
      const n = this.subs.length;
      if (n <= 1) return 1;
      if (n === 2 || n === 4) return 2;
      if (n === 3 || n === 6 || n === 9) return 3;
      // 一般情况：找 ≤ n 的最大因数（避免出现最后一行只有 1 张卡的尴尬）
      let best = 2;
      for (let c = 4; c >= 2; c--) {
        const rows = Math.ceil(n / c);
        if (c * (rows - 1) >= n - 1) best = c;  // 最后一行至少 2 张
      }
      return best;
    }
  },
  template: `
  <div class="home">
    <div class="home-head">
      <div class="home-hero-l">
        <h1>知 识 图 谱 问 答</h1>
        <p class="subtitle">浏览关系网络 · 向 AI 提问 · 答案溯源</p>
        <div class="cta-row">
          <el-button type="primary" round @click="goQuery">向 AI 提问<span class="cta-arrow">→</span></el-button>
          <span class="ctahint">输入问题 → 基于图谱与原文回答 → 引用链接可点开</span>
        </div>
        <div class="stats">
          <div class="stat"><div class="num">{{ displayNodes }}</div><div class="lbl">图谱实体</div></div>
          <div class="stat"><div class="num">{{ displayRels }}</div><div class="lbl">语义关系</div></div>
          <div class="stat"><div class="num">{{ displaySubs }}</div><div class="lbl">专题子图</div></div>
        </div>
      </div>
      <div class="home-hero-r">
        <div class="hero-r-title">快速开始</div>
        <div class="step-list">
          <div class="step"><div class="n">1</div><div class="t"><b>选择子图</b>，浏览实体与关系</div></div>
          <div class="step"><div class="n">2</div><div class="t"><b>问 AI</b>：输入问题，AI 基于图谱与原文回答</div></div>
          <div class="step"><div class="n">3</div><div class="t">查看<b>引用</b>，点开即可查看原文出处</div></div>
        </div>
      </div>
    </div>
    <div class="cards">
      <div class="master-row">
        <div class="card featured" v-if="master" @click="enter(master.id)" :style="{ '--accent': master.color }">
          <span class="bar" :style="{background: master.color}"></span>
          <div class="badge" :style="{background: master.color}">{{ master.badge }}</div>
          <div class="body">
            <h3>{{ master.name }}</h3>
            <p>{{ master.desc }}</p>
            <div class="foot">
              <span class="count" v-if="counts[master.id] !== undefined">
                <b>{{ counts[master.id] }}</b> 实体 · <b>{{ rels[master.id] || 0 }}</b> 关系
              </span>
              <span class="count dim" v-else>暂无数据</span>
              <span class="go">进入图谱 <span>→</span></span>
            </div>
          </div>
        </div>
      </div>
      <div class="sub-title">专题子图<span>按主题分维度浏览</span></div>
      <div class="sub-grid" :style="{ '--cols': subCols }">
        <div class="card" v-for="m in subs" :key="m.id"
          @click="enter(m.id)" :style="{ '--accent': m.color }">
          <span class="bar" :style="{background: m.color}"></span>
          <div class="badge" :style="{background: m.color}">{{ m.badge }}</div>
          <div class="body">
            <h3>{{ m.name }}</h3>
            <p>{{ m.desc }}</p>
            <div class="foot">
              <span class="count" v-if="counts[m.id] !== undefined">
                <b>{{ counts[m.id] }}</b> 实体 · <b>{{ rels[m.id] || 0 }}</b> 关系
              </span>
              <span class="count dim" v-else>暂无数据</span>
              <span class="go">进入图谱 <span>→</span></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>`
});
