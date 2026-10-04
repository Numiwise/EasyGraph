<!--
  HomeView.vue —— 导航首页：七个图谱的跳转工具
  ------------------------------------------------------------
  路由：/  （HomeView，App.vue 默认入口）
  行为：
    - 顶部一个大 Banner + "向 AI 提问" 的跳转按钮
    - 中部一个"总图谱"特色横卡（master featured）
    - 底部"专题子图"网格（6 个子库，2-3 列自适应）
    - 点击任意卡片 → 用 window.open 在新标签页打开对应的 /graph/:ws 子图
    - 右上角"快速开始"三步骤说明

  与外部的接口：
    - 数据来源：composables/useNeo4j.js 的 WS_META（7 个 workspace 元数据）
                  和 listWorkspaceCounts()（每库节点/关系数）。
    - 跳转目标：#/graph/<ws>（GraphView 在新页签打开，避免覆盖当前导航页）。

  Vue 3 涉及的概念（给初学者）：
    - Composition API：用 ref/reactive/computed/onMounted 替代 Vue 2 的 data/computed/mounted。
    - window.open：浏览器原生 API，在新页签打开 URL。
    - requestAnimationFrame：按帧执行动画，比 setTimeout 更平滑。
-->
<template>
  <!-- 整页容器：height:100% 让 flex 撑满 #app 节点 -->
  <div class="home">
    <!-- 顶部"英雄区"（左侧标题 + CTA、右侧"快速开始"3 步骤） -->
    <div class="home-head">
      <div class="home-hero-l">
        <h1>知 识 图 谱 问 答</h1>
        <p class="subtitle">浏览关系网络 · 向 AI 提问 · 答案溯源</p>
        <div class="cta-row">
          <!-- Element Plus 的按钮，type=primary 用品牌色，round 是圆角胶囊 -->
          <el-button type="primary" round @click="goQuery">向 AI 提问<span class="cta-arrow">→</span></el-button>
          <span class="ctahint">输入问题 → 基于图谱与原文回答 → 引用链接可点开</span>
        </div>
        <!-- 三个数字（动数字滚动）：实体数 / 关系数 / 子图数 -->
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

    <!-- 卡片区：featured 卡片（总图谱） + 专题子图网格 -->
    <div class="cards">
      <div class="master-row">
        <!--
          总图谱的特色横卡：点击触发 enter(master.id)。
          --accent 是 CSS 变量，让样式内部能用 var(--accent) 引用颜色。
        -->
        <div v-if="master" class="card featured" :style="{ '--accent': master.color }" @click="enter(master.id)">
          <span class="bar" :style="{background: master.color}"></span>
          <div class="badge" :style="{background: master.color}">{{ master.badge }}</div>
          <div class="body">
            <h3>{{ master.name }}</h3>
            <p>{{ master.desc }}</p>
            <div class="foot">
              <span v-if="counts[master.id] !== undefined" class="count">
                <b>{{ counts[master.id] }}</b> 实体 · <b>{{ rels[master.id] || 0 }}</b> 关系
              </span>
              <span v-else class="count dim">暂无数据</span>
              <span class="go">进入图谱 <span>→</span></span>
            </div>
          </div>
        </div>
      </div>

      <!-- 6 个子库 grid（动态列数） -->
      <div class="sub-title">专题子图<span>按主题分维度浏览</span></div>
      <!--
        :class="['c' + subCols]" 是动态 class 拼接。
        比如 subCols=3 → 'c3' → CSS 选择器 .sub-grid.c3 → 3 列布局。
        这样可以用纯 CSS 控制列数，避免在 style 里写动态 grid-template。
      -->
      <div class="sub-grid" :class="['c' + subCols]">
        <div v-for="m in subs" :key="m.id" class="card"
          :style="{ '--accent': m.color }" @click="enter(m.id)">
          <span class="bar" :style="{background: m.color}"></span>
          <div class="badge" :style="{background: m.color}">{{ m.badge }}</div>
          <div class="body">
            <h3>{{ m.name }}</h3>
            <p>{{ m.desc }}</p>
            <div class="foot">
              <span v-if="counts[m.id] !== undefined" class="count">
                <b>{{ counts[m.id] }}</b> 实体 · <b>{{ rels[m.id] || 0 }}</b> 关系
              </span>
              <span v-else class="count dim">暂无数据</span>
              <span class="go">进入图谱 <span>→</span></span>
            </div>
          </div>
        </div>
      </div>

      <!-- 文档管理入口（方案 C）
           跳转 LightRAG 官方 WebUI（/lightrag/<ws>/webui/）。
           nginx 已在反代时自动注入 API Key，浏览器无需输入密码。
           target="_blank" 新标签页打开，不覆盖大屏。 -->
      <div class="docs-row">
        <div class="docs-title">
          <span class="docs-icon">📄</span>
          <span>文档管理入口</span>
          <span class="docs-subtitle">LightRAG 官方 UI · 上传 / 索引进度 / 重新处理</span>
        </div>
        <div class="docs-grid">
          <a v-for="m in WS_META" :key="m.id"
             :href="'/lightrag/' + m.id + '/webui/'"
             target="_blank" rel="noopener"
             class="doc-link"
             :style="{ '--accent': m.color }">
            <span class="bar" :style="{background: m.color}"></span>
            <span class="doc-name">{{ m.name }}</span>
            <span class="doc-badge" :style="{background: m.color}">{{ m.badge }}</span>
            <span class="doc-go">打开 →</span>
          </a>
        </div>
        <div class="docs-hint">已配置 nginx 自动注入 API Key，访问官方 UI 无需登录 · 支持文件上传 / 索引进度查看 / 文档重新处理</div>
      </div>
    </div>
  </div>
