<!--
  SectionHead.vue —— 通用"可点击折叠分区头"
  ------------------------------------------------------------
  业务用途：
    GraphView 和 QueryView 在描述/属性/邻居等分区都用同一套结构：
      <div class="section-head" @click="...">
        <span class="sh-title">{标题}</span>
        <span class="sh-tog">收起 ▲ / 展开 ▼</span>
      </div>
    抽成组件后，父组件只需：<SectionHead title="描述" :open="x" @toggle="x = !x" />

  Props：
    - title  : string  —— 标题文本
    - open   : boolean —— 是否展开
    - toggle : string  —— 自定义切换文本，默认自动 '收起 ▲' / '展开 ▼'

  Emits：
    - toggle —— 用户点击头部时触发，父组件同步 open 状态

  行业实践：
    - Element Plus 的 el-collapse 要嵌套 el-collapse-item + v-model 数组，
      与本项目"独立 boolean 状态"的形态不匹配（多 el-collapse 互不影响）。
    - 抽出小组件后样式保持原样（不破坏视觉）。
  ============================================================ -->
<template>
  <div class="section-head" @click="emit('toggle')">
    <span class="sh-title">{{ title }}</span>
    <span class="sh-tog">{{ toggle || (open ? '收起 ▲' : '展开 ▼') }}</span>
  </div>
</template>

<script setup>
// ============================================================
// Props / Emits
// ============================================================
defineProps({
  title:  { type: String,  required: true },
  open:   { type: Boolean, default: true },
  // 自定义切换文本（可选）。给则优先用；不传则按 open 自动切换。
  toggle: { type: String,  default: '' }
});
const emit = defineEmits(['toggle']);
</script>

<style scoped>
/* 引用 main.css 里的 .section-head / .sh-title / .sh-tog 设计风格：
   圆角浅蓝卡片 + 加粗标题 + 右侧小标签式切换指示。
   这里保留一套等价的 scoped 样式（不依赖外部样式，组件独立可用）。 */
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--primary-soft);
  border: 1px solid var(--border);
  cursor: pointer;
  user-select: none;
  margin-bottom: 6px;
  transition: background 0.15s;
}
.section-head:hover {
  background: linear-gradient(95deg, #d3e4ff, #c2d6fb);
}
.sh-title {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--primary-strong);
  letter-spacing: 0.5px;
}
.sh-tog {
  font-size: 11px;
  color: var(--text-2);
  font-weight: 500;
}
</style>