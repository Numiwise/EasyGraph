<!--
  WorkspaceBadge.vue —— 工作区徽标（彩色 + 单字）
  ------------------------------------------------------------
  - 用法：<WorkspaceBadge :meta="currentMeta" /> 或 :ws="ws" 自动查 wsMeta
  - 两种尺寸：default / small
-->
<template>
  <span class="ws-badge" :class="['size-' + size]" :style="{ background: metaRef.color }">
    {{ metaRef.badge }}
  </span>
</template>

<script setup>
import { computed } from 'vue';
import { wsMeta } from '../composables/useNeo4j.js';

const props = defineProps({
  ws: { type: String, default: '' },
  meta: { type: Object, default: null },
  size: { type: String, default: 'default' } // 'default' | 'small'
});

const metaRef = computed(() => props.meta || wsMeta(props.ws || ''));
</script>

<style scoped>
.ws-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  color: #fff;
  font-weight: 800;
  font-size: 14px;
  box-shadow: 0 1px 4px rgba(31, 45, 61, .22);
  flex: 0 0 auto;
}
.ws-badge.size-small {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  font-size: 13px;
  box-shadow: 0 1px 4px rgba(31, 45, 61, .3);
}
</style>
