/* ============================================================
 * Vue 3 应用入口文件（src/main.js）
 * ------------------------------------------------------------
 * 业务背景：
 *   本项目是一个 LightRAG 知识图谱可视化前端。整个项目打包后由
 *   Vite 提供开发服务（NPM run dev）或由 Nginx 提供静态服务。
 *   index.html 里通过 <script type="module" src="/src/main.js">
 *   加载本文件，本文件就是整个 SPA 的"启动器"。
 *
 * 启动时做的事：
 *   1. 创建一个 Vue 应用实例（createApp）。
 *   2. 安装第三方 UI 库 Element Plus（按需全量载入，省去 unplugin
 *      自动导入的复杂度），并指定 zIndex 起始值，避免和某些地图层
 *      （如 GraphView 的 canvas 浮层）冲突。
 *   3. 把 Element Plus 的图标全部注册为全局组件，可以在任意
 *      .vue 模板里直接 <el-icon><Edit /></el-icon> 使用。
 *   4. 安装 vue-router（hash 模式，路径以 # 开头，兼容静态服务）。
 *   5. 引入全局样式 main.css（CSS 变量、品牌色、Element 主题微调）。
 *   6. 把应用挂载到 index.html 里的 <div id="app"> 节点上。
 *
 * 涉及的语法点（给初学者的备忘）：
 *   - import ... from '...'：ES Module 的导入语法，Vite 在浏览器
 *     里直接按需拉取 ESM 文件，无需打包。
 *   - for ... of：遍历可迭代对象；Object.entries(obj) 把对象的
 *     [key, value] 拆成二维数组，循环里分别取 key 和 组件定义。
 *   - app.use(插件)：Vue 3 推荐的"安装"方式，等价于调用插件内部
 *     的 install(app, options) 方法。
 *   - app.mount('#app')：把根组件渲染到 id="app" 的 DOM 节点里。
 * ============================================================ */

// 从 vue 引入 createApp —— 这是 Vue 3 的工厂函数，作用是"造出一个 Vue 应用"。
// Vue 2 时代是 new Vue({...})；Vue 3 彻底改为函数式创建，便于 SSR/测试。
import { createApp } from 'vue';

// 引入 Element Plus 的主入口（按全量载入，体积稍大但配置简单）。
// Element Plus 是基于 Vue 3 的桌面端 UI 组件库，相当于"现成的按钮/弹窗/表格"。
import ElementPlus from 'element-plus';

// 引入 Element Plus 自带的默认样式（必须引入，否则组件没颜色）。
import 'element-plus/dist/index.css';

// 命名空间导入：把图标库里所有图标都作为命名导出。
// @element-plus/icons-vue 是 Element Plus 提供的图标包，键名如 Edit/Delete/Search。
import * as ElementPlusIconsVue from '@element-plus/icons-vue';

// 引入项目根组件（Single File Component，单文件组件 = .vue）。
// 这里 '@/App.vue' 的解析由 vite.config.js 的 alias 完成（默认 '@' 指向 src）。
import App from './App.vue';

// 引入路由配置。本文件末尾会通过 app.use(router) 安装。
import router from './router';

// 引入全局样式（CSS 变量、scrollbar、Element Plus 主题微调等）。
// 注意：在 JS 里直接 import 一个 CSS，Vite 会自动处理并插入到 <style> 标签中。
import './styles/main.css';

// 调用 createApp 创建一个 Vue 应用实例，根组件就是上面 import 的 App。
// 这一步只是"准备好了"，还没有真正渲染到页面上 —— 见最后的 .mount。
const app = createApp(App);

/* ------------------------------------------------------------
 * 循环注册所有 Element Plus 图标为全局组件。
 * 原理：ElementPlusIconsVue 是一个普通对象，形如
 *   { Edit: Edit组件, Delete: Delete组件, Search: Search组件, ... }
 * Object.entries() 把对象变成 [['Edit', Edit组件], ['Delete', ...], ...]
 * 解构出 key（图标名）和 comp（图标组件定义）。
 * app.component(全局名, 组件) 把图标注册为"全局可用"，之后在任意 .vue 里
 *   <el-icon><Edit /></el-icon>
 *   <el-icon><Delete /></el-icon>
 * 都能直接使用，不用每个文件再单独 import。
 * 这是一次性"灌入"，运行期间不会变化，所以放在创建 app 之后、mount 之前。
 * ------------------------------------------------------------ */
for (const [key, comp] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, comp);
}

// 安装路由。这里 router 是一个 Vue Router 实例，安装后会自动接管 URL 变化，
// 并根据 routes 把不同的 URL 渲染成对应的页面组件。
app.use(router);

// 安装 Element Plus 插件，传入选项 { zIndex: 3000 }。
// zIndex 是 Element Plus 所有浮层组件（dialog/drawer/tooltip/popper ...）的
// 起始 z-index 值；业务里我们把图谱 canvas 画在了 z-index ~2000 附近，
// 所以这里设 3000 以确保弹窗/抽屉能浮在图谱之上。
app.use(ElementPlus, { zIndex: 3000 });

// 把 App.vue 渲染到 index.html 中 <div id="app"></div> 这个 DOM 节点上。
// 到这一步，浏览器页面才会真正显示出 Vue 的界面（root 组件里只是个 <router-view />）。
app.mount('#app');
