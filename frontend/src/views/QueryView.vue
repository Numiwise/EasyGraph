<!--
  QueryView.vue —— 智能问答页（路由 /query?ws=<workspace>）
  ------------------------------------------------------------
  业务用途：
    这是项目最核心的"问 AI"页面。路由 /query?ws=<workspace> 进入后，
    用户可以：
      1) 直接提问（也可点"推荐问题"chip 一键提问）
      2) 切换 workspace（图谱）和 mode（mix/local/global/hybrid/naive/bypass）
      3) 实时收到 AI 流式回答（打字机效果）
      4) 看到回答中 [1][2] 这种引用编号 → 鼠标悬停显示"原文片段"气泡
      5) 点击引用直接打开原文网页（_origin 优先）/ DocView 兜底
      6) 右侧"走过的子图"展示本次提问涉及的实体和关系
      7) 点击图节点 → 弹出该节点的属性、原文片段
      8) 历史对话：所有对话保存在 localStorage，可以切换 / 重命名 / 删除

  涉及的概念（给初学者）：
    - Composition API：所有逻辑都在 <script setup> 里通过函数组织。
    - localStorage：浏览器原生的小型持久化存储（key/value 字符串）。
    - 流式 NDJSON：composables/useLightragApi.js 的 streamRag() 已经处理了。
    - AbortController / EventTarget：暂未使用，未来可以加"取消生成"。
    - 键盘事件修饰符：@keydown.enter.exact.prevent 这种是 Vue 3 的修饰符连写。
