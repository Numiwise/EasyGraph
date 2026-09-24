<!--
  WorkspaceBadge.vue —— 工作区徽标（彩色 + 单字）
  ------------------------------------------------------------
  业务用途：
    在侧边栏、引用面板、图谱节点标签里，会用一个"彩色小方块 + 单字"
    来代表某个 workspace：
      - 黄色"总" = 总图谱
      - 蓝色"人" = 人物与文献
      - 绿色"路" = 地点与交通
      ……以此类推。
    这样用户即使不看文字也能快速识别 workspace。

  组件设计：
    两种用法：
      1) <WorkspaceBadge :meta="currentMeta" /> —— 直接传元数据对象
      2) <WorkspaceBadge ws="g01_people_literature" /> —— 传 workspace id，内部自动查 wsMeta(ws)
    两种尺寸：
      - default（默认，26×26 圆角矩形）
      - small  （24×24，用于紧凑布局）

  Vue 3 涉及的语法点（给初学者）：
    - defineProps：声明组件对外接收的 props，是 <script setup> 推荐的写法。
    - computed()：计算属性，依赖 props 变化时自动重新计算。
    - <script setup>：组合式 API 的 SFC 写法，模板直接用顶层变量。
    - <style scoped>：CSS 只在本组件生效，不会污染其它组件。
-->
<template>
  <!--
    模板部分：
      - class="ws-badge" + class="size-{{size}}"：基础样式 + 尺寸变体
      - :style="{ background: metaRef.color }"：动态绑定背景色（来自 meta.color）
      - {{ metaRef.badge }}：显示徽标字符（meta.badge，比如"总"/"人"/"路"）
    用 `metaRef` 而不是 meta —— 因为 Vue 模板里直接用 props.meta 也可以，
    但这里用 computed 让"meta 或 ws 谁传都行"的逻辑集中在一处。
  -->
  <span class="ws-badge" :class="['size-' + size]" :style="{ background: metaRef.color }">
    {{ metaRef.badge }}
  </span>
</template>

<script setup>
// 从 vue 引入 computed —— 用于创建"计算属性"
import { computed } from 'vue';

// 从 composables/useNeo4j.js 引入 wsMeta，根据 ws id 查元数据
import { wsMeta } from '../composables/useNeo4j.js';

/* ---------------------------------------------------------------
 * defineProps：声明组件对外 props。运行时相当于一个响应式对象 props。
 * 字段说明：
 *   ws    —— workspace id（字符串）。如果同时传了 meta，则 meta 优先。
 *   meta  —— 直接传入的元数据对象（对象）。覆盖 ws 的自动查找。
 *   size  —— 'default' 或 'small'（字符串），控制视觉尺寸。
 * --------------------------------------------------------------- */
const props = defineProps({
  ws: { type: String, default: '' },     // 默认空字符串（避免 meta 也缺时报错）
  meta: { type: Object, default: null }, // 默认 null，让 computed 判断
  size: { type: String, default: 'default' } // 'default' | 'small'
});

// computed(() => ...) 返回一个 ref，模板里直接写 {{ metaRef.badge }} 即可。
// 逻辑：优先用 meta，否则通过 wsMeta(ws) 自动查找，再给个空字符串兜底。
const metaRef = computed(() => props.meta || wsMeta(props.ws || ''));
</script>

<style scoped>
/* scoped 让这些样式只作用在当前组件的 DOM 上，不会污染外部 */
.ws-badge {
  display: inline-flex;          /* 行内 flex，让内容（单字）水平+垂直居中 */
  align-items: center;
  justify-content: center;
  width: 26px;                   /* 默认尺寸 */
  height: 26px;
  border-radius: 7px;            /* 圆角矩形（不是纯圆，而是"方块带圆角"） */
  color: #fff;                   /* 文字白色，在彩色背景上更清晰 */
  font-weight: 800;              /* 字重 800 让单字看起来醒目 */
  font-size: 14px;
  box-shadow: 0 1px 4px rgba(31, 45, 61, .22);  /* 轻微阴影增加层次 */
  flex: 0 0 auto;                /* 父容器是 flex 时，徽标不被拉伸 */
}
.ws-badge.size-small {
  /* 紧凑尺寸，比默认小 2px，阴影稍深一点点（视觉上更贴近背景） */
  width: 24px;
  height: 24px;
  border-radius: 6px;
  font-size: 13px;
  box-shadow: 0 1px 4px rgba(31, 45, 61, .3);
}
</style>
