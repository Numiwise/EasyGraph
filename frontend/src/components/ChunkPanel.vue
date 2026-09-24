<!--
  ChunkPanel.vue —— 原文段落（chunk）面板
  ------------------------------------------------------------
  用法：
    <ChunkPanel :src-ids="node.srcIds" :file-paths="node.fps"
                :ws="ws" @load="onChunkLoad" />
  - 头两个 chunk 默认展开，余下折叠
  - 段落加载完毕后调用 emit('loaded', chunks)
  - 暴露 openOriginal(fp) 给外部按钮使用
-->
<template>
  <div class="chunks">
    <div v-if="chunks && chunks.length" class="section-head">
      <span class="sh-title">原文片段（{{ chunks.length }}）</span>
    </div>
    <div v-if="chunks && chunks.length">
      <div v-for="(s, i) in chunks" :key="'c'+i" class="chunk" :class="{ collapsed: !s.expanded }">
        <div class="chunk-head" @click="s.expanded = !s.expanded">
          <span class="chunk-idx">原文片段 {{ i + 1 }}</span>
          <span class="chunk-tog">{{ s.expanded ? '收起 ▲' : '展开 ▼' }}</span>
        </div>
        <div v-show="s.expanded" class="chunk-scroll">
          <div v-if="!s.loading && s.para" class="chunk-para">{{ s.para }}</div>
          <div v-else-if="s.loading" class="chunk-para dim">原文片段载入中…</div>
          <div v-else class="chunk-para dim">（未检索到该原文片段）</div>
        </div>
        <!-- 前两个 chunk 始终显示原文按钮；第 3+ 按钮跟随展开态 -->
        <button class="isrc-open chunk-open" :class="{ disabled: !s.file }"
          v-show="i < 2 || s.expanded"
          :disabled="!s.file" @click.stop="emit('openOriginal', s.file)">
          {{ s.file ? '查看原文网页' : '暂无原文链接' }}
        </button>
      </div>
    </div>
    <div v-else-if="!loading" class="chunk">
      <div class="chunk-head">原文片段</div>
      <div class="chunk-scroll"><span class="dim">（该条目未记录原文来源）</span></div>
      <button class="isrc-open chunk-open disabled" disabled>暂无原文链接</button>
    </div>
  </div>
</template>

<script setup>
/* ChunkPanel：渲染 chunks 列表。
 * - 父组件负责 fetchChunk（传入 src-ids 后本组件自动拉取并 emit('loaded')）
 * - 也支持父组件预加载后用 v-model:chunks 传进来
 */
import { reactive, watch } from 'vue';
import { fetchChunk } from '../composables/useLightragApi.js';

const props = defineProps({
  srcIds: { type: Array, default: () => [] },
  filePaths: { type: Array, default: () => [] },
  ws: { type: String, default: '' },
  loading: { type: Boolean, default: false }
});
const emit = defineEmits(['openOriginal', 'loaded']);

const chunks = reactive([]);

watch(
  () => [props.srcIds.join('|'), props.filePaths.join('|'), props.ws],
  async ([ids]) => {
    chunks.splice(0, chunks.length);
    if (!ids) return;
    const segs = (props.srcIds || []).map((s, i) => ({
      srcId: s,
      file: (props.filePaths || [])[i] || '',
      para: '',
      loading: true,
      expanded: i < 2
    }));
    chunks.push(...segs);
    for (let i = 0; i < chunks.length; i++) {
      try {
        const pl = await fetchChunk(chunks[i].srcId, props.ws);
        chunks[i].para = (pl && pl.content) ? pl.content : '';
        if (pl && pl.file_path && !chunks[i].file) chunks[i].file = pl.file_path;
      } catch (e) {
        chunks[i].para = '';
      }
      chunks[i].loading = false;
    }
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
  border-left: 4px solid var(--primary);
  border-radius: 0 8px 8px 0;
  background: var(--surface-2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(31, 45, 61, .06);
  transition: flex-basis .15s;
  min-height: 200px;
}
.chunk.collapsed { flex: 0 0 auto; min-height: 0; }
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
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
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
  overflow-y: auto;
  padding: 9px 12px 4px;
  font-size: 12.5px;
  color: var(--text-1);
  line-height: 1.8;
  white-space: pre-wrap;
}
.chunk-para { color: var(--text-1); }
.chunk-para.dim { color: var(--text-3); }
.isrc-open.chunk-open {
  flex: 0 0 auto;
  margin: 6px 10px 8px;
  align-self: flex-start;
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
  cursor: default;
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