-->
<template>
  <!-- 整页根节点。"started" 类用于区分"未提问 / 已提问"两种布局 -->
  <div class="q-page" :class="{ 'started': started }">

    <!-- 顶部工具栏：无论是否提问过都存在 -->
    <div id="qbar">
      <span class="brand">
        <WorkspaceBadge :meta="currentMeta" />
        <span class="title">智能问答</span>
      </span>
      <el-button size="small" @click="goHome">‹ 导航</el-button>
      <el-button size="small" @click="goGraph">图谱视图</el-button>
      <!-- + 新建对话：把当前对话归档到左侧列表，开启全新对话 -->
      <el-button size="small" type="primary" plain @click="newChat()" title="把当前对话归档到左侧列表，开启全新对话">+ 新建对话</el-button>
      <!-- 历史按钮：根据 showHistory 切换"展开 / 收起" -->
      <el-button size="small"
        :type="showHistory ? 'primary' : ''"
        @click="toggleHistory"
        :title="showHistory ? '收起历史对话' : '展开历史对话'">
        {{ showHistory ? '收起' : '历史' }}{{ showHistory ? '' : ' (' + conversations.length + ')' }}
      </el-button>
      <label class="lbl">图谱</label>
      <WorkspaceSelect v-model="ws" />
      <label class="lbl">模式</label>
      <el-select v-model="mode" style="width:170px">
        <el-option v-for="m in modes" :key="m.v" :value="m.v" :label="m.t"></el-option>
      </el-select>
      <span id="qstatus">
        <span id="qdot" :class="{ok: status.ok}"></span>{{ status.text }}
      </span>
    </div>

    <div class="q-row">

      <!-- 左侧抽屉：历史对话列表（默认收起为细长一条，点击汉堡按钮展开） -->
      <aside class="hd-side" :class="{ open: showHistory }">
        <div class="hd-toggle" @click="toggleHistory"
          :title="showHistory ? '收起历史对话' : '展开历史对话'">
          <span class="hd-burger"><i></i><i></i><i></i></span>
          <span class="hd-toggle-label" v-if="!showHistory">会话</span>
        </div>

        <div class="hd-panel" v-show="showHistory">
          <header class="hd-head">
            <div class="hd-head-l">
              <WorkspaceBadge :meta="currentMeta" size="small" />
              <span class="hd-title">历史对话</span>
            </div>
            <div class="hd-head-r">
              <el-button size="small" type="primary" @click="newChat()">+ 新建</el-button>
            </div>
          </header>

          <div class="hd-search">
            <el-input v-model="historyFilter" size="small" clearable placeholder="搜索对话…"></el-input>
          </div>

          <!-- 对话列表（v-show 仅控制整体可见性，filteredConvs 是按 historyFilter 过滤后的） -->
          <div class="hd-list" @click="cancelRename">
            <div v-if="filteredConvs.length === 0" class="hd-empty">
              <div class="hd-empty-icon">📭</div>
              <div v-if="historyFilter">没有匹配「{{ historyFilter }}」的对话</div>
              <div v-else>暂无历史对话<br><span class="hd-empty-tip">点右上角「+ 新建」开始一段新对话</span></div>
            </div>
            <div v-for="c in filteredConvs" :key="c.id" class="hd-item"
              :class="{ active: c.id === currentConvId }" @click.stop="loadConv(c.id)">
              <div class="hd-item-main">
                <div v-if="renamingId === c.id" class="hd-rename-input">
                  <!-- 用 el-input 实现真输入（之前 div 不能键入） -->
                  <el-input v-model="renamingTitle" size="small" placeholder="新标题"
                    :ref="(el) => el && renameRefs.set(c.id, el)"
                    @keydown.enter="commitRename()"
                    @keydown.esc="cancelRename()"
                    @blur="commitRename()"></el-input>
                </div>
                <div v-else class="hd-item-title" :title="c.title"
                  @dblclick.stop="startRename(c.id)">{{ c.title }}</div>
                <div class="hd-item-meta">
                  <span class="hd-time">{{ fmtTime(c.updatedAt) }}</span>
                  <span class="hd-sep">·</span>
                  <span class="hd-msg">{{ c.msgCount }} 条消息</span>
                </div>
              </div>
              <div class="hd-item-actions" @click.stop>
                <!-- Element Plus text 按钮：圆角无背景，hover 加浅色底；与卡片风格融合 -->
                <el-button link size="small" class="hd-act-btn"
                  @click.stop="startRename(c.id)" title="重命名">✎</el-button>
                <el-button link size="small" class="hd-act-btn hd-act-del"
                  @click.stop="deleteConv(c.id)" title="删除">🗑</el-button>
              </div>
            </div>
          </div>

          <footer class="hd-foot">双击标题可重命名 · 保存在浏览器本地</footer>
        </div>
      </aside>

      <div class="q-body">

        <!-- 初始居中布局：未提问时 -->
        <div id="qcenter" v-if="!started">
          <div class="chat-card">
            <div class="chat-head">
              <WorkspaceBadge :meta="currentMeta" />
              <span class="chat-title">智能问答 · {{ currentMeta.name }}</span>
            </div>
            <!-- 进度条：4 步（解析 / 检索 / 取原文 / 组织答案） -->
            <ProgressSteps :steps="steps" :active="stepIdx" :show="showProgress" />
            <!-- 推荐问题：未提问时显示，点击直接 runQuery(p) -->
            <div v-if="messages.length === 0" class="presets-inline">
              <div class="pc-lbl">推荐问题（点击直接提问）</div>
              <div class="pc-list">
                <span v-for="p in presets" :key="p" class="pc-chip" @click="runQuery(p)">{{ p }}</span>
              </div>
            </div>
            <!-- 聊天滚动区 -->
            <div ref="chatScroll" class="chat-scroll" @click="onChatClick"
              @mouseover="onChatOver" @mousemove="onChatMove" @mouseleave="onChatLeave"
              @scroll="onChatScroll">
              <div class="bubbles">
                <div v-for="(m, i) in messages" :key="i" class="bubble-row" :class="m.role">
                  <div v-if="m.role === 'ai'" class="avatar">AI</div>
                  <!-- AI 气泡用 v-html 注入 mdToHtml 输出；用户气泡用 escapeHtml 转义。
                       三种渲染分支：
                       1) 流式正在生成（m.streaming && !m.html）→ 显示"正在生成回答"+三圆点动画
                       2) 检索阶段（!m.html）                     → 显示"正在检索资料"+三圆点动画
                       3) 流式响应中（m.streaming && m.html）      → 显示真实 markdown + 末尾闪烁光标
                       4) 完成                               → 真实 markdown（无光标）
                  -->
                  <div v-if="m.role === 'ai'" class="bubble" :class="m.role"
                    v-html="m.html ? (m.html + (m.streaming ? streamCaretHtml() : ''))
                                     : waitingHtml(m.streaming ? 'generate' : 'search')"></div>
                  <div v-else class="bubble" :class="m.role" v-html="escapeHtml(m.text)"></div>
                  <div v-if="m.role === 'user'" class="avatar me">你</div>
                </div>
                <div class="bubbles-end"></div>
              </div>
            </div>
            <!-- 输入区：固定在底部，ChatGPT 风格 -->
            <div class="chat-input">
              <div class="input-wrap">
                <el-input
                  v-model="query"
                  class="chat-textarea"
                  type="textarea"
                  :rows="1"
                  :disabled="loading"
                  placeholder="输入问题，回车发送（Shift+Enter 换行）"
                  @keydown.enter.exact.prevent="runQuery()"
                  @keydown.shift.enter.exact="appendNewline"
                  @keydown.ctrl.enter="runQuery()"
                  @input="autoResize"
                  ref="textareaRef"></el-input>
                <el-button
                  type="primary"
                  class="send-btn"
                  :loading="loading"
                  :disabled="loading || !query.trim()"
                  @click="runQuery()">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" fill="currentColor"/>
                  </svg>
                </el-button>
              </div>
            </div>
          </div>
        </div>

        <!-- 已提问后布局：左对话 + 右子图 -->
        <div v-else id="qmain">
          <div id="qleft">
            <div class="chat-head sub">
              <WorkspaceBadge :meta="currentMeta" />
              <span class="chat-title">智能问答 · {{ currentMeta.name }}</span>
            </div>
            <div v-show="showProgress || loading">
              <ProgressSteps :steps="steps" :active="stepIdx" />
            </div>
            <div ref="chatScroll2" class="chat-scroll" @click="onChatClick"
              @mouseover="onChatOver" @mousemove="onChatMove" @mouseleave="onChatLeave"
              @scroll="onChatScroll">
              <div class="bubbles">
                <div v-for="(m, i) in messages" :key="i" class="bubble-row" :class="m.role">
                  <div v-if="m.role === 'ai'" class="avatar">AI</div>
                  <!-- AI 气泡：流式阶段显示动画，完成显示真实内容 -->
                  <div v-if="m.role === 'ai'" class="bubble" :class="m.role"
                    v-html="m.html ? (m.html + (m.streaming ? streamCaretHtml() : ''))
                                     : waitingHtml(m.streaming ? 'generate' : 'search')"></div>
                  <div v-else class="bubble" :class="m.role" v-html="escapeHtml(m.text)"></div>
                  <div v-if="m.role === 'user'" class="avatar me">你</div>
                </div>
                <div class="bubbles-end"></div>
              </div>
            </div>
            <!-- 输入区：固定在底部，ChatGPT 风格 -->
            <div class="chat-input">
              <div class="input-wrap">
                <el-input
                  v-model="query"
                  class="chat-textarea"
                  type="textarea"
                  :rows="1"
                  :disabled="loading"
                  placeholder="继续提问，回车发送（Shift+Enter 换行）"
                  @keydown.enter.exact.prevent="runQuery()"
                  @keydown.shift.enter.exact="appendNewline"
                  @keydown.ctrl.enter="runQuery()"
                  @input="autoResize"
                  ref="textareaRef2"></el-input>
                <el-button
                  type="primary"
                  class="send-btn"
                  :loading="loading"
                  :disabled="loading || !query.trim()"
                  @click="runQuery()">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" fill="currentColor"/>
                  </svg>
                </el-button>
              </div>
            </div>
          </div>

          <div id="qright">
            <!-- "子图生长中"全屏遮罩（第一次才显示，被 hideOnLoaded 自动消失） -->
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

            <!-- 节点/关系详情面板（点击子图节点时显示） -->
            <div v-if="sel.visible" id="qside">
              <h3>{{ sel.title }}</h3>
              <span class="tag">{{ sel.type }}</span>
              <span v-if="sel.kind === 'rel'" class="tag">关系</span>
              <div class="hint">提示：点击子图中其他节点或关系查看详情</div>

              <div v-if="sel.descr" class="descr">
                <SectionHead title="描述" :open="descrOpen" @toggle="descrOpen = !descrOpen" />
                <div v-show="descrOpen" class="descr-body">{{ sel.descr }}</div>
              </div>

              <div v-if="sel.extraProps && sel.extraProps.length" class="attrs">
                <AttrTable
                  :rows="sel.extraProps"
                  :open="attrsOpen"
                  @toggle="attrsOpen = !attrsOpen" />
              </div>

              <ChunkPanel
                v-if="sel.segs && sel.segs.length"
                :src-ids="sel.srcIds"
                :file-paths="sel.fps"
                :ws="ws"
                @open-original="openOriginalFile" />
              <ChunkPanel
                v-else
                :src-ids="[]"
                :file-paths="[]"
                :ws="ws"
                @open-original="openOriginalFile" />
            </div>

            <!-- 图例（用通用 TypeLegend 组件） -->
            <div v-show="typeList.length" id="qlegend" class="legend-host">
              <TypeLegend
                :type-list="typeList"
                :type-colors="typeColors"
                :selected-types="selectedTypes"
                @toggle="toggleType"
                @select-all="selectAllTypes"
                @select-none="selectNoneTypes" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 引用悬浮气泡（用通用 CiteHoverBubble 组件） -->
    <CiteHoverBubble
      :visible="hover.visible"
      :x="hover.x" :y="hover.y"
      :title="hover.title" :content="hover.content"
      @enter="onBubbleEnter" @move="onBubbleMove" @leave="onBubbleLeave" />
  </div>
