<!--
  QueryView.vue —— 智能问答页（路由 /query?ws=<workspace>）

  Vue 3 重构：SFC + Composition API + scoped style。
  模板 1:1 移植自旧版 Options API；CSS 拆入 <style scoped>。
-->
<template>
  <div class="q-page" :class="{ 'started': started }">

    <!-- 顶部工具栏（始终保留） -->
    <div id="qbar">
      <span class="brand">
        <span class="bbadge" :style="{background: currentMeta.color}">{{ currentMeta.badge }}</span>
        <span class="title">智能问答</span>
      </span>
      <el-button size="small" @click="goHome">‹ 导航</el-button>
      <el-button size="small" @click="goGraph">图谱视图</el-button>
      <el-button size="small" type="primary" plain @click="newChat()" title="把当前对话归档到左侧列表，开启全新对话">+ 新建对话</el-button>
      <el-button size="small"
        :type="showHistory ? 'primary' : ''"
        @click="toggleHistory"
        :title="showHistory ? '收起历史对话' : '展开历史对话'">
        {{ showHistory ? '收起' : '历史' }}{{ showHistory ? '' : ' (' + conversations.length + ')' }}
      </el-button>
      <label class="lbl">图谱</label>
      <el-select :model-value="ws" @change="v => ws = v" style="width:150px">
        <el-option v-for="o in wsOptions" :key="o.v" :value="o.v" :label="o.t"></el-option>
      </el-select>
      <label class="lbl">模式</label>
      <el-select v-model="mode" style="width:170px">
        <el-option v-for="m in modes" :key="m.v" :value="m.v" :label="m.t"></el-option>
      </el-select>
      <span id="qstatus">
        <span id="qdot" :class="{ok: status.ok}"></span>{{ status.text }}
      </span>
    </div>

    <div class="q-row">

      <aside class="hd-side" :class="{ open: showHistory }">
        <div class="hd-toggle" @click="toggleHistory"
          :title="showHistory ? '收起历史对话' : '展开历史对话'">
          <span class="hd-burger"><i></i><i></i><i></i></span>
          <span class="hd-toggle-label" v-if="!showHistory">会话</span>
        </div>

        <div class="hd-panel" v-show="showHistory">
          <header class="hd-head">
            <div class="hd-head-l">
              <span class="bbadge" :style="{background: currentMeta.color}">{{ currentMeta.badge }}</span>
              <span class="hd-title">历史对话</span>
            </div>
            <div class="hd-head-r">
              <el-button size="small" type="primary" @click="newChat()">+ 新建</el-button>
            </div>
          </header>

          <div class="hd-search">
            <el-input v-model="historyFilter" size="small" clearable placeholder="搜索对话…"></el-input>
          </div>

          <div class="hd-list" @click="cancelRename">
            <div v-if="filteredConvs.length === 0" class="hd-empty">
              <div class="hd-empty-icon">��</div>
              <div v-if="historyFilter">没有匹配「{{ historyFilter }}」的对话</div>
              <div v-else>暂无历史对话<br><span class="hd-empty-tip">点右上角「+ 新建」开始一段新对话</span></div>
            </div>
            <div v-for="c in filteredConvs" :key="c.id" class="hd-item"
              :class="{ active: c.id === currentConvId }" @click.stop="loadConv(c.id)">
              <div class="hd-item-main">
                <div v-if="renamingId === c.id" class="hd-rename-input">{{ renamingTitle }}</div>
                <div v-else class="hd-item-title" :title="c.title"
                  @dblclick.stop="startRename(c.id)">{{ c.title }}</div>
                <div class="hd-item-meta">
                  <span class="hd-time">{{ fmtTime(c.updatedAt) }}</span>
                  <span class="hd-sep">·</span>
                  <span class="hd-msg">{{ c.msgCount }} 条消息</span>
                </div>
              </div>
              <div class="hd-item-actions" @click.stop>
                <button type="button" class="hd-act-btn"
                  @click.stop="startRename(c.id)" title="重命名">✎</button>
                <button type="button" class="hd-act-btn hd-act-del"
                  @click.stop="deleteConv(c.id)" title="删除">��</button>
              </div>
            </div>
          </div>

          <footer class="hd-foot">双击标题可重命名 · 保存在浏览器本地</footer>
        </div>
      </aside>

      <div class="q-body">

        <!-- 初始（居中）布局 -->
        <div id="qcenter" v-if="!started">
          <div class="chat-card">
            <div class="chat-head">
              <span class="bbadge" :style="{background: currentMeta.color}">{{ currentMeta.badge }}</span>
              <span class="chat-title">智能问答 · {{ currentMeta.name }}</span>
            </div>
            <div class="progress" v-show="showProgress">
              <div class="pbar"><span class="pfill" :style="{ width: ((stepIdx+1)/steps.length*100) + '%' }"></span></div>
              <div class="steps">
                <div v-for="(s, i) in steps" :key="i" class="step" :class="{ on: i <= stepIdx, cur: i === stepIdx }">
                  <span class="dot"></span>{{ s }}
                </div>
              </div>
            </div>
            <div v-if="messages.length === 0" class="presets-inline">
              <div class="pc-lbl">推荐问题（点击直接提问）</div>
              <div class="pc-list">
                <span v-for="p in presets" :key="p" class="pc-chip" @click="runQuery(p)">{{ p }}</span>
              </div>
            </div>
            <div ref="chatScroll" class="chat-scroll" @click="onChatClick"
              @mouseover="onChatOver" @mousemove="onChatMove" @mouseleave="onChatLeave">
              <div class="bubbles">
                <div v-for="(m, i) in messages" :key="i" class="bubble-row" :class="m.role">
                  <div v-if="m.role === 'ai'" class="avatar">AI</div>
                  <div class="bubble" :class="m.role" v-html="m.role === 'ai' ? (m.html || waitingHtml()) : escapeHtml(m.text)"></div>
                  <div v-if="m.role === 'user'" class="avatar me">你</div>
                </div>
                <div class="bubbles-end"></div>
              </div>
            </div>
            <div class="chat-input">
              <el-input v-model="query" class="qbar-input"
                placeholder="输入问题，回车查询（Shift+Enter 换行）"
                :disabled="loading"
                @keydown.enter.exact.prevent="runQuery()"
                @keydown.shift.enter.exact="appendNewline"
                @keydown.ctrl.enter="runQuery()"></el-input>
              <el-button type="primary" :loading="loading" :disabled="loading" @click="runQuery()">查询</el-button>
            </div>
          </div>
        </div>

        <!-- 提问后布局 -->
        <div v-else id="qmain">
          <div id="qleft">
            <div class="chat-head sub">
              <span class="bbadge" :style="{background: currentMeta.color}">{{ currentMeta.badge }}</span>
              <span class="chat-title">智能问答 · {{ currentMeta.name }}</span>
            </div>
            <div v-show="showProgress || loading" class="progress">
              <div class="pbar"><span class="pfill" :style="{ width: ((stepIdx+1)/steps.length*100) + '%' }"></span></div>
              <div class="steps">
                <div v-for="(s, i) in steps" :key="i" class="step" :class="{ on: i <= stepIdx, cur: i === stepIdx }">
                  <span class="dot"></span>{{ s }}
                </div>
              </div>
            </div>
            <div ref="chatScroll2" class="chat-scroll" @click="onChatClick"
              @mouseover="onChatOver" @mousemove="onChatMove" @mouseleave="onChatLeave">
              <div class="bubbles">
                <div v-for="(m, i) in messages" :key="i" class="bubble-row" :class="m.role">
                  <div v-if="m.role === 'ai'" class="avatar">AI</div>
                  <div class="bubble" :class="m.role" v-html="m.role === 'ai' ? (m.html || waitingHtml()) : escapeHtml(m.text)"></div>
                  <div v-if="m.role === 'user'" class="avatar me">你</div>
                </div>
                <div class="bubbles-end"></div>
              </div>
            </div>
            <div class="chat-input">
              <el-input v-model="query" class="qbar-input"
                placeholder="继续提问，回车查询（Shift+Enter 换行）"
                :disabled="loading"
                @keydown.enter.exact.prevent="runQuery()"
                @keydown.shift.enter.exact="appendNewline"
                @keydown.ctrl.enter="runQuery()"></el-input>
              <el-button type="primary" :loading="loading" :disabled="loading" @click="runQuery()">查询</el-button>
            </div>
          </div>

          <div id="qright">
            <div v-if="loading && entities.length === 0" class="grow-overlay">
              <div class="grow-card">
                <div class="grow-spin"></div>
                <div class="grow-title">子图生长中…</div>
                <div class="grow-step">{{ steps[stepIdx] }}</div>
                <div class="grow-hint">正在把找到的内容整理成关系图谱</div>
              </div>
            </div>

            <div class="rh">
              走过的子图
              <span class="rsub">实体 {{ entities.length }} · 关系 {{ relationships.length }}</span>
              <span v-show="entities.length" class="rgrow">
                <el-button size="small" @click="fitView">适应视图</el-button>
              </span>
            </div>
            <div id="qnet"></div>

            <!-- 节点详情面板 -->
            <div v-if="sel.visible" id="qside">
              <h3>{{ sel.title }}</h3>
              <span class="tag">{{ sel.type }}</span>
              <span v-if="sel.kind === 'rel'" class="tag">关系</span>
              <div class="hint">提示：点击子图中其他节点或关系查看详情</div>

              <div v-if="sel.descr" class="descr">
                <div class="section-head" @click="descrOpen = !descrOpen">
                  <span class="sh-title">描述</span>
                  <span class="sh-tog">{{ descrOpen ? '收起 ▲' : '展开 ▼' }}</span>
                </div>
                <div v-show="descrOpen" class="descr-body">{{ sel.descr }}</div>
              </div>

              <div v-if="sel.extraProps && sel.extraProps.length" class="attrs">
                <div class="section-head" @click="attrsOpen = !attrsOpen">
                  <span class="sh-title">属性（{{ sel.extraProps.length }}）</span>
                  <span class="sh-tog">{{ attrsOpen ? '收起 ▲' : '展开 ▼' }}</span>
                </div>
                <table v-show="attrsOpen" class="attrs-table">
                  <tbody>
                    <tr v-for="p in sel.extraProps" :key="p.key">
                      <th>{{ p.label }}</th>
                      <td>{{ p.value }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div v-if="sel.segs && sel.segs.length" class="chunks">
                <div class="section-head">
                  <span class="sh-title">原文片段（{{ sel.segs.length }}）</span>
                </div>
                <div v-for="(s,i) in sel.segs" :key="'c'+i" class="chunk" :class="{collapsed: !s.expanded}">
                  <div class="chunk-head" @click="s.expanded = !s.expanded">
                    <span class="chunk-idx">原文片段 {{ i+1 }}</span>
                    <span class="chunk-tog">{{ s.expanded ? '收起 ▲' : '展开 ▼' }}</span>
                  </div>
                  <div v-show="s.expanded" class="chunk-scroll">
                    <div v-if="!s.loading && s.para" class="chunk-para">{{ s.para }}</div>
                    <div v-else-if="s.loading" class="chunk-para dim">原文片段载入中…</div>
                    <div v-else class="chunk-para dim">（未检索到该原文片段）</div>
                  </div>
                  <button class="isrc-open chunk-open" :class="{disabled: !s.file}"
                    v-show="i < 2 || s.expanded"
                    :disabled="!s.file" @click.stop="openOriginalFile(s.file)">
                    {{ s.file ? '查看原文网页' : '暂无原文链接' }}
                  </button>
                </div>
              </div>
              <div v-else class="chunks">
                <div class="chunk">
                  <div class="chunk-head">原文片段</div>
                  <div class="chunk-scroll"><span class="dim">（该条目未记录原文来源）</span></div>
                  <button class="isrc-open chunk-open disabled" disabled>暂无原文链接</button>
                </div>
              </div>
            </div>

            <!-- 图例 -->
            <div v-show="typeList.length" id="qlegend">
              <div class="lhead">实体类型（勾选筛选）</div>
              <el-checkbox class="legend-ck legend-batch" :model-value="allSelected"
                @change="selectAllTypes">全选</el-checkbox>
              <el-checkbox class="legend-ck legend-batch" :model-value="noneSelected"
                @change="selectNoneTypes">全部不选</el-checkbox>
              <el-checkbox v-for="t in typeList" :key="t" class="legend-ck"
                :model-value="selectedTypes.includes(t)" @change="toggleType(t)">
                <span class="sw" :style="{background: typeColors[t] || '#888'}"></span>{{ t }}
              </el-checkbox>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 引用悬浮气泡 -->
    <div v-if="hover.visible" class="cite-hover"
      :style="{ left: hover.x + 'px', top: hover.y + 'px' }"
      @mouseenter="onBubbleEnter" @mousemove="onBubbleMove" @mouseleave="onBubbleLeave">
      <div class="ch-title">{{ hover.title }}</div>
      <div class="ch-body">{{ hover.content }}</div>
      <div class="ch-hint">点击引用数字可打开原网页</div>
    </div>
  </div>
</template>

<script setup>
/* ============================================================
 * QueryView 业务逻辑（Composition API）
 *  - 状态 / 计算属性 / 工具方法 / 会话存档 / 引用气泡 / 子图构建 / 生命周期
 *  - 不依赖模板细节，可独立阅读
 * ============================================================ */
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { DataSet, Network } from 'vis-network/standalone/esm/vis-network';
import { WS_META, wsMeta, getDriver } from '../composables/useNeo4j.js';
import {
  queryData, streamRag, fetchChunk, splitSep, openOriginal
} from '../composables/useLightragApi.js';
import { mdToHtml, waitingHtml } from '../utils/markdown.js';

const vis = { DataSet, Network };

/* ====== 路由 ====== */
const route = useRoute();
const router = useRouter();

/* ====== 响应式状态 ====== */
const ws = ref('g00_master_all');
const wsOptions = WS_META.map(m => ({ v: m.id, t: m.name }));
const mode = ref('mix');
const modes = [
  { v: 'mix', t: '综合（推荐）',
    tip: 'mix：同时查知识图谱和原文。问「这个人物做过什么」「这些事物怎么连起来」之类综合问题时效果最好，一般先用它。' },
  { v: 'hybrid', t: '混合检索',
    tip: 'hybrid：把关键词匹配和语义匹配两条路的结果合并起来查。适合「既要命中具体名词，也要理解意思」的提问。' },
  { v: 'local', t: '局部上下文',
    tip: 'local：以图中实体为中心，向外找它的邻居节点与原文。适合问「某物/某人具体细节、与什么相关」。' },
  { v: 'global', t: '全局主题',
    tip: 'global：从整张图的高层关系出发抓主题脉络。适合问「总体上讲了哪几条主线、哪些大趋势」。' },
  { v: 'naive', t: '纯原文',
    tip: 'naive：只做原文段落检索，不用图谱关系。适合纯文本型问题；当其他模式有杂讯时可作对照。' },
  { v: 'bypass', t: '只检索不生成',
    tip: 'bypass：不调用 LLM，直接把检索到的原文片段返回。用于快速核对资料来源、或排查检索效果。' }
];

const query = ref('');
const presetsByWs = {
  g00_master_all: [
    '为什么南方的物产常出现在北方的故事里？',
    '一个地名的由来，往往牵涉哪些历史事件？',
    '古人长途运送鲜果，最怕遇到哪些麻烦？',
    '民间传说与真实历史之间是什么关系？'
  ],
  g01_people_literature: [
    '杨贵妃为什么那么爱吃荔枝？',
    '苏轼写过的荔枝名句背后有什么故事？',
    '杜牧《过华清宫》想表达什么？',
    '白居易《荔枝图序》讲了什么？'
  ],
  g02_places_routes: [
    '荔枝道从哪里开始，到达哪里？',
    '古代把鲜荔枝送到长安，最快要多久？',
    '「一骑红尘妃子笑」描述的是哪条路？',
    '高州贡园为何能与长安产生联系？'
  ],
  g03_varieties: [
    '广东常见的荔枝品种各有何',
    '桂味、糯米糍、妃子笑怎么挑？',
    '哪个荔枝品种最适合鲜食？',
    '近年有哪些新审定的荔枝品种？'
  ],
  g04_history_institutions: [
    '汉唐时期荔枝是如何成为贡品的？',
    '古代驿站制度如何支撑鲜果急运？',
    '「永元罢贡」是怎么回事？',
    '唐宋关于荔枝贡地的认知有哪些变化？'
  ],
  g05_lingnan_liwan: [
    '广州为什么叫「荔湾」？',
    '陆贾手植荔枝的传说可靠吗？',
    '岭南荔枝文化与广州城名有什么关系？',
    '泮塘五秀为何没有荔枝？'
  ],
  g06_industry_tech: [
    '广东荔枝产业的规模有多大？',
    '现代冷链如何让荔枝卖得更远？',
    '近年有哪些荔枝深加工产品？',
    '「12221 市场体系」是怎样运作的？'
  ]
};
const started = ref(false);
const loading = ref(false);
const status = reactive({ ok: false, text: '' });
const stepIdx = ref(0);
const steps = ['解析问题', '图谱检索', '取回原文', '组织答案'];
const messages = ref([]);
const entities = ref([]);
const relationships = ref([]);
const keywords = ref({ high: [], low: [] });
const typeList = ref([]);
const typeColors = ref({});
const selectedTypes = ref([]);
const sel = reactive({ visible: false, kind: '', title: '', type: '', descr: '',
  props: {}, extraProps: [], srcIds: [], fps: [], segs: [] });
const descrOpen = ref(true);
const attrsOpen = ref(true);
const lastRefs = ref([]);
const hover = reactive({ visible: false, ref: '', x: 0, y: 0, title: '', content: '' });
const showProgress = ref(false);
const aiPolish = ref(false);
const polishState = ref('idle');

const conversations = ref([]);
const currentConvId = ref(null);
const showHistory = ref(false);
const historyFilter = ref('');
const renamingId = ref(null);
const renamingTitle = ref('');

let net = null;
let nodesDS = null;
let edgesDS = null;
let _hoverTimer = null;
let _onUnload = null;
const renameRefs = new Map();
function setRenameRef(el, id) {
  if (el) renameRefs.set(id, el);
}
const chatScroll = ref(null);
const chatScroll2 = ref(null);

/* ====== 计算属性 ====== */
const currentMeta = computed(() => wsMeta(ws.value));
const selTypes = computed(() => selectedTypes.value);
const presets = computed(() => presetsByWs[ws.value] || presetsByWs.g00_master_all);
const allSelected = computed(() => typeList.value.length > 0 && selectedTypes.value.length === typeList.value.length);
const noneSelected = computed(() => selectedTypes.value.length === 0);
const filteredConvs = computed(() => {
  const arr = conversations.value || [];
  const kw = (historyFilter.value || '').trim().toLowerCase();
  if (!kw) return arr;
  return arr.filter(c =>
    (c.title && String(c.title).toLowerCase().includes(kw)) ||
    (c.lastUserText && String(c.lastUserText).toLowerCase().includes(kw))
  );
});

/* ====== 工具方法 ====== */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}
function setStatus(ok, text) {
  status.ok = !!ok;
  status.text = String(text || '');
}
function appendNewline() { query.value += '\n'; }
function waitFrame(ms) { return new Promise(r => setTimeout(r, ms)); }

