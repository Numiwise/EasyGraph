/* ============================================================
 * useMarkdown.js —— Markdown 工具的"组合式 API 包装"
 * ------------------------------------------------------------
 * 业务背景：
 *   前端在多处需要把 Markdown 渲染成 HTML：
 *     - QueryView 显示 LLM 返回的 Markdown 回答
 *     - DocView 显示单篇原始资料的 .md 内容
 *     - 引用面板里展示 chunk 文本（可能含有 Markdown 标记）
 *   真正干活的纯函数放在 utils/markdown.js（便于单独测试）。
 *   本文件相当于一个"门面" —— 把那些纯函数再 export 一份，
 *   让组件能用 const { mdToHtml } = useMarkdown() 这种"hooks 风格"调用，
 *   和 useLightragApi() 保持心智一致。
 *
 * 涉及的 Vue 3 概念：
 *   - composable（组合式函数）：一个普通函数，返回值是普通对象。
 *     因为我们这里只是把已存在的工具函数再 export 一次，
 *     所以既可以 import 也可以 useMarkdown() —— 两种调用方式都支持。
 * ============================================================ */

// 从 utils/markdown.js 引入三个真正的渲染函数：
//   mdToHtml(md)    —— 把一段 Markdown 字符串转成安全的 HTML 字符串（一次性返回）
//   waitingHtml()   —— 返回一段"AI 正在思考中..."占位 HTML
//   renderMarkdown(el, md) —— 把 md 渲染到已有的 DOM 元素 el 里（增量更新）
// 这些函数都已经在 utils/markdown.js 里写好了详细注释。
import { mdToHtml, waitingHtml, renderMarkdown } from '../utils/markdown.js';

/**
 * useMarkdown() —— Vue 3 风格的"组合式"调用入口
 *
 * 用法（任选其一）：
 *   1) const { mdToHtml } = useMarkdown();
 *      mdToHtml('# 标题')    // → "<h1>标题</h1>"
 *   2) 直接 import { mdToHtml } from '@/composables/useMarkdown.js';
 *
 * 这里简单地"透传"，是为了让 vue 组件里代码风格统一（都 useXxx()）。
 */
export function useMarkdown() {
  return { mdToHtml, waitingHtml, renderMarkdown };
}

// 同时也以"具名导出"的方式把三个函数暴露出去，
// 这样既支持 useMarkdown() 也支持直接 import，便于在不同文件里用得舒服。
export { mdToHtml, waitingHtml, renderMarkdown };