</template>

<script setup>
/* ============================================================
 * QueryView 业务逻辑（Composition API）
 * ============================================================ */

// 从 vue 引入组合式 API
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { DataSet, Network } from 'vis-network/standalone/esm/vis-network';
import { wsMeta, api } from '../composables/useNeo4j.js';
import {
  queryData, streamRag, fetchChunk, splitSep, openOriginal
} from '../composables/useLightragApi.js';
import { mdToHtml, waitingHtml, streamCaretHtml } from '../utils/markdown.js';

// 引入子组件
import WorkspaceBadge from '../components/WorkspaceBadge.vue';
import WorkspaceSelect from '../components/WorkspaceSelect.vue';
import TypeLegend from '../components/TypeLegend.vue';
import ChunkPanel from '../components/ChunkPanel.vue';
import CiteHoverBubble from '../components/CiteHoverBubble.vue';
import AttrTable from '../components/AttrTable.vue';
import SectionHead from '../components/SectionHead.vue';
import ProgressSteps from '../components/ProgressSteps.vue';

const vis = { DataSet, Network };

/* ============================================================
 * 路由
 * ============================================================ */
const route = useRoute();
const router = useRouter();

/* ============================================================
 * 响应式状态（data() 等价物）
 * ============================================================ */
// 当前 workspace（默认总图谱）；从 URL 读 ?ws=
const ws = ref('g00_master_all');
// 当前查询模式
const mode = ref('mix');
// 6 种查询模式 + 各自的简短说明（被 tooltip 使用）
const modes = [
  { v: 'mix', t: '综合（推荐）',
    tip: 'mix：同时查知识图谱和原文。问"这个人物做过什么""这些事物怎么连起来"之类综合问题时效果最好。' },
  { v: 'hybrid', t: '混合检索',
    tip: 'hybrid：把关键词匹配和语义匹配两条路的结果合并起来查。适合既要命中具体名词，也要理解意思的提问。' },
  { v: 'local', t: '局部上下文',
    tip: 'local：以图中实体为中心，向外找邻居节点与原文。适合问"某物/某人具体细节、与什么相关"。' },
  { v: 'global', t: '全局主题',
    tip: 'global：从整张图的高层关系出发抓主题脉络。适合问总体上讲了哪几条主线、哪些大趋势。' },
  { v: 'naive', t: '纯原文',
    tip: 'naive：只做原文段落检索，不用图谱关系。适合纯文本型问题；当其他模式有杂讯时可作对照。' },
  { v: 'bypass', t: '只检索不生成',
    tip: 'bypass：不调用 LLM，直接把检索到的原文片段返回。用于快速核对资料来源、或排查检索效果。' }
];