function goHome() { router.push('/'); }
function goGraph() { router.push('/graph/' + ws.value); }

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

function validateOpt(opt) {
  const ALLOWED_MODES = ['mix', 'local', 'global', 'hybrid', 'naive', 'bypass'];
  if (!opt || typeof opt !== 'object') return '参数不合法';
  const q = (query.value || '').trim();
  if (q.length < 3) return '请输入至少 3 个字符的问题';
  if (!ALLOWED_MODES.includes(opt.mode)) return '查询模式不合法（' + (opt.mode || '') + '），请刷新页面或换一个模式';
  const tk = Number(opt.topK);
  if (!Number.isFinite(tk) || tk < 1 || tk > 1000) return 'topK 必须在 1..1000 之间';
  const ck = Number(opt.chunkTopK);
  if (!Number.isFinite(ck) || ck < 1 || ck > 1000) return 'chunkTopK 必须在 1..1000 之间';
  return '';
}

/* ====== 会话存档 ====== */
function listKey() { return 'qchat_idx_' + (ws.value || 'g00_master_all'); }
function curKey() { return 'qchat_cur_' + (ws.value || 'g00_master_all'); }
function convKey(id) { return 'qchat_' + (ws.value || 'g00_master_all') + '_' + id; }
function histKey() { return curKey(); }
function genConvId() {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function autoTitle(arr) {
  const um = (arr || []).find(m => m.role === 'user' && m.text);
  if (!um) return '新对话';
  const t = String(um.text).trim().split('\n')[0].slice(0, 24);
  return t || '新对话';
}
function fmtTime(ts) {
  if (!ts) return '';
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' 分钟前';
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) {
    return d.getHours().toString().padStart(2, '0') + ':' +
      d.getMinutes().toString().padStart(2, '0');
  }
  const yest = new Date(today.getTime() - 86400000);
  if (d.toDateString() === yest.toDateString()) return '昨天';
  if (d.getFullYear() === today.getFullYear()) {
    return (d.getMonth() + 1).toString().padStart(2, '0') + '-' +
      d.getDate().toString().padStart(2, '0');
  }
  return d.getFullYear() + '-' +
    (d.getMonth() + 1).toString().padStart(2, '0') + '-' +
    d.getDate().toString().padStart(2, '0');
}
function loadConvList() {
  try {
    const raw = localStorage.getItem(listKey());
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function saveConvList() {
  try {
    localStorage.setItem(listKey(), JSON.stringify(conversations.value || []));
  } catch (e) { /* 容量超限等 → 静默忽略 */ }
}
function saveCurrentConv() {
  if (!messages.value.length && !entities.value.length) return;
  const msgs = messages.value.filter(m => m.role === 'user' || (m.role === 'ai' && m.html));
  if (!currentConvId.value) currentConvId.value = genConvId();
  const now = Date.now();
  const payload = {
    started: started.value,
    messages: msgs,
    lastRefs: lastRefs.value || [],
    entities: entities.value || [],
    relationships: relationships.value || [],
    typeList: typeList.value || [],
    typeColors: typeColors.value || {},
    selectedTypes: selectedTypes.value || [],
    mode: mode.value,
    ws: ws.value,
    updatedAt: now
  };
  try {
    localStorage.setItem(convKey(currentConvId.value), JSON.stringify(payload));
  } catch (e) { /* quota exceeded 等忽略 */ }
  const lastUser = (msgs.find(m => m.role === 'user') || {}).text || '';
  const meta = {
    id: currentConvId.value,
    title: autoTitle(msgs),
    createdAt: now,
    updatedAt: now,
    msgCount: msgs.length,
    lastUserText: lastUser
  };
  const ix = (conversations.value || []).findIndex(c => c.id === currentConvId.value);
  if (ix >= 0) {
    meta.createdAt = conversations.value[ix].createdAt || now;
    conversations.value.splice(ix, 1);
  }
  conversations.value.unshift(meta);
  saveConvList();
  try { localStorage.setItem(curKey(), currentConvId.value); } catch (e) {}
}
function saveChat() { saveCurrentConv(); }

function restoreChat() {
  conversations.value = loadConvList();
  restoreCurrent();
}
function restoreCurrent() {
  let cur = null;
  try { cur = localStorage.getItem(curKey()); } catch (e) {}
  if (!cur) { currentConvId.value = null; return; }
  const meta = (conversations.value || []).find(c => c.id === cur);
  if (!meta) { currentConvId.value = null; return; }
  let d = null;
  try {
    const raw = localStorage.getItem(convKey(cur));
    if (raw) d = JSON.parse(raw);
  } catch (e) { /* ignore */ }
  if (!d) { currentConvId.value = null; return; }
  currentConvId.value = cur;
  messages.value = Array.isArray(d.messages) ? d.messages : [];
  lastRefs.value = d.lastRefs || [];
  started.value = !!d.started;
  entities.value = Array.isArray(d.entities) ? d.entities : [];
  relationships.value = Array.isArray(d.relationships) ? d.relationships : [];
  typeList.value = Array.isArray(d.typeList) ? d.typeList : [];
  typeColors.value = d.typeColors || {};
  selectedTypes.value = Array.isArray(d.selectedTypes) ? d.selectedTypes : [];
  if (d.mode && modes.find(m => m.v === d.mode)) mode.value = d.mode;
  if (entities.value && entities.value.length) {
    net = null;
    nodesDS = null;
    edgesDS = null;
    nextTick(() => buildGraph());
  }
  nextTick(() => scrollChatToBottom());
}

function newChat(skipArchive) {
  if (!skipArchive && (messages.value.length || entities.value.length)) saveCurrentConv();
  currentConvId.value = null;
  started.value = false;
  loading.value = false;
  messages.value = [];
  lastRefs.value = [];
  entities.value = [];
  relationships.value = [];
  typeList.value = [];
  typeColors.value = {};
  selectedTypes.value = [];
  Object.assign(sel, { visible: false, kind: '', title: '', type: '', descr: '',
    props: {}, extraProps: [], srcIds: [], fps: [], segs: [] });
  Object.assign(hover, { visible: false, x: 0, y: 0, title: '', content: '' });
  showProgress.value = false;
  polishState.value = 'idle';
  stepIdx.value = 0;
  try { localStorage.removeItem(curKey()); } catch (e) {}
  if (net) { try { net.destroy(); } catch (e) {} net = null; }
  nodesDS = null;
  edgesDS = null;
  cancelRename();
}

function loadConv(id) {
  if (!id) return;
  if (id === currentConvId.value) { closeHistory(); return; }
  if (messages.value.length || entities.value.length) saveCurrentConv();
  let d = null;
  try {
    const raw = localStorage.getItem(convKey(id));
    if (raw) d = JSON.parse(raw);
  } catch (e) { /* ignore */ }
  if (!d) {
    setStatus(false, '会话数据已损坏或被清除');
    return;
  }
  currentConvId.value = id;
  messages.value = Array.isArray(d.messages) ? d.messages : [];
  lastRefs.value = d.lastRefs || [];
  started.value = !!d.started;
  entities.value = Array.isArray(d.entities) ? d.entities : [];
  relationships.value = Array.isArray(d.relationships) ? d.relationships : [];
  typeList.value = Array.isArray(d.typeList) ? d.typeList : [];
  typeColors.value = d.typeColors || {};
  selectedTypes.value = Array.isArray(d.selectedTypes) ? d.selectedTypes : [];
  if (d.mode && modes.find(m => m.v === d.mode)) mode.value = d.mode;
  Object.assign(sel, { visible: false, kind: '', title: '', type: '', descr: '',
    props: {}, extraProps: [], srcIds: [], fps: [], segs: [] });
  Object.assign(hover, { visible: false, x: 0, y: 0, title: '', content: '' });
  showProgress.value = false;
  polishState.value = 'idle';
  try { localStorage.setItem(curKey(), id); } catch (e) {}
  const ix = (conversations.value || []).findIndex(c => c.id === id);
  if (ix >= 0) {
    conversations.value[ix].updatedAt = Date.now();
    const it = conversations.value.splice(ix, 1)[0];
    conversations.value.unshift(it);
    saveConvList();
  }
  if (net) { try { net.destroy(); } catch (e) {} net = null; }
  nodesDS = null;
  edgesDS = null;
  if (entities.value && entities.value.length) {
    nextTick(() => buildGraph());
  }
  cancelRename();
  nextTick(() => scrollChatToBottom());
}

function deleteConv(id) {
  if (!id) return;
  const meta = (conversations.value || []).find(c => c.id === id);
  const title = meta ? meta.title : '该对话';
  if (!window.confirm('确定删除「' + title + '」？删除后无法恢复。')) return;
  try { localStorage.removeItem(convKey(id)); } catch (e) {}
  conversations.value = (conversations.value || []).filter(c => c.id !== id);
  saveConvList();
  if (id === currentConvId.value) newChat(true);
}

function startRename(id) {
  const meta = (conversations.value || []).find(c => c.id === id);
  if (!meta) return;
  renamingId.value = id;
  renamingTitle.value = meta.title || '';
  nextTick(() => {
    const el = renameRefs.get(id);
    if (el && el.focus) { el.focus(); el.select && el.select(); }
  });
}
function commitRename() {
  if (!renamingId.value) return;
  const meta = (conversations.value || []).find(c => c.id === renamingId.value);
  if (meta) {
    const t = (renamingTitle.value || '').trim().slice(0, 60);
    meta.title = t || '新对话';
    saveConvList();
  }
  renamingId.value = null;
  renamingTitle.value = '';
}
function cancelRename() {
  renamingId.value = null;
  renamingTitle.value = '';
}

function toggleHistory() {
  showHistory.value = !showHistory.value;
  if (showHistory.value) cancelRename();
  nextTick(() => {
    if (net && net.redraw) {
      try {
        net.redraw();
        net.fit({ animation: false });
      } catch (e) {}
    }
  });
}
function closeHistory() {
  showHistory.value = false;
  cancelRename();
  nextTick(() => {
    if (net && net.redraw) {
      try { net.fit({ animation: false }); net.redraw(); } catch (e) {}
    }
  });
}

async function openRef(n) {
  const idx = Number(n) - 1;
  const ref = lastRefs.value && lastRefs.value[idx];
  if (!ref || !ref.file_path) {
    setStatus(false, '未找到引用 ' + n + ' 对应的资料（可能被新提问覆盖或本地存储过期）');
    return;
  }
  await openOriginalFile(ref.file_path);
}

/* ====== 引用悬浮气泡 ====== */
function scheduleHoverHide(delay) {
  if (_hoverTimer) clearTimeout(_hoverTimer);
  _hoverTimer = setTimeout(() => { hover.visible = false; _hoverTimer = null; }, delay != null ? delay : 450);
}
function cancelHoverHide() {
  if (_hoverTimer) { clearTimeout(_hoverTimer); _hoverTimer = null; }
}
function hideHover() { cancelHoverHide(); hover.visible = false; }
function onChatOver(ev) {
  const t = ev.target;
  if (!t || !t.closest || !t.closest('.cite')) return;
  const cite = t.closest('.cite');
  const n = cite.getAttribute('data-ref');
  if (hover.visible && hover.ref === n) {
    cancelHoverHide();
    ev.stopPropagation();
    return;
  }
  const idx = Number(n) - 1;
  const ref = lastRefs.value && lastRefs.value[idx];
  if (!ref) return;
  const content = (ref.content && ref.content.length)
    ? ref.content.join('\n\n')
    : (ref.file_path || '（无原文内容）');
  const pad = 16;
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = 400, h = Math.min(520, vh - 60);
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + w > vw) x = ev.clientX - w - pad;
  if (y + h > vh) y = Math.max(10, ev.clientY - h - pad);
  cancelHoverHide();
  Object.assign(hover, { visible: true, ref: n, x, y,
    title: '来源 ' + n + (ref.file_path ? ' · ' + String(ref.file_path).split('/').pop() : ''),
    content });
  ev.stopPropagation();
}
function onChatMove(ev) {
  if (!hover.visible) return;
  const t = ev.target;
  const inCite = t && t.closest && t.closest('.cite');
  const inBubble = t && t.closest && t.closest('.cite-hover');
  if (inCite || inBubble) { cancelHoverHide(); return; }
  scheduleHoverHide(450);
}
function onChatLeave() { scheduleHoverHide(450); }
function onBubbleEnter() { cancelHoverHide(); }
function onBubbleMove() { cancelHoverHide(); }
function onBubbleLeave() { hideHover(); }

/* ====== 主查询 ====== */
async function runQuery(preset) {
  if (preset != null) query.value = preset;
  const q = query.value.trim();
  if (!q) return;
  if (!started.value) started.value = true;
  loading.value = true;
  const opt = { ws: ws.value, mode: mode.value, topK: 12, chunkTopK: 6 };
  const vErr = validateOpt(opt);
  if (vErr) {
    loading.value = false;
    status.ok = false;
    status.text = vErr;
    messages.value.push({ role: 'user', text: q, ts: Date.now(), invalid: true });
    messages.value.push({
      role: 'ai',
      text: '⚠️ ' + vErr + '（请修正后再次提交，校验规则来自 LightRAG 后端 Pydantic 模型）',
      html: '<div class="dim">⚠️ ' + vErr + '（请修正后再次提交，校验规则来自 LightRAG 后端 Pydantic 模型）</div>',
      ts: Date.now()
    });
    query.value = q;
    nextTick(() => scrollChatToBottom());
    return;
  }
  showProgress.value = true;
  status.ok = false;
  status.text = '正在为您查找资料…';
  stepIdx.value = 0;

  messages.value.push({ role: 'user', text: q, ts: Date.now() });
  query.value = '';

  const aiMsg = reactive({ role: 'ai', text: '', html: '', ts: Date.now(), refs: [] });
  messages.value.push(aiMsg);
  nextTick(() => saveChat());

  const t0 = performance.now();
  try {
    const dataP = queryData(ws.value, q, opt).catch(err => ({ entities: [], relationships: [], chunks: [], metadata: {}, _err: err.message || String(err) }));

    stepIdx.value = 1;
    await waitFrame(80);

    const ans = await streamRag(ws.value, q, opt, (delta, full) => {
      aiMsg.text = full;
      aiMsg.html = mdToHtml(full);
      nextTick(() => scrollChatToBottom());
    });

    stepIdx.value = 2;
    const data = await dataP;
    stepIdx.value = 3;

    lastRefs.value = ans.references || [];
    aiMsg.refs = lastRefs.value;
    aiMsg.html = mdToHtml(aiMsg.text);

    entities.value = data.entities || [];
    relationships.value = data.relationships || [];
    const kw = (data.metadata && data.metadata.keywords) || {};
    keywords.value = { high: kw.high_level || [], low: kw.low_level || [] };
    buildGraph();

    const elapsed = performance.now() - t0;
    status.ok = true;
    status.text = '回答完成 · 实体 ' + entities.value.length + ' · 关系 ' +
      relationships.value.length + ' · 引用 ' + lastRefs.value.length +
      ' · ' + (elapsed / 1000).toFixed(1) + 's';
    saveChat();
  } catch (err) {
    console.error(err);
    aiMsg.text += '\n\n（查询失败：' + (err.message || err) + '）';
    aiMsg.html = mdToHtml(aiMsg.text);
    status.ok = false;
    status.text = '查询失败: ' + (err.message || err);
    saveChat();
  } finally {
    nextTick(() => scrollChatToBottom());
  }
}

function scrollChatToBottom() {
  const el = chatScroll2.value || chatScroll.value;
  if (el) el.scrollTop = el.scrollHeight;
}
function onChatClick(ev) {
  let t = ev.target;
  for (let i = 0; t && i < 4; i++, t = t.parentElement) {
    if (t.classList && t.classList.contains('cite')) {
      const n = t.getAttribute('data-ref');
      if (n) {
        ev.preventDefault();
        openRef(n);
      }
      return;
    }
  }
}

/* ====== 子图构建 ====== */
function prettifyKey(k) {
  return String(k).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
function extractExtraProps(props) {
  const out = [];
  const RESERVED = ['entity_id', 'entity_type', 'description', 'source_id', 'file_path',
    'created_at', 'updated_at', 'id'];
  Object.keys(props || {}).forEach(k => {
    if (RESERVED.includes(k)) return;
    const v = props[k];
    if (v === null || v === undefined || v === '') return;
    out.push({ key: k, label: prettifyKey(k), value: formatPropValue(v) });
  });
  out.sort((a, b) => a.key.localeCompare(b.key));
  return out;
}
function formatPropValue(v) {
  if (Array.isArray(v)) return v.join('、');
  if (typeof v === 'object' && v !== null) {
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
async function populateSegs(srcIds, fps) {
  const segs = (srcIds || []).map((s, i) => ({
    srcId: s, file: (fps || [])[i] || '', para: '', loading: true,
    expanded: i < 2
  }));
  sel.segs = segs;
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

function buildGraph() {
  const ents = entities.value || [];
  const rels = relationships.value || [];
  const nodeMap = new Map();
  const typeSet = new Set();
  ents.forEach(e => {
    if (!e.entity_name) return;
    const t = e.entity_type || '其他';
    typeSet.add(t);
    nodeMap.set(e.entity_name, {
      id: e.entity_name, label: e.entity_name, group: t,
      raw: {
        name: e.entity_name, type: t, desc: e.description || '',
        srcIds: splitSep(e.source_id), fps: splitSep(e.file_path)
      }
    });
  });
  rels.forEach(r => {
    ['src_id', 'tgt_id'].forEach(k => {
      const nm = r[k]; if (!nm) return;
      if (!nodeMap.has(nm)) {
        typeSet.add('(其他)');
        nodeMap.set(nm, { id: nm, label: nm, group: '(其他)',
          raw: { name: nm, type: '', desc: '', srcIds: [], fps: [] } });
      }
    });
  });

  const edges = rels.map((r, idx) => ({
    id: 'e' + idx, from: r.src_id, to: r.tgt_id,
    title: r.description || r.keywords || '',
    label: r.keywords || '',
    raw: { descr: r.description || '', src: r.source_id || '',
      fp: r.file_path || '', kw: r.keywords || '',
      s: r.src_id, t: r.tgt_id }
  }));

  const techTypes = Array.from(typeSet);
  typeList.value = techTypes;
  const next = selectedTypes.value.filter(t => techTypes.includes(t));
  if (!next.length) selectedTypes.value = techTypes.slice();
  else selectedTypes.value = next;

  const TECH_PALETTE = [
    '#2563eb', '#16a34a', '#ea580c', '#dc2626',
    '#9333ea', '#0891b2', '#65a30d', '#db2777',
    '#ca8a04', '#0d9488', '#4f46e5', '#7c3aed'
  ];
  const _qAssign = new Map();
  function qHash(s) { let h = 0; const k = String(s || '');
    for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0;
    return Math.abs(h); }
  function qColor(t) {
    const k = String(t || '');
    if (!_qAssign.has(k)) _qAssign.set(k, TECH_PALETTE[qHash(k) % TECH_PALETTE.length]);
    return _qAssign.get(k);
  }
  const techGroups = {};
  const colors = {};
  techTypes.forEach((t) => {
    const c = qColor(t);
    techGroups[t] = { color: c };
    colors[t] = c;
  });
  typeColors.value = colors;

  const visibleIds = new Set();
  nodeMap.forEach(n => { if (selectedTypes.value.includes(n.group)) visibleIds.add(n.id); });
  const visNodes = Array.from(nodeMap.values()).filter(n => visibleIds.has(n.id));
  const visEdges = edges.filter(e => visibleIds.has(e.from) && visibleIds.has(e.to));

  const deg = {};
  visEdges.forEach(e => { deg[e.from] = (deg[e.from] || 0) + 1; deg[e.t] = (deg[e.t] || 0) + 1; });
  const maxDeg = Math.max(1, ...Object.values(deg));
  const minSize = 9, maxSize = 36;
  const sizedNodes = visNodes.map(n => {
    const d = deg[n.id] || 0;
    const ratio = Math.sqrt(d / maxDeg);
    return Object.assign({}, n, {
      size: minSize + ratio * (maxSize - minSize),
      font: { size: Math.min(16, 10 + Math.round(ratio * 8)), face: 'Microsoft YaHei' }
    });
  });

  nodesDS = new vis.DataSet(sizedNodes);
  edgesDS = new vis.DataSet(visEdges);

  const container = document.getElementById('qnet');
  const options = {
    groups: techGroups,
    nodes: {
      shape: 'dot',
      scaling: { min: 9, max: 36, label: { enabled: false } },
      font: { color: '#1f2d3d', face: 'Microsoft YaHei' },
      borderWidth: 0,
      shadow: { enabled: false }
    },
    edges: {
      color: { color: '#94a3b8', highlight: '#1f6feb', hover: '#1f6feb', opacity: 0.7 },
      width: 1.0, hoverWidth: 1.6, selectionWidth: 1.4,
      smooth: { enabled: true, type: 'continuous', roundness: 0.4 },
      arrows: 'to'
    },
    physics: {
      enabled: true,
      solver: 'barnesHut',
      barnesHut: {
        gravitationalConstant: -2400, centralGravity: 0.3,
        springLength: 110, springConstant: 0.04, damping: 0.5,
        avoidOverlap: 0.5
      },
      stabilization: { enabled: true, iterations: 600, fit: true,
        updateInterval: 50, onlyDynamicEdges: false }
    },
    layout: { improvedLayout: true, randomSeed: 2 },
    interaction: { hover: true, tooltipDelay: 150, navigationButtons: true, keyboard: false,
      dragNodes: false, dragView: true, zoomView: true }
  };
  if (!net) {
    net = new vis.Network(container, { nodes: nodesDS, edges: edgesDS }, options);
    net.on('click', p => onGraphPick(p));
    net.on('doubleClick', p => {
      if (p.nodes.length) net.focus(p.nodes[0], { scale: 1.1 });
    });
  } else {
    net.setData({ nodes: nodesDS, edges: edgesDS });
  }

  const colorUpd = [];
  for (const n of sizedNodes) {
    const t = n.group || '其他';
    const c = (techGroups[t] && techGroups[t].color) || '#94a3b8';
    colorUpd.push({
      id: n.id,
      color: { background: c, border: c, highlight: { background: c, border: '#1f6feb' } }
    });
  }
  nodesDS.update(colorUpd);

  net.once('stabilizationIterationsDone', () => {
    if (!net) return;
    net.setOptions({
      physics: {
        enabled: true,
        solver: 'barnesHut',
        barnesHut: {
          gravitationalConstant: -400, centralGravity: 0.005,
          springLength: 240, springConstant: 0.005, damping: 0.92,
          avoidOverlap: 0.8
        },
        stabilization: { enabled: false }
      }
    });
  });

  Object.assign(sel, { visible: false, kind: '', title: '', type: '', descr: '',
    props: {}, extraProps: [], srcIds: [], fps: [], segs: [] });
  loading.value = false;
}

function toggleType(t) {
  const i = selectedTypes.value.indexOf(t);
  if (i >= 0) selectedTypes.value.splice(i, 1);
  else selectedTypes.value.push(t);
  applyTypeFilter();
}
function selectAllTypes() { selectedTypes.value = typeList.value.slice(); applyTypeFilter(); }
function selectNoneTypes() { selectedTypes.value = []; applyTypeFilter(); }
function applyTypeFilter() {
  if (!nodesDS || !edgesDS) return;
  const visSet = new Set(selectedTypes.value);
  const nodeUpd = [];
  nodesDS.forEach(n => {
    const visible = visSet.has(n.group);
    if ((n.hidden || false) !== !visible) {
      nodeUpd.push({ id: n.id, hidden: !visible });
    }
  });
  if (nodeUpd.length) nodesDS.update(nodeUpd);
  const visibleNodes = new Set();
  nodesDS.forEach(n => { if (!n.hidden) visibleNodes.add(n.id); });
  const edgeUpd = [];
  edgesDS.forEach(e => {
    const visible = visibleNodes.has(e.from) && visibleNodes.has(e.to);
    if ((e.hidden || false) !== !visible) {
      edgeUpd.push({ id: e.id, hidden: !visible });
    }
  });
  if (edgeUpd.length) edgesDS.update(edgeUpd);
}
function fitView() { if (net) net.fit({ animation: { duration: 400 } }); }

function onGraphPick(params) {
  if (net && (params.nodes.length || params.edges.length)) {
    net.setOptions({ physics: { enabled: false } });
  }
  if (params.nodes.length) {
    const n = nodesDS.get(params.nodes[0]);
    if (!n) return;
    const r = n.raw || {};
    const id = n.id;
    const srcIds = r.srcIds || [], fps = r.fps || [];
    Object.assign(sel, { visible: true, kind: 'node', title: r.name || '', type: r.type || '',
      descr: (r.desc || '').replace(/<SEP>/g, '；'),
      props: {}, extraProps: [], srcIds, fps, segs: [] });
    descrOpen.value = !!sel.descr;
    populateSegs(srcIds, fps);
    loadNodeAttrs(r.name);
    try {
      net.focus(id, { scale: 1.0, locked: false,
        animation: { duration: 500, easingFunction: 'easeInOutQuad' } });
    } catch (e) {}
  } else if (params.edges.length) {
    const e = edgesDS.get(params.edges[0]);
    if (!e) return;
    const r = e.raw || {};
    const srcIds = r.src ? splitSep(r.src) : [], fps = r.fp ? splitSep(r.fp) : [];
    Object.assign(sel, {
      visible: true, kind: 'rel',
      title: (r.s || '') + ' → ' + (r.t || ''),
      type: r.kw || '关系', descr: (r.descr || '').replace(/<SEP>/g, '；'),
      props: {}, extraProps: [], srcIds, fps, segs: []
    });
    descrOpen.value = !!sel.descr;
    populateSegs(srcIds, fps);
  } else {
    Object.assign(sel, { visible: false, kind: '', title: '', type: '', descr: '',
      props: {}, extraProps: [], srcIds: [], fps: [], segs: [] });
    if (net && net.getViewPosition) {
      try {
        const p = net.getViewPosition();
        const sc = net.getScale();
        net.moveTo({ position: p, scale: sc, animation: false });
      } catch (e) {}
    }
  }
}

async function loadNodeAttrs(name) {
  if (!name) return;
  const session = getDriver().session({ database: 'neo4j' });
  try {
    const r = await session.run(
      'MATCH (n:`' + ws.value + '`) WHERE n.entity_id = $name RETURN properties(n) AS props LIMIT 1',
      { name });
    if (!r.records.length) return;
    const props = r.records[0].get('props') || {};
    Object.assign(sel, {
      props,
      extraProps: extractExtraProps(props)
    });
  } catch (err) { /* ignore */ }
  finally { await session.close(); }
}

/* ====== 生命周期 ====== */
onMounted(() => {
  net = null; nodesDS = null; edgesDS = null;
  const q = route.query;
  if (q.ws) ws.value = q.ws;
  document.title = '智能问答 · 妃子笑荔枝文化图谱';
  restoreChat();
  _onUnload = () => { if (messages.value.length || entities.value.length) saveCurrentConv(); };
  window.addEventListener('beforeunload', _onUnload);
});

onBeforeUnmount(() => {
  if (messages.value.length || entities.value.length) saveCurrentConv();
  if (_onUnload) window.removeEventListener('beforeunload', _onUnload);
  if (_hoverTimer) { clearTimeout(_hoverTimer); _hoverTimer = null; }
  if (net) { try { net.destroy(); } catch (e) {} }
});

watch(() => route.query.ws, (v) => {
  if (v && v !== ws.value) {
    if (messages.value.length || entities.value.length) saveCurrentConv();
    ws.value = v;
    conversations.value = loadConvList();
    restoreCurrent();
  }
});
watch(ws, (v, ov) => {
  if (!v || v === ov) return;
  if (messages.value.length || entities.value.length) saveCurrentConv();
  conversations.value = loadConvList();
  restoreCurrent();
});
</script>

<style scoped>
/* ============================================================
 * QueryView 专属样式（原 query.css 拆入）
 * ============================================================ */
.q-page {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: linear-gradient(135deg, #d3def1 0%, #cfd9ee 45%, #ddd0eb 100%);
}

#qbar {
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
#qbar .title {
  font-size: 16px;
  font-weight: 700;
  color: var(--chrome-text);
  white-space: nowrap;
}
#qstatus {
  margin-left: auto;
  font-size: 12px;
  color: var(--chrome-dim);
  white-space: nowrap;
}
#qdot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--danger);
  margin-right: 5px;
}
#qdot.ok {
  background: var(--ok);
}

#qmain {
  display: flex;
  flex: 1;
  min-height: 0;
  animation: qmainGrow 0.55s ease-out;
}
@keyframes qmainGrow {
  from { opacity: 0; transform: translateX(-18px); }
  to   { opacity: 1; transform: translateX(0); }
}
#qcenter {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 26px;
  overflow-y: auto;
}
.chat-card {
  width: min(820px, 96%);
  height: min(78vh, 720px);
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 22px 56px rgba(28, 39, 66, .22);
  overflow: hidden;
  animation: chatCardIn 0.42s ease-out;
}
@keyframes chatCardIn {
  from { opacity: 0; transform: translateY(14px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
.chat-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 18px;
  background: linear-gradient(95deg, #f4f7fc, #eef3fa);
  border-bottom: 1px solid var(--border);
  flex: 0 0 auto;
}
.chat-head.sub {
  padding: 10px 14px;
}
.chat-head .bbadge {
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
.chat-head .chat-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-1);
}

.progress {
  padding: 10px 18px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
  flex: 0 0 auto;
}
.progress .pbar {
  height: 4px;
  background: var(--border);
  border-radius: 2px;
  overflow: hidden;
}
.progress .pfill {
  display: block;
  height: 100%;
  background: linear-gradient(95deg, var(--primary), var(--gold));
  transition: width 0.35s ease;
}
.progress .steps {
  display: flex;
  gap: 18px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.progress .step {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-3);
}
.progress .step .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--border-2);
}
.progress .step.on { color: var(--text-1); }
.progress .step.on .dot { background: var(--primary); }
.progress .step.cur {
  color: var(--primary-strong);
  font-weight: 700;
}
.progress .step.cur .dot {
  background: var(--primary);
  box-shadow: 0 0 0 4px rgba(31, 111, 235, .18);
}

