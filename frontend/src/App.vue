<!--
  根组件：仅承载路由出口（与旧版 App.js 行为一致）
  Vue 3 SFC 写法：<script setup> + 模板
  ----------------------------------------------------------
  业务说明：
    这个文件是整个 SPA 的"根组件"。看上去只有一行模板，但它有一个
    重要职责 —— 通过 <router-view /> 决定当前 URL 应该显示哪个页面。
    vue-router 会监听 location.hash 的变化，并动态把对应的页面组件
    替换到 <router-view /> 这个位置。

  涉及的 Vue 3 基础概念：
    - <template>：单文件组件的 HTML 结构，必须有一个根元素（或 Fragment）。
    - <router-view />：vue-router 提供的内置组件，等价于"占位符"，
       路由表里配置哪个组件，这里就会渲染哪个组件。
    - <script setup>：Vue 3 推荐的"组合式 API 写法"，语法更简洁，
       顶层声明的变量自动暴露给模板使用。
-->
<template>
  <router-view />
</template>

<script setup>
// Vue 3 SFC 默认导出一个组件，无需 name
// 这里故意保持空 —— 因为这只是个壳子。
// 如果你需要全局监听、错误处理、provide 等"框架级"逻辑，可以在这里写。
</script>
