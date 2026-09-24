<!--
  导航首页：七个图谱的跳转工具（路由 → /graph/:ws）
  点击卡片 = 在新浏览器页签打开对应子图

  Vue3 重构（SFC + Composition API）：
  - data() → ref/reactive
  - methods → 普通函数（用 function 关键字或箭头函数）
  - computed → computed()
  - mounted → onMounted()
-->
<template>
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
      <div class="sub-title">专题子图<span>按主题分维度浏览</span></div>
      <div class="sub-grid" :style="{ '--cols': subCols }">
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
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { WS_META, listWorkspaceCounts, getDriver } from '../api/neo4j.js';

/* ----- 响应式状态（原 data()） ----- */
const counts = ref({});
const rels = ref({});
const connected = ref(false);
const error = ref('');
// 统计显示值（从 0 动画滚到目标），用于容器始终渲染、避免页面跳动
const displayNodes = ref(0);
const displayRels = ref(0);
const displaySubs = ref(6);

/* ----- 计算属性（原 computed） ----- */
const master = computed(() => WS_META.find(m => m.id === 'g00_master_all'));
const subs = computed(() => WS_META.filter(m => m.id !== 'g00_master_all'));
const hasCounts = computed(() => Object.keys(counts.value).length > 0);
const total = computed(() => Object.values(counts.value).reduce((a, b) => a + (b || 0), 0));
const totalRels = computed(() => Object.values(rels.value).reduce((a, b) => a + (b || 0), 0));
// 专题子图行数：根据子图数量选最接近均分的列数（2/3/4）
//   - 6 → 3×2  |  5 → 不均匀，强制 2 或 3 列（这里选 3，余 1）
//   - 4 → 2×2  |  3 → 3×1  |  2 → 2×1  |  1 → 1
//   列数选择让 max(行间差) 最小
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

/* ----- 动作（原 methods） ----- */
// 跳转到溯源问答页（新页签打开，与子图一致）
function goQuery() {
  const url = window.location.origin + window.location.pathname + '#/query?ws=g00_master_all';
  window.open(url, '_blank');
}
// 新页签打开子图（hash 路由：原地址 + #/graph/<ws>）
function enter(ws) {
  const url = window.location.origin + window.location.pathname + '#/graph/' + ws;
  window.open(url, '_blank');
}

