/* ============================================================
 * 原文浏览页（路由 /doc?ws=<workspace>&file=<文件名>）
 * 从 webviz 静态目录 /kb/<ws>/__parsed__/<file> 读取已解析的
 * markdown 原文（text/plain），渲染为带样式的页面。
 * 由图谱侧栏 / 查询溯源面板的「查看完整原文」按钮跳转而来。
 * ============================================================ */
import { defineComponent } from 'vue';
import { wsMeta } from '../api/neo4j.js';
import { kbUrl } from '../api/lightrag.js';
import { renderMarkdown } from '../utils/markdown.js';

export default defineComponent({
  name: 'DocView',
  data() {
    return {
      ws: '',
      file: '',
      content: '',
      html: '',
      status: { ok: false, text: '' },
      loading: false
    };
  },
  async mounted() {
    const q = this.$route.query;
    this.ws = q.ws || 'g00_master_all';
    this.file = q.file || '';
    document.title = (this.file || '原文') + ' · 妃子笑荔枝文化图谱';
    await this.load();
  },
  methods: {
    async load() {
      if (!this.file) {
        this.status = { ok: false, text: '缺少文件名参数' };
        return;
      }
      this.loading = true;
      try {
        const url = kbUrl(this.ws, this.file);
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        this.content = await res.text();
        this.html = renderMarkdown(this.content);
        this.status = { ok: true, text: '已加载原文（' + this.content.length + ' 字）' };
      } catch (err) {
        this.status = { ok: false, text: '加载失败: ' + (err.message || err) };
      } finally {
        this.loading = false;
      }
    },
    goBack() {
      if (window.history.length > 1) this.$router.back();
      else this.$router.push('/query?ws=' + this.ws);
    },
    meta() { return wsMeta(this.ws); },
    // 当前文件名（去掉目录前缀）
    baseName() {
      const f = this.file.replace(/^.*__parsed__\//, '').replace(/^.*data\/inputs\//, '');
      return f.split('/').pop();
    }
  },
  template: `
  <div class="doc-page">
    <div id="docbar">
      <span class="brand">
        <span class="bbadge" :style="{background: meta().color}">{{ meta().badge }}</span>
        <span class="title">{{ meta().name }}</span>
      </span>
      <el-button size="small" @click="goBack">‹ 返回</el-button>
      <span class="fname" :title="file">{{ baseName() }}</span>
      <span id="dstatus"><span id="ddot" :class="{ok: status.ok}"></span>{{ status.text }}</span>
    </div>
    <div id="docbody" v-show="!loading">
      <article class="md" v-html="html"></article>
    </div>
    <div id="docloading" v-show="loading">正在读取原文...</div>
  </div>`
});
