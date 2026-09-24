<!--
  CiteHoverBubble.vue —— 引用 [n] 悬浮气泡
  ------------------------------------------------------------
  业务用途：
    LLM 回答里经常出现 [1][2][3] 这种引用编号。
    当用户把鼠标悬停在某个 [n] 上时，我们希望浮出一个气泡，显示这条
    引用对应的"原文片段"，点击气泡里的标题可以跳转到原始网页。
    本组件就是这个气泡的可复用版本。

  用法（见 QueryView）：
    const showHover = ref(false);
    const hover = ref({ x:0, y:0, title:'', content:'' });
    <span @mouseenter="onChatOver($event, refItem)" @mouseleave="scheduleHide">
       [1]
    </span>
    <CiteHoverBubble
        :visible="showHover"
        :x="hover.x" :y="hover.y"
        :title="hover.title" :content="hover.content"
        @leave="showHover = false"
        @enter="cancelHide" @move="cancelHide" />
    // 父组件拿到的 scheduleHide / cancelHide 通过 ref.defineExpose 调用
    // 让用户从引用号"平滑过渡"到气泡里，不会因为光标离开引用号瞬间就消失。

  Vue 3 涉及的语法点：
    - defineExpose：默认 <script setup> 里声明的变量对父组件不可见，
       如果要让父组件通过 ref 访问，必须用 defineExpose() 显式"开门"。
    - setTimeout / clearTimeout：用来实现"450ms 延迟消失"。
-->
<template>
  <!-- v-if="visible"：父组件控制可见性 -->
  <div v-if="visible" ref="rootEl" class="cite-hover"
    :style="{ left: x + 'px', top: y + 'px' }"
    @mouseenter="onEnter" @mousemove="onMove" @mouseleave="onLeave">
    <!-- 三段布局：标题(顶部) + 正文(中段,可滚动) + 操作提示(底部) -->
    <div class="ch-title">{{ title }}</div>
    <div class="ch-body">{{ content }}</div>
    <div class="ch-hint">点击引用数字可打开原网页</div>
  </div>
</template>

<script setup>
/* ============================================================
 * 行为说明（来自旧版 QueryView 的同款气泡）：
 *   - 鼠标进入"引用号" → onChatOver：让气泡显示
 *   - 鼠标离开引用号 → scheduleHide(450ms)：等 450ms 再隐藏（让用户能"滑过去"）
 *   - 鼠标进入气泡   → onEnter：取消延迟（用户已经到气泡里了，不应该消失）
 *   - 鼠标在气泡内移动 → onMove：保持不消失
 *   - 鼠标离开气泡   → onLeave：通常立即 hide
 * ============================================================
 * 这里把交互封装在组件内部，父组件只需传 visible/x/y/title/content
 * 并通过 ref 拿到 scheduleHide / cancelHide 两个方法。
 */
import { ref } from 'vue';

/* defineProps：声明对外 props
 *   visible —— 是否显示
 *   x, y    —— 屏幕坐标（左上角）
 *   title   —— 来源文件名 / chunk 标题
 *   content —— 原文片段（可能很长，但本组件会用 overflow-y 滚动）
 */
const props = defineProps({
  visible: { type: Boolean, default: false },
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  title: { type: String, default: '' },
  content: { type: String, default: '' }
});

/* defineEmits：
 *   'enter' () —— 鼠标进入气泡时触发（让父组件可以取消自己那边的延迟）
 *   'move'  () —— 鼠标在气泡内移动
 *   'leave' () —— 鼠标离开时触发（多数情况父组件会立即 visible=false）
 */
const emit = defineEmits(['enter', 'move', 'leave']);

/* ============================================================
 * 内部状态
 * ============================================================ */
// 根节点的 DOM 引用。模板里 ref="rootEl" 关联到此变量。
// 现在没主动用到，但保留以便将来（例如聚焦、自适应宽度）。
const rootEl = ref(null);

// 闭包变量保存 setTimeout 的 id，避免"清除错定时器"
let _timer = null;

/* scheduleHide(delay = 450)：延迟隐藏。
 *   - 父组件调用时让用户"从引用号滑到气泡"不至于立刻消失。
 *   - 默认 450ms 是个经验值——太短用户来不及滑动，太长会显得迟钝。
 */
function scheduleHide(delay = 450) {
  if (_timer) clearTimeout(_timer);  // 多次连点时取消上一次的 timer
  _timer = setTimeout(() => {
    emit('leave');                    // 通知父组件：可以隐藏了
    _timer = null;
  }, delay);
}

/* cancelHide()：取消已排好的延迟隐藏。
 * 鼠标进入气泡或移动时调用 —— 用户已经"明确进入"气泡，不能再消失。
 */
function cancelHide() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
}

/* defineExpose：
 * 默认 <script setup> 里声明的变量对父组件 ref 是不可见的，
 * 用 defineExpose 显式把 scheduleHide / cancelHide 暴露出去，
 * 父组件通过 const bubbleRef = ref() + bubbleRef.value.scheduleHide() 调用。
 */
defineExpose({ scheduleHide, cancelHide });

/* ============================================================
 *  三个鼠标事件处理
 *  onEnter 进入气泡  → 取消延迟 + 通知父组件
 *  onMove  气泡内移动 → 取消延迟 + 通知父组件
 *  onLeave 离开气泡  → 取消延迟 + 通知父组件 visible=false
 * ============================================================ */
function onEnter() { cancelHide(); emit('enter'); }
function onMove()  { cancelHide(); emit('move'); }
function onLeave() { cancelHide(); emit('leave'); }
</script>

<style scoped>
/* 气泡视觉：固定定位在屏幕坐标 (x, y) 处，与 cite-hover 全屏覆盖无关 */
.cite-hover {
  position: fixed;
  z-index: 1000;                                  /* 浮在所有内容之上 */
  width: 400px;
  height: min(520px, 70vh);                       /* 上限 520 或视口 70%，看哪个先达到 */
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fffdfa;                           /* 米黄色背景，跟主题呼应"古籍" */
  color: #2a3548;
  border: 1px solid #e6d4b4;
  border-radius: 8px;
  box-shadow: 0 12px 34px rgba(40, 30, 10, .26);  /* 大投影让浮出感更强 */
  font-size: 13px;
  line-height: 1.75;
}
.ch-title {
  padding: 9px 14px;
  font-weight: 700;
  color: #8a6a2a;
  background: #faf4e6;
  border-bottom: 1px solid #efe4cb;
  flex: 0 0 auto;
  white-space: nowrap;       /* 长文件名不换行 */
  overflow: hidden;
  text-overflow: ellipsis;   /* 多出部分用 ... 省略 */
}
.ch-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;          /* 原文过长时滚动 */
  padding: 11px 14px;
  white-space: pre-wrap;     /* 保留换行符，但允许自动折行 */
}
.ch-hint {
  flex: 0 0 auto;
  padding: 7px 14px;
  color: #b28d5a;
  font-size: 11.5px;
  background: #f7f0e0;
  border-top: 1px solid #efe4cb;
}
</style>