// 输入框中的查询文本
const query = ref('');
// 推荐问题 chip（按 workspace 不同给不同的预设）
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

// 已开始过对话的标志（用来切换初始布局 vs 提问后布局）
const started = ref(false);
// 正在跑查询（loading 期间输入框禁用、按钮转圈）
const loading = ref(false);
// 顶栏红/绿点 + 状态文字
const status = reactive({ ok: false, text: '' });
// 步骤索引（0=解析问题 1=图谱检索 2=取原文 3=组织答案）
const stepIdx = ref(0);
// 4 步名称
const steps = ['解析问题', '图谱检索', '取回原文', '组织答案'];
// 聊天记录：[{ role:'user'|'ai', text, html, ts, refs?, invalid? }, ...]
const messages = ref([]);
// 本次问答命中的实体 + 关系
const entities = ref([]);
const relationships = ref([]);
// 图例相关
const typeList = ref([]);          // 当前 workspace 涉及的 entity_type 列表
const typeColors = ref({});        // 类型 → 颜色
const selectedTypes = ref([]);     // 当前勾选
// 右侧详情面板（节点 / 关系详情）
const sel = reactive({ visible: false, kind: '', title: '', type: '', descr: '',
  props: {}, extraProps: [], srcIds: [], fps: [], segs: [] });
// 折叠态
const descrOpen = ref(true);
const attrsOpen = ref(true);
// 当前回答的引用列表（来自最后一次 streamRag 的 references）
const lastRefs = ref([]);
// 引用悬浮气泡的状态
const hover = reactive({ visible: false, ref: '', x: 0, y: 0, title: '', content: '' });
// 是否显示顶部进度条
const showProgress = ref(false);

// 会话存档
const conversations = ref([]);     // 左侧列表
const currentConvId = ref(null);   // 当前会话的 id
const showHistory = ref(false);    // 历史面板展开
const historyFilter = ref('');     // 搜索对话的输入
const renamingId = ref(null);      // 正在重命名的对话 id
const renamingTitle = ref('');     // 重命名输入

// vis-network 实例
let net = null;
let nodesDS = null;
let edgesDS = null;
// 引用气泡的 timer id
let _hoverTimer = null;
// 卸载监听器句柄（用于清除事件监听）
let _onUnload = null;
// 重命名 input 的 DOM 引用（Map id→input 节点）
const renameRefs = new Map();
// 聊天滚动容器 ref
const chatScroll = ref(null);
const chatScroll2 = ref(null);
const textareaRef = ref(null);
const textareaRef2 = ref(null);

/* ============================================================
 * 计算属性
 * ============================================================ */
const currentMeta = computed(() => wsMeta(ws.value));
// 推荐问题按 workspace 切换
const presets = computed(() => presetsByWs[ws.value] || presetsByWs.g00_master_all);
// 按搜索词过滤历史对话
const filteredConvs = computed(() => {
  const arr = conversations.value || [];
  const kw = (historyFilter.value || '').trim().toLowerCase();
  if (!kw) return arr;
  return arr.filter(c =>
    (c.title && String(c.title).toLowerCase().includes(kw)) ||
    (c.lastUserText && String(c.lastUserText).toLowerCase().includes(kw))
  );
});

/* ============================================================
 * 工具方法
 * ============================================================ */
// 简单的 HTML 转义（用户文本气泡用）
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}
// 设置状态（统一处理 ok/text）
function setStatus(ok, text) {
  status.ok = !!ok;
  status.text = String(text || '');
}
// Shift+Enter：往 query 里追加一个换行
function appendNewline() { query.value += '\n'; }
// 自动调整 textarea 高度
function autoResize() {
  nextTick(() => {
    const el = textareaRef.value?.textarea || textareaRef2.value?.textarea;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }
  });
}
// 等待 ms 毫秒（用 setTimeout 返回 Promise）
function waitFrame(ms) { return new Promise(r => setTimeout(r, ms)); }

// 导航：回到首页
function goHome() { router.push('/'); }
// 导航：跳到图谱视图
function goGraph() { router.push('/graph/' + ws.value); }

// 打开原文（chunk 旁的按钮）：openOriginal 自己处理 _origin、docx 等
async function openOriginalFile(fp) {
  if (!fp) return;
  const ok = await openOriginal(fp, ws.value);
  if (!ok) openDoc(fp);
}
// 在新标签页打开 DocView 预览（浏览器原生打不开的 docx 等格式走这条路径）
function openDoc(fp) {
  if (!fp) return;
  const url = window.location.origin + window.location.pathname +
    '#/doc?ws=' + encodeURIComponent(ws.value) + '&file=' + encodeURIComponent(fp);
  window.open(url, '_blank');
}

// 提交前自检：mode/topK/chunkTopK 等值是否合法（绕过后端 422 之前先在前端挡掉）
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

