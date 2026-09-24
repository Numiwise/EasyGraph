/* ============================================================
 * Vue 3 应用入口
 *   - 由 Vite 处理（index.html 通过 <script type="module" src> 加载）
 *   - 注册路由 + Element Plus（自动按需）
 *   - 旧版（Vue 3 UMD 全局脚本）逻辑等价：用 ESM 替换 Vue.createApp 全局
 * ============================================================ */
import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import * as ElementPlusIconsVue from '@element-plus/icons-vue';

import App from './App.vue';
import router from './router';

import './styles/main.css';
import './styles/home.css';
import './styles/graph.css';
import './styles/query.css';
import './styles/doc.css';

const app = createApp(App);

// 注册全部 Element Plus 图标为全局组件（仅注册一次，使用方 <el-icon><Edit /></el-icon>）
for (const [key, comp] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, comp);
}

app.use(router);
app.use(ElementPlus, { zIndex: 3000 });
app.mount('#app');
