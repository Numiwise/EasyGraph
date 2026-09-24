/* ============================================================
 * utils/markdown.js —— 轻量 Markdown 渲染 + 引用归一 + 等待动画
 * ------------------------------------------------------------
 *   - mdToHtml(s)   : LLM 输出 → 带 [n] cite 哨兵的 HTML
 *   - renderMarkdown(s) : 通用 markdown → HTML（DocView 用）
 *   - waitingHtml()  : 「正在组织答案…」动画占位
 *   - normCite(s)    : 内部使用（剥离思考块、归一 [n] 编号）
 * ============================================================ */

/* ---------- 1) 引用归一：剥离思考块 + 归一 [n] 编号 ---------- */
function normCite(s) {
  s = String(s);
  // —— 剥离模型思考过程（多种 LLM 的思考块标签都覆盖）——
  s = s.replace(/```(?:thinking|reasoning|thought)[\s\S]*?```/gi, '');
  s = s.replace(/<\/?think(?:ing)?>/gi, '');
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  s = s.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  s = s.replace(/«(?:think|thinking|reasoning)»[\s\S]*?«\/(?:think|thinking|reasoning)»/gi, '');
  s = s.replace(/^\s*(?:###\s*)?(?:思考过程|Thinking Process|Reasoning|思考|Thinking)\s*[:：]?[\s\S]*?(?=\n\s*\n|$)/i, '');
  // —— REFxx / REF xx → [n]——
  s = s.replace(/REF\s*(\d+)/gi, '[$1]');
  // —— 按首次出现顺序重新编号为连续 [1][2]…（论文式）——
  const seen = {};
  let seq = 0;
  s = s.replace(/\[(\d+)\]/g, (m, oldStr) => {
    let n;
    if (!(oldStr in seen)) { seq += 1; seen[oldStr] = seq; }
    n = seen[oldStr];
    return '\u0000R' + oldStr + '-' + n + '\u0000';
  });
  // —— 干掉 LightRAG 默认追加的 "### References" 整段 ——
  s = s.replace(/\n{0,2}#{1,3}\s*References[\s\S]*$/i, '');
  return s;
}

/* ---------- 2) mdToHtml：LLM 输出 → 含 cite 哨兵的 HTML ---------- */
export function mdToHtml(s) {
  if (!s) return '';
  s = normCite(s);
  // 1) 转义 HTML（哨兵不在转义范围，会一直保留到最后一步）
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // 3) 代码块 / 行内代码
  s = s.replace(/```([\s\S]*?)```/g, (m, p1) => '<pre class="md-code">' + p1 + '</pre>');
  s = s.replace(/`([^`]+)`/g, '<code class="md-code">$1</code>');
  // 4) 加粗 / 斜体
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<i>$1</i>');
  // 5) 标题
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
  // 8) 把哨兵还原为可点击 cite（data-ref=原编号，[n]=新编号）
  s = s.replace(/\u0000R(\d+)-(\d+)\u0000/g, (_, oldIdx, newIdx) =>
    '<span class="cite" data-ref="' + oldIdx + '">[' + newIdx + ']</span>');
  return s;
}

/* ---------- 3) waitingHtml：等待回答时的动画占位 ---------- */
export function waitingHtml() {
  return '<div class="typing"><span class="typing-dots"><i></i><i></i><i></i></span>' +
    '<span class="typing-text">正在组织答案<span class="caret"></span></span></div>';
}

/* ---------- 4) renderMarkdown：DocView 用的通用渲染（更接近 GFM） ---------- */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function inline(text) {
  let t = escapeHtml(text);
  t = t.replace(/`([^`]+)`/g, (_, c) => '<code class="md-code">' + c + '</code>');
  t = t.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener" class="md-link">$1</a>'
  );
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  t = t.replace(/\*([^*]+)\*/g, '<i>$1</i>');
  t = t.replace(/\[(\d+)\]/g, '<span class="cite" data-ref="$1">[$1]</span>');
  return t;
}
export function renderMarkdown(md) {
  if (!md) return '';
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let listType = null;
  let listItems = [];
  const flushList = () => {
    if (listItems.length) {
      html += '<' + listType + ' class="md-list">' + listItems.join('') + '</' + listType + '>';
      listItems = [];
      listType = null;
    }
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushList();
      const lvl = h[1].length;
      html += '<h' + lvl + ' class="md-h">' + inline(h[2]) + '</h' + lvl + '>';
      i++;
      continue;
    }
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
    const lm = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (lm) {
      const t = /^\d+\./.test(lm[2]) ? 'ol' : 'ul';
      if (listType && t !== listType) flushList();
      listType = t;
      listItems.push('<li>' + inline(lm[3]) + '</li>');
      i++;
      continue;
    }
    if (/^\s*$/.test(line)) {
      flushList();
      i++;
      continue;
    }
    flushList();
    const para = [line];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^(\s*)([-*]|\d+\.)\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    html += '<p class="md-p">' + inline(para.join(' ')) + '</p>';
  }
  flushList();
  return html;
}
