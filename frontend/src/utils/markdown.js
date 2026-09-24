/* ============================================================
 * utils/markdown.js —— 轻量 Markdown 渲染 + 引用归一 + 等待动画
 * ------------------------------------------------------------
 * 文件作用：
 *   前端自己写的"迷你 Markdown 渲染器"，不依赖第三方库（marked / markdown-it）。
 *   主要功能：
 *     - mdToHtml(s)              LLM 输出 → 含 [n] cite 哨兵的 HTML（带引用处理）
 *     - renderMarkdown(s)        通用 markdown → HTML（DocView 显示原始资料）
 *     - waitingHtml()            「正在组织答案…」等待动画的 HTML
 *     - normCite(s)（内部）       剥离思考块 + 归一 [n] 编号
 *
 * 设计要点（初学者看这里）：
 *   - 不用真实 DOM，靠 replace() 把一行行文本替换成 HTML 字符串。
 *   - "哨兵"机制：先用不会出现在文本里的特殊字符 \u0000R 包裹引用编号，
 *     等所有 HTML escape / 标签替换完成后再还原成 <span class="cite">。
 *     这样可以避免把 [1] 转义后再替换的麻烦。
 *   - 引用归一：把 LLM 输出的 [REF 5] / REFxx 全部规整成 [n]，
 *     并按"首次出现顺序"重新编号为 [1][2][3]…
 *
 * ============================================================ */

/* ---------- 1) 引用归一：剥离思考块 + 归一 [n] 编号 ----------
 * 内置辅助函数，不导出。被 mdToHtml() 调用。
 */
