/* ============================================================
 * Vue Router 4 配置（hash 模式，与旧版保持一致）
 *   /                   → HomeView
 *   /graph/:ws          → GraphView
 *   /query              → QueryView
 *   /doc                → DocView
 * 兼容旧链接：?ws=gxx_... 自动重定向到 /graph/gxx_...
 *
 * 业务说明：
 *   本文件是整个前端"路由表"。浏览器地址栏里 hash 段（# 后面的内容）
 *   变化时，vue-router 会根据下方的 routes 配置，把对应的 Vue 组件
 *   渲染到 App.vue 的 <router-view /> 里。
 *
 *   为什么用 hash 模式（createWebHashHistory）而不是 history 模式？
 *     - 项目最终是通过 Nginx 配置好的静态服务（见 nginx/*）部署的。
 *     - 用 hash 模式（URL 形如 /#/graph/g00_master_all），
 *       刷新页面 / 直接打开子页面时，请求始终落到 index.html 上，
 *       不需要 Nginx 配置 try_files，避免 404。
 *   - URL 上加 ?ws=gxx_... 是历史兼容逻辑（旧版用过 querystring 传
 *     workspace 参数），新版本统一改成路径段 /graph/:ws。
 * ============================================================ */

// 从 vue-router 引入两个工具函数：
//   createRouter          —— 创建一个路由实例
//   createWebHashHistory  —— 告诉路由使用"hash 模式"的 history（URL 不需服务端配合）
import { createRouter, createWebHashHistory } from 'vue-router';

// 路由会用到 4 个页面组件，它们都是 .vue 单文件组件。
// 注意：这里的路径必须用相对路径（或 @ 别名），因为路由配置由 vite 在运行时加载。
import HomeView from './views/HomeView.vue';
import GraphView from './views/GraphView.vue';
import QueryView from './views/QueryView.vue';
import DocView from './views/DocView.vue';

// 创建路由实例。
// createRouter 接收一个配置对象：
//   - history：决定 URL 怎么"看起来"。这里指定 hash 模式（#/xxx）。
//   - routes ：路由表。每条路由描述"path 匹配 → 渲染哪个 component"。
const router = createRouter({
  // createWebHashHistory() 不接参数，默认 base 就是当前域名根目录。
  history: createWebHashHistory(),
  routes: [
    // 根路径 /：直接显示 HomeView（首页 = workspace 选择页）。
    // name 是路由的命名，可以在 <router-link :to="{name:'home'}"> 里引用。
    { path: '/', name: 'home', component: HomeView },

    /* ----------------------------------------------------------
     * /graph/:ws —— 进入某个 workspace 的图谱视图。
     *   - :ws 是一个动态路径段，比如 /graph/g00_master_all 中的 g00_master_all
     *     会被解析到 route.params.ws。
     *   - props: (route) => ({ ws0: route.params.ws })：把 params.ws
     *     透传给 GraphView 的 prop，名字叫 ws0（避免和 view 内部其它 ws
     *     概念冲突）。
     * ---------------------------------------------------------- */
    { path: '/graph/:ws', name: 'graph', component: GraphView, props: (route) => ({ ws0: route.params.ws }) },

    // /query：问答页（POST /query/stream 等）。
    { path: '/query', name: 'query', component: QueryView },

    // /doc：单文档查看页（用于"打开某一段原始资料"链接）。
    { path: '/doc', name: 'doc', component: DocView }
  ]
});

/* ----------------------------------------------------------
 * router.beforeEach：全局"前置守卫"。
 * 每次路由跳转（包括页面刚加载、点击链接、router.push）都会先走这里。
 * 业务目的：兼容旧版 URL /?ws=g00_master_all —— 当检测到 / 带着
 *   ?ws=xxx 时，自动把它改写成新的 /#/graph/xxx 形式。
 *
 * 原理：
 *   - to：即将跳转到的路由对象（包含 path/query/params ...）。
 *   - 返回一个路由"位置对象"，vue-router 会取消原跳转，重新跳到
 *     这个返回值指明的目标。
 * ---------------------------------------------------------- */
router.beforeEach((to) => {
  if (to.path === '/' && to.query.ws) {
    // 把旧链接 /?ws=xxx 重定向到 /graph/xxx（hash 模式下实际是 #/graph/xxx）。
    return { path: '/graph/' + to.query.ws };
  }
  // 返回 undefined 表示"放行，按原计划跳转"。
});

// ES Module 默认导出，main.js 会 import 这个 router。
export default router;
