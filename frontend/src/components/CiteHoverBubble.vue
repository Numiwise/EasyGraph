<!--
  CiteHoverBubble.vue —— 引用 [n] 悬浮气泡
  ------------------------------------------------------------
  用法：见 QueryView 的 onChatOver/onChatMove/onChatLeave/...
  - 由父组件计算 x/y/title/content 后通过 props 传入
  - 内部管理 hover → 离开气泡 → 延迟消失 的交互
-->
<template>
  <div v-if="visible" ref="rootEl" class="cite-hover"
    :style="{ left: x + 'px', top: y + 'px' }"
    @mouseenter="onEnter" @mousemove="onMove" @mouseleave="onLeave">
    <div class="ch-title">{{ title }}</div>
    <div class="ch-body">{{ content }}</div>
    <div class="ch-hint">点击引用数字可打开原网页</div>
  </div>
</template>

<script setup>
/* 行为完全照搬旧版 QueryView 的引用气泡（450ms 延迟消失，进入气泡不消失）。
 * 把交互封装到这里，父组件只需提供 visible/x/y/title/content 与四个事件回调。 */
import { ref } from 'vue';

const props = defineProps({
  visible: { type: Boolean, default: false },
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  title: { type: String, default: '' },
  content: { type: String, default: '' }
});
const emit = defineEmits(['enter', 'move', 'leave']);

const rootEl = ref(null);
let _timer = null;

function scheduleHide(delay = 450) {
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(() => {
    emit('leave');
    _timer = null;
  }, delay);
}
function cancelHide() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
}

defineExpose({ scheduleHide, cancelHide });

function onEnter() { cancelHide(); emit('enter'); }
function onMove()  { cancelHide(); emit('move'); }
function onLeave()  { cancelHide(); emit('leave'); }
</script>

<style scoped>
.cite-hover {
  position: fixed;
  z-index: 1000;
  width: 400px;
  height: min(520px, 70vh);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fffdfa;
  color: #2a3548;
  border: 1px solid #e6d4b4;
  border-radius: 8px;
  box-shadow: 0 12px 34px rgba(40, 30, 10, .26);
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
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ch-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 11px 14px;
  white-space: pre-wrap;
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
