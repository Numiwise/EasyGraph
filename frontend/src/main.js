/* ============================================================
 * Vue 3 应用入口
 *   - 由 Vite 处理（index.html 通过 <script type="module" src> 加载）
 *   - 注册路由 + Element Plus（按需自动导入）
 *   - 只引入全局样式（CSS 变量、Element Plus 主题微调）
 *   - 各 view 的专属样式已拆入对应 .vue 文件的 <style scoped>
 * ============================================================ */
import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import * as ElementPlusIconsVue from '@element-plus/icons-vue';

import App from './App.vue';
import router from './router';

import './styles/main.css';

const app = createApp(App);

// 注册全部 Element Plus 图标为全局组件（仅注册一次，使用方 <el-icon><Edit /></el-icon>）
for (const [key, comp] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, comp);
}

app.use(router);
app.use(ElementPlus, { zIndex: 3000 });
app.mount('#app');
