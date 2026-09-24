<!--
  TypeLegend.vue —— 实体类型图例（带多选筛选）
  ------------------------------------------------------------
  业务用途：
    GraphView 里图谱画了几百几千个节点，每类节点用不同颜色表示：
      - 人物（person）：蓝色
      - 地点（location）：绿色
      - 组织（organization）：紫色
      ……一共 N 种。
    左侧这个图例组件把"全部 N 种"列出来，每个带一个 checkbox：
      - 用户可单独勾选某类（emit toggle）
      - 或一键全选（emit selectAll）
      - 或一键全不选（emit selectNone）
    父组件收到事件后去过滤图谱上要显示哪些节点/边。

  设计思路（组件通信）：
    本组件是"纯展示+事件转发"型：
      - 选中状态完全由父组件掌控，通过 prop selectedTypes 传入。
      - 用户勾选时并不直接修改内部状态，而是 emit 事件让父组件改。
    这种"单向数据流"让状态集中在一个地方，方便外层持久化或同步到 URL。
-->
<template>
  <div class="legend">
    <!-- 可选标题：父组件可传入自定义文案，没传就不渲染 -->
    <div v-if="title" class="lhead">{{ title }}</div>

    <!--
      <slot name="batch"> 是具名插槽：父组件可以自定义"全选/全部不选"那一栏。
      这里我们给了默认内容（两个 el-checkbox），父组件不提供就显示默认的。
    -->
    <slot name="batch">
      <el-checkbox class="legend-ck legend-batch" :model-value="allSelected" @change="emit('selectAll')">全选</el-checkbox>
      <el-checkbox class="legend-ck legend-batch" :model-value="noneSelected" @change="emit('selectNone')">全部不选</el-checkbox>
    </slot>

    <!-- 遍历 typeList 渲染每一类：
         - key=t 用实体类型当 key，强制要求不重复
         - :model-value 绑定布尔值（是否在 selectedTypes 里）
         - @change 触发 toggle 事件，把类型名带回去让父组件决定勾选状态
    -->
    <el-checkbox v-for="t in typeList" :key="t" class="legend-ck"
      :model-value="selectedTypes.includes(t)" @change="emit('toggle', t)">
      <!-- 颜色块：宽 11×11 的方块，背景色从 typeColors 映射里取 -->
      <span class="sw" :style="{ background: typeColors[t] || '#888' }"></span>{{ t }}
    </el-checkbox>
  </div>
</template>

<script setup>
// 从 vue 引入 computed —— 用于构造"全选/全部不选"的派生状态
import { computed } from 'vue';

/* ---------------------------------------------------------------
 * defineProps：声明对外 props
 * 字段含义：
 *   typeList       —— 所有可能的实体类型（如 ['人物','地点','组织']）
 *   typeColors     —— 类型→颜色 hex 的映射对象（缺失时用 #888 灰）
 *   selectedTypes  —— 当前已勾选的类型数组（本组件是"受控"的，不能内部修改）
 *   title          —— 显示在列表上方的标题
 *   skin           —— 视觉风格（'light'/'dark'），本组件暂未用到，是预留参数
 * --------------------------------------------------------------- */
const props = defineProps({
  typeList: { type: Array, default: () => [] },       // 必须 default: () => []，避免所有组件共享同一个空数组
  typeColors: { type: Object, default: () => ({}) },
  selectedTypes: { type: Array, default: () => [] },
  title: { type: String, default: '实体类型（勾选筛选）' },
  // 父组件可选提供 skin: 'light' / 'dark'（默认 light）
  skin: { type: String, default: 'light' }
});

/* ---------------------------------------------------------------
 * defineEmits：声明本组件会 emit 的事件。
 *   toggle     (typeName) — 单项勾选切换
 *   selectAll  ()         — 一键全选
 *   selectNone ()         — 一键全不选
 * 父组件用 @toggle="..." @selectAll="..." 监听即可。
 * --------------------------------------------------------------- */
const emit = defineEmits(['toggle', 'selectAll', 'selectNone']);

// computed 是计算属性：
//   - "全选"高亮条件：typeList 非空 且 选中的数量 === typeList 长度
//   - "全部不选"高亮条件：selectedTypes 长度为 0
// 这两个状态会让对应的 el-checkbox 显示已勾选样式。
const allSelected = computed(() =>
  props.typeList.length > 0 && props.selectedTypes.length === props.typeList.length);
const noneSelected = computed(() => props.selectedTypes.length === 0);
</script>

<style scoped>
/* scoped 让样式只作用在本组件内。 */
.legend {
  font-size: 12px;
  padding: 10px 12px;
}
/* 每条勾选项：横向 flex 排版，上下间距 3px。 */
.legend-ck { display: flex; align-items: center; height: auto; margin: 3px 0; }
/* 用 :deep() 穿透 scoped 影响 Element Plus 内部 DOM（.el-checkbox__input 等）。 */
.legend-ck :deep(.el-checkbox__input) { display: inline-flex; }
.legend-ck :deep(.el-checkbox__inner) { background: transparent; border-color: #8ea3c8; }
.legend-ck :deep(.el-checkbox__inner::after) { border-color: #0f1a2a; }
/* 已勾选状态：用品牌黄色（#ffd257）填充 */
.legend-ck.is-checked :deep(.el-checkbox__inner) {
  background: #ffd257;
  border-color: #ffd257;
}
/* 勾选项文字样式 */
.legend-ck :deep(.el-checkbox__label) {
  color: #e8eefb;
  font-size: 12px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 6px;                /* 颜色块和文字之间留 6px 间距 */
  padding-left: 8px;
}
.legend-ck:hover :deep(.el-checkbox__label) { color: #ffffff; }
.legend-ck.is-checked :deep(.el-checkbox__label) {
  color: #ffffff;
  font-weight: 600;
}
/* 全选/全部不选那一栏的加粗 + 高亮色 */
.legend-batch :deep(.el-checkbox__label) { font-weight: 600; }
.legend-batch.is-checked :deep(.el-checkbox__label) { color: #ffd257; }

/* 类型颜色块：11×11，3px 圆角，外加 1px 白色描边，让浅色也能看清边界 */
.sw {
  width: 11px;
  height: 11px;
  border-radius: 3px;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, .18);
  display: inline-block;
}
/* 标题"实体类型（勾选筛选）"那行 */
.lhead {
  margin-bottom: 4px;
  font-weight: 600;
}
</style>
