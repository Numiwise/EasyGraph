<!--
  ProgressSteps.vue —— 通用"多步骤进度条"组件
  ------------------------------------------------------------
  业务用途：
    QueryView 在两个地方用到相同结构的"4 步进度条"：
      - 初始居中布局（#qcenter）里，未开始对话时展示当前阶段
      - 多轮对话中（#q-body），重复使用同一进度条
    把这块拆成独立组件后，模板只挂一个标签即可，结构更整齐。

  Props：
    - steps    : string[] —— 步骤名数组（默认 4 步：解析/检索/原文/组织）
    - active   : number   —— 当前激活的下标（0-based，-1 表示全部未开始）
    - show     : boolean  —— 是否显示（false 时整个 v-show 不渲染）

  行业实践：
    - Element Plus 的 el-steps 数据形态略不同（要 activeIndex / processStatus / finishStatus），
      强行套用会让样式与项目不一致（深色工具条 + 浅色卡片），所以保留手搓。
    - 关键样式：圆点 + 横向连接线 + 当前态脉动，比 el-steps 更紧凑。
  ============================================================ -->
<template>
  <div class="progress" v-show="show">
    <div class="pbar">
      <span class="pfill" :style="{ width: pct + '%' }"></span>
    </div>
    <div class="steps">
      <div v-for="(s, i) in steps" :key="i" class="step"
        :class="{ on: i <= active, cur: i === active }">
        <span class="dot"></span>{{ s }}
      </div>
    </div>
  </div>
</template>

<script setup>
// ============================================================
// Props 定义（用 Vue 3 组合式 API 的 defineProps，避免 Options API 风格）
// ------------------------------------------------------------
// default：给每个 prop 一个合理默认值，调用方可以零配置使用。
// ============================================================
import { computed } from 'vue';

const props = defineProps({
  steps:  { type: Array,  default: () => ['解析问题', '图谱检索', '取回原文', '组织答案'] },
  active: { type: Number, default: -1 },     // -1 = 全部未开始；>=0 = 当前步骤下标
  show:   { type: Boolean, default: true }
});

// 计算百分比（基于 active 下标）；-1 时显示 0%。
// 注意：max(-1, min(active, length)) 防止外部传入 length 长度导致 100%。
const pct = computed(() => {
  const a = Math.max(-1, Math.min(props.active, props.steps.length - 1));
  return a < 0 ? 0 : ((a + 1) / props.steps.length) * 100;
});
</script>

<style scoped>
/* 容器：上间距 + 与周围卡片分隔 */
.progress {
  margin: 8px 16px 0;
  padding: 8px 12px 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
}
/* 进度条：底色 + 上方填充色，宽度用内联 :style 控制 */
.pbar {
  position: relative;
  height: 4px;
  border-radius: 2px;
  background: var(--border);
  overflow: hidden;
  margin-bottom: 8px;
}
.pfill {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  background: linear-gradient(90deg, var(--primary), var(--primary-strong));
  transition: width 0.35s ease-out;
  border-radius: 2px;
}
/* 步骤列表：flex 横向排列 */
.steps {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.step {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-3);
  flex: 1 1 0;
  min-width: 0;
  transition: color 0.2s;
}
.step .dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--border);
  transition: background 0.2s;
  flex: 0 0 auto;
}
.step.on { color: var(--text-1); }
.step.on .dot { background: var(--primary); }
.step.cur {
  color: var(--primary-strong);
  font-weight: 600;
}
.step.cur .dot {
  background: var(--primary);
  box-shadow: 0 0 0 4px rgba(31, 111, 235, 0.15);
  animation: dot-pulse 1.2s ease-in-out infinite;
}
@keyframes dot-pulse {
  0%, 100% { box-shadow: 0 0 0 4px rgba(31, 111, 235, 0.15); }
  50%      { box-shadow: 0 0 0 7px rgba(31, 111, 235, 0.05); }
}
</style>