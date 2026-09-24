<!--
  TypeLegend.vue —— 实体类型图例（带多选筛选）
  ------------------------------------------------------------
  通用图例：左侧显示 el-checkbox + 颜色块 + 实体类型名。
  父组件：传入 typeList / typeColors / selectedTypes，监听 toggle/selectAll/selectNone。
-->
<template>
  <div class="legend">
    <div v-if="title" class="lhead">{{ title }}</div>
    <slot name="batch">
      <el-checkbox class="legend-ck legend-batch" :model-value="allSelected" @change="emit('selectAll')">全选</el-checkbox>
      <el-checkbox class="legend-ck legend-batch" :model-value="noneSelected" @change="emit('selectNone')">全部不选</el-checkbox>
    </slot>
    <el-checkbox v-for="t in typeList" :key="t" class="legend-ck"
      :model-value="selectedTypes.includes(t)" @change="emit('toggle', t)">
      <span class="sw" :style="{ background: typeColors[t] || '#888' }"></span>{{ t }}
    </el-checkbox>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  typeList: { type: Array, default: () => [] },
  typeColors: { type: Object, default: () => ({}) },
  selectedTypes: { type: Array, default: () => [] },
  title: { type: String, default: '实体类型（勾选筛选）' },
  // 父组件可选提供 skin: 'light' / 'dark'（默认 light）
  skin: { type: String, default: 'light' }
});
const emit = defineEmits(['toggle', 'selectAll', 'selectNone']);

const allSelected = computed(() =>
  props.typeList.length > 0 && props.selectedTypes.length === props.typeList.length);
const noneSelected = computed(() => props.selectedTypes.length === 0);
</script>

<style scoped>
.legend {
  font-size: 12px;
  padding: 10px 12px;
}
.legend.ck { display: flex; align-items: center; height: auto; margin: 3px 0; }
.legend-ck { display: flex; align-items: center; height: auto; margin: 3px 0; }
.legend-ck :deep(.el-checkbox__input) { display: inline-flex; }
.legend-ck :deep(.el-checkbox__inner) { background: transparent; border-color: #8ea3c8; }
.legend-ck :deep(.el-checkbox__inner::after) { border-color: #0f1a2a; }
.legend-ck.is-checked :deep(.el-checkbox__inner) {
  background: #ffd257;
  border-color: #ffd257;
}
.legend-ck :deep(.el-checkbox__label) {
  color: #e8eefb;
  font-size: 12px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding-left: 8px;
}
.legend-ck:hover :deep(.el-checkbox__label) { color: #ffffff; }
.legend-ck.is-checked :deep(.el-checkbox__label) {
  color: #ffffff;
  font-weight: 600;
}
.legend-batch :deep(.el-checkbox__label) { font-weight: 600; }
.legend-batch.is-checked :deep(.el-checkbox__label) { color: #ffd257; }
.sw {
  width: 11px;
  height: 11px;
  border-radius: 3px;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, .18);
  display: inline-block;
}
.lhead {
  margin-bottom: 4px;
  font-weight: 600;
}
</style>