</template>

<script setup>
/* ============================================================
 * 导入区
 * ============================================================ */
// 从 vue 引入组合式 API
import { ref, computed, onMounted } from 'vue';

// 从 composables/useNeo4j.js 引入：
//   WS_META            —— 7 个 workspace 的展示元数据
//   api                —— 后端 api-bridge 封装，不再直连 Neo4j
import { WS_META, api } from '../composables/useNeo4j.js';

/* ============================================================
 * 响应式状态（原 Vue 2 data()）
 * ============================================================ */
// 每个 workspace 的节点数（来自 listWorkspaceCounts().nodes）
const counts = ref({});
// 每个 workspace 的关系数（rels）
const rels = ref({});

// 显示用的"动画滚动"数字：
//   - 容器始终渲染（数字 0~to），所以不会因为出现/隐藏元素造成页面抖动
//   - 数据回来后用 animateCount 从 0 滚到目标值
const displayNodes = ref(0);
const displayRels = ref(0);
// 子图数固定为 6，不需要动画
const displaySubs = ref(6);

/* ============================================================
 * 计算属性（原 computed）
 * ============================================================ */
// master: 找到 id 为 g00_master_all 的元数据（总图谱）
// find 返回第一个匹配的元素，没找到时是 undefined
const master = computed(() => WS_META.find(m => m.id === 'g00_master_all'));
// subs: 其它 6 个子库
// filter 返回"剩下"的所有元素的数组
const subs = computed(() => WS_META.filter(m => m.id !== 'g00_master_all'));

// 是否已拿到数据（counts 不是空对象）
// 所有 workspace 的实体总数（reduce 累加）
const total = computed(() => Object.values(counts.value).reduce((a, b) => a + (b || 0), 0));
const totalRels = computed(() => Object.values(rels.value).reduce((a, b) => a + (b || 0), 0));

/* ------------------------------------------------------------
 * 子图网格的列数（动态决定）
 * 目标：让行内卡片"尽量均匀"，避免出现"最后一行只有 1 张"的尴尬
 * 规则：
 *   n ∈ {1}            → 1 列
 *   n ∈ {2, 4}         → 2 列（行数 1 或 2）
 *   n ∈ {3, 6, 9}      → 3 列
 *   其它（5, 7, 8...） → 找 ≤ n 的最大因数 c，让最后一行至少 2 张
 * ------------------------------------------------------------ */
