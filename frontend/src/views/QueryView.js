/* ============================================================
 * QueryView.vue —— 智能问答页（路由 /query?ws=<workspace>）
 * ------------------------------------------------------------
 *  这个页面让用户用自然语言问问题，左侧看 AI 流式回答（含 [n] 引用），
 *  右侧看本次问题相关的子图谱。整体上跟「GraphView 大图谱」风格保持一致，
 *  但额外做了：流式回答 / 引用气泡 / 对话记忆 / 推荐问题 / 加载遮罩衔接。
 *
 *  读这文件可以从上到下按这段顺序看：
 *
 *  1. 顶部注释 / 引入
 *     - WS_META / wsMeta / getDriver：同 GraphView
 *     - queryData / streamRag / fetchChunk / splitSep / openOriginal
 *       都来自 api/lightrag.js，是 LightRAG 后端的 HTTP 客户端封装
 *
 *  2. mdToHtml：把 LLM 输出的 Markdown 渲染成 HTML
 *     - 4 个步骤：剥离思考块 → 规范化引用 → 转义 / Markdown → 把哨兵替换为 cite
 *     - cite 是 .cite 标签，鼠标指着会触发 onChatOver 显示 chunk、点击触发 openRef
 *
 *  3. normCite（紧邻 mdToHtml）
 *     - 专门处理「模型思考过程」+「REFxx 引用占位」→「[n] 连续编号」
 *     - 删掉模型可能输出的 ### References 列表（前端用自己的引用气泡）
 *
 *  4. waitingHtml：等待回答时的动画占位（跳动点 + 闪烁光标）
 *
 *  5. export default 组件
 *     - data()：对话/子图/图例/侧栏/引用/悬浮气泡/记忆 各类状态
 *         · ws / mode：当前工作区 + 查询模式（mix/local/global/naive/hybrid/bypass）
 *         · presetsByWs：每个工作区独立的推荐问题
 *         · messages / lastRefs / hover：对话气泡、引用列表、悬浮气泡
 *         · histKey / saveChat / restoreChat：localStorage 对话记忆
 *     - runQuery(preset)：主查询流程（与 buildGraph 并行）
 *         · 流式调用 streamRag → 逐 token 写入气泡（mdToHtml）
 *         · 同时 queryData 取子图 → buildGraph 渲染
 *         · 进度条 4 步：解析问题 → 图谱检索 → 取回原文 → 组织答案
 *     - buildGraph：vis-network 子图渲染（与 GraphView 同款结构）
 *     - onGraphPick：点击节点 / 边 / 空白的处理（含视图冻结）
 *     - saveChat / restoreChat：刷新后保留历史
 *
 *  6. 模板：两段布局
 *     - 未提问：彩色背景 + 居中对话框 + 推荐问题
 *     - 提问后：左对话框 + 右子图
 * ============================================================ */
import { WS_META, wsMeta, getDriver } from '../api/neo4j.js';
import {
  queryData, streamRag, fetchChunk, splitSep, openOriginal
} from '../api/lightrag.js';

const PALETTE = ['#4fa3ff', '#3ecf6a', '#ffd257', '#ff7eb6', '#b28dff', '#ff9f43',
  '#4dd0c4', '#f0616f', '#9ccc65', '#64b5f6', '#ffb74d', '#ba68c8',
  '#4db6ac', '#e57373', '#aed581'];