.chat-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 20px;
  background: var(--surface);
}
.bubbles {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.bubbles-end { height: 1px; }
.bubble-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.bubble-row.user { justify-content: flex-end; }
.bubble-row.ai { justify-content: flex-start; }
.avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 800;
  color: #fff;
  background: linear-gradient(135deg, #1f6feb, #4a3873);
  box-shadow: 0 4px 10px rgba(31, 45, 61, .18);
  flex: 0 0 30px;
}
.avatar.me {
  background: linear-gradient(135deg, #b45309, #ff9f43);
}
.bubble {
  max-width: 78%;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.8;
  word-break: break-word;
  box-shadow: 0 4px 14px rgba(28, 39, 66, .08);
  white-space: normal;
}
.bubble.ai {
  background: var(--surface-2);
  color: var(--text-1);
  border: 1px solid var(--border);
  border-top-left-radius: 4px;
}
.bubble.user {
  background: linear-gradient(135deg, #1f6feb, #1857c0);
  color: #ffffff;
  border-top-right-radius: 4px;
}
.bubble .dim {
  color: var(--text-3);
  font-size: 12.5px;
}
.bubble p.md-p { margin: 6px 0; }
.bubble p.md-p:first-child { margin-top: 0; }
.bubble p.md-p:last-child { margin-bottom: 0; }
.bubble h3.md-h, .bubble h4.md-h {
  font-size: 14px;
  margin: 8px 0 4px;
  color: var(--primary-strong);
}
.bubble ol.md-list {
  margin: 6px 0 6px 22px;
}
.bubble ol.md-list li { margin: 4px 0; }

.chat-input {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 10px 14px;
  background: var(--surface-2);
  border-top: 1px solid var(--border);
  flex: 0 0 auto;
}
.chat-input .qbar-input {
  flex: 1 1 auto;
  width: auto;
  margin-left: 0;
}
.chat-input .qbar-input :deep(.el-input__inner) {
  background-color: #ffffff !important;
  color: var(--text-1) !important;
  border-color: var(--border-2) !important;
}
.chat-input .qbar-input :deep(.el-input__inner::placeholder) {
  color: var(--text-3);
}

.qbar-input {
  width: 360px;
  margin-left: 8px;
}
.qbar-input :deep(.el-input__inner) {
  background-color: rgba(255, 255, 255, .96) !important;
  border-color: var(--chrome-dim) !important;
  color: var(--chrome-text) !important;
}
.qbar-input :deep(.el-input__inner::placeholder) {
  color: var(--chrome-dim);
}
.q-page :deep(.el-textarea__inner) {
  background-color: #ffffff !important;
  box-shadow: 0 0 0 1px var(--border) inset !important;
}

.presets-inline {
  margin-top: 10px;
  padding: 10px 12px;
  background: var(--surface-2);
  border: 1px dashed var(--border-2);
  border-radius: 8px;
}
.presets-inline .pc-lbl {
  font-size: 11.5px;
  color: var(--text-2);
  font-weight: 700;
  margin-bottom: 8px;
  letter-spacing: .5px;
}
.presets-inline .pc-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 8px;
}
.presets-inline .pc-chip {
  border: 1px solid var(--border-2);
  background: #ffffff;
  color: var(--text-1);
  border-radius: 999px;
  padding: 5px 12px;
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, transform 0.15s;
}
.presets-inline .pc-chip:hover {
  border-color: var(--primary);
  background: var(--primary-soft);
  color: var(--primary-strong);
  transform: translateY(-1px);
}

#qleft {
  width: 430px;
  max-width: 430px;
  flex: 0 0 430px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--surface);
  border-right: 1px solid var(--border-2);
  box-shadow: inset 8px 0 14px -10px rgba(28, 39, 66, .18);
  animation: qleftIn 0.5s ease-out;
}
@keyframes qleftIn {
  from { opacity: 0; transform: translateX(-16px); }
  to   { opacity: 1; transform: translateX(0); }
}

