<!--
  AttrTable.vue —— Neo4j 节点非保留键属性表（用 el-descriptions 实现）
  ------------------------------------------------------------
  业务用途：
    GraphView 里点击某个节点时，右栏会显示节点的属性。
    Neo4j 节点上挂的字段有些是框架保留的（id/labels/embedding/...），
    有些是"业务属性"（如 description、name_en、source_year 等）。
    本组件只负责展示这些"业务属性"，让用户能看到"这个实体有哪些元数据"。

  用法：
    <AttrTable :rows="sel.extraProps" :open="attrsOpen" @toggle="..." />
  - 接收 rows 数组 [{ key, label, value }]
  - 用 Element Plus 的 el-descriptions 渲染：1 列布局（label + value 一对一行）
  - 默认折叠由 open prop 控制，点击 header 会 emit toggle 给父组件

  Vue 3 涉及的语法点：
    - $emit('xxx')：在事件处理器里直接写也能用，但 defineEmits([]) 是更推荐的写法。
-->
<template>
  <!-- v-if：当 rows 为空时整块不渲染（避免一条"空属性"标题） -->
  <div v-if="rows && rows.length" class="attr-host">
    <!-- 点击 header 时 emit toggle，让父组件切换 open 状态 -->
    <div class="section-head" @click="$emit('toggle')">
      <span class="sh-title">属性（{{ rows.length }}）</span>
      <span class="sh-tog">{{ open ? '收起 ▲' : '展开 ▼' }}</span>
    </div>

    <!--
      el-descriptions 是 Element Plus 的"键值对列表"组件，常用于详情页面。
      - :column="1"：1 列布局（label 一栏 + value 一栏 横向排列），如果改成 3 就会 3 列并排
      - border：每个 cell 加边框
      - size="small"：紧凑模式
      - v-show="open"：收起时只是 display:none，不会卸载 DOM（避免来回切换的卡顿）
    -->
    <el-descriptions v-show="open" :column="1" border size="small" class="attr-descs">
      <el-descriptions-item
        v-for="p in rows"
        :key="p.key"
        :label="p.label">
        <!--
          p.value 可能是字符串或数组。Vue 自动调用 toString()，
          数组会用 "," 拼接；父组件可换成 <pre v-html="..."> 来格式化 JSON。
        -->
        {{ p.value }}
      </el-descriptions-item>
    </el-descriptions>
  </div>
</template>

<script setup>
/* ---------------------------------------------------------------
 * defineProps：本组件对外接收两个 prop
 *   rows —— 形如 [{ key:'description', label:'描述', value:'...' }, ...]
 *           默认空数组（用工厂函数返回新数组，避免多个实例共享同一个 []）
 *   open —— 是否展开列表
 * --------------------------------------------------------------- */
defineProps({
  rows: { type: Array, default: () => [] },
  open: { type: Boolean, default: true }
});

/* ---------------------------------------------------------------
 * defineEmits：声明 emit 的事件
 *   'toggle' —— 点击 header 时触发，不带参数，让父组件自己切换 open
 * --------------------------------------------------------------- */
defineEmits(['toggle']);
</script>

<style scoped>
/* CSS 变量（--surface-2 / --primary-strong 等）在全局 main.css 里定义。
   scoped 让这些样式只作用在本组件，不污染其它地方。 */
.attr-host { margin: 8px 0 10px; }
.attr-host :deep(.el-descriptions) {
  background: var(--surface-2);      /* 背景：次级面板色 */
  border: 1px solid var(--border);   /* 边框颜色 */
  border-radius: 8px;
  padding: 4px 8px;
}
.attr-host :deep(.el-descriptions__label) {
  width: 96px;                       /* label 列固定宽度 */
  color: var(--text-2);
  font-weight: 600;
  font-size: 12px;
}
.attr-host :deep(.el-descriptions__content) {
  font-size: 12px;
  color: var(--text-1);
  word-break: break-word;            /* 中文长串也能换行 */
}
/* 折叠 header：浅蓝渐变背景，可点击 */
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;    /* 标题在左，"展开/收起"在右 */
  gap: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--primary-soft);
  border: 1px solid var(--border);
  cursor: pointer;                   /* 鼠标变手型，提示可点 */
  user-select: none;                 /* 禁止选中文字，避免误操作 */
  margin-bottom: 6px;
}
.section-head:hover {
  background: linear-gradient(95deg, #d3e4ff, #c2d6fb);
}
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