/* ============================================================
 * 会话存档（localStorage）
 * ------------------------------------------------------------
 * 三类 key：
 *   qchat_idx_<ws>           ：会话列表（meta）
 *   qchat_<ws>_<convId>      ：单个会话内容（payload）
 *   qchat_cur_<ws>           ：当前活跃会话 id
 * ============================================================ */
// 会话列表的 localStorage key（按 workspace 隔离）
function listKey() { return 'qchat_idx_' + (ws.value || 'g00_master_all'); }
// 当前活跃会话 id 的 localStorage key
function curKey()  { return 'qchat_cur_' + (ws.value || 'g00_master_all'); }
// 单个会话内容的 localStorage key
function convKey(id) { return 'qchat_' + (ws.value || 'g00_master_all') + '_' + id; }
// 生成会话 id：c + 时间戳 base36 + 随机 base36
function genConvId() {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
// 自动标题：拿首条用户问题的前 24 字符
function autoTitle(arr) {
  const um = (arr || []).find(m => m.role === 'user' && m.text);
  if (!um) return '新对话';
  const t = String(um.text).trim().split('\n')[0].slice(0, 24);
  return t || '新对话';
}
// 友好时间显示："刚刚" / "N 分钟前" / "HH:MM" / "昨天" / "MM-DD" / "YYYY-MM-DD"
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
// 读取左侧列表
function loadConvList() {
  try {
    const raw = localStorage.getItem(listKey());
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
// 保存左侧列表
function saveConvList() {
  try {
    localStorage.setItem(listKey(), JSON.stringify(conversations.value || []));
  } catch (e) { /* 容量超限等 → 静默忽略 */ }
}
// 保存当前会话（含 messages / entities / 等）到 localStorage
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
  const ix = (conversations.value || []).findIndex(c => c.id === currentConvId.value);
  // 关键：title 不再无脑覆盖为自动生成。
  //   - 如果会话已存在且标题非空（被用户改过或已有），保留旧标题。
  //   - 首次保存（无记录）或标题为空，才用 autoTitle(msgs) 自动生成。
  const existingTitle = (ix >= 0 ? conversations.value[ix].title : '') || '';
  const meta = {
    id: currentConvId.value,
    title: existingTitle.trim() ? existingTitle : autoTitle(msgs),
    createdAt: now,
    updatedAt: now,
    msgCount: msgs.length,
    lastUserText: lastUser
  };
  if (ix >= 0) {
    meta.createdAt = conversations.value[ix].createdAt || now;
    conversations.value.splice(ix, 1);
  }
  conversations.value.unshift(meta);
  saveConvList();
  try { localStorage.setItem(curKey(), currentConvId.value); } catch (e) {}
}
// saveChat 是 saveCurrentConv 的别名（更短）
function saveChat() { saveCurrentConv(); }

// 进入页面时恢复"列表 + 当前会话"
function restoreChat() {
  conversations.value = loadConvList();
  restoreCurrent();
}

// 单独恢复当前会话（也用于切换 workspace 后重新载入）
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
  nextTick(() => scrollChatToBottom(true));
}

// 新建对话（skipArchive=true 时不归档老的）
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
  stepIdx.value = 0;
  try { localStorage.removeItem(curKey()); } catch (e) {}
  if (net) { try { net.destroy(); } catch (e) {} net = null; }
  nodesDS = null;
  edgesDS = null;
  cancelRename();
}

// 加载某条历史对话
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
  nextTick(() => scrollChatToBottom(true));
}

// 删除一条历史对话（带二次确认）
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

// 进入重命名态（把焦点放到 input）
function startRename(id) {
  const meta = (conversations.value || []).find(c => c.id === id);
  if (!meta) return;
  renamingId.value = id;
  renamingTitle.value = meta.title || '';
  nextTick(() => {
    // renameRefs 存的是 el-input 组件实例，需要从它拿内部原生 input 才能 focus/select
    const comp = renameRefs.get(id);
    const inp = comp && comp.$refs ? comp.$refs.input : null;
    if (inp && inp.focus) {
      inp.focus();
      if (inp.select) inp.select();
    }
  });
}
// 确认重命名：把新标题写入会话 meta 并保存
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
// 取消重命名：清空重命名状态
function cancelRename() {
  renamingId.value = null;
  renamingTitle.value = '';
}

// 展开/收起历史面板
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
// 关闭历史面板并重绘子图（面板遮挡后 vis-network 需要重新 fit）
function closeHistory() {
  showHistory.value = false;
  cancelRename();
  nextTick(() => {
    if (net && net.redraw) {
      try { net.fit({ animation: false }); net.redraw(); } catch (e) {}
    }
  });
}

// 点击 [n] 引用：在 lastRefs 中找到对应文件并打开
async function openRef(n) {
  const idx = Number(n) - 1;
  const ref = lastRefs.value && lastRefs.value[idx];
  if (!ref || !ref.file_path) {
    setStatus(false, '未找到引用 ' + n + ' 对应的资料（可能被新提问覆盖或本地存储过期）');
    return;
  }
  await openOriginalFile(ref.file_path);
}

/* ============================================================
 * 引用悬浮气泡（hover）
 * ============================================================ */