#qright {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  animation: qrightIn 0.55s ease-out;
}
@keyframes qrightIn {
  from { opacity: 0; transform: translateX(16px); }
  to   { opacity: 1; transform: translateX(0); }
}
#qright .rh {
  padding: 10px 14px;
  font-size: 14px;
  font-weight: 700;
  color: var(--text-1);
  border-bottom: 1px solid var(--border-2);
  display: flex;
  align-items: baseline;
  gap: 10px;
  background: linear-gradient(95deg, #ffffff, #eef3fa);
  flex: 0 0 auto;
}
#qright .rh .rsub {
  font-size: 12px;
  color: var(--text-2);
  font-weight: 400;
}
#qright .rh .rgrow {
  margin-left: auto;
}
#qnet {
  flex: 1 1 auto;
  min-height: 0;
  background: linear-gradient(180deg, #f4f7fc, #e9eff8);
}

.grow-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, rgba(244, 247, 252, .88), rgba(233, 239, 248, .92));
  z-index: 3;
}
.grow-card {
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
.grow-spin {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 3px solid var(--border);
  border-top-color: var(--primary);
  animation: qspin 0.9s linear infinite;
}
@keyframes qspin { to { transform: rotate(360deg); } }
.grow-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-1);
}
.grow-step {
  font-size: 13px;
  color: var(--primary-strong);
  font-weight: 600;
}
.grow-hint {
  font-size: 11.5px;
  color: var(--text-3);
  text-align: center;
  line-height: 1.5;
}

