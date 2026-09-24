<!--
  WorkspaceSelect.vue —— 7 个工作区下拉选择
  ------------------------------------------------------------
  业务用途：
    项目里有 7 个 workspace（总图谱 + 6 个主题子库），各个页面顶部经常会
    有个"切换 workspace"的小下拉框。本组件就是它的复用实现。

  用法（受控）：
    <WorkspaceSelect
      v-model="ws"          <!-- 双向绑定的当前 workspace id -->
      filterable             <!-- 可搜索（按名字/描述关键字过滤） -->
      width="220px"          <!-- 下拉宽度 -->
      @change="onWsChanged" <!-- 用户点了下拉某项时触发（不带名字也行） -->
    />

  Vue 3 涉及的语法点：
    - v-model 在组件上会被编译成 :model-value + @update:model-value。
      本组件手动"包装"这一对 prop+event，方便加上自定义的 @change 事件。
-->
<template>
  <!--
    el-select 是 Element Plus 的下拉选择组件。这里我们不用它自带的 v-model，
    因为我们的 prop 叫 modelValue（驼峰），Element Plus 内部用 model-value（短横线）。
    所以手动把这两对事件接起来：
      :model-value="modelValue"                ↔ Element Plus 的绑定值
      @update:model-value="emit('update:modelValue', $event)"
                                             ↔ 用户选了某项时，组件内部通知更新
                                              （"事件冒泡"回上层）
      @change="emit('change', $event)"        ↔ 同样的变更，但用我们的 change 事件
                                              名字（适合非 v-model 的"监听"场景）
    :filterable / :clearable 都是 Element Plus 原生属性。
    :style="{ width }" 让父组件能动态控制宽度。
  -->
  <el-select :model-value="modelValue" :filterable="filterable" :style="{ width }"
    :clearable="clearable" @update:model-value="emit('update:modelValue', $event)"
    @change="emit('change', $event)">
    <!--
      el-option 是每个选项：
        :value —— 选中后的实际值（用 id，如 'g01_people_literature'）
        :label —— 显示给用户的文字（用 name，如 '人物与文献'）
      :key="o.id" 是 Vue 列表循环的必备 key，提高 diff 性能。
    -->
    <el-option v-for="o in options" :key="o.id" :value="o.id" :label="o.name"></el-option>
  </el-select>
</template>

<script setup>
// 从 vue 引入 computed
import { computed } from 'vue';

// 从 composables/useNeo4j.js 引入 WS_META —— 7 个 workspace 的展示元数据（id/name/badge/desc/color）
import { WS_META } from '../composables/useNeo4j.js';

/* ---------------------------------------------------------------
 * defineProps：声明组件对外接收
 *   modelValue —— 当前选中的 workspace id（v-model 那一对 prop/event）
 *   width      —— 下拉宽度 CSS 字符串，默认 '150px'
 *   filterable —— 是否可搜索（按 name 文本过滤）
 *   clearable  —— 是否显示清空按钮（×）
 * --------------------------------------------------------------- */
const props = defineProps({
  modelValue: { type: String, default: '' },
  width: { type: String, default: '150px' },
  // Element Plus 属性名是 filterable
  filterable: { type: Boolean, default: false },
  clearable: { type: Boolean, default: false }
});

/* ---------------------------------------------------------------
 * defineEmits：声明对外事件
 *   'update:modelValue' —— 用于 v-model，下拉新值
 *   'change'            —— 用户改变选项的同一时刻
 * --------------------------------------------------------------- */
const emit = defineEmits(['update:modelValue', 'change']);

// 直接把 WS_META 包成 computed（实际可以省掉这一步，但保持和其它组件风格一致）
const options = computed(() => WS_META);
</script>
