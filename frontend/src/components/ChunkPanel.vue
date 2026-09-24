<!--
  ChunkPanel.vue —— 原文段落（chunk）面板
  ------------------------------------------------------------
  业务用途：
    知识图谱里每个"实体"或"关系"会引用 LightRAG 抽取的若干"原文段落"（chunk）。
    本组件把这些 chunk 列表展示给用户：
      - 头两个 chunk 默认展开（用户一眼看到最关键的两段）
      - 其余折叠起来，需要时点击 header 展开
      - 每个 chunk 右上角有"查看原文网页"按钮，跳转到 _origin/ 原始资料

  用法：
    <ChunkPanel :src-ids="node.srcIds"
                :file-paths="node.fps"
                :ws="ws"
                loading
                @openOriginal="(fp) => openOriginalUrl(fp)"
                @loaded="(chunks) => state.chunks = chunks" />
  - src-ids 是 chunk 的 id 列表（要去 Qdrant 取原文）
  - file-paths 是对应的原始文件路径（用于"查看原文"按钮）
  - 加载完成后会 emit('loaded', chunks) 把数据回传给父组件缓存

  Vue 3 涉及的语法点：
    - reactive([])：将数组变成响应式（数据变化自动驱动 UI 重新渲染）
    - watch([多个依赖])([ids, ...])：watch 可以监听一个函数返回的"getter 数组"，
       并把新值作为参数传给回调。
-->
<template>
  <!-- chunks 是当前已经处理（加载中/加载完成）的段落数组 -->
  <div class="chunks">
    <!-- 标题"原文片段（N）"，只在数组非空时显示 -->
    <div v-if="chunks && chunks.length" class="section-head">
      <span class="sh-title">原文片段（{{ chunks.length }}）</span>
    </div>

    <!-- 列表渲染 -->
    <div v-if="chunks && chunks.length">
      <!--
        v-for="(s, i) in chunks"：s 是段对象，i 是下标
        :key="'c'+i"：给每行一个稳定 key（这里用索引就够，因为不会插入/删除中间项）
        :class="{ collapsed: !s.expanded }"：是否折叠 → 触发不同 CSS
      -->
      <div v-for="(s, i) in chunks" :key="'c'+i" class="chunk" :class="{ collapsed: !s.expanded }">
        <!-- header 行：点击切换展开状态 -->
        <div class="chunk-head" @click="s.expanded = !s.expanded">
          <span class="chunk-idx">原文片段 {{ i + 1 }}</span>
          <span class="chunk-tog">{{ s.expanded ? '收起 ▲' : '展开 ▼' }}</span>
        </div>

        <!-- 段落主体（折叠时不卸载，用 v-show） -->
        <div v-show="s.expanded" class="chunk-scroll">
          <!--
            三种状态互斥：
              a) 已加载 + 有内容：显示正文
              b) 加载中：显示"载入中…"
              c) 加载完成但没有内容：显示"未检索到"
          -->
          <div v-if="!s.loading && s.para" class="chunk-para">{{ s.para }}</div>
          <div v-else-if="s.loading" class="chunk-para dim">原文片段载入中…</div>
          <div v-else class="chunk-para dim">（未检索到该原文片段）</div>
        </div>

        <!-- "查看原文网页" 按钮：
             - 前两个 chunk 始终显示
             - 之后的 chunk 只在展开时显示
             - 如果没有 file 路径，按钮置灰禁用
        -->
        <button class="isrc-open chunk-open" :class="{ disabled: !s.file }"
          v-show="i < 2 || s.expanded"
          :disabled="!s.file" @click.stop="emit('openOriginal', s.file)">
          {{ s.file ? '查看原文网页' : '暂无原文链接' }}
        </button>
      </div>
    </div>

    <!-- 兜底：chunks 为空 且没有 loading 标志 -->
    <div v-else-if="!loading" class="chunk">
      <div class="chunk-head">原文片段</div>
      <div class="chunk-scroll"><span class="dim">（该条目未记录原文来源）</span></div>
      <button class="isrc-open chunk-open disabled" disabled>暂无原文链接</button>
    </div>
  </div>
</template>

<script setup>
/* ---------------------------------------------------------------
 * ChunkPanel：渲染 chunks 列表。
 * ---------------------------------------------------------------
 * 数据流：
 *   1) 父组件传入 src-ids（+ file-paths + ws）。
 *   2) watch 监听到 src-ids 变化后，重置 chunks、push 一组"占位项"。
 *   3) 逐条用 fetchChunk 从 Qdrant 拉原始 content，写回 s.para。
 *   4) 全部完成后 emit('loaded', chunks) 让父组件做缓存/同步。
 * --------------------------------------------------------------- */

// 从 vue 引入 reactive（让数组对象本身是响应式的）和 watch（监听数据变化）
import { reactive, watch } from 'vue';
// 从 composables/useLightragApi.js 引入 fetchChunk：按 chunkId+ws 取 Qdrant payload
import { fetchChunk } from '../composables/useLightragApi.js';

/* defineProps：声明对外 props
 *   srcIds    —— chunk id 列表（数组，元素是字符串）
 *   filePaths —— 对应的"原始资料"文件路径列表（数组，可为空）
 *                注意：srcIds 与 filePaths 通常等长且一一对应
 *   ws        —— workspace id（用于 fetchChunk 时的 Qdrant 过滤消歧）
 *   loading   —— 父级 loading 标志，主要用来区分"加载中"和"真的没数据"
 */
