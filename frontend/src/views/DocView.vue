<!--
  原文浏览页（路由 /doc?ws=<workspace>&file=<文件名>）
  从 webviz 静态目录 /kb/<ws>/__parsed__/<file> 读取已解析的
  markdown 原文（text/plain），渲染为带样式的页面。
  由图谱侧栏 / 查询溯源面板的「查看完整原文」按钮跳转而来。

  Vue3 重构：SFC + Composition API（setup）
-->
<template>
  <div class="doc-page">
    <div id="docbar">
      <span class="brand">
        <span class="bbadge" :style="{background: meta.color}">{{ meta.badge }}</span>
        <span class="title">{{ meta.name }}</span>
      </span>
      <el-button size="small" @click="goBack">‹ 返回</el-button>
      <span class="fname" :title="file">{{ baseName }}</span>
      <span id="dstatus"><span id="ddot" :class="{ok: status.ok}"></span>{{ status.text }}</span>
    </div>
    <div id="docbody" v-show="!loading">
      <article class="md" v-html="html"></article>
    </div>
    <div id="docloading" v-show="loading">正在读取原文...</div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { wsMeta } from '../api/neo4j.js';
import { kbUrl } from '../api/lightrag.js';
import { renderMarkdown } from '../utils/markdown.js';

/* ----- 响应式状态 ----- */
const ws = ref('');
const file = ref('');
const content = ref('');
const html = ref('');
const status = reactive({ ok: false, text: '' });
const loading = ref(false);

/* ----- 路由（替代 this.$route / this.$router） ----- */
const route = useRoute();
const router = useRouter();

/* ----- 计算属性 ----- */
const meta = computed(() => wsMeta(ws.value));
// 当前文件名（去掉目录前缀）
const baseName = computed(() => {
  const f = file.value.replace(/^.*__parsed__\//, '').replace(/^.*data\/inputs\//, '');
  return f.split('/').pop();
});

/* ----- 动作 ----- */
async function load() {
  if (!file.value) {
    status.ok = false;
    status.text = '缺少文件名参数';
    return;
  }
  loading.value = true;
  try {
    const url = kbUrl(ws.value, file.value);
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    content.value = await res.text();
    html.value = renderMarkdown(content.value);
    status.ok = true;
    status.text = '已加载原文（' + content.value.length + ' 字）';
  } catch (err) {
    status.ok = false;
    status.text = '加载失败: ' + (err.message || err);
  } finally {
    loading.value = false;
  }
}

function goBack() {
  if (window.history.length > 1) router.back();
  else router.push('/query?ws=' + ws.value);
}

/* ----- 生命周期 ----- */
onMounted(async () => {
  const q = route.query;
  ws.value = q.ws || 'g00_master_all';
  file.value = q.file || '';
  document.title = (file.value || '原文') + ' · 妃子笑荔枝文化图谱';
  await load();
});
</script>

<style scoped>
/* ============================================================
 * DocView 专属样式（原 doc.css 全部迁入；scoped 隔离）
 * ============================================================ */
.doc-page {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: linear-gradient(135deg, #d4deed 0%, #d0d8ec 50%, #e0d4ea 100%);
}
#docbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  flex-wrap: wrap;
  background: linear-gradient(95deg, var(--chrome), var(--chrome-2));
  border-bottom: none;
  color: var(--chrome-text);
  box-shadow: 0 2px 10px rgba(20, 30, 55, .28);
}
#docbar .title {
  font-size: 15px;
  font-weight: 700;
  color: var(--chrome-text);
  white-space: nowrap;
}
#docbar .fname {
  font-size: 13px;
  color: var(--chrome-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 46%;
}
#dstatus {
  margin-left: auto;
  font-size: 12px;
  color: var(--chrome-dim);
  white-space: nowrap;
}
#ddot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--danger);
  margin-right: 5px;
}
#ddot.ok { background: var(--ok); }
#docbody {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 26px 22px 60px;
}
#docbody .md {
  max-width: 900px;
  margin: 0 auto;
  font-size: 14px;
  background: linear-gradient(180deg, #fbf6ec, #efe6d2);
  border: 1px solid var(--tint-amber-bd);
  border-radius: 10px;
  padding: 24px 28px;
  color: var(--text-1);
  box-shadow: 0 8px 26px rgba(120, 80, 20, .16);
}
#docloading {
  padding: 40px;
  text-align: center;
  color: var(--text-2);
}
</style>