// 把 LightRAG 后端吐出的 markdown 文本渲染为简洁 HTML：
// 1) 行内的 [n] → 可点击溯源气泡
// 2) 数字编号列表 / 普通段落 / 简单 markdown
// 预处理：剥离 <thinking>/```thinking``` 思考块（不把推理过程展示给用户），
// 并把后端可能输出的 REFxx / REF xx 引用占位统一归一到连续 [n]
function normCite(s) {
  s = String(s);
  // —— 1) 剥离模型思考过程（多种 LLM 的思考块标签都覆盖，不展示给用户）——
  //   包括 <thinking>…</thinking>、<think>…</think>、«think»、代码块 ```thinking…```
  //   以及行首以 "### Thinking / 思考过程：" 等开头的整段（含换行）
  s = s.replace(/```(?:thinking|reasoning|thought)[\s\S]*?```/gi, '');
  s = s.replace(/<\/?think(?:ing)?>/gi, '');                      // 拆掉孤立的 <think> 标签
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  s = s.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  s = s.replace(/«(?:think|thinking|reasoning)»[\s\S]*?«\/(?:think|thinking|reasoning)»/gi, '');
  s = s.replace(/^\s*(?:###\s*)?(?:思考过程|Thinking Process|Reasoning|思考|Thinking)\s*[:：]?[\s\S]*?(?=\n\s*\n|$)/i, '');
  // —— 2) 把 REFxx / REF xx 统一归一到 [n]
  s = s.replace(/REF\s*(\d+)/gi, '[$1]');
  // —— 3) 按首次出现顺序重新编号为连续 [1][2]…（论文式）——
  //   同时保留「原编号 → 新编号」的映射，并嵌入哨兵 "§§oldIdx-newIdx§§"
  //   后续 mdToHtml 用这个哨兵渲染 <span class="cite" data-ref="oldIdx">[newIdx]</span>
  //   这样点 [3] 时拿到 data-ref=原编号，能精确对应到 lastRefs[原编号-1]，避免错位
  const seen = {};
  let seq = 0;
  s = s.replace(/\[(\d+)\]/g, (m, oldStr) => {
    let n;
    if (!(oldStr in seen)) { seq += 1; seen[oldStr] = seq; }
    n = seen[oldStr];
    return '\u0000R' + oldStr + '-' + n + '\u0000';
  });
  // —— 4) 干掉 LightRAG 默认追加的 "### References" 整段（前端有自己的引用气泡，无需重复）——
  s = s.replace(/\n{0,2}#{1,3}\s*References[\s\S]*$/i, '');
  return s;
}

function mdToHtml(s) {
  if (!s) return '';
  // 先做「思考过程剥离 + 引用归一」 → 文本里的 [n] 已被替换成哨兵 \u0000R{原编号}-{新编号}\u0000
  s = normCite(s);
  // 1) 转义 HTML（哨兵不在转义范围，会一直保留到最后一步）
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // 3) 代码块 / 行内代码
  s = s.replace(/```([\s\S]*?)```/g, (m, p1) => '<pre class="md-code">' + p1 + '</pre>');
  s = s.replace(/`([^`]+)`/g, '<code class="md-code">$1</code>');
  // 4) 加粗 / 斜体
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<i>$1</i>');
  // 5) 标题（### ## #）
  s = s.replace(/^#### (.+)$/gm, '<h4 class="md-h">$1</h4>');
  s = s.replace(/^### (.+)$/gm, '<h3 class="md-h">$1</h3>');
  s = s.replace(/^## (.+)$/gm, '<h2 class="md-h">$1</h2>');
  s = s.replace(/^# (.+)$/gm, '<h1 class="md-h">$1</h1>');
  // 6) 数字编号列表
  s = s.replace(/(?:^|\n)((?:\d+\.\s+.+(?:\n|$))+)/g, (m, block) => {
    const items = block.trim().split(/\n/).filter(l => /^\d+\.\s+/.test(l))
      .map(l => '<li>' + l.replace(/^\d+\.\s+/, '') + '</li>').join('');
    return '\n<ol class="md-list">' + items + '</ol>';
  });
  // 7) 普通段落：空行分段
  s = s.split(/\n{2,}/).map(blk => {
    blk = blk.trim();
    if (!blk) return '';
    if (/^<(h\d|pre)/.test(blk)) return blk;
    if (/^<ol/.test(blk)) return blk;
    return '<p class="md-p">' + blk.replace(/\n/g, '<br>') + '</p>';
  }).join('\n');
  // 7) 把哨兵还原为可点击 cite
  //    data-ref = 原编号（1-based，对应 lastRefs[原编号-1] 的 file_path），
  //    显示的 [n] = 新编号（按首次出现顺序的连续编号，论文式）。
  //    这样点击 [3] 能精确打开原网页，不会因引用顺序与首次出现顺序不一致而错位。
  s = s.replace(/\u0000R(\d+)-(\d+)\u0000/g, (_, oldIdx, newIdx) =>
    '<span class="cite" data-ref="' + oldIdx + '">[' + newIdx + ']</span>');
  return s;
}

export default {
  name: 'QueryView',
  data() {
    return {
      ws: 'g00_master_all',
      wsOptions: WS_META.map(m => ({ v: m.id, t: m.name })),
      mode: 'mix',
      modes: [
        // 名称使用「中文 + 原 LightRAG 英文键」对照；提示用 LightRAG
        // 官方 README 中的原话翻译 + 行为说明，让用户一眼看懂会做什么。
        { v: 'mix',
          t: '综合（推荐）',
          tip: 'mix：同时查知识图谱和原文。问「这个人物做过什么」「这些事物怎么连起来」之类综合问题时效果最好，一般先用它。' },
        { v: 'hybrid',
          t: '混合检索',
          tip: 'hybrid：把关键词匹配和语义匹配两条路的结果合并起来查。适合「既要命中具体名词，也要理解意思」的提问。' },
        { v: 'local',
          t: '局部上下文',
          tip: 'local：以图中实体为中心，向外找它的邻居节点与原文。适合问「某物/某人具体细节、与什么相关」。' },
        { v: 'global',
          t: '全局主题',
          tip: 'global：从整张图的高层关系出发抓主题脉络。适合问「总体上讲了哪几条主线、哪些大趋势」。' },
        { v: 'naive',
          t: '纯原文',
          tip: 'naive：只做原文段落检索，不用图谱关系。适合纯文本型问题；当其他模式有杂讯时可作对照。' },
        { v: 'bypass',
          t: '只检索不生成',
          tip: 'bypass：不调用 LLM，直接把检索到的原文片段返回。用于快速核对资料来源、或排查检索效果。' }
      ],
      query: '',
      // 每个工作区主题不同 → 推荐问题也应不同；切到该工作区时自动换
      presetsByWs: {
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
      },
      // 当前 ws 的预设推荐问题（由下方 computed `presets` 派生自 presetsByWs[ws]）
      // 对话状态：started=true 后切换为左右布局
      started: false,
      loading: false,
      status: { ok: false, text: '' },
      // 加载进度步骤
      stepIdx: 0,
      steps: ['解析问题', '图谱检索', '取回原文', '组织答案'],
      // 对话气泡
      messages: [],     // [{ role: 'user'|'ai', html: '', ts }]
      // 子图
      entities: [], relationships: [],
      // 子图图例（多选筛选）
      typeList: [], typeColors: {}, selectedTypes: [],
      // 选中节点/关系（与 GraphView #side 同款结构）
      sel: { visible: false, kind: '', title: '', type: '', descr: '',
        props: {}, extraProps: [], srcIds: [], fps: [], segs: [] },
      // 折叠态
      descrOpen: true,
      attrsOpen: true,
      // 最近一次回答的引用列表（[n] 溯源用）
      lastRefs: [],
      // 引用悬浮气泡：鼠标指到 [n] 时显示 chunk 内容，移开即隐藏
      hover: { visible: false, x: 0, y: 0, title: '', content: '' },
      // 进度卡显示开关：回答完成后保持不隐藏，直到下一轮提问才重置重新走一遍
      showProgress: false,
      // AI 后加工开关（启用后再调一次 LLM 改写回答；默认关闭以省 token/延迟）
      aiPolish: false,
      // 后加工调用状态：'idle' | 'polishing' | 'done' | 'failed'
      polishState: 'idle',
      // ====== 多会话存档（行业实践：左侧抽屉列出所有会话、可切换/重命名/新建/删除） ======
      //   存储设计：
      //   - qchat_idx_<ws>   ：会话索引（仅元数据，体积小），按 updatedAt 倒序
      //   - qchat_<ws>_<id>  ：单个会话的完整快照（messages + entities/relationships/图例等）
      //   - qchat_cur_<ws>   ：当前激活的会话 id（null 表示空 / 正在输入新对话）
      //   这样列表展示很轻，点开才加载完整数据，localStorage 容量压力最小。
      conversations: [],       // 当前 ws 的会话索引（按 updatedAt 倒序）
      currentConvId: null,     // 当前会话 id，null = 还没创建 / 全新
      showHistory: false,      // 抽屉是否展开
      historyFilter: '',       // 抽屉里的搜索关键字（按标题/最后一条用户消息过滤）
      renamingId: null,        // 正在重命名的会话 id（input 模式）
      renamingTitle: ''        // 重命名输入框的实时值
    };
  },
  computed: {
    currentMeta() { return wsMeta(this.ws); },
    selTypes() { return this.selectedTypes; },
    // 当前工作区的预设推荐问题；切到不同维度时自动换一套
    presets() { return this.presetsByWs[this.ws] || this.presetsByWs.g00_master_all; },
    // 图例两个批量开关的勾选态
    allSelected() { return this.typeList.length > 0 && this.selectedTypes.length === this.typeList.length; },
    noneSelected() { return this.selectedTypes.length === 0; },
    // 抽屉里展示的会话列表：先按更新时间倒序，再按搜索关键字过滤
    //   行业实践：列表展示时间越近越靠上，跟 ChatGPT / 文心一言 / 豆包 一致
    filteredConvs() {
      const arr = this.conversations || [];
      const kw = (this.historyFilter || '').trim().toLowerCase();
      if (!kw) return arr;
      return arr.filter(c =>
        (c.title && String(c.title).toLowerCase().includes(kw)) ||
        (c.lastUserText && String(c.lastUserText).toLowerCase().includes(kw))
      );
    }
  },
  watch: {
    '$route.query.ws'(v) {
      if (v && v !== this.ws) {
        // 切到新工作区前先归档当前（避免跨 ws 串了）
        if (this.messages.length || this.entities.length) this.saveCurrentConv();
        this.ws = v;
        // 重载新 ws 的会话索引 + 自动恢复该 ws 的最后一次会话
        this.conversations = this.loadConvList();
        this.restoreCurrent();
      }
    },
    // 用户改了 ws 选择（不只是路由变化）→ 同样归档+切换
    ws(v, ov) {
      if (!v || v === ov) return;
      if (this.messages.length || this.entities.length) this.saveCurrentConv();
      this.conversations = this.loadConvList();
      this.restoreCurrent();
    }
  },
  async mounted() {
    this.net = null; this.nodesDS = null; this.edgesDS = null;
    const q = this.$route.query;
    if (q.ws) this.ws = q.ws;
    document.title = '智能问答 · 妃子笑荔枝文化图谱';
    // 刷新后恢复本工作区的对话历史（含会话列表与最近一次会话）
    this.restoreChat();
    // 刷新/关页前把当前对话归档（流式写到一半的用户输入也不丢）
    //   用 window 'beforeunload' 最稳；避免每次 route 变化也触发（那会重复归档）
    this._onUnload = () => { if (this.messages.length || this.entities.length) this.saveCurrentConv(); };
    window.addEventListener('beforeunload', this._onUnload);
  },
  unmounted() {
    // 离开页面时归档当前对话，并解绑事件
    if (this.messages.length || this.entities.length) this.saveCurrentConv();
    if (this._onUnload) window.removeEventListener('beforeunload', this._onUnload);
    if (this._hoverTimer) { clearTimeout(this._hoverTimer); this._hoverTimer = null; }
    if (this.net) { try { this.net.destroy(); } catch (e) {} }
  },
  methods: {
    // 给 v-html 用的轻量 HTML 转义（防 XSS + 不破坏气泡渲染）
    escapeHtml(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
    },
    /* ---------- 路由 ---------- */
    goHome() { this.$router.push('/'); },
    goGraph() { this.$router.push('/graph/' + this.ws); },

    // 打开原文：优先用浏览器直接打开原始文件（html 原网页 / pdf / png…）
    async openOriginalFile(fp) {
      if (!fp) return;
      const ok = await openOriginal(fp, this.ws);
      if (!ok) this.openDoc(fp);
    },
    openDoc(fp) {
      if (!fp) return;
      const url = window.location.origin + window.location.pathname +
        '#/doc?ws=' + encodeURIComponent(this.ws) + '&file=' + encodeURIComponent(fp);
      window.open(url, '_blank');
    },

    // Shift+Enter 换行：单独成方法，避免模板字符串里的 \n 被解析成真实换行导致编译报错
    appendNewline() { this.query += '\n'; },

    // 顶部状态条工具：ok=true 绿色 dot，false 红色；统一调用点方便后续接 toast
    setStatus(ok, text) { this.status = { ok: !!ok, text: String(text || '') }; },

    // 前端输入校验：在发出请求前拦截 LightRAG 后端会 422 拒绝的 body，
    //   这样用户能看到明确的中文提示，而不是「查询失败: HTTP 422」这种原始错误。
    // 校验规则镜像 LightRAG 的 QueryRequest Pydantic 模型：
    //   - query: trim 后 ≥ 3 字符
    //   - mode: 必须是 ['mix','local','global','hybrid','naive','bypass'] 之一
    //   - top_k / chunk_top_k: 1 ≤ x ≤ 1000
    //   - response_type: trim 后 ≥ 1 字符（前端总传非空，但防御）
    validateOpt(opt) {
      const ALLOWED_MODES = ['mix', 'local', 'global', 'hybrid', 'naive', 'bypass'];
      if (!opt || typeof opt !== 'object') return '参数不合法';
      const q = (this.query || '').trim();
      if (q.length < 3) return '请输入至少 3 个字符的问题';
      if (!ALLOWED_MODES.includes(opt.mode)) return '查询模式不合法（' + (opt.mode || '') + '），请刷新页面或换一个模式';
      const tk = Number(opt.topK);
      if (!Number.isFinite(tk) || tk < 1 || tk > 1000) return 'topK 必须在 1..1000 之间';
      const ck = Number(opt.chunkTopK);
      if (!Number.isFinite(ck) || ck < 1 || ck > 1000) return 'chunkTopK 必须在 1..1000 之间';
      return '';   // 校验通过
    },

    // 等待回答时的动画占位（行业实践：跳动点 + 闪烁光标，让用户感到正在工作）
    waitingHtml() {
      return '<div class="typing"><span class="typing-dots"><i></i><i></i><i></i></span>' +
        '<span class="typing-text">正在组织答案<span class="caret"></span></span></div>';
    },

    // 对话记忆：localStorage 按工作区保存，刷新页面历史仍保留
    //   行业实践（三段式存储，与 ChatGPT / 文心 / 豆包的会话列表一致）：
    //     · 索引 qchat_idx_<ws>     : [{id, title, createdAt, updatedAt, msgCount, lastUserText}]
    //                                列表只展示这层 → 体积小、加载快
    //     · 快照 qchat_<ws>_<id>    : { messages, lastRefs, entities, relationships,
    //                                    typeList, typeColors, selectedTypes, mode }
    //                                点击会话时才读 → 真正内容跟索引分离
    //     · 指针 qchat_cur_<ws>     : 当前激活的会话 id，null 表示空对话
    //   这样的好处：列 100 条会话索引也只有几 KB，不会撑爆 localStorage 5MB 限额。
    listKey() { return 'qchat_idx_' + (this.ws || 'g00_master_all'); },
    curKey() { return 'qchat_cur_' + (this.ws || 'g00_master_all'); },
    convKey(id) { return 'qchat_' + (this.ws || 'g00_master_all') + '_' + id; },
    histKey() { return this.curKey(); },   // 兼容老调用：把"对话记忆"理解为"当前指针"

    // 生成唯一会话 id（时间戳 + 随机后缀，避免极端情况下的重复）
    genConvId() {
      return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    },

    // 自动标题 = 第一条用户消息的首行（截 24 字），找不到则"新对话"
    //   行业实践：ChatGPT / Claude / 豆包 都是用首问做标题，可读性最好
    autoTitle(messages) {
      const um = (messages || []).find(m => m.role === 'user' && m.text);
      if (!um) return '新对话';
      const t = String(um.text).trim().split('\n')[0].slice(0, 24);
      return t || '新对话';
    },

    // 时间格式化为「刚刚 / N 分钟前 / HH:mm / 昨天 / MM-DD / YYYY-MM-DD」
    //   跟微信、QQ、Slack 的会话列表时间展示一致
    fmtTime(ts) {
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
    },

    // 从 localStorage 读当前 ws 的会话索引
    loadConvList() {
      try {
        const raw = localStorage.getItem(this.listKey());
        if (!raw) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
      } catch (e) { return []; }
    },
    // 写会话索引回 localStorage（只写元数据，体积小）
    saveConvList() {
      try {
        localStorage.setItem(this.listKey(), JSON.stringify(this.conversations || []));
      } catch (e) { /* 容量超限等 → 静默忽略 */ }
    },

    // 把"当前对话"归档：写完整快照 + 更新索引条目
    //   何时调用：
    //     · runQuery 完成 / 出错时
    //     · 切换 ws / 切换会话 / 新建会话前
    //     · 浏览器 beforeunload
    saveCurrentConv() {
      // 没有任何内容 → 不归档（避免空条目污染列表）
      if (!this.messages.length && !this.entities.length) return;
      // 过滤掉空的 AI 占位（流式未完成时 html 为空）
      const msgs = this.messages.filter(m => m.role === 'user' || (m.role === 'ai' && m.html));
      // 还没有 id → 新建一个
      if (!this.currentConvId) this.currentConvId = this.genConvId();
      const now = Date.now();
      // 写完整快照
      const payload = {
        started: this.started,
        messages: msgs,
        lastRefs: this.lastRefs || [],
        entities: this.entities || [],
        relationships: this.relationships || [],
        typeList: this.typeList || [],
        typeColors: this.typeColors || {},
        selectedTypes: this.selectedTypes || [],
        mode: this.mode,
        ws: this.ws,
        updatedAt: now
      };
      try {
        localStorage.setItem(this.convKey(this.currentConvId), JSON.stringify(payload));
      } catch (e) { /* quota exceeded 等忽略，避免阻塞 UI */ }
      // 同步元数据到索引
      const lastUser = (msgs.find(m => m.role === 'user') || {}).text || '';
      const meta = {
        id: this.currentConvId,
        title: this.autoTitle(msgs),
        createdAt: now,
        updatedAt: now,
        msgCount: msgs.length,
        lastUserText: lastUser
      };
      const ix = (this.conversations || []).findIndex(c => c.id === this.currentConvId);
      if (ix >= 0) {
        // 已存在 → 保留原 createdAt，只更新其他字段；同时移到最前
        meta.createdAt = this.conversations[ix].createdAt || now;
        this.conversations.splice(ix, 1);
      }
      this.conversations.unshift(meta);
      this.saveConvList();
      // 写"当前指针"
      try { localStorage.setItem(this.curKey(), this.currentConvId); } catch (e) {}
    },

    // 兼容老接口：saveChat = saveCurrentConv
    //   原代码里 runQuery / mounted 都会调 saveChat，无需逐处替换
    saveChat() { this.saveCurrentConv(); },

    // 挂载时按当前 ws 恢复最近一次的会话
    restoreChat() {
      this.conversations = this.loadConvList();
      this.restoreCurrent();
    },
    // 恢复"当前指针"指向的会话（如果存在）
    restoreCurrent() {
      let cur = null;
      try { cur = localStorage.getItem(this.curKey()); } catch (e) {}
      if (!cur) { this.currentConvId = null; return; }
      const meta = (this.conversations || []).find(c => c.id === cur);
      if (!meta) { this.currentConvId = null; return; }
      // 读完整快照
      let d = null;
      try {
        const raw = localStorage.getItem(this.convKey(cur));
        if (raw) d = JSON.parse(raw);
      } catch (e) { /* ignore */ }
      if (!d) { this.currentConvId = null; return; }
      this.currentConvId = cur;
      this.messages = Array.isArray(d.messages) ? d.messages : [];
      this.lastRefs = d.lastRefs || [];
      this.started = !!d.started;
      this.entities = Array.isArray(d.entities) ? d.entities : [];
      this.relationships = Array.isArray(d.relationships) ? d.relationships : [];
      this.typeList = Array.isArray(d.typeList) ? d.typeList : [];
      this.typeColors = d.typeColors || {};
      this.selectedTypes = Array.isArray(d.selectedTypes) ? d.selectedTypes : [];
      if (d.mode && this.modes.find(m => m.v === d.mode)) this.mode = d.mode;
      // 重渲子图（如果之前已有实体）
      if (this.entities && this.entities.length) {
        this.net = null;          // 强制 buildGraph 走"首次创建"分支
        this.nodesDS = null;
        this.edgesDS = null;
        this.$nextTick(() => this.buildGraph());
      }
      this.$nextTick(() => this.scrollChatToBottom());
    },

    // ====== 新建 / 切换 / 删除 / 重命名 ======
    // 「+ 新建对话」按钮：把当前归档（如果有内容）→ 进入全新空白页
    //   skipArchive=true：不归档当前（用于 deleteConv 删除当前会话后，避免把已删会话又存回来）
    newChat(skipArchive) {
      // 当前对话有内容 → 先归档到列表（除非调用方明确要求跳过，比如刚删了当前会话）
      if (!skipArchive && (this.messages.length || this.entities.length)) this.saveCurrentConv();
      // 清空所有对话状态（不删历史）
      this.currentConvId = null;
      this.started = false;
      this.loading = false;
      this.messages = [];
      this.lastRefs = [];
      this.entities = [];
      this.relationships = [];
      this.typeList = [];
      this.typeColors = {};
      this.selectedTypes = [];
      this.sel = { visible: false, kind: '', title: '', type: '', descr: '',
        props: {}, extraProps: [], srcIds: [], fps: [], segs: [] };
      this.hover = { visible: false, x: 0, y: 0, title: '', content: '' };
      this.showProgress = false;
      this.polishState = 'idle';
      this.stepIdx = 0;
      // 清掉"当前指针"
      try { localStorage.removeItem(this.curKey()); } catch (e) {}
      // 销毁旧 vis-network 实例（避免下次 buildGraph 误用旧的 canvas）
      if (this.net) { try { this.net.destroy(); } catch (e) {} this.net = null; }
      this.nodesDS = null;
      this.edgesDS = null;
      // 新对话：保持现有侧栏开合状态（让用户在折叠/展开由自己控制，更贴近 ChatGPT）
      this.cancelRename();
    },

    // 点击侧栏某条会话 → 同时切换对话 + 走过的子图（与当前对话无差别）
    loadConv(id) {
      if (!id) return;
      // 点的就是当前会话 → 轻反馈收起侧栏，让出更多空间给对话/子图
      if (id === this.currentConvId) { this.closeHistory(); return; }
      // 先归档当前（避免误丢未保存的改动）
      if (this.messages.length || this.entities.length) this.saveCurrentConv();
      // 读目标快照
      let d = null;
      try {
        const raw = localStorage.getItem(this.convKey(id));
        if (raw) d = JSON.parse(raw);
      } catch (e) { /* ignore */ }
      if (!d) {
        this.setStatus(false, '会话数据已损坏或被清除');
        return;
      }
      // 应用到当前
      this.currentConvId = id;
      this.messages = Array.isArray(d.messages) ? d.messages : [];
      this.lastRefs = d.lastRefs || [];
      this.started = !!d.started;
      this.entities = Array.isArray(d.entities) ? d.entities : [];
      this.relationships = Array.isArray(d.relationships) ? d.relationships : [];
      this.typeList = Array.isArray(d.typeList) ? d.typeList : [];
      this.typeColors = d.typeColors || {};
      this.selectedTypes = Array.isArray(d.selectedTypes) ? d.selectedTypes : [];
      if (d.mode && this.modes.find(m => m.v === d.mode)) this.mode = d.mode;
      this.sel = { visible: false, kind: '', title: '', type: '', descr: '',
        props: {}, extraProps: [], srcIds: [], fps: [], segs: [] };
      this.hover = { visible: false, x: 0, y: 0, title: '', content: '' };
      this.showProgress = false;
      this.polishState = 'idle';
      // 写指针 + 索引 updatedAt（把该会话顶到列表最前）
      try { localStorage.setItem(this.curKey(), id); } catch (e) {}
      const ix = (this.conversations || []).findIndex(c => c.id === id);
      if (ix >= 0) {
        this.conversations[ix].updatedAt = Date.now();
        const it = this.conversations.splice(ix, 1)[0];
        this.conversations.unshift(it);
        this.saveConvList();
      }
      // 重建子图：先销毁旧实例（避免重叠渲染）
      if (this.net) { try { this.net.destroy(); } catch (e) {} this.net = null; }
      this.nodesDS = null;
      this.edgesDS = null;
      if (this.entities && this.entities.length) {
        this.$nextTick(() => this.buildGraph());
      }
      // 切换会话后保持侧栏展开，方便用户继续点其它历史会话（ChatGPT 式）
      this.cancelRename();
      this.$nextTick(() => this.scrollChatToBottom());
    },

    // 删除某条会话（不可恢复 → confirm 兜底）
    deleteConv(id) {
      if (!id) return;
      const meta = (this.conversations || []).find(c => c.id === id);
      const title = meta ? meta.title : '该对话';
      if (!window.confirm('确定删除「' + title + '」？删除后无法恢复。')) return;
      try { localStorage.removeItem(this.convKey(id)); } catch (e) {}
      this.conversations = (this.conversations || []).filter(c => c.id !== id);
      this.saveConvList();
      // 如果删的是当前 → 自动新建空白对话（行业实践：用户不会卡在"无对话"态）
      //   skipArchive=true：刚才已经从 localStorage 删掉了该会话，别让 newChat 又把它存回来
      if (id === this.currentConvId) this.newChat(true);
    },

    // 双击标题 → 进入重命名输入态
    startRename(id) {
      const meta = (this.conversations || []).find(c => c.id === id);
      if (!meta) return;
      this.renamingId = id;
      this.renamingTitle = meta.title || '';
      this.$nextTick(() => {
        const el = this.$refs['rename_' + id];
        if (el && el.focus) { el.focus(); el.select && el.select(); }
      });
    },
    // 提交重命名（blur 或回车触发）
    commitRename() {
      if (!this.renamingId) return;
      const meta = (this.conversations || []).find(c => c.id === this.renamingId);
      if (meta) {
        const t = (this.renamingTitle || '').trim().slice(0, 60);
        meta.title = t || '新对话';
        this.saveConvList();
      }
      this.renamingId = null;
      this.renamingTitle = '';
    },
    // 取消重命名（Esc 触发）
    cancelRename() {
      this.renamingId = null;
      this.renamingTitle = '';
    },

    // 侧栏开关：每次打开重置重命名态；展开/折叠会改变右侧内容区宽度，
    //   需让 vis-network 重绘以匹配新尺寸（否则子图会留白或溢出）
    toggleHistory() {
      this.showHistory = !this.showHistory;
      if (this.showHistory) this.cancelRename();
      this.$nextTick(() => {
        if (this.net && this.net.redraw) {
          try {
            this.net.redraw();
            this.net.fit({ animation: false });   // 侧栏变宽/窄后把图重新适配到视口
          } catch (e) {}
        }
      });
    },
    closeHistory() { this.showHistory = false; this.cancelRename(); 
      this.$nextTick(() => {
        if (this.net && this.net.redraw) { try { this.net.fit({ animation: false }); this.net.redraw(); } catch (e) {} }
      });
    },

    // 点击引用编号 [n] → 打开原文（n 是 cite 标签的 data-ref，对应 lastRefs 中第 n-1 项）
    async openRef(n) {
      const idx = Number(n) - 1;
      const ref = this.lastRefs && this.lastRefs[idx];
      if (!ref || !ref.file_path) {
        this.setStatus(false, '未找到引用 ' + n + ' 对应的资料（可能被新提问覆盖或本地存储过期）');
        return;
      }
      await this.openOriginalFile(ref.file_path);
    },

    /* ---------- 引用溯源悬浮气泡（停留缓冲 + 离开弹窗才消失） ----------
     * 核心交互（贴合用户直觉）：
     *   1. 鼠标悬停 [n] → 立即显示气泡（可滚动读原文）
     *   2. 鼠标从 [n] 移向气泡的途中 → 气泡「停留一阵」（约 450ms），
     *      给足时间把鼠标跨过去；途中鼠标回到引用或进入气泡都会被保留
     *   3. 一旦鼠标进入气泡 → 完全保持，可自由滚动阅读原文
     *   4. 鼠标移出气泡范围 → 气泡快速消失
     * 关键：触发「消失」的是「离开气泡」，而不是「离开引用」——
     *       用户移向气泡的路上不会闪没，进了气泡就一直留着，移出才消失。 */
    // 调度延迟隐藏：delay 用于「离开引用」/离开滚动区的停留缓冲（给时间移向气泡）
    scheduleHoverHide(delay) {
      if (this._hoverTimer) clearTimeout(this._hoverTimer);
      this._hoverTimer = setTimeout(() => { this.hover.visible = false; this._hoverTimer = null; }, delay != null ? delay : 450);
    },
    // 取消延迟隐藏（回到引用 / 进入气泡时调用）
    cancelHoverHide() {
      if (this._hoverTimer) { clearTimeout(this._hoverTimer); this._hoverTimer = null; }
    },
    // 立即隐藏（离开气泡时用，无需再等停留）
    hideHover() { this.cancelHoverHide(); this.hover.visible = false; },
    // 鼠标指着引用 [n] → 显示该引用的 chunk 内容（论文式溯源悬浮气泡）
    onChatOver(ev) {
      const t = ev.target;
      if (!t || !t.closest || !t.closest('.cite')) return;
      const cite = t.closest('.cite');
      const n = cite.getAttribute('data-ref');
      // 已是同一个引用的气泡 → 取消延迟、保持显示（避免每次悬停重建导致闪烁）
      if (this.hover.visible && this.hover.ref === n) {
        this.cancelHoverHide();
        ev.stopPropagation();
        return;
      }
      const idx = Number(n) - 1;
      const ref = this.lastRefs && this.lastRefs[idx];
      if (!ref) return;
      const content = (ref.content && ref.content.length)
        ? ref.content.join('\n\n')
        : (ref.file_path || '（无原文内容）');
      // 定位气泡：默认在鼠标右下方 16px，靠近屏幕右/下缘时自动向内翻转，避免溢出视口
      //   尺寸与 css 里 .cite-hover 一致（宽 400 / 高至 520，加大信息量）
      const pad = 16;
      const vw = window.innerWidth, vh = window.innerHeight;
      const w = 400, h = Math.min(520, vh - 60);
      let x = ev.clientX + pad, y = ev.clientY + pad;
      if (x + w > vw) x = ev.clientX - w - pad;
      if (y + h > vh) y = Math.max(10, ev.clientY - h - pad);
      this.cancelHoverHide();
      this.hover = { visible: true, ref: n, x, y,
        title: '来源 ' + n + (ref.file_path ? ' · ' + String(ref.file_path).split('/').pop() : ''),
        content };
      ev.stopPropagation();
      this._lastCiteEl = cite;
    },
    // 鼠标在滚动区文字上移动：在 [n] 或气泡上保持；落到其他文字 → 停留缓冲
    onChatMove(ev) {
      if (!this.hover.visible) return;
      const t = ev.target;
      const inCite = t && t.closest && t.closest('.cite');
      const inBubble = t && t.closest && t.closest('.cite-hover');
      if (inCite || inBubble) { this.cancelHoverHide(); return; }
      // 鼠标落到滚动区其他文字/空白 → 开始「停留缓冲」（给时间移向气泡）
      this.scheduleHoverHide(450);
    },
    // 鼠标整体移出滚动区 → 停留缓冲（保守，避免快速进出闪烁）
    onChatLeave() {
      this.scheduleHoverHide(450);
    },
    // 鼠标进入气泡 → 取消延迟，完全保持（可自由滚动读原文）
    onBubbleEnter() { this.cancelHoverHide(); },
    // 鼠标在气泡内移动/滚动 → 持续保持
    onBubbleMove() { this.cancelHoverHide(); },
    // 鼠标移出气泡 → 快速消失（不等待停留）
    onBubbleLeave() { this.hideHover(); },

    /* ---------- 主查询：提问 + 流式回答 + 取子图 ---------- */
    async runQuery(preset) {
      if (preset != null) this.query = preset;
      const q = this.query.trim();
      if (!q) return;
      // 切到左右布局（带生长动画的过渡）
      if (!this.started) this.started = true;
      this.loading = true;
      // —— 前端校验拦截：避免给 LightRAG 发会被 422 拒绝的 body —— //
      const opt = { ws: this.ws, mode: this.mode, topK: 12, chunkTopK: 6 };
      const vErr = this.validateOpt(opt);
      if (vErr) {
        this.loading = false;
        this.status = { ok: false, text: vErr };
        // 把校验失败也记入对话气泡（用户能看到明确文字）
        this.messages.push({
          role: 'user', text: q, ts: Date.now(), invalid: true
        });
        this.messages.push({
          role: 'ai',
          text: '⚠️ ' + vErr + '（请修正后再次提交，校验规则来自 LightRAG 后端 Pydantic 模型）',
          html: '<div class="dim">⚠️ ' + vErr + '（请修正后再次提交，校验规则来自 LightRAG 后端 Pydantic 模型）</div>',
          ts: Date.now()
        });
        this.query = q;   // 把用户输入放回去，方便修改
        this.$nextTick(() => this.scrollChatToBottom());
        return;
      }
      // 本轮提问：进度条重新从第一步走（上一轮完成态被覆盖）
      this.showProgress = true;
      this.status = { ok: false, text: '正在为您查找资料…' };
      this.stepIdx = 0;

      // 把用户问题塞进对话
      this.messages.push({ role: 'user', text: q, ts: Date.now() });
      this.query = '';

      // 占位 AI 气泡（流式逐 token 写入）
      const aiMsg = { role: 'ai', text: '', html: '', ts: Date.now(), refs: [] };
      this.messages.push(aiMsg);
      // 立刻持久化用户消息（流式未完成的 AI 占位会被 saveChat 过滤掉）
      this.$nextTick(() => this.saveChat());

      const t0 = performance.now();
      try {
        // 子图与流式并行：子图慢先入冷宫，UI 先呈现流式回答
        const dataP = queryData(this.ws, q, opt).catch(err => ({ entities: [], relationships: [], chunks: [], metadata: {}, _err: err.message || String(err) }));

        // 步骤：图谱检索 → 准备边动
        this.stepIdx = 1;
        await this.waitFrame(80);

        // 流式调用
        const ans = await streamRag(this.ws, q, opt, (delta, full) => {
          aiMsg.text = full;
          aiMsg.html = mdToHtml(full);
          // 滚动到底
          this.$nextTick(() => this.scrollChatToBottom());
        });

        this.stepIdx = 2;
        const data = await dataP;
        this.stepIdx = 3;

        this.lastRefs = ans.references || [];
        aiMsg.refs = this.lastRefs;
        // 收尾时把引用信息写到末尾
        aiMsg.html = mdToHtml(aiMsg.text);

        // 写子图（生长动画交给 vis 的 physics：forceAtlas2Based → barnesHut 一次性稳定）
        this.entities = data.entities || [];
        this.relationships = data.relationships || [];
        const kw = (data.metadata && data.metadata.keywords) || {};
        this.keywords = { high: kw.high_level || [], low: kw.low_level || [] };
        this.buildGraph();

        const elapsed = performance.now() - t0;
        this.status = {
          ok: true,
          text: '回答完成 · 实体 ' + this.entities.length + ' · 关系 ' +
            this.relationships.length + ' · 引用 ' + this.lastRefs.length +
            ' · ' + (elapsed / 1000).toFixed(1) + 's'
        };
        // 回答完成后再持久化一次（包含最终 html 与 refs）
        this.saveChat();
      } catch (err) {
        console.error(err);
        aiMsg.text += '\n\n（查询失败：' + (err.message || err) + '）';
        aiMsg.html = mdToHtml(aiMsg.text);
        this.status = { ok: false, text: '查询失败: ' + (err.message || err) };
        this.saveChat();
      } finally {
        // 注意：不在这里关 loading —— buildGraph 内部 stabilization 后才让第一个节点淡入，
        // 那个 setTimeout 才关 loading，让用户在整个生成过程中看到提示。
        this.$nextTick(() => this.scrollChatToBottom());
      }
    },

    waitFrame(ms) { return new Promise(r => setTimeout(r, ms)); },
    scrollChatToBottom() {
      // 优先选当前可见的 chat-scroll（左右布局用 chatScroll2）
      const el = this.$refs.chatScroll2 || this.$refs.chatScroll;
      if (el) el.scrollTop = el.scrollHeight;
    },
    // 事件代理：捕获 AI 回答中的 [n] 引用并打开原文
    // 注意：点击的目标元素可能不是 .cite 自身（比如点在 cite 的子元素里或 click 路径上
    // 插入了 v-html 之外的包装元素），所以向上回溯到最近的 .cite 祖先，确保点击命中。
    onChatClick(ev) {
      let t = ev.target;
      // 最多向上找 4 层（cite 通常是 span，包装层不会很深）
      for (let i = 0; t && i < 4; i++, t = t.parentElement) {
        if (t.classList && t.classList.contains('cite')) {
          const n = t.getAttribute('data-ref');
          if (n) {
            ev.preventDefault();
            this.openRef(n);
          }
          return;
        }
      }
    },

    /* ---------- 子图构建（与 GraphView 同款：vis 内置布局 + 图例 + 多选筛选） ---------- */
    buildGraph() {
      const ents = this.entities || [];
      const rels = this.relationships || [];
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
      // 关系里出现但 entities 里没有的端点，也补一个占位节点
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

      // 类型筛选：保留全集（用于图例），默认全选
      const techTypes = Array.from(typeSet);
      this.typeList = techTypes;
      const next = this.selectedTypes.filter(t => techTypes.includes(t));
      if (!next.length) this.selectedTypes = techTypes.slice();
      else this.selectedTypes = next;

      // 12 色行业实践配色（与 GraphView 一致；色相 + 亮度区分明显，图例和节点不撞色）
      const TECH_PALETTE = [
        '#2563eb', '#16a34a', '#ea580c', '#dc2626',
        '#9333ea', '#0891b2', '#65a30d', '#db2777',
        '#ca8a04', '#0d9488', '#4f46e5', '#7c3aed'
      ];
      // 用 hash 分配（与 GraphView 的 colorFor 一致），让相邻 type 也分到差异较大的色相
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
      this.typeColors = colors;

      // 应用类型筛选：被过滤掉的节点不出现在视图中
      const visibleIds = new Set();
      nodeMap.forEach(n => { if (this.selectedTypes.includes(n.group)) visibleIds.add(n.id); });
      const visNodes = Array.from(nodeMap.values()).filter(n => visibleIds.has(n.id));
      const visEdges = edges.filter(e => visibleIds.has(e.from) && visibleIds.has(e.to));

      // 度数 + 大小
      const deg = {};
      visEdges.forEach(e => { deg[e.from] = (deg[e.from] || 0) + 1; deg[e.to] = (deg[e.to] || 0) + 1; });
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

      this.nodesDS = new vis.DataSet(sizedNodes);
      this.edgesDS = new vis.DataSet(visEdges);
      this._allNodeMap = nodeMap;
      this._allEdges = edges;

      const container = document.getElementById('qnet');
      const options = {
        groups: techGroups,
        nodes: {
          shape: 'dot',
          scaling: { min: 9, max: 36, label: { enabled: false } },
          font: { color: '#1f2d3d', face: 'Microsoft YaHei' },
          borderWidth: 0,
          shadow: { enabled: false }
          // 不在 options.nodes.color 覆盖 → group 颜色接管
        },
        edges: {
          color: { color: '#94a3b8', highlight: '#1f6feb', hover: '#1f6feb', opacity: 0.7 },
          width: 1.0, hoverWidth: 1.6, selectionWidth: 1.4,
          smooth: { enabled: true, type: 'continuous', roundness: 0.4 },
          arrows: 'to'
        },
        // vis-network 内置布局：barnesHut 物理引擎 + improvedLayout 初始排布
        //   stabilization 完成（最多 600 iter）后立刻关掉 physics → 完全静态
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
        // 节点不能拖（仅点击）；view 仍可拖（拖动整个图）+ 缩放
        interaction: { hover: true, tooltipDelay: 150, navigationButtons: true, keyboard: false,
          dragNodes: false, dragView: true, zoomView: true }
      };
      if (!this.net) {
        this.net = new vis.Network(container, { nodes: this.nodesDS, edges: this.edgesDS }, options);
        this.net.on('click', p => this.onGraphPick(p));
        this.net.on('doubleClick', p => {
          if (p.nodes.length) this.net.focus(p.nodes[0], { scale: 1.1 });
        });
      } else {
        this.net.setData({ nodes: this.nodesDS, edges: this.edgesDS });
      }

      // 同步按 type 配色（确保每个节点 color.background 都设了）
      const colorUpd = [];
      for (const n of sizedNodes) {
        const t = n.group || '其他';
        const c = (techGroups[t] && techGroups[t].color) || '#94a3b8';
        colorUpd.push({
          id: n.id,
          color: { background: c, border: c, highlight: { background: c, border: '#1f6feb' } }
        });
      }
      this.nodesDS.update(colorUpd);

      // stabilization 完成后保留极慢 physics：节点只做微幅漂浮
      //   用户点击节点 → onGraphPick 中关闭 physics → 完全静止
      this.net.once('stabilizationIterationsDone', () => {
        if (!this.net) return;
        this.net.setOptions({
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

      this.sel = { visible: false, kind: '', title: '', type: '', descr: '',
        props: {}, extraProps: [], srcIds: [], fps: [], segs: [] };
      this.loading = false;
    },

    // 图例多选筛选（与 GraphView 同款：勾选了才显示，勾选状态被记住）
    toggleType(t) {
      const i = this.selectedTypes.indexOf(t);
      if (i >= 0) this.selectedTypes.splice(i, 1);
      else this.selectedTypes.push(t);
      this.applyTypeFilter();
    },
    // 全选：批量勾上全部实体类型
    selectAllTypes() { this.selectedTypes = this.typeList.slice(); this.applyTypeFilter(); },
    // 全部不选：清空所有勾选，不显示任何实体类型
    selectNoneTypes() { this.selectedTypes = []; this.applyTypeFilter(); },
    /* 类型筛选变化 → 只切换节点/边 hidden 字段（不重画） */
    applyTypeFilter() {
      if (!this.nodesDS || !this.edgesDS) return;
      const visSet = new Set(this.selectedTypes);
      const nodeUpd = [];
      this.nodesDS.forEach(n => {
        const visible = visSet.has(n.group);
        if ((n.hidden || false) !== !visible) {
          nodeUpd.push({ id: n.id, hidden: !visible });
        }
      });
      if (nodeUpd.length) this.nodesDS.update(nodeUpd);
      const visibleNodes = new Set();
      this.nodesDS.forEach(n => { if (!n.hidden) visibleNodes.add(n.id); });
      const edgeUpd = [];
      this.edgesDS.forEach(e => {
        const visible = visibleNodes.has(e.from) && visibleNodes.has(e.to);
        if ((e.hidden || false) !== !visible) {
          edgeUpd.push({ id: e.id, hidden: !visible });
        }
      });
      if (edgeUpd.length) this.edgesDS.update(edgeUpd);
    },
    fitView() { if (this.net) this.net.fit({ animation: { duration: 400 } }); },

    onGraphPick(params) {
      // 点击节点/边 → 立刻关掉 vis-network physics（节点永久静止）
      if (this.net && (params.nodes.length || params.edges.length)) {
        this.net.setOptions({ physics: { enabled: false } });
      }
      if (params.nodes.length) {
        const n = this.nodesDS.get(params.nodes[0]);
        if (!n) return;
        const r = n.raw || {};
        const id = n.id;
        const srcIds = r.srcIds || [], fps = r.fps || [];
        this.sel = { visible: true, kind: 'node', title: r.name || '', type: r.type || '',
          descr: (r.desc || '').replace(/<SEP>/g, '；'),
          props: {}, extraProps: [], srcIds, fps, segs: [] };
        this.descrOpen = !!this.sel.descr;
        this.populateSegs(srcIds, fps);
        this.loadNodeAttrs(r.name);
        // 与「看图谱」一致：点击节点 → focus 居中 + 高亮（带平滑动画）
        try {
          this.net.focus(id, { scale: 1.0, locked: false,
            animation: { duration: 500, easingFunction: 'easeInOutQuad' } });
        } catch (e) {}
      } else if (params.edges.length) {
        const e = this.edgesDS.get(params.edges[0]);
        if (!e) return;
        const r = e.raw || {};
        const srcIds = r.src ? splitSep(r.src) : [], fps = r.fp ? splitSep(r.fp) : [];
        this.sel = {
          visible: true, kind: 'rel',
          title: (r.s || '') + ' → ' + (r.t || ''),
          type: r.kw || '关系', descr: (r.descr || '').replace(/<SEP>/g, '；'),
          props: {}, extraProps: [], srcIds, fps, segs: []
        };
        this.descrOpen = !!this.sel.descr;
        this.populateSegs(srcIds, fps);
      } else {
        this.sel = { visible: false, kind: '', title: '', type: '', descr: '',
          props: {}, extraProps: [], srcIds: [], fps: [], segs: [] };
        // 冻结视图：避免聚焦动画在空白点击后继续移动
        if (this.net && this.net.getViewPosition) {
          try {
            const p = this.net.getViewPosition();
            const sc = this.net.getScale();
            this.net.moveTo({ position: p, scale: sc, animation: false });
          } catch (e) {}
        }
      }
    },

    async loadNodeAttrs(name) {
      if (!name) return;
      const session = getDriver().session({ database: 'neo4j' });
      try {
        const r = await session.run(
          'MATCH (n:`' + this.ws + '`) WHERE n.entity_id = $name RETURN properties(n) AS props LIMIT 1',
          { name });
        if (!r.records.length) return;
        const props = r.records[0].get('props') || {};
        this.sel = Object.assign({}, this.sel, {
          props,
          extraProps: this.extractExtraProps(props)
        });
      } catch (err) { /* ignore */ }
      finally { await session.close(); }
    },

    prettifyKey(k) { return String(k).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); },
    extractExtraProps(props) {
      const out = [];
      const RESERVED = ['entity_id', 'entity_type', 'description', 'source_id', 'file_path',
        'created_at', 'updated_at', 'id'];
      Object.keys(props || {}).forEach(k => {
        if (RESERVED.includes(k)) return;
        const v = props[k];
        if (v === null || v === undefined || v === '') return;
        out.push({ key: k, label: this.prettifyKey(k), value: this.formatPropValue(v) });
      });
      out.sort((a, b) => a.key.localeCompare(b.key));
      return out;
    },
    formatPropValue(v) {
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
    },

    async populateSegs(srcIds, fps) {
      const segs = (srcIds || []).map((s, i) => ({
        srcId: s, file: (fps || [])[i] || '', para: '', loading: true,
        expanded: i < 2
      }));
      this.sel.segs = segs;
      for (let i = 0; i < segs.length; i++) {
        try {
          const pl = await fetchChunk(segs[i].srcId, this.ws);
          this.sel.segs[i].para = (pl && pl.content) ? pl.content : '';
          if (pl && pl.file_path && !this.sel.segs[i].file) this.sel.segs[i].file = pl.file_path;
        } catch (err) {
          this.sel.segs[i].para = '';
        }
        this.sel.segs[i].loading = false;
      }
    }
  },

  template: `
  <div class="q-page" :class="{ 'started': started }">

    <!-- 顶部工具栏（始终保留） -->
    <div id="qbar">
      <span class="brand">
        <span class="bbadge" :style="{background: currentMeta.color}">{{ currentMeta.badge }}</span>
        <span class="title">智能问答</span>
      </span>
      <el-button size="small" @click="goHome">‹ 导航</el-button>
      <el-button size="small" @click="goGraph">图谱视图</el-button>
      <!-- 新建对话：把当前归档 → 进入空白；行业实践里和 ChatGPT 的 + New chat 同款 -->
      <el-button size="small" type="primary" plain @click="newChat()" title="把当前对话归档到左侧列表，开启全新对话">+ 新建对话</el-button>
      <!-- 历史对话折叠菜单开关：点击展开/收起左侧会话栏 -->
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
        <el-tooltip v-for="m in modes" :key="m.v" :content="m.tip" placement="right"
          :show-after="100" :hide-after="50" :enterable="false">
          <el-option :value="m.v" :label="m.t"></el-option>
        </el-tooltip>
      </el-select>
      <span id="qstatus">
        <span id="qdot" :class="{ok: status.ok}"></span>{{ status.text }}
      </span>
    </div>

    <!-- ============================================================
         主区域：左侧「常驻可折叠历史会话栏」 + 右侧「对话/走过的子图」
         - 默认折叠（仅一条窄栏 + 汉堡按钮），点开侧栏会压缩右侧内容区，
           把空间让给会话列表（ChatGPT / 豆包 / 文心 同款布局）
         - 点击历史会话 → loadConv 同时切换对话气泡与走过的子图，无差别切换
         ============================================================ -->
    <div class="q-row">

      <!-- 左侧：常驻可折叠历史会话菜单 -->
      <aside class="hd-side" :class="{ open: showHistory }">
        <!-- 折叠/展开切换条（默认态只有它，可点开） -->
        <div class="hd-toggle" @click="toggleHistory"
          :title="showHistory ? '收起历史对话' : '展开历史对话'">
          <span class="hd-burger"><i></i><i></i><i></i></span>
          <span class="hd-toggle-label" v-if="!showHistory">会话</span>
        </div>

        <!-- 展开面板：新建 + 搜索 + 会话列表 -->
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
            <el-input v-model="historyFilter" size="small" clearable placeholder="搜索对话…" />
          </div>

          <div class="hd-list" @click="cancelRename">
            <div v-if="filteredConvs.length === 0" class="hd-empty">
              <div class="hd-empty-icon">💬</div>
              <div v-if="historyFilter">没有匹配「{{ historyFilter }}」的对话</div>
              <div v-else>暂无历史对话<br/><span class="hd-empty-tip">点右上角「+ 新建」开始一段新对话</span></div>
            </div>
            <div v-for="c in filteredConvs" :key="c.id" class="hd-item"
              :class="{ active: c.id === currentConvId }" @click.stop="loadConv(c.id)">
              <div class="hd-item-main">
                <input v-if="renamingId === c.id" class="hd-rename-input"
                  :ref="'rename_' + c.id"
                  v-model="renamingTitle"
                  @blur="commitRename"
                  @keydown.enter.prevent="commitRename"
                  @keydown.esc.prevent="cancelRename"
                  @click.stop />
                <div v-else class="hd-item-title" :title="c.title"
                  @dblclick.stop="startRename(c.id)">{{ c.title }}</div>
                <div class="hd-item-meta">
                  <span class="hd-time">{{ fmtTime(c.updatedAt) }}</span>
                  <span class="hd-sep">·</span>
                  <span class="hd-msg">{{ c.msgCount }} 条消息</span>
                </div>
              </div>
              <div class="hd-item-actions" @click.stop>
                <el-button size="small" text class="hd-act-btn"
                  @click.stop="startRename(c.id)" title="重命名">✎</el-button>
                <el-button size="small" text class="hd-act-btn hd-act-del"
                  @click.stop="deleteConv(c.id)" title="删除">🗑</el-button>
              </div>
            </div>
          </div>

          <footer class="hd-foot">双击标题可重命名 · 保存在浏览器本地</footer>
        </div>
      </aside>

      <!-- 右侧：对话 + 走过的子图 -->
      <div class="q-body">

    <!-- ============ 初始（居中）布局：仅一个大对话框 + 框内推荐问题 ============ -->
    <div id="qcenter" v-if="!started">
      <div class="chat-card">
        <div class="chat-head">
          <span class="bbadge" :style="{background: currentMeta.color}">{{ currentMeta.badge }}</span>
          <span class="chat-title">智能问答 · {{ currentMeta.name }}</span>
        </div>

        <!-- 进度卡（回答完成后仍保留，直到下一轮提问才重置） -->
        <div class="progress" v-show="showProgress">
          <div class="pbar"><span class="pfill" :style="{ width: ((stepIdx+1)/steps.length*100) + '%' }"></span></div>
          <div class="steps">
            <div class="step" v-for="(s, i) in steps" :key="i" :class="{ on: i <= stepIdx, cur: i === stepIdx }">
              <span class="dot"></span>{{ s }}
            </div>
          </div>
        </div>

        <!-- 推荐问题（仅未提问时显示在对话框内） -->
        <div class="presets-inline" v-if="messages.length === 0">
          <div class="pc-lbl">推荐问题（点击直接提问）</div>
          <div class="pc-list">
            <span class="pc-chip" v-for="p in presets" :key="p" @click="runQuery(p)">{{ p }}</span>
          </div>
        </div>

        <!-- 对话滚动区 -->
        <div class="chat-scroll" ref="chatScroll" @click="onChatClick"
          @mouseover="onChatOver" @mousemove="onChatMove" @mouseleave="onChatLeave">
          <div class="bubbles">
            <div v-for="(m, i) in messages" :key="i" class="bubble-row" :class="m.role">
              <div class="avatar" v-if="m.role === 'ai'">AI</div>
              <div class="bubble" :class="m.role" v-html="m.role === 'ai' ? (m.html || waitingHtml()) : escapeHtml(m.text)"></div>
              <div class="avatar me" v-if="m.role === 'user'">你</div>
            </div>
            <div class="bubbles-end"></div>
          </div>
        </div>

        <!-- 输入框（始终在对话框底部） -->
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

    <!-- ============ 提问后布局：左对话框 + 右子图 ============ -->
    <div id="qmain" v-else>
      <!-- 左：对话框（保留推荐问题消失后的对话历史） -->
      <div id="qleft">
        <div class="chat-head sub">
          <span class="bbadge" :style="{background: currentMeta.color}">{{ currentMeta.badge }}</span>
          <span class="chat-title">智能问答 · {{ currentMeta.name }}</span>
        </div>

        <div class="progress" v-show="showProgress || loading">
          <div class="pbar"><span class="pfill" :style="{ width: ((stepIdx+1)/steps.length*100) + '%' }"></span></div>
          <div class="steps">
            <div class="step" v-for="(s, i) in steps" :key="i" :class="{ on: i <= stepIdx, cur: i === stepIdx }">
              <span class="dot"></span>{{ s }}
            </div>
          </div>
        </div>

        <div class="chat-scroll" ref="chatScroll2" @click="onChatClick"
          @mouseover="onChatOver" @mousemove="onChatMove" @mouseleave="onChatLeave">
          <div class="bubbles">
            <div v-for="(m, i) in messages" :key="i" class="bubble-row" :class="m.role">
              <div class="avatar" v-if="m.role === 'ai'">AI</div>
              <div class="bubble" :class="m.role" v-html="m.role === 'ai' ? (m.html || waitingHtml()) : escapeHtml(m.text)"></div>
              <div class="avatar me" v-if="m.role === 'user'">你</div>
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

      <!-- 右：走过的子图（与 GraphView 同款） -->
      <div id="qright">
        <!-- 加载期：占位 + 步骤卡（避免空白让人干等） -->
        <div class="grow-overlay" v-if="loading && entities.length === 0">
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
          <span class="rgrow" v-show="entities.length">
            <el-button size="small" @click="fitView">适应视图</el-button>
          </span>
        </div>
        <div id="qnet"></div>

        <!-- 节点详情面板（覆盖在子图之上，与 GraphView #side 同款） -->
        <div id="qside" v-if="sel.visible">
          <h3>{{ sel.title }}</h3>
          <span class="tag">{{ sel.type }}</span>
          <span class="tag" v-if="sel.kind === 'rel'">关系</span>
          <div class="hint">提示：点击子图中其他节点或关系查看详情</div>

          <div class="descr" v-if="sel.descr">
            <div class="section-head" @click="descrOpen = !descrOpen">
              <span class="sh-title">描述</span>
              <span class="sh-tog">{{ descrOpen ? '收起 ▲' : '展开 ▼' }}</span>
            </div>
            <div class="descr-body" v-show="descrOpen">{{ sel.descr }}</div>
          </div>

          <div class="attrs" v-if="sel.extraProps && sel.extraProps.length">
            <div class="section-head" @click="attrsOpen = !attrsOpen">
              <span class="sh-title">属性（{{ sel.extraProps.length }}）</span>
              <span class="sh-tog">{{ attrsOpen ? '收起 ▲' : '展开 ▼' }}</span>
            </div>
            <table class="attrs-table" v-show="attrsOpen">
              <tbody>
                <tr v-for="p in sel.extraProps" :key="p.key">
                  <th>{{ p.label }}</th>
                  <td>{{ p.value }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="chunks" v-if="sel.segs && sel.segs.length">
            <div class="section-head">
              <span class="sh-title">原文片段（{{ sel.segs.length }}）</span>
            </div>
            <div class="chunk" v-for="(s,i) in sel.segs" :key="'c'+i" :class="{collapsed: !s.expanded}">
              <div class="chunk-head" @click="s.expanded = !s.expanded">
                <span class="chunk-idx">原文片段 {{ i+1 }}</span>
                <span class="chunk-tog">{{ s.expanded ? '收起 ▲' : '展开 ▼' }}</span>
              </div>
              <div class="chunk-scroll" v-show="s.expanded">
                <div class="chunk-para" v-if="!s.loading && s.para">{{ s.para }}</div>
                <div class="chunk-para dim" v-else-if="s.loading">原文片段载入中…</div>
                <div class="chunk-para dim" v-else>（未检索到该原文片段）</div>
              </div>
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
              <div class="chunk-scroll"><span class="dim">（该条目未记录原文来源）</span></div>
              <button class="isrc-open chunk-open disabled" disabled>暂无原文链接</button>
            </div>
          </div>
        </div>

        <!-- 图例（与「看图谱」同款：打钩复选框 + 全选/全部不选批量开关） -->
        <div id="qlegend" v-show="typeList.length">
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
      </div><!-- /.q-body -->

    </div><!-- /.q-row -->

    <!-- 引用悬浮气泡：鼠标指着引用 [n] 显示 chunk 内容。
         气泡自身监听 enter/move → 保持显示、可滚动读原文；移出气泡 → 延迟淡出。 -->
    <div class="cite-hover" v-if="hover.visible"
      :style="{ left: hover.x + 'px', top: hover.y + 'px' }"
      @mouseenter="onBubbleEnter" @mousemove="onBubbleMove" @mouseleave="onBubbleLeave">
      <div class="ch-title">{{ hover.title }}</div>
      <div class="ch-body">{{ hover.content }}</div>
      <div class="ch-hint">点击引用数字可打开原网页</div>
    </div>
  </div>`
};