const props = defineProps({
  srcIds: { type: Array, default: () => [] },
  filePaths: { type: Array, default: () => [] },
  ws: { type: String, default: '' },
  loading: { type: Boolean, default: false }
});

/* defineEmits：对外事件
 *   'openOriginal' (filePath) —— 用户点了"查看原文网页"
 *   'loaded'        (chunks) —— 所有段落加载完成，把完整 chunks 列表回传
 */
const emit = defineEmits(['openOriginal', 'loaded']);

// reactive([]) 让数组内部对象是响应式的。直接修改 chunks[i].para / .expanded
// 都会触发模板重新渲染。
const chunks = reactive([]);

/* ===============================================================
 *  watch：监听 srcIds / filePaths / ws 变化，重新拉一遍原文
 * --------------------------------------------------------------
 *  watch 的"复杂源"形式：
 *    watch(() => [...], callback, { immediate })
 *  第一个参数是个函数，返回一个数组。Vue 会深度比较这个数组：
 *    - srcIds.join('|') 把 id 数组拍成字符串（id 顺序变了也能识别）
 *    - filePaths.join('|') 同理
 *    - props.ws 字符串
 *  callback 收到新值 [ids, fps, ws]，但我们这里只用到 ids 来 reset chunks。
 *
 *  immediate: true 让 watch 在 setup 第一次运行时就触发一次（不要等数据先变）。
 * =============================================================== */
watch(
  () => [props.srcIds.join('|'), props.filePaths.join('|'), props.ws],
  async ([ids]) => {
    // 先清空旧 chunks（splice 比 length=0 更好，避免触发 ref 替换）
    chunks.splice(0, chunks.length);
    if (!ids) return;   // ids 为空说明没东西要加载

    // 构造一组"占位项"，每项对应一段原文。loading=true 表示还没拉回来。
    // expanded: i < 2 表示头两个默认展开
    const segs = (props.srcIds || []).map((s, i) => ({
      srcId: s,
      file: (props.filePaths || [])[i] || '',
      para: '',
      loading: true,
      expanded: i < 2
    }));
    chunks.push(...segs);  // 推到响应式数组，触发 UI 重渲染出"载入中"占位

    // 串行拉取每一段（顺序不重要，并行也行）。每段拉到后更新对应 chunk。
    for (let i = 0; i < chunks.length; i++) {
      try {
        const pl = await fetchChunk(chunks[i].srcId, props.ws);
        // payload.content 是原文片段
        chunks[i].para = (pl && pl.content) ? pl.content : '';
        // 如果 props 没传 file_path 但 payload 里有，就用它（更准确）
        if (pl && pl.file_path && !chunks[i].file) chunks[i].file = pl.file_path;
      } catch (e) {
        chunks[i].para = '';   // 出错就当空处理
      }
      chunks[i].loading = false;
    }

    // 把"已加载完整列表"回传给父组件，父组件可缓存到 store 或 URL
    emit('loaded', [...chunks]);
  },
  { immediate: true }
);
</script>

<style scoped>
/* ============================================================
 * ChunkPanel 专属样式（原 GraphView / QueryView 各自重复实现，现统一）
 * ============================================================ */
.chunks {
  margin: 8px 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}
.chunk {
  border: 1px solid var(--border);
  border-left: 4px solid var(--primary);   /* 左侧 4px 蓝色"线索"条 */
  border-radius: 0 8px 8px 0;
  background: var(--surface-2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(31, 45, 61, .06);
  transition: flex-basis .15s;
  min-height: 200px;
}
.chunk.collapsed { flex: 0 0 auto; min-height: 0; }   /* 折叠时高度自适应 */
.chunk.collapsed .chunk-scroll { display: none; }
.chunk.collapsed .chunk-open { margin-top: 6px; margin-bottom: 8px; }
.chunk-head {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 700;
  color: var(--primary-strong);
  background: var(--primary-soft);
  border-bottom: 1px solid var(--border);
  letter-spacing: .5px;
  flex: 0 0 auto;                           /* 不参与伸缩 */
  display: flex;
  align-items: center;
  justify-content: space-between;          /* 标题在左，"展开/收起"在右 */
  gap: 8px;
  cursor: pointer;
  user-select: none;
}
.chunk-head:hover { background: linear-gradient(95deg, #d3e4ff, #c2d6fb); }
.chunk-idx { color: var(--primary-strong); }
.chunk-tog { font-size: 11px; color: var(--text-2); font-weight: 500; }
.chunk-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;                /* 段落太长时下拉滚动 */
  padding: 9px 12px 4px;
  font-size: 12.5px;
  color: var(--text-1);
  line-height: 1.8;
  white-space: pre-wrap;           /* 保留换行但允许自动折行 */
}
.chunk-para { color: var(--text-1); }
.chunk-para.dim { color: var(--text-3); }
.isrc-open.chunk-open {
  flex: 0 0 auto;
  margin: 6px 10px 8px;
  align-self: flex-start;          /* 按钮靠左不拉伸 */
  font-size: 12px !important;
  padding: 5px 14px !important;
}
.isrc-open.chunk-open.disabled,
.isrc-open.chunk-open:disabled {
  background: var(--surface-2);
  color: var(--text-3);
  border-color: var(--border);
  cursor: not-allowed;
  opacity: .8;
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--primary-soft);
  border: 1px solid var(--border);
  cursor: default;                 /* 标题本身不可点（与 chunk-head 区分） */
  user-select: none;
  margin-bottom: 6px;
}
.sh-title {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--primary-strong);
  letter-spacing: .5px;
}
.dim { font-size: 12.5px; color: var(--text-2); }
</style>