function normCite(s) {
  // 强制转字符串，避免传入 null/undefined 时崩
  s = String(s);

  /* ============ 1.1 剥离"思考块" ============
   * 不同 LLM 输出的"内心 OS"块长得都不一样，我们把常见的几种全部干掉，
   * 让用户看到的是"干净的答案"。正则说明：
   *   - ```thinking ... ``` ：Qwen 等用代码块包思考
   *   - <think>...</think> : 一些模型用 XML 标签
   *   - «thinking»...«/thinking» : 法语书名号形式（极少）
   *   - 行首 "### 思考过程 / Thinking Process / 思考" 整段：DeepSeek 等用 markdown 标题
   */
  s = s.replace(/```(?:thinking|reasoning|thought)[\s\S]*?```/gi, '');
  s = s.replace(/<\/?think(?:ing)?>/gi, '');
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  s = s.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  s = s.replace(/«(?:think|thinking|reasoning)»[\s\S]*?«\/(?:think|thinking|reasoning)»/gi, '');
  s = s.replace(/^\s*(?:###\s*)?(?:思考过程|Thinking Process|Reasoning|思考|Thinking)\s*[:：]?[\s\S]*?(?=\n\s*\n|$)/i, '');

  /* ============ 1.2 REFxx 标准化成 [n] ============
   * 把 "REF 5"、"REFxx" 之类的"非标准引用"统一替换成 [5]（带方括号）。
   * 注意大小写不敏感（/gi 标志）。
   */
  s = s.replace(/REF\s*(\d+)/gi, '[$1]');

  /* ============ 1.3 按首次出现顺序重编号 ============
   * LLM 可能输出 [7] [3] [7] …… 实际引用是 1-3（顺序）。
   * 我们用一个对象 seen 把"原编号 → 新编号"映射起来，第一次遇到就分配新号。
   *
   * 这里用 \u0000R${oldStr}-${n}\u0000 当作"哨兵占位符"。
   * \u0000 是 ASCII 控制字符，正常 Markdown 文本里不会出现；
   * 这样可以保证后面做 HTML escape 时它不被误伤。
   */
  const seen = {};
  let seq = 0;
  s = s.replace(/\[(\d+)\]/g, (m, oldStr) => {
    // 注意 oldStr 是字符串而不是数字（正则捕获组），所以用 in/[] 而不是 < 比较
    if (!(oldStr in seen)) {
      seq += 1;
      seen[oldStr] = seq;
    }
    const n = seen[oldStr];
    // 把哨兵写回去
    return '\u0000R' + oldStr + '-' + n + '\u0000';
  });

  /* ============ 1.4 干掉 LightRAG 默认追加的 References 段 ============
   * LightRAG 默认在回答末尾加一个 ### References 段，把引用的 file_path 列出来。
   * 这个段在前端是多余的（前端自己已经有了"引用列表面板"），
   * 所以检测到行尾的 References 段就直接删除。
   */
  s = s.replace(/\n{0,2}#{1,3}\s*References[\s\S]*$/i, '');

  return s;
}


/* ---------- 2) mdToHtml：LLM 输出 → 含 cite 哨兵的 HTML ----------
 * 公开导出，被 QueryView 的回答区使用。
 *
 * 整体流程：
 *   1. normCite 归一引用 + 删思考块
 *   2. 转义 HTML（但哨兵不会被 escape）
 *   3. 处理 ```代码块``` 和 `行内代码`
 *   4. 处理 **粗体** 和 *斜体*
 *   5. 处理 #/##/###/#### 标题
 *   6. 处理 "1. 2. 3." 这种有序列表
 *   7. 把空行分段，外面套 <p>
 *   8. 把哨兵 \u0000R...-... \u0000 替换成 <span class="cite" data-ref>
 */
export function mdToHtml(s) {
  if (!s) return '';            // 空值直接返回空串
  s = normCite(s);              // 步骤 1：归一引用

  // 步骤 2：HTML 转义 —— 必须先做，避免 LLM 在回答里写 <script> 时被当作标签。
  // & 也要先转义，否则后面的 &lt; 会被"二次转义"成 &amp;lt;
  s = s.replace(/&/g, '&amp;')
       .replace(/</g, '&lt;')
       .replace(/>/g, '&gt;');

  // 步骤 3：代码块 / 行内代码。注意 \u0000R 哨兵在自己内部，不会出现在代码块里。

  // 3.1 三反引号代码块：```...``` → <pre class="md-code">...</pre>
  s = s.replace(/```([\s\S]*?)```/g, (m, p1) => '<pre class="md-code">' + p1 + '</pre>');
  // 3.2 单反引号行内代码：`code` → <code>
  s = s.replace(/`([^`]+)`/g, '<code class="md-code">$1</code>');

  // 步骤 4：粗体 / 斜体
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');     // **加粗**
  // 斜体：排除左右已经是 * 的情况，以免和粗体冲突
  s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<i>$1</i>');

  // 步骤 5：标题 (# ~ ####)
  s = s.replace(/^#### (.+)$/gm, '<h4 class="md-h">$1</h4>');
  s = s.replace(/^### (.+)$/gm, '<h3 class="md-h">$1</h3>');
  s = s.replace(/^## (.+)$/gm, '<h2 class="md-h">$1</h2>');
  s = s.replace(/^# (.+)$/gm, '<h1 class="md-h">$1</h1>');

  // 步骤 6：有序列表 (1. 2. 3. ...)
  //   匹配 "(1. xxx\n2. yyy\n3. zzz)\n+" 这样一整段作为一个列表
  s = s.replace(/(?:^|\n)((?:\d+\.\s+.+(?:\n|$))+)/g, (m, block) => {
    const items = block.trim().split(/\n/)          // 按行拆
      .filter(l => /^\d+\.\s+/.test(l))            // 只要 "数字+点+空格" 开头的行
      .map(l => '<li>' + l.replace(/^\d+\.\s+/, '') + '</li>')  // 去前缀，套 <li>
      .join('');
    return '\n<ol class="md-list">' + items + '</ol>';
  });

  // 步骤 7：把空行 (\n\n 或更多) 作为段落分隔
  s = s.split(/\n{2,}/).map(blk => {
    blk = blk.trim();
    if (!blk) return '';                            // 空段忽略
    if (/^<(h\d|pre)/.test(blk)) return blk;        // 已经是 h/pre 标签就不外包 <p>
    if (/^<ol/.test(blk)) return blk;               // ol 也是
    return '<p class="md-p">' + blk.replace(/\n/g, '<br>') + '</p>';  // 段内换行用 <br>
  }).join('\n');

  // 步骤 8：把哨兵还原为可点击的 cite 标签
  //   \u0000R<old>-<new>\u0000 → <span class="cite" data-ref="<old>">[<new>]</span>
  //   data-ref 里保存"旧编号"，用于点击时去 references 里找具体来源。
  s = s.replace(/\u0000R(\d+)-(\d+)\u0000/g, (_, oldIdx, newIdx) =>
    '<span class="cite" data-ref="' + oldIdx + '">[' + newIdx + ']</span>');

  return s;
}


/* ---------- 3) waitingHtml：等待回答时的占位动画 ----------
 * 公开导出。点击发送 → 流式首字节前的兜底动画。
 *
 * 业务流（与 QueryView 的 stepIdx 对齐）：
 *   - stage='search'    检索资料（默认）
 *   - stage='generate'  正在生成回答（流式响应到达后）
 *   - stage='finalize'  收尾（流结束、还在拼 markdown）
 *
 * 行业实践（参考 ChatGPT / Claude / Gemini）：
 *   - 三圆点"波浪跳"用 CSS animation，不靠 JS 定时器（性能更好）。
 *   - caret 用 CSS blink 比 ▍ 字符更精致（颜色与状态词一致）。
 *   - 用 data-stage 属性驱动样式切换，外层只需传一个 stage 参数。
 *
 * 配套样式在 main.css 里的 .typing/.typing-dots/.caret/.stream-caret。
 */
export function waitingHtml(stage) {
  // 阶段文案映射
  const txt = stage === 'generate' ? '正在生成回答'
            : stage === 'finalize' ? '正在收尾'
            : '正在检索资料';
  return '<div class="typing" data-stage="' + (stage || 'search') + '">' +
    '<span class="typing-dots"><i></i><i></i><i></i></span>' +
    '<span class="typing-text">' + txt + '<span class="caret"></span></span>' +
    '</div>';
}

/* ---------- 3.5) streamCaretHtml：流式响应末尾的闪烁光标 ----------
 * 公开导出。流式响应过程中跟在 markdown 后面，告诉用户"还在打字"。
 * 行业惯例：ChatGPT / Claude 在 streaming 阶段给一个 2px 宽的细竖条，
 * 用 CSS animation: typing-blink 1s steps(1) infinite（详见 main.css）。
 * 之所以做成单独函数而不是模板里写死字符串，是为了避免 v-html 属性解析问题
 * （v-html 字符串里的双引号会让模板 attribute 提前闭合）。
 */
export function streamCaretHtml() {
  return '<span class="stream-caret"></span>';
}


/* ---------- 4) renderMarkdown：DocView 用的通用渲染 ----------
 * 公开导出，给"打开 .md 原始资料"页用，比 mdToHtml 兼容更多 GFM 语法
 * （链接、引用块、列表嵌套等），因为它走的是逐行扫描的状态机方式。
 *
 * 涉及的数据结构：
 *   - lines      ：按行拆好的输入数组
 *   - html       ：累积的输出 HTML
 *   - listType   ：当前在累积 <ul> 还是 <ol>，null 表示没在列表中
 *   - listItems  ：当前列表里 <li> 字符串数组
 */

/* ====== 内部工具：HTML 转义 ====== */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ====== 内部工具：行内 Markdown → HTML ======
 *   - `code`   → <code>
 *   - [text](url) → <a>
 *   - **bold** → <b>
 *   - *ita*    → <i>
 *   - [n]      → <span class="cite" data-ref="n">[n]</span>
 */
function inline(text) {
  let t = escapeHtml(text);
  t = t.replace(/`([^`]+)`/g, (_, c) => '<code class="md-code">' + c + '</code>');
  // 链接：只匹配 http(s) URL，避免被误用到 chunk 路径上
  t = t.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener" class="md-link">$1</a>'
  );
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  t = t.replace(/\*([^*]+)\*/g, '<i>$1</i>');
  t = t.replace(/\[(\d+)\]/g, '<span class="cite" data-ref="$1">[$1]</span>');
  return t;
}

/**
 * renderMarkdown(md) —— 把 Markdown 按行扫描成 HTML
 *
 * 处理块级元素：
 *   - # / ## / ### / #### ：h1 ~ h4
 *   - > 引用块           ：<blockquote>
 *   - 无序列表 (- *)     ：<ul>
 *   - 有序列表 (1. 2.)   ：<ol>
 *   - 段落              ：<p>
 *
 * 用法（DocView）：
 *   const html = renderMarkdown(mdText);
 *   document.querySelector('#md').innerHTML = html;
 */
export function renderMarkdown(md) {
  if (!md) return '';
  // 1) 把 CRLF 统一成 LF，拆成行数组
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let listType = null;       // 当前列表类型（'ul' / 'ol' / null）
  let listItems = [];        // 当前列表里 <li> 集合

  /* ===== 辅助：把累计的 listItems 拼成 html，然后清空状态 ===== */
  const flushList = () => {
    if (listItems.length) {
      html += '<' + listType + ' class="md-list">' + listItems.join('') + '</' + listType + '>';
      listItems = [];
      listType = null;
    }
  };

  // 2) 状态机主循环：按行扫描，遇到块级元素就 flush + 输出块。
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // 标题：正则捕获组 [1] = '#' 个数 [2] = 文本
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushList();
      const lvl = h[1].length;          // 1~4
      html += '<h' + lvl + ' class="md-h">' + inline(h[2]) + '</h' + lvl + '>';
      i++;
      continue;
    }

    // 引用块："> xxx"，支持连续多行
    if (/^>\s?/.test(line)) {
      flushList();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      html += '<blockquote class="md-quote">' + inline(buf.join(' ')) + '</blockquote>';
      continue;
    }

    // 列表项： "- item" / "* item" / "1. item"
    //   [1] = 缩进 [2] = 标记 [3] = 内容
    const lm = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (lm) {
      const t = /^\d+\./.test(lm[2]) ? 'ol' : 'ul';
      // 如果当前列表类型跟新项不一样（比如 ul 中突然出现 1.），先 flush 再起新列表
      if (listType && t !== listType) flushList();
      listType = t;
      listItems.push('<li>' + inline(lm[3]) + '</li>');
      i++;
      continue;
    }

    // 空行：flush 列表 + 跳过
    if (/^\s*$/.test(line)) {
      flushList();
      i++;
      continue;
    }

    // 其他：当作段落（吸收连续非空、非块级的行）
    flushList();
    const para = [line];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&     // 不是空行
      !/^(#{1,4})\s+/.test(lines[i]) &&  // 不是标题
      !/^>\s?/.test(lines[i]) &&    // 不是引用
      !/^(\s*)([-*]|\d+\.)\s+/.test(lines[i])  // 不是列表
    ) {
      para.push(lines[i]);
      i++;
    }
    html += '<p class="md-p">' + inline(para.join(' ')) + '</p>';
  }
  // 收尾：可能最后一次循环结束时还有未 flush 的列表项
  flushList();
  return html;
}