#qside {
  position: absolute;
  top: 64px;
  right: 14px;
  bottom: 14px;
  width: 340px;
  max-height: calc(100% - 84px);
  background: var(--panel);
  border: 1px solid var(--border-2);
  color: var(--text-2);
  padding: 14px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-radius: 10px;
  box-shadow: 0 14px 36px rgba(28, 39, 66, .22);
  z-index: 4;
  animation: qsideIn 0.3s ease-out;
}
@keyframes qsideIn {
  from { opacity: 0; transform: translateX(18px); }
  to   { opacity: 1; transform: translateX(0); }
}
#qside > .chunks { flex: 0 0 auto; }
#qside > .rel { flex: 0 0 auto; }
#qside h3 {
  color: var(--text-1);
  font-size: 15px;
  margin-bottom: 8px;
  word-break: break-all;
  padding-left: 9px;
  border-left: 4px solid var(--primary);
}
#qside .tag {
  display: inline-block;
  background: var(--primary);
  color: #fff;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 12px;
  margin: 2px 4px 8px 0;
}
#qside .hint {
  font-size: 11.5px;
  color: var(--text-1);
  background: var(--tint-amber);
  border: 1px solid var(--tint-amber-bd);
  border-radius: 6px;
  padding: 6px 8px;
  margin: 8px 0;
  line-height: 1.5;
}
#qside .reldesc {
  font-size: 12.5px;
  color: var(--text-1);
  line-height: 1.7;
  white-space: pre-wrap;
  margin: 6px 0;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
}
#qside .rel-item {
  border-top: 1px dashed var(--border-2);
  margin-top: 8px;
  padding-top: 8px;
}
#qside .rel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
#qside .relname {
  font-size: 11px;
  color: var(--gold);
  background: var(--gold-soft);
  border: 1px solid var(--tint-amber-bd);
  border-radius: 4px;
  padding: 1px 6px;
}
#qside .relsrc {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
#qside .relsrc .isrc-open {
  font-size: 11.5px;
}

