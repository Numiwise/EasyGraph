<!--
  WorkspaceSelect.vue —— 7 个工作区下拉选择
  ------------------------------------------------------------
  - v-model 双向绑定工作区 id
  - 选项来自 composables/useNeo4j.js 的 WS_META
-->
<template>
  <el-select :model-value="modelValue" :filter="filter" :style="{ width: width }"
    @update:model-value="emit('update:modelValue', $event)">
    <el-option v-for="o in options" :key="o.id" :value="o.id" :label="o.name"></el-option>
  </el-select>
</template>

<script setup>
import { computed } from 'vue';
import { WS_META } from '../composables/useNeo4j.js';

const props = defineProps({
  modelValue: { type: String, default: '' },
  width: { type: String, default: '150px' },
  filter: { type: Boolean, default: false }
});
const emit = defineEmits(['update:modelValue']);

const options = computed(() => WS_META);
</script>
