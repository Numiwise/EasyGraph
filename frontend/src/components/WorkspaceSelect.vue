<!--
  WorkspaceSelect.vue —— 7 个工作区下拉选择
  ------------------------------------------------------------
  - v-model 双向绑定工作区 id
  - 选项来自 composables/useNeo4j.js 的 WS_META
  - filterable 支持搜索；@update:model-value 向上发射
-->
<template>
  <el-select :model-value="modelValue" :filterable="filterable" :style="{ width }"
    :clearable="clearable" @update:model-value="emit('update:modelValue', $event)"
    @change="emit('change', $event)">
    <el-option v-for="o in options" :key="o.id" :value="o.id" :label="o.name"></el-option>
  </el-select>
</template>

<script setup>
import { computed } from 'vue';
import { WS_META } from '../composables/useNeo4j.js';

const props = defineProps({
  modelValue: { type: String, default: '' },
  width: { type: String, default: '150px' },
  // Element Plus 属性名是 filterable
  filterable: { type: Boolean, default: false },
  clearable: { type: Boolean, default: false }
});
const emit = defineEmits(['update:modelValue', 'change']);

const options = computed(() => WS_META);
</script>