const subCols = computed(() => {
  const n = subs.value.length;
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
});

/* ============================================================
 * 动作（原 Vue 2 methods）
 * ============================================================ */
// "向 AI 提问"：跳转到 /query 路由（新标签页打开）
function goQuery() {
  const url = window.location.origin + window.location.pathname + '#/query?ws=g00_master_all';
  window.open(url, '_blank');
}

// 点击子图卡片：新标签页打开对应子图
//   注意用 hash 路由：原地址 + "#/graph/<ws>"
//   这样可以让用户把"对话页"和"图谱"同时打开比对
function enter(ws) {
  const url = window.location.origin + window.location.pathname + '#/graph/' + ws;
  window.open(url, '_blank');
}

/* ------------------------------------------------------------
 * animateCount(from, to, setter) —— 数字从 from 滚动到 to
 * 实现：requestAnimationFrame + easeOutCubic（开头快结尾缓）
 * 时间：约 600ms 完成
 *
 * 用法：
 *   animateCount(0, 1234, (v) => { displayNodes.value = v; });
 *   第一次的 from 可以是当前已有的数字（再次切换 ws 时也能平滑跳转）。
 * ------------------------------------------------------------ */
function animateCount(from, to, setter) {
  if (from === to || !to) { setter(to); return; }   // 同值或 0 直接结束
  const dur = 600;
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    // easeOutCubic：1 - (1-k)^3，曲线开头快结尾缓
    const eased = 1 - Math.pow(1 - k, 3);
    const val = Math.round(from + (to - from) * eased);
    setter(val);
    if (k < 1) requestAnimationFrame(step);          // 还没到 100%，继续下一帧
  };
  requestAnimationFrame(step);
}

/* ============================================================
 * 生命周期（原 mounted）
 * ------------------------------------------------------------
 * 流程：
 *   1) 设置 document.title
 *   2) api.counts() 拿所有 workspace 的节点/关系数（由后端查询 Neo4j）
 *   3) 把数字"动画滚"到目标值
 * ============================================================ */
onMounted(async () => {
  document.title = '知识图谱问答';
  try {
    const s = await api.counts();
    // s 可能是 { nodes, rels }，做兼容
    counts.value = s && s.nodes ? s.nodes : s;
    rels.value = (s && s.rels) ? s.rels : {};

    // 数据回来后用数字滚动动画"跳"到目标值（视觉上更生动）
    animateCount(displayNodes.value, total.value, (val) => { displayNodes.value = val; });
    animateCount(displayRels.value, totalRels.value, (val) => { displayRels.value = val; });
  } catch (err) {
    console.error('加载 counts 失败:', err.message || String(err));
  }
});
</script>

<style scoped>
/* ============================================================
 * HomeView 专属样式（统一内联在 <style scoped>，与组件内聚）
 * ============================================================ */
