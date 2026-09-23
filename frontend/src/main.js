/* ============================================================
 * 前端入口：创建 Vue 应用，注册路由与 Element Plus
 * 依赖加载方式：库（Vue/Router/EP/vis/neo4j）由 index.html 以全局
 *   脚本引入（本地 vendor，断网可用）；本项目代码用 ES Modules 组织。
 * ============================================================ */
import App from './App.js';
import { router } from './router.js';

const app = Vue.createApp(App);
app.use(router);
app.use(ElementPlus, { zIndex: 3000 });
app.mount('#app');
