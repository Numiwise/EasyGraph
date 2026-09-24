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
/* DocView 专属样式暂留 global（doc.css 已有） */
</style>