.home {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  /* 三层径向渐变 + 一层线性渐变叠成"晨曦中的山水"背景 */
  background:
    radial-gradient(1200px 600px at 50% -6%, #c9dcf2 0%, rgba(201, 220, 242, 0) 68%),
    radial-gradient(900px 680px at 100% 104%, #c9e2d3 0%, rgba(201, 226, 211, 0) 62%),
    radial-gradient(840px 560px at 0% 102%, #dccdf0 0%, rgba(220, 205, 240, 0) 60%),
    linear-gradient(135deg, #e6edf7 0%, #e4e2f3 48%, #ece5f0 100%);
}

/* 顶部"英雄区"：栅格两列（1.2 : 1），移动端会塌成 1 列 */
.home-head {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 24px;
  align-items: center;
  max-width: 1280px;
  margin: 0 auto;
  padding: 28px 28px 18px;
}
.home-head .home-hero-l { display: flex; flex-direction: column; gap: 8px; }

/* 大标题：渐变文字 + 文字剪裁技巧 */
.home-head h1 {
  font-size: 34px;
  font-weight: 900;
  letter-spacing: 2px;
  line-height: 1.15;
  background: linear-gradient(92deg, #b45309, #e67e22 40%, #db2777 80%, #6d28d9);
  -webkit-background-clip: text;          /* 让背景只显示在文字位置 */
  background-clip: text;
  -webkit-text-fill-color: transparent;  /* 文字本身透明，露出背景 */
  filter: drop-shadow(0 3px 10px rgba(180, 83, 9, .18));
}

/* 副标题、CTA 按钮、统计数字、小卡样式（……省略若干重复模式注释，仅留少量说明） */
.home-head .subtitle {
  color: var(--text-2); font-size: 14px; line-height: 1.7; letter-spacing: .3px; font-weight: 500; max-width: 520px;
}
.home-head .cta-row { display: flex; align-items: center; gap: 14px; margin-top: 6px; }
.home-head .cta-row :deep(.el-button) {
  height: 40px; padding: 0 22px; font-size: 14px; font-weight: 700; border-radius: 999px;
  box-shadow: 0 8px 20px rgba(31, 111, 235, .28);
}
.home-head .cta-row .cta-arrow { display: inline-block; margin-left: 6px; transition: transform 0.2s; }
.home-head .cta-row :deep(.el-button:hover) .cta-arrow { transform: translateX(4px); }
.home-head .ctahint { font-size: 14px; color: var(--text-2); font-weight: 500; }

/* 数字统计组：3 个半透明玻璃面板 */
.home-head .stats { display: flex; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
.home-head .stat {
  min-width: 110px; text-align: center; background: rgba(255, 255, 255, .78);
  border: 1px solid var(--border); border-radius: 12px; padding: 10px 16px;
  box-shadow: 0 5px 14px rgba(31, 45, 61, .10); backdrop-filter: blur(6px);
}
.home-head .stat .num {
  font-size: 22px; font-weight: 900; color: var(--primary);
  background: linear-gradient(92deg, #1f6feb, #9333ea);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; line-height: 1.1;
}
.home-head .stat .lbl {
  font-size: 11.5px; color: var(--text-2); font-weight: 600;
  margin-top: 2px; letter-spacing: .5px;
}

/* "快速开始"右栏：玻璃面板 + 3 步骤 */
.home-head .home-hero-r {
  background: rgba(255, 255, 255, .78); border: 1px solid var(--border);
  border-radius: 14px; padding: 18px 20px;
  box-shadow: 0 8px 22px rgba(31, 45, 61, .10); backdrop-filter: blur(8px);
}
.home-head .home-hero-r .hero-r-title {
  font-size: 14px; font-weight: 800; color: var(--text-1); letter-spacing: .5px;
  margin-bottom: 12px; display: flex; align-items: center; gap: 8px;
}
.home-head .home-hero-r .hero-r-title::before {
  content: ''; width: 4px; height: 14px; border-radius: 2px;
  background: linear-gradient(180deg, #1f6feb, #9333ea);
}
.home-head .home-hero-r .step-list { display: flex; flex-direction: column; gap: 8px; }
.home-head .home-hero-r .step { display: flex; gap: 10px; align-items: flex-start; }
.home-head .home-hero-r .step .n {
  flex: 0 0 22px; width: 22px; height: 22px; border-radius: 50%;
  background: linear-gradient(135deg, #1f6feb, #9333ea); color: #fff;
  font-size: 12px; font-weight: 800; display: flex; align-items: center; justify-content: center;
}
.home-head .home-hero-r .step .t {
  font-size: 12.5px; color: var(--text-1); line-height: 1.6; padding-top: 2px;
}
.home-head .home-hero-r .step .t b { color: var(--primary-strong); }

/* ------- 卡片区 ------- */
.cards { max-width: 1280px; margin: 0 auto; padding: 4px 28px 28px; display: flex; flex-direction: column; gap: 14px; }
.master-row { display: block; }
.master-row .card.featured { width: 100%; }

/* 专题子图小标题前面的小色条 */
.sub-title {
  display: flex; align-items: baseline; gap: 10px; font-size: 14px;
  font-weight: 800; color: var(--text-1); letter-spacing: .5px; padding-left: 6px; margin-top: 4px;
}
.sub-title span { font-size: 12px; font-weight: 500; color: var(--text-3); }
.sub-title::before {
  content: ''; display: inline-block; width: 4px; height: 14px; border-radius: 2px;
  background: linear-gradient(180deg, #1f6feb, #9333ea); align-self: center;
}

/* 子图网格：通过 class c1/c2/c3/c4 切换列数 */
.sub-grid { display: grid; gap: 12px; margin: 0; }
.sub-grid.c1 { grid-template-columns: repeat(1, minmax(0, 1fr)); }
.sub-grid.c2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.sub-grid.c3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.sub-grid.c4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
@media (max-width: 720px) {
  /* 移动端塌成单列、间距缩小 */
  .home-head { grid-template-columns: 1fr; padding: 18px; gap: 14px; }
  .home-head h1 { font-size: 26px; }
}

/* ------- 卡片公共样式（featured 和普通 sub 卡片共用） ------- */
.card {
  position: relative;
  color: #ffffff;
  cursor: pointer;
  overflow: hidden;
  background: linear-gradient(150deg, #3f568e 0%, #2c3e6b 55%, #4a3873 100%);
  border: 1px solid #1c2742;
  border-radius: 12px;
  padding: 12px 14px 12px 16px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
  box-shadow: 0 8px 18px rgba(28, 39, 66, .24);
}
.card::before {
  /* 顶部"光晕"用 ::before 伪元素叠加；inset:0 让它覆盖整个卡片 */
  content: ''; position: absolute; inset: 0; border-radius: 12px; pointer-events: none;
  /* 注意 radial-gradient 的位置参数不支持 var()，所以光晕中心用固定 50% -22% */
  background: radial-gradient(300px 130px at 50% -22%, var(--accent, #4fa3ff) 0%, rgba(0, 0, 0, 0) 70%);
  opacity: 0.20; transition: opacity 0.2s;
}
.card:hover {
  border-color: var(--accent, #1f6feb);
  transform: translateY(-3px);              /* 浮起 3 像素 */
  box-shadow: 0 14px 30px rgba(28, 39, 66, .40);
}
.card:hover::before { opacity: 0.38; }

/* 左侧"光条"（4px 宽），增强主题色感 */
.card .bar {
  position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
  background: var(--accent, #4fa3ff);
  box-shadow: 0 0 8px var(--accent, #4fa3ff);
}
/* 右上角徽标（显示"总/产/史..."的字符方块） */
.card .badge {
  position: absolute; top: 12px; right: 12px; width: 28px; height: 28px;
  border-radius: 8px; display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 900; color: #fff; background: var(--accent, #4fa3ff);
  box-shadow: 0 4px 10px rgba(31, 45, 61, .45);
}
.card .body { padding-right: 36px; min-width: 0; }
.card h3 {
  font-size: 15px; color: #ffffff; margin-bottom: 4px;
  font-weight: 800; letter-spacing: .3px; line-height: 1.3;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.card p {
  font-size: 12px; color: #d9e1f4; line-height: 1.55; min-height: 36px;
  opacity: 0.95; margin-bottom: 8px;
  display: -webkit-box; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.card .foot {
  display: flex; justify-content: space-between; align-items: center;
  margin-top: auto; font-size: 12px; gap: 6px;
}
.card .count {
  color: #ffffff; background: rgba(255, 255, 255, .18);
  border: 1px solid rgba(255, 255, 255, .32); border-radius: 999px;
  padding: 3px 10px; font-weight: 600; backdrop-filter: blur(4px); white-space: nowrap;
}
.card .count b { font-weight: 900; }
.card .count.dim {
  color: rgba(255, 255, 255, .75);
  background: rgba(255, 255, 255, .08);
  border-color: rgba(255, 255, 255, .16);
}
.card .go {
  color: #ffffff; opacity: 0.9; font-weight: 700;
  font-size: 12px; letter-spacing: .3px; white-space: nowrap;
}
.card .go span {
  display: inline-block; transition: transform 0.18s; margin-left: 4px;
}
.card:hover .go span { transform: translateX(3px); }     /* hover 时"→"轻轻向右滑 */

/* ------- 总图谱 featured 横卡（横向布局、稍大徽标） ------- */
.card.featured {
  display: flex; flex-direction: row; align-items: center;
  padding: 14px 18px; min-height: 0;
  background: linear-gradient(150deg, #4a3873 0%, #2c3e6b 45%, #1f6feb 100%);
  border-color: var(--accent, #4fa3ff);
  box-shadow: 0 10px 24px rgba(31, 111, 235, .28);
}
.card.featured .badge {
  position: static;          /* 让徽标在 flex 文档流里（不再是绝对定位） */
  flex: 0 0 38px; width: 38px; height: 38px;
  font-size: 17px; border-radius: 10px; margin-right: 14px;
}
.card.featured .body { flex: 1 1 auto; padding-right: 0; min-width: 0; }
.card.featured h3 { font-size: 17px; margin-bottom: 2px; white-space: normal; }
.card.featured p {
  font-size: 12.5px; line-height: 1.55; min-height: 0; margin-bottom: 4px;
  /* 单行截断 */
  line-clamp: 1;
}
.card.featured .foot { margin-top: 2px; font-size: 12px; }
.card.featured .count {
  background: rgba(255, 255, 255, .22);
  border-color: rgba(255, 255, 255, .4);
  padding: 3px 12px;
}

/* ------- 文档管理入口（LightRAG 官方 UI 跳转） ------- */
.docs-row {
  margin: 24px auto 8px;
  max-width: 1280px;
  padding: 0 28px;
}
.docs-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 15px;
  font-weight: 800;
  color: #2c3e6b;
  margin-bottom: 12px;
}
.docs-icon { font-size: 18px; }
.docs-subtitle {
  font-size: 12px;
  font-weight: 500;
  color: #6b7280;
}
.docs-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}
/* 文档链接：胶囊风格 + 左侧色条 + 主题色 hover */
.doc-link {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px 10px 16px;
  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(4px);
  border: 1px solid rgba(28, 39, 66, 0.12);
  border-radius: 10px;
  color: #1c2742;
  text-decoration: none;
  font-size: 13.5px;
  font-weight: 600;
  transition: transform 0.18s, box-shadow 0.18s, border-color 0.18s, background 0.18s;
  box-shadow: 0 2px 6px rgba(28, 39, 66, 0.06);
  overflow: hidden;
}
.doc-link::before {
  /* hover 时左上角光晕（用 ::before 伪元素，与 .card 一致的设计语言） */
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 10px;
  pointer-events: none;
  background: radial-gradient(180px 80px at 0% 0%, var(--accent, #4fa3ff) 0%, rgba(0,0,0,0) 70%);
  opacity: 0.10;
  transition: opacity 0.18s;
}
.doc-link:hover {
  border-color: var(--accent, #1f6feb);
  background: rgba(255, 255, 255, 0.92);
  transform: translateY(-2px);
  box-shadow: 0 8px 18px rgba(28, 39, 66, 0.14);
}
.doc-link:hover::before { opacity: 0.30; }
.doc-link .bar {
  position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
  background: var(--accent, #4fa3ff);
}
.doc-link .doc-name {
  flex: 1 1 auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.doc-link .doc-badge {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px; height: 22px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 900;
  color: #fff;
  background: var(--accent, #4fa3ff);
}
.doc-link .doc-go {
  flex: 0 0 auto;
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
  transition: transform 0.18s, color 0.18s;
}
.doc-link:hover .doc-go {
  color: var(--accent, #1f6feb);
  transform: translateX(2px);
}
.docs-hint {
  margin-top: 10px;
  font-size: 11.5px;
  color: #6b7280;
  line-height: 1.5;
}
@media (max-width: 720px) {
  .docs-row { padding: 0 18px; }
  .docs-grid { grid-template-columns: 1fr; }
}
</style>