#qlegend {
  position: absolute;
  left: 14px;
  bottom: 14px;
  background: linear-gradient(150deg, #1c2742 0%, #2c3e6b 60%, #3a4f80 100%);
  color: #f4f7fc;
  border: 1px solid #0f1a2a;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 12px;
  max-height: 50%;
  overflow-y: auto;
  z-index: 4;
  box-shadow: 0 8px 22px rgba(15, 26, 42, .40);
  min-width: 168px;
}
#qlegend .lhead {
  color: #b6c4de;
  margin-bottom: 4px;
  font-weight: 600;
}
#qlegend .sw {
  width: 11px;
  height: 11px;
  border-radius: 3px;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, .18);
}

.cite-hover {
  position: fixed;
  z-index: 1000;
  width: 400px;
  height: min(520px, 70vh);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fffdfa;
  color: #2a3548;
  border: 1px solid #e6d4b4;
  border-radius: 8px;
  box-shadow: 0 12px 34px rgba(40, 30, 10, .26);
  font-size: 13px;
  line-height: 1.75;
}
.cite-hover .ch-title {
  padding: 9px 14px;
  font-weight: 700;
  color: #8a6a2a;
  background: #faf4e6;
  border-bottom: 1px solid #efe4cb;
  flex: 0 0 auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cite-hover .ch-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 11px 14px;
  white-space: pre-wrap;
}
.cite-hover .ch-hint {
  flex: 0 0 auto;
  padding: 7px 14px;
  color: #b28d5a;
  font-size: 11.5px;
  background: #f7f0e0;
  border-top: 1px solid #efe4cb;
}

