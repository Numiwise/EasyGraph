<!--
  AttrTable.vue —— Neo4j 节点非保留键属性表（用 el-descriptions 实现）
  ------------------------------------------------------------
  用法：
    <AttrTable :props="sel.extraProps" />
  - 接收额外属性数组（[{ key, label, value }]）
  - 用 el-descriptions 展示：列数 1（每行一对 key/value）
  - 默认折叠由父组件的 attrsOpen 控制
-->
<template>
  <div v-if="rows && rows.length" class="attr-host">
    <div class="section-head" @click="$emit('toggle')">
      <span class="sh-title">属性（{{ rows.length }}）</span>
      <span class="sh-tog">{{ open ? '收起 ▲' : '展开 ▼' }}</span>
    </div>
    <el-descriptions v-show="open" :column="1" border size="small" class="attr-descs">
      <el-descriptions-item
        v-for="p in rows"
        :key="p.key"
        :label="p.label">
        {{ p.value }}
      </el-descriptions-item>
    </el-descriptions>
  </div>
</template>

<script setup>
defineProps({
  rows: { type: Array, default: () => [] },
  open: { type: Boolean, default: true }
});
defineEmits(['toggle']);
</script>

<style scoped>
.attr-host { margin: 8px 0 10px; }
.attr-host :deep(.el-descriptions) {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 4px 8px;
}
.attr-host :deep(.el-descriptions__label) {
  width: 96px;
  color: var(--text-2);
  font-weight: 600;
  font-size: 12px;
}
.attr-host :deep(.el-descriptions__content) {
  font-size: 12px;
  color: var(--text-1);
  word-break: break-word;
}
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
}
.section-head:hover { background: linear-gradient(95deg, #d3e4ff, #c2d6fb); }
.sh-title {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--primary-strong);
  letter-spacing: .5px;
}
.sh-tog {
  font-size: 11px;
  color: var(--text-2);
  font-weight: 500;
}
</style>