// 延迟隐藏气泡（用户从引用号滑到气泡的窗口期）
function scheduleHoverHide(delay) {
  if (_hoverTimer) clearTimeout(_hoverTimer);
  _hoverTimer = setTimeout(() => { hover.visible = false; _hoverTimer = null; }, delay != null ? delay : 450);
}
function cancelHoverHide() {
  if (_hoverTimer) { clearTimeout(_hoverTimer); _hoverTimer = null; }
}
// 立即隐藏气泡
function hideHover() { cancelHoverHide(); hover.visible = false; }
// 鼠标进入"引用号"时显示气泡
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
  // 气泡定位：默认在鼠标右下角；超出视口则镜像翻转
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
// 鼠标在对话区移动：在引用号上取消隐藏，离开则延迟隐藏
function onChatMove(ev) {
  if (!hover.visible) return;
  const t = ev.target;
  const inCite = t && t.closest && t.closest('.cite');
  const inBubble = t && t.closest && t.closest('.cite-hover');
  if (inCite || inBubble) { cancelHoverHide(); return; }
  scheduleHoverHide(450);
}
// 鼠标离开对话区 → 延迟隐藏气泡
function onChatLeave() { scheduleHoverHide(450); }
// 鼠标进入气泡 → 取消隐藏
function onBubbleEnter() { cancelHoverHide(); }
// 鼠标在气泡上移动 → 取消隐藏
function onBubbleMove() { cancelHoverHide(); }
// 鼠标离开气泡 → 立即隐藏
function onBubbleLeave() { hideHover(); }

/* ============================================================
 * 主查询入口
 * ------------------------------------------------------------
 * 流程：
 *   1. validateOpt 自检（mode/topK 等）
 *   2. 推入用户消息 + AI 占位消息
 *   3. 同步发 queryData()、await streamRag()（带 onToken 增量更新）
 *   4. 把 entities/relationships/keywords 写到 ref，由 buildGraph() 渲染右子图
 * ============================================================ */
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

  // 把用户消息入栈
  messages.value.push({ role: 'user', text: q, ts: Date.now() });
  query.value = '';

  // AI 占位消息（reactive 让流式回调里 push progress 也能触发 UI 更新）
  // streaming=true：让模板渲染时显示三圆点动画 + 末尾闪烁光标；
  //   流结束时设回 false，模板就会去掉 caret，只显示真正的 markdown。
  const aiMsg = reactive({
    role: 'ai', text: '', html: '',
    streaming: true, ts: Date.now(), refs: []
  });
  messages.value.push(aiMsg);
  nextTick(() => saveChat());

  const t0 = performance.now();
  try {
    // queryData() 与 streamRag() 并行：前者拉"实体 + 关系"，后者是流式生成。
    // queryData 是独立的 Promise，错误也要 catch 掉（不能让对侧失败被吞）
    const dataP = queryData(ws.value, q, opt).catch(err => ({ entities: [], relationships: [], chunks: [], metadata: {}, _err: err.message || String(err) }));

    stepIdx.value = 1;
    await waitFrame(80);

    // 流式问答：onToken 在每个 token 进来时调用，更新 aiMsg.text/html 并自动滚到底
    const ans = await streamRag(ws.value, q, opt, (delta, full) => {
      aiMsg.text = full;
      aiMsg.html = mdToHtml(full);
      // html 已非空 → 模板自动从 waitingHtml 切到真实 markdown + 闪烁 caret
      nextTick(() => scrollChatToBottom());
    });
    // 流结束：去掉闪烁光标，显示最终内容
    aiMsg.streaming = false;

    stepIdx.value = 2;
    const data = await dataP;
    stepIdx.value = 3;

    lastRefs.value = ans.references || [];
    aiMsg.refs = lastRefs.value;
    aiMsg.html = mdToHtml(aiMsg.text);

    // 把检索到的实体/关系填到 ref，buildGraph() 会异步渲染右子图
    entities.value = data.entities || [];
    relationships.value = data.relationships || [];
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
    aiMsg.streaming = false;
    status.ok = false;
    status.text = '查询失败: ' + (err.message || err);
    saveChat();
  } finally {
    nextTick(() => scrollChatToBottom());
  }
}

// 聊天容器滚到底（仅在用户处于"底部附近"时）
// 行业实践（ChatGPT / Claude）：
//   - 用户当前在底部（或离底部 < 80px）→ 自动滚到底（用户想看新消息）
//   - 用户向上滚动看历史 → 不要拉回（让用户继续看历史）
//   - 用 chatScroll.dataset.stickToBottom 跟踪用户是否在底部
//     默认 '1'（粘底）；用户滚上去 → '0'；滚回到底 → '1'
// force=true：强制滚到底并重置粘底标记（用于切换/加载会话时，
//   避免沿用上一个会话"用户滚上去了"的旧状态，导致新会话开头不对齐底部）。
function scrollChatToBottom(force) {
  const el = chatScroll2.value || chatScroll.value;
  if (!el) return;
  if (force) el.dataset.stickToBottom = '1';
  // 检查"是否粘底"标记：用户主动向上滚后我们设过 '0'，要尊重用户
  if (el.dataset.stickToBottom === '0') return;
  el.scrollTop = el.scrollHeight;
}
// 监听用户手动滚动：向上滚动时停止"粘底"，用户滚回底部后恢复
function onChatScroll(ev) {
  const el = ev.target;
  if (!el) return;
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  el.dataset.stickToBottom = nearBottom ? '1' : '0';
}
// 点击聊天内容：识别引用的 [n] 并打开
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