.typing {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-3);
  font-size: 12.5px;
}
.typing-dots {
  display: inline-flex;
  gap: 4px;
}
.typing-dots i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #1f6feb;
  animation: typingBounce 1.2s infinite ease-in-out;
}
.typing-dots i:nth-child(2) { animation-delay: .15s; }
.typing-dots i:nth-child(3) { animation-delay: .3s; }
@keyframes typingBounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40% { transform: scale(1); opacity: 1; }
}
.typing-text { position: relative; }
.typing .caret {
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-left: 2px;
  vertical-align: -2px;
  background: currentColor;
  animation: caretBlink 1s step-end infinite;
}
@keyframes caretBlink { 50% { opacity: 0; } }

/* 左侧历史会话栏 */
.q-row {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: row;
  align-items: stretch;
  width: 100%;
  overflow: hidden;
}
.q-body {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.hd-side {
  position: relative;
  flex: 0 0 auto;
  width: 46px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: linear-gradient(180deg, #1c2742 0%, #2c3e6b 100%);
  color: var(--chrome-text);
  transition: width 0.24s ease;
  overflow: hidden;
}
.hd-side.open {
  width: 300px;
  box-shadow: 6px 0 20px rgba(20, 30, 50, .18);
}
.hd-side .hd-toggle {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  padding: 12px 0;
  cursor: pointer;
  user-select: none;
  min-height: 78px;
}
.hd-side .hd-toggle:hover {
  background: rgba(255, 255, 255, .06);
}
.hd-side.open .hd-toggle {
  flex-direction: row;
  justify-content: flex-start;
  padding: 12px 14px;
  gap: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, .08);
}
.hd-burger {
  display: inline-flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  width: 22px;
  height: 18px;
  flex: 0 0 22px;
  margin: 0 auto;
}
.hd-burger i {
  display: block;
  height: 2px;
  border-radius: 2px;
  background: #d6e0f3;
}
.hd-toggle:hover .hd-burger i { background: #ffffff; }
.hd-side.open .hd-burger { margin: 0; }
.hd-toggle-label {
  font-size: 11px;
  color: #b6c4de;
  letter-spacing: 1px;
  writing-mode: vertical-rl;
}
.hd-side.open .hd-toggle-label {
  writing-mode: horizontal-tb;
  font-size: 13px;
  font-weight: 700;
  color: #d6e0f3;
  letter-spacing: 0;
}
.hd-side .hd-panel {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.hd-panel .hd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 10px 12px;
  background: linear-gradient(95deg, #223052, #2f4168);
  border-top: 1px solid rgba(255, 255, 255, .08);
  flex: 0 0 auto;
}
.hd-panel .hd-head-l {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.hd-panel .hd-head-l .bbadge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: #fff;
  font-weight: 800;
  font-size: 13px;
  box-shadow: 0 1px 4px rgba(31, 45, 61, .3);
  flex: 0 0 24px;
}
.hd-panel .hd-title {
  font-size: 14px;
  font-weight: 700;
  color: #eef4fd;
  white-space: nowrap;
}
.hd-panel .hd-head-r {
  display: flex;
  align-items: center;
  gap: 6px;
}
.hd-panel .hd-search {
  padding: 9px 12px;
  flex: 0 0 auto;
  border-bottom: 1px solid rgba(255, 255, 255, .08);
}
.hd-panel .hd-search :deep(.el-input__inner) {
  background-color: rgba(255, 255, 255, .94) !important;
}
.hd-panel .hd-search :deep(.el-input__inner::placeholder) {
  color: var(--text-3);
}
.hd-panel .hd-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 10px 12px;
}
.hd-panel .hd-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px;
  padding: 9px 10px;
  margin-bottom: 6px;
  border: 1px solid rgba(255, 255, 255, .12);
  border-radius: 9px;
  background: rgba(255, 255, 255, .05);
  cursor: pointer;
  transition: background 0.14s, border-color 0.14s, transform 0.14s, box-shadow 0.14s;
  position: relative;
}
.hd-panel .hd-item:hover {
  background: rgba(255, 255, 255, .12);
  border-color: #5b8ef0;
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(15, 26, 42, .35);
}
.hd-panel .hd-item.active {
  background: rgba(76, 120, 255, .24);
  border-color: #5b8ef0;
  box-shadow: inset 3px 0 0 #5b8ef0;
}
.hd-panel .hd-item-main {
  flex: 1 1 auto;
  min-width: 0;
}
.hd-panel .hd-rename-input {
  width: 100%;
  box-sizing: border-box;
  font-size: 13px;
  padding: 4px 8px;
  border: 1px solid #5b8ef0;
  border-radius: 6px;
  color: var(--text-1);
  background: #ffffff;
  outline: none;
}
.hd-panel .hd-item-title {
  font-size: 13px;
  font-weight: 600;
  color: #eef4fd;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.45;
  user-select: none;
}
.hd-panel .hd-item.active .hd-item-title {
  color: #ffffff;
  font-weight: 700;
}
.hd-panel .hd-item-meta {
  font-size: 11px;
  color: #9fb0cf;
  margin-top: 3px;
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.hd-panel .hd-item-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  opacity: 0;
  transition: opacity 0.14s;
  gap: 2px;
}
.hd-panel .hd-item:hover .hd-item-actions,
.hd-panel .hd-item.active .hd-item-actions {
  opacity: 1;
}
.hd-panel .hd-act-btn {
  padding: 3px 6px;
  height: auto;
  font-size: 13px;
  border: 1px solid rgba(255, 255, 255, .2);
  border-radius: 6px;
  background: rgba(255, 255, 255, .08);
  color: #dbe4f5;
  cursor: pointer;
}
.hd-panel .hd-act-btn:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, .18);
  border-color: #5b8ef0;
}
.hd-panel .hd-act-btn.hd-act-del:hover {
  color: #ff8a8a;
  background: rgba(220, 38, 38, .28);
  border-color: #b54c4c;
}
.hd-panel .hd-empty {
  padding: 48px 18px;
  text-align: center;
  color: #9fb0cf;
  font-size: 13px;
  line-height: 1.9;
}
.hd-panel .hd-empty-icon {
  font-size: 32px;
  margin-bottom: 8px;
}
.hd-panel .hd-empty-tip {
  font-size: 11.5px;
  color: #7f90ae;
}
.hd-panel .hd-foot {
  flex: 0 0 auto;
  padding: 8px 12px;
  font-size: 11px;
  color: #7f90ae;
  border-top: 1px solid rgba(255, 255, 255, .08);
  background: rgba(0, 0, 0, .10);
}
</style>