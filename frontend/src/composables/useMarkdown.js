/* ============================================================
 * useMarkdown() —— Markdown 工具 composable
 * ------------------------------------------------------------
 * 把 utils/markdown.js 的纯函数包成 Vue 组合式 API，
 *  让组件用 const { mdToHtml, waitingHtml, renderMarkdown } = useMarkdown()
 *   调用更直观，同时保留可单测的纯函数实现。
 * ============================================================ */
import { mdToHtml, waitingHtml, renderMarkdown } from '../utils/markdown.js';

export function useMarkdown() {
  return { mdToHtml, waitingHtml, renderMarkdown };
}

export { mdToHtml, waitingHtml, renderMarkdown };