/* ============================================================
 * 子图构建（vis-network）
 * ------------------------------------------------------------
 * 节点来源：entities 数组（数组里每项都是 LightRAG 给的一个 entity 对象）；
 * 关系来源：relationships 数组（src/tgt 是 entity_name）。
 * 由于 src/tgt 可能指向 entities 外的其他节点（例如其他片段的关系），
 * buildGraph 内会把"关系里出现但不在 entity 里的"也补成节点（标记为 "(其他)"）。
 * ============================================================ */
// 同 GraphView：key 命名美化
function prettifyKey(k) {
  return String(k).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
// 节点属性 → 展示项（剔除保留键 + 空值）
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
// 日期对象 / 数组 / 普通值的格式化
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
// 取节点的原文片段并填充到 sel.segs
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

// buildGraph —— 用 entities + relationships 渲染到 vis-network
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
  // 已勾选的只在本次 type 集合里保留；空了就全选
  const next = selectedTypes.value.filter(t => techTypes.includes(t));
  if (!next.length) selectedTypes.value = techTypes.slice();
  else selectedTypes.value = next;

  // 颜色映射（同 GraphView 的 TECH_PALETTE 配色策略）
  const TECH_PALETTE = [
    '#2563eb', '#16a34a', '#ea580c', '#dc2626',
    '#9333ea', '#0891b2', '#65a30d', '#db2777',
    '#ca8a04', '#0d9488', '#4f46e5', '#7c3aed'
  ];
  const _qAssign = new Map();
  // 字符串 hash（与 GraphView 的 hashStr 同逻辑，用于颜色分配）
  function qHash(s) { let h = 0; const k = String(s || '');
    for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0;
    return Math.abs(h); }
  // 按 type 分配颜色（首次计算后缓存，同 GraphView 的 colorFor）
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

  // 真正画图：vis.DataSet（每次重建，让物理引擎做一次完整 stabilization 布局）
  nodesDS = new vis.DataSet(sizedNodes);
  edgesDS = new vis.DataSet(visEdges);

  const container = document.getElementById('qnet');
  // 同 GraphView 的物理引擎参数
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
      arrows: 'to'             // 关系是有向的，箭头指向目标
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
  // 每次都销毁旧 Network 重建，确保 stabilization 正常运行（避免白屏）
  if (net) { try { net.destroy(); } catch (e) {} net = null; }
  if (!net) {
    net = new vis.Network(container, { nodes: nodesDS, edges: edgesDS }, options);
    net.on('click', p => onGraphPick(p));
    net.on('doubleClick', p => {
      if (p.nodes.length) net.focus(p.nodes[0], { scale: 1.1 });
    });
  }

  // 把每个节点的 group 颜色写到 DataSet，保证填充色稳定
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

  // 布局完成后切到极慢模式
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

  // 重置选中详情
  Object.assign(sel, { visible: false, kind: '', title: '', type: '', descr: '',
    props: {}, extraProps: [], srcIds: [], fps: [], segs: [] });
  loading.value = false;
}

// 类型筛选：和 GraphView 一样的实现
function toggleType(t) {
  const i = selectedTypes.value.indexOf(t);
  if (i >= 0) selectedTypes.value.splice(i, 1);
  else selectedTypes.value.push(t);
  applyTypeFilter();
}
// 全选所有类型
function selectAllTypes() { selectedTypes.value = typeList.value.slice(); applyTypeFilter(); }
// 取消所有类型
function selectNoneTypes() { selectedTypes.value = []; applyTypeFilter(); }
// 按已选类型刷新节点/边可见性
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
// 适应视图：居中 + 缩放到合适大小
function fitView() { if (net) net.fit({ animation: { duration: 400 } }); }

// 子图点击：节点 → 居中 focus + 显示详情 + 异步拉属性；边 → 显示关系详情；空白 → 收起
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
    loadNodeAttrs(r.name);          // 异步去 Neo4j 拉节点的 properties
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

// loadNodeAttrs —— 节点点击时通过后端 api 拉它的 properties（不再直连 Neo4j）
async function loadNodeAttrs(name) {
  if (!name) return;
  try {
    const result = await api.node(ws.value, name);
    if (!result || !result.props) return;
    const props = result.props;
    Object.assign(sel, {
      props,
      extraProps: extractExtraProps(props)
    });
  } catch (err) { /* ignore */ }
}

/* ============================================================
 * 生命周期
 * ============================================================ */
onMounted(() => {
  net = null; nodesDS = null; edgesDS = null;
  const q = route.query;
  if (q.ws) ws.value = q.ws;
  document.title = '智能问答 · 妃子笑荔枝文化图谱';
  restoreChat();
  // 注册 beforeunload：刷新/关闭前自动存档
  _onUnload = () => { if (messages.value.length || entities.value.length) saveCurrentConv(); };
  window.addEventListener('beforeunload', _onUnload);
});

onBeforeUnmount(() => {
  // 组件卸载前也要存一次 + 清理监听和 vis-network
  if (messages.value.length || entities.value.length) saveCurrentConv();
  if (_onUnload) window.removeEventListener('beforeunload', _onUnload);
  if (_hoverTimer) { clearTimeout(_hoverTimer); _hoverTimer = null; }
  if (net) { try { net.destroy(); } catch (e) {} }
});

