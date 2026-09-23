/* ============================================================
 * 轻量 Markdown 渲染器（无第三方依赖）
 * 支持：标题 #~#### / 段落 / 有序·无序列表 / 引用块 / 粗体·斜体
 *       / 行内代码 / [文本](http_url) 链接 / [n] 数字引用（溯源标记）
 * 说明：LightRAG 的回答是 Markdown，且带 [1][3] 数字引用。
 *       此处把 [n] 渲染为可点击的 <span class="cite">，由视图负责绑定跳转。
 * ============================================================ */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function inline(text) {
  let t = escapeHtml(text);
  // 行内代码
  t = t.replace(/`([^`]+)`/g, (_, c) => '<code class="md-code">' + c + '</code>');
  // 链接 [text](url)
  t = t.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener" class="md-link">$1</a>'
  );
  // 粗体
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  // 斜体
  t = t.replace(/\*([^*]+)\*/g, '<i>$1</i>');
  // 数字引用 [n] → 可点击溯源标记（data-ref 供事件委托读取）
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