// 数字滚动动画：from → to，用 easeOutCubic 让数字"跳"上去，~600ms
function animateCount(from, to, setter) {
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

/* ----- 生命周期（原 mounted） ----- */
onMounted(async () => {
  document.title = '知识图谱问答';
  try {
    await getDriver().getServerInfo();
    connected.value = true;
    const s = await listWorkspaceCounts();
    counts.value = s && s.nodes ? s.nodes : s;
    rels.value = (s && s.rels) ? s.rels : {};
    // 数据回来后用数字滚动动画跳到目标值（视觉上"跳"上去，不会出现/隐藏造成错动）
    animateCount(displayNodes.value, total.value, (val) => { displayNodes.value = val; });
    animateCount(displayRels.value, totalRels.value, (val) => { displayRels.value = val; });
  } catch (err) {
    error.value = (err.message || String(err));
  }
});
</script>

<style scoped>
/* ============================================================
 * HomeView 专属样式（原 home.css 全部迁入；scoped 隔离）
 * ============================================================ */
.home {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background:
    radial-gradient(1200px 600px at 50% -6%, #c9dcf2 0%, rgba(201, 220, 242, 0) 68%),
    radial-gradient(900px 680px at 100% 104%, #c9e2d3 0%, rgba(201, 226, 211, 0) 62%),
    radial-gradient(840px 560px at 0% 102%, #dccdf0 0%, rgba(220, 205, 240, 0) 60%),
    linear-gradient(135deg, #e6edf7 0%, #e4e2f3 48%, #ece5f0 100%);
}

.home-head {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 24px;
  align-items: center;
  max-width: 1280px;
  margin: 0 auto;
  padding: 28px 28px 18px;
}
.home-head .home-hero-l {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.home-head h1 {
  font-size: 34px;
  font-weight: 900;
  letter-spacing: 2px;
  line-height: 1.15;
  background: linear-gradient(92deg, #b45309, #e67e22 40%, #db2777 80%, #6d28d9);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 3px 10px rgba(180, 83, 9, .18));
}
.home-head .subtitle {
  color: var(--text-2);
  font-size: 14px;
  line-height: 1.7;
  letter-spacing: .3px;
  font-weight: 500;
  max-width: 520px;
}
.home-head .cta-row {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 6px;
}
.home-head .cta-row :deep(.el-button) {
  height: 40px;
  padding: 0 22px;
  font-size: 14px;
  font-weight: 700;
  border-radius: 999px;
  box-shadow: 0 8px 20px rgba(31, 111, 235, .28);
}
.home-head .cta-row .cta-arrow {
  display: inline-block;
  margin-left: 6px;
  transition: transform 0.2s;
}
.home-head .cta-row :deep(.el-button:hover) .cta-arrow {
  transform: translateX(4px);
}
.home-head .ctahint {
  font-size: 14px;
  color: var(--text-2);
  font-weight: 500;
}
.home-head .stats {
  display: flex;
  gap: 10px;
  margin-top: 10px;
  flex-wrap: wrap;
}
.home-head .stat {
  min-width: 110px;
  text-align: center;
  background: rgba(255, 255, 255, .78);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 16px;
  box-shadow: 0 5px 14px rgba(31, 45, 61, .10);
  backdrop-filter: blur(6px);
}
.home-head .stat .num {
  font-size: 22px;
  font-weight: 900;
  color: var(--primary);
  background: linear-gradient(92deg, #1f6feb, #9333ea);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  line-height: 1.1;
}
.home-head .stat .lbl {
  font-size: 11.5px;
  color: var(--text-2);
  font-weight: 600;
  margin-top: 2px;
  letter-spacing: .5px;
}

.home-head .home-hero-r {
  background: rgba(255, 255, 255, .78);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 18px 20px;
  box-shadow: 0 8px 22px rgba(31, 45, 61, .10);
  backdrop-filter: blur(8px);
}
.home-head .home-hero-r .hero-r-title {
  font-size: 14px;
  font-weight: 800;
  color: var(--text-1);
  letter-spacing: .5px;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.home-head .home-hero-r .hero-r-title::before {
  content: '';
  width: 4px;
  height: 14px;
  border-radius: 2px;
  background: linear-gradient(180deg, #1f6feb, #9333ea);
}
.home-head .home-hero-r .step-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.home-head .home-hero-r .step {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.home-head .home-hero-r .step .n {
  flex: 0 0 22px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: linear-gradient(135deg, #1f6feb, #9333ea);
  color: #fff;
  font-size: 12px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
}
.home-head .home-hero-r .step .t {
  font-size: 12.5px;
  color: var(--text-1);
  line-height: 1.6;
  padding-top: 2px;
}
.home-head .home-hero-r .step .t b {
  color: var(--primary-strong);
}

.cards {
  max-width: 1280px;
  margin: 0 auto;
  padding: 4px 28px 28px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.master-row { display: block; }
.master-row .card.featured { width: 100%; }

.sub-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 14px;
  font-weight: 800;
  color: var(--text-1);
  letter-spacing: .5px;
  padding-left: 6px;
  margin-top: 4px;
}
.sub-title span {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-3);
}
.sub-title::before {
  content: '';
  display: inline-block;
  width: 4px;
  height: 14px;
  border-radius: 2px;
  background: linear-gradient(180deg, #1f6feb, #9333ea);
  align-self: center;
}
.sub-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(var(--cols, 3), minmax(0, 1fr));
  margin: 0;
}
@media (max-width: 720px) {
  .home-head {
    grid-template-columns: 1fr;
    padding: 18px;
    gap: 14px;
  }
  .home-head h1 { font-size: 26px; }
}

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
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 12px;
  pointer-events: none;
  background: radial-gradient(300px 130px at var(--cx, 50%) -22%, var(--accent, #4fa3ff) 0%, rgba(0, 0, 0, 0) 70%);
  opacity: 0.20;
  transition: opacity 0.2s;
}
.card:hover {
  border-color: var(--accent, var(--primary));
  transform: translateY(-3px);
  box-shadow: 0 14px 30px rgba(28, 39, 66, .40);
}
.card:hover::before { opacity: 0.38; }

.card .bar {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  background: var(--accent, #4fa3ff);
  box-shadow: 0 0 8px var(--accent, #4fa3ff);
}
.card .badge {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 900;
  color: #fff;
  background: var(--accent, #4fa3ff);
  box-shadow: 0 4px 10px rgba(31, 45, 61, .45);
}
.card .body {
  padding-right: 36px;
  min-width: 0;
}
.card h3 {
  font-size: 15px;
  color: #ffffff;
  margin-bottom: 4px;
  font-weight: 800;
  letter-spacing: .3px;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card p {
  font-size: 12px;
  color: #d9e1f4;
  line-height: 1.55;
  min-height: 36px;
  opacity: 0.95;
  margin-bottom: 8px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.card .foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: auto;
  font-size: 12px;
  gap: 6px;
}
.card .count {
  color: #ffffff;
  background: rgba(255, 255, 255, .18);
  border: 1px solid rgba(255, 255, 255, .32);
  border-radius: 999px;
  padding: 3px 10px;
  font-weight: 600;
  backdrop-filter: blur(4px);
  white-space: nowrap;
}
.card .count b { font-weight: 900; }
.card .count.dim {
  color: rgba(255, 255, 255, .75);
  background: rgba(255, 255, 255, .08);
  border-color: rgba(255, 255, 255, .16);
}
.card .go {
  color: #ffffff;
  opacity: 0.9;
  font-weight: 700;
  font-size: 12px;
  letter-spacing: .3px;
  white-space: nowrap;
}
.card .go span {
  display: inline-block;
  transition: transform 0.18s;
  margin-left: 4px;
}
.card:hover .go span { transform: translateX(3px); }

/* 总图谱 featured 横卡（紧凑） */
.card.featured {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 14px 18px;
  min-height: 0;
  background: linear-gradient(150deg, #4a3873 0%, #2c3e6b 45%, #1f6feb 100%);
  border-color: var(--accent, #4fa3ff);
  box-shadow: 0 10px 24px rgba(31, 111, 235, .28);
}
.card.featured .badge {
  position: static;
  flex: 0 0 38px;
  width: 38px;
  height: 38px;
  font-size: 17px;
  border-radius: 10px;
  margin-right: 14px;
}
.card.featured .body {
  flex: 1 1 auto;
  padding-right: 0;
  min-width: 0;
}
.card.featured h3 {
  font-size: 17px;
  margin-bottom: 2px;
  white-space: normal;
}
.card.featured p {
  font-size: 12.5px;
  line-height: 1.55;
  min-height: 0;
  margin-bottom: 4px;
  -webkit-line-clamp: 1;
}
.card.featured .foot {
  margin-top: 2px;
  font-size: 12px;
}
.card.featured .count {
  background: rgba(255, 255, 255, .22);
  border-color: rgba(255, 255, 255, .4);
  padding: 3px 12px;
}
</style>