// URL ?ws= 变化 → 切 workspace（保存老的 + 加载新 workspace 的会话）
watch(() => route.query.ws, (v) => {
  if (v && v !== ws.value) {
    if (messages.value.length || entities.value.length) saveCurrentConv();
    ws.value = v;
    conversations.value = loadConvList();
    restoreCurrent();
  }
});
// ws 内部变化（用户选下拉时触发） → 也走同样流程
watch(ws, (v, ov) => {
  if (!v || v === ov) return;
  if (messages.value.length || entities.value.length) saveCurrentConv();
  conversations.value = loadConvList();
  restoreCurrent();
});
</script>

<style scoped>
/* ============================================================
 * QueryView 专属样式（统一内联在 <style scoped>，与组件内聚）
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
  height: min(85vh, 800px);
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

/* 进度条 */
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

/* 聊天滚动容器 */
.chat-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 20px;
  background: var(--surface);
}

/* ============================================================
 * ChatGPT 风格底部固定输入区
 * ============================================================ */
/* 输入区容器：固定在底部 */
.chat-input {
  flex: 0 0 auto;
  padding: 12px 16px 14px;
  background: var(--surface);
  border-top: 1px solid var(--border);
}

/* 输入框包装器：圆角边框 + 阴影（ChatGPT 风格） */
.input-wrap {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  background: #f4f6f8;
  border: 1px solid var(--border-2);
  border-radius: 12px;
  padding: 6px 6px 6px 12px;
  box-shadow: 0 2px 8px rgba(15, 26, 42, .08);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.input-wrap:focus-within {
  border-color: var(--primary);
  box-shadow: 0 2px 12px rgba(31, 111, 235, .15);
}

/* textarea 样式：去除边框，透明背景 */
.chat-textarea {
  flex: 1;
  min-height: 24px;
  max-height: 120px;
}
.chat-textarea :deep(.el-textarea__inner) {
  border: none;
  background: transparent;
  resize: none;
  padding: 4px 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-1);
  box-shadow: none !important;
}
.chat-textarea :deep(.el-textarea__inner::placeholder) {
  color: var(--text-3);
}
.chat-textarea :deep(.el-textarea__inner:disabled) {
  background: transparent;
}

/* 发送按钮：圆形主色按钮 */
.send-btn {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  min-width: 34px;
  padding: 0;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.15s, transform 0.1s;
}
.send-btn:not(:disabled):hover {
  background: var(--primary-strong);
  transform: scale(1.05);
}
.send-btn:not(:disabled):active {
  transform: scale(0.95);
}
.send-btn:disabled {
  background: var(--border);
  opacity: 0.6;
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

/* 头像圆 */
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
  font-size: 13.5px;
  line-height: 1.7;
  word-break: break-word;
}
.bubble.user {
  background: var(--primary-soft);
  color: var(--text-1);
  border-top-right-radius: 4px;
}
.bubble.ai {
  background: var(--surface-2);
  color: var(--text-1);
  border: 1px solid var(--border);
  border-top-left-radius: 4px;
}
.bubble.ai :deep(.cite) {
  color: var(--primary);
  font-weight: 700;
  cursor: pointer;
  padding: 0 2px;
}
.bubble.ai :deep(.cite:hover) {
  text-decoration: underline;
}

/* ... 大量预设样式（与提问后布局共用） ... */
/* 保留必要的关键样式，简略展示 */

.bubble.ai :deep(.md-p) { margin: 0 0 8px; }
.bubble.ai :deep(.md-h) { color: var(--primary-strong); margin: 8px 0 4px; }
.bubble.ai :deep(.md-code) {
  background: #0f1a2a;
  color: #e8eefb;
  padding: 1px 6px;
  border-radius: 4px;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 12.5px;
}
.bubble.ai :deep(.md-list) { margin: 4px 0 8px 18px; }

/* 推荐问题 */
.presets-inline {
  padding: 12px 18px 0;
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

/* 已提问后布局 */
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

/* 子图生长中遮罩 */
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
.grow-title { font-size: 15px; font-weight: 700; color: var(--text-1); }
.grow-step  { font-size: 13px; color: var(--primary-strong); font-weight: 600; }
.grow-hint  { font-size: 11.5px; color: var(--text-3); text-align: center; line-height: 1.5; }

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
#qside .relsrc .isrc-open { font-size: 11.5px; }

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
#qlegend .lhead { color: #b6c4de; margin-bottom: 4px; font-weight: 600; }
#qlegend .sw {
  width: 11px;
  height: 11px;
  border-radius: 3px;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, .18);
}

/* 引用气泡外观（备用样式，组件本身已有，但 scope 隔离后这里可以再设） */
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

/* 输入区"打字中"动画 */
.typing {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-3);
  font-size: 12.5px;
}
.typing-dots { display: inline-flex; gap: 4px; }
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

/* 历史会话抽屉 */
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
  writing-mode: vertical-rl;          /* 竖排文字"会话" */
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
  opacity: 0;                                    /* 默认隐藏，hover 时显示 */
  transition: opacity 0.14s;
  gap: 2px;
}
.hd-panel .hd-item:hover .hd-item-actions,
.hd-panel .hd-item.active .hd-item-actions {
  opacity: 1;
}
/* el-button link 在卡片里的视觉调整：与手搓 button 一致（圆角、hover 加浅色底） */
.hd-panel .hd-act-btn {
  padding: 3px 6px !important;
  height: auto !important;
  min-height: 0 !important;
  font-size: 13px;
  border: 1px solid rgba(255, 255, 255, .2);
  border-radius: 6px;
  background: rgba(255, 255, 255, .08);
  color: #dbe4f5;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
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
